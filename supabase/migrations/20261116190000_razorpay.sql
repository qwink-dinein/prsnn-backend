-- Real payments with Razorpay. The edge functions `payments` (create order, verify), `razorpay-webhook`
-- (Razorpay's server-to-server events) and `refunds` (sends queued refunds) call these functions with the
-- service role; nobody else can. The Razorpay key secret and webhook secret live only in edge-function
-- secrets. private.config 'payment_mode' stays 'simulated' until the owner switches it to 'razorpay'.

alter table public.bookings add column if not exists refund_claim_token uuid;
alter table public.bookings add column if not exists refund_claimed_at timestamptz;
create unique index if not exists bookings_razorpay_order on public.bookings (razorpay_order_id) where razorpay_order_id is not null;

/** Is this booking payable by this member right now? Returns the amount in paise (from the database, never the app). */
create or replace function public.pay_prepare(bid uuid, uid uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.bookings;
begin
  if private.cfg('payment_mode') <> 'razorpay' then perform private.fail('Online payments are not switched on.'); end if;
  select * into b from public.bookings where id = bid and requester_id = uid for update;
  if not found then perform private.fail('Booking not found.'); end if;
  if b.payment_status = 'paid' then perform private.fail('This booking is already paid.'); end if;
  if b.alloc_state <> 'awaiting_payment' or b.payment_deadline < now() then perform private.fail('This booking can no longer be paid. Please book again.'); end if;
  return jsonb_build_object('amountPaise', (b.package_price * 100)::bigint, 'ref', b.ref, 'bookingId', b.id);
end $$;

create or replace function public.pay_set_order(bid uuid, order_id text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.bookings set razorpay_order_id = order_id where id = bid and payment_status <> 'paid';
end $$;

/**
 * A captured payment for an order (from the app's verify call or Razorpay's webhook; whichever comes
 * first wins, the other is a no-op). The amount must match the booking's price exactly.
 */
create or replace function public.pay_confirm(order_id text, payment_id text, amount_paise bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare b public.bookings;
begin
  select * into b from public.bookings where razorpay_order_id = order_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'unknown order'); end if;
  if b.payment_status = 'paid' then return jsonb_build_object('ok', true, 'bookingId', b.id, 'already', true); end if;
  if amount_paise <> (b.package_price * 100)::bigint then
    -- Never mark a wrong amount as paid; staff see it in the refunds tab.
    update public.bookings set refund_review_needed = true where id = b.id;
    return jsonb_build_object('ok', false, 'reason', 'amount mismatch', 'bookingId', b.id);
  end if;
  b := private.mark_paid(b.id, payment_id, b.package_price, 'razorpay');
  return jsonb_build_object('ok', true, 'bookingId', b.id);
end $$;

create or replace function public.pay_failed(order_id text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.bookings set payment_status = 'failed' where razorpay_order_id = order_id and payment_status = 'pending';
end $$;

/** Claim queued Razorpay refunds to send (a claim expires after 15 minutes, so nothing is sent twice at once). */
create or replace function public.refunds_claim(lim int default 20) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare out jsonb;
begin
  with c as (
    select id from public.bookings
     where refund_status = 'pending' and payment_mode = 'razorpay' and razorpay_payment_id is not null and refund_amount > 0
       and (refund_claimed_at is null or refund_claimed_at < now() - interval '15 minutes')
     order by refund_requested_at limit greatest(1, least(lim, 50)) for update skip locked
  ), u as (
    update public.bookings b set refund_claim_token = gen_random_uuid(), refund_claimed_at = now() from c where b.id = c.id
    returning b.id, b.ref, b.razorpay_payment_id, b.refund_amount, b.refund_claim_token, b.refund_attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object('bookingId', id, 'ref', ref, 'paymentId', razorpay_payment_id,
           'amountPaise', (refund_amount * 100)::bigint, 'token', refund_claim_token, 'attempt', refund_attempts)), '[]') into out from u;
  return out;
end $$;

/** Result of sending a refund (from `refunds`), or of Razorpay's refund webhook (token null, matched by refund id). */
create or replace function public.refunds_report(bid uuid, token uuid, ok boolean, provider_id text, err text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if ok then
    update public.bookings set refund_status = 'processed', refund_processed_at = now(), refund_provider_id = coalesce(provider_id, refund_provider_id),
           payment_status = 'refunded', refund_claim_token = null
     where id = bid and (token is null or refund_claim_token = token);
  else
    update public.bookings set refund_status = 'failed', refund_claim_token = null, refund_claimed_at = null
     where id = bid and (token is null or refund_claim_token = token);
    perform private.notify(s.id, 'other', 'A refund for booking #' || b.ref || ' failed: ' || left(coalesce(err, 'unknown error'), 120) || '. Retry it from Admin → Bookings → Refunds.')
      from public.bookings b, public.profiles s
     where b.id = bid and s.role in ('subadmin', 'superadmin') and not s.suspended;
  end if;
end $$;

/** Razorpay's refund.failed webhook: match by the refund id we stored. */
create or replace function public.refunds_failed_by_provider(provider_id text, err text) returns void
language plpgsql security definer set search_path = '' as $$
declare bid uuid;
begin
  select id into bid from public.bookings where refund_provider_id = provider_id;
  if bid is not null then perform public.refunds_report(bid, null, false, provider_id, err); end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array['pay_prepare(uuid, uuid)', 'pay_set_order(uuid, text)', 'pay_confirm(text, text, bigint)', 'pay_failed(text)',
                           'refunds_claim(int)', 'refunds_report(uuid, uuid, boolean, text, text)', 'refunds_failed_by_provider(text, text)'] loop
    execute format('revoke execute on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;

-- Send queued refunds every 2 minutes (only does anything once payment_mode is razorpay and refunds are pending).
select cron.unschedule('send-refunds') where exists (select 1 from cron.job where jobname = 'send-refunds');
select cron.schedule('send-refunds', '*/2 * * * *', $cron$
  select net.http_post(url := 'https://mhovyhapzhxcmcuelbol.supabase.co/functions/v1/refunds', body := '{}'::jsonb, headers := '{"Content-Type":"application/json"}'::jsonb)
   where exists (select 1 from public.bookings where refund_status = 'pending' and payment_mode = 'razorpay')
$cron$);
