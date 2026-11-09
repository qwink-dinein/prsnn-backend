/**
 * Delivers a one-time login code to an Indian mobile number.
 *
 * Primary channel: WhatsApp through Waplify, using a Meta-approved
 * Authentication template. Backup channel: SMS through MSG91 (DLT template),
 * used when WhatsApp cannot deliver, or first when the member asked for SMS.
 *
 * Same contract as Hyderabad Rishta's send-whatsapp-otp function:
 *   POST https://server.waplify.io/api/v1/messages/send
 *   Authorization: Bearer <WAPLIFY_API_KEY>
 *   { template_name, contact_phone: "91XXXXXXXXXX", contact_name, body_data, url_button_data }
 * Authentication templates with a "Copy code" button need the code again in
 * url_button_data or Meta rejects the message.
 *
 * Env:
 *   WAPLIFY_API_KEY, WAPLIFY_TEMPLATE_NAME           (required for WhatsApp)
 *   WAPLIFY_CODE_KEYS   comma list of body_data keys that receive the code (default "1")
 *   MSG91_AUTH_KEY, MSG91_TEMPLATE_ID                (optional SMS backup)
 *
 * The code and the full number are never logged.
 */

const WAPLIFY_URL = 'https://server.waplify.io/api/v1/messages/send';
const MSG91_URL = 'https://control.msg91.com/api/v5/otp';

const tail = (phone) => `…${String(phone).slice(-4)}`;

export const whatsappConfigured = () => !!(process.env.WAPLIFY_API_KEY && process.env.WAPLIFY_TEMPLATE_NAME);
export const smsConfigured = () => !!(process.env.MSG91_AUTH_KEY && process.env.MSG91_TEMPLATE_ID);

async function sendWhatsApp(phone, code, fetchImpl) {
  if (!whatsappConfigured()) return { ok: false, status: 503 };
  const keys = (process.env.WAPLIFY_CODE_KEYS || '1').split(',').map((k) => k.trim()).filter(Boolean);
  const body_data = Object.fromEntries(keys.map((k) => [k, code]));
  try {
    const res = await fetchImpl(WAPLIFY_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.WAPLIFY_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        template_name: process.env.WAPLIFY_TEMPLATE_NAME,
        contact_phone: phone,
        contact_name: 'prsnn member',
        body_data,
        url_button_data: code,
      }),
    });
    const out = await res.json().catch(() => ({}));
    if (res.status >= 200 && res.status < 300 && out.status === 'success') return { ok: true, status: 200 };
    console.warn(`waplify ${res.status} ${out.error ?? ''} req=${res.headers.get('X-Request-ID') ?? '-'} to=${tail(phone)}`);
    return { ok: false, status: res.status };
  } catch {
    console.warn('waplify unreachable');
    return { ok: false, status: 503 };
  }
}

async function sendSms(phone, code, fetchImpl) {
  if (!smsConfigured()) return { ok: false, status: 503 };
  try {
    const q = new URLSearchParams({ template_id: process.env.MSG91_TEMPLATE_ID, mobile: phone, otp: code, realTimeResponse: '1' });
    const res = await fetchImpl(`${MSG91_URL}?${q}`, {
      method: 'POST',
      headers: { authkey: process.env.MSG91_AUTH_KEY, 'Content-Type': 'application/json' },
      body: '{}',
    });
    const out = await res.json().catch(() => ({}));
    const ok = res.status >= 200 && res.status < 300 && out.type !== 'error';
    if (!ok) console.warn(`msg91 ${res.status} ${out.type ?? ''} to=${tail(phone)}`);
    return { ok, status: res.status };
  } catch {
    console.warn('msg91 unreachable');
    return { ok: false, status: 503 };
  }
}

/**
 * @param {string} phone  digits with country code, e.g. "919876543210"
 * @param {string} code   the one-time code
 * @param {{ preferSms?: boolean, fetchImpl?: typeof fetch }} opts
 * @returns {Promise<{ ok: boolean, channel?: 'whatsapp'|'sms', status: number }>}
 */
export async function deliverOtp(phone, code, { preferSms = false, fetchImpl = globalThis.fetch } = {}) {
  if (preferSms && smsConfigured()) {
    const sms = await sendSms(phone, code, fetchImpl);
    if (sms.ok) return { ok: true, channel: 'sms', status: 200 };
  }
  const wa = await sendWhatsApp(phone, code, fetchImpl);
  if (wa.ok) return { ok: true, channel: 'whatsapp', status: 200 };
  // WhatsApp failed (not on WhatsApp, Waplify down, not set up): same code by SMS.
  if (!preferSms && wa.status !== 429 && smsConfigured()) {
    const sms = await sendSms(phone, code, fetchImpl);
    if (sms.ok) return { ok: true, channel: 'sms', status: 200 };
  }
  return { ok: false, status: wa.status };
}
