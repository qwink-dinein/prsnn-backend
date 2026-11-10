-- Default privileges didn't cover functions created by the migration role, so
-- new functions were callable by logged-out visitors. Signed-in only, except the
-- public browse functions; the delivery queues are service-role only.
revoke execute on function public.claim_whatsapp() from public, anon, authenticated;
grant execute on function public.claim_whatsapp() to service_role;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prosecdef
             and p.proname not in ('list_companions', 'get_companion', 'booking_policy', 'city_plans_for', 'search_localities', 'claim_whatsapp', 'claim_notifications', 'broadcast_tokens', 'forget_push_tokens')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated', f.sig);
  end loop;
end $$;
