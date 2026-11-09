import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/User.js', () => {
  const User = vi.fn(function (data) {
    Object.assign(this, { _id: 'new-id' }, data);
    this.save = vi.fn().mockResolvedValue(this);
  });
  User.findOne = vi.fn();
  User.findById = vi.fn();
  return { default: User, PRIVATE_USER_FIELDS: '' };
});
vi.mock('../../utils/otpDelivery.js', () => ({ deliverOtp: vi.fn() }));

import User from '../../models/User.js';
import { deliverOtp } from '../../utils/otpDelivery.js';
import { hashCode } from '../../utils/phone.js';
import { hashPassword } from '../../utils/hash.js';
import { sendPhoneOtp, verifyPhoneOtp, setPin, pinLogin, PendingOtp, MAX_PIN_ATTEMPTS } from '../../controllers/phoneAuth.controller.js';
import { normaliseIndianMobile } from '../../utils/phone.js';

const PHONE = '919876543210';
const mkRes = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn() });
const existing = (over = {}) => ({ _id: 'u1', phone: PHONE, role: 'user', verificationStatus: 'verified', save: vi.fn().mockResolvedValue(undefined), ...over });

beforeEach(() => {
  vi.clearAllMocks();
  PendingOtp._reset();
});

describe('normaliseIndianMobile', () => {
  it('accepts common formats and rejects bad ones', () => {
    expect(normaliseIndianMobile('+91 98765 43210')).toBe(PHONE);
    expect(normaliseIndianMobile('09876543210')).toBe(PHONE);
    expect(normaliseIndianMobile('12345')).toBeNull();
    expect(normaliseIndianMobile('5876543210')).toBeNull();
  });
});

describe('POST /auth/phone/send-otp', () => {
  it('rejects an invalid number', async () => {
    const res = mkRes();
    await sendPhoneOtp({ body: { phone: '123' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(deliverOtp).not.toHaveBeenCalled();
  });

  it('sends a code and keeps only its hash for a new number (no DB row yet)', async () => {
    User.findOne.mockResolvedValue(null);
    deliverOtp.mockResolvedValue({ ok: true, channel: 'whatsapp', status: 200 });
    const res = mkRes();
    await sendPhoneOtp({ body: { phone: '98765 43210' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const [, code] = deliverOtp.mock.calls[0];
    expect(code).toMatch(/^\d{6}$/);
    const pending = await PendingOtp.get(PHONE);
    expect(pending.phoneOtpHash).toBe(hashCode(PHONE, code));
    expect(JSON.stringify(res.json.mock.calls)).not.toContain(code);
  });

  it('enforces the resend cooldown', async () => {
    User.findOne.mockResolvedValue(existing({ phoneOtpSentAt: new Date() }));
    const res = mkRes();
    await sendPhoneOtp({ body: { phone: PHONE } }, res);
    expect(res.status).toHaveBeenCalledWith(429);
    expect(deliverOtp).not.toHaveBeenCalled();
  });

  it('reports delivery failure without storing a code', async () => {
    User.findOne.mockResolvedValue(null);
    deliverOtp.mockResolvedValue({ ok: false, status: 503 });
    const res = mkRes();
    await sendPhoneOtp({ body: { phone: PHONE } }, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(await PendingOtp.get(PHONE)).toBeNull();
  });
});

describe('POST /auth/phone/verify-otp', () => {
  const pend = (code = '123456', over = {}) =>
    PendingOtp.set(PHONE, { phoneOtpHash: hashCode(PHONE, code), phoneOtpExpires: new Date(Date.now() + 60_000), phoneOtpAttempts: 0, phoneOtpSentAt: new Date(), ...over });

  it('creates a member account on first verify', async () => {
    User.findOne.mockResolvedValue(null);
    await pend();
    const res = mkRes();
    await verifyPhoneOtp({ body: { phone: PHONE, otp: '123456' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.isNewUser).toBe(true);
    expect(body.token).toEqual(expect.any(String));
    expect(body.user).toMatchObject({ phone: PHONE, role: 'user', verification_status: 'verified', hasPin: false });
  });

  it('new companions are NOT verified until ID review', async () => {
    User.findOne.mockResolvedValue(null);
    await pend();
    const res = mkRes();
    await verifyPhoneOtp({ body: { phone: PHONE, otp: '123456', role: 'companion' } }, res);
    expect(res.json.mock.calls[0][0].user).toMatchObject({ role: 'companion', verification_status: 'not_submitted', is_verified: false });
  });

  it('ignores attempts to self-assign staff roles', async () => {
    User.findOne.mockResolvedValue(null);
    await pend();
    const res = mkRes();
    await verifyPhoneOtp({ body: { phone: PHONE, otp: '123456', role: 'superadmin' } }, res);
    expect(res.json.mock.calls[0][0].user.role).toBe('user');
  });

  it('rejects a wrong code and counts the attempt', async () => {
    const u = existing({ phoneOtpHash: hashCode(PHONE, '111111'), phoneOtpExpires: new Date(Date.now() + 60_000), phoneOtpAttempts: 0 });
    User.findOne.mockResolvedValue(u);
    const res = mkRes();
    await verifyPhoneOtp({ body: { phone: PHONE, otp: '222222' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(u.phoneOtpAttempts).toBe(1);
  });

  it('rejects expired codes and too many attempts', async () => {
    User.findOne.mockResolvedValue(existing({ phoneOtpHash: hashCode(PHONE, '111111'), phoneOtpExpires: new Date(Date.now() - 1) }));
    let res = mkRes();
    await verifyPhoneOtp({ body: { phone: PHONE, otp: '111111' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);

    User.findOne.mockResolvedValue(existing({ phoneOtpHash: hashCode(PHONE, '111111'), phoneOtpExpires: new Date(Date.now() + 60_000), phoneOtpAttempts: 5 }));
    res = mkRes();
    await verifyPhoneOtp({ body: { phone: PHONE, otp: '111111' } }, res);
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('signs in an existing account and clears the code', async () => {
    const u = existing({ phoneOtpHash: hashCode(PHONE, '654321'), phoneOtpExpires: new Date(Date.now() + 60_000), fullName: 'Asha' });
    User.findOne.mockResolvedValue(u);
    const res = mkRes();
    await verifyPhoneOtp({ body: { phone: PHONE, otp: '654321' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].isNewUser).toBe(false);
    expect(u.phoneOtpHash).toBeUndefined();
  });
});

describe('PIN', () => {
  it('refuses weak or malformed PINs', async () => {
    for (const pin of ['1234', '0000', '12', 'abcd']) {
      const res = mkRes();
      await setPin({ user: { id: 'u1' }, body: { pin } }, res);
      expect(res.status).toHaveBeenCalledWith(400);
    }
  });

  it('stores a bcrypt hash, never the PIN', async () => {
    const u = existing();
    User.findById.mockResolvedValue(u);
    const res = mkRes();
    await setPin({ user: { id: 'u1' }, body: { pin: '4826' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(u.pinHash).toMatch(/^\$2[aby]\$/);
    expect(u.pinHash).not.toContain('4826');
  });

  it('logs in with the right PIN', async () => {
    User.findOne.mockResolvedValue(existing({ pinHash: await hashPassword('4826') }));
    const res = mkRes();
    await pinLogin({ body: { phone: PHONE, pin: '4826' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].user.hasPin).toBe(true);
  });

  it('locks after repeated wrong PINs', async () => {
    const u = existing({ pinHash: await hashPassword('4826'), pinFailedAttempts: MAX_PIN_ATTEMPTS - 1 });
    User.findOne.mockResolvedValue(u);
    let res = mkRes();
    await pinLogin({ body: { phone: PHONE, pin: '9999' } }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(u.pinLockedUntil.getTime()).toBeGreaterThan(Date.now());

    res = mkRes();
    await pinLogin({ body: { phone: PHONE, pin: '4826' } }, res);
    expect(res.status).toHaveBeenCalledWith(429);
  });

  it('gives the same answer for unknown numbers and numbers without a PIN', async () => {
    User.findOne.mockResolvedValue(null);
    const a = mkRes();
    await pinLogin({ body: { phone: PHONE, pin: '4826' } }, a);
    User.findOne.mockResolvedValue(existing());
    const b = mkRes();
    await pinLogin({ body: { phone: PHONE, pin: '4826' } }, b);
    expect(a.status.mock.calls[0][0]).toBe(401);
    expect(a.json.mock.calls[0][0]).toEqual(b.json.mock.calls[0][0]);
  });
});
