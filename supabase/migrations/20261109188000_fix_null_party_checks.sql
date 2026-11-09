-- NULL-safe party checks: while no companion is assigned, companion_id = me is
-- NULL, and NOT(... OR NULL) let strangers read or cancel a booking.

create or replace function public.get_booking(bid uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare b public.bookings; uid uuid := (select auth.uid());
begin
  select * into b from public.bookings where id = bid;
  if not found or uid is null or not (b.requester_id is not distinct from uid or b.companion_id is not distinct from uid
      or exists (select 1 from public.booking_offers o where o.booking_id = bid and o.companion_id = uid))
  then perform private.fail('Booking not found.'); end if;
  return private.booking_json(b, uid);
end $$;

create or replace function public.cancel_booking(bid uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid()); b public.bookings; is_req boolean; is_comp boolean; mins numeric;
  fee numeric := (private.pricing() ->> 'cancellationFee')::numeric; cutoff int := (private.pricing() ->> 'cancellationCutoffMinutes')::int;
  amt numeric := 0; r text := 'none'; msg text;
begin
  select * into b from public.bookings where id = bid for update;
  if not found or uid is null then perform private.fail('Booking not found.'); end if;
  is_req := b.requester_id is not distinct from uid; is_comp := b.companion_id is not distinct from uid;
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

create or replace function public.open_dispute(bid uuid, reason text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); b public.bookings;
begin
  if char_length(trim(coalesce(reason, ''))) < 10 then perform private.fail('Tell us a little more (at least 10 characters).'); end if;
  select * into b from public.bookings where id = bid;
  if not found or uid is null or not (b.requester_id is not distinct from uid or b.companion_id is not distinct from uid) then perform private.fail('Booking not found.'); end if;
  if b.payment_status = 'pending' then perform private.fail('Nothing was paid for this booking yet.'); end if;
  if b.dispute_status = 'open' then return jsonb_build_object('message', 'We already have your report and will be in touch.', 'booking', private.booking_json(b, uid)); end if;
  update public.bookings set dispute_status = 'open', dispute_reason = left(trim(reason), 1000), dispute_opened_by = uid, dispute_opened_at = now()
   where id = bid returning * into b;
  perform private.notify(uid, 'dispute', 'We received your report for booking #' || b.ref || '. Our team will contact you.');
  return jsonb_build_object('message', 'Thanks — our team will review this and contact you.', 'booking', private.booking_json(b, uid));
end $$;
