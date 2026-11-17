-- File purge after account deletion (migration 20261117070000). Paste into the SQL editor: everything is rolled back.
-- Checks: a deleted account's photo and ID files are listed for removal; files of live accounts are never listed.
-- (The hold on ID files during an open panic alert or dispute is the bookings clause in private.purgeable_files.)
begin;
create temp table r(t text, v text) on commit drop;
do $$
declare gone uuid := '00000000-0000-4000-8000-00000000d002'; live uuid;
begin
  select id into live from public.profiles where role = 'companion' limit 1;
  insert into public.deleted_accounts (original_user_id, phone, role, deleted_by, reason) values (gone, '916999990418', 'companion', gone, 'test');
  insert into storage.objects (bucket_id, name) values ('avatars', gone || '/profile-test.jpg'), ('verification', gone || '/id-front-test.jpg'),
    ('avatars', live || '/never-test.jpg');
  insert into r values ('deleted account: photo + ID listed', (select count(*) from private.purgeable_files(1000) where name like gone || '/%')::text || ' (expect 2)');
  insert into r values ('live account: nothing listed', (select count(*) from private.purgeable_files(1000) where name like live || '/%')::text || ' (expect 0)');
end $$;
select * from r;
rollback;
