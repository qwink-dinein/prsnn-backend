-- Production hardening from the Supabase advisors.
-- 1. Companion profiles only for signed-in people (the app requires sign-in; stops anonymous scraping).
revoke execute on function public.list_companions(text) from anon, public;
revoke execute on function public.get_companion(uuid) from anon, public;
grant execute on function public.list_companions(text) to authenticated;
grant execute on function public.get_companion(uuid) to authenticated;
-- 2. Indexes for foreign keys used in joins and deletes.
create index if not exists messages_sender on public.messages (sender_id);
create index if not exists notifications_booking on public.notifications (booking_id);
create index if not exists bookings_preferred_companion on public.bookings (preferred_companion_id);
create index if not exists panic_alerts_raised_by on public.panic_alerts (raised_by);
create index if not exists panic_alerts_resolved_by on public.panic_alerts (resolved_by);
create index if not exists chat_reads_user on public.chat_reads (user_id);
create index if not exists dispute_notes_booking on public.dispute_notes (booking_id);
create index if not exists dispute_notes_by on public.dispute_notes (by_id);
create index if not exists audit_log_actor on public.audit_log (actor_id);
-- 3. Duplicate of notifications_undelivered.
drop index if exists public.notifications_unpushed;
