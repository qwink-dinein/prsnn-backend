/**
 * Booking updates on WhatsApp through Waplify, using Meta-approved UTILITY
 * templates (see prsnn-mobile/WHATSAPP_TEMPLATES.md for the exact wording).
 *
 *   booking_request   → companion  "You have a new booking request…"
 *   booking_accepted  → member     "…accepted your booking. Please pay to confirm…"
 *   payment_received  → companion  "…has paid. Your booking is confirmed, chat is open…"
 *
 * Best effort: a failed WhatsApp send never fails the booking or payment —
 * the in-app Notification is always written first. Each template is optional:
 * leave its env var empty and that message is simply skipped.
 *
 * Env:
 *   WAPLIFY_API_KEY
 *   WAPLIFY_TPL_BOOKING_REQUEST, WAPLIFY_TPL_BOOKING_ACCEPTED, WAPLIFY_TPL_PAYMENT_RECEIVED
 *
 * Never logs the full number.
 */
import { normaliseIndianMobile } from './phone.js';

const WAPLIFY_URL = 'https://server.waplify.io/api/v1/messages/send';

export const TEMPLATE_ENV = {
  booking_request: 'WAPLIFY_TPL_BOOKING_REQUEST',
  booking_accepted: 'WAPLIFY_TPL_BOOKING_ACCEPTED',
  payment_received: 'WAPLIFY_TPL_PAYMENT_RECEIVED',
};

/** Verified login number first; else the number the person typed on their own profile. */
export const whatsappNumberOf = (user) => (user?.phone ? normaliseIndianMobile(user.phone) : null) || normaliseIndianMobile(user?.phoneNumber ?? '');

export const firstName = (user, fallback = 'there') => (user?.fullName || user?.username || fallback).trim().split(/\s+/)[0];

const DAY = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Booking dates are stored as UTC midnight of the chosen day. */
export const dateText = (d) => DAY.format(new Date(d));

export function timeText(hhmm = '') {
  const [h, m] = String(hhmm).split(':').map(Number);
  if (Number.isNaN(h)) return hhmm;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m || 0).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

export function durationText(min) {
  const n = Number(min) || 60;
  if (n < 60) return `${n} min`;
  const h = n / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)} ${h === 1 ? 'hour' : 'hours'}`;
}

export const refOf = (booking) => String(booking._id).slice(-6).toUpperCase();

export const rupeesText = (n) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

/**
 * Body variables for each template, in {{1}}, {{2}}… order. Kept here so the
 * template wording (WHATSAPP_TEMPLATES.md) and the code can be checked together.
 */
/** Brand shown inside the messages ({{2}}/{{4}}); a variable so templates carry no fixed name. */
export const brandName = () => process.env.WAPLIFY_BRAND_NAME || 'prsnn';

export const bodyFor = {
  // Hello {{1}}, you have received a new booking request on {{2}}. Requested by {{3}}, {{4}} date, {{5}} time, {{6}} duration, {{7}} ref
  booking_request: ({ booking, requester, companion }) => [
    firstName(companion),
    brandName(),
    firstName(requester, 'A member'),
    dateText(booking.scheduledDate),
    timeText(booking.startTime),
    durationText(booking.duration),
    refOf(booking),
  ],
  // Hello {{1}}, your booking request on {{2}} has been accepted by {{3}}. {{4}} date, {{5}} time, ₹{{6}} amount, {{7}} ref
  booking_accepted: ({ booking, requester, companion, amount }) => [
    firstName(requester),
    brandName(),
    firstName(companion, 'your companion'),
    dateText(booking.scheduledDate),
    timeText(booking.startTime),
    rupeesText(amount),
    refOf(booking),
  ],
  // Hello {{1}}, the payment of ₹{{2}} from {{3}} has been received for your booking on {{4}}. {{5}} date, {{6}} time, {{7}} ref
  payment_received: ({ booking, requester, companion, amount }) => [
    firstName(companion),
    rupeesText(amount),
    firstName(requester, 'your member'),
    brandName(),
    dateText(booking.scheduledDate),
    timeText(booking.startTime),
    refOf(booking),
  ],
};

/**
 * @param {'booking_request'|'booking_accepted'|'payment_received'} kind
 * @param {object} to  the User receiving the message
 * @param {object} ctx { booking, requester, companion, amount? }
 * @returns {Promise<{ sent: boolean, reason?: string }>}
 */
export async function notifyWhatsApp(kind, to, ctx, { fetchImpl = globalThis.fetch } = {}) {
  const template = process.env[TEMPLATE_ENV[kind]];
  if (!process.env.WAPLIFY_API_KEY || !template) return { sent: false, reason: 'not_configured' };
  const phone = whatsappNumberOf(to);
  if (!phone) return { sent: false, reason: 'no_number' };

  const values = bodyFor[kind](ctx);
  const body_data = Object.fromEntries(values.map((v, i) => [String(i + 1), String(v)]));
  try {
    const res = await fetchImpl(WAPLIFY_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.WAPLIFY_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_name: template, contact_phone: phone, contact_name: firstName(to, 'prsnn member'), body_data }),
    });
    const out = await res.json().catch(() => ({}));
    if (res.status >= 200 && res.status < 300 && out.status === 'success') return { sent: true };
    console.warn(`waplify ${kind} ${res.status} ${out.error ?? ''} to=…${phone.slice(-4)}`);
    return { sent: false, reason: `http_${res.status}` };
  } catch {
    console.warn(`waplify ${kind} unreachable`);
    return { sent: false, reason: 'unreachable' };
  }
}

/** Fire-and-forget wrapper for controllers: never throws, never delays the response. */
export function notifyWhatsAppLater(kind, to, ctx) {
  notifyWhatsApp(kind, to, ctx).catch(() => {});
}
