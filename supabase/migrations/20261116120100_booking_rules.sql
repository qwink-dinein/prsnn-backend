-- Round 5 (2/6) · Booking and profile rules.
-- * raise_panic locks the booking first: two people pressing at once get the same alert.
-- * complete_booking only after the session has ended, and never with an open dispute or panic
--   (the chat stays open for the whole session; same rules as the automatic completion).
-- * tick completes paid bookings only; accepted website requests never paid are closed instead.
-- * A failed test payment is recorded (payment_status 'failed'); paying again still works.
-- * A profile can be approved only once it was sent for review.

create or replace function public.raise_panic(bid uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := (select auth.uid()); b public.bookings; a public.panic_alerts; role text;
begin
  -- Locked: a second press (or the other person pressing) waits, then finds this alert.
  select * into b from public.bookings where id = bid for update;
  if not found or uid is null or not (b.requester_id is not distinct from uid or b.companion_id is not distinct from uid) then perform private.fail('Booking not found.'); end if;
  if b.status not in ('accepted', 'completed') or b.payment_status <> 'paid' then perform private.fail('The panic button works during a confirmed booking.'); end if;
  if now() < private.session_start(b.scheduled_date, b.start_time) then perform private.fail('The panic button turns on when the session starts. In danger now? Call 112.'); end if;
  if now() > private.session_end(b.scheduled_date, b.start_time, b.duration_min) + interval '1 hour' then perform private.fail('This session has ended. In danger now? Call 112, then report it from the booking.'); end if;
  select * into a from public.panic_alerts where booking_id = bid and resolved_at is null;
  if found then return private.panic_json(a); end if;
  role := case when b.requester_id = uid then 'member' else 'companion' end;
  insert into public.panic_alerts (booking_id, raised_by, raised_role) values (bid, uid, role) returning * into a;
  perform private.panic_send(a.id);
  perform private.audit('panic.raise', 'booking', bid::text, null, jsonb_build_object('alertId', a.id, 'by', role));
  select * into a from public.panic_alerts where id = a.id;
  return private.panic_json(a);
end $$;

create or replace function public.complete_booking(bid uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.bookings; uid uuid := (select auth.uid());
begin
  select * into b from public.bookings where id = bid and companion_id = uid for update;
  if not found then perform private.fail('Booking not found.'); end if;
  if b.status <> 'accepted' or b.payment_status <> 'paid' then perform private.fail('Only a confirmed, paid booking can be completed.'); end if;
  if private.session_end(b.scheduled_date, b.start_time, b.duration_min) > now() then perform private.fail('You can mark it completed once the session has ended.'); end if;
  if b.dispute_status = 'open' then perform private.fail('There’s an open report on this booking. Our team will close it.'); end if;
  if exists (select 1 from public.panic_alerts a where a.booking_id = bid and a.resolved_at is null) then
    perform private.fail('There’s an open safety alert on this booking. It has to be closed first.');
  end if;
  update public.bookings set status = 'completed' where id = bid returning * into b;
  return jsonb_build_object('message', 'Marked completed.', 'booking', private.booking_json(b, uid));
end $$;

create or replace function private.tick() returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  update public.bookings set alloc_state = 'cancelled', status = 'cancelled', cancelled_by = 'system', cancel_reason = 'payment_timeout', cancelled_at = now()
   where alloc_state = 'awaiting_payment' and payment_deadline < now();
  for r in update public.booking_offers set status = 'expired' where status = 'offered' and expires_at <= now() returning booking_id loop
    perform private.next_offer(r.booking_id);
  end loop;
  for r in select id from public.bookings where alloc_state in ('offering', 'id_check') and alloc_deadline <= now() loop
    perform private.fail_allocation(r.id, 'no_one_accepted_in_time');
  end loop;
  for r in select b.id from public.bookings b where b.alloc_state = 'offering'
             and not exists (select 1 from public.booking_offers o where o.booking_id = b.id and o.status = 'offered') loop
    perform private.next_offer(r.id);
  end loop;
  for r in select id from public.panic_alerts where resolved_at is null and last_sent_at <= now() - interval '5 minutes' loop
    perform private.panic_send(r.id);
  end loop;
  -- Paid sessions end → completed (2 h grace; never with an open report or safety alert).
  update public.bookings x set status = 'completed'
   where status = 'accepted' and payment_status = 'paid' and dispute_status <> 'open'
     and private.session_end(scheduled_date, start_time, duration_min) < now() - interval '2 hours'
     and not exists (select 1 from public.panic_alerts a where a.booking_id = x.id and a.resolved_at is null);
  -- Website requests accepted but never paid: the time has passed, close them.
  update public.bookings set status = 'cancelled', cancelled_by = 'system', cancel_reason = 'not_paid', cancelled_at = now()
   where status = 'accepted' and payment_status <> 'paid' and flow = 'request'
     and private.session_end(scheduled_date, start_time, duration_min) < now() - interval '2 hours';
end $$;

create or replace function public.simulate_payment(bid uuid, outcome text default 'success') returns jsonb language plpgsql security definer set search_path = '' as $$
declare b public.bookings; uid uuid := (select auth.uid());
begin
  if private.cfg('payment_mode') <> 'simulated' then perform private.fail('Test payments are off on this server.'); end if;
  select * into b from public.bookings where id = bid and requester_id = uid for update;
  if not found then perform private.fail('Booking not found.'); end if;
  if b.payment_status = 'paid' then return jsonb_build_object('message', 'Already paid.', 'booking', private.booking_json(b, uid)); end if;
  if b.alloc_state <> 'awaiting_payment' or b.payment_deadline < now() then perform private.fail('This booking can no longer be paid. Please book again.'); end if;
  if outcome = 'failure' then
    update public.bookings set payment_status = 'failed' where id = bid returning * into b;
    return jsonb_build_object('message', 'Payment failed (test). Nothing was charged.', 'failed', true, 'booking', private.booking_json(b, uid));
  end if;
  b := private.mark_paid(bid, 'sim_pay_' || extract(epoch from now())::bigint, b.package_price, 'simulated');
  return jsonb_build_object('message', 'Payment received (test).', 'booking', private.booking_json(b, uid));
end $$;

create or replace function public.admin_decide_profile(uid uuid, decision text, note text default null) returns jsonb language plpgsql security definer set search_path = '' as $$
declare p public.profiles; before_status text;
begin
  perform private.need_staff();
  if decision not in ('approve', 'reject') then perform private.fail('Choose approve or reject.'); end if;
  select approval_status into before_status from public.profiles where id = uid and role = 'companion' for update;
  if before_status is null then perform private.fail('Companion not found.'); end if;
  if before_status = 'draft' then perform private.fail('This profile hasn’t been sent for review yet.'); end if;
  if decision = 'approve' then
    update public.profiles set approval_status = 'approved', approval_note = null, approved_at = now(), approved_by = (select auth.uid()),
           photo_status = case when photo_path is not null then 'approved' else photo_status end, photo_note = null
     where id = uid returning * into p;
    perform private.notify2(uid, 'approval', 'You’re approved and live. Members' || coalesce(' in ' || p.city, '') || ' can now book you. When your first booking arrives, we’ll ask for a quick ID check.', jsonb_build_object('kind', 'approved'));
  else
    if coalesce(trim(note), '') = '' then perform private.fail('Write a short reason for the companion.'); end if;
    update public.profiles set approval_status = 'rejected', approval_note = left(trim(note), 500) where id = uid returning * into p;
    perform private.notify2(uid, 'action_needed', 'Your companion profile wasn’t approved: ' || left(trim(note), 300), jsonb_build_object('kind', 'rejected', 'target', 'profile'));
  end if;
  perform private.audit('approval.' || decision, 'user', uid::text, jsonb_build_object('approvalStatus', before_status), jsonb_build_object('approvalStatus', p.approval_status, 'note', note));
  return jsonb_build_object('message', case when decision = 'approve' then 'Approved. They’re live.' else 'Rejected. They’ve been told why.' end, 'user', private.admin_user_json(p));
end $$;
