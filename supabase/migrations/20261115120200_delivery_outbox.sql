-- Round 4 (3/4) · ACID delivery: a notification or WhatsApp is only marked sent after the
-- provider accepted it. Claims are leases (2 min); unconfirmed rows are retried, at most 5 times.
-- Push and WhatsApp are tracked separately so a retry never repeats the channel that worked.
alter table public.notifications
  add column if not exists claimed_at timestamptz,
  add column if not exists attempts int not null default 0,
  add column if not exists push_done boolean not null default false,
  add column if not exists wa_done boolean not null default false,
  add column if not exists last_error text;
-- Rows delivered under the old scheme count as done.
update public.notifications set push_done = true, wa_done = true where pushed_at is not null and not (push_done and wa_done);
alter table private.whatsapp_outbox
  add column if not exists attempts int not null default 0,
  add column if not exists sent_at timestamptz,
  add column if not exists last_error text;
update private.whatsapp_outbox set sent_at = claimed_at where claimed_at is not null and sent_at is null;
create index if not exists notifications_undelivered on public.notifications (created_at) where pushed_at is null;

create or replace function public.claim_notifications() returns jsonb language plpgsql security definer set search_path = '' as $$
declare out jsonb;
begin
  with c as (
    update public.notifications n set claimed_at = now(), attempts = n.attempts + 1
     where n.id in (select id from public.notifications
                     where pushed_at is null and attempts < 5 and created_at > now() - interval '1 day'
                       and (claimed_at is null or claimed_at < now() - interval '2 minutes')
                     order by created_at limit 200 for update skip locked)
    returning n.*)
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'type', c.type, 'message', c.message, 'pushDone', c.push_done, 'waDone', c.wa_done,
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

-- The notify function reports what actually went out. items: [{id, push: bool, wa: bool, error?}]
create or replace function public.report_notifications(items jsonb) returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.notifications n
     set push_done = n.push_done or coalesce((i ->> 'push')::boolean, false),
         wa_done = n.wa_done or coalesce((i ->> 'wa')::boolean, false),
         last_error = i ->> 'error',
         pushed_at = case when (n.push_done or coalesce((i ->> 'push')::boolean, false)) and (n.wa_done or coalesce((i ->> 'wa')::boolean, false)) then now() else n.pushed_at end,
         claimed_at = null
    from jsonb_array_elements(items) i
   where n.id = (i ->> 'id')::uuid;
end $$;

create or replace function public.claim_whatsapp() returns jsonb language plpgsql security definer set search_path = '' as $$
declare out jsonb;
begin
  with c as (update private.whatsapp_outbox o set claimed_at = now(), attempts = o.attempts + 1
              where o.id in (select id from private.whatsapp_outbox
                              where sent_at is null and attempts < 5 and created_at > now() - interval '1 hour'
                                and (claimed_at is null or claimed_at < now() - interval '2 minutes')
                              order by id limit 200 for update skip locked)
              returning o.*)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'phone', phone, 'templateEnv', template_env, 'body', body)), '[]') into out from c;
  return out;
end $$;

-- items: [{id, ok: bool, error?}]
create or replace function public.report_whatsapp(items jsonb) returns void language plpgsql security definer set search_path = '' as $$
begin
  update private.whatsapp_outbox o
     set sent_at = case when coalesce((i ->> 'ok')::boolean, false) then now() else o.sent_at end,
         last_error = i ->> 'error', claimed_at = null
    from jsonb_array_elements(items) i
   where o.id = (i ->> 'id')::bigint;
end $$;

revoke execute on function public.claim_notifications(), public.report_notifications(jsonb), public.claim_whatsapp(), public.report_whatsapp(jsonb) from public, anon, authenticated;
grant execute on function public.claim_notifications(), public.report_notifications(jsonb), public.claim_whatsapp(), public.report_whatsapp(jsonb) to service_role;
