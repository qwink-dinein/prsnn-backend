-- Production guards (migration 20261116230000). Paste into the SQL editor: everything is rolled back.
-- Checks: the same payment twice is a no-op; a second payment for a paid booking is queued for a full
-- refund exactly once; the database refuses an overlapping confirmed session for the same companion.
begin;
create temp table r(t text, v text) on commit drop;
do $$
declare b public.bookings; x jsonb; other public.bookings;
begin
  select * into b from public.bookings where status = 'accepted' and payment_status = 'paid' and razorpay_order_id is not null order by created_at desc limit 1;
  if b.id is null then raise notice 'No paid Razorpay booking to test with.'; return; end if;
  x := public.pay_confirm(b.razorpay_order_id, b.razorpay_payment_id, (b.package_price * 100)::bigint);
  insert into r values ('same payment twice → already', x ->> 'already');
  x := public.pay_confirm(b.razorpay_order_id, 'pay_TEST_second', (b.package_price * 100)::bigint);
  insert into r values ('second payment → duplicate / refunds queued', (x ->> 'duplicate') || ' / ' || (select count(*) from private.extra_payments where payment_id = 'pay_TEST_second'));
  perform public.pay_confirm(b.razorpay_order_id, 'pay_TEST_second', (b.package_price * 100)::bigint);
  insert into r values ('webhook repeat → still one', (select count(*)::text from private.extra_payments where payment_id = 'pay_TEST_second'));
  select * into other from public.bookings where companion_id = b.companion_id and id <> b.id and status = 'accepted' limit 1;
  if other.id is not null then
    begin
      update public.bookings set scheduled_date = b.scheduled_date, start_time = b.start_time where id = other.id;
      insert into r values ('overlapping session, same companion', 'NOT BLOCKED (bug)');
    exception when exclusion_violation then
      insert into r values ('overlapping session, same companion', 'blocked by the database');
    end;
  end if;
end $$;
select * from r;
rollback;
