-- Round 2 · bookings: category, meeting place, booking for someone else.
-- Panic button: on from the session start until 1 hour after it ends; every
-- admin gets WhatsApp + push at once and every 5 minutes until resolved.
-- City plans (admin-managed "Popular in <city>") and the India Post locality list.

alter table public.bookings
  add column if not exists category text check (category is null or category = any (array['new_in_town', 'dont_go_alone', 'explore', 'loved_one', 'work_study'])),
  add column if not exists meeting_place text,
  add column if not exists recipient_relation text,
  add column if not exists recipient_name text,
  add column if not exists recipient_phone text,
  add column if not exists recipient_city text,
  add column if not exists recipient_state text;

-- ───────── Panic button ─────────
create table if not exists public.panic_alerts (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  raised_by uuid references public.profiles (id) on delete set null,
  raised_role text not null check (raised_role in ('member', 'companion')),
  raised_at timestamptz not null default now(),
  sends int not null default 0,
  last_sent_at timestamptz,
  resolved_at timestamptz,
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_note text
);
create index if not exists panic_open on public.panic_alerts (last_sent_at) where resolved_at is null;
alter table public.panic_alerts enable row level security;
create policy "panic read" on public.panic_alerts for select to authenticated using (
  (select public.is_staff()) or exists (select 1 from public.bookings x where x.id = booking_id and (x.requester_id = (select auth.uid()) or x.companion_id = (select auth.uid()))));
alter publication supabase_realtime add table public.panic_alerts;

create or replace function private.booking_json(b public.bookings, viewer uuid) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    '_id', b.id, 'ref', b.ref, 'flow', b.flow,
    'requesterId', coalesce(private.person(b.requester_id, viewer), to_jsonb(b.requester_id)),
    'companionId', private.person(b.companion_id, viewer),
    'preferredCompanionId', private.person(b.preferred_companion_id, viewer),
    'status', b.status, 'paymentStatus', b.payment_status, 'paymentMode', b.payment_mode,
    'amountPaid', b.amount_paid, 'paidAt', b.paid_at, 'pricePerHour', b.price_per_hour, 'packagePrice', b.package_price,
    'companionShare', case when b.companion_id = viewer or (select public.is_superadmin()) then b.companion_share end,
    'startTime', b.start_time, 'duration', b.duration_min::text,
    'scheduledDate', to_char(b.scheduled_date, 'YYYY-MM-DD') || 'T00:00:00.000Z',
    'message', b.message, 'experience', b.experience, 'city', b.city, 'area', b.area,
    'category', b.category, 'meetingPlace', b.meeting_place,
    -- Who the booking is for. The companion sees the name and relation, never the number.
    'recipient', case when b.recipient_name is not null then jsonb_build_object('relation', b.recipient_relation, 'name', b.recipient_name,
       'city', b.recipient_city, 'state', b.recipient_state, 'phone', case when b.requester_id = viewer then b.recipient_phone end) end,
    'allocation', jsonb_build_object('state', b.alloc_state, 'paymentDeadline', b.payment_deadline, 'deadline', b.alloc_deadline, 'assignedAt', b.assigned_at, 'failedReason', b.failed_reason),
    'refund', jsonb_build_object('status', b.refund_status, 'amount', b.refund_amount, 'retained', b.refund_retained, 'reason', b.refund_reason, 'processedAt', b.refund_processed_at),
    'dispute', jsonb_build_object('status', b.dispute_status, 'reason', b.dispute_reason, 'openedAt', b.dispute_opened_at, 'resolution', b.dispute_resolution, 'resolvedAt', b.dispute_resolved_at),
    'cancelledBy', b.cancelled_by, 'cancelReason', b.cancel_reason, 'cancelledAt', b.cancelled_at,
    'createdAt', b.created_at, 'updatedAt', b.updated_at,
    'panic', (select jsonb_build_object('id', a.id, 'raisedAt', a.raised_at, 'mine', a.raised_by = viewer, 'sends', a.sends, 'lastSentAt', a.last_sent_at)
                from public.panic_alerts a where a.booking_id = b.id and a.resolved_at is null order by a.raised_at desc limit 1),
    'offerSummary', case when b.requester_id = viewer then (select jsonb_build_object('tried', count(*), 'liveUntil', max(o.expires_at) filter (where o.status = 'offered')) from public.booking_offers o where o.booking_id = b.id) end,
    'myOffer', case when b.requester_id is distinct from viewer then (select jsonb_build_object('status', o.status, 'expiresAt', o.expires_at, 'offeredAt', o.offered_at) from public.booking_offers o where o.booking_id = b.id and o.companion_id = viewer) end)
$$;

create or replace function public.create_prepaid_booking(p jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid()); me public.profiles; c public.profiles; b public.bookings;
  hrs int; dur int; d date; t text := p ->> 'startTime'; price int; k text := p ->> 'idempotencyKey';
  cat text := nullif(p ->> 'category', ''); place text := left(trim(coalesce(p ->> 'meetingPlace', '')), 120);
  rec jsonb := p -> 'recipient'; rphone text;
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
  if cat is not null and not cat = any (private.categories()) then perform private.fail('Unknown category.'); end if;
  if char_length(place) < 3 then perform private.fail('Add a public place to meet, like a café or a mall.'); end if;
  if rec is not null and jsonb_typeof(rec) = 'object' then
    if coalesce(rec ->> 'relation', '') not in ('mother', 'father', 'grandparent', 'relative', 'friend', 'other') then perform private.fail('Choose who the booking is for.'); end if;
    if char_length(trim(coalesce(rec ->> 'name', ''))) < 2 then perform private.fail('Add their name.'); end if;
    rphone := regexp_replace(coalesce(rec ->> 'phone', ''), '[^0-9]', '', 'g');
    if char_length(rphone) = 10 then rphone := '91' || rphone; end if;
    if char_length(rphone) not between 11 and 15 then perform private.fail('Add their mobile number.'); end if;
  end if;
  select * into me from public.profiles where id = uid;
  if me.suspended then perform private.fail('This account is suspended.'); end if;
  select * into c from public.profiles where id = (p ->> 'companionId')::uuid;
  if c.id is null or not private.is_live(c) or not private.sees(me.see_gender, c.gender) then perform private.fail('Companion not found.'); end if;
  if c.id = uid then perform private.fail('You cannot book yourself.'); end if;
  if not hrs = any (private.offered_hours(c)) then perform private.fail('This companion doesn’t offer ' || hrs || '-hour bookings.'); end if;
  if not private.within_day(t, dur) then perform private.fail('Sessions must start at or after ' || (private.pricing() ->> 'dayStart') || ' and finish by ' || (private.pricing() ->> 'dayEnd') || '.'); end if;
  if not private.available_at(c, d, t) then perform private.fail('This companion isn’t available at that day and time.'); end if;
  if private.session_start(d, t) - now() < interval '90 minutes' then perform private.fail('Please choose a time at least 90 minutes from now, so we can confirm your companion.'); end if;
  insert into public.bookings (requester_id, preferred_companion_id, idempotency_key, scheduled_date, start_time, duration_min, package_price,
                               message, experience, city, area, alloc_state, payment_deadline, category, meeting_place,
                               recipient_relation, recipient_name, recipient_phone, recipient_city, recipient_state)
  values (uid, c.id, k, d, t, dur, price, left(coalesce(p ->> 'message', ''), 300), left(p ->> 'experience', 40),
          coalesce(nullif(p ->> 'city', ''), c.city, me.city), coalesce(nullif(p ->> 'area', ''), c.area),
          'awaiting_payment', now() + interval '30 minutes', cat, place,
          case when rec is not null then rec ->> 'relation' end, case when rec is not null then left(trim(rec ->> 'name'), 80) end,
          rphone, case when rec is not null then left(rec ->> 'city', 80) end, case when rec is not null then left(rec ->> 'state', 80) end)
  on conflict (requester_id, idempotency_key) do nothing
  returning * into b;
  if not found then select * into b from public.bookings where requester_id = uid and idempotency_key = k; end if;
  return jsonb_build_object('booking', private.booking_json(b, uid), 'policy', public.booking_policy(),
    'quote', jsonb_build_object('currency', 'INR', 'amount', price, 'fees', 0, 'hours', hrs, 'effectiveHourly', round(price::numeric / hrs), 'pricePerHour', 399, 'duration', dur::text));
end $$;


-- WhatsApp messages that aren't tied to someone's notification row (panic alerts to admins by phone).
create table if not exists private.whatsapp_outbox (
  id bigserial primary key,
  phone text not null,
  template_env text not null,
  body jsonb not null,
  created_at timestamptz not null default now(),
  claimed_at timestamptz
);

-- Every admin number: staff profiles (phone or contact phone) and the superadmin list.
create or replace function private.staff_phones() returns setof text language sql stable set search_path = '' as $$
  select distinct ph from (
    select regexp_replace(coalesce(phone, contact_phone, ''), '\D', '', 'g') ph from public.profiles where role in ('subadmin', 'superadmin') and not suspended
    union select '91' || phone from private.superadmin_phones) x
  where char_length(ph) between 11 and 15
$$;

create or replace function private.fmt_time(t text) returns text language sql immutable set search_path = '' as $$
  select ltrim(to_char(('2000-01-01 ' || t)::timestamp, 'HH12:MI AM'), '0')
$$;
create or replace function private.fmt_phone(ph text) returns text language sql immutable set search_path = '' as $$
  select case when ph is null or ph = '' then 'not given' when ph ~ '^91[0-9]{10}$' then '+91 ' || substr(ph, 3, 5) || ' ' || substr(ph, 8) else '+' || ph end
$$;

-- One round of alerts: push to staff, WhatsApp to every admin number.
create or replace function private.panic_send(aid uuid) returns void language plpgsql security definer set search_path = '' as $$
declare a public.panic_alerts; b public.bookings; m public.profiles; c public.profiles; who text; place text; vals jsonb; ends text;
begin
  select * into a from public.panic_alerts where id = aid and resolved_at is null for update;
  if not found then return; end if;
  select * into b from public.bookings where id = a.booking_id;
  select * into m from public.profiles where id = b.requester_id;
  select * into c from public.profiles where id = b.companion_id;
  who := case when a.raised_role = 'member' then coalesce(nullif(m.full_name, ''), 'The member') || ' (member)' else coalesce(nullif(c.full_name, ''), 'The companion') || ' (companion)' end;
  ends := private.fmt_time(to_char(('2000-01-01 ' || b.start_time)::timestamp + make_interval(mins => b.duration_min), 'HH24:MI'));
  place := coalesce(nullif(b.meeting_place, ''), 'not given') || coalesce(', ' || nullif(b.area, ''), '') || coalesce(', ' || nullif(b.city, ''), '')
           || case when b.recipient_name is not null then ' — meeting ' || b.recipient_name || ' (' || b.recipient_relation || ', ' || private.fmt_phone(b.recipient_phone) || ')' else '' end;
  vals := jsonb_build_array('prsnn', who, '#' || b.ref, to_char(b.scheduled_date, 'Dy DD Mon YYYY'), private.fmt_time(b.start_time) || ' – ' || ends,
            coalesce(nullif(m.full_name, ''), 'Member'), private.fmt_phone(coalesce(m.phone, m.contact_phone)),
            coalesce(nullif(c.full_name, ''), 'Companion'), private.fmt_phone(coalesce(c.phone, c.contact_phone)), place);
  insert into private.whatsapp_outbox (phone, template_env, body) select ph, 'WAPLIFY_TPL_PANIC_ALERT', vals from private.staff_phones() ph;
  perform private.notify_staff('panic', 'PANIC #' || b.ref || ': ' || who || ' pressed the panic button. ' || (vals ->> 3) || ', ' || (vals ->> 4) || ' at ' || place || '. Member ' || (vals ->> 5) || ' ' || (vals ->> 6) || ' · Companion ' || (vals ->> 7) || ' ' || (vals ->> 8) || '.',
    jsonb_build_object('kind', 'panic', 'alertId', a.id, 'bookingId', b.id));
  update public.panic_alerts set sends = sends + 1, last_sent_at = now() where id = aid;
end $$;

create or replace function private.panic_json(a public.panic_alerts) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', a.id, 'bookingId', a.booking_id, 'ref', b.ref, 'raisedRole', a.raised_role, 'raisedAt', a.raised_at, 'sends', a.sends, 'lastSentAt', a.last_sent_at,
    'resolvedAt', a.resolved_at, 'resolvedNote', a.resolved_note, 'resolvedBy', (select full_name from public.profiles where id = a.resolved_by),
    'scheduledDate', to_char(b.scheduled_date, 'YYYY-MM-DD'), 'startTime', b.start_time, 'duration', b.duration_min,
    'meetingPlace', b.meeting_place, 'city', b.city, 'area', b.area,
    'recipient', case when b.recipient_name is not null then jsonb_build_object('name', b.recipient_name, 'relation', b.recipient_relation, 'phone', b.recipient_phone) end,
    'member', jsonb_build_object('id', m.id, 'name', m.full_name, 'phone', coalesce(m.phone, m.contact_phone)),
    'companion', jsonb_build_object('id', c.id, 'name', c.full_name, 'phone', coalesce(c.phone, c.contact_phone)))
  from public.bookings b left join public.profiles m on m.id = b.requester_id left join public.profiles c on c.id = b.companion_id
  where b.id = a.booking_id
$$;

create or replace function public.raise_panic(bid uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); b public.bookings; a public.panic_alerts; role text;
begin
  select * into b from public.bookings where id = bid;
  if not found or uid is null or not (b.requester_id is not distinct from uid or b.companion_id is not distinct from uid) then perform private.fail('Booking not found.'); end if;
  if b.status not in ('accepted', 'completed') or b.payment_status <> 'paid' then perform private.fail('The panic button works during a confirmed booking.'); end if;
  if now() < private.session_start(b.scheduled_date, b.start_time) then perform private.fail('The panic button turns on when the session starts. In danger now? Call 112.'); end if;
  if now() > private.session_end(b.scheduled_date, b.start_time, b.duration_min) + interval '1 hour' then perform private.fail('This session has ended. In danger now? Call 112, then report it from the booking.'); end if;
  select * into a from public.panic_alerts where booking_id = bid and resolved_at is null;
  if found then return private.panic_json(a); end if;
  role := case when b.requester_id = uid then 'member' else 'companion' end;
  insert into public.panic_alerts (booking_id, raised_by, raised_role) values (bid, uid, role) returning * into a;
  perform private.panic_send(a.id);
  perform private.audit('panic.raise', 'booking', bid::text, null, jsonb_build_object('alertId', a.id, 'by', role));
  select * into a from public.panic_alerts where id = a.id;
  return private.panic_json(a);
end $$;

-- Stopped by staff, or by the person who pressed it (the app asks for their PIN first).
create or replace function public.resolve_panic(aid uuid, note text default null) returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); a public.panic_alerts; staff boolean := (select public.is_staff()); b public.bookings;
begin
  select * into a from public.panic_alerts where id = aid for update;
  if not found then perform private.fail('Alert not found.'); end if;
  if not staff and a.raised_by is distinct from uid then perform private.fail('Only our team or the person who pressed it can stop this alert.'); end if;
  if a.resolved_at is not null then return private.panic_json(a); end if;
  update public.panic_alerts set resolved_at = now(), resolved_by = uid, resolved_note = left(note, 300) where id = aid returning * into a;
  select * into b from public.bookings where id = a.booking_id;
  perform private.notify_staff('panic', 'Panic alert #' || b.ref || ' resolved by ' || coalesce((select full_name from public.profiles where id = uid), 'someone') || case when staff then ' (admin).' else ' (the person who pressed it).' end,
    jsonb_build_object('kind', 'panic_resolved', 'alertId', a.id, 'bookingId', b.id));
  if staff and a.raised_by is not null and a.raised_by <> uid then
    perform private.notify2(a.raised_by, 'panic', 'Our team has closed your safety alert for booking #' || b.ref || '. If you still need help, call 112.', jsonb_build_object('kind', 'panic_resolved', 'bookingId', b.id));
  end if;
  perform private.audit('panic.resolve', 'booking', a.booking_id::text, null, jsonb_build_object('alertId', a.id, 'note', note));
  return private.panic_json(a);
end $$;

create or replace function public.admin_panics(open_only boolean default true) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.need_staff();
  return (select coalesce(jsonb_agg(private.panic_json(a) order by a.resolved_at nulls first, a.raised_at desc), '[]')
            from (select * from public.panic_alerts where not open_only or resolved_at is null order by raised_at desc limit 100) a);
end $$;

-- WhatsApp rows not tied to a notification (service role, notify edge function).
create or replace function public.claim_whatsapp() returns jsonb language plpgsql security definer set search_path = '' as $$
declare out jsonb;
begin
  with c as (update private.whatsapp_outbox o set claimed_at = now()
              where o.id in (select id from private.whatsapp_outbox where claimed_at is null and created_at > now() - interval '1 hour' order by id limit 200 for update skip locked)
              returning o.*)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'phone', phone, 'templateEnv', template_env, 'body', body)), '[]') into out from c;
  return out;
end $$;

-- Sweeper: also repeats open panic alerts every 5 minutes.
create or replace function private.tick() returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  update public.bookings set alloc_state = 'cancelled', status = 'cancelled', cancelled_by = 'system', cancel_reason = 'payment_timeout', cancelled_at = now()
   where alloc_state = 'awaiting_payment' and payment_deadline < now();
  for r in update public.booking_offers set status = 'expired' where status = 'offered' and expires_at <= now() returning booking_id loop
    perform private.next_offer(r.booking_id);
  end loop;
  for r in select id from public.bookings where alloc_state in ('offering', 'id_check') and alloc_deadline <= now() loop
    perform private.fail_allocation(r.id, 'no_one_accepted_in_time');
  end loop;
  for r in select b.id from public.bookings b where b.alloc_state = 'offering'
             and not exists (select 1 from public.booking_offers o where o.booking_id = b.id and o.status = 'offered') loop
    perform private.next_offer(r.id);
  end loop;
  -- Panic alerts repeat every 5 minutes until resolved.
  for r in select id from public.panic_alerts where resolved_at is null and last_sent_at <= now() - interval '5 minutes' loop
    perform private.panic_send(r.id);
  end loop;
  -- Completed 2 h after the end (no open dispute and no open panic alert).
  update public.bookings x set status = 'completed'
   where status = 'accepted' and dispute_status <> 'open' and private.session_end(scheduled_date, start_time, duration_min) < now() - interval '2 hours'
     and not exists (select 1 from public.panic_alerts a where a.booking_id = x.id and a.resolved_at is null);
end $$;

-- ───────── City plans ("Popular in <city>", edited by staff) ─────────
create table if not exists public.city_plans (
  id uuid primary key default gen_random_uuid(),
  state text not null, city text not null,
  category text not null check (category = any (array['new_in_town', 'dont_go_alone', 'explore', 'loved_one', 'work_study'])),
  title text not null check (char_length(title) between 3 and 60),
  details text check (details is null or char_length(details) <= 120),
  hours int not null check (hours between 1 and 12),
  sort int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists city_plans_city on public.city_plans (lower(city)) where active;
alter table public.city_plans enable row level security;
create policy "plans readable" on public.city_plans for select to anon, authenticated using (active);

create or replace function public.city_plans_for(city_name text) returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'state', state, 'city', city, 'category', category, 'title', title, 'details', details, 'hours', hours) order by sort, title), '[]')
  from public.city_plans where active and lower(city) = lower(coalesce(city_name, ''))
$$;
create or replace function public.admin_city_plans(city_name text default null) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.need_staff();
  return (select coalesce(jsonb_agg(to_jsonb(p) order by p.city, p.sort, p.title), '[]') from public.city_plans p where city_name is null or lower(p.city) = lower(city_name));
end $$;
create or replace function public.admin_save_city_plan(p jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.city_plans; pid uuid := nullif(p ->> 'id', '')::uuid;
begin
  perform private.need_staff();
  if pid is null then
    insert into public.city_plans (state, city, category, title, details, hours, sort)
    values (trim(p ->> 'state'), trim(p ->> 'city'), p ->> 'category', trim(p ->> 'title'), nullif(trim(coalesce(p ->> 'details', '')), ''), (p ->> 'hours')::int, coalesce((p ->> 'sort')::int, 0)) returning * into r;
  else
    update public.city_plans set state = coalesce(trim(p ->> 'state'), state), city = coalesce(trim(p ->> 'city'), city), category = coalesce(p ->> 'category', category),
      title = coalesce(trim(p ->> 'title'), title), details = case when p ? 'details' then nullif(trim(coalesce(p ->> 'details', '')), '') else details end,
      hours = coalesce((p ->> 'hours')::int, hours), sort = coalesce((p ->> 'sort')::int, sort), active = coalesce((p ->> 'active')::boolean, active)
     where id = pid returning * into r;
    if not found then perform private.fail('Plan not found.'); end if;
  end if;
  perform private.audit('city_plan.save', 'city_plan', r.id::text, null, to_jsonb(r));
  return to_jsonb(r);
exception when check_violation or not_null_violation or invalid_text_representation then
  perform private.fail('Check the plan: a title (3–60 letters), a category, a city and 1–12 hours.');
end $$;
create or replace function public.admin_delete_city_plan(pid uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.need_staff();
  delete from public.city_plans where id = pid;
  perform private.audit('city_plan.delete', 'city_plan', pid::text, null, null);
  return jsonb_build_object('message', 'Deleted.');
end $$;

insert into public.city_plans (state, city, category, title, details, hours, sort)
select * from (values
  ('Telangana', 'Hyderabad', 'explore', 'Fort and heritage walk', 'Golconda Fort and the Qutb Shahi Tombs', 6, 1),
  ('Telangana', 'Hyderabad', 'new_in_town', 'Café hopping', 'A few cafés and the streets around them', 2, 2),
  ('Telangana', 'Hyderabad', 'explore', 'Film city day', 'Ramoji Film City (tickets extra)', 8, 3),
  ('Maharashtra', 'Mumbai', 'explore', 'Caves and national park', 'Kanheri Caves, Sanjay Gandhi National Park', 6, 1),
  ('Maharashtra', 'Mumbai', 'new_in_town', 'Sea-face evening', 'Marine Drive and the streets nearby', 2, 2),
  ('Karnataka', 'Bengaluru', 'explore', 'Gardens and old Bengaluru', 'Lalbagh and the old city markets', 4, 1),
  ('Karnataka', 'Bengaluru', 'work_study', 'Café co-working', 'A quiet café, laptops out', 2, 2),
  ('Delhi', 'New Delhi', 'explore', 'Old Delhi heritage walk', 'Lanes, markets and monuments', 4, 1),
  ('Delhi', 'New Delhi', 'new_in_town', 'Neighbourhood walk', 'Markets and cafés near you', 2, 2)
) v(state, city, category, title, details, hours, sort)
where not exists (select 1 from public.city_plans);

-- ───────── India Post localities (every post-office locality with its PIN code) ─────────
create extension if not exists pg_trgm schema extensions;
create table if not exists public.localities (
  id bigserial primary key,
  state text not null,
  district text not null,
  name text not null,
  pincode text not null,
  unique (state, name, pincode)
);
create index if not exists localities_state_name on public.localities (state, lower(name) text_pattern_ops);
create index if not exists localities_pin on public.localities (pincode text_pattern_ops);
create index if not exists localities_trgm on public.localities using gin (lower(name) extensions.gin_trgm_ops);
alter table public.localities enable row level security;
create policy "localities readable" on public.localities for select to anon, authenticated using (true);

-- Areas in a state: matching names or PIN codes; the chosen city's district first.
create or replace function public.search_localities(state_name text, q text default '', city_name text default null) returns jsonb language sql stable security definer set search_path = '' as $$
  with x as (select lower(trim(coalesce(q, ''))) q, lower(trim(coalesce(city_name, ''))) c)
  select coalesce(jsonb_agg(jsonb_build_object('name', l.name, 'district', l.district, 'pincode', l.pincode) order by l.rank, l.name), '[]')
  from (
    select l.*, (case when x.c <> '' and lower(l.district) like '%' || x.c || '%' then 0 else 1 end) * 10
              + (case when x.q = '' then 0 when l.pincode like x.q || '%' or lower(l.name) like x.q || '%' then 0 when lower(l.name) like '% ' || x.q || '%' then 1 else 2 end) rank
    from public.localities l, x
    where l.state = state_name
      and (x.q = '' or l.pincode like x.q || '%' or lower(l.name) like '%' || x.q || '%')
      and (x.q <> '' or x.c = '' or lower(l.district) like '%' || x.c || '%')
    order by rank, l.name
    limit 40) l
$$;

grant execute on function public.raise_panic(uuid), public.resolve_panic(uuid, text), public.admin_panics(boolean), public.admin_city_plans(text),
  public.admin_save_city_plan(jsonb), public.admin_delete_city_plan(uuid) to authenticated;
grant execute on function public.city_plans_for(text), public.search_localities(text, text, text) to anon, authenticated;
revoke execute on function public.claim_whatsapp() from public, anon, authenticated;
grant execute on function public.claim_whatsapp() to service_role;
