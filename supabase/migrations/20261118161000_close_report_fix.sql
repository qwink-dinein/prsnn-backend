-- admin_close_report: the `resolution` parameter clashed with the column; use $2 (also fixed in 20261118160000).
create or replace function public.admin_close_report(rid uuid, resolution text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  perform private.need_staff();
  update public.user_reports set status = 'closed', resolution = nullif(left(trim(coalesce($2, '')), 500), ''),
         handled_by = (select auth.uid()), handled_at = now()
   where id = rid and status = 'open';
  if not found then perform private.fail('Report not found or already closed.'); end if;
  perform private.audit('report.close', 'report', rid::text, null, jsonb_build_object('resolution', $2));
  return jsonb_build_object('message', 'Report closed.');
end $$;
