-- Round 5 (3/6) · Delivery claims carry a token. A report only counts for the claim it belongs
-- to, so a slow run that reports after its 2-minute claim expired can't clear the newer claim
-- (which caused a third send). Rows that run out of tries (5) or time (1 day; WhatsApp alerts
-- 1 hour) are marked gave_up_at and the team is told once per batch, instead of staying
-- "not sent" forever.
alter table public.notifications add column if not exists claim_token uuid, add column if not exists gave_up_at timestamptz;
alter table private.whatsapp_outbox add column if not exists claim_token uuid, add column if not exists gave_up_at timestamptz;

create or replace function private.give_up_deliveries() returns void language plpgsql security definer set search_path = '' as $$
declare n int; w int; last text;
begin
  with g as (
    update public.notifications set gave_up_at = now()
     where pushed_at is null and gave_up_at is null and (claimed_at is null or claimed_at < now() - interval '2 minutes')
       and (attempts >= 5 or created_at <= now() - interval '1 day')
    returning last_error, coalesce(action ->> 'kind', '') as kind)
  select count(*) filter (where kind <> 'delivery_failed'), max(last_error) filter (where kind <> 'delivery_failed') into n, last from g;
  with g as (
    update private.whatsapp_outbox set gave_up_at = now()
     where sent_at is null and gave_up_at is null and (claimed_at is null or claimed_at < now() - interval '2 minutes')
       and (attempts >= 5 or created_at <= now() - interval '1 hour')
    returning last_error)
  select count(*), coalesce(last, max(last_error)) into w, last from g;
  -- Failure notices to the team are never themselves reported again (no loops).
  if n + w > 0 then
    perform private.notify_staff('other', (n + w) || ' message(s) couldn’t be delivered after several tries' || coalesce(' (last error: ' || left(last, 120) || ')', '') || '.',
      jsonb_build_object('kind', 'delivery_failed', 'notifications', n, 'whatsapp', w));
  end if;
end $$;

create or replace function public.claim_notifications() returns jsonb language plpgsql security definer set search_path = '' as $$
declare out jsonb;
begin
  perform private.give_up_deliveries();
  with c as (
    update public.notifications n set claimed_at = now(), attempts = n.attempts + 1, claim_token = gen_random_uuid()
     where n.id in (select id from public.notifications
                     where pushed_at is null and gave_up_at is null and attempts < 5 and created_at > now() - interval '1 day'
                       and (claimed_at is null or claimed_at < now() - interval '2 minutes')
                     order by created_at limit 200 for update skip locked)
    returning n.*)
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'claimToken', c.claim_token, 'type', c.type, 'message', c.message, 'pushDone', c.push_done, 'waDone', c.wa_done,
    'pushToken', u.push_token, 'phone', coalesce(u.phone, nullif(regexp_replace(coalesce(u.contact_phone, ''), '\D', '', 'g'), '')),
    'name', private.first_name(u.full_name),
    'toRequester', b.id is not null and b.requester_id = c.user_id,
    'booking', case when b.id is not null then jsonb_build_object('ref', b.ref, 'date', b.scheduled_date, 'startTime', b.start_time, 'duration', b.duration_min,
      'amount', b.amount_paid, 'refund', b.refund_amount, 'failed', b.alloc_state = 'failed',
      'requester', private.first_name(rq.full_name), 'companion', private.first_name(cp.full_name),
      'place', concat_ws(', ', nullif(b.meeting_place, ''), nullif(b.area, ''), nullif(b.city, ''))) end)), '[]')
  into out
  from c join public.profiles u on u.id = c.user_id
  left join public.bookings b on b.id = c.booking_id
  left join public.profiles rq on rq.id = b.requester_id
  left join public.profiles cp on cp.id = coalesce(b.companion_id, case when c.type = 'booking_offer' then c.user_id end);
  return out;
end $$;

-- items: [{id, claimToken, push: bool, wa: bool, error?}]. A report without the current token is ignored.
create or replace function public.report_notifications(items jsonb) returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.notifications n
     set push_done = n.push_done or coalesce((i ->> 'push')::boolean, false),
         wa_done = n.wa_done or coalesce((i ->> 'wa')::boolean, false),
         last_error = i ->> 'error',
         pushed_at = case when (n.push_done or coalesce((i ->> 'push')::boolean, false)) and (n.wa_done or coalesce((i ->> 'wa')::boolean, false)) then now() else n.pushed_at end,
         claimed_at = null, claim_token = null
    from jsonb_array_elements(items) i
   where n.id = (i ->> 'id')::uuid and n.claim_token = (i ->> 'claimToken')::uuid;
end $$;

create or replace function public.claim_whatsapp() returns jsonb language plpgsql security definer set search_path = '' as $$
declare out jsonb;
begin
  with c as (update private.whatsapp_outbox o set claimed_at = now(), attempts = o.attempts + 1, claim_token = gen_random_uuid()
              where o.id in (select id from private.whatsapp_outbox
                              where sent_at is null and gave_up_at is null and attempts < 5 and created_at > now() - interval '1 hour'
                                and (claimed_at is null or claimed_at < now() - interval '2 minutes')
                              order by id limit 200 for update skip locked)
              returning o.*)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'claimToken', claim_token, 'phone', phone, 'templateEnv', template_env, 'body', body)), '[]') into out from c;
  return out;
end $$;

-- items: [{id, claimToken, ok: bool, error?}]
create or replace function public.report_whatsapp(items jsonb) returns void language plpgsql security definer set search_path = '' as $$
begin
  update private.whatsapp_outbox o
     set sent_at = case when coalesce((i ->> 'ok')::boolean, false) then now() else o.sent_at end,
         last_error = i ->> 'error', claimed_at = null, claim_token = null
    from jsonb_array_elements(items) i
   where o.id = (i ->> 'id')::bigint and o.claim_token = (i ->> 'claimToken')::uuid;
end $$;

revoke execute on function private.give_up_deliveries() from public, anon, authenticated;
revoke execute on function public.claim_notifications(), public.report_notifications(jsonb), public.claim_whatsapp(), public.report_whatsapp(jsonb) from public, anon, authenticated;
grant execute on function public.claim_notifications(), public.report_notifications(jsonb), public.claim_whatsapp(), public.report_whatsapp(jsonb) to service_role;
