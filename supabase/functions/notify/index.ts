// Delivers queued notifications: Expo push to the person's device, and the
// Meta-approved WhatsApp template for booking events (see WHATSAPP_TEMPLATES.md).
// Triggered by pg_cron every 30 s. Safe to call by anyone: it only sends what is
// already queued, and each row is claimed once (claim_notifications).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { sendPush } from '../_shared/push.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const brand = () => Deno.env.get('WAPLIFY_BRAND_NAME') || 'prsnn';

type Item = {
  id: string; claimToken?: string; type: string; message: string; pushToken: string | null; phone: string | null; name: string;
  /** Channels already delivered on an earlier attempt (never repeated). */
  pushDone: boolean; waDone: boolean;
  /** true when the recipient is the member who booked; false for the companion (or anyone else). */
  toRequester: boolean;
  booking: null | { ref: string; date: string; startTime: string; duration: number; amount: number; refund: number; failed: boolean; requester: string; companion: string; place: string };
};

const dateText = (d: string) => new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
const timeText = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
};
const durText = (min: number) => `${min / 60} ${min === 60 ? 'hour' : 'hours'}`;
const rupees = (n: number) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

// Template + body variables ({{1}}…) per notification (WHATSAPP_TEMPLATES.md).
// Each booking message goes to one side only: the member already knows they booked,
// and the companion already knows they accepted.
function whatsapp(it: Item): { env: string; values: string[] } | null {
  const b = it.booking;
  if (!b) return null;
  switch (it.type) {
    case 'booking_offer': // companion only: new paid request
      return it.toRequester ? null : { env: 'WAPLIFY_TPL_BOOKING_REQUEST', values: [it.name || 'there', brand(), b.requester || 'A member', dateText(b.date), timeText(b.startTime), durText(b.duration), b.ref] };
    case 'booking_confirmed':
      // Member: a companion accepted. Companion: only sent when they didn't tap Accept themselves
      // (their ID was just approved and the held booking went through, or support assigned it),
      // so they need telling that the booking is confirmed and chat is open.
      return it.toRequester
        ? { env: 'WAPLIFY_TPL_BOOKING_CONFIRMED', values: [it.name || 'there', brand(), b.companion || 'your companion', dateText(b.date), timeText(b.startTime), b.ref] }
        : { env: 'WAPLIFY_TPL_PAYMENT_RECEIVED', values: [it.name || 'there', rupees(b.amount), b.requester || 'your member', brand(), dateText(b.date), timeText(b.startTime), b.ref] };
    case 'session_reminder': { // both, at 5 AM on the day
      const other = it.toRequester ? b.companion || 'your companion' : b.requester || 'your member';
      return { env: 'WAPLIFY_TPL_SESSION_REMINDER', values: [it.name || 'there', brand(), other, dateText(b.date), timeText(b.startTime), b.place || 'the agreed public place', b.ref] };
    }
    case 'refund': // member only
      return b.failed && it.toRequester ? { env: 'WAPLIFY_TPL_BOOKING_UNFULFILLED', values: [it.name || 'there', brand(), dateText(b.date), timeText(b.startTime), rupees(b.refund || b.amount), b.ref] } : null;
    default:
      return null;
  }
}

/** Sends one WhatsApp template. Returns null on success, else the error text (so the row is retried).
 *  Waplify can answer HTTP 200 with status "error" (template not approved, wrong variable count…), so only
 *  status "success" counts, the same check as the login-code hook. */
async function sendWhatsApp(phone: string, template: string, values: string[]): Promise<string | null> {
  const key = Deno.env.get('WAPLIFY_API_KEY');
  if (!key) return 'WAPLIFY_API_KEY not set';
  try {
    const res = await fetch('https://server.waplify.io/api/v1/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_name: template, contact_phone: phone, contact_name: 'prsnn member', body_data: Object.fromEntries(values.map((v, i) => [String(i + 1), v])) }),
    });
    const out = await res.json().catch(() => ({} as Record<string, unknown>));
    if (res.ok && out.status === 'success') {
      console.log(`waplify sent ${template} to=…${phone.slice(-4)}`);
      return null;
    }
    const why = String(out.error ?? out.message ?? out.status ?? '').slice(0, 200);
    console.warn(`waplify failed ${template} ${res.status} ${why} to=…${phone.slice(-4)}`);
    return `waplify ${res.status} ${why}`.trim();
  } catch {
    console.warn('waplify unreachable');
    return 'waplify unreachable';
  }
}

const TITLES: Record<string, string> = {
  booking_offer: 'New paid booking', booking_confirmed: 'Booking confirmed', booking_cancelled: 'Booking cancelled',
  payment_completed: 'Payment received', refund: 'Refund', dispute: 'prsnn support',
  action_needed: 'Action needed', approval: 'prsnn', panic: '🚨 Panic alert', session_reminder: 'Your session is today',
};

// Delivery is confirmed back to the database (report_*): a row is only marked sent once the
// provider accepted it; anything else is retried (lease 2 min, at most 5 attempts).
Deno.serve(async () => {
  const { data, error } = await db.rpc('claim_notifications');
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  const items = (data ?? []) as Item[];
  // Each report carries the claim's token: a report for an expired claim is ignored by the database.
  const report = new Map<string, { id: string; claimToken?: string; push: boolean; wa: boolean; error?: string }>();
  for (const it of items) report.set(it.id, { id: it.id, claimToken: it.claimToken, push: it.pushDone || !it.pushToken, wa: it.waDone });

  const toPush = items.filter((i) => i.pushToken && !i.pushDone);
  const pushes = toPush.map((i) => ({
    to: i.pushToken!, title: TITLES[i.type] ?? 'prsnn', body: i.message, data: { type: i.type, notificationId: i.id },
    ...(i.type === 'panic' ? { priority: 'high' as const, channelId: 'panic' } : {}),
  }));
  const result = pushes.length ? await sendPush(pushes) : { sent: 0, failed: 0, batches: 0, invalid: [] as string[], ok: [] as boolean[] };
  toPush.forEach((it, k) => {
    const r = report.get(it.id)!;
    // A token Expo says is gone will never work: count it as done so the row can finish.
    if (result.ok[k] || result.invalid.includes(it.pushToken!)) r.push = true;
    else r.error = 'push failed';
  });
  if (result.invalid.length) await db.rpc('forget_push_tokens', { tokens: result.invalid });

  let wa = 0;
  for (const it of items) {
    const r = report.get(it.id)!;
    if (it.waDone) continue;
    const w = whatsapp(it);
    const template = w ? Deno.env.get(w.env) : null;
    if (!w || !template || !it.phone) {
      // Say why a message that should go on WhatsApp didn't, instead of skipping it silently.
      if (w && !template) console.warn(`whatsapp skipped ${it.type}: secret ${w.env} is not set`);
      else if (w && !it.phone) console.warn(`whatsapp skipped ${it.type}: no phone on the profile`);
      r.wa = true; // nothing to send on WhatsApp for this one
      continue;
    }
    const err = await sendWhatsApp(it.phone, template, w.values);
    if (err) r.error = err;
    else {
      r.wa = true;
      wa++;
    }
  }
  if (report.size) await db.rpc('report_notifications', { items: [...report.values()] });

  // WhatsApp rows not tied to a notification: panic alerts to every admin number (template WAPLIFY_TPL_PANIC_ALERT).
  const { data: outbox } = await db.rpc('claim_whatsapp');
  const done: { id: number; claimToken?: string; ok: boolean; error?: string }[] = [];
  for (const o of (outbox ?? []) as { id: number; claimToken?: string; phone: string; templateEnv: string; body: string[] }[]) {
    const template = Deno.env.get(o.templateEnv);
    if (!template) {
      done.push({ id: o.id, claimToken: o.claimToken, ok: false, error: `no template set for ${o.templateEnv}` });
      continue;
    }
    const err = await sendWhatsApp(o.phone, template, o.body);
    done.push({ id: o.id, claimToken: o.claimToken, ok: !err, ...(err ? { error: err } : {}) });
  }
  if (done.length) await db.rpc('report_whatsapp', { items: done });
  return new Response(JSON.stringify({ claimed: items.length, pushed: result.sent, whatsapp: wa, alerts: done.filter((d) => d.ok).length }), { headers: { 'Content-Type': 'application/json' } });
});
