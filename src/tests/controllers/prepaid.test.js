import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'crypto';

vi.mock('../../models/Booking.js', () => {
  const Booking = { findOne: vi.fn(), findById: vi.fn(), create: vi.fn(), findOneAndUpdate: vi.fn(), updateOne: vi.fn() };
  return { default: Booking };
});
vi.mock('../../models/User.js', () => ({ default: { findById: vi.fn() } }));
vi.mock('../../models/Notification.js', () => ({ default: { create: vi.fn().mockResolvedValue({}) } }));
vi.mock('../../utils/whatsappNotify.js', () => ({ notifyWhatsAppLater: vi.fn() }));
vi.mock('../../services/allocation.js', async (orig) => {
  const real = await orig();
  return { ...real, onPrepaidPaid: vi.fn(async () => null), acceptOffer: vi.fn(), declineOffer: vi.fn() };
});

import Booking from '../../models/Booking.js';
import User from '../../models/User.js';
import { onPrepaidPaid } from '../../services/allocation.js';
import { createPrepaidBooking, cancelPrepaid } from '../../controllers/prepaid.controller.js';
import { markPaid, razorpayWebhook, simulatePayment } from '../../controllers/payment.controller.js';
import { issueRefund } from '../../utils/refunds.js';

const mkRes = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn() });
const lean = (v) => ({ select: () => lean(v), lean: async () => v });
const allDays = { monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: true, sunday: true };
const future = new Date(Date.now() + 3 * 86400e3).toISOString().slice(0, 10);

beforeEach(() => vi.clearAllMocks());

describe('POST /bookings/prepaid', () => {
  const body = { companionId: 'c1', scheduledDate: future, startTime: '16:00', duration: '120', idempotencyKey: 'key-12345678', acceptTerms: true };

  it('creates an awaiting-payment booking with the price and the terms', async () => {
    Booking.findOne.mockResolvedValue(null);
    User.findById.mockReturnValueOnce(lean({ seeGender: 'woman' })).mockReturnValueOnce(lean({ role: 'companion', verificationStatus: 'verified', gender: 'woman', pricePerHour: 600, availability: allDays, city: 'Hyderabad' }));
    Booking.create.mockImplementation(async (d) => ({ _id: 'b1', ...d }));
    const res = mkRes();
    await createPrepaidBooking({ user: { id: 'u1' }, body }, res);
    expect(res.status).toHaveBeenCalledWith(201);
    const out = res.json.mock.calls[0][0];
    expect(out.booking).toMatchObject({ flow: 'prepaid', preferredCompanionId: 'c1', allocation: { state: 'awaiting_payment' }, paymentStatus: 'pending' });
    expect(out.quote).toEqual({ currency: 'INR', amount: 1200, fees: 0, pricePerHour: 600, duration: '120' });
    expect(out.policy.cancellation[0]).toMatch(/before the session starts: full refund/);
  });

  it('a retry with the same idempotency key returns the same booking (no second booking, no second charge)', async () => {
    Booking.findOne.mockResolvedValue({ _id: 'b1', pricePerHour: 600, duration: '120' });
    const res = mkRes();
    await createPrepaidBooking({ user: { id: 'u1' }, body }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].replayed).toBe(true);
    expect(Booking.create).not.toHaveBeenCalled();
  });

  it('requires accepting the terms, and refuses companions outside the gender preference', async () => {
    Booking.findOne.mockResolvedValue(null);
    let res = mkRes();
    await createPrepaidBooking({ user: { id: 'u1' }, body: { ...body, acceptTerms: false } }, res);
    expect(res.status).toHaveBeenCalledWith(400);

    User.findById.mockReturnValueOnce(lean({ seeGender: 'woman' })).mockReturnValueOnce(lean({ role: 'companion', verificationStatus: 'verified', gender: 'man', pricePerHour: 500, availability: allDays }));
    res = mkRes();
    await createPrepaidBooking({ user: { id: 'u1' }, body }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe('payment → allocation', () => {
  it('markPaid is atomic: only the first caller starts allocation', async () => {
    Booking.findOneAndUpdate.mockResolvedValueOnce({ _id: 'b1', flow: 'prepaid' }).mockResolvedValueOnce(null);
    Booking.findById.mockResolvedValue({ _id: 'b1', paymentStatus: 'paid' });
    const first = await markPaid('b1', { paymentId: 'p1', amountRupees: 600, mode: 'razorpay' });
    const second = await markPaid('b1', { paymentId: 'p1', amountRupees: 600, mode: 'razorpay' });
    expect(Booking.findOneAndUpdate.mock.calls[0][0]).toEqual({ _id: 'b1', paymentStatus: { $ne: 'paid' } });
    expect(first.alreadyPaid).toBe(false);
    expect(second.alreadyPaid).toBe(true);
    expect(onPrepaidPaid).toHaveBeenCalledTimes(1);
  });

  it('simulated payment of a prepaid booking is allowed only while awaiting payment', async () => {
    process.env.PAYMENT_MODE = 'simulated';
    Booking.findById.mockResolvedValueOnce({ _id: 'b1', requesterId: { toString: () => 'u1' }, flow: 'prepaid', status: 'pending', paymentStatus: 'pending', allocation: { state: 'cancelled' } });
    const res = mkRes();
    await simulatePayment({ user: { id: 'u1' }, body: { bookingId: 'b1' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    delete process.env.PAYMENT_MODE;
  });
});

describe('Razorpay webhook', () => {
  const secret = 'whsec_test';
  beforeEach(() => (process.env.RAZORPAY_WEBHOOK_SECRET = secret));
  afterEach(() => delete process.env.RAZORPAY_WEBHOOK_SECRET);
  const sign = (raw) => crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const event = Buffer.from(JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: 'order_1', amount: 120000 } } } }));

  it('rejects a bad signature', async () => {
    const res = mkRes();
    await razorpayWebhook({ body: event, headers: { 'x-razorpay-signature': 'nope' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('marks the booking paid from a signed payment.captured', async () => {
    Booking.findOne.mockResolvedValueOnce({ _id: 'b1', paymentStatus: 'pending', pricePerHour: 600, duration: '120' });
    Booking.findOneAndUpdate.mockResolvedValueOnce({ _id: 'b1', flow: 'prepaid' });
    const res = mkRes();
    await razorpayWebhook({ body: event, headers: { 'x-razorpay-signature': sign(event) } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(Booking.findOneAndUpdate.mock.calls[0][1].$set).toMatchObject({ paymentStatus: 'paid', razorpayPaymentId: 'pay_1', amountPaid: 1200 });
  });
});

describe('cancellation follows the published policy', () => {
  const soon = (hours) => {
    const d = new Date(Date.now() + hours * 3600e3);
    const ist = new Date(d.getTime() + 330 * 60e3);
    return { scheduledDate: new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate())), startTime: `${String(ist.getUTCHours()).padStart(2, '0')}:${String(ist.getUTCMinutes()).padStart(2, '0')}` };
  };
  const paid = (over) => ({ _id: 'b1', flow: 'prepaid', requesterId: 'u1', companionId: 'c1', status: 'accepted', paymentStatus: 'paid', paymentMode: 'simulated', amountPaid: 600, duration: '60', allocation: { state: 'assigned' }, ...soon(5), ...over });

  it('customer before start → cancelled with a full refund', async () => {
    Booking.findOneAndUpdate.mockResolvedValueOnce(paid()).mockResolvedValueOnce(paid({ refund: { status: 'pending' } }));
    Booking.updateOne.mockResolvedValue({});
    Booking.findById.mockResolvedValue(paid({ status: 'cancelled' }));
    const r = await cancelPrepaid(paid(), 'u1');
    expect(r.code).toBe(200);
    expect(Booking.findOneAndUpdate.mock.calls[0][1].$set).toMatchObject({ status: 'cancelled', cancelledBy: 'requester' });
    expect(Booking.findOneAndUpdate.mock.calls[1][1].$set['refund.amount']).toBe(600); // refund claimed for the full amount
  });

  it('customer after the start → cancelled, no automatic refund', async () => {
    const started = paid(soon(-0.5));
    Booking.findOneAndUpdate.mockResolvedValueOnce(started);
    Booking.findById.mockResolvedValue({ ...started, status: 'cancelled' });
    const r = await cancelPrepaid(started, 'u1');
    expect(r.code).toBe(200);
    expect(r.refund).toBe('none');
    expect(r.message).toMatch(/no automatic refund/);
  });

  it('a stranger cannot cancel, and closed bookings stay closed', async () => {
    expect((await cancelPrepaid(paid(), 'someone')).code).toBe(403);
    expect((await cancelPrepaid(paid({ status: 'cancelled' }), 'u1')).code).toBe(400);
  });
});

describe('refunds happen once', () => {
  it('second refund attempt is skipped by the atomic claim', async () => {
    Booking.findOneAndUpdate.mockResolvedValueOnce(null);
    expect(await issueRefund('b1', 600, 'x')).toBe('skipped');
  });
});
