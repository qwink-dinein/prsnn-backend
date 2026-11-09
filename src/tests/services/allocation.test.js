import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../models/Booking.js', () => ({ default: { findById: vi.fn(), findOneAndUpdate: vi.fn(), updateOne: vi.fn(), updateMany: vi.fn(), find: vi.fn() } }));
vi.mock('../../models/User.js', () => ({ default: { findById: vi.fn(), find: vi.fn() } }));
vi.mock('../../models/Notification.js', () => ({ default: { create: vi.fn().mockResolvedValue({}) } }));
vi.mock('../../utils/whatsappNotify.js', () => ({ notifyWhatsAppLater: vi.fn() }));
vi.mock('../../utils/refunds.js', () => ({ issueRefund: vi.fn().mockResolvedValue('processed'), MAX_REFUND_ATTEMPTS: 5 }));

import Booking from '../../models/Booking.js';
import User from '../../models/User.js';
import { issueRefund } from '../../utils/refunds.js';
import { notifyWhatsAppLater } from '../../utils/whatsappNotify.js';
import {
  acceptOffer,
  declineOffer,
  failAllocation,
  findCandidates,
  isAvailableFor,
  offerNext,
  onPrepaidPaid,
  sessionStart,
  OFFER_TTL_MS,
} from '../../services/allocation.js';

const lean = (v) => ({ select: () => lean(v), limit: () => lean(v), lean: async () => v });
const allDays = { monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: true, sunday: true };
const NOW = new Date('2026-11-10T04:30:00.000Z'); // 10:00 IST
const base = (over = {}) => ({
  _id: 'b1',
  flow: 'prepaid',
  requesterId: 'u1',
  preferredCompanionId: 'c1',
  pricePerHour: 600,
  duration: '60',
  startTime: '18:00',
  scheduledDate: new Date('2026-11-10T00:00:00.000Z'),
  city: 'Hyderabad',
  paymentStatus: 'paid',
  amountPaid: 600,
  offers: [],
  allocation: { state: 'offering', deadline: new Date(NOW.getTime() + 2 * 3600e3) },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  Booking.find.mockReturnValue(lean([])); // no conflicts
});

describe('time and availability', () => {
  it('reads booking times as IST', () => {
    expect(sessionStart(base()).toISOString()).toBe('2026-11-10T12:30:00.000Z'); // 18:00 IST
  });
  it('checks weekday and hours', () => {
    const b = base(); // Tuesday
    expect(isAvailableFor({ availability: { tuesday: true }, startTime: '09:00', endTime: '21:00' }, b)).toBe(true);
    expect(isAvailableFor({ availability: { monday: true } }, b)).toBe(false);
    expect(isAvailableFor({ availability: { tuesday: true }, startTime: '09:00', endTime: '17:00' }, b)).toBe(false);
  });
});

describe('onPrepaidPaid', () => {
  it('moves awaiting_payment → offering (conditionally) and offers the chosen companion first', async () => {
    Booking.findById
      .mockResolvedValueOnce(base({ allocation: { state: 'awaiting_payment' } }))
      .mockResolvedValueOnce(base()); // inside offerNext
    Booking.findOneAndUpdate
      .mockResolvedValueOnce(base()) // state change
      .mockResolvedValueOnce(base({ offers: [{ companionId: 'c1', status: 'offered' }] })); // offer push
    User.findById.mockReturnValueOnce(lean({ seeGender: 'woman', city: 'Hyderabad' })).mockReturnValueOnce(lean({ _id: 'c1', role: 'companion', verificationStatus: 'verified', availability: allDays }));

    await onPrepaidPaid('b1', NOW);

    const [filter, update] = Booking.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ _id: 'b1', 'allocation.state': 'awaiting_payment' });
    expect(update.$set['allocation.state']).toBe('offering');
    // Deadline = min(now + 2h, start − 1h) = 12:00 IST
    expect(update.$set['allocation.deadline'].toISOString()).toBe('2026-11-10T06:30:00.000Z');

    const [pushFilter, push] = Booking.findOneAndUpdate.mock.calls[1];
    expect(pushFilter.offers).toEqual({ $not: { $elemMatch: { status: 'offered', expiresAt: { $gt: NOW } } } }); // one live offer at a time
    expect(push.$push.offers.companionId).toBe('c1');
    expect(push.$push.offers.expiresAt.getTime()).toBe(NOW.getTime() + OFFER_TTL_MS);
    expect(notifyWhatsAppLater).toHaveBeenCalledWith('booking_request', expect.objectContaining({ _id: 'c1' }), expect.anything());
  });

  it('refunds a payment that arrives after the booking lapsed', async () => {
    Booking.findById.mockResolvedValueOnce(base({ allocation: { state: 'awaiting_payment' } })).mockResolvedValueOnce(base({ allocation: { state: 'cancelled' } }));
    Booking.findOneAndUpdate.mockResolvedValueOnce(null);
    await onPrepaidPaid('b1', NOW);
    expect(issueRefund).toHaveBeenCalledWith('b1', 600, expect.stringMatching(/lapsed/));
  });
});

describe('acceptOffer — only one companion can win', () => {
  it('accepts only a live, unexpired offer while still offering, in one conditional update', async () => {
    Booking.findById.mockReturnValue(lean(base()));
    Booking.findOneAndUpdate.mockResolvedValueOnce(base({ companionId: 'c2', status: 'accepted' }));
    User.findById.mockReturnValue(lean({ fullName: 'Ayesha Khan' }));

    const r = await acceptOffer('b1', 'c2', NOW);
    expect(r.ok).toBe(true);
    const [filter, update, opts] = Booking.findOneAndUpdate.mock.calls[0];
    expect(filter).toMatchObject({ _id: 'b1', paymentStatus: 'paid', 'allocation.state': 'offering', offers: { $elemMatch: { companionId: 'c2', status: 'offered', expiresAt: { $gt: NOW } } } });
    expect(update.$set).toMatchObject({ companionId: 'c2', status: 'accepted', 'allocation.state': 'assigned' });
    expect(opts.arrayFilters).toEqual([{ 'mine.companionId': 'c2', 'mine.status': 'offered' }]);
    expect(notifyWhatsAppLater).toHaveBeenCalledWith('booking_confirmed', expect.anything(), expect.anything());
  });

  it('a second (or expired) acceptance gets nothing', async () => {
    Booking.findById.mockReturnValue(lean(base()));
    Booking.findOneAndUpdate.mockResolvedValueOnce(null);
    expect(await acceptOffer('b1', 'c3', NOW)).toEqual({ ok: false, reason: 'expired_or_taken' });
  });

  it('refuses when the companion already has a clashing booking', async () => {
    Booking.findById.mockReturnValue(lean(base()));
    Booking.find.mockReturnValue(lean([{ scheduledDate: base().scheduledDate, startTime: '18:30', duration: '60' }]));
    expect(await acceptOffer('b1', 'c2', NOW)).toEqual({ ok: false, reason: 'clash' });
    expect(Booking.findOneAndUpdate).not.toHaveBeenCalled();
  });
});

describe('declines, backups and failure', () => {
  it('a decline offers the next eligible companion straight away', async () => {
    Booking.updateOne.mockResolvedValueOnce({ modifiedCount: 1 });
    Booking.findById.mockResolvedValueOnce(base({ offers: [{ companionId: 'c1', status: 'declined' }] }));
    User.findById.mockReturnValueOnce(lean({ seeGender: 'everyone', city: 'Hyderabad' }));
    User.find.mockReturnValueOnce(lean([{ _id: 'c2', gender: 'woman', availability: allDays, pricePerHour: 500 }]));
    Booking.findOneAndUpdate.mockResolvedValueOnce(base());
    expect(await declineOffer('b1', 'c1', NOW)).toEqual({ ok: true });
    expect(Booking.findOneAndUpdate.mock.calls[0][1].$push.offers.companionId).toBe('c2');
  });

  it('backups: same city, cheaper or equal rate, matching gender preference, never the chosen companion again', async () => {
    User.find.mockReturnValueOnce(
      lean([
        { _id: 'c1', gender: 'woman', availability: allDays },
        { _id: 'c2', gender: 'man', availability: allDays },
        { _id: 'c3', gender: 'woman', availability: { monday: true } },
        { _id: 'c4', gender: 'woman', availability: allDays, area: 'Banjara Hills' },
        { _id: 'c5', gender: 'woman', availability: allDays },
      ])
    );
    const out = await findCandidates(base({ area: 'Banjara Hills' }), { seeGender: 'woman' }, ['c1'], 2);
    expect(out.map((c) => c._id)).toEqual(['c4', 'c5']); // same area ranks first
    expect(User.find.mock.calls[0][0]).toMatchObject({ role: 'companion', verificationStatus: 'verified', pricePerHour: { $lte: 600 } });
  });

  it('after 3 offers, the booking fails and is fully refunded', async () => {
    Booking.findById.mockResolvedValueOnce(base({ offers: [1, 2, 3].map((i) => ({ companionId: `c${i}`, status: 'expired', expiresAt: NOW })) }));
    Booking.findOneAndUpdate.mockResolvedValueOnce(base({ status: 'cancelled' }));
    User.findById.mockReturnValue(lean({ fullName: 'Karan' }));
    await offerNext('b1', NOW);
    expect(Booking.findOneAndUpdate.mock.calls[0][1].$set).toMatchObject({ 'allocation.state': 'failed', status: 'cancelled', cancelledBy: 'system' });
    expect(issueRefund).toHaveBeenCalledWith('b1', 600, 'No companion available');
  });

  it('failing twice refunds once (second call finds nothing to update)', async () => {
    Booking.findOneAndUpdate.mockResolvedValueOnce(null);
    Booking.findById.mockResolvedValueOnce(base({ allocation: { state: 'failed' } }));
    await failAllocation('b1', 'x', NOW);
    expect(issueRefund).not.toHaveBeenCalled();
  });
});
