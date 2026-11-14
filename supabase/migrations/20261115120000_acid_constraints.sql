-- Round 4 (1/4) · ACID: make impossible states impossible at the database level.
-- Checked before applying: no existing row violates any of these.
create unique index if not exists booking_offers_one_live on public.booking_offers (booking_id) where status = 'offered';
create unique index if not exists panic_alerts_one_open on public.panic_alerts (booking_id) where resolved_at is null;
alter table public.bookings
  add constraint bookings_amounts_nonneg check (coalesce(amount_paid, 0) >= 0 and coalesce(refund_amount, 0) >= 0 and coalesce(refund_retained, 0) >= 0
                                                and coalesce(package_price, 0) >= 0 and coalesce(companion_share, 0) >= 0),
  add constraint bookings_refund_le_paid check (coalesce(refund_amount, 0) <= coalesce(amount_paid, 0)),
  add constraint bookings_share_le_price check (companion_share is null or package_price is null or companion_share <= package_price),
  add constraint bookings_accepted_has_companion check (status <> 'accepted' or companion_id is not null);
