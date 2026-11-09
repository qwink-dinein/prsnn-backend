-- prsnn on Supabase: core schema.
-- Everyone signs in with phone OTP (Supabase Auth). public.profiles holds the
-- app's data for each auth user. Private data (phone, ID documents, push token)
-- is readable only by the owner and staff; other people see companions and
-- booking partners through security-definer functions that apply the privacy
-- rules (gender filter, locked photos).

create extension if not exists pg_cron;
create extension if not exists pg_net;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ───────── Types ─────────
create type public.user_role as enum ('user', 'companion', 'subadmin', 'superadmin');
create type public.verification_status as enum ('not_submitted', 'pending', 'verified', 'rejected');
create type public.gender as enum ('woman', 'man', 'nonbinary');
create type public.see_gender as enum ('woman', 'man', 'nonbinary', 'everyone');
create type public.visibility as enum ('open', 'locked');
create type public.booking_status as enum ('pending', 'accepted', 'rejected', 'completed', 'cancelled');
create type public.payment_status as enum ('pending', 'paid', 'failed', 'refunded');
create type public.alloc_state as enum ('awaiting_payment', 'offering', 'assigned', 'failed', 'cancelled');
create type public.offer_status as enum ('offered', 'accepted', 'declined', 'expired', 'withdrawn');
create type public.refund_status as enum ('none', 'pending', 'processed', 'failed');
create type public.dispute_status as enum ('none', 'open', 'resolved');
create type public.notification_type as enum ('booking_request', 'booking_accepted', 'payment_completed', 'booking_offer', 'booking_confirmed', 'booking_cancelled', 'refund', 'dispute', 'other');

-- ───────── Profiles ─────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  phone text unique,                                  -- 91XXXXXXXXXX, from auth
  role public.user_role not null default 'user',
  verification_status public.verification_status not null default 'not_submitted',
  superadmin_via_env boolean not null default false,
  full_name text not null default '',
  city text, state text, area text,
  gender public.gender,
  see_gender public.see_gender,
  profile_visibility public.visibility,
  visibility_consent_at timestamptz,
  description text,
  tags text[] not null default '{}',
  packages int[],                                     -- hours offered (companions)
  availability jsonb not null default '{}'::jsonb,    -- { monday: true, ... }
  start_time text, end_time text,                     -- 'HH:MM'
  photo_path text,                                    -- storage: avatars/<id>/...
  id_front_path text, id_back_path text, selfie_path text, -- storage: verification/<id>/...
  verified_by uuid,
  suspended boolean not null default false,
  suspended_at timestamptz, suspended_reason text,
  push_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint full_name_len check (char_length(full_name) <= 80),
  constraint description_len check (description is null or char_length(description) <= 1000)
);
create index profiles_listing on public.profiles (role, verification_status, suspended, city);
create index profiles_push on public.profiles (role) where push_token is not null;

-- ───────── Settings (pricing etc.) ─────────
create table public.settings (
  key text primary key,
  value jsonb not null,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.settings (key, value) values ('pricing', jsonb_build_object(
  'packagePrices', jsonb_build_object('1',399,'2',699,'3',999,'4',1299,'5',1599,'6',1899,'7',2199,'8',2499,'9',2799,'10',3099,'11',3349,'12',3599),
  'platformShare', 0.2, 'cancellationFee', 0.15, 'cancellationCutoffMinutes', 15,
  'offerMinMinutes', 15, 'offerMaxMinutes', 300, 'dayStart', '07:00', 'dayEnd', '22:00',
  'headlineHours', jsonb_build_array(1,2,4,6,12)));

-- Server-only configuration (not readable by clients).
create table private.config (key text primary key, value text not null);
insert into private.config values ('payment_mode', 'simulated'), ('support_email', 'mukarramjahmm@gmail.com'), ('max_offers', '3');
-- Phones promoted to superadmin at login (10 digits). Owner adds them in the SQL editor:
--   insert into private.superadmin_phones values ('98XXXXXXXX');
create table private.superadmin_phones (phone text primary key check (phone ~ '^[6-9][0-9]{9}$'));

-- ───────── Bookings ─────────
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  ref text generated always as (upper(right(replace(id::text, '-', ''), 6))) stored,
  flow text not null default 'prepaid' check (flow in ('prepaid', 'request')),
  requester_id uuid not null references public.profiles (id) on delete restrict,
  companion_id uuid references public.profiles (id) on delete set null,
  preferred_companion_id uuid references public.profiles (id) on delete set null,
  idempotency_key text,
  status public.booking_status not null default 'pending',
  scheduled_date date not null,
  start_time text not null check (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  duration_min int not null check (duration_min between 30 and 720),
  package_price int not null,
  price_per_hour int not null default 399,
  companion_share int,
  message text not null default '', experience text, city text, area text,
  -- payment
  payment_status public.payment_status not null default 'pending',
  payment_mode text check (payment_mode in ('razorpay', 'simulated')),
  razorpay_order_id text, razorpay_payment_id text,
  amount_paid numeric(10,2) not null default 0,
  paid_at timestamptz,
  -- allocation
  alloc_state public.alloc_state,
  payment_deadline timestamptz,
  alloc_deadline timestamptz,
  assigned_at timestamptz,
  failed_reason text,
  -- refund
  refund_status public.refund_status not null default 'none',
  refund_amount numeric(10,2) not null default 0,
  refund_retained numeric(10,2) not null default 0,
  refund_reason text, refund_provider_id text,
  refund_requested_at timestamptz, refund_processed_at timestamptz,
  refund_attempts int not null default 0,
  refund_review_needed boolean not null default false,
  refund_review_note text, refund_review_by uuid, refund_review_at timestamptz,
  -- cancellation
  cancelled_by text check (cancelled_by in ('requester', 'companion', 'system', 'admin')),
  cancel_reason text, cancelled_at timestamptz,
  -- dispute
  dispute_status public.dispute_status not null default 'none',
  dispute_reason text, dispute_opened_by uuid, dispute_opened_at timestamptz,
  dispute_resolution text, dispute_resolved_by uuid, dispute_resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (requester_id, idempotency_key)
);
create index bookings_requester on public.bookings (requester_id, created_at desc);
create index bookings_companion on public.bookings (companion_id, scheduled_date);
create index bookings_alloc on public.bookings (alloc_state) where alloc_state in ('awaiting_payment', 'offering');
create index bookings_dispute on public.bookings (dispute_status) where dispute_status <> 'none';
create index bookings_refund on public.bookings (refund_status) where refund_status <> 'none' or refund_review_needed;

create table public.booking_offers (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  companion_id uuid not null references public.profiles (id) on delete cascade,
  status public.offer_status not null default 'offered',
  offered_at timestamptz not null default now(),
  expires_at timestamptz not null,
  responded_at timestamptz,
  unique (booking_id, companion_id)
);
create index offers_live on public.booking_offers (companion_id, status, expires_at);

create table public.dispute_notes (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  by_id uuid references public.profiles (id) on delete set null,
  role public.user_role,
  message text not null check (char_length(message) <= 1000),
  at timestamptz not null default now()
);

-- ───────── Chat ─────────
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  content text not null check (char_length(content) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index messages_booking on public.messages (booking_id, created_at);

-- ───────── Notifications, audit, broadcasts ─────────
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  type public.notification_type not null,
  message text not null,
  is_read boolean not null default false,
  pushed_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user on public.notifications (user_id, created_at desc);
create index notifications_unpushed on public.notifications (created_at) where pushed_at is null;

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles (id) on delete set null,
  role public.user_role,
  action text not null,
  target_kind text, target_id text,
  before jsonb, after jsonb,
  at timestamptz not null default now()
);
create index audit_at on public.audit_log (at desc);

create table public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  audience text not null check (audience in ('members', 'companions')),
  title text not null, body text not null,
  sent_by uuid references public.profiles (id) on delete set null,
  recipients int not null default 0, sent int not null default 0, failed int not null default 0, batches int not null default 0,
  created_at timestamptz not null default now()
);

create table public.deleted_accounts (
  id uuid primary key default gen_random_uuid(),
  original_user_id uuid not null,
  phone text, role public.user_role,
  deleted_by uuid, reason text,
  deleted_at timestamptz not null default now()
);

-- ───────── updated_at ─────────
create function private.touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger profiles_touch before update on public.profiles for each row execute function private.touch();
create trigger bookings_touch before update on public.bookings for each row execute function private.touch();

-- ───────── Role helpers (stable, security definer, used by RLS) ─────────
create function public.my_role() returns public.user_role language sql stable security definer set search_path = '' as $$
  select role from public.profiles where id = (select auth.uid()) and not suspended
$$;
create function public.is_staff() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select role in ('subadmin', 'superadmin') from public.profiles where id = (select auth.uid()) and not suspended), false)
$$;
create function public.is_superadmin() returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select role = 'superadmin' from public.profiles where id = (select auth.uid()) and not suspended), false)
$$;

-- ───────── Row level security ─────────
alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.bookings enable row level security;
alter table public.booking_offers enable row level security;
alter table public.dispute_notes enable row level security;
alter table public.messages enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_log enable row level security;
alter table public.broadcasts enable row level security;
alter table public.deleted_accounts enable row level security;

-- Profiles: you read your own row; staff read all. All writes go through functions.
create policy "own profile" on public.profiles for select to authenticated using (id = (select auth.uid()) or (select public.is_staff()));
-- Prices are public.
create policy "settings readable" on public.settings for select to anon, authenticated using (true);
-- Bookings: parties read their own; staff read all. Writes via functions only.
create policy "party bookings" on public.bookings for select to authenticated
  using (requester_id = (select auth.uid()) or companion_id = (select auth.uid()) or (select public.is_staff()));
create policy "own offers" on public.booking_offers for select to authenticated using (companion_id = (select auth.uid()) or (select public.is_staff()));
create policy "dispute notes" on public.dispute_notes for select to authenticated using (
  (select public.is_staff()) or exists (select 1 from public.bookings b where b.id = booking_id and (b.requester_id = (select auth.uid()) or b.companion_id = (select auth.uid()))));
-- Chat: both parties of a confirmed, paid booking; staff only when a dispute exists.
create function public.can_chat(b uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.bookings x where x.id = b and x.status in ('accepted', 'completed') and x.payment_status = 'paid'
    and (x.requester_id = (select auth.uid()) or x.companion_id = (select auth.uid())))
$$;
create policy "chat read" on public.messages for select to authenticated using (
  (select public.can_chat(booking_id)) or ((select public.is_staff()) and exists (select 1 from public.bookings x where x.id = booking_id and x.dispute_status <> 'none')));
create policy "chat write" on public.messages for insert to authenticated with check (sender_id = (select auth.uid()) and (select public.can_chat(booking_id)));
-- Notifications: your own; you may mark read / delete your own.
create policy "own notifications" on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy "read own notifications" on public.notifications for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "clear own notifications" on public.notifications for delete to authenticated using (user_id = (select auth.uid()));
create policy "superadmin audit" on public.audit_log for select to authenticated using ((select public.is_superadmin()));
create policy "superadmin broadcasts" on public.broadcasts for select to authenticated using ((select public.is_superadmin()));
-- deleted_accounts: no client access.

-- Only the is_read column of notifications may be changed by clients.
revoke update on public.notifications from authenticated;
grant update (is_read) on public.notifications to authenticated;
