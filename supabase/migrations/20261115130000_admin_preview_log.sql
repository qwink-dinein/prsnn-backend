-- Round 5 · Staff "View the app as…" runs on sample data on the phone; only the start is
-- recorded here, so the activity log shows who previewed what and when.
create or replace function public.admin_log_preview(as_role text, start_at text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.need_staff();
  if as_role not in ('member', 'companion') then raise exception 'Choose member or companion.'; end if;
  perform private.audit('app.preview', 'app', as_role, null, jsonb_build_object('as', as_role, 'start', left(coalesce(start_at, 'home'), 40)));
end $$;
revoke execute on function public.admin_log_preview(text, text) from public, anon;
grant execute on function public.admin_log_preview(text, text) to authenticated;
