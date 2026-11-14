-- Round 3 (2/4): WhatsApp goes to the right side of a booking only.
-- claim_notifications now says whether the recipient is the booking's member
-- (`toRequester`), so the notify function sends:
--   booking_offer      → the companion only (never the member who booked)
--   booking_confirmed  → the member only (a companion's own "confirmed" note stays push/in-app)
--   session_reminder   → both (one row each)
-- and carries the meeting place for the reminder template.
create or replace function public.claim_notifications() returns jsonb language plpgsql security definer set search_path = '' as $$
declare out jsonb;
begin
  with c as (
    update public.notifications n set pushed_at = now()
     where n.id in (select id from public.notifications where pushed_at is null and created_at > now() - interval '1 day' order by created_at limit 200 for update skip locked)
    returning n.*)
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'type', c.type, 'message', c.message, 'pushToken', u.push_token, 'phone', coalesce(u.phone, nullif(regexp_replace(coalesce(u.contact_phone, ''), '\D', '', 'g'), '')),
    'name', private.first_name(u.full_name),
    'toRequester', b.id is not null and b.requester_id = c.user_id,
    'booking', case when b.id is not null then jsonb_build_object('ref', b.ref, 'date', b.scheduled_date, 'startTime', b.start_time, 'duration', b.duration_min,
      'amount', b.amount_paid, 'refund', b.refund_amount, 'failed', b.alloc_state = 'failed',
      'requester', private.first_name(rq.full_name), 'companion', private.first_name(cp.full_name),
      'place', concat_ws(', ', nullif(b.meeting_place, ''), nullif(b.area, ''), nullif(b.city, ''))) end)), '[]')
  into out
  from c join public.profiles u on u.id = c.user_id
  left join public.bookings b on b.id = c.booking_id
  left join public.profiles rq on rq.id = b.requester_id
  left join public.profiles cp on cp.id = coalesce(b.companion_id, case when c.type = 'booking_offer' then c.user_id end);
  return out;
end $$;
revoke execute on function public.claim_notifications() from public, anon, authenticated;
grant execute on function public.claim_notifications() to service_role;
