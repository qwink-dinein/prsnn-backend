-- Admin · Interested: what people chose when they signed up in the app (role, kinds of company,
-- who they want to meet, photo privacy, city), next to the website's interest list. Staff only.
-- Website numbers that later signed up in the app are flagged with joinedApp.

create or replace function public.admin_signups(lim int default 200) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.need_staff();
  return jsonb_build_object(
    'counts', (select jsonb_build_object(
        'total', count(*),
        'member', count(*) filter (where role = 'user'),
        'companion', count(*) filter (where role = 'companion'),
        'setupDone', count(*) filter (where full_name <> '' and city is not null and (role = 'companion' or cardinality(categories) > 0)),
        'categories', (select coalesce(jsonb_object_agg(c, n), '{}') from (
            select c, count(*) n from public.profiles p2, unnest(p2.categories) c where p2.role = 'user' group by c) x))
      from public.profiles where role in ('user', 'companion')),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'fullName', p.full_name,
        'phone', case when p.phone is not null then '+' || ltrim(p.phone, '+') else p.contact_phone end,
        'role', p.role, 'categories', to_jsonb(p.categories), 'gender', p.gender, 'seeGender', p.see_gender,
        'visibility', p.profile_visibility, 'city', p.city, 'area', p.area,
        'approvalStatus', p.approval_status, 'verificationStatus', p.verification_status,
        'setupDone', p.full_name <> '' and p.city is not null and (p.role = 'companion' or cardinality(p.categories) > 0),
        'createdAt', p.created_at) order by p.created_at desc), '[]')
      from (select * from public.profiles where role in ('user', 'companion')
            order by created_at desc limit greatest(1, least(lim, 1000))) p));
end $$;
revoke execute on function public.admin_signups(int) from public, anon;
grant execute on function public.admin_signups(int) to authenticated;

-- Website list: also say whether that number has since signed up in the app.
create or replace function public.admin_enquiries(lim int default 200) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.need_staff();
  return jsonb_build_object(
    'counts', (select jsonb_build_object('total', count(*), 'member', count(*) filter (where interest = 'member'),
                 'companion', count(*) filter (where interest = 'companion'), 'both', count(*) filter (where interest = 'both')) from public.enquiries),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('phone', e.phone, 'interest', e.interest, 'source', e.source, 'submissions', e.submissions,
                 'createdAt', e.created_at, 'updatedAt', e.updated_at,
                 'joinedApp', exists (select 1 from public.profiles p
                    where '+' || ltrim(p.phone, '+') = e.phone or p.contact_phone = e.phone)) order by e.updated_at desc), '[]')
              from (select * from public.enquiries order by updated_at desc limit greatest(1, least(lim, 1000))) e));
end $$;
revoke execute on function public.admin_enquiries(int) from public, anon;
grant execute on function public.admin_enquiries(int) to authenticated;
