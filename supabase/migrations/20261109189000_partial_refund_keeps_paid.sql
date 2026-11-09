-- A partial refund on a booking that still stands keeps payment_status 'paid'
-- (chat and unlocked profiles depend on it). Only a full refund marks it 'refunded'.

create or replace function private.refund(bid uuid, amount numeric, reason text) returns text language plpgsql security definer set search_path = '' as $$
declare b public.bookings; amt numeric := greatest(0, round(amount, 2));
begin
  update public.bookings set refund_status = 'pending', refund_amount = amt, refund_reason = left(reason, 200),
         refund_requested_at = now(), refund_attempts = refund_attempts + 1
   where id = bid and payment_status = 'paid' and (refund_status = 'none' or (refund_status = 'failed' and refund_attempts < 5))
  returning * into b;
  if not found then return 'skipped'; end if;
  if amt <= 0 then
    update public.bookings set refund_status = 'processed', refund_processed_at = now() where id = bid;
    return 'processed';
  end if;
  if b.payment_mode = 'simulated' then
    update public.bookings set refund_status = 'processed', refund_processed_at = now(), refund_provider_id = 'sim_rfnd_' || extract(epoch from now())::bigint,
           payment_status = case when amt >= b.amount_paid then 'refunded'::public.payment_status else payment_status end
     where id = bid;
    return 'processed';
  end if;
  return 'pending';
end $$;
update public.bookings set payment_status = 'paid' where payment_status = 'refunded' and refund_amount < amount_paid and status in ('accepted', 'completed');
