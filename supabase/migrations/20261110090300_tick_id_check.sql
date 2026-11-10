-- The sweeper also closes bookings held for an ID check when the deadline passes (full refund).
create or replace function private.tick() returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  -- Unpaid bookings lapse (nothing charged).
  update public.bookings set alloc_state = 'cancelled', status = 'cancelled', cancelled_by = 'system', cancel_reason = 'payment_timeout', cancelled_at = now()
   where alloc_state = 'awaiting_payment' and payment_deadline < now();
  -- Expired offers → next companion.
  for r in update public.booking_offers set status = 'expired' where status = 'offered' and expires_at <= now() returning booking_id loop
    perform private.next_offer(r.booking_id);
  end loop;
  -- Nobody assigned (or ID not approved) by the deadline → cancel + full refund.
  for r in select id from public.bookings where alloc_state in ('offering', 'id_check') and alloc_deadline <= now() loop
    perform private.fail_allocation(r.id, 'no_one_accepted_in_time');
  end loop;
  -- Offering with no live offer (e.g. after a decline race) → try the next one.
  for r in select b.id from public.bookings b where b.alloc_state = 'offering'
             and not exists (select 1 from public.booking_offers o where o.booking_id = b.id and o.status = 'offered') loop
    perform private.next_offer(r.id);
  end loop;
  -- Sessions that ended 2 h ago with no open dispute are completed.
  update public.bookings set status = 'completed'
   where status = 'accepted' and dispute_status <> 'open' and private.session_end(scheduled_date, start_time, duration_min) < now() - interval '2 hours';
end $$;
