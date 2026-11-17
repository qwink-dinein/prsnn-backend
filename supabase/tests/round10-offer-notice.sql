-- Offer notice carries its booking (migration 20261117080000). Paste into the SQL editor: everything is rolled back.
-- Re-runs allocation on the latest paid booking and checks the companion's notice has booking_id and "#ref",
-- which notify needs to send the WhatsApp booking request.
begin;
create temp table r(t text, v text) on commit drop;
do $$
declare b public.bookings; n public.notifications;
begin
  select * into b from public.bookings where payment_status = 'paid' order by created_at desc limit 1;
  if b.id is null then raise notice 'No paid booking to test with.'; return; end if;
  delete from public.booking_offers where booking_id = b.id;
  update public.bookings set alloc_state = 'offering', alloc_deadline = now() + interval '5 hours', companion_id = null where id = b.id;
  perform private.next_offer(b.id);
  select * into n from public.notifications where type = 'booking_offer' and created_at = now() order by created_at desc limit 1;
  insert into r values ('notice saved', (n.id is not null)::text),
                       ('notice has booking', (n.booking_id = b.id)::text),
                       ('message has #ref', (position('#' || b.ref in n.message) > 0)::text);
end $$;
select * from r;
rollback;
