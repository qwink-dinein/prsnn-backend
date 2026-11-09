-- prsnn: profile, listing and prepaid-booking logic (ported from the Express
-- backend: services/allocation.js, prepaid.controller.js, utils/pricing.js).
-- Every client entry point is a security-definer function that checks
-- auth.uid() itself; tables have no client write policies.

-- Deleting an account keeps its bookings for accounting.
alter table public.bookings alter column requester_id drop not null;
alter table public.bookings drop constraint bookings_requester_id_fkey;
alter table public.bookings add constraint bookings_requester_id_fkey foreign key (requester_id) references public.profiles (id) on delete set null;

insert into private.config values ('avatar_base', 'https://mhovyhapzhxcmcuelbol.supabase.co/storage/v1/object/public/avatars/');

-- ───────── small helpers ─────────
create function private.cfg(k text) returns text language sql stable set search_path = '' as $$ select value from private.config where key = k $$;
create function private.pricing() returns jsonb language sql stable set search_path = '' as $$ select value from public.settings where key = 'pricing' $$;
create function private.price_for(hours int) returns int language sql stable set search_path = '' as $$ select (private.pricing() -> 'packagePrices' ->> hours::text)::int $$;
create function private.minutes_of(t text) returns int language sql immutable set search_path = '' as $$ select split_part(t, ':', 1)::int * 60 + split_part(t, ':', 2)::int $$;
create function private.photo_url(path text) returns text language sql stable set search_path = '' as $$ select case when path is null or path = '' then null when path ~ '^https?://' then path else private.cfg('avatar_base') || path end $$;
create function private.first_name(n text) returns text language sql immutable set search_path = '' as $$ select split_part(coalesce(n, ''), ' ', 1) $$;
create function private.session_start(d date, t text) returns timestamptz language sql immutable set search_path = '' as $$ select (d + t::time) at time zone 'Asia/Kolkata' $$;
create function private.session_end(d date, t text, dur int) returns timestamptz language sql immutable set search_path = '' as $$ select private.session_start(d, t) + make_interval(mins => dur) $$;
create function private.fail(msg text) returns void language plpgsql set search_path = '' as $$ begin raise exception using message = msg, errcode = 'P0001'; end $$;
create function private.notify(uid uuid, t public.notification_type, msg text) returns void language sql set search_path = '' as $$
  insert into public.notifications (user_id, type, message) select uid, t, msg where uid is not null
$$;
create function private.sees(see public.see_gender, g public.gender) returns boolean language sql immutable set search_path = '' as $$
  select see is null or see = 'everyone' or see::text = g::text
$$;
create function private.within_day(t text, dur int) returns boolean language sql stable set search_path = '' as $$
  select private.minutes_of(t) >= private.minutes_of(private.pricing() ->> 'dayStart')
     and private.minutes_of(t) + dur <= private.minutes_of(private.pricing() ->> 'dayEnd')
$$;
create function private.offered_hours(p public.profiles) returns int[] language sql stable set search_path = '' as $$
  select coalesce(nullif(p.packages, '{}'), array(select jsonb_array_elements_text(private.pricing() -> 'headlineHours')::int))
$$;
create function private.available_at(p public.profiles, d date, t text) returns boolean language sql stable set search_path = '' as $$
  select coalesce((p.availability ->> trim(lower(to_char(d, 'Day'))))::boolean, false)
     and (p.start_time is null or p.end_time is null or private.minutes_of(t) between private.minutes_of(p.start_time) and private.minutes_of(p.end_time))
$$;
create function private.audit(action text, kind text, tid text, b jsonb, a jsonb) returns void language sql set search_path = '' as $$
  insert into public.audit_log (actor_id, role, action, target_kind, target_id, before, after)
  values ((select auth.uid()), (select role from public.profiles where id = (select auth.uid())), action, kind, tid, b, a)
$$;
-- Has this viewer a confirmed, paid booking with that person? (unlocks photos)
create function private.unlocked(viewer uuid, other uuid) returns boolean language sql stable set search_path = '' as $$
  select viewer is not null and exists (select 1 from public.bookings b where b.status in ('accepted', 'completed') and b.payment_status = 'paid'
    and ((b.requester_id = viewer and b.companion_id = other) or (b.companion_id = viewer and b.requester_id = other)))
$$;

-- ───────── Accounts ─────────
-- New auth user → profile. Role 'companion' only if asked at sign-up; never staff.
create function private.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  ph text := regexp_replace(coalesce(new.phone, ''), '\D', '', 'g');
  r public.user_role := case when new.raw_user_meta_data ->> 'role' = 'companion' then 'companion' else 'user' end;
  sup boolean := exists (select 1 from private.superadmin_phones s where s.phone = right(ph, 10));
begin
  insert into public.profiles (id, phone, role, verification_status, superadmin_via_env)
  values (new.id, nullif(ph, ''), case when sup then 'superadmin' else r end,
          case when sup or r = 'user' then 'verified' else 'not_submitted' end, sup);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();

-- The signed-in person, in the app's session shape.
create function public.me() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'role', p.role, 'phone', p.phone, 'fullName', p.full_name,
    'is_verified', p.role in ('subadmin', 'superadmin') or p.verification_status = 'verified',
    'verification_status', p.verification_status, 'wantsToBeFellow', p.role = 'companion',
    'profilePhoto', private.photo_url(p.photo_path), 'gender', p.gender, 'seeGender', p.see_gender,
    'profileVisibility', p.profile_visibility, 'city', p.city, 'suspended', p.suspended, 'hasPin', false)
  from public.profiles p where p.id = (select auth.uid())
$$;

-- Called after every login: applies the superadmin phone list (promote / demote)
-- and refuses suspended accounts.
create function public.sync_my_role() returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.profiles; listed boolean;
begin
  select * into p from public.profiles where id = (select auth.uid());
  if not found then perform private.fail('Account not found.'); end if;
  if p.suspended then perform private.fail('This account is suspended. Contact support if you think this is a mistake.'); end if;
  listed := exists (select 1 from private.superadmin_phones s where s.phone = right(coalesce(p.phone, ''), 10));
  if listed and p.role <> 'superadmin' then
    update public.profiles set role = 'superadmin', superadmin_via_env = true, verification_status = 'verified' where id = p.id;
  elsif not listed and p.role = 'superadmin' and p.superadmin_via_env then
    update public.profiles set role = 'user', superadmin_via_env = false where id = p.id;
  end if;
  return public.me();
end $$;

-- Own profile (full, including private fields).
create function public.my_profile() returns jsonb language sql stable security definer set search_path = '' as $$
  select to_jsonb(p) - 'push_token' || jsonb_build_object('profilePhotoUrl', private.photo_url(p.photo_path)) from public.profiles p where p.id = (select auth.uid())
$$;

-- Whitelisted self-edits. Visibility changes need explicit consent.
create function public.update_my_profile(p jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare me public.profiles; hrs int[]; uid uuid := (select auth.uid());
begin
  select * into me from public.profiles where id = uid;
  if not found then perform private.fail('Account not found.'); end if;
  if p ? 'fullName' then
    if char_length(trim(p ->> 'fullName')) < 2 then perform private.fail('Please enter your name.'); end if;
    me.full_name := left(trim(p ->> 'fullName'), 80);
  end if;
  if p ? 'city' then me.city := nullif(left(trim(p ->> 'city'), 80), ''); end if;
  if p ? 'state' then me.state := nullif(left(trim(p ->> 'state'), 80), ''); end if;
  if p ? 'area' then me.area := nullif(left(trim(p ->> 'area'), 80), ''); end if;
  if p ? 'description' then me.description := nullif(left(p ->> 'description', 1000), ''); end if;
  if p ? 'gender' then me.gender := (p ->> 'gender')::public.gender; end if;
  if p ? 'seeGender' then me.see_gender := (p ->> 'seeGender')::public.see_gender; end if;
  if p ? 'profileVisibility' and (p ->> 'profileVisibility') is distinct from me.profile_visibility::text then
    if coalesce((p ->> 'visibilityConsent')::boolean, false) is not true then perform private.fail('Please confirm how your profile is shown.'); end if;
    me.profile_visibility := (p ->> 'profileVisibility')::public.visibility;
    me.visibility_consent_at := now();
  end if;
  if p ? 'tags' then me.tags := array(select left(trim(x), 30) from jsonb_array_elements_text(p -> 'tags') x where trim(x) <> '' limit 15); end if;
  if p ? 'photoPath' then
    if (p ->> 'photoPath') is not null and (p ->> 'photoPath') not like uid::text || '/%' then perform private.fail('Invalid photo.'); end if;
    me.photo_path := p ->> 'photoPath';
  end if;
  if p ? 'packages' then
    hrs := array(select distinct x::int from jsonb_array_elements_text(p -> 'packages') x where x::int between 1 and 12 order by 1);
    if cardinality(hrs) = 0 then perform private.fail('Choose at least one duration you offer.'); end if;
    me.packages := hrs;
  end if;
  if p ? 'availability' then
    me.availability := (select coalesce(jsonb_object_agg(d, coalesce((p -> 'availability' ->> d)::boolean, false)), '{}')
                        from unnest(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']) d);
  end if;
  if p ? 'startTime' then me.start_time := nullif(p ->> 'startTime', ''); end if;
  if p ? 'endTime' then me.end_time := nullif(p ->> 'endTime', ''); end if;
  if me.start_time is not null and (me.start_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or private.minutes_of(me.start_time) < private.minutes_of(private.pricing() ->> 'dayStart')) then
    perform private.fail('Availability must start at or after ' || (private.pricing() ->> 'dayStart') || '.');
  end if;
  if me.end_time is not null and (me.end_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or private.minutes_of(me.end_time) > private.minutes_of(private.pricing() ->> 'dayEnd')) then
    perform private.fail('Availability must end by ' || (private.pricing() ->> 'dayEnd') || '.');
  end if;
  update public.profiles set full_name = me.full_name, city = me.city, state = me.state, area = me.area, description = me.description,
    gender = me.gender, see_gender = me.see_gender, profile_visibility = me.profile_visibility, visibility_consent_at = me.visibility_consent_at,
    tags = me.tags, photo_path = me.photo_path, packages = me.packages, availability = me.availability, start_time = me.start_time, end_time = me.end_time
  where id = uid;
  return public.me();
end $$;

-- Companion application: profile + ID documents → pending review.
create function public.submit_companion_application(p jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); r public.user_role;
begin
  select role into r from public.profiles where id = uid;
  if r in ('subadmin', 'superadmin') then perform private.fail('Staff accounts can''t apply as companions. Use a separate number.'); end if;
  if coalesce(p ->> 'idFrontPath', '') not like uid::text || '/%' or coalesce(p ->> 'idBackPath', '') not like uid::text || '/%' then
    perform private.fail('Upload both sides of your ID.');
  end if;
  if coalesce(p ->> 'photoPath', '') = '' then perform private.fail('Add a profile photo.'); end if;
  perform public.update_my_profile(p);
  update public.profiles set role = 'companion', verification_status = 'pending',
    id_front_path = p ->> 'idFrontPath', id_back_path = p ->> 'idBackPath',
    selfie_path = case when coalesce(p ->> 'selfiePath', '') like uid::text || '/%' then p ->> 'selfiePath' end
  where id = uid;
  return public.me();
end $$;

create function public.save_push_token(token text) returns void language plpgsql security definer set search_path = '' as $$
begin
  if token is not null and token !~ '^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$' then perform private.fail('Not an Expo push token.'); end if;
  -- A device that switches accounts stops receiving the old account's pushes.
  if token is not null then update public.profiles set push_token = null where push_token = token and id <> (select auth.uid()); end if;
  update public.profiles set push_token = token where id = (select auth.uid());
end $$;

-- ───────── Listing (privacy rules applied here) ─────────
create function private.companion_card(c public.profiles, viewer uuid) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id,
    'fullName', case when c.profile_visibility = 'locked' and not private.unlocked(viewer, c.id) then private.first_name(c.full_name) else c.full_name end,
    'profilePhoto', case when c.profile_visibility = 'locked' and not private.unlocked(viewer, c.id) then null else private.photo_url(c.photo_path) end,
    'locked', c.profile_visibility = 'locked' and not private.unlocked(viewer, c.id),
    'description', c.description, 'city', c.city, 'area', c.area, 'state', c.state, 'gender', c.gender,
    'tags', to_jsonb(c.tags), 'packages', to_jsonb(private.offered_hours(c)), 'availability', c.availability,
    'startTime', c.start_time, 'endTime', c.end_time, 'pricePerHour', 399)
$$;

create function public.list_companions(see text default null) returns jsonb language sql stable security definer set search_path = '' as $$
  with v as (select p.id, p.see_gender from public.profiles p where p.id = (select auth.uid()))
  select coalesce(jsonb_agg(private.companion_card(c, (select id from v)) order by c.created_at desc), '[]'::jsonb)
  from public.profiles c
  where c.role = 'companion' and c.verification_status = 'verified' and not c.suspended
    and c.id is distinct from (select id from v)
    and private.sees(coalesce((select see_gender from v), nullif(see, '')::public.see_gender), c.gender)
$$;

create function public.get_companion(cid uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.profiles; see public.see_gender;
begin
  select * into c from public.profiles where id = cid and role = 'companion' and verification_status = 'verified' and not suspended;
  select see_gender into see from public.profiles where id = (select auth.uid());
  if c.id is null or not private.sees(see, c.gender) then perform private.fail('Companion not found.'); end if;
  return private.companion_card(c, (select auth.uid()));
end $$;

-- ───────── Booking views ─────────
create function private.person(pid uuid, viewer uuid) returns jsonb language sql stable set search_path = '' as $$
  select case when p.id is null then null else jsonb_build_object(
    '_id', p.id,
    'fullName', case when p.profile_visibility = 'locked' and not private.unlocked(viewer, p.id) then private.first_name(p.full_name) else p.full_name end,
    'profilePhotoUrl', case when p.profile_visibility = 'locked' and not private.unlocked(viewer, p.id) then null else private.photo_url(p.photo_path) end,
    'locked', p.profile_visibility = 'locked' and not private.unlocked(viewer, p.id),
    'pricePerHour', 399) end
  from (select pid as id) x left join public.profiles p on p.id = x.id
$$;

create function private.booking_json(b public.bookings, viewer uuid) returns jsonb language sql stable set search_path = '' as $$
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
    'allocation', jsonb_build_object('state', b.alloc_state, 'paymentDeadline', b.payment_deadline, 'deadline', b.alloc_deadline, 'assignedAt', b.assigned_at, 'failedReason', b.failed_reason),
    'refund', jsonb_build_object('status', b.refund_status, 'amount', b.refund_amount, 'retained', b.refund_retained, 'reason', b.refund_reason, 'processedAt', b.refund_processed_at),
    'dispute', jsonb_build_object('status', b.dispute_status, 'reason', b.dispute_reason, 'openedAt', b.dispute_opened_at, 'resolution', b.dispute_resolution, 'resolvedAt', b.dispute_resolved_at),
    'cancelledBy', b.cancelled_by, 'cancelReason', b.cancel_reason, 'cancelledAt', b.cancelled_at,
    'createdAt', b.created_at, 'updatedAt', b.updated_at,
    -- The customer sees only how many were tried and the live deadline; a companion only their own offer.
    'offerSummary', case when b.requester_id = viewer then (select jsonb_build_object('tried', count(*), 'liveUntil', max(o.expires_at) filter (where o.status = 'offered')) from public.booking_offers o where o.booking_id = b.id) end,
    'myOffer', case when b.requester_id is distinct from viewer then (select jsonb_build_object('status', o.status, 'expiresAt', o.expires_at, 'offeredAt', o.offered_at) from public.booking_offers o where o.booking_id = b.id and o.companion_id = viewer) end)
$$;

create function public.my_bookings() returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(private.booking_json(b, (select auth.uid())) order by b.created_at desc), '[]'::jsonb)
  from public.bookings b where b.requester_id = (select auth.uid())
$$;

-- Companion: bookings assigned to me, and offers made to me (live or past).
create function public.incoming_bookings() returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(private.booking_json(b, (select auth.uid())) || jsonb_build_object('companionShare',
           coalesce(b.companion_share, floor(b.amount_paid * (1 - (private.pricing() ->> 'platformShare')::numeric))))
         order by b.scheduled_date, b.start_time), '[]'::jsonb)
  from public.bookings b
  where b.companion_id = (select auth.uid())
     or exists (select 1 from public.booking_offers o where o.booking_id = b.id and o.companion_id = (select auth.uid()))
$$;

create function public.get_booking(bid uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare b public.bookings; uid uuid := (select auth.uid());
begin
  select * into b from public.bookings where id = bid;
  if not found or not (b.requester_id = uid or b.companion_id = uid or exists (select 1 from public.booking_offers o where o.booking_id = bid and o.companion_id = uid))
  then perform private.fail('Booking not found.'); end if;
  return private.booking_json(b, uid);
end $$;

-- ───────── Policy text (from the pricing in force) ─────────
create function public.booking_policy() returns jsonb language sql stable security definer set search_path = '' as $$
  with p as (select private.pricing() v)
  select jsonb_build_object(
    'fees', 'No booking fee. One price list for every companion: ₹' || (v -> 'packagePrices' ->> '1') || ' for 1 hour, with lower hourly rates for longer bookings. The price shown is the total you pay, whichever companion accepts — you are never charged more.',
    'allocation', 'Payment reserves your booking; it is confirmed when an eligible companion accepts. Your chosen companion gets between ' || (v ->> 'offerMinMinutes') || ' minutes and ' || round((v ->> 'offerMaxMinutes')::numeric / 60, 1)::text || ' hours to respond, depending on how far away your session is. If they can’t make it, we offer your booking to up to 2 similar verified companions, one at a time (same city, your “show me” preference, available for your chosen duration). If nobody accepts at least 1 hour before the session, it is cancelled and fully refunded.',
    'cancellation', jsonb_build_array(
      'Cancel at least ' || (v ->> 'cancellationCutoffMinutes') || ' minutes before the session starts: ' || round((1 - (v ->> 'cancellationFee')::numeric) * 100) || '% refunded (a ' || round((v ->> 'cancellationFee')::numeric * 100) || '% cancellation fee is kept by prsnn).',
      'Cancel within ' || (v ->> 'cancellationCutoffMinutes') || ' minutes of the start, or after it starts: no refund.',
      'If your companion cancels, or no companion accepts: full refund.',
      'Companion no-show: full refund after review. Your own no-show: no refund.'),
    'refunds', 'Refunds go to your original payment method. Timing depends on your bank or UPI app.',
    'support', private.cfg('support_email'))
  from p
$$;
