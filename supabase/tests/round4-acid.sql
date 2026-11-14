-- Round 4 checks (unread counts, confirmed delivery, ACID guards). One transaction, always rolls back.
-- Needs one paid booking from the e2e run. Expected: before_read 2, after_read 0, retried_after_fail true,
-- reclaimed_push_done true, delivered true, refund_guard true, one_panic true.
do $$
declare b public.bookings; out jsonb := '{}'; c jsonb; nid uuid; ok bool;
begin
  select * into b from public.bookings where payment_status = 'paid' and companion_id is not null order by created_at desc limit 1;
  update public.notifications set pushed_at = now() where pushed_at is null;
  perform set_config('request.jwt.claims', json_build_object('sub', b.requester_id, 'role', 'authenticated')::text, true);
  insert into public.messages (booking_id, sender_id, content) values (b.id, b.companion_id, 'hello'), (b.id, b.companion_id, 'are you there?');
  c := public.unread_counts();
  out := out || jsonb_build_object('before_read', c -> 'perChat' -> (b.id::text));
  perform public.mark_chat_read(b.id);
  out := out || jsonb_build_object('after_read', coalesce(public.unread_counts() -> 'perChat' -> (b.id::text), '0'::jsonb));
  insert into public.notifications (user_id, type, message, booking_id) values (b.requester_id, 'other', 'test', b.id) returning id into nid;
  c := public.claim_notifications();
  -- Reports carry the claim token (round 5).
  perform public.report_notifications(jsonb_build_array(jsonb_build_object('id', nid, 'claimToken', (select x ->> 'claimToken' from jsonb_array_elements(c) x where x ->> 'id' = nid::text), 'push', true, 'wa', false, 'error', 'waplify 500')));
  select pushed_at is null into ok from public.notifications where id = nid;
  out := out || jsonb_build_object('retried_after_fail', ok);
  c := public.claim_notifications();
  out := out || jsonb_build_object('reclaimed_push_done', (select (x->>'pushDone')::bool from jsonb_array_elements(c) x where x->>'id' = nid::text));
  perform public.report_notifications(jsonb_build_array(jsonb_build_object('id', nid, 'claimToken', (select x ->> 'claimToken' from jsonb_array_elements(c) x where x ->> 'id' = nid::text), 'push', false, 'wa', true)));
  select pushed_at is not null into ok from public.notifications where id = nid;
  out := out || jsonb_build_object('delivered', ok);
  begin update public.bookings set refund_amount = amount_paid + 1 where id = b.id; out := out || '{"refund_guard":false}';
  exception when check_violation then out := out || '{"refund_guard":true}'; end;
  begin insert into public.panic_alerts (booking_id, raised_by, raised_role) values (b.id, b.requester_id, 'member'), (b.id, b.requester_id, 'member'); out := out || '{"one_panic":false}';
  exception when unique_violation then out := out || '{"one_panic":true}'; end;
  raise exception 'ROLLBACK %', out;
end $$;
