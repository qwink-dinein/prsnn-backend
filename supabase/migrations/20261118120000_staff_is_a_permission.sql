-- STATUS: applied 18 Nov (owner approved).
-- Staff is a permission, not a kind of account (owner, 18 Nov).
-- Before: profiles.role was ONE of user | companion | subadmin | superadmin, so making a companion a sub-admin
-- wiped their companion side, and removing an admin turned them into a plain member.
-- Now: profiles.role is what the person is in the marketplace (user | companion); profiles.staff_role
-- (subadmin | superadmin | null) is whether they can use Admin. Every staff check reads staff_role.
-- All RLS policies call public.is_staff() / public.is_superadmin(), so changing those two covers them.

alter table public.profiles add column if not exists staff_role public.user_role;
alter table public.profiles drop constraint if exists profiles_staff_role_check;
alter table public.profiles add constraint profiles_staff_role_check check (staff_role is null or staff_role in ('subadmin', 'superadmin'));

-- Move today's staff over: they keep their staff level and become members (role 'user').
update public.profiles set staff_role = role, role = 'user' where role in ('subadmin', 'superadmin');

-- From now on role is only ever user or companion, so a forgotten old-style write fails loudly instead of
-- silently turning someone into staff.
alter table public.profiles drop constraint if exists profiles_role_market_check;
alter table public.profiles add constraint profiles_role_market_check check (role in ('user', 'companion'));

create index if not exists profiles_staff on public.profiles (staff_role) where staff_role is not null;

-- ── The core checks ──
create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select staff_role is not null from public.profiles where id = (select auth.uid()) and not suspended), false)
$$;

create or replace function public.is_superadmin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select staff_role = 'superadmin' from public.profiles where id = (select auth.uid()) and not suspended), false)
$$;

-- Returns the caller's staff level (callers compare it with 'superadmin').
create or replace function private.need_staff()
returns public.user_role language plpgsql stable security definer set search_path = '' as $$
declare r public.user_role := (select staff_role from public.profiles where id = (select auth.uid()) and not suspended);
begin
  if r is null then perform private.fail('Access denied'); end if;
  return r;
end $$;

-- ── Who gets staff alerts ──
create or replace function private.notify_staff(t public.notification_type, msg text, act jsonb)
returns void language sql set search_path = '' as $$
  insert into public.notifications (user_id, type, message, action)
  select id, t, msg, act from public.profiles where staff_role is not null and not suspended
$$;

create or replace function private.staff_phones()
returns setof text language sql stable set search_path = '' as $$
  select distinct ph from (
    select regexp_replace(coalesce(phone, contact_phone, ''), '\D', '', 'g') ph from public.profiles where staff_role is not null and not suspended
    union select '91' || phone from private.superadmin_phones) x
  where char_length(ph) between 11 and 15
$$;

-- ── Sign-up: everyone is a member or companion; a listed number also gets staff ──
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  ph text := regexp_replace(coalesce(new.phone, ''), '\D', '', 'g');
  r public.user_role := case when new.raw_user_meta_data ->> 'role' = 'companion' then 'companion'::public.user_role else 'user'::public.user_role end;
  sup boolean := exists (select 1 from private.superadmin_phones s where s.phone = right(ph, 10));
  sub boolean := exists (select 1 from private.pending_subadmins s where s.phone = right(ph, 10));
begin
  insert into public.profiles (id, phone, role, staff_role, verification_status, superadmin_via_env)
  values (new.id, nullif(ph, ''), r,
          case when sup then 'superadmin'::public.user_role when sub then 'subadmin'::public.user_role end,
          (case when r = 'user' then 'verified' else 'not_submitted' end)::public.verification_status, sup);
  delete from private.pending_subadmins where phone = right(ph, 10);
  return new;
end $$;

-- Superadmin phone list: adds or removes only the staff level.
create or replace function public.sync_my_role()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.profiles; listed boolean;
begin
  select * into p from public.profiles where id = (select auth.uid());
  if not found then perform private.fail('Account not found.'); end if;
  if p.suspended then perform private.fail('This account is suspended. Contact support if you think this is a mistake.'); end if;
  listed := exists (select 1 from private.superadmin_phones s where s.phone = right(coalesce(p.phone, ''), 10));
  if listed and p.staff_role is distinct from 'superadmin' then
    update public.profiles set staff_role = 'superadmin', superadmin_via_env = true where id = p.id;
  elsif not listed and p.staff_role = 'superadmin' and p.superadmin_via_env then
    update public.profiles set staff_role = null, superadmin_via_env = false where id = p.id;
  end if;
  return public.me();
end $$;

-- ── Adding and removing admins never touches the member / companion side ──
create or replace function public.admin_add_admin(phone text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare ph text := right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10); p public.profiles;
begin
  perform private.need_super();
  if ph !~ '^[6-9][0-9]{9}$' then perform private.fail('Enter a valid 10-digit Indian mobile number.'); end if;
  if exists (select 1 from private.superadmin_phones s where s.phone = ph) then perform private.fail('This number is already a superadmin.'); end if;
  select * into p from public.profiles where right(coalesce(profiles.phone, ''), 10) = ph;
  if found then
    if p.staff_role = 'superadmin' then perform private.fail('This person is already a superadmin.'); end if;
    if p.staff_role = 'subadmin' then perform private.fail('This person is already a sub-admin.'); end if;
    update public.profiles set staff_role = 'subadmin' where id = p.id returning * into p;
    perform private.notify(p.id, 'other', 'You’ve been made a prsnn sub-admin. Tap Admin at the top of the app, or Profile → Admin.');
  else
    insert into private.pending_subadmins (phone, added_by) values (ph, (select auth.uid())) on conflict do nothing;
  end if;
  perform private.audit('admin.add', 'user', coalesce(p.id::text, 'pending-' || ph), null, jsonb_build_object('staffRole', 'subadmin', 'phone', ph));
  return jsonb_build_object('message', case when p.id is null then 'Invited. They become a sub-admin when they first log in with this number.' else 'Sub-admin added.' end,
    'user', case when p.id is null then jsonb_build_object('id', 'pending-' || ph, 'fullName', '', 'phone', '91' || ph, 'role', 'user', 'staffRole', 'subadmin') else private.admin_user_json(p) end);
end $$;

create or replace function public.admin_remove_admin(uid text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.need_super();
  if uid like 'pending-%' then
    delete from private.pending_subadmins where phone = substr(uid, 9);
  else
    update public.profiles set staff_role = null where id = uid::uuid and staff_role = 'subadmin';
    if not found then perform private.fail('Sub-admin not found.'); end if;
  end if;
  perform private.audit('admin.remove', 'user', uid, '{"staffRole":"subadmin"}', '{"staffRole":null}');
  return jsonb_build_object('message', 'Sub-admin removed. Their member or companion account stays as it was.');
end $$;

create or replace function public.admin_admins()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.need_super();
  return (select coalesce(jsonb_agg(private.admin_user_json(p) order by p.staff_role desc, p.created_at), '[]') from public.profiles p where p.staff_role is not null)
    || (select coalesce(jsonb_agg(jsonb_build_object('id', 'pending-' || s.phone, 'fullName', 'Invited · +91 ' || s.phone, 'phone', '91' || s.phone, 'role', 'user', 'staffRole', 'subadmin',
          'verificationStatus', 'verified', 'suspended', false, 'profileVisibility', 'open', 'tags', '[]'::jsonb, 'hasPushToken', false, 'createdAt', s.added_at)), '[]') from private.pending_subadmins s);
end $$;

-- Staff can't act on other staff unless they're a superadmin; superadmins come from the phone list.
create or replace function private.guard_target(uid uuid, allow_self boolean default false)
returns public.profiles language plpgsql stable security definer set search_path = '' as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = uid;
  if not found then perform private.fail('User not found.'); end if;
  if uid = (select auth.uid()) then
    if allow_self then return p; end if;
    perform private.fail('You can’t do this to your own account.');
  end if;
  if p.staff_role = 'superadmin' then perform private.fail('Superadmins are managed through the superadmin phone list.'); end if;
  if p.staff_role = 'subadmin' and not public.is_superadmin() then perform private.fail('Only a superadmin can change staff accounts.'); end if;
  return p;
end $$;

-- ── What the app sees ──
create or replace function private.admin_user_json(p public.profiles)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'fullName', p.full_name, 'phone', coalesce(p.phone, p.contact_phone), 'email', (select u.email from auth.users u where u.id = p.id),
    'role', p.role, 'staffRole', p.staff_role, 'verificationStatus', p.verification_status,
    'suspended', p.suspended, 'suspendedReason', p.suspended_reason, 'city', p.city, 'area', p.area, 'state', p.state, 'country', p.country, 'gender', p.gender,
    'seeGender', p.see_gender, 'profileVisibility', coalesce(p.profile_visibility, 'open'), 'profilePhotoUrl', private.photo_url(p.photo_path),
    'photoStatus', p.photo_status, 'photoNote', p.photo_note, 'approvalStatus', p.approval_status, 'approvalNote', p.approval_note,
    'categories', to_jsonb(p.categories),
    'idType', p.id_type, 'idFrontPath', p.id_front_path, 'idBackPath', p.id_back_path, 'selfiePath', p.selfie_path,
    'description', p.description, 'tags', to_jsonb(p.tags), 'packages', to_jsonb(p.packages), 'availability', p.availability,
    'startTime', p.start_time, 'endTime', p.end_time, 'hasPushToken', p.push_token is not null, 'createdAt', p.created_at, 'updatedAt', p.updated_at)
$$;

create or replace function public.me()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', p.id, 'role', p.role, 'staffRole', p.staff_role, 'phone', p.phone, 'email', (select u.email from auth.users u where u.id = p.id), 'fullName', p.full_name,
    'is_verified', p.verification_status = 'verified',
    'verification_status', p.verification_status, 'wantsToBeFellow', p.role = 'companion',
    'profilePhoto', private.photo_url(p.photo_path), 'photoStatus', p.photo_status, 'photoNote', p.photo_note,
    'approvalStatus', p.approval_status, 'approvalNote', p.approval_note,
    'gender', p.gender, 'seeGender', p.see_gender, 'profileVisibility', p.profile_visibility,
    'city', p.city, 'state', p.state, 'area', p.area, 'categories', to_jsonb(p.categories),
    'contactPhone', p.contact_phone, 'country', p.country, 'suspended', p.suspended, 'hasPin', false)
  from public.profiles p where p.id = (select auth.uid())
$$;

create or replace function public.admin_users(q text default '', role_filter text default '')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare t text := trim(coalesce(q, '')); digits text := regexp_replace(coalesce(q, ''), '\D', '', 'g');
begin
  perform private.need_staff();
  return (select coalesce(jsonb_agg(private.admin_user_json(p) order by p.created_at desc), '[]') from (
    select * from public.profiles p
     where (role_filter = '' or (role_filter = 'staff' and p.staff_role is not null)
            or (role_filter = 'both' and p.role = 'companion' and private.both_sides(p.id)) or p.role::text = role_filter)
       and (t = '' or p.full_name ilike '%' || t || '%' or p.city ilike '%' || t || '%' or (char_length(digits) >= 4 and p.phone like '%' || digits || '%'))
     order by p.created_at desc limit 100) p);
end $$;

-- Staff photos skip review (unchanged rule, now read from staff_role).
create or replace function private.photo_review()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.photo_path is distinct from old.photo_path then
    new.photo_status := case when new.photo_path is null then 'none' when new.staff_role is not null then 'approved' else 'pending' end;
    new.photo_note := null;
  end if;
  return new;
end $$;

-- Staff can now also be companions (same application, ID check and approval as anyone).
create or replace function public.submit_companion_application(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); me public.profiles;
begin
  select * into me from public.profiles where id = uid;
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

create or replace function public.refunds_report(bid uuid, token uuid, ok boolean, provider_id text, err text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if ok then
    update public.bookings set refund_status = 'processed', refund_processed_at = now(), refund_provider_id = coalesce(provider_id, refund_provider_id),
           payment_status = 'refunded', refund_claim_token = null
     where id = bid and (token is null or refund_claim_token = token);
  else
    update public.bookings set refund_status = 'failed', refund_claim_token = null, refund_claimed_at = null
     where id = bid and (token is null or refund_claim_token = token);
    perform private.notify(s.id, 'other', 'A refund for booking #' || b.ref || ' failed: ' || left(coalesce(err, 'unknown error'), 120) || '. Retry it from Admin → Bookings → Refunds.')
      from public.bookings b, public.profiles s
     where b.id = bid and s.staff_role is not null and not s.suspended;
  end if;
end $$;

create or replace function private.delete_account(uid uuid, by_id uuid, why text)
returns void language plpgsql security definer set search_path = '' as $$
declare p public.profiles; n int; joined timestamptz; by_name text; did uuid;
begin
  select * into p from public.profiles where id = uid;
  select count(*) into n from public.bookings where (requester_id = uid or companion_id = uid) and status in ('pending', 'accepted') and payment_status = 'paid';
  if n > 0 then perform private.fail('There ' || case when n = 1 then 'is 1 paid booking' else 'are ' || n || ' paid bookings' end || ' still open. Cancel ' || case when n = 1 then 'it' else 'them' end || ' first (refunds follow the usual rules).'); end if;
  update public.bookings set status = 'cancelled', alloc_state = case when alloc_state is not null then 'cancelled'::public.alloc_state end,
         cancelled_by = case when by_id = uid then case when companion_id = uid then 'companion' else 'requester' end else 'admin' end,
         cancel_reason = 'account_deleted', cancelled_at = now()
   where (requester_id = uid or companion_id = uid) and status in ('pending', 'accepted');
  insert into public.deleted_accounts (original_user_id, phone, role, deleted_by, reason) values (uid, coalesce(p.phone, p.contact_phone), p.role, by_id, left(why, 200)) returning id into did;
  select created_at into joined from auth.users where id = uid;
  select full_name into by_name from public.profiles where id = by_id;
  -- Every admin except the one who did it (they already know).
  insert into public.notifications (user_id, type, message, action)
  select s.id, 'other',
         private.deleted_account_message(p, coalesce(joined, p.created_at), by_id = uid, by_name, case when why like 'Deleted by admin%' then null else why end),
         jsonb_build_object('kind', 'account_deleted', 'role', p.role, 'deletedId', did, 'phone', coalesce(p.phone, p.contact_phone))
    from public.profiles s where s.staff_role is not null and not s.suspended and s.id is distinct from by_id;
  delete from auth.users where id = uid;
end $$;

-- Live preview: staff accounts are members too now, but previewing another staff account stays off.
create or replace function public.admin_view_as(target uuid, fn text, args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare old_claims text := current_setting('request.jwt.claims', true); old_sub text := current_setting('request.jwt.claim.sub', true);
        out jsonb; who public.profiles;
begin
  perform private.need_staff();
  select * into who from public.profiles where id = target;
  if not found then perform private.fail('Person not found.'); end if;
  if who.staff_role is not null then perform private.fail('Pick a member or a companion, not a staff account.'); end if;
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
