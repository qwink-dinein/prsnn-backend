// Supabase Auth "Send SMS" hook → login code on WhatsApp (Waplify), SMS (MSG91) as backup.
// Supabase generates the OTP and calls this function, signed with Standard Webhooks.
// Secrets: SEND_SMS_HOOK_SECRETS (from Auth → Hooks), WAPLIFY_API_KEY, WAPLIFY_TEMPLATE_NAME,
// optional WAPLIFY_CODE_KEYS (default "1"), MSG91_AUTH_KEY, MSG91_TEMPLATE_ID.
// The code and the full number are never logged.
import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';

const WAPLIFY_URL = 'https://server.waplify.io/api/v1/messages/send';
const MSG91_URL = 'https://control.msg91.com/api/v5/otp';
const tail = (p: string) => `…${p.slice(-4)}`;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const fail = (http_code: number, message: string) => json(http_code, { error: { http_code, message } });

async function sendWhatsApp(phone: string, code: string) {
  const key = Deno.env.get('WAPLIFY_API_KEY');
  const template = Deno.env.get('WAPLIFY_TEMPLATE_NAME');
  if (!key || !template) return { ok: false, status: 503 };
  const keys = (Deno.env.get('WAPLIFY_CODE_KEYS') || '1').split(',').map((k) => k.trim()).filter(Boolean);
  try {
    const res = await fetch(WAPLIFY_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      // Authentication templates with a "Copy code" button need the code again in url_button_data.
      body: JSON.stringify({ template_name: template, contact_phone: phone, contact_name: 'prsnn member', body_data: Object.fromEntries(keys.map((k) => [k, code])), url_button_data: code }),
    });
    const out = await res.json().catch(() => ({}));
    if (res.ok && out.status === 'success') return { ok: true, status: 200 };
    console.warn(`waplify ${res.status} ${out.error ?? ''} to=${tail(phone)}`);
    return { ok: false, status: res.status };
  } catch {
    console.warn('waplify unreachable');
    return { ok: false, status: 503 };
  }
}

async function sendSms(phone: string, code: string) {
  const key = Deno.env.get('MSG91_AUTH_KEY');
  const tpl = Deno.env.get('MSG91_TEMPLATE_ID');
  if (!key || !tpl) return { ok: false, status: 503 };
  try {
    const q = new URLSearchParams({ template_id: tpl, mobile: phone, otp: code, realTimeResponse: '1' });
    const res = await fetch(`${MSG91_URL}?${q}`, { method: 'POST', headers: { authkey: key, 'Content-Type': 'application/json' }, body: '{}' });
    const out = await res.json().catch(() => ({}));
    const ok = res.ok && out.type !== 'error';
    if (!ok) console.warn(`msg91 ${res.status} ${out.type ?? ''} to=${tail(phone)}`);
    return { ok, status: res.status };
  } catch {
    return { ok: false, status: 503 };
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return fail(405, 'Method not allowed');
  const payload = await req.text();
  const secret = (Deno.env.get('SEND_SMS_HOOK_SECRETS') ?? '').replace('v1,whsec_', '');
  let data: { user: { phone?: string; user_metadata?: Record<string, unknown> }; sms: { otp: string } };
  try {
    data = new Webhook(secret).verify(payload, Object.fromEntries(req.headers)) as typeof data;
  } catch {
    return fail(401, 'Invalid hook signature');
  }
  const phone = String(data.user?.phone ?? '').replace(/\D/g, '');
  const code = String(data.sms?.otp ?? '');
  if (!/^91[6-9]\d{9}$/.test(phone)) return fail(400, 'Enter a valid 10-digit Indian mobile number.');
  if (!/^\d{4,10}$/.test(code)) return fail(400, 'Bad code');

  // The app asks for SMS by setting channel: 'sms' in signInWithOtp.
  const preferSms = data.user?.user_metadata?.otp_channel === 'sms';
  if (preferSms) {
    const s = await sendSms(phone, code);
    if (s.ok) return json(200, {});
  }
  const wa = await sendWhatsApp(phone, code);
  if (wa.ok) return json(200, {});
  if (!preferSms && wa.status !== 429) {
    const s = await sendSms(phone, code);
    if (s.ok) return json(200, {});
  }
  if (wa.status === 429) return fail(429, 'Too many codes are being sent right now. Please try again in a minute.');
  return fail(503, 'We couldn’t send the code right now. Please try again.');
});
