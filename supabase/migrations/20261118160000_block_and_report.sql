-- Block and report another person (Apple App Review Guideline 1.2 for apps with chat; also good safety).
-- A block works both ways: neither sees the other in Search or on a profile, they aren't matched for a
-- booking, and neither can send the other a message. It doesn't cancel a paid booking (cancel rules apply).
-- A report goes to staff (notification + Admin → Reports) with the reason; reporting can also block.

create table if not exists public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index if not exists blocks_blocked on public.blocks (blocked_id);
alter table public.blocks enable row level security; -- read and written only through the functions below

create table if not exists public.user_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles (id) on delete set null,
  reported_id uuid references public.profiles (id) on delete set null,
  booking_id uuid references public.bookings (id) on delete set null,
  reason text not null check (reason in ('inappropriate', 'harassment', 'fake_profile', 'not_allowed', 'safety', 'other')),
  details text check (char_length(details) <= 1000),
  status text not null default 'open' check (status in ('open', 'closed')),
  resolution text,
  handled_by uuid references public.profiles (id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists user_reports_open on public.user_reports (created_at desc) where status = 'open';
create index if not exists user_reports_reported on public.user_reports (reported_id);
create index if not exists user_reports_reporter on public.user_reports (reporter_id, created_at);
create index if not exists user_reports_booking on public.user_reports (booking_id);
create index if not exists user_reports_handled_by on public.user_reports (handled_by);
alter table public.user_reports enable row level security;

-- Is there a block between these two people, in either direction?
create or replace function private.blocked(a uuid, b uuid)
returns boolean language sql stable set search_path = '' as $$
  select a is not null and b is not null and exists (
    select 1 from public.blocks where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a))
$$;

create or replace function private.report_reason_label(r text)
returns text language sql immutable set search_path = '' as $$
  select case r when 'inappropriate' then 'Inappropriate messages or behaviour' when 'harassment' then 'Harassment or threats'
    when 'fake_profile' then 'Fake profile or not who they say' when 'not_allowed' then 'Asked for something not allowed'
    when 'safety' then 'Safety concern' else 'Something else' end
$$;

-- ── For everyone ──
create or replace function public.block_user(uid uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if me is null then perform private.fail('Please log in again.'); end if;
  if uid = me then perform private.fail('You can’t block yourself.'); end if;
  if not exists (select 1 from public.profiles where id = uid) then perform private.fail('Person not found.'); end if;
  insert into public.blocks (blocker_id, blocked_id) values (me, uid) on conflict do nothing;
  return jsonb_build_object('message', 'Blocked. You won’t see each other, be matched or message each other.');
end $$;

create or replace function public.unblock_user(uid uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  delete from public.blocks where blocker_id = (select auth.uid()) and blocked_id = uid;
  return jsonb_build_object('message', 'Unblocked.');
end $$;

create or replace function public.my_blocks()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', private.first_name(p.full_name), 'photo', private.public_photo(p), 'at', k.created_at)
         order by k.created_at desc), '[]'::jsonb)
  from public.blocks k join public.profiles p on p.id = k.blocked_id
  where k.blocker_id = (select auth.uid())
$$;

create or replace function public.report_user(uid uuid, reason text, details text default null, bid uuid default null, also_block boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); rid uuid; who public.profiles; reporter public.profiles;
begin
  if me is null then perform private.fail('Please log in again.'); end if;
  if uid = me then perform private.fail('You can’t report yourself.'); end if;
  select * into who from public.profiles where id = uid;
  if not found then perform private.fail('Person not found.'); end if;
  if reason not in ('inappropriate', 'harassment', 'fake_profile', 'not_allowed', 'safety', 'other') then perform private.fail('Choose a reason.'); end if;
  if reason = 'other' and coalesce(trim(details), '') = '' then perform private.fail('Tell us what happened.'); end if;
  if (select count(*) from public.user_reports where reporter_id = me and created_at > now() - interval '1 day') >= 10 then
    perform private.fail('You’ve sent a lot of reports today. For anything urgent, use Help & support or call 112.');
  end if;
  if bid is not null and not exists (select 1 from public.bookings b where b.id = bid and ((b.requester_id = me and b.companion_id = uid) or (b.companion_id = me and b.requester_id = uid))) then
    bid := null; -- only link a booking between these two people
  end if;
  insert into public.user_reports (reporter_id, reported_id, booking_id, reason, details)
  values (me, uid, bid, reason, nullif(left(trim(coalesce(details, '')), 1000), '')) returning id into rid;
  if also_block then insert into public.blocks (blocker_id, blocked_id) values (me, uid) on conflict do nothing; end if;
  select * into reporter from public.profiles where id = me;
  perform private.notify_staff('other',
    'New report: ' || coalesce(nullif(reporter.full_name, ''), 'A member') || ' reported ' || coalesce(nullif(who.full_name, ''), 'someone')
      || ' (' || case when who.role = 'companion' then 'companion' else 'member' end || '): ' || private.report_reason_label(reason) || '.',
    jsonb_build_object('kind', 'report', 'reportId', rid));
  return jsonb_build_object('message', case when also_block then 'Thanks. We’ve got your report and blocked them. Our team will look into it.'
                                            else 'Thanks. We’ve got your report. Our team will look into it.' end);
end $$;

-- ── Staff ──
create or replace function public.admin_reports(st text default 'open')
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.need_staff();
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'reason', r.reason, 'reasonLabel', private.report_reason_label(r.reason), 'details', r.details, 'status', r.status,
      'resolution', r.resolution, 'createdAt', r.created_at, 'handledAt', r.handled_at,
      'reporter', jsonb_build_object('id', a.id, 'name', a.full_name, 'phone', coalesce(a.phone, a.contact_phone), 'role', a.role),
      'reported', jsonb_build_object('id', t.id, 'name', t.full_name, 'phone', coalesce(t.phone, t.contact_phone), 'role', t.role, 'suspended', t.suspended,
                                     'reportsTotal', (select count(*) from public.user_reports x where x.reported_id = t.id)),
      'booking', case when b.id is not null then jsonb_build_object('id', b.id, 'ref', b.ref) end) order by r.created_at desc), '[]'::jsonb)
    from (select * from public.user_reports where (coalesce(st, '') = '' or status = st) order by created_at desc limit 200) r
    left join public.profiles a on a.id = r.reporter_id
    left join public.profiles t on t.id = r.reported_id
    left join public.bookings b on b.id = r.booking_id);
end $$;

create or replace function public.admin_close_report(rid uuid, resolution text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.need_staff();
  update public.user_reports set status = 'closed', resolution = nullif(left(trim(coalesce($2, '')), 500), ''),
         handled_by = (select auth.uid()), handled_at = now()
   where id = rid and status = 'open';
  if not found then perform private.fail('Report not found or already closed.'); end if;
  perform private.audit('report.close', 'report', rid::text, null, jsonb_build_object('resolution', $2));
  return jsonb_build_object('message', 'Report closed.');
end $$;

-- ── A block hides, unmatches and silences ──
create or replace function public.list_companions(see text default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  with v as (select p.id, p.see_gender from public.profiles p where p.id = (select auth.uid()))
  select coalesce(jsonb_agg(private.companion_card(c, (select id from v)) order by (c.verification_status = 'verified') desc, c.created_at desc), '[]'::jsonb)
  from public.profiles c
  where private.is_live(c)
    and c.id is distinct from (select id from v)
    and private.sees(coalesce((select see_gender from v), nullif(see, '')::public.see_gender), c.gender)
    and not private.blocked(c.id, (select id from v))
$$;

create or replace function public.get_companion(cid uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare c public.profiles; see public.see_gender;
begin
  select * into c from public.profiles where id = cid;
  select see_gender into see from public.profiles where id = (select auth.uid());
  if c.id is null or not private.is_live(c) or not private.sees(see, c.gender) or private.blocked(c.id, (select auth.uid())) then
    perform private.fail('Companion not found.');
  end if;
  return private.companion_card(c, (select auth.uid()));
end $$;

create or replace function private.eligible(c public.profiles, b public.bookings, see public.see_gender)
returns boolean language sql stable set search_path = '' as $$
  select private.is_live(c)
     and c.id is distinct from b.requester_id
     and not private.blocked(c.id, b.requester_id)
     and private.sees(see, c.gender)
     and (b.city is null or lower(c.city) = lower(b.city))
     and private.available_at(c, b.scheduled_date, b.start_time)
     and (b.duration_min / 60) = any (private.offered_hours(c))
     and not exists (select 1 from public.booking_offers o where o.booking_id = b.id and o.companion_id = c.id)
     and not private.has_conflict(c.id, b)
$$;

-- Sending a message needs an open chat and no block between the two people (history stays readable).
create or replace function public.chat_open(b uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.bookings x
                  where x.id = b and x.status = 'accepted' and x.payment_status = 'paid' and now() < upper(x.slot)
                    and (x.requester_id = (select auth.uid()) or x.companion_id = (select auth.uid()))
                    and not private.blocked(x.requester_id, x.companion_id))
$$;

revoke all on function public.block_user(uuid), public.unblock_user(uuid), public.my_blocks(), public.report_user(uuid, text, text, uuid, boolean),
  public.admin_reports(text), public.admin_close_report(uuid, text) from public, anon;
grant execute on function public.block_user(uuid), public.unblock_user(uuid), public.my_blocks(), public.report_user(uuid, text, text, uuid, boolean),
  public.admin_reports(text), public.admin_close_report(uuid, text) to authenticated;
