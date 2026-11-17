-- Admin overview: people boxes. Members (role user), companions (all, any approval status;
-- `companions` stays the verified count) and companions who have also booked someone as a
-- customer at least once (a paid booking, real or test). Users screen gets a matching "both" filter.
create or replace function private.both_sides(uid uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.bookings b where b.requester_id = uid and b.payment_status in ('paid', 'refunded'))
$$;

create or replace function public.admin_overview()
 returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare r public.user_role := private.need_staff(); out jsonb;
begin
  out := jsonb_build_object('role', r,
    'pendingVerifications', (select count(*) from public.profiles where role = 'companion' and verification_status = 'pending'),
    'liveBookings', (select count(*) from public.bookings where status in ('pending', 'accepted')),
    'openDisputes', (select count(*) from public.bookings where dispute_status = 'open'),
    'refundsToReview', (select count(*) from public.bookings where refund_review_needed),
    'failedRefunds', (select count(*) from public.bookings where refund_status = 'failed'),
    'members', (select count(*) from public.profiles where role = 'user'),
    'companions', (select count(*) from public.profiles where role = 'companion' and verification_status = 'verified'),
    'allCompanions', (select count(*) from public.profiles where role = 'companion'),
    'bothSides', (select count(*) from public.profiles p where p.role = 'companion' and private.both_sides(p.id)),
    'bookingsToday', (select count(*) from public.bookings where created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'));
  if r = 'superadmin' then
    out := out || (select jsonb_build_object('money', jsonb_build_object(
      'collected', coalesce(sum(amount_paid), 0),
      'refunded', coalesce(sum(refund_amount) filter (where refund_status = 'processed'), 0),
      'companionPayouts', coalesce(sum(companion_share) filter (where status in ('accepted', 'completed')), 0),
      'platformNet', coalesce(sum(amount_paid), 0) - coalesce(sum(refund_amount) filter (where refund_status = 'processed'), 0) - coalesce(sum(companion_share) filter (where status in ('accepted', 'completed')), 0),
      'since', (select min(created_at) from public.bookings where payment_mode = 'razorpay')))
      from public.bookings where payment_status in ('paid', 'refunded') and payment_mode = 'razorpay');
  end if;
  return out;
end $function$;

create or replace function public.admin_users(q text default '', role_filter text default '')
 returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare t text := trim(coalesce(q, '')); digits text := regexp_replace(coalesce(q, ''), '\D', '', 'g');
begin
  perform private.need_staff();
  return (select coalesce(jsonb_agg(private.admin_user_json(p) order by p.created_at desc), '[]') from (
    select * from public.profiles p
     where (role_filter = '' or (role_filter = 'staff' and p.role in ('subadmin', 'superadmin'))
            or (role_filter = 'both' and p.role = 'companion' and private.both_sides(p.id)) or p.role::text = role_filter)
       and (t = '' or p.full_name ilike '%' || t || '%' or p.city ilike '%' || t || '%' or (char_length(digits) >= 4 and p.phone like '%' || digits || '%'))
     order by p.created_at desc limit 100) p);
end $function$;
