-- The sign-up trigger needs explicit enum casts (CASE yields text).
create or replace function private.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  ph text := regexp_replace(coalesce(new.phone, ''), '\D', '', 'g');
  r public.user_role := case when new.raw_user_meta_data ->> 'role' = 'companion' then 'companion'::public.user_role else 'user'::public.user_role end;
  sup boolean := exists (select 1 from private.superadmin_phones s where s.phone = right(ph, 10));
  sub boolean := exists (select 1 from private.pending_subadmins s where s.phone = right(ph, 10));
begin
  insert into public.profiles (id, phone, role, verification_status, superadmin_via_env)
  values (new.id, nullif(ph, ''),
          (case when sup then 'superadmin' when sub then 'subadmin' else r::text end)::public.user_role,
          (case when sup or sub or r = 'user' then 'verified' else 'not_submitted' end)::public.verification_status, sup);
  delete from private.pending_subadmins where phone = right(ph, 10);
  return new;
end $$;
