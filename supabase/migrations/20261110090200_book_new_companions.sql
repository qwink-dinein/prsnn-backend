-- Members can book companions who are live but whose ID is checked at their first booking.
create or replace function public.create_prepaid_booking(p jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid()); me public.profiles; c public.profiles; b public.bookings;
  hrs int; dur int; d date; t text := p ->> 'startTime'; price int; k text := p ->> 'idempotencyKey';
begin
  if uid is null then perform private.fail('Please log in.'); end if;
  if k is null or char_length(k) not between 8 and 100 then perform private.fail('Missing booking key. Please try again.'); end if;
  select * into b from public.bookings where requester_id = uid and idempotency_key = k;
  if found then return jsonb_build_object('booking', private.booking_json(b, uid), 'replayed', true, 'policy', public.booking_policy(),
    'quote', jsonb_build_object('currency', 'INR', 'amount', b.package_price, 'fees', 0, 'hours', b.duration_min / 60, 'effectiveHourly', round(b.package_price::numeric / (b.duration_min / 60)), 'pricePerHour', b.price_per_hour, 'duration', b.duration_min::text)); end if;
  if coalesce((p ->> 'acceptTerms')::boolean, false) is not true then perform private.fail('Please accept the cancellation and refund terms.'); end if;
  begin d := (p ->> 'scheduledDate')::date; exception when others then perform private.fail('Invalid date or time.'); end;
  if t is null or t !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then perform private.fail('Invalid date or time.'); end if;
  dur := (p ->> 'duration')::int; hrs := dur / 60;
  price := private.price_for(hrs);
  if dur % 60 <> 0 or price is null then perform private.fail('Choose a duration between 1 and 12 hours.'); end if;
  select * into me from public.profiles where id = uid;
  if me.suspended then perform private.fail('This account is suspended.'); end if;
  select * into c from public.profiles where id = (p ->> 'companionId')::uuid;
  if c.id is null or not private.is_live(c) or not private.sees(me.see_gender, c.gender) then perform private.fail('Companion not found.'); end if;
  if c.id = uid then perform private.fail('You cannot book yourself.'); end if;
  if not hrs = any (private.offered_hours(c)) then perform private.fail('This companion doesn’t offer ' || hrs || '-hour bookings.'); end if;
  if not private.within_day(t, dur) then perform private.fail('Sessions must start at or after ' || (private.pricing() ->> 'dayStart') || ' and finish by ' || (private.pricing() ->> 'dayEnd') || '.'); end if;
  if not private.available_at(c, d, t) then perform private.fail('This companion isn’t available at that day and time.'); end if;
  if private.session_start(d, t) - now() < interval '90 minutes' then perform private.fail('Please choose a time at least 90 minutes from now, so we can confirm your companion.'); end if;
  insert into public.bookings (requester_id, preferred_companion_id, idempotency_key, scheduled_date, start_time, duration_min, package_price,
                               message, experience, city, area, alloc_state, payment_deadline)
  values (uid, c.id, k, d, t, dur, price, left(coalesce(p ->> 'message', ''), 300), left(p ->> 'experience', 40),
          coalesce(nullif(p ->> 'city', ''), c.city, me.city), coalesce(nullif(p ->> 'area', ''), c.area),
          'awaiting_payment', now() + interval '30 minutes')
  on conflict (requester_id, idempotency_key) do nothing
  returning * into b;
  if not found then select * into b from public.bookings where requester_id = uid and idempotency_key = k; end if;
  return jsonb_build_object('booking', private.booking_json(b, uid), 'policy', public.booking_policy(),
    'quote', jsonb_build_object('currency', 'INR', 'amount', price, 'fees', 0, 'hours', hrs, 'effectiveHourly', round(price::numeric / hrs), 'pricePerHour', 399, 'duration', dur::text));
end $$;
