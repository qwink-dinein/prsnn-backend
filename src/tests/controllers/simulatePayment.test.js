import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../models/Booking.js', () => ({ default: { findById: vi.fn(), findOneAndUpdate: vi.fn() } }));
vi.mock('../../models/User.js', () => ({ default: { findById: vi.fn().mockResolvedValue({ fullName: 'Ayesha', phone: '919876543210' }) } }));
vi.mock('../../models/Notification.js', () => ({ default: { create: vi.fn() } }));
vi.mock('../../utils/whatsappNotify.js', () => ({ notifyWhatsAppLater: vi.fn() }));

import Booking from '../../models/Booking.js';
import Notification from '../../models/Notification.js';
import { notifyWhatsAppLater } from '../../utils/whatsappNotify.js';
import { simulatePayment, createPaymentIntent } from '../../controllers/payment.controller.js';

const mkRes = () => ({ status: vi.fn().mockReturnThis(), json: vi.fn() });
const mkBooking = (over = {}) => ({
  _id: { toString: () => 'b0000000000001' },
  requesterId: { toString: () => 'u1' },
  companionId: 'c1',
  status: 'accepted',
  paymentStatus: 'pending',
  pricePerHour: 600,
  duration: '90',
  save: vi.fn(),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.PAYMENT_MODE = 'simulated';
});
afterEach(() => {
  delete process.env.PAYMENT_MODE;
});

describe('simulated payments', () => {
  it('create-intent returns a simulated order without calling Razorpay', async () => {
    Booking.findById.mockResolvedValue(mkBooking());
    const res = mkRes();
    await createPaymentIntent({ body: { bookingId: 'b1' }, user: { id: 'u1' } }, res);
    expect(res.json).toHaveBeenCalledWith({ mode: 'simulated', orderId: 'sim_b0000000000001', amount: 90000, currency: 'INR' });
  });

  it('marks the booking paid, notifies the companion in app and on WhatsApp', async () => {
    const b = mkBooking();
    Booking.findById.mockResolvedValue(b);
    Booking.findOneAndUpdate.mockImplementation(async (_f, u) => ({ ...b, ...u.$set }));
    const res = mkRes();
    await simulatePayment({ body: { bookingId: 'b1' }, user: { id: 'u1' } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(Booking.findOneAndUpdate.mock.calls[0][1].$set).toMatchObject({ paymentStatus: 'paid', paymentMode: 'simulated', amountPaid: 900 });
    expect(Notification.create).toHaveBeenCalledWith(expect.objectContaining({ userId: 'c1', type: 'payment_completed' }));
    expect(notifyWhatsAppLater).toHaveBeenCalledWith('payment_received', expect.anything(), expect.objectContaining({ amount: 900 }));
  });

  it('is refused when PAYMENT_MODE is not simulated', async () => {
    delete process.env.PAYMENT_MODE;
    const res = mkRes();
    await simulatePayment({ body: { bookingId: 'b1' }, user: { id: 'u1' } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(Booking.findById).not.toHaveBeenCalled();
  });

  it('keeps the real rules: only the requester, only once accepted', async () => {
    Booking.findById.mockResolvedValue(mkBooking());
    let res = mkRes();
    await simulatePayment({ body: { bookingId: 'b1' }, user: { id: 'someone-else' } }, res);
    expect(res.status).toHaveBeenCalledWith(403);

    Booking.findById.mockResolvedValue(mkBooking({ status: 'pending' }));
    res = mkRes();
    await simulatePayment({ body: { bookingId: 'b1' }, user: { id: 'u1' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('a simulated failure changes nothing', async () => {
    const b = mkBooking();
    Booking.findById.mockResolvedValue(b);
    const res = mkRes();
    await simulatePayment({ body: { bookingId: 'b1', outcome: 'failure' }, user: { id: 'u1' } }, res);
    expect(res.status).toHaveBeenCalledWith(402);
    expect(b.paymentStatus).toBe('pending');
    expect(b.save).not.toHaveBeenCalled();
  });
});
