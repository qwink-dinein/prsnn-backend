-- Tell every admin when an account is deleted: who, which role and city, the
-- mobile number, who deleted it and how long after signing up.
-- No new data is kept: the number is already in deleted_accounts, and the
-- notification is the only place the name and city survive (privacy policy unchanged).

create or replace function private.deleted_account_message(p public.profiles, joined timestamptz, self_delete boolean, by_name text, why text)
returns text language sql stable set search_path = '' as $$
  select coalesce(nullif(trim(p.full_name), ''), 'Someone')
    || ' (' || concat_ws(', ', coalesce(p.role::text, 'user'), nullif(trim(coalesce(p.city, p.state, '')), ''),
                         case when coalesce(p.phone, p.contact_phone) ~ '^91[6-9][0-9]{9}$'
                              then '+91 ' || substr(coalesce(p.phone, p.contact_phone), 3, 5) || ' ' || substr(coalesce(p.phone, p.contact_phone), 8)
                              when coalesce(p.phone, p.contact_phone) is not null then '+' || coalesce(p.phone, p.contact_phone) end) || ') '
    || case when self_delete
            then 'deleted ' || case p.gender::text when 'man' then 'his account himself' when 'woman' then 'her account herself' else 'their account themselves' end
            else 'was deleted by ' || coalesce(nullif(trim(by_name), ''), 'an admin') || coalesce(' (' || nullif(trim(why), '') || ')', '') end
    || case when joined is null then ''
            when now() - joined < interval '1 hour' then ', ' || greatest(1, floor(extract(epoch from now() - joined) / 60))::int || ' min after signing up'
            when now() - joined < interval '48 hours' then ', ' || floor(extract(epoch from now() - joined) / 3600)::int || ' h after signing up'
            else ', ' || floor(extract(epoch from now() - joined) / 86400)::int || ' days after signing up' end
    || '.'
$$;

create or replace function private.delete_account(uid uuid, by_id uuid, why text)
 returns void language plpgsql security definer set search_path = '' as $function$
declare p public.profiles; n int; joined timestamptz; by_name text; did uuid;
begin
  select * into p from public.profiles where id = uid;
  select count(*) into n from public.bookings where (requester_id = uid or companion_id = uid) and status in ('pending', 'accepted') and payment_status = 'paid';
  if n > 0 then perform private.fail('There ' || case when n = 1 then 'is 1 paid booking' else 'are ' || n || ' paid bookings' end || ' still open. Cancel ' || case when n = 1 then 'it' else 'them' end || ' first (refunds follow the usual rules).'); end if;
  update public.bookings set status = 'cancelled', alloc_state = case when alloc_state is not null then 'cancelled'::public.alloc_state end,
         cancelled_by = case when by_id = uid then case when companion_id = uid then 'companion' else 'requester' end else 'admin' end,
         cancel_reason = 'account_deleted', cancelled_at = now()
   where (requester_id = uid or companion_id = uid) and status in ('pending', 'accepted');
  insert into public.deleted_accounts (original_user_id, phone, role, deleted_by, reason) values (uid, coalesce(p.phone, p.contact_phone), p.role, by_id, left(why, 200)) returning id into did;
  select created_at into joined from auth.users where id = uid;
  select full_name into by_name from public.profiles where id = by_id;
  -- Every admin except the one who did it (they already know).
  insert into public.notifications (user_id, type, message, action)
  select s.id, 'other',
         private.deleted_account_message(p, coalesce(joined, p.created_at), by_id = uid, by_name, case when why like 'Deleted by admin%' then null else why end),
         jsonb_build_object('kind', 'account_deleted', 'role', p.role, 'deletedId', did, 'phone', coalesce(p.phone, p.contact_phone))
    from public.profiles s where s.role in ('subadmin', 'superadmin') and not s.suspended and s.id is distinct from by_id;
  delete from auth.users where id = uid;
end $function$;

-- Old "to review" notices about someone who has since deleted their account now say so,
-- and no longer open an empty approvals queue.
create or replace function private.retire_review_notices() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.notifications set message = message || ' (Account since deleted.)', action = null
   where action->>'kind' = 'review' and action->>'uid' = old.id::text and message not like '%(Account since deleted.)';
  return old;
end $$;
drop trigger if exists profiles_retire_review_notices on public.profiles;
create trigger profiles_retire_review_notices after delete on public.profiles for each row execute function private.retire_review_notices();

-- Backfill: self-deleted accounts from the last 7 days that no admin was told about.
-- Name and city come from the earlier "to review" notice when there was one.
do $$
declare d public.deleted_accounts; nm text; p public.profiles;
begin
  for d in select * from public.deleted_accounts where deleted_at > now() - interval '7 days' and deleted_by = original_user_id order by deleted_at loop
    if exists (select 1 from public.notifications where action->>'kind' = 'account_deleted' and action->>'deletedId' = d.id::text) then continue; end if;
    select substring(message from 'New companion to review: (.*)\.$') into nm from public.notifications
     where action->>'uid' = d.original_user_id::text and message like 'New companion to review:%' order by created_at desc limit 1;
    p := null;
    p.full_name := nullif(trim(regexp_replace(coalesce(nm, ''), '\s*\(.*\)$', '')), '');
    p.city := substring(nm from '\(([^)]*)\)$');
    p.role := d.role; p.phone := d.phone;
    perform private.notify_staff('other',
      private.deleted_account_message(p, null, true, null, null)
        || ' Deleted ' || to_char(d.deleted_at at time zone 'Asia/Kolkata', 'DD Mon, HH12:MI AM') || '.',
      jsonb_build_object('kind', 'account_deleted', 'role', d.role, 'deletedId', d.id, 'phone', d.phone));
    update public.notifications set message = message || ' (Account since deleted.)', action = null
     where action->>'kind' = 'review' and action->>'uid' = d.original_user_id::text and message not like '%(Account since deleted.)';
  end loop;
end $$;
