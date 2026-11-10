// Delivers queued notifications: Expo push to the person's device, and the
// Meta-approved WhatsApp template for booking events (see WHATSAPP_TEMPLATES.md).
// Triggered by pg_cron every 30 s. Safe to call by anyone: it only sends what is
// already queued, and each row is claimed once (claim_notifications).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { sendPush } from '../_shared/push.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const brand = () => Deno.env.get('WAPLIFY_BRAND_NAME') || 'prsnn';

type Item = {
  id: string; type: string; message: string; pushToken: string | null; phone: string | null; name: string;
  booking: null | { ref: string; date: string; startTime: string; duration: number; amount: number; refund: number; failed: boolean; requester: string; companion: string };
};

const dateText = (d: string) => new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
const timeText = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
const durText = (min: number) => `${min / 60} ${min === 60 ? 'hour' : 'hours'}`;
const rupees = (n: number) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

// Template + body variables ({{1}}…) per notification. Same order as the Express backend.
function whatsapp(it: Item): { env: string; values: string[] } | null {
  const b = it.booking;
  if (!b) return null;
  switch (it.type) {
    case 'booking_offer': // companion: new paid request
      return { env: 'WAPLIFY_TPL_BOOKING_REQUEST', values: [it.name || 'there', brand(), b.requester || 'A member', dateText(b.date), timeText(b.startTime), durText(b.duration), b.ref] };
    case 'booking_confirmed': // member: companion accepted
      return { env: 'WAPLIFY_TPL_BOOKING_CONFIRMED', values: [it.name || 'there', brand(), b.companion || 'your companion', dateText(b.date), timeText(b.startTime), b.ref] };
    case 'refund':
      return b.failed ? { env: 'WAPLIFY_TPL_BOOKING_UNFULFILLED', values: [it.name || 'there', brand(), dateText(b.date), timeText(b.startTime), rupees(b.refund || b.amount), b.ref] } : null;
    default:
      return null;
  }
}

async function sendWhatsApp(phone: string, template: string, values: string[]) {
  const key = Deno.env.get('WAPLIFY_API_KEY');
  if (!key) return;
  try {
    const res = await fetch('https://server.waplify.io/api/v1/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_name: template, contact_phone: phone, contact_name: 'prsnn member', body_data: Object.fromEntries(values.map((v, i) => [String(i + 1), v])) }),
    });
    if (!res.ok) console.warn(`waplify template ${template} ${res.status} to=…${phone.slice(-4)}`);
  } catch {
    console.warn('waplify unreachable');
  }
}

const TITLES: Record<string, string> = {
  booking_offer: 'New paid booking', booking_confirmed: 'Booking confirmed', booking_cancelled: 'Booking cancelled',
  payment_completed: 'Payment received', refund: 'Refund', dispute: 'prsnn support',
  action_needed: 'Action needed', approval: 'prsnn', panic: '🚨 Panic alert',
};

Deno.serve(async () => {
  const { data, error } = await db.rpc('claim_notifications');
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  const items = (data ?? []) as Item[];
  const pushes = items.filter((i) => i.pushToken).map((i) => ({
    to: i.pushToken!, title: TITLES[i.type] ?? 'prsnn', body: i.message, data: { type: i.type, notificationId: i.id },
    ...(i.type === 'panic' ? { priority: 'high' as const, channelId: 'panic' } : {}),
  }));
  const result = pushes.length ? await sendPush(pushes) : { sent: 0, failed: 0, batches: 0, invalid: [] as string[] };
  if (result.invalid.length) await db.rpc('forget_push_tokens', { tokens: result.invalid });
  let wa = 0;
  for (const it of items) {
    const w = whatsapp(it);
    const template = w ? Deno.env.get(w.env) : null;
    if (w && template && it.phone) {
      await sendWhatsApp(it.phone, template, w.values);
      wa++;
    }
  }
  // WhatsApp rows not tied to a notification: panic alerts to every admin number (template WAPLIFY_TPL_PANIC_ALERT).
  const { data: outbox } = await db.rpc('claim_whatsapp');
  let alerts = 0;
  for (const o of (outbox ?? []) as { phone: string; templateEnv: string; body: string[] }[]) {
    const template = Deno.env.get(o.templateEnv);
    if (!template) {
      console.warn(`no template set for ${o.templateEnv}`);
      continue;
    }
    await sendWhatsApp(o.phone, template, o.body);
    alerts++;
  }
  return new Response(JSON.stringify({ claimed: items.length, pushed: result.sent, whatsapp: wa, alerts }), { headers: { 'Content-Type': 'application/json' } });
});
