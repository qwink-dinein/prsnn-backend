-- Round 4 (4/4) · ACID isolation: functions that read a booking and then change it now lock the
-- row first (SELECT … FOR UPDATE), so two requests at once (double tap, two admins) run one after
-- the other and the second sees the first's result. Only the first read in each function changes;
-- the rest of each function is untouched (redefined from its live definition).
do $$
declare f record; def text; fixed text;
begin
  for f in select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where (n.nspname, p.proname) in (('public','admin_delete_booking'), ('public','admin_mark_paid'), ('public','admin_override_fee'), ('public','admin_refund'),
                                             ('public','admin_retry_refund'), ('public','complete_booking'), ('public','open_dispute'), ('public','simulate_payment'), ('private','mark_paid'))
  loop
    def := pg_get_functiondef(f.oid);
    fixed := regexp_replace(def, '(select \* into b from public\.bookings where id = bid(?: and [a-z_]+ = uid)?);', '\1 for update;', 'i');
    if fixed = def then raise exception 'no unlocked booking read found in %', f.proname; end if;
    execute fixed;
  end loop;
end $$;
