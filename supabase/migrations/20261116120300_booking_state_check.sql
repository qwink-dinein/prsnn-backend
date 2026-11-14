-- Round 5 (4/6) · A prepaid booking's status and its allocation stage can only appear in the
-- combinations the booking engine produces:
--   pending   ⇔ awaiting payment, finding a companion, or held for the ID check
--   accepted / completed ⇔ assigned
--   cancelled ⇔ cancelled or failed
-- Every current write path already keeps to this; the constraint makes anything else impossible.
alter table public.bookings add constraint bookings_prepaid_states check (
  flow <> 'prepaid'
  or (status = 'pending' and alloc_state in ('awaiting_payment', 'offering', 'id_check'))
  or (status in ('accepted', 'completed') and alloc_state = 'assigned')
  or (status = 'cancelled' and alloc_state in ('cancelled', 'failed'))
) not valid;
alter table public.bookings validate constraint bookings_prepaid_states;
