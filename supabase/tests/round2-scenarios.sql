-- Round 2 scenarios (approvals, change requests, booking for someone else,
-- panic alerts) run as the e2e accounts inside a transaction that is rolled back.
-- Paste into the SQL editor; the final error message lists the results.
begin;
create temp table t_ids as select
  (select id from auth.users where email='e2e-companion@prsnn.test') c,
  (select id from auth.users where email='e2e-member@prsnn.test') m,
  (select id from auth.users where email='e2e-super@prsnn.test') s;
create temp table t_out (n serial, step text, val text);
create temp table t_b (k text, bid uuid);
grant all on t_out, t_ids, t_b to authenticated; grant usage on sequence t_out_n_seq to authenticated;
delete from public.bookings where requester_id in (select m from t_ids) or companion_id in (select c from t_ids);
update public.profiles set role='companion', verification_status='verified', approval_status='draft', photo_status='none', photo_path=null, categories='{}' where id=(select c from t_ids);
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',(select c from t_ids),'role','authenticated')::text, true);
do $$ begin perform public.submit_companion_application(jsonb_build_object('fullName','Ananya Rao','photoPath',(select c from t_ids)::text||'/p.png')); exception when others then insert into t_out(step,val) values ('no categories', sqlerrm); end $$;
insert into t_out(step,val) select 'submit', (public.submit_companion_application(jsonb_build_object('fullName','Ananya Rao','gender','woman','profileVisibility','open','visibilityConsent',true,'city','Hyderabad','state','Telangana','area','Gachibowli','description','Coffee and walks around the city.','packages',jsonb_build_array(1,2,4),'startTime','07:00','endTime','22:00','tags',jsonb_build_array('Coffee'),'categories',jsonb_build_array('new_in_town','work_study'),'availability',jsonb_build_object('monday',true,'tuesday',true,'wednesday',true,'thursday',true,'friday',true,'saturday',true,'sunday',true),'photoPath',(select c from t_ids)::text||'/p.png')) ->> 'approvalStatus') || ' photo ' || (public.me() ->> 'photoStatus');
select set_config('request.jwt.claims', json_build_object('sub',(select m from t_ids),'role','authenticated')::text, true);
insert into t_out(step,val) select 'listed before approval', (select count(*)::text from jsonb_array_elements(public.list_companions()) e where e ->> 'id' = (select c from t_ids)::text);
select set_config('request.jwt.claims', json_build_object('sub',(select s from t_ids),'role','authenticated')::text, true);
insert into t_out(step,val) select 'queue', (select count(*)::text from jsonb_array_elements(public.admin_approvals('companions')) e where e ->> 'id' = (select c from t_ids)::text);
insert into t_out(step,val) select 'ask changes', public.admin_request_changes((select c from t_ids),'profile',array['photo'],'Please add a clearer photo.') ->> 'message';
select set_config('request.jwt.claims', json_build_object('sub',(select c from t_ids),'role','authenticated')::text, true);
insert into t_out(step,val) select 'bell', (select type || ' ' || action::text from public.notifications where user_id=(select c from t_ids) order by created_at desc limit 1);
insert into t_out(step,val) select 'resubmit', public.resubmit_for_review() ->> 'approvalStatus';
select set_config('request.jwt.claims', json_build_object('sub',(select s from t_ids),'role','authenticated')::text, true);
insert into t_out(step,val) select 'approve', public.admin_decide_profile((select c from t_ids),'approve',null) ->> 'message';
select set_config('request.jwt.claims', json_build_object('sub',(select m from t_ids),'role','authenticated')::text, true);
insert into t_out(step,val) select 'listed after', (select (e -> 'categories')::text || ' photo=' || coalesce(e ->> 'profilePhoto','null') from jsonb_array_elements(public.list_companions()) e where e ->> 'id' = (select c from t_ids)::text);
do $$ begin perform public.create_prepaid_booking(jsonb_build_object('companionId',(select c from t_ids),'scheduledDate',(current_date+2)::text,'startTime','12:00','duration','120','idempotencyKey','sqltest-x-'||extract(epoch from now()),'acceptTerms',true)); exception when others then insert into t_out(step,val) values ('no place', sqlerrm); end $$;
insert into t_b select 'A', (public.create_prepaid_booking(jsonb_build_object('companionId',(select c from t_ids),'scheduledDate',(current_date+2)::text,'startTime','12:00','duration','120','idempotencyKey','sqltest-a-'||extract(epoch from now()),'acceptTerms',true,'category','new_in_town','meetingPlace','Starbucks, Inorbit Mall','recipient',jsonb_build_object('relation','mother','name','Asha Verma','phone','9848000000','city','Hyderabad','state','Telangana'))) -> 'booking' ->> '_id')::uuid;
insert into t_out(step,val) select 'booking', (select (g ->> 'category') || ' / ' || (g ->> 'meetingPlace') || ' / ' || (g -> 'recipient')::text from (select public.get_booking((select bid from t_b)) g) x);
do $$ begin perform public.raise_panic((select bid from t_b)); exception when others then insert into t_out(step,val) values ('panic before start', sqlerrm); end $$;
reset role;
update public.bookings set status='accepted', payment_status='paid', amount_paid=699, companion_id=(select c from t_ids), alloc_state='assigned', scheduled_date=(now() at time zone 'Asia/Kolkata')::date, start_time=to_char((now() at time zone 'Asia/Kolkata') - interval '10 minutes','HH24:MI') where id=(select bid from t_b);
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',(select m from t_ids),'role','authenticated')::text, true);
insert into t_out(step,val) select 'panic', (public.raise_panic((select bid from t_b)) ->> 'sends');
reset role;
insert into t_out(step,val) select 'outbox', (select count(*) || ' rows, vals=' || (select body::text from private.whatsapp_outbox order by id desc limit 1) from private.whatsapp_outbox where claimed_at is null);
update public.panic_alerts set last_sent_at = now() - interval '6 minutes' where booking_id=(select bid from t_b);
select private.tick();
insert into t_out(step,val) select 'after 5 min', (select sends::text from public.panic_alerts where booking_id=(select bid from t_b));
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub',(select c from t_ids),'role','authenticated')::text, true);
do $$ begin perform public.resolve_panic((select id from public.panic_alerts where booking_id=(select bid from t_b))); exception when others then insert into t_out(step,val) values ('companion cannot stop member alert', sqlerrm); end $$;
select set_config('request.jwt.claims', json_build_object('sub',(select m from t_ids),'role','authenticated')::text, true);
insert into t_out(step,val) select 'resolve by raiser', ((public.resolve_panic((select id from public.panic_alerts where booking_id=(select bid from t_b))) ->> 'resolvedAt') is not null)::text;
do $$ begin raise exception 'RESULTS(rolled back): %', (select string_agg(n || '. ' || step || ' => ' || coalesce(val,'NULL'), E'\n' order by n) from t_out); end $$;
