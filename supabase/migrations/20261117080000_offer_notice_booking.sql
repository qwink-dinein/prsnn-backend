-- The companion's "new paid booking" notice was saved without its booking (private.notify has no
-- booking argument, and the #ref fallback trigger found no "#ref" in that message). notify() needs the
-- booking to fill the WhatsApp template, so it skipped the WhatsApp (WAPLIFY_TPL_BOOKING_REQUEST)
-- and only the push went out. Fix: a notify() that takes the booking, used by next_offer; the message
-- now also carries "#ref" so the app can open the booking from the notice.

create or replace function private.notify(uid uuid, t public.notification_type, msg text, bid uuid)
returns void language sql set search_path = '' as $$
  insert into public.notifications (user_id, type, message, booking_id) select uid, t, msg, bid where uid is not null
$$;
revoke all on function private.notify(uuid, public.notification_type, text, uuid) from public, anon, authenticated;

create or replace function private.next_offer(bid uuid)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare b public.bookings; see public.see_gender; tried int; nxt public.profiles; win interval; p jsonb := private.pricing();
        max_offers int := private.cfg('max_offers')::int; skip uuid[] := '{}'; attempt int;
begin
  select * into b from public.bookings where id = bid for update;
  if not found or b.alloc_state <> 'offering' then return; end if;
  if exists (select 1 from public.booking_offers where booking_id = bid and status = 'offered' and expires_at > now()) then return; end if;
  select count(*) into tried from public.booking_offers where booking_id = bid;
  if tried >= max_offers or now() >= b.alloc_deadline then perform private.fail_allocation(bid, 'no_one_accepted_in_time'); return; end if;
  select see_gender into see from public.profiles where id = b.requester_id;
  for attempt in 1..5 loop
    nxt := null;
    if tried = 0 and attempt = 1 then
      select * into nxt from public.profiles c where c.id = b.preferred_companion_id and private.eligible(c, b, see);
    end if;
    if nxt.id is null then
      select c.* into nxt from public.profiles c
       where c.role = 'companion' and private.eligible(c, b, see) and not (c.id = any (skip))
       order by (case when b.area is not null and lower(c.area) = lower(b.area) then 2 else 0 end
                 + case when b.experience is not null and lower(b.experience) = any (array(select lower(t) from unnest(c.tags) t)) then 1 else 0 end) desc, c.created_at
       limit 1;
    end if;
    exit when nxt.id is null;
    perform private.lock_companion(nxt.id);
    exit when not private.has_conflict(nxt.id, b);
    skip := skip || nxt.id;
    nxt := null;
  end loop;
  if nxt.id is null then perform private.fail_allocation(bid, 'no_eligible_companion'); return; end if;
  win := least(make_interval(mins => (p ->> 'offerMaxMinutes')::int), greatest(make_interval(mins => (p ->> 'offerMinMinutes')::int), (b.alloc_deadline - now()) / max_offers));
  insert into public.booking_offers (booking_id, companion_id, expires_at) values (bid, nxt.id, least(now() + win, b.alloc_deadline));
  perform private.notify(nxt.id, 'booking_offer', 'New paid ' || (b.duration_min / 60) || '-hour booking #' || b.ref || ' (you earn ₹' || floor(b.amount_paid * (1 - (p ->> 'platformShare')::numeric))::int || '). Accept within '
    || case when win >= interval '1 hour' then round(extract(epoch from win) / 3600, 1) || ' h' else round(extract(epoch from win) / 60) || ' min' end || ' or it goes to someone else.', bid);
end $function$;
