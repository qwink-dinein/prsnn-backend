-- Chat window (migration 20261117110000). Paste into the SQL editor: everything is rolled back.
-- Checks, as the member on a real open booking: can send while open; refused once the session has
-- ended; refused when the booking is completed; old messages still readable after the end.
begin;
create temp table r(t text, v text) on commit drop;
grant insert, select on r to authenticated;
do $$
declare b public.bookings; ok boolean;
begin
  select * into b from public.bookings where status = 'accepted' and payment_status = 'paid' and now() < upper(slot) limit 1;
  if b.id is null then raise notice 'No open booking to test with.'; return; end if;
  perform set_config('request.jwt.claims', json_build_object('sub', b.requester_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.messages (booking_id, sender_id, content) values (b.id, b.requester_id, 'test while open');
    insert into r values ('open booking: send', 'allowed');
  exception when others then insert into r values ('open booking: send', 'REFUSED (bug) ' || sqlerrm); end;
  reset role;
  update public.bookings set scheduled_date = current_date - 2 where id = b.id;
  set local role authenticated;
  begin
    insert into public.messages (booking_id, sender_id, content) values (b.id, b.requester_id, 'test after end');
    insert into r values ('session ended: send', 'ALLOWED (bug)');
  exception when insufficient_privilege then insert into r values ('session ended: send', 'refused'); end;
  insert into r values ('session ended: history readable', ((select count(*) from public.messages where booking_id = b.id and content = 'test while open') = 1)::text);
  reset role;
  update public.bookings set scheduled_date = current_date + 1, status = 'completed' where id = b.id;
  set local role authenticated;
  begin
    insert into public.messages (booking_id, sender_id, content) values (b.id, b.requester_id, 'test completed');
    insert into r values ('completed: send', 'ALLOWED (bug)');
  exception when insufficient_privilege then insert into r values ('completed: send', 'refused'); end;
  reset role;
end $$;
select * from r;
rollback;
