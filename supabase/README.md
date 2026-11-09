# prsnn on Supabase

Project `prsnn` (ref `mhovyhapzhxcmcuelbol`, Mumbai `ap-south-1`). Replaces the Express +
MongoDB + Cloudinary backend (still in `src/`, retired once the website is moved).

| Piece | Where |
|---|---|
| Tables, row-level security, enums | `migrations/*_schema.sql` |
| Profiles, listing (gender filter, locked photos), booking views | `*_core_functions.sql` |
| Prepaid engine: create → pay → offers (max 3) → atomic accept / refund, cancel policy, disputes, chat masking, 30 s sweeper (`pg_cron`) | `*_booking_engine.sql` |
| Admin (ADMIN_SPEC.md): roles, verify, users, bookings, money, disputes, prices, activity; Storage buckets | `*_admin.sql` |
| Push / WhatsApp queue | `*_notify_queue.sql` |
| WhatsApp login codes (Auth "Send SMS" hook) | `functions/send-sms` |
| Push + WhatsApp booking notices (cron every 30 s) | `functions/notify` |
| Superadmin push broadcast | `functions/broadcast` |

Every client call is an RPC (`supabase.rpc('…')`) to a security-definer function that checks
`auth.uid()` and the caller's current role; tables have no client write policies.

## Owner setup (dashboard)

1. **Auth → Providers → Phone**: enable. Turn on "Enable phone confirmations".
2. **Auth → Hooks → Send SMS hook**: HTTPS, `https://mhovyhapzhxcmcuelbol.supabase.co/functions/v1/send-sms`. Generate the secret.
3. **Edge Functions → Secrets**: `SEND_SMS_HOOK_SECRETS` (the hook secret), `WAPLIFY_API_KEY`, `WAPLIFY_TEMPLATE_NAME`,
   optional `WAPLIFY_CODE_KEYS`, `WAPLIFY_BRAND_NAME`, `WAPLIFY_TPL_BOOKING_REQUEST`, `WAPLIFY_TPL_BOOKING_CONFIRMED`,
   `WAPLIFY_TPL_BOOKING_UNFULFILLED`, `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`, `EXPO_ACCESS_TOKEN`.
4. **SQL editor**: your superadmin numbers (10 digits): `insert into private.superadmin_phones values ('98XXXXXXXX');`
5. Test logins for reviewers: **Auth → Providers → Phone → Test phone numbers** (`919000000009=123456`).

Payment mode lives in `private.config` (`payment_mode` = `simulated` | `razorpay`). Razorpay is not wired yet.
