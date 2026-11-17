-- Chat: one thread per person in the app; sending only while a booking is open.
-- A booking's chat is open from confirmation (accepted and paid, which after an ID check
-- means the ID was approved) until its session ends (upper(slot)). A new booking with the
-- same person opens the thread again. Reading is unchanged (public.can_chat: the two people
-- on a confirmed, paid booking, any time), so history stays visible after the session.

create or replace function public.chat_open(b uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.bookings x
                  where x.id = b and x.status = 'accepted' and x.payment_status = 'paid' and now() < upper(x.slot)
                    and (x.requester_id = (select auth.uid()) or x.companion_id = (select auth.uid())))
$$;
revoke all on function public.chat_open(uuid) from public, anon;
grant execute on function public.chat_open(uuid) to authenticated;

drop policy if exists "chat write" on public.messages;
create policy "chat write" on public.messages for insert to authenticated
  with check (sender_id = (select auth.uid()) and (select public.chat_open(booking_id)));
