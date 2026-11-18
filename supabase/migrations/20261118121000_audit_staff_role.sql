-- Follow-up to 20261118120000: the activity log records the actor's staff level (sub-admin / superadmin)
-- when they have one, else their member / companion role. Without this, staff actions read "Member".
create or replace function private.audit(action text, kind text, tid text, b jsonb, a jsonb)
returns void language sql set search_path = '' as $$
  insert into public.audit_log (actor_id, role, action, target_kind, target_id, before, after)
  values ((select auth.uid()), (select coalesce(staff_role, role) from public.profiles where id = (select auth.uid())), action, kind, tid, b, a)
$$;
