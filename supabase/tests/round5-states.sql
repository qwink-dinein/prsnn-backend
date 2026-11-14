-- Round 5 checks (state-machine fixes). One transaction, always rolls back (the final RAISE).
-- Needs the e2e accounts and one paid, confirmed booking from scripts/e2e-supabase.mjs.
-- Every value in the ROLLBACK line should be true.
do $$
declare b public.bookings; staff uuid; out jsonb := '{}'; c jsonb; nid uuid; tok uuid; a1 jsonb; a2 jsonb; nb uuid; ok bool; ist timestamp := now() at time zone 'Asia/Kolkata';
  as_user text := 'request.jwt.claims';
begin
  select * into b from public.bookings where flow = 'prepaid' and status = 'accepted' and payment_status = 'paid' and companion_id is not null order by created_at desc limit 1;
  if b.id is null then raise exception 'Run scripts/e2e-supabase.mjs first (needs a confirmed booking).'; end if;
  select id into staff from public.profiles where role = 'superadmin' limit 1;
  update public.notifications set pushed_at = now() where pushed_at is null;

  -- #14 Impossible combinations are refused.
  begin update public.bookings set alloc_state = 'offering' where id = b.id; out := out || '{"state_check":false}';
  exception when check_violation then out := out || '{"state_check":true}'; end;

  -- #7 Completing before the end is refused (booking is in the future).
  perform set_config(as_user, json_build_object('sub', b.companion_id, 'role', 'authenticated')::text, true);
  begin perform public.complete_booking(b.id); out := out || '{"complete_before_end":false}';
  exception when others then out := out || jsonb_build_object('complete_before_end', sqlerrm like '%session has ended%'); end;

  -- #2 Session running now: two presses give the same alert.
  update public.bookings set scheduled_date = ist::date, start_time = to_char(ist - interval '10 minutes', 'HH24:MI'), duration_min = 60 where id = b.id;
  perform set_config(as_user, json_build_object('sub', b.requester_id, 'role', 'authenticated')::text, true);
  a1 := public.raise_panic(b.id);
  perform set_config(as_user, json_build_object('sub', b.companion_id, 'role', 'authenticated')::text, true);
  a2 := public.raise_panic(b.id);
  out := out || jsonb_build_object('same_panic', a1 ->> 'id' = a2 ->> 'id');

  -- #7 Ended, but an open safety alert blocks completion.
  update public.bookings set scheduled_date = ist::date - 1 where id = b.id;
  begin perform public.complete_booking(b.id); out := out || '{"complete_blocked_by_panic":false}';
  exception when others then out := out || jsonb_build_object('complete_blocked_by_panic', sqlerrm like '%safety alert%'); end;
  update public.panic_alerts set resolved_at = now() where booking_id = b.id and resolved_at is null;
  update public.bookings set scheduled_date = b.scheduled_date, start_time = b.start_time, duration_min = b.duration_min where id = b.id;

  -- #6 A suspended companion can't accept.
  update public.profiles set suspended = true where id = b.companion_id;
  begin perform public.accept_offer(b.id); out := out || '{"suspended_cannot_accept":false}';
  exception when others then out := out || jsonb_build_object('suspended_cannot_accept', sqlerrm like '%isn’t live%'); end;
  update public.profiles set suspended = false where id = b.companion_id;

  -- #5 Admin reassign refuses an overlapping booking.
  insert into public.bookings (requester_id, idempotency_key, scheduled_date, start_time, duration_min, package_price, alloc_state, status, payment_status, amount_paid, payment_mode, city, meeting_place)
  values (b.requester_id, 'round5-' || gen_random_uuid(), b.scheduled_date, b.start_time, b.duration_min, b.package_price, 'offering', 'pending', 'paid', b.amount_paid, 'simulated', b.city, 'Test café')
  returning id into nb;
  perform set_config(as_user, json_build_object('sub', staff, 'role', 'authenticated')::text, true);
  begin perform public.admin_reassign_booking(nb, b.companion_id); out := out || '{"reassign_overlap_refused":false}';
  exception when others then out := out || jsonb_build_object('reassign_overlap_refused', sqlerrm like '%already have a booking%'); end;

  -- #12 A profile that was never sent for review can't be approved.
  update public.profiles set approval_status = 'draft' where id = b.companion_id;
  begin perform public.admin_decide_profile(b.companion_id, 'approve', null); out := out || '{"draft_not_approvable":false}';
  exception when others then out := out || jsonb_build_object('draft_not_approvable', sqlerrm like '%sent for review%'); end;
  update public.profiles set approval_status = 'approved' where id = b.companion_id;

  -- #9 A failed test payment is recorded, and paying again works.
  insert into public.bookings (requester_id, preferred_companion_id, idempotency_key, scheduled_date, start_time, duration_min, package_price, alloc_state, payment_deadline, city, meeting_place)
  values (b.requester_id, b.companion_id, 'round5-' || gen_random_uuid(), ist::date + 5, '11:00', 60, 399, 'awaiting_payment', now() + interval '30 minutes', b.city, 'Test café')
  returning id into nb;
  perform set_config(as_user, json_build_object('sub', b.requester_id, 'role', 'authenticated')::text, true);
  begin
    perform public.simulate_payment(nb, 'failure');
    select payment_status = 'failed' into ok from public.bookings where id = nb;
    out := out || jsonb_build_object('payment_failed_recorded', ok);
    perform public.simulate_payment(nb, 'success');
    select payment_status = 'paid' into ok from public.bookings where id = nb;
    out := out || jsonb_build_object('pay_after_failure', ok);
  exception when others then out := out || jsonb_build_object('payment_failed_recorded', sqlerrm); end;

  -- #3 A report with an old claim token is ignored; the right token is accepted.
  insert into public.notifications (user_id, type, message) values (b.requester_id, 'other', 'round5') returning id into nid;
  c := public.claim_notifications();
  select (x ->> 'claimToken')::uuid into tok from jsonb_array_elements(c) x where x ->> 'id' = nid::text;
  perform public.report_notifications(jsonb_build_array(jsonb_build_object('id', nid, 'claimToken', gen_random_uuid(), 'push', true, 'wa', true)));
  select pushed_at is null and claimed_at is not null into ok from public.notifications where id = nid;
  out := out || jsonb_build_object('stale_report_ignored', ok);
  perform public.report_notifications(jsonb_build_array(jsonb_build_object('id', nid, 'claimToken', tok, 'push', true, 'wa', true)));
  select pushed_at is not null into ok from public.notifications where id = nid;
  out := out || jsonb_build_object('current_report_counts', ok);

  -- #3 Out of tries → given up, and the team is told once.
  insert into public.notifications (user_id, type, message, attempts) values (b.requester_id, 'other', 'round5 dead', 5) returning id into nid;
  perform public.claim_notifications();
  select gave_up_at is not null into ok from public.notifications where id = nid;
  out := out || jsonb_build_object('gave_up', ok, 'team_told', exists (select 1 from public.notifications where action ->> 'kind' = 'delivery_failed' and created_at >= now()));

  raise exception 'ROLLBACK %', out;
end $$;
