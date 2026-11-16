-- A full refund on a booking that is still open (pending or accepted) also cancels it, so nobody can
-- accept, meet or be paid for a booking whose money has gone back. It goes through
-- admin_cancel_booking, which withdraws open offers, notifies both people and logs the cancellation.
-- Partial refunds (e.g. ₹200 back for a late start) leave the booking as it is.
create or replace function public.admin_refund(bid uuid, amount numeric, reason text default 'Refund by prsnn support') returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare b public.bookings; res text; why text := coalesce(nullif(trim(reason), ''), 'Refund by prsnn support'); out jsonb;
begin
  perform private.need_super();
  select * into b from public.bookings where id = bid for update;
  if not found then perform private.fail('Booking not found.'); end if;
  if b.refund_status in ('pending', 'processed') then perform private.fail('A refund has already been issued for this booking.'); end if;
  if b.payment_status <> 'paid' then perform private.fail('Only a paid booking can be refunded.'); end if;
  if amount is null or amount <= 0 or amount > b.amount_paid then perform private.fail('Refund must be more than ₹0 and at most ₹' || b.amount_paid::int || '.'); end if;

  if amount = b.amount_paid and b.status in ('pending', 'accepted') then
    out := public.admin_cancel_booking(bid, 'Full refund: ' || why, amount);
    return out || jsonb_build_object('cancelled', true, 'message', 'Full refund: booking #' || b.ref || ' cancelled. ' || (out ->> 'message'));
  end if;

  res := private.refund(bid, amount, why);
  update public.bookings set refund_retained = amount_paid - amount, refund_review_needed = false where id = bid returning * into b;
  perform private.notify(b.requester_id, 'refund', 'Refund of ₹' || amount::int || ' started for booking #' || b.ref || '.');
  perform private.audit('booking.refund', 'booking', bid::text, jsonb_build_object('refundStatus', 'none'), jsonb_build_object('amount', amount, 'reason', reason, 'result', res));
  return jsonb_build_object('message', 'Refund of ₹' || amount::int || ' ' || res || '.', 'result', res, 'booking', private.admin_booking_json(b));
end $function$;

-- Fix: "Cancel booking" with a refund amount failed ("column reference refund_amount is ambiguous": the
-- parameter has the same name as the bookings column). The parameter is now referred to by position.
create or replace function public.admin_cancel_booking(bid uuid, reason text, refund_amount numeric default null) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare r public.user_role := private.need_staff(); b public.bookings; res text := 'none'; amt numeric := $3;
begin
  if char_length(trim(coalesce(reason, ''))) < 3 then perform private.fail('Give a short reason.'); end if;
  if amt is not null and r <> 'superadmin' then perform private.fail('Only a superadmin can refund.'); end if;
  select * into b from public.bookings where id = bid for update;
  if not found then perform private.fail('Booking not found.'); end if;
  if b.status not in ('pending', 'accepted') then perform private.fail('This booking is already closed.'); end if;
  if amt is not null and (amt < 0 or amt > case when b.payment_status = 'paid' then b.amount_paid else 0 end) then
    perform private.fail('Refund must be between ₹0 and ₹' || case when b.payment_status = 'paid' then b.amount_paid::int else 0 end || '.');
  end if;
  update public.bookings set status = 'cancelled', alloc_state = case when alloc_state is not null then 'cancelled'::public.alloc_state end,
         cancelled_by = 'admin', cancel_reason = left(reason, 200), cancelled_at = now()
   where id = bid returning * into b;
  update public.booking_offers set status = 'withdrawn' where booking_id = bid and status = 'offered';
  if b.payment_status = 'paid' then
    if amt is not null then
      if amt > 0 then res := private.refund(bid, amt, left('Admin cancelled: ' || reason, 200)); end if;
      update public.bookings x set refund_retained = x.amount_paid - amt, refund_review_needed = false where x.id = bid;
    else
      update public.bookings set refund_review_needed = true, refund_review_note = left(reason, 200), refund_review_by = (select auth.uid()), refund_review_at = now() where id = bid;
    end if;
  end if;
  perform private.notify(b.requester_id, 'booking_cancelled', 'Booking #' || b.ref || ' was cancelled by prsnn support.' ||
    case when coalesce(amt, 0) > 0 then ' ₹' || amt::int || ' is being refunded.' when b.payment_status = 'paid' then ' We’ll update you about the refund.' else '' end);
  perform private.notify(b.companion_id, 'booking_cancelled', 'Booking #' || b.ref || ' was cancelled by prsnn support.');
  perform private.audit('booking.cancel', 'booking', bid::text, '{"status":"open"}', jsonb_build_object('status', 'cancelled', 'reason', reason, 'refundAmount', amt, 'refund', res));
  select * into b from public.bookings where id = bid;
  return jsonb_build_object('message', case when b.payment_status = 'paid' and amt is null then 'Cancelled. A superadmin will decide the refund.'
    when coalesce(amt, 0) > 0 then 'Cancelled. ₹' || amt::int || ' refund ' || res || '.' else 'Cancelled.' end, 'booking', private.admin_booking_json(b));
end $function$;
