-- Block and report (migrations 20261118160000 + 161000). Paste into the SQL editor: everything is rolled back.
begin;
create temp table r(t text, v text) on commit drop;
do $$
declare m uuid; c uuid; s uuid; x jsonb; cnt int;
begin
  select id into m from public.profiles where role = 'user' and staff_role is null and see_gender = 'everyone' limit 1;
  select id into s from public.profiles where staff_role = 'superadmin' limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  x := public.list_companions(null); c := (x -> 0 ->> 'id')::uuid; cnt := jsonb_array_length(x);
  perform public.block_user(c);
  insert into r values ('block hides them (one fewer)', (jsonb_array_length(public.list_companions(null)) = cnt - 1)::text);
  begin perform public.get_companion(c); insert into r values ('blocked profile opens', 'yes (bug)');
  exception when others then insert into r values ('blocked profile opens', 'no'); end;
  x := public.report_user(c, 'harassment', 'test', null, false); insert into r values ('report accepted', (x ? 'message')::text);
  perform set_config('request.jwt.claims', json_build_object('sub', s, 'role', 'authenticated')::text, true);
  x := public.admin_reports('open'); insert into r values ('admin sees it', (x -> 0 ->> 'reason'));
  perform public.admin_close_report((x -> 0 ->> 'id')::uuid, 'test');
  perform set_config('request.jwt.claims', json_build_object('sub', m, 'role', 'authenticated')::text, true);
  perform public.unblock_user(c);
  insert into r values ('unblock shows them again', (jsonb_array_length(public.list_companions(null)) = cnt)::text);
end $$;
select * from r;
rollback;
