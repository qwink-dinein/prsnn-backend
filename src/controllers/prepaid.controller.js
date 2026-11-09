import Booking from '../models/Booking.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import { issueRefund } from '../utils/refunds.js';
import { amountDueInPaise } from '../utils/razorpay.js';
import { sendEmail } from '../utils/sendEmail.js';
import { acceptOffer, declineOffer, isAvailableFor, MIN_LEAD_MS, PAYMENT_TTL_MS, MAX_OFFERS, sessionStart } from '../services/allocation.js';
import { matchesSeeGender } from '../utils/privacy.js';
import { BASE_RATE, CANCELLATION_CUTOFF_MINUTES, CANCELLATION_FEE, PACKAGE_PRICES, offeredHours, withinDay } from '../utils/pricing.js';

/**
 * The terms shown before payment (app checkout) — kept here so the server is
 * the single source of truth and matches prsnn.com/refund-policy.
 */
const SUPPORT = () => process.env.SUPPORT_EMAIL || 'mukarramjahmm@gmail.com';
const pct = (x) => `${Math.round(x * 100)}%`;

export const POLICY = {
    fees: 'No booking fee. One price list for every companion: ₹399 for 1 hour, with lower hourly rates for longer bookings. The price shown is the total you pay, whichever companion accepts — you are never charged more.',
    allocation: `Payment reserves your booking; it is confirmed when an eligible companion accepts. Your chosen companion gets between 15 minutes and 5 hours to respond, depending on how far away your session is. If they can’t make it, we offer your booking to up to ${MAX_OFFERS - 1} similar verified companions, one at a time (same city, your “show me” preference, available for your chosen duration). If nobody accepts at least 1 hour before the session, it is cancelled and fully refunded.`,
    cancellation: [
        `Cancel at least ${CANCELLATION_CUTOFF_MINUTES} minutes before the session starts: ${pct(1 - CANCELLATION_FEE)} refunded (a ${pct(CANCELLATION_FEE)} cancellation fee is kept by prsnn).`,
        `Cancel within ${CANCELLATION_CUTOFF_MINUTES} minutes of the start, or after it starts: no refund.`,
        'If your companion cancels, or no companion accepts: full refund.',
        'Companion no-show: full refund after review. Your own no-show: no refund.',
    ],
    refunds: 'Refunds go to your original payment method. Timing depends on your bank or UPI app.',
    get support() {
        return SUPPORT();
    },
};


/**
 * POST /api/bookings/prepaid
 * Body: { companionId, scheduledDate 'YYYY-MM-DD', startTime 'HH:MM', duration, idempotencyKey, message?, experience?, city?, area?, acceptTerms: true }
 * Creates the booking in "awaiting payment". A retry with the same idempotencyKey returns the same booking.
 */
export const createPrepaidBooking = async (req, res) => {
    try {
        const requesterId = req.user.id;
        const { companionId, scheduledDate, startTime, duration, idempotencyKey, message, experience, city, area, acceptTerms } = req.body;

        if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 100) {
            return res.status(400).json({ message: 'Missing booking key. Please try again.' });
        }
        const existing = await Booking.findOne({ requesterId, idempotencyKey });
        if (existing) return res.status(200).json({ booking: existing, quote: quoteOf(existing), policy: POLICY, replayed: true });

        if (acceptTerms !== true) return res.status(400).json({ message: 'Please accept the cancellation and refund terms.' });
        if (!companionId || !scheduledDate || !startTime) return res.status(400).json({ message: 'Choose a companion, date and time.' });
        if (!/^\d{4}-\d{2}-\d{2}/.test(String(scheduledDate)) || !/^\d{2}:\d{2}$/.test(String(startTime))) return res.status(400).json({ message: 'Invalid date or time.' });
        const hours = parseInt(duration, 10) / 60;
        if (!Number.isInteger(hours) || !PACKAGE_PRICES[hours]) return res.status(400).json({ message: 'Choose a duration between 1 and 12 hours.' });
        const dur = String(hours * 60);
        if (String(companionId) === String(requesterId)) return res.status(400).json({ message: 'You cannot book yourself.' });

        const [requester, companion] = await Promise.all([
            User.findById(requesterId).select('seeGender city area').lean(),
            User.findById(companionId).select('role verificationStatus gender pricePerHour packages availability startTime endTime city area').lean(),
        ]);
        if (!requester) return res.status(404).json({ message: 'Account not found.' });
        if (!companion || companion.role !== 'companion' || companion.verificationStatus !== 'verified') return res.status(404).json({ message: 'Companion not found.' });
        if (!matchesSeeGender(requester.seeGender, companion.gender)) return res.status(404).json({ message: 'Companion not found.' });
        if (!offeredHours(companion).includes(hours)) return res.status(400).json({ message: `This companion doesn’t offer ${hours}-hour bookings.` });
        if (!withinDay(startTime, dur)) return res.status(400).json({ message: 'Sessions must start at or after 7:00 AM and finish by 10:00 PM.' });

        const draft = { scheduledDate: new Date(`${String(scheduledDate).slice(0, 10)}T00:00:00.000Z`), startTime, duration: dur };
        if (!isAvailableFor(companion, draft)) return res.status(400).json({ message: 'This companion isn’t available at that day and time.' });
        if (sessionStart(draft).getTime() - Date.now() < MIN_LEAD_MS) {
            return res.status(400).json({ message: `Please choose a time at least ${Math.round(MIN_LEAD_MS / 60000)} minutes from now, so we can confirm your companion.` });
        }

        try {
            const booking = await Booking.create({
                flow: 'prepaid',
                requesterId,
                preferredCompanionId: companionId,
                idempotencyKey,
                pricePerHour: BASE_RATE,
                packagePrice: PACKAGE_PRICES[hours],
                duration: dur,
                startTime,
                scheduledDate: draft.scheduledDate,
                message: (message || '').slice(0, 300),
                experience: (experience || '').slice(0, 40),
                city: city || companion.city || requester.city,
                area: area || companion.area,
                status: 'pending',
                paymentStatus: 'pending',
                allocation: { state: 'awaiting_payment', paymentDeadline: new Date(Date.now() + PAYMENT_TTL_MS) },
            });
            return res.status(201).json({ booking, quote: quoteOf(booking), policy: POLICY });
        } catch (err) {
            // Two identical requests at the same instant: the unique index lets only one in.
            if (err?.code === 11000) {
                const again = await Booking.findOne({ requesterId, idempotencyKey });
                if (again) return res.status(200).json({ booking: again, quote: quoteOf(again), policy: POLICY, replayed: true });
            }
            throw err;
        }
    } catch (error) {
        console.error('Create prepaid booking error:', error.message);
        res.status(500).json({ message: 'Could not create the booking. Please try again.' });
    }
};

export const quoteOf = (b) => {
    const amount = amountDueInPaise(b) / 100;
    const hours = (parseInt(b.duration, 10) || 60) / 60;
    return { currency: 'INR', amount, fees: 0, hours, effectiveHourly: Math.round(amount / hours), pricePerHour: b.pricePerHour, duration: b.duration };
};

/** GET /api/bookings/prepaid/policy — terms for the checkout screen. */
export const getPolicy = (req, res) => res.status(200).json(POLICY);

/** POST /api/bookings/:id/offer/accept (companion) */
export const acceptPrepaidOffer = async (req, res) => {
    try {
        const r = await acceptOffer(req.params.id, req.user.id);
        if (r.ok) return res.status(200).json({ message: 'Booking confirmed. Chat is open.', booking: r.booking });
        const msg =
            r.reason === 'clash'
                ? 'You already have a booking at that time.'
                : r.reason === 'not_found'
                  ? 'Booking not found.'
                  : 'This offer has expired or was already taken.';
        return res.status(r.reason === 'not_found' ? 404 : 409).json({ message: msg });
    } catch (error) {
        console.error('Accept offer error:', error.message);
        res.status(500).json({ message: 'Could not accept the offer.' });
    }
};

/** POST /api/bookings/:id/offer/decline (companion) */
export const declinePrepaidOffer = async (req, res) => {
    try {
        const r = await declineOffer(req.params.id, req.user.id);
        if (!r.ok) return res.status(409).json({ message: 'This offer is no longer open.' });
        res.status(200).json({ message: 'Declined. We’ll offer it to someone else.' });
    } catch (error) {
        console.error('Decline offer error:', error.message);
        res.status(500).json({ message: 'Could not decline the offer.' });
    }
};

/**
 * Cancel a prepaid booking under the published policy. Paying never blocks
 * cancelling; it only decides the refund.
 *   customer, before payment                     → cancelled, nothing charged
 *   customer, 15+ min before the start           → 85% refunded, 15% kept as cancellation fee
 *   customer, within 15 min of the start / after → no refund (dispute available)
 *   companion, before the start                  → 100% refunded to the customer
 *   nobody accepts (failAllocation)              → 100% refunded
 */
export async function cancelPrepaid(booking, userId, now = new Date()) {
    const isRequester = String(booking.requesterId) === String(userId);
    const isCompanion = booking.companionId && String(booking.companionId) === String(userId);
    if (!isRequester && !isCompanion) return { code: 403, message: 'Not authorized to cancel this booking.' };
    if (['cancelled', 'failed'].includes(booking.allocation?.state) || ['cancelled', 'completed', 'rejected'].includes(booking.status)) {
        return { code: 400, message: 'This booking is already closed.' };
    }
    const started = sessionStart(booking).getTime() <= now.getTime();
    if (isCompanion && started) return { code: 400, message: 'The session has started. Report a problem instead if something went wrong.' };

    const updated = await Booking.findOneAndUpdate(
        { _id: booking._id, status: { $in: ['pending', 'accepted'] }, 'allocation.state': { $in: ['awaiting_payment', 'offering', 'assigned'] } },
        {
            $set: {
                status: 'cancelled',
                'allocation.state': 'cancelled',
                cancelledBy: isRequester ? 'requester' : 'companion',
                cancelReason: isRequester ? 'cancelled_by_customer' : 'cancelled_by_companion',
                cancelledAt: now,
                'offers.$[live].status': 'withdrawn',
            },
        },
        { new: true, arrayFilters: [{ 'live.status': 'offered' }] }
    );
    if (!updated) return { code: 409, message: 'This booking changed just now. Please refresh.' };

    let refund = 'none';
    let refundAmount = 0;
    if (updated.paymentStatus === 'paid') {
        const minutesToStart = (sessionStart(updated).getTime() - now.getTime()) / 60000;
        if (isCompanion) {
            refundAmount = updated.amountPaid; // companion cancelled: customer gets everything back
        } else if (minutesToStart >= CANCELLATION_CUTOFF_MINUTES) {
            refundAmount = Math.round(updated.amountPaid * (1 - CANCELLATION_FEE)); // 15% cancellation fee kept by prsnn
        }
        if (refundAmount > 0) {
            refund = await issueRefund(updated._id, refundAmount, isCompanion ? 'Companion cancelled' : `Customer cancelled ${Math.floor(minutesToStart)} min before start (${Math.round((1 - CANCELLATION_FEE) * 100)}% refund)`);
            await Booking.updateOne({ _id: updated._id }, { $set: { 'refund.retained': Math.round((updated.amountPaid - refundAmount) * 100) / 100 } });
        }
    }
    const ref = String(updated._id).slice(-6).toUpperCase();
    const other = isRequester ? updated.companionId : updated.requesterId;
    if (other) await Notification.create({ userId: other, type: 'booking_cancelled', message: `Booking #${ref} was cancelled${isRequester ? ' by the customer' : ' by the companion'}.` }).catch(() => {});
    if (refund !== 'none') await Notification.create({ userId: updated.requesterId, type: 'refund', message: `Refund of ₹${refundAmount} started for booking #${ref}.` }).catch(() => {});
    const message =
        updated.paymentStatus !== 'paid'
            ? 'Cancelled. Nothing was charged.'
            : refundAmount === 0
              ? `Cancelled. It was within ${CANCELLATION_CUTOFF_MINUTES} minutes of the start, so there’s no refund — report a problem if something went wrong.`
              : refundAmount < updated.amountPaid
                ? `Cancelled. ₹${refundAmount} (${Math.round((1 - CANCELLATION_FEE) * 100)}%) is being refunded.`
                : `Cancelled. ₹${refundAmount} is being refunded in full.`;
    return { code: 200, message, booking: await Booking.findById(updated._id), refund, refundAmount };
}

/**
 * POST /api/bookings/:id/dispute { reason }
 * Either party can report a problem on a paid booking at any time. prsnn
 * reviews it (refund-policy §4B, §8). Opening a dispute never changes the
 * booking or payment by itself.
 */
export const openDispute = async (req, res) => {
    try {
        const reason = String(req.body?.reason || '').trim();
        if (reason.length < 10) return res.status(400).json({ message: 'Tell us a little more (at least 10 characters).' });
        const booking = await Booking.findById(req.params.id);
        if (!booking) return res.status(404).json({ message: 'Booking not found.' });
        const me = String(req.user.id);
        const party = [booking.requesterId, booking.companionId].filter(Boolean).map(String).includes(me);
        if (!party) return res.status(403).json({ message: 'Not authorized.' });
        if (booking.paymentStatus === 'pending' && booking.flow === 'prepaid') return res.status(400).json({ message: 'Nothing was paid for this booking yet.' });
        if (booking.dispute?.status === 'open') return res.status(200).json({ message: 'We already have your report and will be in touch.', booking });

        booking.dispute = { status: 'open', reason: reason.slice(0, 1000), openedBy: req.user.id, openedAt: new Date() };
        await booking.save();
        const ref = String(booking._id).slice(-6).toUpperCase();
        await Notification.create({ userId: req.user.id, type: 'dispute', message: `We received your report for booking #${ref}. Our team will contact you.` }).catch(() => {});
        sendEmail({
            to: SUPPORT(),
            subject: `Dispute opened · booking #${ref}`,
            text: `Booking ${booking._id}\nOpened by user ${req.user.id}\nPayment: ${booking.paymentStatus} (${booking.paymentMode || '-'}) ₹${booking.amountPaid}\n\n${reason}`,
            html: `<p>Booking <b>${booking._id}</b> (#${ref})</p><p>Opened by user ${req.user.id}</p><p>Payment: ${booking.paymentStatus} (${booking.paymentMode || '-'}) ₹${booking.amountPaid}</p><p>${reason.replace(/</g, '&lt;')}</p>`,
        }).catch(() => {});
        res.status(200).json({ message: 'Thanks — our team will review this and contact you.', booking });
    } catch (error) {
        console.error('Dispute error:', error.message);
        res.status(500).json({ message: `Could not send your report. Email ${SUPPORT()}.` });
    }
};
