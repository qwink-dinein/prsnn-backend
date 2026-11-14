-- Round 5 (1/6) · One companion, one schedule, one decision at a time.
-- * accept_offer locks the companion's profile (FOR SHARE) before reading their ID status, so an
--   admin's ID decision and an accept can't interleave (a held booking nobody would release).
-- * Every path that gives a companion a booking or an offer (next_offer, accept_offer,
--   admin_reassign_booking) takes a per-companion transaction lock and re-checks overlaps
--   after it, so two parallel paths can't double-book them.
-- * accept_offer refuses companions who aren't live (suspended, approval withdrawn).
-- * Suspending a companion withdraws their live offers and releases bookings held for their ID.

create or replace function private.lock_companion(cid uuid) returns void language sql set search_path = '' as $$
  select pg_advisory_xact_lock(hashtextextended('companion:' || cid::text, 0))
$$;

create or replace function private.next_offer(bid uuid) returns void language plpgsql security definer set search_path = '' as $$
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
    -- Another transaction may be offering this companion an overlapping booking right now:
    -- wait for it, then look again with fresh data.
    perform private.lock_companion(nxt.id);
    exit when not private.has_conflict(nxt.id, b);
    skip := skip || nxt.id;
    nxt := null;
  end loop;
  if nxt.id is null then perform private.fail_allocation(bid, 'no_eligible_companion'); return; end if;
  win := least(make_interval(mins => (p ->> 'offerMaxMinutes')::int), greatest(make_interval(mins => (p ->> 'offerMinMinutes')::int), (b.alloc_deadline - now()) / max_offers));
  insert into public.booking_offers (booking_id, companion_id, expires_at) values (bid, nxt.id, least(now() + win, b.alloc_deadline));
  perform private.notify(nxt.id, 'booking_offer', 'New paid ' || (b.duration_min / 60) || '-hour booking (you earn ₹' || floor(b.amount_paid * (1 - (p ->> 'platformShare')::numeric))::int || '). Accept within '
    || case when win >= interval '1 hour' then round(extract(epoch from win) / 3600, 1) || ' h' else round(extract(epoch from win) / 60) || ' min' end || ' or it goes to someone else.');
end $$;

create or replace function public.accept_offer(bid uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); me public.profiles; b public.bookings; share numeric := (private.pricing() ->> 'platformShare')::numeric;
begin
  -- FOR SHARE: an admin's ID decision on this companion waits for us (and we for it).
  select * into me from public.profiles where id = uid for share;
  if me.verification_status in ('id_required', 'not_submitted', 'rejected') then
    perform private.fail('Verify your ID to accept this booking.');
  end if;
  if not private.is_live(me) then perform private.fail('Your profile isn’t live right now, so you can’t accept bookings. Check your notifications.'); end if;
  select * into b from public.bookings where id = bid for update;
  if not found then perform private.fail('Booking not found.'); end if;
  perform private.lock_companion(uid);
  if exists (select 1 from public.bookings x where x.companion_id = uid and (x.status = 'accepted' or x.alloc_state = 'id_check') and x.id <> bid
        and private.session_start(x.scheduled_date, x.start_time) < private.session_end(b.scheduled_date, b.start_time, b.duration_min)
        and private.session_start(b.scheduled_date, b.start_time) < private.session_end(x.scheduled_date, x.start_time, x.duration_min)) then
    perform private.fail('You already have a booking at that time.');
  end if;
  update public.booking_offers set status = 'accepted', responded_at = now()
   where booking_id = bid and companion_id = uid and status = 'offered' and expires_at > now();
  if not found then perform private.fail('This offer has expired or was already taken.'); end if;
  update public.bookings set companion_id = uid, companion_share = floor(amount_paid * (1 - share)),
         alloc_state = case when me.verification_status = 'verified' then alloc_state else 'id_check' end
   where id = bid and alloc_state = 'offering' returning * into b;
  if not found then perform private.fail('This offer has expired or was already taken.'); end if;
  update public.booking_offers set status = 'withdrawn' where booking_id = bid and status = 'offered';
  if me.verification_status = 'verified' then
    b := private.confirm_assignment(bid);
    return jsonb_build_object('message', 'Booking confirmed. Chat is open.', 'booking', private.booking_json(b, uid));
  end if;
  perform private.notify(b.requester_id, 'booking_accepted', private.first_name(me.full_name) || ' accepted booking #' || b.ref || '. We’re doing a quick safety check of their ID; you’ll hear from us as soon as it’s confirmed.');
  return jsonb_build_object('message', 'Accepted. The booking is held for you while we check your ID.', 'idCheck', true, 'booking', private.booking_json(b, uid));
end $$;

create or replace function public.admin_reassign_booking(bid uuid, cid uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.bookings; c public.profiles; prev uuid;
begin
  perform private.need_staff();
  select * into b from public.bookings where id = bid for update;
  if not found then perform private.fail('Booking not found.'); end if;
  if b.status not in ('pending', 'accepted') then perform private.fail('Only open bookings can be reassigned.'); end if;
  if b.payment_status <> 'paid' then perform private.fail('This booking isn’t paid yet.'); end if;
  select * into c from public.profiles where id = cid for share;
  if c.id is null or not private.is_live(c) or c.verification_status <> 'verified' then perform private.fail('That person isn’t an active verified companion.'); end if;
  if cid = b.requester_id then perform private.fail('The customer can’t be their own companion.'); end if;
  perform private.lock_companion(cid);
  if private.has_conflict(cid, b) then perform private.fail('They already have a booking or a live offer at that time.'); end if;
  prev := b.companion_id;
  update public.bookings set companion_id = cid, status = 'accepted', alloc_state = 'assigned', assigned_at = now(),
         companion_share = floor(amount_paid * (1 - (private.pricing() ->> 'platformShare')::numeric))
   where id = bid returning * into b;
  update public.booking_offers set status = 'withdrawn' where booking_id = bid and status = 'offered';
  perform private.notify(cid, 'booking_confirmed', 'prsnn support assigned booking #' || b.ref || ' to you. Chat is open.');
  if prev is not null and prev <> cid then perform private.notify(prev, 'booking_cancelled', 'Booking #' || b.ref || ' was moved to another companion by prsnn support.'); end if;
  perform private.notify(b.requester_id, 'other', 'Your booking #' || b.ref || ' now has a new companion: ' || c.full_name || '.');
  perform private.audit('booking.reassign', 'booking', bid::text, jsonb_build_object('companionId', prev), jsonb_build_object('companionId', cid));
  return jsonb_build_object('message', 'Booking reassigned.', 'booking', private.admin_booking_json(b));
end $$;

create or replace function public.admin_suspend_user(uid uuid, on_off boolean, reason text default null) returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.profiles; r record; withdrawn int := 0; released int := 0;
begin
  perform private.need_staff();
  perform private.guard_target(uid);
  update public.profiles set suspended = on_off, suspended_at = case when on_off then now() end,
         suspended_reason = case when on_off then nullif(left(reason, 200), '') end
   where id = uid returning * into p;
  if on_off then
    -- Live offers go to someone else.
    for r in update public.booking_offers set status = 'withdrawn' where companion_id = uid and status = 'offered' returning booking_id loop
      perform private.next_offer(r.booking_id);
      withdrawn := withdrawn + 1;
    end loop;
    -- Bookings held for their ID check are offered again, as when an ID is rejected.
    for r in select id, ref, requester_id from public.bookings where companion_id = uid and alloc_state = 'id_check' for update loop
      update public.bookings set companion_id = null, companion_share = null, alloc_state = 'offering' where id = r.id;
      update public.booking_offers set status = 'declined' where booking_id = r.id and companion_id = uid;
      perform private.notify(r.requester_id, 'other', 'Your companion for booking #' || r.ref || ' is no longer available. We’re offering your booking to another verified companion; if nobody can make it, you get a full refund.');
      perform private.next_offer(r.id);
      released := released + 1;
    end loop;
  end if;
  perform private.audit(case when on_off then 'user.suspend' else 'user.unsuspend' end, 'user', uid::text, jsonb_build_object('suspended', not on_off),
    jsonb_build_object('suspended', on_off, 'reason', reason, 'offersWithdrawn', withdrawn, 'heldBookingsReoffered', released));
  return jsonb_build_object('message', case when on_off then 'Account suspended.' || case when withdrawn + released > 0 then ' ' || (withdrawn + released) || ' booking(s) offered to others.' else '' end
                                       else 'Account restored.' end, 'user', private.admin_user_json(p));
end $$;

revoke execute on function private.lock_companion(uuid) from public, anon, authenticated;
