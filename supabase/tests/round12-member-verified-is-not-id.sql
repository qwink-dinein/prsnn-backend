-- A member who applies as a companion starts at "ID check needed" (migration 20261118140000).
-- Paste into the SQL editor: everything is rolled back.
begin;
create temp table r(t text, v text) on commit drop;
do $$
declare m public.profiles; x jsonb;
begin
  insert into r select 'verified companion without an ID on file', count(*)::text from public.profiles where role = 'companion' and verification_status = 'verified' and id_front_path is null;
  select * into m from public.profiles where role = 'user' and photo_path is not null and verification_status = 'verified' limit 1;
  if m.id is null then raise notice 'No member with a photo to test with.'; return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', m.id, 'role', 'authenticated')::text, true);
  perform public.record_consents(array['companion_terms', 'house_rules'], 'test');
  x := public.submit_companion_application(jsonb_build_object('categories', jsonb_build_array('explore')));
  insert into r values ('verified member applies → status (expect id_required)', x ->> 'verification_status');
end $$;
select * from r;
rollback;
