-- Tell every admin the moment a member pays for a booking (real Razorpay payments only):
--   • an in-app notification + push to every staff account, at once;
--   • a WhatsApp utility message (template `prsnn_admin_booking_paid`, secret WAPLIFY_TPL_ADMIN_BOOKING_PAID)
--     to every admin number, once private.config 'admin_paid_whatsapp' is 'on' (switch it on after Meta
--     approves the template, so nothing queues up and fails before then).
insert into private.config values ('admin_paid_whatsapp', 'off') on conflict (key) do nothing;

create or replace function private.alert_admins_paid() returns trigger language plpgsql security definer set search_path = '' as $$
declare m public.profiles; c public.profiles; vals jsonb; ends text; place text; kind text; amt text;
begin
  if new.payment_status <> 'paid' or old.payment_status = 'paid' or coalesce(new.payment_mode, '') <> 'razorpay' then return null; end if;
  select * into m from public.profiles where id = new.requester_id;
  select * into c from public.profiles where id = coalesce(new.companion_id, new.preferred_companion_id);
  ends := private.fmt_time(to_char(('2000-01-01 ' || new.start_time)::timestamp + make_interval(mins => new.duration_min), 'HH24:MI'));
  place := coalesce(nullif(new.meeting_place, ''), 'not given') || coalesce(', ' || nullif(new.area, ''), '') || coalesce(', ' || nullif(new.city, ''), '')
           || case when new.home_visit then ' (home visit)' else '' end;
  kind := (new.duration_min / 60) || case when new.duration_min = 60 then ' hour' else ' hours' end || coalesce(' · ' || case new.category
            when 'new_in_town' then 'New in Town' when 'dont_go_alone' then 'Don''t Go Alone' when 'explore' then 'Explore & Discover'
            when 'loved_one' then 'Companion for a Loved One' when 'work_study' then 'Work & Study Together' else nullif(new.category, '') end, '');
  amt := trim(to_char(coalesce(new.amount_paid, new.package_price), 'FM9,99,99,990'));
  vals := jsonb_build_array(
    'prsnn',
    coalesce(nullif(m.full_name, ''), 'A member'),
    amt,
    '#' || new.ref,
    coalesce(nullif(c.full_name, ''), 'a companion'),
    to_char(new.scheduled_date, 'Dy DD Mon YYYY'),
    private.fmt_time(new.start_time) || ' – ' || ends,
    kind,
    place);
  perform private.notify_staff('payment_completed',
    'New paid booking #' || new.ref || ': ' || (vals ->> 1) || ' paid ₹' || amt || ' for ' || kind || ' with ' || (vals ->> 4) || ', ' || (vals ->> 5) || ', ' || (vals ->> 6) || ' at ' || place || '.',
    jsonb_build_object('kind', 'booking', 'bookingId', new.id));
  if private.cfg('admin_paid_whatsapp') = 'on' then
    insert into private.whatsapp_outbox (phone, template_env, body) select ph, 'WAPLIFY_TPL_ADMIN_BOOKING_PAID', vals from private.staff_phones() ph;
  end if;
  return null;
end $$;

drop trigger if exists bookings_alert_admins_paid on public.bookings;
create trigger bookings_alert_admins_paid after update of payment_status on public.bookings for each row execute function private.alert_admins_paid();
