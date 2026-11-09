import crypto from 'crypto';

/** Indian mobile → "91XXXXXXXXXX" (no plus), or null. Accepts +91, 0 and spaces/dashes. */
export function normaliseIndianMobile(input) {
  if (typeof input !== 'string' && typeof input !== 'number') return null;
  const digits = String(input).replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
  return /^[6-9]\d{9}$/.test(digits) ? `91${digits}` : null;
}

/** 6-digit code from a CSPRNG (Math.random is predictable). */
export const generateCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

/** Codes are stored as an HMAC so a database leak does not reveal live codes. */
export const hashCode = (phone, code) =>
  crypto.createHmac('sha256', process.env.JWT_SECRET || 'dev').update(`${phone}:${code}`).digest('hex');

export function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/** PINs people guess first. The app refuses these too. */
export const WEAK_PINS = new Set(['0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1234', '4321', '0123', '9876']);
