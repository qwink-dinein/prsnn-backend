-- Round 3 checks (WhatsApp audience, 5 AM reminder, panic details). Runs inside one
-- transaction and always rolls back: the final RAISE carries the results.
-- Needs one paid booking from the e2e run (scripts/e2e-supabase.mjs).
do $$
declare
  b public.bookings; out jsonb := '{}'; claimed jsonb; n int; aid uuid; body jsonb; v text;
  today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select * into b from public.bookings where payment_status = 'paid' and companion_id is not null order by created_at desc limit 1;
  if not found then raise exception 'no paid booking to test with'; end if;
  update public.notifications set pushed_at = now() where pushed_at is null;   -- isolate this test's rows

  -- 1. toRequester: the offer row belongs to the companion, the confirmation to the member
  insert into public.notifications (user_id, type, message, booking_id) values
    (b.companion_id, 'booking_offer', 'offer', b.id), (b.requester_id, 'booking_confirmed', 'confirmed', b.id), (b.companion_id, 'booking_confirmed', 'companion confirm', b.id);
  claimed := public.claim_notifications();
  select jsonb_agg(jsonb_build_object('type', x->>'type', 'toRequester', x->'toRequester')) into v from jsonb_array_elements(claimed) x;
  out := out || jsonb_build_object('audience_ok',
    (select bool_and(case when x->>'message' = 'offer' then not (x->>'toRequester')::bool
                          when x->>'message' = 'confirmed' then (x->>'toRequester')::bool
                          when x->>'message' = 'companion confirm' then not (x->>'toRequester')::bool end) from jsonb_array_elements(claimed) x),
    'place_present', (claimed->0->'booking') ? 'place');

  -- 2. 5 AM reminder: a session later today, confirmed yesterday → one row each, sent once
  update public.bookings set scheduled_date = today, start_time = '23:30', status = 'accepted', reminder_sent_at = null,
         assigned_at = now() - interval '1 day' where id = b.id;
  n := private.send_day_reminders();
  out := out || jsonb_build_object('reminder_bookings', n,
    'reminder_rows', (select count(*) from public.notifications where booking_id = b.id and type = 'session_reminder'),
    'reminder_to_both', (select count(distinct user_id) = 2 from public.notifications where booking_id = b.id and type = 'session_reminder'),
    'reminder_again', private.send_day_reminders(),
    'reminder_text', (select message from public.notifications where booking_id = b.id and type = 'session_reminder' limit 1));
  -- confirmed after 5 AM today → no reminder
  update public.bookings set reminder_sent_at = null, assigned_at = now() where id = b.id;
  out := out || jsonb_build_object('late_confirm_skipped', (case when now() >= (today + time '05:00') at time zone 'Asia/Kolkata' then private.send_day_reminders() = 0 else true end));

  -- 3. Panic: 12 values, the session and the alert count included
  insert into public.panic_alerts (booking_id, raised_by, raised_role) values (b.id, b.requester_id, 'member') returning id into aid;
  perform private.panic_send(aid);
  select o.body into body from private.whatsapp_outbox o where o.template_env = 'WAPLIFY_TPL_PANIC_ALERT' order by o.id desc limit 1;
  out := out || jsonb_build_object('panic_vars', jsonb_array_length(body), 'panic_session', body->>10, 'panic_alert', body->>11,
    'panic_member_phone', body->>6 <> 'not given', 'panic_staff_push', (select count(*) > 0 from public.notifications where type = 'panic' and message like 'PANIC #' || b.ref || '%'));
  raise exception 'ROLLBACK %', out;
end $$;
