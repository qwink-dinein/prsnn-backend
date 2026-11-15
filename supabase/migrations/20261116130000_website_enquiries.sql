-- Website interest list: a mobile number and what the person is interested in (member,
-- companion or both). Written only through submit_enquiry (validated, throttled, one row per
-- number); read only by staff through admin_enquiries. No direct table access for anyone.
create table if not exists public.enquiries (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  interest text not null,
  source text not null default 'website',
  submissions int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint enquiries_phone_unique unique (phone),
  constraint enquiries_phone_format check (phone ~ '^\+[1-9][0-9]{6,14}$'),
  constraint enquiries_interest_check check (interest in ('member', 'companion', 'both')),
  constraint enquiries_source_check check (char_length(source) between 1 and 40)
);
alter table public.enquiries enable row level security;
revoke all on public.enquiries from anon, authenticated;
create index if not exists enquiries_updated on public.enquiries (updated_at desc);

-- phone_number: E.164 (+919876543210). Indian numbers must be 10 digits starting 6–9.
create or replace function public.submit_enquiry(phone_number text, interest_choice text, src text default 'website')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare p text := '+' || regexp_replace(coalesce(phone_number, ''), '\D', '', 'g');
begin
  if interest_choice not in ('member', 'companion', 'both') then perform private.fail('Choose what you’re interested in.'); end if;
  if p ~ '^\+91' and p !~ '^\+91[6-9][0-9]{9}$' then perform private.fail('Enter a 10-digit mobile number.'); end if;
  if p !~ '^\+[1-9][0-9]{6,14}$' then perform private.fail('Enter your mobile number with the country code.'); end if;
  -- Throttle: a burst of sign-ups from bots shouldn't fill the table.
  if (select count(*) from public.enquiries where updated_at > now() - interval '1 minute') >= 60 then
    perform private.fail('Lots of people are signing up right now. Please try again in a minute.');
  end if;
  insert into public.enquiries (phone, interest, source) values (p, interest_choice, left(coalesce(nullif(src, ''), 'website'), 40))
  on conflict (phone) do update
    set interest = excluded.interest, source = excluded.source, submissions = public.enquiries.submissions + 1, updated_at = now()
    where public.enquiries.updated_at < now() - interval '10 seconds';
  return jsonb_build_object('ok', true);
end $$;
revoke execute on function public.submit_enquiry(text, text, text) from public;
grant execute on function public.submit_enquiry(text, text, text) to anon, authenticated;

create or replace function public.admin_enquiries(lim int default 200) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.need_staff();
  return jsonb_build_object(
    'counts', (select jsonb_build_object('total', count(*), 'member', count(*) filter (where interest = 'member'),
                 'companion', count(*) filter (where interest = 'companion'), 'both', count(*) filter (where interest = 'both')) from public.enquiries),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('phone', phone, 'interest', interest, 'source', source, 'submissions', submissions,
                 'createdAt', created_at, 'updatedAt', updated_at) order by updated_at desc), '[]')
              from (select * from public.enquiries order by updated_at desc limit greatest(1, least(lim, 1000))) e));
end $$;
revoke execute on function public.admin_enquiries(int) from public, anon;
grant execute on function public.admin_enquiries(int) to authenticated;
