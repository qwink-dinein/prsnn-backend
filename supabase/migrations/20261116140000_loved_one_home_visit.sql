-- "Companion for a Loved One" bookings may be a visit at the loved one's home (owner,
-- 2026-11-15). The address is private: companions who are only being offered the booking see
-- "Home visit · <area>"; the full address shows to the member, the confirmed companion and staff.
alter table public.bookings add column if not exists home_visit boolean not null default false;
alter table public.bookings add constraint bookings_home_visit_loved_one
  check (not home_visit or (category = 'loved_one' and recipient_name is not null)) not valid;
alter table public.bookings validate constraint bookings_home_visit_loved_one;

-- Who may see a home-visit address.
create or replace function private.sees_address(b public.bookings, viewer uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not b.home_visit
      or viewer = b.requester_id
      or (viewer = b.companion_id and b.alloc_state = 'assigned')
      or coalesce((select public.is_staff()), false)
$$;
revoke execute on function private.sees_address(public.bookings, uuid) from public, anon, authenticated;

create or replace function private.booking_json(b public.bookings, viewer uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object(
    '_id', b.id, 'ref', b.ref, 'flow', b.flow,
    'requesterId', coalesce(private.person(b.requester_id, viewer), to_jsonb(b.requester_id)),
    'companionId', private.person(b.companion_id, viewer),
    'preferredCompanionId', private.person(b.preferred_companion_id, viewer),
    'status', b.status, 'paymentStatus', b.payment_status, 'paymentMode', b.payment_mode,
    'amountPaid', b.amount_paid, 'paidAt', b.paid_at, 'pricePerHour', b.price_per_hour, 'packagePrice', b.package_price,
    'companionShare', case when b.companion_id = viewer or (select public.is_superadmin()) then b.companion_share end,
    'startTime', b.start_time, 'duration', b.duration_min::text,
    'scheduledDate', to_char(b.scheduled_date, 'YYYY-MM-DD') || 'T00:00:00.000Z',
    'message', b.message, 'experience', b.experience, 'city', b.city, 'area', b.area, 'category', b.category,
    'homeVisit', b.home_visit,
    'meetingPlace', case when private.sees_address(b, viewer) then b.meeting_place
                         else 'Home visit · ' || coalesce(nullif(b.area, ''), nullif(b.recipient_city, ''), b.city, 'address shared once confirmed') end,
    'recipient', case when b.recipient_name is not null then jsonb_build_object('relation', b.recipient_relation, 'name', b.recipient_name,
      'city', b.recipient_city, 'state', b.recipient_state, 'phone', case when b.requester_id = viewer then b.recipient_phone end) end,
    'allocation', jsonb_build_object('state', b.alloc_state, 'paymentDeadline', b.payment_deadline, 'deadline', b.alloc_deadline,
      'assignedAt', b.assigned_at, 'failedReason', b.failed_reason),
    'refund', jsonb_build_object('status', b.refund_status, 'amount', b.refund_amount, 'retained', b.refund_retained,
      'reason', b.refund_reason, 'processedAt', b.refund_processed_at),
    'dispute', jsonb_build_object('status', b.dispute_status, 'reason', b.dispute_reason, 'openedAt', b.dispute_opened_at,
      'resolution', b.dispute_resolution, 'resolvedAt', b.dispute_resolved_at),
    'cancelledBy', b.cancelled_by, 'cancelReason', b.cancel_reason, 'cancelledAt', b.cancelled_at,
    'createdAt', b.created_at, 'updatedAt', b.updated_at,
    'panic', (select jsonb_build_object('id', a.id, 'raisedAt', a.raised_at, 'mine', a.raised_by = viewer, 'sends', a.sends, 'lastSentAt', a.last_sent_at)
              from public.panic_alerts a where a.booking_id = b.id and a.resolved_at is null order by a.raised_at desc limit 1),
    'offerSummary', case when b.requester_id = viewer then (select jsonb_build_object('tried', count(*),
      'liveUntil', max(o.expires_at) filter (where o.status = 'offered')) from public.booking_offers o where o.booking_id = b.id) end,
    'myOffer', case when b.requester_id is distinct from viewer then (select jsonb_build_object('status', o.status,
      'expiresAt', o.expires_at, 'offeredAt', o.offered_at) from public.booking_offers o where o.booking_id = b.id and o.companion_id = viewer) end)
$$;

-- Booking: p.homeVisit = true asks for a visit at the loved one's home (meetingPlace = their address).
create or replace function public.create_prepaid_booking(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); me public.profiles; c public.profiles; b public.bookings; hrs int; dur int; d date; t text := p ->> 'startTime'; price int;
        k text := p ->> 'idempotencyKey'; cat text := nullif(p ->> 'category', ''); place text := left(trim(coalesce(p ->> 'meetingPlace', '')), 200);
        rec jsonb := p -> 'recipient'; rphone text; hv boolean := coalesce((p ->> 'homeVisit')::boolean, false);
begin
  if uid is null then perform private.fail('Please log in.'); end if;
  if k is null or char_length(k) not between 8 and 100 then perform private.fail('Missing booking key. Please try again.'); end if;
  select * into b from public.bookings where requester_id = uid and idempotency_key = k;
  if found then
    return jsonb_build_object('booking', private.booking_json(b, uid), 'replayed', true, 'policy', public.booking_policy(),
      'quote', jsonb_build_object('currency', 'INR', 'amount', b.package_price, 'fees', 0, 'hours', b.duration_min / 60,
        'effectiveHourly', round(b.package_price::numeric / (b.duration_min / 60)), 'pricePerHour', b.price_per_hour, 'duration', b.duration_min::text));
  end if;
  if coalesce((p ->> 'acceptTerms')::boolean, false) is not true then perform private.fail('Please accept the cancellation and refund terms.'); end if;
  begin d := (p ->> 'scheduledDate')::date; exception when others then perform private.fail('Invalid date or time.'); end;
  if t is null or t !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then perform private.fail('Invalid date or time.'); end if;
  dur := (p ->> 'duration')::int; hrs := dur / 60; price := private.price_for(hrs);
  if dur % 60 <> 0 or price is null then perform private.fail('Choose a duration between 1 and 12 hours.'); end if;
  if cat is not null and not cat = any (private.categories()) then perform private.fail('Unknown category.'); end if;
  if rec is not null and jsonb_typeof(rec) = 'object' then
    if coalesce(rec ->> 'relation', '') not in ('mother', 'father', 'grandparent', 'relative', 'friend', 'other') then perform private.fail('Choose who the booking is for.'); end if;
    if char_length(trim(coalesce(rec ->> 'name', ''))) < 2 then perform private.fail('Add their name.'); end if;
    rphone := regexp_replace(coalesce(rec ->> 'phone', ''), '[^0-9]', '', 'g');
    if char_length(rphone) = 10 then rphone := '91' || rphone; end if;
    if char_length(rphone) not between 11 and 15 then perform private.fail('Add their mobile number.'); end if;
  else rec := null; end if;
  if hv then
    if cat is distinct from 'loved_one' or rec is null then perform private.fail('Home visits are only for Companion for a Loved One bookings.'); end if;
    if char_length(place) < 8 then perform private.fail('Add their full home address.'); end if;
  elsif char_length(place) < 3 then perform private.fail('Add a public place to meet, like a café or a mall.');
  end if;
  select * into me from public.profiles where id = uid;
  if me.suspended then perform private.fail('This account is suspended.'); end if;
  select * into c from public.profiles where id = (p ->> 'companionId')::uuid;
  if c.id is null or not private.is_live(c) or not private.sees(me.see_gender, c.gender) then perform private.fail('Companion not found.'); end if;
  if c.id = uid then perform private.fail('You cannot book yourself.'); end if;
  if not hrs = any (private.offered_hours(c)) then perform private.fail('This companion doesn’t offer ' || hrs || '-hour bookings.'); end if;
  if not private.within_day(t, dur) then perform private.fail('Sessions must start at or after ' || (private.pricing() ->> 'dayStart') || ' and finish by ' || (private.pricing() ->> 'dayEnd') || '.'); end if;
  if not private.available_at(c, d, t) then perform private.fail('This companion isn’t available at that day and time.'); end if;
  if private.session_start(d, t) - now() < interval '90 minutes' then perform private.fail('Please choose a time at least 90 minutes from now, so we can confirm your companion.'); end if;
  insert into public.bookings (requester_id, preferred_companion_id, idempotency_key, scheduled_date, start_time, duration_min, package_price, message, experience, city, area,
                               alloc_state, payment_deadline, category, meeting_place, home_visit, recipient_relation, recipient_name, recipient_phone, recipient_city, recipient_state)
  values (uid, c.id, k, d, t, dur, price, left(coalesce(p ->> 'message', ''), 300), left(p ->> 'experience', 40), coalesce(nullif(p ->> 'city', ''), c.city, me.city),
          coalesce(nullif(p ->> 'area', ''), c.area), 'awaiting_payment', now() + interval '30 minutes', cat, place, hv,
          rec ->> 'relation', left(trim(rec ->> 'name'), 80), case when rec is not null then rphone end, left(rec ->> 'city', 80), left(rec ->> 'state', 80))
  on conflict (requester_id, idempotency_key) do nothing returning * into b;
  if not found then select * into b from public.bookings where requester_id = uid and idempotency_key = k; end if;
  return jsonb_build_object('booking', private.booking_json(b, uid), 'policy', public.booking_policy(),
    'quote', jsonb_build_object('currency', 'INR', 'amount', price, 'fees', 0, 'hours', hrs, 'effectiveHourly', round(price::numeric / hrs), 'pricePerHour', 399, 'duration', dur::text));
end $$;
