-- The companion marks a confirmed session done once it has started.
create function public.complete_booking(bid uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.bookings; uid uuid := (select auth.uid());
begin
  select * into b from public.bookings where id = bid and companion_id = uid;
  if not found then perform private.fail('Booking not found.'); end if;
  if b.status <> 'accepted' then perform private.fail('Only a confirmed booking can be completed.'); end if;
  if private.session_start(b.scheduled_date, b.start_time) > now() then perform private.fail('You can mark it completed once the session has started.'); end if;
  update public.bookings set status = 'completed' where id = bid returning * into b;
  return jsonb_build_object('message', 'Marked completed.', 'booking', private.booking_json(b, uid));
end $$;
revoke execute on function public.complete_booking(uuid) from public, anon;
grant execute on function public.complete_booking(uuid) to authenticated;
