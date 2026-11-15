-- Consent log: a timestamped record of every agreement a member, companion or website visitor gives
-- (DPDP Act 2023 proof of consent; IT Rules 2021). One row per agreement; rows are never edited
-- except to mark a withdrawal, and they survive account deletion (user_id is cleared, the phone
-- number at the time is kept) so we can show what was agreed and when.
--
-- kinds:
--   terms, privacy, age_18, whatsapp_updates  · at sign-in (the sign-in screen's agreement line)
--   house_rules                                · before the first booking or companion application
--   companion_terms                            · when a companion sends their application
--   booking_terms                              · every booking (price, cancellation and refund terms)
--   photo_visibility                           · when someone opens their photo to everyone
--   enquiry_contact                            · website "Count me in" (contact on WhatsApp, 18+)
-- version: the date of the policy text agreed to (private.legal_version()).

create or replace function private.legal_version() returns text language sql immutable set search_path = '' as $$ select '2026-11-16' $$;

create table if not exists public.consents (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles (id) on delete set null,
  phone text,
  kind text not null,
  version text not null,
  booking_id uuid references public.bookings (id) on delete set null,
  source text not null default 'app',
  user_agent text,
  accepted_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  constraint consents_kind_check check (kind in ('terms', 'privacy', 'age_18', 'whatsapp_updates', 'house_rules', 'companion_terms', 'booking_terms', 'photo_visibility', 'enquiry_contact')),
  constraint consents_source_check check (source in ('app', 'web', 'system')),
  constraint consents_version_len check (char_length(version) between 1 and 20),
  constraint consents_ua_len check (user_agent is null or char_length(user_agent) <= 400)
);
alter table public.consents enable row level security;
revoke all on public.consents from anon, authenticated;
create index if not exists consents_user on public.consents (user_id, kind, accepted_at desc);
create index if not exists consents_booking on public.consents (booking_id);
create index if not exists consents_phone on public.consents (phone);

create or replace function private.user_agent() returns text language sql stable set search_path = '' as $$
  select left(nullif(current_setting('request.headers', true), '')::json ->> 'user-agent', 400)
$$;

create or replace function private.log_consent(uid uuid, k text, ver text default null, bid uuid default null, src text default 'app', ph text default null)
returns void language plpgsql security definer set search_path = '' as $$
begin
  insert into public.consents (user_id, phone, kind, version, booking_id, source, user_agent)
  values (uid,
          coalesce(ph, (select coalesce(p.phone, p.contact_phone) from public.profiles p where p.id = uid)),
          k, coalesce(nullif(ver, ''), private.legal_version()), bid, src, private.user_agent());
end $$;

create or replace function private.has_consent(uid uuid, k text) returns boolean language sql stable set search_path = '' as $$
  select exists (select 1 from public.consents c where c.user_id = uid and c.kind = k and c.withdrawn_at is null)
$$;

/** The caller agrees to one or more things shown in the app. Same kind + version again is a no-op. */
create or replace function public.record_consents(kinds text[], ver text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); k text; v text := coalesce(nullif(ver, ''), private.legal_version());
begin
  if uid is null then perform private.fail('Please sign in again.'); end if;
  if kinds is null or cardinality(kinds) = 0 or cardinality(kinds) > 8 then perform private.fail('Nothing to agree to.'); end if;
  foreach k in array kinds loop
    if k not in ('terms', 'privacy', 'age_18', 'whatsapp_updates', 'house_rules', 'companion_terms') then
      perform private.fail('Unknown agreement.');
    end if;
    if not exists (select 1 from public.consents c where c.user_id = uid and c.kind = k and c.version = v and c.withdrawn_at is null) then
      perform private.log_consent(uid, k, v);
    end if;
  end loop;
  return public.my_consents();
end $$;

/** My current agreements: the latest per kind (booking terms are per booking, so left out). */
create or replace function public.my_consents() returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'version', version, 'acceptedAt', accepted_at) order by kind), '[]')
  from (select distinct on (kind) kind, version, accepted_at from public.consents
        where user_id = auth.uid() and withdrawn_at is null and kind <> 'booking_terms'
        order by kind, accepted_at desc) x
$$;

/** Staff: every agreement a user gave, newest first (proof of consent for complaints). */
create or replace function public.admin_user_consents(uid uuid) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.need_staff();
  return (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'version', version, 'source', source, 'bookingId', booking_id,
            'acceptedAt', accepted_at, 'withdrawnAt', withdrawn_at) order by accepted_at desc), '[]')
          from public.consents where user_id = uid);
end $$;

revoke execute on function public.record_consents(text[], text) from public, anon;
revoke execute on function public.my_consents() from public, anon;
revoke execute on function public.admin_user_consents(uuid) from public, anon;
grant execute on function public.record_consents(text[], text) to authenticated;
grant execute on function public.my_consents() to authenticated;
grant execute on function public.admin_user_consents(uuid) to authenticated;
revoke execute on function private.log_consent(uuid, text, text, uuid, text, text) from public;

-- Bookings: the member must have agreed to the house rules; each booking logs the terms agreed to.
-- (Only bookings a member makes for themselves are checked; staff and system inserts are not.)
create or replace function private.bookings_consent_check() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and auth.uid() = new.requester_id and not private.has_consent(new.requester_id, 'house_rules') then
    perform private.fail('Please read and agree to the prsnn house rules first.');
  end if;
  return new;
end $$;
drop trigger if exists bookings_consent_check on public.bookings;
create trigger bookings_consent_check before insert on public.bookings for each row execute function private.bookings_consent_check();

create or replace function private.bookings_consent_log() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and auth.uid() = new.requester_id then
    perform private.log_consent(new.requester_id, 'booking_terms', null, new.id);
  end if;
  return null;
end $$;
drop trigger if exists bookings_consent_log on public.bookings;
create trigger bookings_consent_log after insert on public.bookings for each row execute function private.bookings_consent_log();

-- Companion applications: Companion Terms and house rules must be agreed before review.
create or replace function private.profiles_consent_check() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.approval_status = 'pending' and old.approval_status is distinct from 'pending'
     and auth.uid() is not null and auth.uid() = new.id
     and not (private.has_consent(new.id, 'companion_terms') and private.has_consent(new.id, 'house_rules')) then
    perform private.fail('Please agree to the Companion Terms and house rules before sending.');
  end if;
  return new;
end $$;
drop trigger if exists profiles_consent_check on public.profiles;
create trigger profiles_consent_check before update of approval_status on public.profiles for each row execute function private.profiles_consent_check();

-- Opening your photo to everyone is a consent too (visibility_consent_at already holds the latest).
create or replace function private.profiles_visibility_log() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.visibility_consent_at is not null and new.visibility_consent_at is distinct from old.visibility_consent_at then
    perform private.log_consent(new.id, 'photo_visibility');
  end if;
  return null;
end $$;
drop trigger if exists profiles_visibility_log on public.profiles;
create trigger profiles_visibility_log after update of visibility_consent_at on public.profiles for each row execute function private.profiles_visibility_log();

-- Website interest form: logs the visitor's agreement to be contacted (and that they're 18+).
create or replace function public.submit_enquiry(phone_number text, interest_choice text, src text default 'website')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p text := '+' || regexp_replace(coalesce(phone_number, ''), '\D', '', 'g'); n int;
begin
  if interest_choice not in ('member', 'companion', 'both') then perform private.fail('Choose what you’re interested in.'); end if;
  if p ~ '^\+91' and p !~ '^\+91[6-9][0-9]{9}$' then perform private.fail('Enter a 10-digit mobile number.'); end if;
  if p !~ '^\+[1-9][0-9]{6,14}$' then perform private.fail('Enter your mobile number with the country code.'); end if;
  if (select count(*) from public.enquiries where updated_at > now() - interval '1 minute') >= 60 then
    perform private.fail('Lots of people are signing up right now. Please try again in a minute.');
  end if;
  insert into public.enquiries (phone, interest, source) values (p, interest_choice, left(coalesce(nullif(src, ''), 'website'), 40))
  on conflict (phone) do update
    set interest = excluded.interest, source = excluded.source, submissions = public.enquiries.submissions + 1, updated_at = now()
    where public.enquiries.updated_at < now() - interval '10 seconds';
  get diagnostics n = row_count;
  if n > 0 then perform private.log_consent(null, 'enquiry_contact', null, null, 'web', p); end if;
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.submit_enquiry(text, text, text) from public;
grant execute on function public.submit_enquiry(text, text, text) to anon, authenticated;
