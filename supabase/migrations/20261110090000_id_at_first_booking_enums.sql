-- Companion ID check moves from sign-up to the first booking.
--   verification_status 'id_required': profile complete and live; an ID is
--     asked for when they accept their first booking.
--   alloc_state 'id_check': a companion whose ID is under review accepted the
--     booking; it is held for them until staff approve (→ assigned) or reject
--     (→ offered to the next companion, or refunded at the deadline).
alter type public.verification_status add value if not exists 'id_required' before 'pending';
alter type public.alloc_state add value if not exists 'id_check' after 'offering';
alter table public.profiles add column if not exists id_type text
  check (id_type is null or id_type in ('aadhaar', 'pan', 'driving_licence', 'passport', 'voter_id'));
