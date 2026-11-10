-- Reset ONLY the e2e test accounts (e2e-*@prsnn.test) so
-- prsnn-mobile/scripts/e2e-supabase.mjs can run again. Run in the SQL editor
-- (or via MCP) before each e2e run. Touches no real user's data.
with e2e as (select id from auth.users where email like 'e2e-%@prsnn.test')
delete from public.bookings where requester_id in (select id from e2e) or companion_id in (select id from e2e);
delete from public.notifications where user_id in (select id from auth.users where email like 'e2e-%@prsnn.test');
update public.profiles set role = 'companion', verification_status = 'not_submitted', id_type = null, id_front_path = null,
       id_back_path = null, selfie_path = null, verified_by = null, push_token = null
 where id = (select id from auth.users where email = 'e2e-companion@prsnn.test');
update public.profiles set role = 'user', push_token = null where id = (select id from auth.users where email = 'e2e-sub@prsnn.test');
update public.profiles set push_token = null where id in (select id from auth.users where email like 'e2e-member%@prsnn.test');
delete from private.pending_subadmins where phone = '9000000001';
