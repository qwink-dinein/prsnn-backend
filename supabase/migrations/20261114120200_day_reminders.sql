-- Round 3 (3/4): at 5:00 AM (India time) on the day of a confirmed, paid session, remind
-- both the member and the companion (push + WhatsApp `WAPLIFY_TPL_SESSION_REMINDER`).
-- Sent once per booking (reminder_sent_at). Bookings confirmed after 5 AM that day are
-- skipped: they have just had their confirmation. Runs every 5 minutes, so a sweep that
-- misses 5:00 still sends before the session starts.
create or replace function private.send_day_reminders() returns integer language plpgsql security definer set search_path = '' as $$
declare
  today date := (now() at time zone 'Asia/Kolkata')::date;
  five timestamptz := (today + time '05:00') at time zone 'Asia/Kolkata';
  r record; n integer := 0;
begin
  if now() < five then return 0; end if;
  for r in update public.bookings b set reminder_sent_at = now()
            where b.scheduled_date = today and b.status = 'accepted' and b.payment_status = 'paid'
              and b.companion_id is not null and b.reminder_sent_at is null
              and coalesce(b.assigned_at, b.paid_at, b.created_at) < five
              and private.session_start(b.scheduled_date, b.start_time) > now()
           returning b.id, b.ref, b.requester_id, b.companion_id, b.start_time,
                     concat_ws(', ', nullif(b.meeting_place, ''), nullif(b.area, ''), nullif(b.city, '')) place loop
    insert into public.notifications (user_id, type, message, booking_id)
    select x.uid, 'session_reminder', 'Your session with ' || coalesce(private.first_name(o.full_name), 'your ' || x.other) || ' is today at ' || private.fmt_time(r.start_time)
             || coalesce(' at ' || nullif(r.place, ''), '') || ' (booking #' || r.ref || '). Please be there on time.', r.id
      from (values (r.requester_id, r.companion_id, 'companion'), (r.companion_id, r.requester_id, 'member')) x(uid, oid, other)
      left join public.profiles o on o.id = x.oid;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function private.send_day_reminders() from public, anon, authenticated;

select cron.schedule('prsnn-day-reminders', '*/5 * * * *', 'select private.send_day_reminders()');
