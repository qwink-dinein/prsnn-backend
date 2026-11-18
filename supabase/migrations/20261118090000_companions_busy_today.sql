-- "Available today" filter on Search: every companion's taken times for one day, in one call.
-- Same rule as companion_busy(cid, d) (private.holds_companion: confirmed, ID check, awaiting payment
-- for the chosen companion, or a live offer), returned as { "<companion id>": [{start, duration}] }.
-- Only times are returned: no booking, member or place details. Signed-in callers only.

create index if not exists bookings_scheduled_date on public.bookings (scheduled_date);

create or replace function public.companions_busy(d date)
returns jsonb language sql stable security definer set search_path = '' as $$
  with held as (
    select x.cid, o.start_time, o.duration_min
      from public.bookings o
      cross join lateral (
        select o.companion_id
        union select o.preferred_companion_id
        union select f.companion_id from public.booking_offers f where f.booking_id = o.id and f.status = 'offered'
      ) x(cid)
     where (select auth.uid()) is not null
       and o.scheduled_date = d
       and x.cid is not null
       and private.holds_companion(o, x.cid)
  )
  select coalesce(jsonb_object_agg(cid, slots), '{}'::jsonb)
    from (select cid, jsonb_agg(jsonb_build_object('start', start_time, 'duration', duration_min) order by start_time) slots
            from held group by cid) s
$$;

revoke all on function public.companions_busy(date) from public, anon;
grant execute on function public.companions_busy(date) to authenticated;
