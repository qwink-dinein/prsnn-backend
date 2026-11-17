-- Account-deletion notice (migration 20261117060000). Paste into the SQL editor: everything is rolled back.
-- Checks: a self-deletion notifies every admin with name, role, city, number and time since sign-up;
-- an admin deletion notifies the other admins, not the one who did it; old "to review" notices are retired.
begin;
create temp table r(t text, v text) on commit drop;
do $$
declare uid uuid := '00000000-0000-4000-8000-00000000d001'; adm uuid; m text; n int;
begin
  insert into auth.users (id, instance_id, aud, role, phone, created_at, updated_at)
  values (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '916999990417', now() - interval '50 minutes', now());
  insert into public.profiles (id, full_name, role, city, phone, gender) values (uid, 'Test Pankaj', 'companion', 'Delhi', '916999990417', 'man')
  on conflict (id) do update set full_name = excluded.full_name, role = excluded.role, city = excluded.city, phone = excluded.phone, gender = excluded.gender;
  perform private.notify_staff('approval', 'New companion to review: Test Pankaj (Delhi).', jsonb_build_object('kind', 'review', 'target', 'profile', 'uid', uid));
  perform private.delete_account(uid, uid, 'Self-service deletion (app)');
  select message into m from public.notifications where action->>'kind' = 'account_deleted' and message like 'Test Pankaj%' limit 1;
  insert into r values ('self-deletion message', m);
  insert into r values ('every admin told', ((select count(*) from public.notifications where message = m) = (select count(*) from public.profiles where role in ('subadmin', 'superadmin') and not suspended))::text);
  insert into r values ('old review notice retired', (select bool_and(action is null and message like '%(Account since deleted.)') from public.notifications where message like 'New companion to review: Test Pankaj%')::text);

  select id into adm from public.profiles where role = 'superadmin' and not suspended limit 1;
  insert into auth.users (id, instance_id, aud, role, phone, created_at, updated_at)
  values (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '916999990417', now() - interval '3 days', now());
  insert into public.profiles (id, full_name, role, phone) values (uid, 'Test Riya', 'user', '916999990417')
  on conflict (id) do update set full_name = excluded.full_name, role = excluded.role, city = null, gender = null;
  perform private.delete_account(uid, adm, 'Fake profile');
  select message, (select count(*) from public.notifications x where x.message = n2.message and x.user_id = adm) into m, n
    from public.notifications n2 where action->>'kind' = 'account_deleted' and message like 'Test Riya%' limit 1;
  insert into r values ('admin deletion message', coalesce(m, '(only one admin: nobody else to tell)'));
  insert into r values ('deleting admin not told', (coalesce(n, 0) = 0)::text);
end $$;
select * from r;
rollback;
