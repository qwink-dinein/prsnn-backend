-- In-app admin (ADMIN_SPEC.md) on Supabase. Every function checks the caller's
-- current role from profiles (so a removed or suspended admin loses access at
-- once); money, prices, admins and the activity log need superadmin.

-- Sub-admins added by phone before they have an account are promoted at sign-up.
create table private.pending_subadmins (phone text primary key check (phone ~ '^[6-9][0-9]{9}$'), added_by uuid, added_at timestamptz default now());

create or replace function private.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  ph text := regexp_replace(coalesce(new.phone, ''), '\D', '', 'g');
  r public.user_role := case when new.raw_user_meta_data ->> 'role' = 'companion' then 'companion' else 'user' end;
  sup boolean := exists (select 1 from private.superadmin_phones s where s.phone = right(ph, 10));
  sub boolean := exists (select 1 from private.pending_subadmins s where s.phone = right(ph, 10));
begin
  insert into public.profiles (id, phone, role, verification_status, superadmin_via_env)
  values (new.id, nullif(ph, ''), case when sup then 'superadmin' when sub then 'subadmin' else r end,
          case when sup or sub or r = 'user' then 'verified' else 'not_submitted' end, sup);
  delete from private.pending_subadmins where phone = right(ph, 10);
  return new;
end $$;

create function private.need_staff() returns public.user_role language plpgsql stable security definer set search_path = '' as $$
declare r public.user_role := public.my_role();
begin
  if r is null or r not in ('subadmin', 'superadmin') then perform private.fail('Access denied'); end if;
  return r;
end $$;
create function private.need_super() returns void language plpgsql stable security definer set search_path = '' as $$
begin if not public.is_superadmin() then perform private.fail('Access denied'); end if; end $$;

-- Staff see people in full (names, phones), never locked.
create function private.admin_person(pid uuid) returns jsonb language sql stable set search_path = '' as $$
  select case when p.id is null then null else jsonb_build_object('_id', p.id, 'fullName', p.full_name, 'phone', p.phone, 'role', p.role,
    'profilePhotoUrl', private.photo_url(p.photo_path)) end
  from (select pid as id) x left join public.profiles p on p.id = x.id
$$;

create function private.admin_booking_json(b public.bookings) returns jsonb language sql stable set search_path = '' as $$
  select private.booking_json(b, null) || jsonb_build_object(
    'requesterId', coalesce(private.admin_person(b.requester_id), 'null'::jsonb),
    'companionId', private.admin_person(b.companion_id),
    'preferredCompanionId', private.admin_person(b.preferred_companion_id),
    'companionShare', case when public.is_superadmin() then b.companion_share end,
    'platformShare', case when public.is_superadmin() and b.companion_share is not null then b.amount_paid - b.companion_share end,
    'refund', jsonb_build_object('status', b.refund_status, 'amount', b.refund_amount, 'retained', b.refund_retained, 'reason', b.refund_reason, 'processedAt', b.refund_processed_at, 'attempts', b.refund_attempts),
    'refundReview', jsonb_build_object('needed', b.refund_review_needed, 'note', b.refund_review_note, 'requestedAt', b.refund_review_at),
    'offers', (select coalesce(jsonb_agg(jsonb_build_object('_id', o.id, 'companionId', private.admin_person(o.companion_id), 'status', o.status, 'offeredAt', o.offered_at, 'expiresAt', o.expires_at) order by o.offered_at), '[]') from public.booking_offers o where o.booking_id = b.id),
    'dispute', jsonb_build_object('status', b.dispute_status, 'reason', b.dispute_reason, 'openedAt', b.dispute_opened_at, 'openedBy', private.admin_person(b.dispute_opened_by),
      'resolution', b.dispute_resolution, 'resolvedAt', b.dispute_resolved_at,
      'notes', (select coalesce(jsonb_agg(jsonb_build_object('by', n.by_id, 'role', n.role, 'message', n.message, 'at', n.at) order by n.at), '[]') from public.dispute_notes n where n.booking_id = b.id)))
$$;

create function private.admin_user_json(p public.profiles) returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', p.id, 'fullName', p.full_name, 'phone', p.phone, 'role', p.role, 'verificationStatus', p.verification_status,
    'suspended', p.suspended, 'suspendedReason', p.suspended_reason, 'city', p.city, 'area', p.area, 'state', p.state, 'gender', p.gender,
    'seeGender', p.see_gender, 'profileVisibility', coalesce(p.profile_visibility, 'open'), 'profilePhotoUrl', private.photo_url(p.photo_path),
    'idFrontPath', p.id_front_path, 'idBackPath', p.id_back_path, 'selfiePath', p.selfie_path,
    'description', p.description, 'tags', to_jsonb(p.tags), 'packages', to_jsonb(p.packages), 'availability', p.availability,
    'startTime', p.start_time, 'endTime', p.end_time, 'hasPushToken', p.push_token is not null, 'createdAt', p.created_at)
$$;

-- ───────── Overview ─────────
create function public.admin_overview() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r public.user_role := private.need_staff(); out jsonb;
begin
  out := jsonb_build_object('role', r,
    'pendingVerifications', (select count(*) from public.profiles where role = 'companion' and verification_status = 'pending'),
    'liveBookings', (select count(*) from public.bookings where status in ('pending', 'accepted')),
    'openDisputes', (select count(*) from public.bookings where dispute_status = 'open'),
    'refundsToReview', (select count(*) from public.bookings where refund_review_needed),
    'failedRefunds', (select count(*) from public.bookings where refund_status = 'failed'),
    'members', (select count(*) from public.profiles where role = 'user'),
    'companions', (select count(*) from public.profiles where role = 'companion' and verification_status = 'verified'),
    'bookingsToday', (select count(*) from public.bookings where created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'));
  if r = 'superadmin' then
    out := out || (select jsonb_build_object('money', jsonb_build_object(
      'collected', coalesce(sum(amount_paid), 0),
      'refunded', coalesce(sum(refund_amount) filter (where refund_status = 'processed'), 0),
      'companionPayouts', coalesce(sum(companion_share) filter (where status in ('accepted', 'completed')), 0),
      'platformNet', coalesce(sum(amount_paid), 0) - coalesce(sum(refund_amount) filter (where refund_status = 'processed'), 0) - coalesce(sum(companion_share) filter (where status in ('accepted', 'completed')), 0)))
      from public.bookings where payment_status in ('paid', 'refunded'));
  end if;
  return out;
end $$;

-- ───────── Verify ─────────
create function public.admin_verifications() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.need_staff();
  return (select coalesce(jsonb_agg(private.admin_user_json(p) order by p.updated_at), '[]') from public.profiles p where p.role = 'companion' and p.verification_status = 'pending');
end $$;

create function public.admin_decide_verification(uid uuid, decision text, note text default null) returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.profiles;
begin
  perform private.need_staff();
  if decision not in ('verified', 'rejected') then perform private.fail('Choose verify or reject.'); end if;
  update public.profiles set verification_status = decision::public.verification_status, verified_by = (select auth.uid())
   where id = uid and role = 'companion' returning * into p;
  if not found then perform private.fail('Companion not found.'); end if;
  perform private.notify(uid, 'other', case when decision = 'verified' then 'You’re verified. Customers can now book you on prsnn.'
    else 'Your verification wasn’t approved' || coalesce(': ' || left(note, 200), '.') || ' You can update your details and submit again.' end);
  perform private.audit('verification.' || case when decision = 'verified' then 'approve' else 'reject' end, 'user', uid::text,
    '{"verificationStatus":"pending"}', jsonb_build_object('verificationStatus', decision) || case when note is not null then jsonb_build_object('note', left(note, 200)) else '{}' end);
  return jsonb_build_object('message', case when decision = 'verified' then 'Companion verified.' else 'Companion rejected.' end, 'user', private.admin_user_json(p));
end $$;

-- ───────── Users ─────────
create function public.admin_users(q text default '', role_filter text default '') returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare t text := trim(coalesce(q, '')); digits text := regexp_replace(coalesce(q, ''), '\D', '', 'g');
begin
  perform private.need_staff();
  return (select coalesce(jsonb_agg(private.admin_user_json(p) order by p.created_at desc), '[]') from (
    select * from public.profiles p
     where (role_filter = '' or (role_filter = 'staff' and p.role in ('subadmin', 'superadmin')) or p.role::text = role_filter)
       and (t = '' or p.full_name ilike '%' || t || '%' or p.city ilike '%' || t || '%' or (char_length(digits) >= 4 and p.phone like '%' || digits || '%'))
     order by p.created_at desc limit 100) p);
end $$;

create function public.admin_user(uid uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare p public.profiles;
begin
  perform private.need_staff();
  select * into p from public.profiles where id = uid;
  if not found then perform private.fail('User not found.'); end if;
  return jsonb_build_object('user', private.admin_user_json(p), 'bookings',
    (select coalesce(jsonb_agg(private.admin_booking_json(b) order by b.created_at desc), '[]') from (select * from public.bookings where requester_id = uid or companion_id = uid order by created_at desc limit 20) b));
end $$;

-- Only a superadmin acts on staff; superadmins are managed by the phone list; nobody suspends/deletes themselves.
create function private.guard_target(uid uuid, allow_self boolean default false) returns public.profiles language plpgsql stable security definer set search_path = '' as $$
declare p public.profiles;
begin
  select * into p from public.profiles where id = uid;
  if not found then perform private.fail('User not found.'); end if;
  if uid = (select auth.uid()) then
    if allow_self then return p; end if;
    perform private.fail('You can’t do this to your own account.');
  end if;
  if p.role = 'superadmin' then perform private.fail('Superadmins are managed through the superadmin phone list.'); end if;
  if p.role = 'subadmin' and not public.is_superadmin() then perform private.fail('Only a superadmin can change staff accounts.'); end if;
  return p;
end $$;

create function public.admin_update_user(uid uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare before public.profiles; after public.profiles; hrs int[];
begin
  perform private.need_staff();
  before := private.guard_target(uid, true);
  update public.profiles set
    full_name = coalesce(left(trim(p ->> 'fullName'), 80), full_name),
    city = case when p ? 'city' then nullif(trim(p ->> 'city'), '') else city end,
    area = case when p ? 'area' then nullif(trim(p ->> 'area'), '') else area end,
    state = case when p ? 'state' then nullif(trim(p ->> 'state'), '') else state end,
    description = case when p ? 'description' then nullif(left(p ->> 'description', 1000), '') else description end,
    gender = case when p ? 'gender' then (p ->> 'gender')::public.gender else gender end,
    see_gender = case when p ? 'seeGender' then (p ->> 'seeGender')::public.see_gender else see_gender end,
    profile_visibility = case when p ? 'profileVisibility' then (p ->> 'profileVisibility')::public.visibility else profile_visibility end,
    start_time = case when p ? 'startTime' then nullif(p ->> 'startTime', '') else start_time end,
    end_time = case when p ? 'endTime' then nullif(p ->> 'endTime', '') else end_time end,
    tags = case when p ? 'tags' then array(select left(trim(x), 30) from jsonb_array_elements_text(p -> 'tags') x where trim(x) <> '' limit 15) else tags end,
    packages = case when p ? 'packages' then array(select distinct x::int from jsonb_array_elements_text(p -> 'packages') x where x::int between 1 and 12 order by 1) else packages end,
    availability = case when p ? 'availability' then (select jsonb_object_agg(d, coalesce((p -> 'availability' ->> d)::boolean, false)) from unnest(array['monday','tuesday','wednesday','thursday','friday','saturday','sunday']) d) else availability end
  where id = uid returning * into after;
  if after.packages is not null and cardinality(after.packages) = 0 then perform private.fail('Choose at least one duration you offer.'); end if;
  perform private.audit('user.edit', 'user', uid::text, to_jsonb(before) - 'push_token', to_jsonb(after) - 'push_token');
  return jsonb_build_object('message', 'Saved.', 'user', private.admin_user_json(after));
end $$;

create function public.admin_suspend_user(uid uuid, on_off boolean, reason text default null) returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.profiles;
begin
  perform private.need_staff();
  perform private.guard_target(uid);
  update public.profiles set suspended = on_off, suspended_at = case when on_off then now() end,
    suspended_reason = case when on_off then nullif(left(reason, 200), '') end
   where id = uid returning * into p;
  perform private.audit(case when on_off then 'user.suspend' else 'user.unsuspend' end, 'user', uid::text, jsonb_build_object('suspended', not on_off), jsonb_build_object('suspended', on_off, 'reason', reason));
  return jsonb_build_object('message', case when on_off then 'Account suspended.' else 'Account restored.' end, 'user', private.admin_user_json(p));
end $$;

-- Deleting removes the auth user (profile cascades); bookings stay for accounting.
create function private.delete_account(uid uuid, by_id uuid, why text) returns void language plpgsql security definer set search_path = '' as $$
declare p public.profiles; n int;
begin
  select * into p from public.profiles where id = uid;
  select count(*) into n from public.bookings where (requester_id = uid or companion_id = uid) and status in ('pending', 'accepted') and payment_status = 'paid';
  if n > 0 then perform private.fail('There ' || case when n = 1 then 'is 1 paid booking' else 'are ' || n || ' paid bookings' end || ' still open. Cancel ' || case when n = 1 then 'it' else 'them' end || ' first (refunds follow the usual rules).'); end if;
  update public.bookings set status = 'cancelled', alloc_state = case when alloc_state is not null then 'cancelled'::public.alloc_state end,
         cancelled_by = case when by_id = uid then case when companion_id = uid then 'companion' else 'requester' end else 'admin' end,
         cancel_reason = 'account_deleted', cancelled_at = now()
   where (requester_id = uid or companion_id = uid) and status in ('pending', 'accepted');
  insert into public.deleted_accounts (original_user_id, phone, role, deleted_by, reason) values (uid, p.phone, p.role, by_id, left(why, 200));
  delete from auth.users where id = uid;
end $$;

create function public.delete_my_account() returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if public.is_staff() then perform private.fail('Staff accounts are removed by a superadmin.'); end if;
  perform private.delete_account((select auth.uid()), (select auth.uid()), 'Self-service deletion (app)');
  return jsonb_build_object('message', 'Your account has been deleted.');
end $$;

create function public.admin_delete_user(uid uuid, reason text default null) returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.profiles;
begin
  perform private.need_staff();
  p := private.guard_target(uid);
  perform private.delete_account(uid, (select auth.uid()), coalesce(reason, 'Deleted by admin (app)'));
  perform private.audit('user.delete', 'user', uid::text, jsonb_build_object('role', p.role, 'fullName', p.full_name, 'phone', p.phone), '{}');
  return jsonb_build_object('message', 'Account deleted.');
end $$;

-- ───────── Sub-admins (superadmin) ─────────
create function public.admin_admins() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.need_super();
  return (select coalesce(jsonb_agg(private.admin_user_json(p) order by p.role desc, p.created_at), '[]') from public.profiles p where p.role in ('subadmin', 'superadmin'))
    || (select coalesce(jsonb_agg(jsonb_build_object('id', 'pending-' || s.phone, 'fullName', 'Invited · +91 ' || s.phone, 'phone', '91' || s.phone, 'role', 'subadmin',
          'verificationStatus', 'verified', 'suspended', false, 'profileVisibility', 'open', 'tags', '[]'::jsonb, 'hasPushToken', false, 'createdAt', s.added_at)), '[]') from private.pending_subadmins s);
end $$;

create function public.admin_add_admin(phone text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare ph text := right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10); p public.profiles;
begin
  perform private.need_super();
  if ph !~ '^[6-9][0-9]{9}$' then perform private.fail('Enter a valid 10-digit Indian mobile number.'); end if;
  if exists (select 1 from private.superadmin_phones s where s.phone = ph) then perform private.fail('This number is already a superadmin.'); end if;
  select * into p from public.profiles where right(coalesce(profiles.phone, ''), 10) = ph;
  if found then
    if p.role = 'superadmin' then perform private.fail('This person is already a superadmin.'); end if;
    update public.profiles set role = 'subadmin', verification_status = 'verified' where id = p.id returning * into p;
    perform private.notify(p.id, 'other', 'You’ve been made a prsnn sub-admin. Open Profile → Admin in the app.');
  else
    insert into private.pending_subadmins (phone, added_by) values (ph, (select auth.uid())) on conflict do nothing;
  end if;
  perform private.audit('admin.add', 'user', coalesce(p.id::text, 'pending-' || ph), null, jsonb_build_object('role', 'subadmin', 'phone', ph));
  return jsonb_build_object('message', case when p.id is null then 'Invited. They become a sub-admin when they first log in with this number.' else 'Sub-admin added.' end,
    'user', case when p.id is null then jsonb_build_object('id', 'pending-' || ph, 'fullName', '', 'phone', '91' || ph, 'role', 'subadmin') else private.admin_user_json(p) end);
end $$;

create function public.admin_remove_admin(uid text) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.need_super();
  if uid like 'pending-%' then
    delete from private.pending_subadmins where phone = substr(uid, 9);
  else
    update public.profiles set role = 'user' where id = uid::uuid and role = 'subadmin';
    if not found then perform private.fail('Sub-admin not found.'); end if;
  end if;
  perform private.audit('admin.remove', 'user', uid, '{"role":"subadmin"}', '{"role":"user"}');
  return jsonb_build_object('message', 'Sub-admin removed.');
end $$;

-- ───────── Bookings ─────────
create function public.admin_bookings(tab text) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.need_staff();
  return (select coalesce(jsonb_agg(private.admin_booking_json(b) order by
      case when tab = 'refunds' then (case when b.refund_review_needed then 0 when b.refund_status = 'failed' then 1 when b.refund_status = 'pending' then 2 else 3 end) else 0 end,
      case when tab = 'live' then private.session_start(b.scheduled_date, b.start_time) end,
      b.updated_at desc), '[]')
    from (select * from public.bookings b where
            (tab = 'live' and b.status in ('pending', 'accepted'))
         or (tab = 'refunds' and (b.refund_review_needed or b.refund_status <> 'none'))
         or (tab = 'done' and b.status in ('completed', 'cancelled', 'rejected'))
          order by b.updated_at desc limit 150) b);
end $$;

create function public.admin_booking(bid uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare b public.bookings;
begin
  perform private.need_staff();
  select * into b from public.bookings where id = bid;
  if not found then perform private.fail('Booking not found.'); end if;
  return private.admin_booking_json(b);
end $$;

create function public.admin_booking_messages(bid uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.need_staff();
  if not exists (select 1 from public.bookings where id = bid and dispute_status <> 'none') then perform private.fail('Chats are only visible for bookings with a reported problem.'); end if;
  perform private.audit('booking.read_chat', 'booking', bid::text, null, null);
  return (select coalesce(jsonb_agg(jsonb_build_object('_id', m.id, 'senderId', m.sender_id, 'senderName', p.full_name, 'senderRole', p.role, 'content', m.content, 'createdAt', m.created_at) order by m.created_at), '[]')
    from public.messages m left join public.profiles p on p.id = m.sender_id where m.booking_id = bid);
end $$;

create function public.admin_update_booking(bid uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare b0 public.bookings; b public.bookings;
begin
  perform private.need_staff();
  select * into b0 from public.bookings where id = bid;
  if not found then perform private.fail('Booking not found.'); end if;
  if p ? 'status' and (p ->> 'status' <> 'completed' or b0.status <> 'accepted') then perform private.fail('Only a confirmed booking can be marked completed. Use Cancel to cancel.'); end if;
  if p ? 'startTime' and not private.within_day(p ->> 'startTime', b0.duration_min) then perform private.fail('The session must fit between ' || (private.pricing() ->> 'dayStart') || ' and ' || (private.pricing() ->> 'dayEnd') || '.'); end if;
  update public.bookings set
    scheduled_date = coalesce((p ->> 'scheduledDate')::date, scheduled_date),
    start_time = coalesce(p ->> 'startTime', start_time),
    message = coalesce(left(p ->> 'message', 300), message),
    city = coalesce(p ->> 'city', city), area = coalesce(p ->> 'area', area),
    status = coalesce((p ->> 'status')::public.booking_status, status)
  where id = bid returning * into b;
  if p ? 'scheduledDate' or p ? 'startTime' then
    perform private.notify(b.requester_id, 'other', 'Booking #' || b.ref || ' was rescheduled by prsnn support. Check the new time in the app.');
    perform private.notify(b.companion_id, 'other', 'Booking #' || b.ref || ' was rescheduled by prsnn support. Check the new time in the app.');
  end if;
  perform private.audit('booking.edit', 'booking', bid::text, jsonb_build_object('scheduledDate', b0.scheduled_date, 'startTime', b0.start_time, 'status', b0.status, 'message', b0.message), p);
  return jsonb_build_object('message', 'Booking updated.', 'booking', private.admin_booking_json(b));
end $$;

-- Sub-admin: no money moves; a paid booking is flagged for a superadmin's refund decision.
create function public.admin_cancel_booking(bid uuid, reason text, refund_amount numeric default null) returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.user_role := private.need_staff(); b public.bookings; res text := 'none';
begin
  if char_length(trim(coalesce(reason, ''))) < 3 then perform private.fail('Give a short reason.'); end if;
  if refund_amount is not null and r <> 'superadmin' then perform private.fail('Only a superadmin can refund.'); end if;
  select * into b from public.bookings where id = bid for update;
  if not found then perform private.fail('Booking not found.'); end if;
  if b.status not in ('pending', 'accepted') then perform private.fail('This booking is already closed.'); end if;
  if refund_amount is not null and (refund_amount < 0 or refund_amount > case when b.payment_status = 'paid' then b.amount_paid else 0 end) then
    perform private.fail('Refund must be between ₹0 and ₹' || case when b.payment_status = 'paid' then b.amount_paid::int else 0 end || '.');
  end if;
  update public.bookings set status = 'cancelled', alloc_state = case when alloc_state is not null then 'cancelled'::public.alloc_state end,
         cancelled_by = 'admin', cancel_reason = left(reason, 200), cancelled_at = now()
   where id = bid returning * into b;
  update public.booking_offers set status = 'withdrawn' where booking_id = bid and status = 'offered';
  if b.payment_status = 'paid' then
    if refund_amount is not null then
      if refund_amount > 0 then res := private.refund(bid, refund_amount, left('Admin cancelled: ' || reason, 200)); end if;
      update public.bookings set refund_retained = amount_paid - refund_amount, refund_review_needed = false where id = bid;
    else
      update public.bookings set refund_review_needed = true, refund_review_note = left(reason, 200), refund_review_by = (select auth.uid()), refund_review_at = now() where id = bid;
    end if;
  end if;
  perform private.notify(b.requester_id, 'booking_cancelled', 'Booking #' || b.ref || ' was cancelled by prsnn support.' ||
    case when coalesce(refund_amount, 0) > 0 then ' ₹' || refund_amount::int || ' is being refunded.' when b.payment_status = 'paid' then ' We’ll update you about the refund.' else '' end);
  perform private.notify(b.companion_id, 'booking_cancelled', 'Booking #' || b.ref || ' was cancelled by prsnn support.');
  perform private.audit('booking.cancel', 'booking', bid::text, '{"status":"open"}', jsonb_build_object('status', 'cancelled', 'reason', reason, 'refundAmount', refund_amount, 'refund', res));
  select * into b from public.bookings where id = bid;
  return jsonb_build_object('message', case when b.payment_status = 'paid' and refund_amount is null then 'Cancelled. A superadmin will decide the refund.'
    when coalesce(refund_amount, 0) > 0 then 'Cancelled. ₹' || refund_amount::int || ' refund ' || res || '.' else 'Cancelled.' end, 'booking', private.admin_booking_json(b));
end $$;

create function public.admin_reassign_booking(bid uuid, cid uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.bookings; c public.profiles; prev uuid;
begin
  perform private.need_staff();
  select * into b from public.bookings where id = bid for update;
  if not found then perform private.fail('Booking not found.'); end if;
  if b.status not in ('pending', 'accepted') then perform private.fail('Only open bookings can be reassigned.'); end if;
  if b.payment_status <> 'paid' then perform private.fail('This booking isn’t paid yet.'); end if;
  select * into c from public.profiles where id = cid;
  if c.id is null or c.role <> 'companion' or c.verification_status <> 'verified' or c.suspended then perform private.fail('That person isn’t an active verified companion.'); end if;
  if cid = b.requester_id then perform private.fail('The customer can’t be their own companion.'); end if;
  prev := b.companion_id;
  update public.bookings set companion_id = cid, status = 'accepted', alloc_state = 'assigned', assigned_at = now(),
         companion_share = floor(amount_paid * (1 - (private.pricing() ->> 'platformShare')::numeric))
   where id = bid returning * into b;
  update public.booking_offers set status = 'withdrawn' where booking_id = bid and status = 'offered';
  perform private.notify(cid, 'booking_confirmed', 'prsnn support assigned booking #' || b.ref || ' to you. Chat is open.');
  if prev is not null and prev <> cid then perform private.notify(prev, 'booking_cancelled', 'Booking #' || b.ref || ' was moved to another companion by prsnn support.'); end if;
  perform private.notify(b.requester_id, 'other', 'Your booking #' || b.ref || ' now has a new companion: ' || c.full_name || '.');
  perform private.audit('booking.reassign', 'booking', bid::text, jsonb_build_object('companionId', prev), jsonb_build_object('companionId', cid));
  return jsonb_build_object('message', 'Booking reassigned.', 'booking', private.admin_booking_json(b));
end $$;

create function public.admin_refund(bid uuid, amount numeric, reason text default 'Refund by prsnn support') returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.bookings; res text;
begin
  perform private.need_super();
  select * into b from public.bookings where id = bid;
  if not found then perform private.fail('Booking not found.'); end if;
  if b.refund_status in ('pending', 'processed') then perform private.fail('A refund has already been issued for this booking.'); end if;
  if b.payment_status <> 'paid' then perform private.fail('Only a paid booking can be refunded.'); end if;
  if amount is null or amount <= 0 or amount > b.amount_paid then perform private.fail('Refund must be more than ₹0 and at most ₹' || b.amount_paid::int || '.'); end if;
  res := private.refund(bid, amount, coalesce(reason, 'Refund by prsnn support'));
  update public.bookings set refund_retained = amount_paid - amount, refund_review_needed = false where id = bid returning * into b;
  perform private.notify(b.requester_id, 'refund', 'Refund of ₹' || amount::int || ' started for booking #' || b.ref || '.');
  perform private.audit('booking.refund', 'booking', bid::text, jsonb_build_object('refundStatus', 'none'), jsonb_build_object('amount', amount, 'reason', reason, 'result', res));
  return jsonb_build_object('message', 'Refund of ₹' || amount::int || ' ' || res || '.', 'result', res, 'booking', private.admin_booking_json(b));
end $$;

create function public.admin_retry_refund(bid uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.bookings; res text;
begin
  perform private.need_super();
  select * into b from public.bookings where id = bid;
  if b.refund_status is distinct from 'failed' then perform private.fail('Only a failed refund can be retried.'); end if;
  res := private.refund(bid, b.refund_amount, coalesce(b.refund_reason, 'Retry by prsnn support'));
  if res = 'skipped' then perform private.fail('This refund can’t be retried any more (too many attempts). Refund it from the Razorpay dashboard.'); end if;
  perform private.audit('booking.refund_retry', 'booking', bid::text, jsonb_build_object('attempts', b.refund_attempts), jsonb_build_object('result', res));
  select * into b from public.bookings where id = bid;
  return jsonb_build_object('message', 'Retry ' || res || '.', 'booking', private.admin_booking_json(b));
end $$;

create function public.admin_mark_paid(bid uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.bookings;
begin
  perform private.need_super();
  select * into b from public.bookings where id = bid;
  if not found then perform private.fail('Booking not found.'); end if;
  if b.payment_status = 'paid' then perform private.fail('Already paid.'); end if;
  if b.status in ('cancelled', 'rejected') then perform private.fail('This booking is closed.'); end if;
  b := private.mark_paid(bid, 'admin_' || extract(epoch from now())::bigint, b.package_price, 'simulated');
  perform private.audit('booking.mark_paid', 'booking', bid::text, '{"paymentStatus":"pending"}', jsonb_build_object('paymentStatus', 'paid', 'amount', b.package_price));
  return jsonb_build_object('message', 'Marked paid (₹' || b.package_price || ', simulated).', 'booking', private.admin_booking_json(b));
end $$;

create function public.admin_override_fee(bid uuid, retained numeric) returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.bookings; amt numeric; res text := 'none';
begin
  perform private.need_super();
  select * into b from public.bookings where id = bid;
  if not found or b.status <> 'cancelled' or b.payment_status <> 'paid' then perform private.fail('Only a cancelled, paid booking has a cancellation fee.'); end if;
  if b.refund_status in ('pending', 'processed') then perform private.fail('The refund has already gone out, so the fee can’t change.'); end if;
  if retained < 0 or retained > b.amount_paid then perform private.fail('Fee must be between ₹0 and ₹' || b.amount_paid::int || '.'); end if;
  amt := b.amount_paid - retained;
  if amt > 0 then res := private.refund(bid, amt, 'Cancellation fee set to ₹' || retained::int || ' by prsnn support'); end if;
  update public.bookings set refund_retained = retained, refund_review_needed = false where id = bid returning * into b;
  if amt > 0 then perform private.notify(b.requester_id, 'refund', 'Refund of ₹' || amt::int || ' started for booking #' || b.ref || '.'); end if;
  perform private.audit('booking.override_fee', 'booking', bid::text, null, jsonb_build_object('retained', retained, 'refund', amt, 'result', res));
  return jsonb_build_object('message', 'Fee set to ₹' || retained::int || '.' || case when amt > 0 then ' ₹' || amt::int || ' refund ' || res || '.' else ' Nothing to refund.' end, 'booking', private.admin_booking_json(b));
end $$;

create function public.admin_delete_booking(bid uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.bookings;
begin
  perform private.need_super();
  select * into b from public.bookings where id = bid;
  if not found then perform private.fail('Booking not found.'); end if;
  if b.payment_status = 'paid' and b.status in ('pending', 'accepted') then perform private.fail('This booking is paid and still open. Cancel and refund it first.'); end if;
  if b.refund_status = 'pending' then perform private.fail('A refund is still in progress.'); end if;
  delete from public.bookings where id = bid;
  perform private.audit('booking.delete', 'booking', bid::text, jsonb_build_object('status', b.status, 'paymentStatus', b.payment_status, 'amountPaid', b.amount_paid), '{}');
  return jsonb_build_object('message', 'Booking deleted.');
end $$;

-- ───────── Disputes ─────────
create function public.admin_disputes(st text) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.need_staff();
  return (select coalesce(jsonb_agg(private.admin_booking_json(b) order by b.dispute_opened_at), '[]') from public.bookings b where b.dispute_status::text = st);
end $$;

create function public.admin_reply_dispute(bid uuid, msg text, to_whom text default 'both') returns jsonb language plpgsql security definer set search_path = '' as $$
declare r public.user_role := private.need_staff(); b public.bookings;
begin
  if char_length(trim(coalesce(msg, ''))) < 2 then perform private.fail('Write a reply.'); end if;
  select * into b from public.bookings where id = bid and dispute_status <> 'none';
  if not found then perform private.fail('Dispute not found.'); end if;
  insert into public.dispute_notes (booking_id, by_id, role, message) values (bid, (select auth.uid()), r, left(trim(msg), 1000));
  if to_whom <> 'companion' then perform private.notify(b.requester_id, 'dispute', 'prsnn support about booking #' || b.ref || ': ' || left(msg, 400)); end if;
  if to_whom <> 'requester' then perform private.notify(b.companion_id, 'dispute', 'prsnn support about booking #' || b.ref || ': ' || left(msg, 400)); end if;
  perform private.audit('dispute.reply', 'booking', bid::text, null, jsonb_build_object('to', to_whom, 'message', left(msg, 200)));
  return jsonb_build_object('message', 'Reply sent.', 'booking', private.admin_booking_json(b));
end $$;

create function public.admin_close_dispute(bid uuid, resolution text) returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.bookings;
begin
  perform private.need_staff();
  if char_length(trim(coalesce(resolution, ''))) < 3 then perform private.fail('Write how it was resolved.'); end if;
  update public.bookings set dispute_status = 'resolved', dispute_resolution = left(trim(resolution), 1000), dispute_resolved_by = (select auth.uid()), dispute_resolved_at = now()
   where id = bid and dispute_status = 'open' returning * into b;
  if not found then perform private.fail('No open dispute on this booking.'); end if;
  perform private.notify(b.requester_id, 'dispute', 'Your report on booking #' || b.ref || ' is resolved: ' || left(resolution, 300));
  perform private.notify(b.companion_id, 'dispute', 'Your report on booking #' || b.ref || ' is resolved: ' || left(resolution, 300));
  perform private.audit('dispute.close', 'booking', bid::text, '{"status":"open"}', jsonb_build_object('status', 'resolved', 'resolution', left(resolution, 200)));
  return jsonb_build_object('message', 'Dispute closed.', 'booking', private.admin_booking_json(b));
end $$;

-- ───────── Prices (superadmin) ─────────
create function public.admin_save_pricing(p jsonb, reprice_unpaid boolean default false) returns jsonb language plpgsql security definer set search_path = '' as $$
declare cur jsonb := private.pricing(); v jsonb; h int; a int; b int; n int := 0;
begin
  perform private.need_super();
  v := cur || (p - 'packagePrices' - 'repriceUnpaid') || jsonb_build_object('packagePrices', (cur -> 'packagePrices') || coalesce(p -> 'packagePrices', '{}'));
  for h in 1..12 loop
    if (v -> 'packagePrices' ->> h::text) !~ '^[0-9]+$' or (v -> 'packagePrices' ->> h::text)::int not between 1 and 100000 then perform private.fail('Price for ' || h || ' h must be a whole number of rupees.'); end if;
  end loop;
  for h in 2..12 loop
    a := (v -> 'packagePrices' ->> (h - 1)::text)::int; b := (v -> 'packagePrices' ->> h::text)::int;
    if b <= a then perform private.fail(h || ' h (₹' || b || ') must cost more than ' || (h - 1) || ' h (₹' || a || ').'); end if;
    if b::numeric / h >= a::numeric / (h - 1) then perform private.fail(h || ' h must cost less per hour than ' || (h - 1) || ' h.'); end if;
  end loop;
  if (v ->> 'platformShare')::numeric not between 0 and 0.5 then perform private.fail('platformShare must be between 0 and 0.5.'); end if;
  if (v ->> 'cancellationFee')::numeric not between 0 and 1 then perform private.fail('cancellationFee must be between 0 and 1.'); end if;
  if (v ->> 'offerMinMinutes')::int < 5 or (v ->> 'offerMaxMinutes')::int < (v ->> 'offerMinMinutes')::int then perform private.fail('Offer window: min ≥ 5 minutes and max ≥ min.'); end if;
  if (v ->> 'dayStart') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' or (v ->> 'dayEnd') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or private.minutes_of(v ->> 'dayEnd') - private.minutes_of(v ->> 'dayStart') < 60 then perform private.fail('Day start/end must be HH:MM, at least an hour apart.'); end if;
  if jsonb_array_length(coalesce(v -> 'headlineHours', '[]')) = 0 then perform private.fail('Choose at least one headline package.'); end if;
  update public.settings set value = v, updated_by = (select auth.uid()), updated_at = now() where key = 'pricing';
  if reprice_unpaid then
    update public.bookings set package_price = (v -> 'packagePrices' ->> (duration_min / 60)::text)::int
     where alloc_state = 'awaiting_payment' and payment_status = 'pending' and package_price <> (v -> 'packagePrices' ->> (duration_min / 60)::text)::int;
    get diagnostics n = row_count;
  end if;
  perform private.audit('settings.pricing', 'settings', 'pricing', cur, v || case when reprice_unpaid then jsonb_build_object('repricedUnpaid', n) else '{}' end);
  return jsonb_build_object('message', case when reprice_unpaid then 'Prices saved. ' || n || ' unpaid booking' || case when n = 1 then '' else 's' end || ' re-priced.' else 'Prices saved. New bookings use them now.' end,
    'pricing', v, 'repriced', n);
end $$;

-- ───────── Activity / audience ─────────
create function public.admin_activity(before_at timestamptz default null) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.need_super();
  return (select coalesce(jsonb_agg(jsonb_build_object('_id', a.id, 'action', a.action, 'role', a.role, 'actorId', a.actor_id, 'actorName', coalesce(p.full_name, ''),
      'target', jsonb_build_object('kind', a.target_kind, 'id', a.target_id), 'before', a.before, 'after', a.after, 'at', a.at) order by a.at desc), '[]')
    from (select * from public.audit_log where before_at is null or at < before_at order by at desc limit 50) a left join public.profiles p on p.id = a.actor_id);
end $$;

create function public.admin_audience() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.need_super();
  return jsonb_build_object(
    'members', (select count(*) from public.profiles where role = 'user' and not suspended and push_token is not null),
    'companions', (select count(*) from public.profiles where role = 'companion' and verification_status = 'verified' and not suspended and push_token is not null));
end $$;

-- ───────── Storage ─────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avatars', 'avatars', true, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']),
  ('verification', 'verification', false, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
-- Files live under <user id>/...; you write only your own folder. ID documents are readable by you and staff only.
create policy "avatar upload" on storage.objects for insert to authenticated with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatar update" on storage.objects for update to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatar delete" on storage.objects for delete to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "id upload" on storage.objects for insert to authenticated with check (bucket_id = 'verification' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "id read" on storage.objects for select to authenticated using (bucket_id = 'verification' and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_staff())));
