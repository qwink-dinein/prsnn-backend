-- Companion ID at the first booking (see the _enums migration for the states).
-- Nobody meets an unchecked companion: chat, unlocked photos and payout still
-- need status 'accepted', which a held ('id_check') booking only reaches once
-- staff approve the ID.

-- Live = can be listed, booked and offered bookings.
create or replace function private.is_live(c public.profiles) returns boolean language sql stable set search_path = '' as $$
  select c.role = 'companion' and not c.suspended and c.verification_status in ('id_required', 'pending', 'verified')
$$;

-- ───────── Listing ─────────
create or replace function private.companion_card(c public.profiles, viewer uuid) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id,
    'fullName', case when c.profile_visibility = 'locked' and not private.unlocked(viewer, c.id) then private.first_name(c.full_name) else c.full_name end,
    'profilePhoto', case when c.profile_visibility = 'locked' and not private.unlocked(viewer, c.id) then null else private.photo_url(c.photo_path) end,
    'locked', c.profile_visibility = 'locked' and not private.unlocked(viewer, c.id),
    'description', c.description, 'city', c.city, 'area', c.area, 'state', c.state, 'gender', c.gender,
    'tags', to_jsonb(c.tags), 'packages', to_jsonb(private.offered_hours(c)), 'availability', c.availability,
    'startTime', c.start_time, 'endTime', c.end_time, 'pricePerHour', 399,
    'idVerified', c.verification_status = 'verified')
$$;

create or replace function public.list_companions(see text default null) returns jsonb language sql stable security definer set search_path = '' as $$
  with v as (select p.id, p.see_gender from public.profiles p where p.id = (select auth.uid()))
  select coalesce(jsonb_agg(private.companion_card(c, (select id from v)) order by (c.verification_status = 'verified') desc, c.created_at desc), '[]'::jsonb)
  from public.profiles c
  where private.is_live(c)
    and c.id is distinct from (select id from v)
    and private.sees(coalesce((select see_gender from v), nullif(see, '')::public.see_gender), c.gender)
$$;

create or replace function public.get_companion(cid uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.profiles; see public.see_gender;
begin
  select * into c from public.profiles where id = cid;
  select see_gender into see from public.profiles where id = (select auth.uid());
  if c.id is null or not private.is_live(c) or not private.sees(see, c.gender) then perform private.fail('Companion not found.'); end if;
  return private.companion_card(c, (select auth.uid()));
end $$;

-- ───────── Sign-up: no ID needed ─────────
create or replace function public.submit_companion_application(p jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); me public.profiles;
begin
  select * into me from public.profiles where id = uid;
  if me.role in ('subadmin', 'superadmin') then perform private.fail('Staff accounts can''t apply as companions. Use a separate number.'); end if;
  if coalesce(p ->> 'photoPath', '') = '' then perform private.fail('Add a profile photo.'); end if;
  perform public.update_my_profile(p);
  update public.profiles set role = 'companion',
    verification_status = case when verification_status in ('pending', 'verified') then verification_status else 'id_required' end
  where id = uid;
  -- Older app builds still send ID photos at sign-up: take them.
  if coalesce(p ->> 'idFrontPath', '') <> '' then
    perform public.submit_id_documents(jsonb_build_object('idType', coalesce(p ->> 'idType', 'aadhaar'), 'idFrontPath', p ->> 'idFrontPath',
      'idBackPath', p ->> 'idBackPath', 'selfiePath', p ->> 'selfiePath'));
  end if;
  return public.me();
end $$;

-- ───────── ID documents (any time; asked for at the first booking) ─────────
create or replace function public.submit_id_documents(p jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); me public.profiles; t text := p ->> 'idType'; own text := uid::text || '/%';
begin
  select * into me from public.profiles where id = uid;
  if me.id is null or me.role <> 'companion' then perform private.fail('Only companions verify an ID.'); end if;
  if me.suspended then perform private.fail('This account is suspended.'); end if;
  if me.verification_status = 'verified' then perform private.fail('Your ID is already verified.'); end if;
  if t is null or t not in ('aadhaar', 'pan', 'driving_licence', 'passport', 'voter_id') then perform private.fail('Choose which ID you’re using.'); end if;
  if coalesce(p ->> 'idFrontPath', '') not like own then perform private.fail('Add a photo of your ID.'); end if;
  if t in ('aadhaar', 'driving_licence', 'voter_id') and coalesce(p ->> 'idBackPath', '') not like own then perform private.fail('Add the back of your ID too.'); end if;
  if coalesce(p ->> 'selfiePath', '') not like own then perform private.fail('Take a selfie so we can match it to your ID.'); end if;
  update public.profiles set verification_status = 'pending', id_type = t, id_front_path = p ->> 'idFrontPath',
    id_back_path = case when coalesce(p ->> 'idBackPath', '') like own then p ->> 'idBackPath' end, selfie_path = p ->> 'selfiePath'
  where id = uid;
  return public.me();
end $$;

-- ───────── Allocation ─────────
-- A held booking blocks the companion's time like a confirmed one.
create or replace function private.has_conflict(cid uuid, b public.bookings) returns boolean language sql stable set search_path = '' as $$
  select exists (
    select 1 from public.bookings o
     where o.id <> b.id and o.scheduled_date = b.scheduled_date
       and (o.companion_id = cid and (o.status = 'accepted' or o.alloc_state = 'id_check')
            or exists (select 1 from public.booking_offers f where f.booking_id = o.id and f.companion_id = cid and f.status = 'offered' and f.expires_at > now()))
       and private.session_start(o.scheduled_date, o.start_time) < private.session_end(b.scheduled_date, b.start_time, b.duration_min)
       and private.session_start(b.scheduled_date, b.start_time) < private.session_end(o.scheduled_date, o.start_time, o.duration_min))
$$;

create or replace function private.eligible(c public.profiles, b public.bookings, see public.see_gender) returns boolean language sql stable set search_path = '' as $$
  select private.is_live(c)
     and c.id is distinct from b.requester_id
     and private.sees(see, c.gender)
     and (b.city is null or lower(c.city) = lower(b.city))
     and private.available_at(c, b.scheduled_date, b.start_time)
     and (b.duration_min / 60) = any (private.offered_hours(c))
     and not exists (select 1 from public.booking_offers o where o.booking_id = b.id and o.companion_id = c.id)
     and not private.has_conflict(c.id, b)
$$;

-- Deadline passes while held, or nobody accepts: cancel + full refund.
create or replace function private.fail_allocation(bid uuid, why text) returns void language plpgsql security definer set search_path = '' as $$
declare b public.bookings; held uuid;
begin
  select companion_id into held from public.bookings where id = bid and alloc_state = 'id_check';
  update public.bookings set alloc_state = 'failed', status = 'cancelled', cancelled_by = 'system', cancel_reason = why,
         cancelled_at = now(), failed_reason = why
   where id = bid and alloc_state in ('offering', 'id_check') returning * into b;
  if not found then return; end if;
  update public.booking_offers set status = 'withdrawn' where booking_id = bid and status = 'offered';
  perform private.refund(bid, b.amount_paid, 'No companion accepted');
  perform private.notify(b.requester_id, 'refund', 'We couldn’t confirm a companion for booking #' || b.ref || '. Your full payment of ₹' || b.amount_paid::int || ' is being refunded.');
  if held is not null then
    perform private.notify(held, 'booking_cancelled', 'Booking #' || b.ref || ' was cancelled: your ID check wasn’t finished before the deadline.');
  end if;
end $$;

-- Confirm a booking for its companion (after accept by a verified companion, or ID approval).
create or replace function private.confirm_assignment(bid uuid) returns public.bookings language plpgsql security definer set search_path = '' as $$
declare b public.bookings;
begin
  update public.bookings set status = 'accepted', alloc_state = 'assigned', assigned_at = now()
   where id = bid and alloc_state in ('offering', 'id_check') and companion_id is not null returning * into b;
  if found then
    perform private.notify(b.requester_id, 'booking_confirmed', (select private.first_name(full_name) from public.profiles where id = b.companion_id) || ' confirmed your booking #' || b.ref || '. Chat is open.');
  end if;
  return b;
end $$;

create or replace function public.accept_offer(bid uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); me public.profiles; b public.bookings; share numeric := (private.pricing() ->> 'platformShare')::numeric;
begin
  select * into me from public.profiles where id = uid;
  if me.verification_status in ('id_required', 'not_submitted', 'rejected') then
    perform private.fail('Verify your ID to accept this booking.');
  end if;
  select * into b from public.bookings where id = bid for update;
  if not found then perform private.fail('Booking not found.'); end if;
  if exists (select 1 from public.bookings x where x.companion_id = uid and (x.status = 'accepted' or x.alloc_state = 'id_check') and x.id <> bid
        and private.session_start(x.scheduled_date, x.start_time) < private.session_end(b.scheduled_date, b.start_time, b.duration_min)
        and private.session_start(b.scheduled_date, b.start_time) < private.session_end(x.scheduled_date, x.start_time, x.duration_min)) then
    perform private.fail('You already have a booking at that time.');
  end if;
  update public.booking_offers set status = 'accepted', responded_at = now()
   where booking_id = bid and companion_id = uid and status = 'offered' and expires_at > now();
  if not found then perform private.fail('This offer has expired or was already taken.'); end if;
  update public.bookings set companion_id = uid, companion_share = floor(amount_paid * (1 - share)),
         alloc_state = case when me.verification_status = 'verified' then alloc_state else 'id_check' end
   where id = bid and alloc_state = 'offering' returning * into b;
  if not found then perform private.fail('This offer has expired or was already taken.'); end if;
  update public.booking_offers set status = 'withdrawn' where booking_id = bid and status = 'offered';
  if me.verification_status = 'verified' then
    b := private.confirm_assignment(bid);
    return jsonb_build_object('message', 'Booking confirmed. Chat is open.', 'booking', private.booking_json(b, uid));
  end if;
  perform private.notify(b.requester_id, 'booking_accepted', private.first_name(me.full_name) || ' accepted booking #' || b.ref || '. We’re doing a quick safety check of their ID; you’ll hear from us as soon as it’s confirmed.');
  return jsonb_build_object('message', 'Accepted. The booking is held for you while we check your ID.', 'idCheck', true, 'booking', private.booking_json(b, uid));
end $$;

-- ───────── Staff decision releases or re-offers held bookings ─────────
create or replace function public.admin_decide_verification(uid uuid, decision text, note text default null) returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.profiles; before_status public.verification_status; r record; released int := 0; reoffered int := 0;
begin
  perform private.need_staff();
  if decision not in ('verified', 'rejected') then perform private.fail('Choose verify or reject.'); end if;
  select verification_status into before_status from public.profiles where id = uid and role = 'companion';
  update public.profiles set verification_status = decision::public.verification_status, verified_by = (select auth.uid())
   where id = uid and role = 'companion' returning * into p;
  if not found then perform private.fail('Companion not found.'); end if;
  for r in select id, ref from public.bookings where companion_id = uid and alloc_state = 'id_check' for update loop
    if decision = 'verified' then
      perform private.confirm_assignment(r.id);
      perform private.notify(uid, 'booking_confirmed', 'Booking #' || r.ref || ' is confirmed. Chat is open.');
      released := released + 1;
    else
      update public.bookings set companion_id = null, companion_share = null, alloc_state = 'offering' where id = r.id;
      update public.booking_offers set status = 'declined' where booking_id = r.id and companion_id = uid;
      perform private.notify((select requester_id from public.bookings where id = r.id), 'other',
        'Your companion for booking #' || r.ref || ' couldn’t complete our safety check. We’re offering your booking to another verified companion; if nobody can make it, you get a full refund.');
      perform private.next_offer(r.id);
      reoffered := reoffered + 1;
    end if;
  end loop;
  perform private.notify(uid, 'other', case when decision = 'verified' then 'Your ID is verified. Every booking from now on is one tap to accept.'
    else 'We couldn’t verify your ID' || coalesce(': ' || left(note, 200), '.') || ' You can send a clearer photo from your profile.' end);
  perform private.audit('verification.' || case when decision = 'verified' then 'approve' else 'reject' end, 'user', uid::text,
    jsonb_build_object('verificationStatus', before_status),
    jsonb_build_object('verificationStatus', decision, 'heldBookingsReleased', released, 'heldBookingsReoffered', reoffered)
      || case when note is not null then jsonb_build_object('note', left(note, 200)) else '{}' end);
  return jsonb_build_object('message', case when decision = 'verified' then 'Companion verified.' else 'Companion rejected.' end
    || case when released > 0 then ' ' || released || ' held booking(s) confirmed.' when reoffered > 0 then ' ' || reoffered || ' held booking(s) offered to others.' else '' end,
    'user', private.admin_user_json(p));
end $$;

-- Queue: companions holding a booking first, soonest deadline first.
create or replace function public.admin_verifications() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.need_staff();
  return (select coalesce(jsonb_agg(private.admin_user_json(p) || jsonb_build_object('heldUntil', h.until, 'heldBookings', coalesce(h.n, 0))
            order by h.until nulls last, p.updated_at), '[]')
          from public.profiles p
          left join lateral (select min(b.alloc_deadline) until, count(*) n from public.bookings b where b.companion_id = p.id and b.alloc_state = 'id_check') h on true
          where p.role = 'companion' and p.verification_status = 'pending');
end $$;

create or replace function private.admin_user_json(p public.profiles) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'fullName', p.full_name, 'phone', p.phone, 'role', p.role, 'verificationStatus', p.verification_status,
    'suspended', p.suspended, 'suspendedReason', p.suspended_reason, 'city', p.city, 'area', p.area, 'state', p.state, 'gender', p.gender,
    'seeGender', p.see_gender, 'profileVisibility', coalesce(p.profile_visibility, 'open'), 'profilePhotoUrl', private.photo_url(p.photo_path),
    'idType', p.id_type, 'idFrontPath', p.id_front_path, 'idBackPath', p.id_back_path, 'selfiePath', p.selfie_path,
    'description', p.description, 'tags', to_jsonb(p.tags), 'packages', to_jsonb(p.packages), 'availability', p.availability,
    'startTime', p.start_time, 'endTime', p.end_time, 'hasPushToken', p.push_token is not null, 'createdAt', p.created_at)
$$;

-- Broadcasts reach every live companion.
create or replace function public.broadcast_tokens(aud text) returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(push_token), '{}') from public.profiles p
   where push_token is not null and not suspended
     and ((aud = 'members' and role = 'user') or (aud = 'companions' and private.is_live(p)))
$$;
revoke execute on function public.broadcast_tokens(text) from public, anon, authenticated;
grant execute on function public.broadcast_tokens(text) to service_role;

revoke execute on function public.submit_id_documents(jsonb) from public, anon;
grant execute on function public.submit_id_documents(jsonb) to authenticated;

create or replace function public.admin_audience() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.need_super();
  return jsonb_build_object(
    'members', (select count(*) from public.profiles where role = 'user' and not suspended and push_token is not null),
    'companions', (select count(*) from public.profiles p where private.is_live(p) and push_token is not null));
end $$;
