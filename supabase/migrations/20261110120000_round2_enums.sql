-- Round 2 (owner, 2026-11-10): new notification kinds. Separate migration so the
-- values exist before functions use them.
alter type public.notification_type add value if not exists 'action_needed';
alter type public.notification_type add value if not exists 'approval';
alter type public.notification_type add value if not exists 'panic';
