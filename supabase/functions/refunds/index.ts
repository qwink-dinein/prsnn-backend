// Sends queued refunds to Razorpay. Triggered by pg_cron every 2 minutes, only while refunds are pending:
// booking refunds (cancellations, nobody accepted) and, separately, second payments for a booking that
// was already paid (refunded in full; marked kind 'duplicate' so the webhook can tell them apart).
// Safe to call by anyone: it only sends refunds the database has already queued, each claimed once.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { configured, json, rzp } from '../_shared/razorpay.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
type Claim = { bookingId: string; ref: string; paymentId: string; amountPaise: number; token: string; attempt: number };

Deno.serve(async () => {
  if (!configured()) return json({ skipped: 'not configured' });
  const { data, error } = await db.rpc('refunds_claim', { lim: 20 });
  if (error) return json({ error: error.message }, 500);
  let sent = 0;
  for (const c of (data ?? []) as Claim[]) {
    try {
      const r = await rzp<{ id: string }>('POST', `/payments/${encodeURIComponent(c.paymentId)}/refund`, {
        amount: c.amountPaise,
        speed: 'normal',
        receipt: `prsnn_rf_${c.ref}_${c.attempt}`.slice(0, 40),
        notes: { bookingId: c.bookingId, ref: c.ref },
      });
      await db.rpc('refunds_report', { bid: c.bookingId, token: c.token, ok: true, provider_id: r.id, err: null });
      sent++;
    } catch (e) {
      await db.rpc('refunds_report', { bid: c.bookingId, token: c.token, ok: false, provider_id: null, err: (e as Error).message });
    }
  }
  // Second payments for an already-paid booking: refunded in full.
  type Extra = { paymentId: string; bookingId: string; ref: string; amountPaise: number; token: string; attempt: number };
  const { data: extras } = await db.rpc('extra_refunds_claim', { lim: 20 });
  let extraSent = 0;
  for (const x of (extras ?? []) as Extra[]) {
    try {
      const r = await rzp<{ id: string }>('POST', `/payments/${encodeURIComponent(x.paymentId)}/refund`, {
        amount: x.amountPaise,
        speed: 'normal',
        receipt: `prsnn_dup_${x.ref}_${x.attempt}`.slice(0, 40),
        notes: { kind: 'duplicate', bookingId: x.bookingId, ref: x.ref, paymentId: x.paymentId },
      });
      await db.rpc('extra_refunds_report', { pid: x.paymentId, token: x.token, ok: true, provider_id: r.id, err: null });
      extraSent++;
    } catch (e) {
      await db.rpc('extra_refunds_report', { pid: x.paymentId, token: x.token, ok: false, provider_id: null, err: (e as Error).message });
    }
  }
  return json({ claimed: (data ?? []).length, sent, duplicates: (extras ?? []).length, duplicatesSent: extraSent });
});
