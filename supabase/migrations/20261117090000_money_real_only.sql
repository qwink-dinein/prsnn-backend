-- Admin overview "Money": count only real Razorpay payments (payment_mode = 'razorpay'),
-- not the simulated test bookings from before going live. Future test bookings stay out too.
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
