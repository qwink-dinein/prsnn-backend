-- Push + WhatsApp delivery queue. Every notification row is delivered once by
-- the `notify` edge function (Expo push to the person's device; WhatsApp
-- template for the booking events that have one). pg_cron pokes it every 30 s.
alter table public.notifications add column booking_id uuid references public.bookings (id) on delete set null;

-- Tag the booking on the notifications that drive WhatsApp templates.
create or replace function private.tag_booking() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.booking_id is null and new.message ~ '#[0-9A-F]{6}' then
    select id into new.booking_id from public.bookings where ref = substring(new.message from '#([0-9A-F]{6})') order by created_at desc limit 1;
  end if;
  return new;
end $$;
create trigger notifications_tag before insert on public.notifications for each row execute function private.tag_booking();

-- Claim up to 200 undelivered notifications (service role only).
create function public.claim_notifications() returns jsonb language plpgsql security definer set search_path = '' as $$
declare out jsonb;
begin
  with c as (
    update public.notifications n set pushed_at = now()
     where n.id in (select id from public.notifications where pushed_at is null and created_at > now() - interval '1 day' order by created_at limit 200 for update skip locked)
    returning n.*)
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'type', c.type, 'message', c.message, 'pushToken', u.push_token, 'phone', u.phone, 'name', private.first_name(u.full_name),
    'booking', case when b.id is not null then jsonb_build_object('ref', b.ref, 'date', b.scheduled_date, 'startTime', b.start_time, 'duration', b.duration_min,
      'amount', b.amount_paid, 'refund', b.refund_amount, 'failed', b.alloc_state = 'failed',
      'requester', private.first_name(rq.full_name), 'companion', private.first_name(cp.full_name)) end)), '[]')
  into out
  from c join public.profiles u on u.id = c.user_id
  left join public.bookings b on b.id = c.booking_id
  left join public.profiles rq on rq.id = b.requester_id
  left join public.profiles cp on cp.id = coalesce(b.companion_id, case when c.type = 'booking_offer' then c.user_id end);
  return out;
end $$;
revoke execute on function public.claim_notifications() from public, anon, authenticated;
grant execute on function public.claim_notifications() to service_role;

-- Broadcast audience tokens (service role only; the edge function checks the caller is a superadmin).
create function public.broadcast_tokens(aud text) returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(push_token), '{}') from public.profiles
   where push_token is not null and not suspended
     and ((aud = 'members' and role = 'user') or (aud = 'companions' and role = 'companion' and verification_status = 'verified'))
$$;
revoke execute on function public.broadcast_tokens(text) from public, anon, authenticated;
grant execute on function public.broadcast_tokens(text) to service_role;

create function public.forget_push_tokens(tokens text[]) returns void language sql security definer set search_path = '' as $$
  update public.profiles set push_token = null where push_token = any (tokens)
$$;
revoke execute on function public.forget_push_tokens(text[]) from public, anon, authenticated;
grant execute on function public.forget_push_tokens(text[]) to service_role;

select cron.schedule('prsnn-notify', '30 seconds', $$
  select net.http_post(url := 'https://mhovyhapzhxcmcuelbol.supabase.co/functions/v1/notify', body := '{}'::jsonb, headers := '{"Content-Type":"application/json"}'::jsonb)
  where exists (select 1 from public.notifications where pushed_at is null and created_at > now() - interval '1 day')
$$);
