import Booking from '../models/Booking.js';
import { getRazorpay } from './razorpay.js';

export const MAX_REFUND_ATTEMPTS = 5;

/**
 * Refund (or release) a paid booking — at most once per booking.
 *
 * The refund is first *claimed* with an atomic update that only matches when
 * no refund is pending or done, so two callers (a cancel racing the allocation
 * sweeper, a retried request) can never both send money back.
 *
 * Simulated payments are marked processed immediately (no money moved).
 * Razorpay refunds go to the original payment method; a provider error leaves
 * the refund 'failed' and the sweeper retries it (up to MAX_REFUND_ATTEMPTS).
 *
 * @returns {Promise<'processed'|'pending'|'failed'|'skipped'>}
 */
export async function issueRefund(bookingId, amountRupees, reason, { razorpay = null } = {}) {
    const amount = Math.max(0, Math.round(Number(amountRupees) * 100) / 100);
    const claimed = await Booking.findOneAndUpdate(
        {
            _id: bookingId,
            paymentStatus: 'paid',
            $or: [{ 'refund.status': { $in: ['none', null] } }, { 'refund.status': { $exists: false } }, { 'refund.status': 'failed', 'refund.attempts': { $lt: MAX_REFUND_ATTEMPTS } }],
        },
        {
            $set: { 'refund.status': 'pending', 'refund.amount': amount, 'refund.reason': reason, 'refund.requestedAt': new Date() },
            $inc: { 'refund.attempts': 1 },
        },
        { new: true }
    );
    if (!claimed) return 'skipped';

    if (amount <= 0) {
        await Booking.updateOne({ _id: bookingId }, { $set: { 'refund.status': 'processed', 'refund.processedAt': new Date() } });
        return 'processed';
    }

    if (claimed.paymentMode === 'simulated') {
        await Booking.updateOne(
            { _id: bookingId },
            { $set: { 'refund.status': 'processed', 'refund.processedAt': new Date(), 'refund.providerRefundId': `sim_rfnd_${Date.now()}`, paymentStatus: 'refunded' } }
        );
        return 'processed';
    }

    try {
        const rp = razorpay ?? getRazorpay();
        const refund = await rp.payments.refund(claimed.razorpayPaymentId, {
            amount: Math.round(amount * 100),
            speed: 'normal',
            notes: { bookingId: String(claimed._id), reason: String(reason).slice(0, 200) },
        });
        const done = refund?.status === 'processed';
        await Booking.updateOne(
            { _id: bookingId },
            {
                $set: {
                    'refund.status': done ? 'processed' : 'pending',
                    'refund.providerRefundId': refund?.id,
                    ...(done ? { 'refund.processedAt': new Date() } : {}),
                    paymentStatus: 'refunded',
                },
            }
        );
        return done ? 'processed' : 'pending';
    } catch (err) {
        console.error(`Refund failed for booking ${bookingId}:`, err?.error?.description || err.message);
        await Booking.updateOne({ _id: bookingId }, { $set: { 'refund.status': 'failed' } });
        return 'failed';
    }
}
