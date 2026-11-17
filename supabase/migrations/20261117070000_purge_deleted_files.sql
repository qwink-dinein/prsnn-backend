-- Deleting an account now deletes its files too, as the privacy policy and the
-- "Delete your account" page promise: profile photos (avatars) at once, ID documents
-- and selfie (verification) at once unless the person is part of an open safety case
-- (an unresolved panic alert or dispute on one of their bookings); those go once it closes.
-- Supabase blocks deleting storage.objects with SQL, so the `purge-files` edge function
-- removes them through the Storage API. It runs right after each deletion and every 15 minutes.

-- Files whose owner folder belongs to a deleted account (and no live account).
create or replace function private.purgeable_files(lim int default 200)
returns table (bucket text, name text) language sql stable security definer set search_path = '' as $$
  select o.bucket_id, o.name
    from storage.objects o
    join public.deleted_accounts d on d.original_user_id::text = split_part(o.name, '/', 1)
   where o.bucket_id in ('avatars', 'verification')
     and not exists (select 1 from auth.users u where u.id = d.original_user_id)
     and (o.bucket_id = 'avatars' or not exists (
           select 1 from public.bookings b
            where (b.requester_id = d.original_user_id or b.companion_id = d.original_user_id)
              and ((b.dispute_opened_at is not null and b.dispute_resolved_at is null)
                   or exists (select 1 from public.panic_alerts a where a.booking_id = b.id and a.resolved_at is null))))
   order by o.created_at
   limit greatest(1, least(coalesce(lim, 200), 1000))
$$;

-- For the edge function only (service role).
create or replace function public.purge_files_claim(lim int default 200)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('bucket', f.bucket, 'name', f.name)), '[]') from private.purgeable_files(lim) f
$$;
revoke all on function public.purge_files_claim(int) from public, anon, authenticated;
grant execute on function public.purge_files_claim(int) to service_role;

create or replace function private.kick_purge() returns void language sql security definer set search_path = '' as $$
  select null::void from (select net.http_post(url := 'https://mhovyhapzhxcmcuelbol.supabase.co/functions/v1/purge-files',
    body := '{}'::jsonb, headers := '{"Content-Type":"application/json"}'::jsonb)) x
$$;

-- Right after an account is deleted (the HTTP call is sent when the transaction commits).
create or replace function private.after_account_deleted() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.kick_purge();
  return new;
end $$;
drop trigger if exists deleted_accounts_purge on public.deleted_accounts;
create trigger deleted_accounts_purge after insert on public.deleted_accounts for each row execute function private.after_account_deleted();

-- Safety net, and ID documents held for a safety case that has since closed.
select cron.unschedule('purge-files') where exists (select 1 from cron.job where jobname = 'purge-files');
select cron.schedule('purge-files', '*/15 * * * *', $cron$
  select private.kick_purge() where exists (select 1 from private.purgeable_files(1))
$cron$);
