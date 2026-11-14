-- Round 3 (1/4): 5 AM "your session is today" reminder. Enum values must be committed
-- before they are used, so this migration only adds the type and the column.
alter type public.notification_type add value if not exists 'session_reminder';
alter table public.bookings add column if not exists reminder_sent_at timestamptz;
