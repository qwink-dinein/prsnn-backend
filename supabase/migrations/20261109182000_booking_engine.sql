-- Prepaid booking engine: create → pay → sequential offers (max 3) → atomic
-- accept → or fail + full refund. Cancellation policy, disputes, chat masking,
-- and the 30-second sweeper (pg_cron). Ported from services/allocation.js.

-- ───────── Refunds (claimed atomically; never twice) ─────────
-- Simulated payments are refunded at once. Razorpay refunds are left 'pending'
-- for the payments edge function to send (it retries 'failed' ones).
create function private.refund(bid uuid, amount numeric, reason text) returns text language plpgsql security definer set search_path = '' as $$
declare b public.bookings; amt numeric := greatest(0, round(amount, 2));
begin
  update public.bookings set refund_status = 'pending', refund_amount = amt, refund_reason = left(reason, 200),
         refund_requested_at = now(), refund_attempts = refund_attempts + 1
   where id = bid and payment_status = 'paid' and (refund_status = 'none' or (refund_status = 'failed' and refund_attempts < 5))
  returning * into b;
  if not found then return 'skipped'; end if;
  if amt <= 0 then
    update public.bookings set refund_status = 'processed', refund_processed_at = now() where id = bid;
    return 'processed';
  end if;
  if b.payment_mode = 'simulated' then
    update public.bookings set refund_status = 'processed', refund_processed_at = now(), refund_provider_id = 'sim_rfnd_' || extract(epoch from now())::bigint, payment_status = 'refunded' where id = bid;
    return 'processed';
  end if;
  return 'pending';
end $$;

-- ───────── Allocation ─────────
create function private.has_conflict(cid uuid, b public.bookings) returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.bookings o
     where o.id <> b.id and o.scheduled_date = b.scheduled_date
       and (o.companion_id = cid and o.status = 'accepted'
            or exists (select 1 from public.booking_offers f where f.booking_id = o.id and f.companion_id = cid and f.status = 'offered' and f.expires_at > now()))
       and private.session_start(o.scheduled_date, o.start_time) < private.session_end(b.scheduled_date, b.start_time, b.duration_min)
       and private.session_start(b.scheduled_date, b.start_time) < private.session_end(o.scheduled_date, o.start_time, o.duration_min))
$$;

create function private.eligible(c public.profiles, b public.bookings, see public.see_gender) returns boolean language sql stable set search_path = '' as $$
  select c.role = 'companion' and c.verification_status = 'verified' and not c.suspended
     and c.id is distinct from b.requester_id
     and private.sees(see, c.gender)
     and (b.city is null or lower(c.city) = lower(b.city))
     and private.available_at(c, b.scheduled_date, b.start_time)
     and (b.duration_min / 60) = any (private.offered_hours(c))
     and not exists (select 1 from public.booking_offers o where o.booking_id = b.id and o.companion_id = c.id)
     and not private.has_conflict(c.id, b)
$$;

create function private.fail_allocation(bid uuid, why text) returns void language plpgsql security definer set search_path = '' as $$
declare b public.bookings;
begin
  update public.bookings set alloc_state = 'failed', status = 'cancelled', cancelled_by = 'system', cancel_reason = why,
         cancelled_at = now(), failed_reason = why
   where id = bid and alloc_state = 'offering' returning * into b;
  if not found then return; end if;
  update public.booking_offers set status = 'withdrawn' where booking_id = bid and status = 'offered';
  perform private.refund(bid, b.amount_paid, 'No companion accepted');
  perform private.notify(b.requester_id, 'refund', 'We couldn’t find an available companion for booking #' || b.ref || '. Your full payment of ₹' || b.amount_paid::int || ' is being refunded.');
end $$;

-- Offer the booking to the next eligible companion (the chosen one first).
create function private.next_offer(bid uuid) returns void language plpgsql security definer set search_path = '' as $$
declare
  b public.bookings; see public.see_gender; tried int; nxt public.profiles; win interval; p jsonb := private.pricing();
  max_offers int := private.cfg('max_offers')::int;
begin
  select * into b from public.bookings where id = bid for update;
  if not found or b.alloc_state <> 'offering' then return; end if;
  if exists (select 1 from public.booking_offers where booking_id = bid and status = 'offered' and expires_at > now()) then return; end if;
  select count(*) into tried from public.booking_offers where booking_id = bid;
  if tried >= max_offers or now() >= b.alloc_deadline then perform private.fail_allocation(bid, 'no_one_accepted_in_time'); return; end if;
  select see_gender into see from public.profiles where id = b.requester_id;

  if tried = 0 then select * into nxt from public.profiles c where c.id = b.preferred_companion_id and private.eligible(c, b, see); end if;
  if nxt.id is null then
    select c.* into nxt from public.profiles c
     where c.role = 'companion' and private.eligible(c, b, see)
     order by (case when b.area is not null and lower(c.area) = lower(b.area) then 2 else 0 end
             + case when b.experience is not null and lower(b.experience) = any (array(select lower(t) from unnest(c.tags) t)) then 1 else 0 end) desc,
              c.created_at
     limit 1;
  end if;
  if nxt.id is null then perform private.fail_allocation(bid, 'no_eligible_companion'); return; end if;

  -- Each window: an equal share of the time left before the deadline, within the admin's bounds.
  win := least(make_interval(mins => (p ->> 'offerMaxMinutes')::int),
               greatest(make_interval(mins => (p ->> 'offerMinMinutes')::int), (b.alloc_deadline - now()) / max_offers));
  insert into public.booking_offers (booking_id, companion_id, expires_at) values (bid, nxt.id, least(now() + win, b.alloc_deadline));
  perform private.notify(nxt.id, 'booking_offer', 'New paid ' || (b.duration_min / 60) || '-hour booking (you earn ₹' ||
    floor(b.amount_paid * (1 - (p ->> 'platformShare')::numeric))::int || '). Accept within ' ||
    case when win >= interval '1 hour' then round(extract(epoch from win) / 3600, 1) || ' h' else round(extract(epoch from win) / 60) || ' min' end || ' or it goes to someone else.');
end $$;

-- Payment confirmed (simulated, Razorpay verify or webhook). Applied once.
create function private.mark_paid(bid uuid, payment_id text, amount numeric, mode text) returns public.bookings language plpgsql security definer set search_path = '' as $$
declare b public.bookings;
begin
  update public.bookings set payment_status = 'paid', payment_mode = mode, razorpay_payment_id = payment_id, amount_paid = amount, paid_at = now()
   where id = bid and payment_status <> 'paid' returning * into b;
  if not found then select * into b from public.bookings where id = bid; return b; end if;
  update public.bookings set alloc_state = 'offering', alloc_deadline = private.session_start(scheduled_date, start_time) - interval '1 hour'
   where id = bid and alloc_state = 'awaiting_payment' returning * into b;
  if found then
    perform private.notify(b.requester_id, 'payment_completed', 'Payment received for booking #' || b.ref || '. We’re confirming your companion.');
    perform private.next_offer(bid);
  else
    -- Paid after the booking lapsed or was cancelled: give the money back.
    perform private.refund(bid, amount, 'Paid after the booking closed');
  end if;
  select * into b from public.bookings where id = bid;
  return b;
end $$;

-- ───────── Client entry points ─────────
create function public.create_prepaid_booking(p jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid()); me public.profiles; c public.profiles; b public.bookings;
  hrs int; dur int; d date; t text := p ->> 'startTime'; price int; k text := p ->> 'idempotencyKey';
begin
  if uid is null then perform private.fail('Please log in.'); end if;
  if k is null or char_length(k) not between 8 and 100 then perform private.fail('Missing booking key. Please try again.'); end if;
  select * into b from public.bookings where requester_id = uid and idempotency_key = k;
  if found then return jsonb_build_object('booking', private.booking_json(b, uid), 'replayed', true, 'policy', public.booking_policy(),
    'quote', jsonb_build_object('currency', 'INR', 'amount', b.package_price, 'fees', 0, 'hours', b.duration_min / 60, 'effectiveHourly', round(b.package_price::numeric / (b.duration_min / 60)), 'pricePerHour', b.price_per_hour, 'duration', b.duration_min::text)); end if;
  if coalesce((p ->> 'acceptTerms')::boolean, false) is not true then perform private.fail('Please accept the cancellation and refund terms.'); end if;
  begin d := (p ->> 'scheduledDate')::date; exception when others then perform private.fail('Invalid date or time.'); end;
  if t is null or t !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then perform private.fail('Invalid date or time.'); end if;
  dur := (p ->> 'duration')::int; hrs := dur / 60;
  price := private.price_for(hrs);
  if dur % 60 <> 0 or price is null then perform private.fail('Choose a duration between 1 and 12 hours.'); end if;
  select * into me from public.profiles where id = uid;
  if me.suspended then perform private.fail('This account is suspended.'); end if;
  select * into c from public.profiles where id = (p ->> 'companionId')::uuid;
  if c.id is null or c.role <> 'companion' or c.verification_status <> 'verified' or c.suspended or not private.sees(me.see_gender, c.gender) then perform private.fail('Companion not found.'); end if;
  if c.id = uid then perform private.fail('You cannot book yourself.'); end if;
  if not hrs = any (private.offered_hours(c)) then perform private.fail('This companion doesn’t offer ' || hrs || '-hour bookings.'); end if;
  if not private.within_day(t, dur) then perform private.fail('Sessions must start at or after ' || (private.pricing() ->> 'dayStart') || ' and finish by ' || (private.pricing() ->> 'dayEnd') || '.'); end if;
  if not private.available_at(c, d, t) then perform private.fail('This companion isn’t available at that day and time.'); end if;
  if private.session_start(d, t) - now() < interval '90 minutes' then perform private.fail('Please choose a time at least 90 minutes from now, so we can confirm your companion.'); end if;
  insert into public.bookings (requester_id, preferred_companion_id, idempotency_key, scheduled_date, start_time, duration_min, package_price,
                               message, experience, city, area, alloc_state, payment_deadline)
  values (uid, c.id, k, d, t, dur, price, left(coalesce(p ->> 'message', ''), 300), left(p ->> 'experience', 40),
          coalesce(nullif(p ->> 'city', ''), c.city, me.city), coalesce(nullif(p ->> 'area', ''), c.area),
          'awaiting_payment', now() + interval '30 minutes')
  on conflict (requester_id, idempotency_key) do nothing
  returning * into b;
  if not found then select * into b from public.bookings where requester_id = uid and idempotency_key = k; end if;
  return jsonb_build_object('booking', private.booking_json(b, uid), 'policy', public.booking_policy(),
    'quote', jsonb_build_object('currency', 'INR', 'amount', price, 'fees', 0, 'hours', hrs, 'effectiveHourly', round(price::numeric / hrs), 'pricePerHour', 399, 'duration', dur::text));
end $$;

-- Test checkout while payment_mode = 'simulated'. No money moves.
create function public.simulate_payment(bid uuid, outcome text default 'success') returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.bookings; uid uuid := (select auth.uid());
begin
  if private.cfg('payment_mode') <> 'simulated' then perform private.fail('Test payments are off on this server.'); end if;
  select * into b from public.bookings where id = bid and requester_id = uid;
  if not found then perform private.fail('Booking not found.'); end if;
  if b.payment_status = 'paid' then return jsonb_build_object('message', 'Already paid.', 'booking', private.booking_json(b, uid)); end if;
  if b.alloc_state <> 'awaiting_payment' or b.payment_deadline < now() then perform private.fail('This booking can no longer be paid. Please book again.'); end if;
  if outcome = 'failure' then return jsonb_build_object('message', 'Payment failed (test). Nothing was charged.', 'failed', true, 'booking', private.booking_json(b, uid)); end if;
  b := private.mark_paid(bid, 'sim_pay_' || extract(epoch from now())::bigint, b.package_price, 'simulated');
  return jsonb_build_object('message', 'Payment received (test).', 'booking', private.booking_json(b, uid));
end $$;

create function public.payment_mode() returns text language sql stable security definer set search_path = '' as $$ select private.cfg('payment_mode') $$;

create function public.accept_offer(bid uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); b public.bookings; share numeric := (private.pricing() ->> 'platformShare')::numeric;
begin
  select * into b from public.bookings where id = bid for update;
  if not found then perform private.fail('Booking not found.'); end if;
  if exists (select 1 from public.bookings x where x.companion_id = uid and x.status = 'accepted' and x.id <> bid
        and private.session_start(x.scheduled_date, x.start_time) < private.session_end(b.scheduled_date, b.start_time, b.duration_min)
        and private.session_start(b.scheduled_date, b.start_time) < private.session_end(x.scheduled_date, x.start_time, x.duration_min)) then
    perform private.fail('You already have a booking at that time.');
  end if;
  update public.booking_offers set status = 'accepted', responded_at = now()
   where booking_id = bid and companion_id = uid and status = 'offered' and expires_at > now();
  if not found then perform private.fail('This offer has expired or was already taken.'); end if;
  update public.bookings set companion_id = uid, status = 'accepted', alloc_state = 'assigned', assigned_at = now(),
         companion_share = floor(amount_paid * (1 - share))
   where id = bid and alloc_state = 'offering' returning * into b;
  if not found then perform private.fail('This offer has expired or was already taken.'); end if;
  update public.booking_offers set status = 'withdrawn' where booking_id = bid and status = 'offered';
  perform private.notify(b.requester_id, 'booking_confirmed', (select private.first_name(full_name) from public.profiles where id = uid) || ' confirmed your booking #' || b.ref || '. Chat is open.');
  return jsonb_build_object('message', 'Booking confirmed. Chat is open.', 'booking', private.booking_json(b, uid));
end $$;

create function public.decline_offer(bid uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  update public.booking_offers set status = 'declined', responded_at = now()
   where booking_id = bid and companion_id = (select auth.uid()) and status = 'offered';
  if not found then perform private.fail('This offer is no longer open.'); end if;
  perform private.next_offer(bid);
  return jsonb_build_object('message', 'Declined. We’ll offer it to someone else.');
end $$;

-- Published policy: customer ≥ cutoff before start → (1 − fee) back; later → nothing;
-- companion → 100%; before payment → nothing charged.
create function public.cancel_booking(bid uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid()); b public.bookings; is_req boolean; is_comp boolean; mins numeric;
  fee numeric := (private.pricing() ->> 'cancellationFee')::numeric; cutoff int := (private.pricing() ->> 'cancellationCutoffMinutes')::int;
  amt numeric := 0; r text := 'none'; msg text;
begin
  select * into b from public.bookings where id = bid for update;
  if not found then perform private.fail('Booking not found.'); end if;
  is_req := b.requester_id = uid; is_comp := b.companion_id = uid;
  if not is_req and not is_comp then perform private.fail('Not authorized to cancel this booking.'); end if;
  if b.status not in ('pending', 'accepted') or b.alloc_state in ('failed', 'cancelled') then perform private.fail('This booking is already closed.'); end if;
  mins := extract(epoch from private.session_start(b.scheduled_date, b.start_time) - now()) / 60;
  if is_comp and mins <= 0 then perform private.fail('The session has started. Report a problem instead if something went wrong.'); end if;
  update public.bookings set status = 'cancelled', alloc_state = 'cancelled', cancelled_by = case when is_req then 'requester' else 'companion' end,
         cancel_reason = case when is_req then 'cancelled_by_customer' else 'cancelled_by_companion' end, cancelled_at = now()
   where id = bid returning * into b;
  update public.booking_offers set status = 'withdrawn' where booking_id = bid and status = 'offered';
  if b.payment_status = 'paid' then
    if is_comp then amt := b.amount_paid; elsif mins >= cutoff then amt := round(b.amount_paid * (1 - fee)); end if;
    if amt > 0 then
      r := private.refund(bid, amt, case when is_comp then 'Companion cancelled' else 'Customer cancelled ' || floor(mins) || ' min before start' end);
      update public.bookings set refund_retained = b.amount_paid - amt where id = bid;
      perform private.notify(b.requester_id, 'refund', 'Refund of ₹' || amt::int || ' started for booking #' || b.ref || '.');
    end if;
  end if;
  perform private.notify(case when is_req then b.companion_id else b.requester_id end, 'booking_cancelled',
    'Booking #' || b.ref || ' was cancelled by the ' || case when is_req then 'customer' else 'companion' end || '.');
  msg := case when b.payment_status <> 'paid' then 'Cancelled. Nothing was charged.'
              when amt = 0 then 'Cancelled. It was within ' || cutoff || ' minutes of the start, so there’s no refund — report a problem if something went wrong.'
              when amt < b.amount_paid then 'Cancelled. ₹' || amt::int || ' (' || round((1 - fee) * 100) || '%) is being refunded.'
              else 'Cancelled. ₹' || amt::int || ' is being refunded in full.' end;
  select * into b from public.bookings where id = bid;
  return jsonb_build_object('message', msg, 'refund', r, 'refundAmount', amt, 'booking', private.booking_json(b, uid));
end $$;

create function public.open_dispute(bid uuid, reason text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); b public.bookings;
begin
  if char_length(trim(coalesce(reason, ''))) < 10 then perform private.fail('Tell us a little more (at least 10 characters).'); end if;
  select * into b from public.bookings where id = bid;
  if not found or uid not in (b.requester_id, coalesce(b.companion_id, b.requester_id)) then perform private.fail('Booking not found.'); end if;
  if b.payment_status = 'pending' then perform private.fail('Nothing was paid for this booking yet.'); end if;
  if b.dispute_status = 'open' then return jsonb_build_object('message', 'We already have your report and will be in touch.', 'booking', private.booking_json(b, uid)); end if;
  update public.bookings set dispute_status = 'open', dispute_reason = left(trim(reason), 1000), dispute_opened_by = uid, dispute_opened_at = now()
   where id = bid returning * into b;
  perform private.notify(uid, 'dispute', 'We received your report for booking #' || b.ref || '. Our team will contact you.');
  return jsonb_build_object('message', 'Thanks — our team will review this and contact you.', 'booking', private.booking_json(b, uid));
end $$;

-- ───────── Chat: hide phone numbers ─────────
create function private.mask_message() returns trigger language plpgsql set search_path = '' as $$
begin
  new.content := regexp_replace(new.content, '(\+?\d[\d\s\-]{8,}\d)', '••••••••••', 'g');
  new.created_at := now();
  return new;
end $$;
create trigger messages_mask before insert on public.messages for each row execute function private.mask_message();

-- ───────── Sweeper: every 30 s ─────────
create function private.tick() returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  -- Unpaid bookings lapse (nothing charged).
  update public.bookings set alloc_state = 'cancelled', status = 'cancelled', cancelled_by = 'system', cancel_reason = 'payment_timeout', cancelled_at = now()
   where alloc_state = 'awaiting_payment' and payment_deadline < now();
  -- Expired offers → next companion.
  for r in update public.booking_offers set status = 'expired' where status = 'offered' and expires_at <= now() returning booking_id loop
    perform private.next_offer(r.booking_id);
  end loop;
  -- Nobody assigned by the deadline → cancel + full refund.
  for r in select id from public.bookings where alloc_state = 'offering' and alloc_deadline <= now() loop
    perform private.fail_allocation(r.id, 'no_one_accepted_in_time');
  end loop;
  -- Offering with no live offer (e.g. after a decline race) → try the next one.
  for r in select b.id from public.bookings b where b.alloc_state = 'offering'
             and not exists (select 1 from public.booking_offers o where o.booking_id = b.id and o.status = 'offered') loop
    perform private.next_offer(r.id);
  end loop;
  -- Sessions that ended 2 h ago with no open dispute are completed.
  update public.bookings set status = 'completed'
   where status = 'accepted' and dispute_status <> 'open' and private.session_end(scheduled_date, start_time, duration_min) < now() - interval '2 hours';
end $$;
select cron.schedule('prsnn-tick', '30 seconds', $$select private.tick()$$);

-- Realtime for chat and notifications (RLS applies to subscribers).
alter publication supabase_realtime add table public.messages, public.notifications;
