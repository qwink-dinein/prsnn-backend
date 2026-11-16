// Payments for the app (signed-in members only; verify_jwt on).
//   { action: 'order', bookingId }                       → creates a Razorpay order for the booking's price
//   { action: 'verify', bookingId, orderId, paymentId, signature } → checks the signature and the captured
//                                                            payment with Razorpay, then marks the booking paid
// The amount always comes from the database. Razorpay's webhook confirms the same payment independently,
// so a closed app or a dropped connection never loses a payment.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { configured, json, keyId, rzp, validCheckoutSignature } from '../_shared/razorpay.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });

type Order = { id: string; amount: number; currency: string };
type Payment = { id: string; order_id: string; status: string; amount: number; currency: string };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({});
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  if (!configured()) return json({ error: 'Online payments aren’t set up yet. Please try again later.' }, 503);

  // Who is calling: the member's own session token.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: auth } = await db.auth.getUser(token);
  const uid = auth?.user?.id;
  if (!uid) return json({ error: 'Please sign in again.' }, 401);

  const body = await req.json().catch(() => ({}));
  const bookingId = String(body.bookingId ?? '');
  try {
    if (body.action === 'order') {
      const { data: p, error } = await db.rpc('pay_prepare', { bid: bookingId, uid });
      if (error) return json({ error: error.message }, 400);
      // One order per booking: opening checkout again reuses it, so an earlier attempt that completes
      // late still matches the booking (every order is also remembered in private.payment_orders).
      if (p.orderId) return json({ mode: 'razorpay', keyId: keyId(), orderId: p.orderId, amount: p.amountPaise, currency: 'INR' });
      const order = await rzp<Order>('POST', '/orders', {
        amount: p.amountPaise,
        currency: 'INR',
        receipt: `prsnn_${p.ref}_${Date.now().toString(36)}`.slice(0, 40),
        notes: { bookingId, ref: p.ref },
      });
      await db.rpc('pay_set_order', { bid: bookingId, order_id: order.id, amount_paise: order.amount });
      return json({ mode: 'razorpay', keyId: keyId(), orderId: order.id, amount: order.amount, currency: order.currency });
    }

    if (body.action === 'verify') {
      const orderId = String(body.orderId ?? '');
      const paymentId = String(body.paymentId ?? '');
      if (!(await validCheckoutSignature(orderId, paymentId, String(body.signature ?? '')))) {
        return json({ error: 'We couldn’t verify this payment.' }, 400);
      }
      // Ask Razorpay itself what happened (never trust the app for status or amount).
      let pay = await rzp<Payment>('GET', `/payments/${encodeURIComponent(paymentId)}`);
      if (pay.order_id !== orderId) return json({ error: 'This payment doesn’t match the booking.' }, 400);
      if (pay.status === 'authorized') pay = await rzp<Payment>('POST', `/payments/${encodeURIComponent(paymentId)}/capture`, { amount: pay.amount, currency: pay.currency });
      if (pay.status !== 'captured') return json({ error: 'The payment didn’t go through. No money was taken.' }, 400);
      const { data: r, error } = await db.rpc('pay_confirm', { order_id: orderId, payment_id: paymentId, amount_paise: pay.amount });
      if (error || !r?.ok) return json({ error: 'Your payment was received but needs a quick check by our team. You’ll be confirmed or refunded in full.' }, 409);
      return json({ ok: true, bookingId: r.bookingId });
    }
    return json({ error: 'Unknown action.' }, 400);
  } catch (e) {
    console.warn('payments', body.action, (e as Error).message);
    return json({ error: 'Payments are busy right now. Please try again in a minute.' }, 502);
  }
});
