-- Round 6: the whole booking with the simulated (test) payment, as the e2e accounts.
-- Book → failed test payment → paid → offered to the companion → accepted → chat opens.
-- One transaction that always rolls back (the final RAISE). Every value should be true.
do $$
declare
  m uuid := (select id from auth.users where email = 'e2e-member@prsnn.test');
  c uuid := (select id from auth.users where email = 'e2e-companion@prsnn.test');
  claims text := 'request.jwt.claims';
  out jsonb := '{}';
  r jsonb; bid uuid; bk public.bookings; ok bool;
  day date := (now() at time zone 'Asia/Kolkata')::date + 3;
begin
  out := out || jsonb_build_object('test_mode', private.cfg('payment_mode') = 'simulated');
  -- A clean, live companion who works every day.
  delete from public.bookings where requester_id = m or companion_id = c or preferred_companion_id = c;
  update public.profiles set role = 'companion', verification_status = 'verified', approval_status = 'approved', suspended = false,
    packages = array[1, 2, 4], start_time = '07:00', end_time = '22:00', city = 'Hyderabad',
    availability = '{"monday":true,"tuesday":true,"wednesday":true,"thursday":true,"friday":true,"saturday":true,"sunday":true}'
  where id = c;

  insert into public.consents (user_id, kind, version) select u, k, 'test' from unnest(array[c, m]) u, unnest(array['house_rules', 'companion_terms']) k;
  set local role authenticated;
  perform set_config(claims, json_build_object('sub', m, 'role', 'authenticated')::text, true);
  r := public.create_prepaid_booking(jsonb_build_object('companionId', c, 'scheduledDate', day::text, 'startTime', '12:00', 'duration', '120',
    'idempotencyKey', 'round6-' || gen_random_uuid(), 'acceptTerms', true, 'category', 'dont_go_alone', 'meetingPlace', 'Inorbit Mall, Madhapur'));
  bid := (r -> 'booking' ->> '_id')::uuid;
  out := out || jsonb_build_object('booked_awaiting_payment', (r -> 'booking' -> 'allocation' ->> 'state') = 'awaiting_payment',
                                   'price_699', (r -> 'booking' ->> 'packagePrice')::int = 699);

  r := public.simulate_payment(bid, 'failure');
  select payment_status = 'failed' into ok from public.bookings where id = bid;
  out := out || jsonb_build_object('failed_payment_recorded', ok);

  r := public.simulate_payment(bid, 'success');
  select * into bk from public.bookings where id = bid;
  out := out || jsonb_build_object('paid', bk.payment_status = 'paid', 'offered_to_companion', bk.alloc_state = 'offering');

  -- Chat is closed until someone accepts.
  begin
    insert into public.messages (booking_id, sender_id, content) values (bid, m, 'hello early');
    out := out || '{"chat_closed_before_accept":false}';
  exception when others then out := out || '{"chat_closed_before_accept":true}'; end;

  perform set_config(claims, json_build_object('sub', c, 'role', 'authenticated')::text, true);
  r := public.accept_offer(bid);
  select * into bk from public.bookings where id = bid;
  out := out || jsonb_build_object('accepted', bk.status = 'accepted' and bk.companion_id = c);

  perform set_config(claims, json_build_object('sub', m, 'role', 'authenticated')::text, true);
  insert into public.messages (booking_id, sender_id, content) values (bid, m, 'Call me on 9848012345');
  select content not like '%9848012345%' into ok from public.messages where booking_id = bid order by created_at desc limit 1;
  out := out || jsonb_build_object('chat_open_numbers_hidden', ok);
  execute 'reset role';
  select count(*) = 1 into ok from public.consents where booking_id = bid and kind = 'booking_terms' and accepted_at is not null;
  execute 'set local role authenticated';
  out := out || jsonb_build_object('booking_terms_logged_with_time', ok);
  select count(*) > 0 into ok from public.notifications where user_id = m and type = 'booking_confirmed' and created_at > now() - interval '1 minute';
  out := out || jsonb_build_object('member_told_confirmed', ok);

  raise exception 'ROLLBACK %', out;
end $$;
