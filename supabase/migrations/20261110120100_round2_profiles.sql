-- Round 2 · profiles: categories, contact phone for email sign-ups, photo
-- review (every photo is approved by staff) and companion profile approval
-- (every companion is approved before going live). Staff can ask for changes;
-- the request lands in the person's bell with an action.

alter table public.profiles
  add column if not exists categories text[] not null default '{}',
  add column if not exists photo_status text not null default 'none' check (photo_status in ('none', 'pending', 'approved', 'changes_requested')),
  add column if not exists photo_note text,
  add column if not exists approval_status text not null default 'draft' check (approval_status in ('draft', 'pending', 'approved', 'changes_requested', 'rejected')),
  add column if not exists approval_note text,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid,
  add column if not exists contact_phone text,
  add column if not exists country text;
alter table public.notifications add column if not exists action jsonb;

-- Existing photos and live companions keep working.
update public.profiles set photo_status = 'approved' where photo_path is not null and photo_status = 'none';
update public.profiles set approval_status = 'approved', approved_at = now()
 where role = 'companion' and verification_status in ('id_required', 'pending', 'verified') and approval_status = 'draft';

create or replace function private.categories() returns text[] language sql immutable set search_path = '' as $$
  select array['new_in_town', 'dont_go_alone', 'explore', 'loved_one', 'work_study']
$$;

create or replace function private.notify2(uid uuid, t public.notification_type, msg text, act jsonb) returns void language sql set search_path = '' as $$
  insert into public.notifications (user_id, type, message, action) select uid, t, msg, act where uid is not null
$$;
create or replace function private.notify_staff(t public.notification_type, msg text, act jsonb) returns void language sql set search_path = '' as $$
  insert into public.notifications (user_id, type, message, action)
  select id, t, msg, act from public.profiles where role in ('subadmin', 'superadmin') and not suspended
$$;

-- A new or changed photo goes to review (staff photos are trusted).
create or replace function private.photo_review() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.photo_path is distinct from old.photo_path then
    new.photo_status := case when new.photo_path is null then 'none' when new.role in ('subadmin', 'superadmin') then 'approved' else 'pending' end;
    new.photo_note := null;
  end if;
  return new;
end $$;
create or replace trigger profiles_photo_review before update of photo_path on public.profiles for each row execute function private.photo_review();

create or replace function private.photo_review_notify() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Companions still in profile review are reviewed as a whole; everyone else's photo is queued on its own.
  if new.photo_status = 'pending' and new.photo_path is distinct from old.photo_path and not (new.role = 'companion' and new.approval_status <> 'approved') then
    perform private.notify_staff('approval', 'New photo to review: ' || coalesce(nullif(new.full_name, ''), 'a member') || '.', jsonb_build_object('kind', 'review', 'target', 'photo', 'uid', new.id));
  end if;
  return new;
end $$;
create or replace trigger profiles_photo_review_notify after update of photo_path on public.profiles for each row execute function private.photo_review_notify();

-- Photos are shown to others only once approved.
create or replace function private.public_photo(p public.profiles) returns text language sql stable set search_path = '' as $$
  select case when p.photo_status = 'approved' then private.photo_url(p.photo_path) end
$$;

-- Live = listed, bookable, offered bookings: approved by staff, not suspended, ID not rejected.
create or replace function private.is_live(c public.profiles) returns boolean language sql stable set search_path = '' as $$
  select c.role = 'companion' and not c.suspended and c.approval_status = 'approved' and c.verification_status in ('id_required', 'pending', 'verified')
$$;

create or replace function public.me() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'role', p.role, 'phone', p.phone, 'email', (select u.email from auth.users u where u.id = p.id), 'fullName', p.full_name,
    'is_verified', p.role in ('subadmin', 'superadmin') or p.verification_status = 'verified',
    'verification_status', p.verification_status, 'wantsToBeFellow', p.role = 'companion',
    'profilePhoto', private.photo_url(p.photo_path), 'photoStatus', p.photo_status, 'photoNote', p.photo_note,
    'approvalStatus', p.approval_status, 'approvalNote', p.approval_note,
    'gender', p.gender, 'seeGender', p.see_gender, 'profileVisibility', p.profile_visibility,
    'city', p.city, 'state', p.state, 'area', p.area, 'categories', to_jsonb(p.categories),
    'contactPhone', p.contact_phone, 'country', p.country, 'suspended', p.suspended, 'hasPin', false)
  from public.profiles p where p.id = (select auth.uid())
$$;

-- update_my_profile plus the round-2 fields (categories, contact phone, country).
create or replace function public.save_profile(p jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); cats text[]; ph text;
begin
  if uid is null then perform private.fail('Please log in again.'); end if;
  if p ? 'categories' then
    cats := array(select distinct x from jsonb_array_elements_text(p -> 'categories') x);
    if not cats <@ private.categories() then perform private.fail('Unknown category.'); end if;
    update public.profiles set categories = cats where id = uid;
  end if;
  if p ? 'contactPhone' then
    ph := regexp_replace(coalesce(p ->> 'contactPhone', ''), '[^0-9]', '', 'g');
    if ph <> '' and char_length(ph) not between 8 and 15 then perform private.fail('Enter your mobile number with the country code.'); end if;
    update public.profiles set contact_phone = nullif(ph, '') where id = uid;
  end if;
  if p ? 'country' then update public.profiles set country = nullif(left(trim(p ->> 'country'), 60), '') where id = uid; end if;
  if (p - 'categories' - 'contactPhone' - 'country') <> '{}'::jsonb then
    perform public.update_my_profile(p - 'categories' - 'contactPhone' - 'country');
  end if;
  return public.me();
end $$;

-- Companion sign-up: no ID now; profile goes to staff for approval.
create or replace function public.submit_companion_application(p jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); me public.profiles;
begin
  select * into me from public.profiles where id = uid;
  if me.role in ('subadmin', 'superadmin') then perform private.fail('Staff accounts can''t apply as companions. Use a separate number.'); end if;
  if coalesce(p ->> 'photoPath', me.photo_path, '') = '' then perform private.fail('Add a clear photo of you.'); end if;
  if jsonb_array_length(coalesce(p -> 'categories', to_jsonb(me.categories))) = 0 then perform private.fail('Choose at least one thing you’d enjoy doing.'); end if;
  perform public.save_profile(p);
  update public.profiles set role = 'companion',
    verification_status = case when verification_status in ('pending', 'verified') then verification_status else 'id_required' end,
    approval_status = case when approval_status = 'approved' then 'approved' else 'pending' end, approval_note = null
  where id = uid returning * into me;
  if me.approval_status = 'pending' then
    perform private.notify_staff('approval', 'New companion to review: ' || me.full_name || coalesce(' (' || me.city || ')', '') || '.', jsonb_build_object('kind', 'review', 'target', 'profile', 'uid', uid));
  end if;
  if coalesce(p ->> 'idFrontPath', '') <> '' then
    perform public.submit_id_documents(jsonb_build_object('idType', coalesce(p ->> 'idType', 'aadhaar'), 'idFrontPath', p ->> 'idFrontPath',
      'idBackPath', p ->> 'idBackPath', 'selfiePath', p ->> 'selfiePath'));
  end if;
  return public.me();
end $$;

-- After fixing what staff asked for: back to the queue.
create or replace function public.resubmit_for_review() returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); me public.profiles;
begin
  select * into me from public.profiles where id = uid;
  if me.id is null then perform private.fail('Please log in again.'); end if;
  if me.approval_status in ('changes_requested', 'rejected') then
    update public.profiles set approval_status = 'pending', approval_note = null where id = uid returning * into me;
    perform private.notify_staff('approval', 'Resubmitted for review: ' || me.full_name || '.', jsonb_build_object('kind', 'review', 'target', 'profile', 'uid', uid));
  elsif me.photo_status = 'changes_requested' then
    perform private.fail('Upload a new photo first.');
  end if;
  return public.me();
end $$;

-- ───────── Cards: approved photos only, categories shown ─────────
create or replace function private.companion_card(c public.profiles, viewer uuid) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'id', c.id,
    'fullName', case when c.profile_visibility = 'locked' and not private.unlocked(viewer, c.id) then private.first_name(c.full_name) else c.full_name end,
    'profilePhoto', case when c.profile_visibility = 'locked' and not private.unlocked(viewer, c.id) then null else private.public_photo(c) end,
    'locked', c.profile_visibility = 'locked' and not private.unlocked(viewer, c.id),
    'description', c.description, 'city', c.city, 'area', c.area, 'state', c.state, 'gender', c.gender,
    'tags', to_jsonb(c.tags), 'categories', to_jsonb(c.categories), 'packages', to_jsonb(private.offered_hours(c)), 'availability', c.availability,
    'startTime', c.start_time, 'endTime', c.end_time, 'pricePerHour', 399,
    'idVerified', c.verification_status = 'verified')
$$;
create or replace function private.person(pid uuid, viewer uuid) returns jsonb language sql stable set search_path = '' as $$
  select case when p.id is null then null else jsonb_build_object(
    '_id', p.id,
    'fullName', case when p.profile_visibility = 'locked' and not private.unlocked(viewer, p.id) then private.first_name(p.full_name) else p.full_name end,
    'profilePhotoUrl', case when p.profile_visibility = 'locked' and not private.unlocked(viewer, p.id) then null else private.public_photo(p) end,
    'locked', p.profile_visibility = 'locked' and not private.unlocked(viewer, p.id),
    'idVerified', p.verification_status = 'verified',
    'pricePerHour', 399) end
  from (select pid as id) x left join public.profiles p on p.id = x.id
$$;

-- ───────── Staff: approvals and change requests ─────────
create or replace function private.admin_user_json(p public.profiles) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'fullName', p.full_name, 'phone', coalesce(p.phone, p.contact_phone), 'email', (select u.email from auth.users u where u.id = p.id),
    'role', p.role, 'verificationStatus', p.verification_status,
    'suspended', p.suspended, 'suspendedReason', p.suspended_reason, 'city', p.city, 'area', p.area, 'state', p.state, 'country', p.country, 'gender', p.gender,
    'seeGender', p.see_gender, 'profileVisibility', coalesce(p.profile_visibility, 'open'), 'profilePhotoUrl', private.photo_url(p.photo_path),
    'photoStatus', p.photo_status, 'photoNote', p.photo_note, 'approvalStatus', p.approval_status, 'approvalNote', p.approval_note,
    'categories', to_jsonb(p.categories),
    'idType', p.id_type, 'idFrontPath', p.id_front_path, 'idBackPath', p.id_back_path, 'selfiePath', p.selfie_path,
    'description', p.description, 'tags', to_jsonb(p.tags), 'packages', to_jsonb(p.packages), 'availability', p.availability,
    'startTime', p.start_time, 'endTime', p.end_time, 'hasPushToken', p.push_token is not null, 'createdAt', p.created_at, 'updatedAt', p.updated_at)
$$;

create or replace function public.admin_approvals(kind text) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.need_staff();
  if kind = 'companions' then
    return (select coalesce(jsonb_agg(private.admin_user_json(p) order by p.updated_at), '[]') from public.profiles p where p.role = 'companion' and p.approval_status = 'pending');
  elsif kind = 'photos' then
    return (select coalesce(jsonb_agg(private.admin_user_json(p) order by p.updated_at), '[]') from public.profiles p
             where p.photo_status = 'pending' and not (p.role = 'companion' and p.approval_status <> 'approved'));
  end if;
  perform private.fail('Choose companions or photos.');
end $$;

create or replace function public.admin_approval_counts() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.need_staff();
  return jsonb_build_object(
    'companions', (select count(*) from public.profiles where role = 'companion' and approval_status = 'pending'),
    'photos', (select count(*) from public.profiles p where p.photo_status = 'pending' and not (p.role = 'companion' and p.approval_status <> 'approved')),
    'idChecks', (select count(*) from public.profiles where role = 'companion' and verification_status = 'pending'),
    'panics', (select count(*) from public.panic_alerts where resolved_at is null));
end $$;

create or replace function public.admin_decide_profile(uid uuid, decision text, note text default null) returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.profiles; before_status text;
begin
  perform private.need_staff();
  if decision not in ('approve', 'reject') then perform private.fail('Choose approve or reject.'); end if;
  select approval_status into before_status from public.profiles where id = uid and role = 'companion';
  if before_status is null then perform private.fail('Companion not found.'); end if;
  if decision = 'approve' then
    update public.profiles set approval_status = 'approved', approval_note = null, approved_at = now(), approved_by = (select auth.uid()),
           photo_status = case when photo_path is not null then 'approved' else photo_status end, photo_note = null
     where id = uid returning * into p;
    perform private.notify2(uid, 'approval', 'You’re approved and live. Members' || coalesce(' in ' || p.city, '') || ' can now book you. When your first booking arrives, we’ll ask for a quick ID check.', jsonb_build_object('kind', 'approved'));
  else
    if coalesce(trim(note), '') = '' then perform private.fail('Write a short reason for the companion.'); end if;
    update public.profiles set approval_status = 'rejected', approval_note = left(trim(note), 500) where id = uid returning * into p;
    perform private.notify2(uid, 'action_needed', 'Your companion profile wasn’t approved: ' || left(trim(note), 300), jsonb_build_object('kind', 'rejected', 'target', 'profile'));
  end if;
  perform private.audit('approval.' || decision, 'user', uid::text, jsonb_build_object('approvalStatus', before_status), jsonb_build_object('approvalStatus', p.approval_status, 'note', note));
  return jsonb_build_object('message', case when decision = 'approve' then 'Approved. They’re live.' else 'Rejected. They’ve been told why.' end, 'user', private.admin_user_json(p));
end $$;

create or replace function public.admin_decide_photo(uid uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.profiles;
begin
  perform private.need_staff();
  update public.profiles set photo_status = 'approved', photo_note = null where id = uid and photo_path is not null returning * into p;
  if not found then perform private.fail('No photo to approve.'); end if;
  perform private.notify2(uid, 'approval', 'Your photo is approved.', jsonb_build_object('kind', 'photo_approved'));
  perform private.audit('photo.approve', 'user', uid::text, null, jsonb_build_object('photoStatus', 'approved'));
  return jsonb_build_object('message', 'Photo approved.', 'user', private.admin_user_json(p));
end $$;

-- target: 'photo' (just the photo) or 'profile' (a companion's whole profile).
create or replace function public.admin_request_changes(uid uuid, target text, reasons text[], note text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.profiles; msg text := left(trim(coalesce(note, '')), 500);
begin
  perform private.need_staff();
  if target not in ('photo', 'profile') then perform private.fail('Choose photo or profile.'); end if;
  if msg = '' then perform private.fail('Write a short message so they know what to change.'); end if;
  if target = 'photo' then
    update public.profiles set photo_status = 'changes_requested', photo_note = msg where id = uid and photo_path is not null returning * into p;
  else
    update public.profiles set approval_status = 'changes_requested', approval_note = msg,
           photo_status = case when 'photo' = any (coalesce(reasons, '{}')) then 'changes_requested' else photo_status end,
           photo_note = case when 'photo' = any (coalesce(reasons, '{}')) then msg else photo_note end
     where id = uid and role = 'companion' returning * into p;
  end if;
  if not found then perform private.fail('Nothing to review for this person.'); end if;
  perform private.notify2(uid, 'action_needed', msg, jsonb_build_object('kind', 'fix', 'target', target, 'reasons', to_jsonb(coalesce(reasons, '{}'))));
  perform private.audit('approval.request_changes', 'user', uid::text, null, jsonb_build_object('target', target, 'reasons', reasons, 'note', msg));
  return jsonb_build_object('message', 'Sent. It’s in their notifications.', 'user', private.admin_user_json(p));
end $$;

grant execute on function public.save_profile(jsonb), public.resubmit_for_review(), public.admin_approvals(text), public.admin_approval_counts(),
  public.admin_decide_profile(uuid, text, text), public.admin_decide_photo(uuid), public.admin_request_changes(uuid, text, text[], text) to authenticated;
