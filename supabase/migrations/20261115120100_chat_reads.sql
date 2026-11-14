-- Round 4 (2/4) · Unread counts for the live badges (bell, Messages, Bookings/Requests).
create table if not exists public.chat_reads (
  booking_id uuid not null references public.bookings (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (booking_id, user_id)
);
alter table public.chat_reads enable row level security;
create policy "own reads" on public.chat_reads for select using (user_id = (select auth.uid()));

-- Mark a chat read up to now (only the two people on the booking).
create or replace function public.mark_chat_read(bid uuid) returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null or not exists (select 1 from public.bookings b where b.id = bid and (b.requester_id = uid or b.companion_id = uid)) then
    perform private.fail('Booking not found.');
  end if;
  insert into public.chat_reads (booking_id, user_id, last_read_at) values (bid, uid, now())
  on conflict (booking_id, user_id) do update set last_read_at = greatest(public.chat_reads.last_read_at, excluded.last_read_at);
end $$;

-- Everything the badges need, in one consistent snapshot.
create or replace function public.unread_counts() returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); per jsonb; msgs int; notes int; bk int; me public.profiles;
begin
  if uid is null then perform private.fail('Please log in again.'); end if;
  select * into me from public.profiles where id = uid;
  select count(*) into notes from public.notifications where user_id = uid and not is_read;
  select coalesce(jsonb_object_agg(x.booking_id, x.n), '{}'::jsonb), coalesce(sum(x.n), 0) into per, msgs from (
    select m.booking_id, count(*)::int n
      from public.messages m join public.bookings b on b.id = m.booking_id
      left join public.chat_reads r on r.booking_id = m.booking_id and r.user_id = uid
     where (b.requester_id = uid or b.companion_id = uid) and m.sender_id <> uid and m.created_at > coalesce(r.last_read_at, '-infinity')
     group by m.booking_id) x;
  if me.role = 'companion' then
    select count(*) into bk from public.booking_offers o join public.bookings b on b.id = o.booking_id
     where o.companion_id = uid and o.status = 'offered' and o.expires_at > now();
  else
    select count(*) into bk from public.bookings b
     where b.requester_id = uid and b.payment_status <> 'paid' and b.status in ('pending', 'accepted')
       and (b.flow <> 'prepaid' or b.alloc_state = 'awaiting_payment');
  end if;
  return jsonb_build_object('notifications', notes, 'messages', msgs, 'perChat', per, 'bookings', bk);
end $$;
revoke execute on function public.mark_chat_read(uuid), public.unread_counts() from public, anon;
grant execute on function public.mark_chat_read(uuid), public.unread_counts() to authenticated;

-- Live updates for the badges and the "me" status (ID approval etc.).
alter publication supabase_realtime add table public.booking_offers, public.bookings, public.profiles;
