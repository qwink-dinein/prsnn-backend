-- Bug (since 10 Nov): every member is 'verified' at sign-up (phone OTP = "Verified member"). Applying as a
-- companion kept that value, so the new companion showed "ID verified" with no documents and no check.
-- Fix: the status only carries over when they were already a companion (a real ID check or one in progress);
-- a member who applies starts at 'id_required' (or 'pending' once submit_id_documents runs with their files).
create or replace function public.submit_companion_application(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); me public.profiles;
begin
  select * into me from public.profiles where id = uid;
  if coalesce(p ->> 'photoPath', me.photo_path, '') = '' then perform private.fail('Add a clear photo of you.'); end if;
  if jsonb_array_length(coalesce(p -> 'categories', to_jsonb(me.categories))) = 0 then perform private.fail('Choose at least one thing you’d enjoy doing.'); end if;
  perform public.save_profile(p);
  update public.profiles set role = 'companion',
    -- `role` here is the value before this update: only an existing companion keeps their ID status.
    verification_status = case when role = 'companion' and verification_status in ('pending', 'verified') then verification_status else 'id_required' end,
    approval_status = case when approval_status = 'approved' then 'approved' else 'pending' end, approval_note = null
  where id = uid returning * into me;
  if me.approval_status = 'pending' then
    perform private.notify_staff('approval', 'New companion to review: ' || me.full_name || coalesce(' (' || me.city || ')', '') || '.', jsonb_build_object('kind', 'review', 'target', 'profile', 'uid', uid));
  end if;
  if coalesce(p ->> 'idFrontPath', '') <> '' then
    perform public.submit_id_documents(jsonb_build_object('idType', coalesce(p ->> 'idType', 'aadhaar'), 'idFrontPath', p ->> 'idFrontPath',
      'idBackPath', p ->> 'idBackPath', 'selfiePath', p ->> 'selfiePath'));
  end if;
  return public.me();
end $$;

-- Companions marked 'verified' with no ID on file and nobody who verified them got it from their member
-- account: they go back to "ID check needed" (still listed as "New on prsnn"; ID asked at their first booking).
update public.profiles set verification_status = 'id_required'
 where role = 'companion' and verification_status = 'verified' and id_front_path is null and verified_by is null;
