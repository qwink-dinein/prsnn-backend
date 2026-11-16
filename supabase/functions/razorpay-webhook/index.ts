// Razorpay → prsnn server events (verify_jwt off; every request must carry Razorpay's signature).
// Set in Razorpay Dashboard → Webhooks: URL …/functions/v1/razorpay-webhook, the webhook secret, and events
// payment.captured, payment.failed, refund.processed, refund.failed.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { json, validWebhookSignature } from '../_shared/razorpay.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  const raw = await req.text();
  if (!(await validWebhookSignature(raw, req.headers.get('x-razorpay-signature')))) return json({ error: 'Bad signature.' }, 401);
  const ev = JSON.parse(raw) as { event: string; payload: Record<string, { entity: Record<string, unknown> }> };
  const pay = ev.payload?.payment?.entity as { id?: string; order_id?: string; amount?: number } | undefined;
  const refund = ev.payload?.refund?.entity as { id?: string; notes?: { bookingId?: string; kind?: string; paymentId?: string }; error_description?: string } | undefined;
  try {
    switch (ev.event) {
      case 'payment.captured':
        if (pay?.order_id && pay.id) await db.rpc('pay_confirm', { order_id: pay.order_id, payment_id: pay.id, amount_paise: pay.amount ?? 0 });
        break;
      case 'payment.failed':
        if (pay?.order_id) await db.rpc('pay_failed', { order_id: pay.order_id });
        break;
      case 'refund.processed':
        // A second payment's refund must not mark the booking itself refunded.
        if (refund?.notes?.kind === 'duplicate' && refund.notes.paymentId) await db.rpc('extra_refunds_report', { pid: refund.notes.paymentId, token: null, ok: true, provider_id: refund.id ?? null, err: null });
        else if (refund?.notes?.bookingId) await db.rpc('refunds_report', { bid: refund.notes.bookingId, token: null, ok: true, provider_id: refund.id ?? null, err: null });
        break;
      case 'refund.failed':
        if (refund?.id) await db.rpc('refunds_failed_by_provider', { provider_id: refund.id, err: refund.error_description ?? 'Refund failed at the bank' });
        break;
    }
  } catch (e) {
    console.warn('webhook', ev.event, (e as Error).message);
    return json({ error: 'retry' }, 500); // Razorpay retries non-2xx
  }
  return json({ ok: true });
});
