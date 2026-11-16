// Razorpay REST helpers. Keys come only from edge-function secrets:
// RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET. Never from the app.
const API = 'https://api.razorpay.com/v1';

export const keyId = () => Deno.env.get('RAZORPAY_KEY_ID') ?? '';
const keySecret = () => Deno.env.get('RAZORPAY_KEY_SECRET') ?? '';
export const configured = () => !!keyId() && !!keySecret();

export async function rzp<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Basic ${btoa(`${keyId()}:${keySecret()}`)}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error?: { description?: string } })?.error?.description ?? `Razorpay ${res.status}`;
    throw new Error(msg);
  }
  return data as T;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string compare. */
function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/** Checkout signature: HMAC-SHA256(order_id + "|" + payment_id, key secret). */
export async function validCheckoutSignature(orderId: string, paymentId: string, signature: string): Promise<boolean> {
  if (!orderId || !paymentId || !signature || !keySecret()) return false;
  return same(await hmacHex(keySecret(), `${orderId}|${paymentId}`), signature);
}

/** Webhook signature: HMAC-SHA256(raw body, webhook secret). */
export async function validWebhookSignature(rawBody: string, signature: string | null): Promise<boolean> {
  const secret = Deno.env.get('RAZORPAY_WEBHOOK_SECRET') ?? '';
  if (!secret || !signature) return false;
  return same(await hmacHex(secret, rawBody), signature);
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' } });
