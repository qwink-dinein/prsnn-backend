-- Round 3 (5): panic alerts name the activity ("Don't Go Alone"), not its key.
-- Same function as 20261114120300 with the label mapping; kept separate because
-- 120300 was already applied.
create or replace function private.panic_send(aid uuid) returns void language plpgsql security definer set search_path = '' as $$
declare a public.panic_alerts; b public.bookings; m public.profiles; c public.profiles; who text; place text; vals jsonb; ends text; sess text; alert text;
begin
  select * into a from public.panic_alerts where id = aid and resolved_at is null for update;
  if not found then return; end if;
  select * into b from public.bookings where id = a.booking_id;
  select * into m from public.profiles where id = b.requester_id;
  select * into c from public.profiles where id = b.companion_id;
  who := case when a.raised_role = 'member' then coalesce(nullif(m.full_name, ''), 'The member') || ' (member)' else coalesce(nullif(c.full_name, ''), 'The companion') || ' (companion)' end;
  ends := private.fmt_time(to_char(('2000-01-01 ' || b.start_time)::timestamp + make_interval(mins => b.duration_min), 'HH24:MI'));
  place := coalesce(nullif(b.meeting_place, ''), 'not given') || coalesce(', ' || nullif(b.area, ''), '') || coalesce(', ' || nullif(b.city, ''), '')
           || case when b.recipient_name is not null then ' — meeting ' || b.recipient_name || ' (' || coalesce(b.recipient_relation, 'other') || ', ' || private.fmt_phone(b.recipient_phone) || ')' else '' end;
  sess := (b.duration_min / 60) || case when b.duration_min = 60 then ' hour' else ' hours' end || coalesce(' · ' || case b.category when 'new_in_town' then 'New in Town' when 'dont_go_alone' then 'Don''t Go Alone'
             when 'explore' then 'Explore & Discover' when 'loved_one' then 'Companion for a Loved One' when 'work_study' then 'Work & Study Together'
             else nullif(b.category, '') end, '');
  alert := 'Alert ' || (a.sends + 1) || ', first pressed at ' || ltrim(to_char(a.raised_at at time zone 'Asia/Kolkata', 'HH12:MI AM'), '0');
  vals := jsonb_build_array('prsnn', who, '#' || b.ref, to_char(b.scheduled_date, 'Dy DD Mon YYYY'), private.fmt_time(b.start_time) || ' – ' || ends,
            coalesce(nullif(m.full_name, ''), 'Member'), private.fmt_phone(coalesce(m.phone, regexp_replace(m.contact_phone, '\D', '', 'g'))),
            coalesce(nullif(c.full_name, ''), 'Companion'), private.fmt_phone(coalesce(c.phone, regexp_replace(c.contact_phone, '\D', '', 'g'))), place, sess, alert);
  insert into private.whatsapp_outbox (phone, template_env, body) select ph, 'WAPLIFY_TPL_PANIC_ALERT', vals from private.staff_phones() ph;
  perform private.notify_staff('panic', 'PANIC #' || b.ref || ' (' || alert || '): ' || who || ' pressed the panic button. ' || (vals ->> 3) || ', ' || (vals ->> 4) || ' (' || sess || ') at ' || place
    || '. Member ' || (vals ->> 5) || ' ' || (vals ->> 6) || ' · Companion ' || (vals ->> 7) || ' ' || (vals ->> 8) || '.',
    jsonb_build_object('kind', 'panic', 'alertId', a.id, 'bookingId', b.id));
  update public.panic_alerts set sends = sends + 1, last_sent_at = now() where id = aid;
end $$;
