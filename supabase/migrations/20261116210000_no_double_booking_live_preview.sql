-- 1) No double bookings. A companion's time is held from the moment a member starts paying for it
--    (30-minute payment window), while it is offered to them, and once they accept. Nobody else can
--    book an overlapping time, and the same member can't hold two overlapping bookings.
-- 2) Live preview for staff: "View the app as" a real member or companion, read-only, on live data.

/** Does booking `o` hold companion `cid`'s time? */
create or replace function private.holds_companion(o public.bookings, cid uuid) returns boolean
language sql stable set search_path = '' as $$
  select (o.companion_id = cid and (o.status = 'accepted' or o.alloc_state = 'id_check'))
      or (o.preferred_companion_id = cid and o.alloc_state = 'awaiting_payment' and o.payment_deadline > now())
      or exists (select 1 from public.booking_offers f where f.booking_id = o.id and f.companion_id = cid and f.status = 'offered' and f.expires_at > now())
$$;

create or replace function private.has_conflict(cid uuid, b public.bookings) returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.bookings o
     where o.id <> b.id and o.scheduled_date = b.scheduled_date
       and private.holds_companion(o, cid)
       and private.session_start(o.scheduled_date, o.start_time) < private.session_end(b.scheduled_date, b.start_time, b.duration_min)
       and private.session_start(b.scheduled_date, b.start_time) < private.session_end(o.scheduled_date, o.start_time, o.duration_min))
$$;

/** The times a companion is already taken on a day (no names or details), so the app can hide them. */
create or replace function public.companion_busy(cid uuid, d date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('start', o.start_time, 'duration', o.duration_min) order by o.start_time), '[]'::jsonb)
    from public.bookings o
   where (select auth.uid()) is not null and o.scheduled_date = d and private.holds_companion(o, cid)
$$;
revoke execute on function public.companion_busy(uuid, date) from public, anon;
grant execute on function public.companion_busy(uuid, date) to authenticated;

create or replace function public.create_prepaid_booking(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $function$
declare uid uuid := (select auth.uid()); me public.profiles; c public.profiles; b public.bookings; hrs int; dur int; d date; t text := p ->> 'startTime'; price int;
        k text := p ->> 'idempotencyKey'; cat text := nullif(p ->> 'category', ''); place text := left(trim(coalesce(p ->> 'meetingPlace', '')), 200);
        rec jsonb := p -> 'recipient'; rphone text; hv boolean := coalesce((p ->> 'homeVisit')::boolean, false); probe public.bookings;
begin
  if uid is null then perform private.fail('Please log in.'); end if;
  if k is null or char_length(k) not between 8 and 100 then perform private.fail('Missing booking key. Please try again.'); end if;
  select * into b from public.bookings where requester_id = uid and idempotency_key = k;
  if found then
    return jsonb_build_object('booking', private.booking_json(b, uid), 'replayed', true, 'policy', public.booking_policy(),
      'quote', jsonb_build_object('currency', 'INR', 'amount', b.package_price, 'fees', 0, 'hours', b.duration_min / 60,
        'effectiveHourly', round(b.package_price::numeric / (b.duration_min / 60)), 'pricePerHour', b.price_per_hour, 'duration', b.duration_min::text));
  end if;
  if coalesce((p ->> 'acceptTerms')::boolean, false) is not true then perform private.fail('Please accept the cancellation and refund terms.'); end if;
  begin d := (p ->> 'scheduledDate')::date; exception when others then perform private.fail('Invalid date or time.'); end;
  if t is null or t !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then perform private.fail('Invalid date or time.'); end if;
  dur := (p ->> 'duration')::int; hrs := dur / 60; price := private.price_for(hrs);
  if dur % 60 <> 0 or price is null then perform private.fail('Choose a duration between 1 and 12 hours.'); end if;
  if cat is not null and not cat = any (private.categories()) then perform private.fail('Unknown category.'); end if;
  if rec is not null and jsonb_typeof(rec) = 'object' then
    if coalesce(rec ->> 'relation', '') not in ('mother', 'father', 'grandparent', 'relative', 'friend', 'other') then perform private.fail('Choose who the booking is for.'); end if;
    if char_length(trim(coalesce(rec ->> 'name', ''))) < 2 then perform private.fail('Add their name.'); end if;
    rphone := regexp_replace(coalesce(rec ->> 'phone', ''), '[^0-9]', '', 'g');
    if char_length(rphone) = 10 then rphone := '91' || rphone; end if;
    if char_length(rphone) not between 11 and 15 then perform private.fail('Add their mobile number.'); end if;
  else rec := null; end if;
  if hv then
    if cat is distinct from 'loved_one' or rec is null then perform private.fail('Home visits are only for Companion for a Loved One bookings.'); end if;
    if char_length(place) < 8 then perform private.fail('Add their full home address.'); end if;
  elsif char_length(place) < 3 then perform private.fail('Add a public place to meet, like a café or a mall.');
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

  -- No double bookings. One booking at a time per companion (locked), then check the slot.
  perform private.lock_companion(c.id);
  probe.id := gen_random_uuid(); probe.scheduled_date := d; probe.start_time := t; probe.duration_min := dur;
  -- The member's own unpaid, overlapping booking (they went back and chose again) is replaced, not kept.
  update public.bookings o set alloc_state = 'cancelled', status = 'cancelled', cancelled_by = 'system', cancel_reason = 'replaced_by_new_booking', cancelled_at = now()
   where o.requester_id = uid and o.alloc_state = 'awaiting_payment' and o.payment_status <> 'paid' and o.scheduled_date = d
     and private.session_start(o.scheduled_date, o.start_time) < private.session_end(d, t, dur)
     and private.session_start(d, t) < private.session_end(o.scheduled_date, o.start_time, o.duration_min);
  if private.has_conflict(c.id, probe) then
    perform private.fail(coalesce(private.first_name(c.full_name), 'This companion') || ' is already booked at that time. Please choose another time.');
  end if;
  if exists (select 1 from public.bookings o
              where o.requester_id = uid and o.scheduled_date = d and o.status not in ('cancelled', 'completed')
                and (o.alloc_state in ('offering', 'id_check', 'assigned') or (o.alloc_state = 'awaiting_payment' and o.payment_deadline > now()))
                and private.session_start(o.scheduled_date, o.start_time) < private.session_end(d, t, dur)
                and private.session_start(d, t) < private.session_end(o.scheduled_date, o.start_time, o.duration_min)) then
    perform private.fail('You already have a booking at that time. Choose another time, or cancel the other booking first.');
  end if;

  insert into public.bookings (requester_id, preferred_companion_id, idempotency_key, scheduled_date, start_time, duration_min, package_price, message, experience, city, area,
                               alloc_state, payment_deadline, category, meeting_place, home_visit, recipient_relation, recipient_name, recipient_phone, recipient_city, recipient_state)
  values (uid, c.id, k, d, t, dur, price, left(coalesce(p ->> 'message', ''), 300), left(p ->> 'experience', 40), coalesce(nullif(p ->> 'city', ''), c.city, me.city),
          coalesce(nullif(p ->> 'area', ''), c.area), 'awaiting_payment', now() + interval '30 minutes', cat, place, hv,
          rec ->> 'relation', left(trim(rec ->> 'name'), 80), case when rec is not null then rphone end, left(rec ->> 'city', 80), left(rec ->> 'state', 80))
  on conflict (requester_id, idempotency_key) do nothing returning * into b;
  if not found then select * into b from public.bookings where requester_id = uid and idempotency_key = k; end if;
  return jsonb_build_object('booking', private.booking_json(b, uid), 'policy', public.booking_policy(),
    'quote', jsonb_build_object('currency', 'INR', 'amount', price, 'fees', 0, 'hours', hrs, 'effectiveHourly', round(price::numeric / hrs), 'pricePerHour', 399, 'duration', dur::text));
end $function$;

-- Paying for a booking whose time was meanwhile taken (only possible through an old app or a race):
-- mark_paid → next_offer already skips a busy companion and offers the booking to someone else.

/**
 * Staff only. Runs one of the app's read-only screens' queries as a real member or companion, so
 * "View the app as" shows live data. Nothing can be changed this way, and chats stay private
 * (they are not in the list). Each preview start is written to the activity log.
 */
create or replace function public.admin_view_as(target uuid, fn text, args jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare old_claims text := current_setting('request.jwt.claims', true); old_sub text := current_setting('request.jwt.claim.sub', true);
        out jsonb; who public.profiles;
begin
  perform private.need_staff();
  select * into who from public.profiles where id = target;
  if not found then perform private.fail('Person not found.'); end if;
  if fn = 'start' then
    perform private.audit('app.preview_live', 'user', target::text, null, jsonb_build_object('name', who.full_name, 'role', who.role));
  end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', target, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', target::text, true);
  begin
    out := case fn
      when 'start' then to_jsonb(public.me())
      when 'me' then to_jsonb(public.me())
      when 'my_profile' then to_jsonb(public.my_profile())
      when 'my_bookings' then to_jsonb(public.my_bookings())
      when 'incoming_bookings' then to_jsonb(public.incoming_bookings())
      when 'get_booking' then to_jsonb(public.get_booking((args ->> 'bid')::uuid))
      when 'list_companions' then to_jsonb(public.list_companions(args ->> 'see'))
      when 'get_companion' then to_jsonb(public.get_companion((args ->> 'cid')::uuid))
      when 'unread_counts' then to_jsonb(public.unread_counts())
      when 'my_consents' then to_jsonb(public.my_consents())
      when 'notifications' then (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'type', n.type, 'message', n.message, 'is_read', n.is_read, 'created_at', n.created_at, 'action', n.action)
                                   order by n.created_at desc), '[]'::jsonb)
                                   from (select * from public.notifications where user_id = target order by created_at desc limit 100) n)
      else null end;
    if out is null and fn not in ('start', 'me', 'my_profile', 'get_booking', 'get_companion') then
      perform private.fail('That isn’t available in a preview.');
    end if;
  exception when others then
    perform set_config('request.jwt.claims', coalesce(old_claims, ''), true);
    perform set_config('request.jwt.claim.sub', coalesce(old_sub, ''), true);
    raise;
  end;
  perform set_config('request.jwt.claims', coalesce(old_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(old_sub, ''), true);
  return out;
end $$;
revoke execute on function public.admin_view_as(uuid, text, jsonb) from public, anon;
grant execute on function public.admin_view_as(uuid, text, jsonb) to authenticated;
