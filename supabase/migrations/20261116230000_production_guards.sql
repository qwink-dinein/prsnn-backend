-- Production guards (before scaling up):
-- 1) A companion can never hold two overlapping confirmed sessions: an exclusion constraint makes it
--    impossible at the database level, even if two requests race. (Every code path already checks; this
--    is the last line.)
-- 2) The overlap check reads only the companion's own bookings and offers (indexed), not a whole day.
-- 3) Payments: one Razorpay order per booking is reused instead of a new one per checkout; every order is
--    remembered, so a late payment on an earlier order is still recognised; a second payment for a booking
--    that's already paid is refunded in full automatically (and the member is told).

-- ── 1. No overlapping confirmed sessions per companion ─────────────────────────────────────────────
create extension if not exists btree_gist with schema extensions;

alter table public.bookings add column if not exists slot tstzrange
  generated always as (tstzrange(private.session_start(scheduled_date, start_time), private.session_end(scheduled_date, start_time, duration_min))) stored;

do $$ begin
  alter table public.bookings add constraint bookings_companion_no_overlap
    exclude using gist (companion_id with =, slot with &&)
    where (companion_id is not null and (status = 'accepted' or alloc_state = 'id_check'));
exception when duplicate_object then null; end $$;

-- ── 2. Overlap check by companion (indexed) ───────────────────────────────────────────────────────
create index if not exists bookings_preferred_awaiting on public.bookings (preferred_companion_id, scheduled_date) where alloc_state = 'awaiting_payment';

create or replace function private.has_conflict(cid uuid, b public.bookings) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.bookings o
     where o.id <> b.id and o.scheduled_date = b.scheduled_date
       and (
         -- confirmed / in ID check with this companion
         (o.companion_id = cid and (o.status = 'accepted' or o.alloc_state = 'id_check'))
         -- a member is paying for this companion right now
         or (o.preferred_companion_id = cid and o.alloc_state = 'awaiting_payment' and o.payment_deadline > now())
         -- a live offer to this companion
         or o.id in (select f.booking_id from public.booking_offers f where f.companion_id = cid and f.status = 'offered' and f.expires_at > now())
       )
       and private.session_start(o.scheduled_date, o.start_time) < private.session_end(b.scheduled_date, b.start_time, b.duration_min)
       and private.session_start(b.scheduled_date, b.start_time) < private.session_end(o.scheduled_date, o.start_time, o.duration_min))
$$;

-- ── 3. Payments: orders remembered and reused, extra payments refunded ────────────────────────────
create table if not exists private.payment_orders (
  order_id text primary key,
  booking_id uuid not null references public.bookings (id) on delete cascade,
  amount_paise bigint not null,
  created_at timestamptz not null default now()
);
create index if not exists payment_orders_booking on private.payment_orders (booking_id, created_at desc);
insert into private.payment_orders (order_id, booking_id, amount_paise)
  select razorpay_order_id, id, (package_price * 100)::bigint from public.bookings where razorpay_order_id is not null
  on conflict (order_id) do nothing;

/** A payment that arrived for a booking that was already paid (paid twice): refunded in full. */
create table if not exists private.extra_payments (
  payment_id text primary key,
  booking_id uuid not null references public.bookings (id) on delete cascade,
  order_id text,
  amount_paise bigint not null,
  status text not null default 'pending' check (status in ('pending', 'processed', 'failed')),
  provider_id text,
  attempts int not null default 0,
  claim_token uuid,
  claimed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index if not exists extra_payments_pending on private.extra_payments (created_at) where status = 'pending';

/** Is this booking payable by this member? Also returns its open order to reuse, if the price is unchanged. */
create or replace function public.pay_prepare(bid uuid, uid uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare b public.bookings; amt bigint; existing text;
begin
  if private.cfg('payment_mode') <> 'razorpay' then perform private.fail('Online payments are not switched on.'); end if;
  select * into b from public.bookings where id = bid and requester_id = uid for update;
  if not found then perform private.fail('Booking not found.'); end if;
  if b.payment_status = 'paid' then perform private.fail('This booking is already paid.'); end if;
  if b.alloc_state <> 'awaiting_payment' or b.payment_deadline < now() then perform private.fail('This booking can no longer be paid. Please book again.'); end if;
  amt := (b.package_price * 100)::bigint;
  select o.order_id into existing from private.payment_orders o where o.booking_id = bid and o.amount_paise = amt order by o.created_at desc limit 1;
  return jsonb_build_object('amountPaise', amt, 'ref', b.ref, 'bookingId', b.id, 'orderId', existing);
end $$;

create or replace function public.pay_set_order(bid uuid, order_id text, amount_paise bigint) returns void
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  insert into private.payment_orders (order_id, booking_id, amount_paise) values ($2, $1, $3) on conflict on constraint payment_orders_pkey do nothing;
  update public.bookings set razorpay_order_id = $2 where id = $1 and payment_status <> 'paid';
end $$;
-- The earlier two-argument form (still used by an older deploy of `payments`): records the order too.
create or replace function public.pay_set_order(bid uuid, order_id text) returns void
language sql security definer set search_path = '' as $$
  select public.pay_set_order($1, $2, (select (package_price * 100)::bigint from public.bookings where id = $1))
$$;

/**
 * A captured payment (from the app's verify call or Razorpay's webhook; whichever comes first wins, the
 * other is a no-op). Matched through every order made for the booking. The same payment twice: no-op.
 * A different payment for a booking that's already paid: refunded in full automatically.
 */
create or replace function public.pay_confirm(order_id text, payment_id text, amount_paise bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare b public.bookings; bid uuid;
begin
  select o.booking_id into bid from private.payment_orders o where o.order_id = $1;
  if bid is null then select id into bid from public.bookings where razorpay_order_id = $1; end if;
  if bid is null then return jsonb_build_object('ok', false, 'reason', 'unknown order'); end if;
  select * into b from public.bookings where id = bid for update;
  if b.razorpay_payment_id = $2 then return jsonb_build_object('ok', true, 'bookingId', b.id, 'already', true); end if;
  if b.payment_status in ('paid', 'refunded') then
    insert into private.extra_payments (payment_id, booking_id, order_id, amount_paise) values ($2, b.id, $1, $3)
      on conflict on constraint extra_payments_pkey do nothing;
    if found then
      perform private.notify(b.requester_id, 'refund', 'We received a second payment of ₹' || ($3 / 100) || ' for booking #' || b.ref || '. It’s being refunded to you in full.');
      perform private.notify_staff('other', 'Second payment for booking #' || b.ref || ' (₹' || ($3 / 100) || ', ' || $2 || '): refunding it automatically.', null::jsonb);
    end if;
    return jsonb_build_object('ok', true, 'bookingId', b.id, 'duplicate', true);
  end if;
  if $3 <> (b.package_price * 100)::bigint then
    update public.bookings set refund_review_needed = true where id = b.id;
    return jsonb_build_object('ok', false, 'reason', 'amount mismatch', 'bookingId', b.id);
  end if;
  update public.bookings set razorpay_order_id = $1 where id = b.id;
  b := private.mark_paid(b.id, $2, b.package_price, 'razorpay');
  return jsonb_build_object('ok', true, 'bookingId', b.id);
end $$;

create or replace function public.pay_failed(order_id text) returns void
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  update public.bookings set payment_status = 'failed'
   where payment_status = 'pending'
     and id = coalesce((select o.booking_id from private.payment_orders o where o.order_id = $1), (select id from public.bookings where razorpay_order_id = $1));
end $$;

/** Claim extra payments to refund (a claim expires after 15 minutes). */
create or replace function public.extra_refunds_claim(lim int default 20) returns jsonb
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare out jsonb;
begin
  with c as (
    select payment_id from private.extra_payments
     where status = 'pending' and attempts < 5 and (claimed_at is null or claimed_at < now() - interval '15 minutes')
     order by created_at limit greatest(1, least(lim, 50)) for update skip locked
  ), u as (
    update private.extra_payments e set claim_token = gen_random_uuid(), claimed_at = now(), attempts = e.attempts + 1 from c
     where e.payment_id = c.payment_id returning e.payment_id, e.booking_id, e.amount_paise, e.claim_token, e.attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object('paymentId', u.payment_id, 'bookingId', u.booking_id, 'ref', b.ref, 'amountPaise', u.amount_paise, 'token', u.claim_token, 'attempt', u.attempts)), '[]')
    into out from u join public.bookings b on b.id = u.booking_id;
  return out;
end $$;

/** Result of refunding an extra payment (from `refunds`; or Razorpay's webhook with token null). */
create or replace function public.extra_refunds_report(pid text, token uuid, ok boolean, provider_id text, err text default null) returns void
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
begin
  if ok then
    update private.extra_payments set status = 'processed', provider_id = coalesce($4, provider_id), claim_token = null, last_error = null
     where payment_id = $1 and ($2 is null or claim_token = $2);
  else
    update private.extra_payments set status = case when attempts >= 5 then 'failed' else 'pending' end, claim_token = null, claimed_at = null, last_error = left($5, 300)
     where payment_id = $1 and ($2 is null or claim_token = $2);
    perform private.notify_staff('other', 'Refund of a second payment (' || $1 || ') failed: ' || left(coalesce($5, 'unknown error'), 120) || '. It will be retried.', null::jsonb)
      where exists (select 1 from private.extra_payments where payment_id = $1 and status = 'failed');
  end if;
end $$;

/** Razorpay's refund.failed webhook: a booking refund or an extra-payment refund. */
create or replace function public.refunds_failed_by_provider(provider_id text, err text) returns void
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare bid uuid; pid text;
begin
  select id into bid from public.bookings where refund_provider_id = $1;
  if bid is not null then perform public.refunds_report(bid, null, false, $1, $2); return; end if;
  select payment_id into pid from private.extra_payments where provider_id = $1;
  if pid is not null then perform public.extra_refunds_report(pid, null, false, $1, $2); end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array['pay_prepare(uuid, uuid)', 'pay_set_order(uuid, text, bigint)', 'pay_set_order(uuid, text)', 'pay_confirm(text, text, bigint)', 'pay_failed(text)',
                           'extra_refunds_claim(int)', 'extra_refunds_report(text, uuid, boolean, text, text)', 'refunds_failed_by_provider(text, text)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- Refund sender runs while either kind of refund is waiting.
select cron.unschedule('send-refunds') where exists (select 1 from cron.job where jobname = 'send-refunds');
select cron.schedule('send-refunds', '*/2 * * * *', $cron$
  select net.http_post(url := 'https://mhovyhapzhxcmcuelbol.supabase.co/functions/v1/refunds', body := '{}'::jsonb, headers := '{"Content-Type":"application/json"}'::jsonb)
   where exists (select 1 from public.bookings where refund_status = 'pending' and payment_mode = 'razorpay')
      or exists (select 1 from private.extra_payments where status = 'pending')
$cron$);
