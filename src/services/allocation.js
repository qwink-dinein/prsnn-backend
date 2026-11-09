import Booking from '../models/Booking.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import { issueRefund, MAX_REFUND_ATTEMPTS } from '../utils/refunds.js';
import { notifyWhatsAppLater } from '../utils/whatsappNotify.js';
import { matchesSeeGender } from '../utils/privacy.js';

/**
 * Prepaid booking allocation.
 *
 *   paid → offer to the customer's chosen companion (15 min)
 *        → declined / no answer → next eligible companion (up to 3 in total)
 *        → first acceptance wins (atomic) → confirmed
 *        → nobody by the deadline → cancelled + full refund
 *
 * Offers are SEQUENTIAL: one live offer at a time, so two companions can never
 * both believe they have the booking. Acceptance is a single conditional
 * update that only matches a live, unexpired offer for that companion.
 */

const minutes = (n) => n * 60 * 1000;
export const OFFER_TTL_MS = minutes(Number(process.env.OFFER_TTL_MINUTES) || 15);
export const ALLOCATION_MS = minutes(Number(process.env.ALLOCATION_TIMEOUT_MINUTES) || 120);
export const PAYMENT_TTL_MS = minutes(Number(process.env.PAYMENT_TIMEOUT_MINUTES) || 30);
/** Allocation must finish this long before the session starts. */
export const START_BUFFER_MS = minutes(60);
/** Earliest bookable session: allocation needs time (buffer + 30 minutes). */
export const MIN_LEAD_MS = START_BUFFER_MS + minutes(30);
export const MAX_OFFERS = Math.min(Number(process.env.MAX_COMPANION_OFFERS) || 3, 3);

/** India Standard Time; booking times are entered as IST wall-clock. */
const IST_OFFSET_MS = minutes(330);
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

const toMin = (hhmm = '00:00') => {
    const [h, m] = String(hhmm).split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
};

/** Session start as a real instant. scheduledDate is stored as UTC midnight of the chosen day. */
export function sessionStart(booking) {
    const day = new Date(booking.scheduledDate);
    const utcMidnight = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
    return new Date(utcMidnight + minutes(toMin(booking.startTime)) - IST_OFFSET_MS);
}

export const sessionEnd = (booking) => new Date(sessionStart(booking).getTime() + minutes(Number(booking.duration) || 60));

const overlaps = (a, b) => sessionStart(a) < sessionEnd(b) && sessionStart(b) < sessionEnd(a);

/** Does this companion offer the booking's weekday and start time? */
export function isAvailableFor(companion, booking) {
    const day = DAYS[new Date(booking.scheduledDate).getUTCDay()];
    if (!companion.availability?.[day]) return false;
    if (companion.startTime && companion.endTime) {
        const t = toMin(booking.startTime);
        if (t < toMin(companion.startTime) || t > toMin(companion.endTime)) return false;
    }
    return true;
}

/** Already booked (assigned or holding a live offer) at an overlapping time? */
async function hasConflict(companionId, booking) {
    const others = await Booking.find({
        _id: { $ne: booking._id },
        $or: [
            { companionId, status: 'accepted' },
            { offers: { $elemMatch: { companionId, status: 'offered', expiresAt: { $gt: new Date() } } } },
        ],
        scheduledDate: booking.scheduledDate,
    })
        .select('scheduledDate startTime duration')
        .lean();
    return others.some((o) => overlaps(o, booking));
}

/**
 * Eligible companions for this booking, best first, excluding anyone already
 * offered. Rules: verified companion, not the customer, matches the customer's
 * gender preference, same city, available that day and time, rate at or below
 * what the customer paid, and free at that time. Same area and shared
 * interests rank higher.
 */
export async function findCandidates(booking, requester, excludeIds = [], limit = MAX_OFFERS) {
    const exclude = new Set([String(booking.requesterId), ...excludeIds.map(String)]);
    const city = booking.city || requester?.city;
    const query = { role: 'companion', verificationStatus: 'verified', pricePerHour: { $lte: booking.pricePerHour } };
    if (city) query.city = new RegExp(`^${String(city).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
    const pool = await User.find(query)
        .select('fullName gender city area tags availability startTime endTime pricePerHour phone phoneNumber')
        .limit(200)
        .lean();

    const wantTags = new Set([(booking.experience || '').toLowerCase()].filter(Boolean));
    const ranked = pool
        .filter((c) => !exclude.has(String(c._id)))
        .filter((c) => matchesSeeGender(requester?.seeGender, c.gender))
        .filter((c) => isAvailableFor(c, booking))
        .map((c) => ({
            c,
            score: (booking.area && c.area && c.area.toLowerCase() === booking.area.toLowerCase() ? 2 : 0) + ((c.tags || []).some((t) => wantTags.has(String(t).toLowerCase())) ? 1 : 0),
        }))
        .sort((a, b) => b.score - a.score);

    const out = [];
    for (const { c } of ranked) {
        if (out.length >= limit) break;
        if (!(await hasConflict(c._id, booking))) out.push(c);
    }
    return out;
}

const refOf = (b) => String(b._id).slice(-6).toUpperCase();

async function notify(userId, type, message) {
    try {
        await Notification.create({ userId, type, message });
    } catch (e) {
        console.error('Notification failed:', e.message);
    }
}

/**
 * Called once when a prepaid booking's payment is confirmed (verify, webhook
 * or simulated). Moves awaiting_payment → offering and makes the first offer.
 * If the booking had already lapsed or been cancelled, the payment is refunded.
 */
export async function onPrepaidPaid(bookingId, now = new Date()) {
    const booking = await Booking.findById(bookingId);
    if (!booking || booking.flow !== 'prepaid') return null;

    const start = sessionStart(booking).getTime();
    const deadline = new Date(Math.min(now.getTime() + ALLOCATION_MS, start - START_BUFFER_MS));
    const moved = await Booking.findOneAndUpdate(
        { _id: bookingId, 'allocation.state': 'awaiting_payment' },
        { $set: { 'allocation.state': 'offering', 'allocation.deadline': deadline } },
        { new: true }
    );
    if (!moved) {
        // Paid after the booking lapsed or was cancelled: give the money back.
        const fresh = await Booking.findById(bookingId);
        if (fresh && ['cancelled', 'failed'].includes(fresh.allocation?.state)) {
            await issueRefund(bookingId, fresh.amountPaid, 'Paid after the booking was cancelled or had lapsed');
        }
        return fresh;
    }
    if (deadline.getTime() <= now.getTime()) return failAllocation(bookingId, 'too_close_to_start', now);
    await notify(moved.requesterId, 'payment_completed', `Payment received for booking #${refOf(moved)}. We’re confirming your companion.`);
    return offerNext(bookingId, now);
}

/** Make the next offer, or fail the allocation when no eligible companion is left. */
export async function offerNext(bookingId, now = new Date()) {
    const booking = await Booking.findById(bookingId);
    if (!booking || booking.allocation?.state !== 'offering') return booking;
    if (booking.offers.some((o) => o.status === 'offered' && o.expiresAt > now)) return booking; // one live offer at a time
    if (booking.allocation.deadline && booking.allocation.deadline <= now) return failAllocation(bookingId, 'no_one_accepted_in_time', now);
    if (booking.offers.length >= MAX_OFFERS) return failAllocation(bookingId, 'all_offers_declined', now);

    const requester = await User.findById(booking.requesterId).select('seeGender city fullName phone phoneNumber').lean();
    const offered = booking.offers.map((o) => o.companionId);
    let next = null;
    if (!offered.length && booking.preferredCompanionId) {
        const preferred = await User.findById(booking.preferredCompanionId)
            .select('role verificationStatus fullName gender availability startTime endTime pricePerHour phone phoneNumber')
            .lean();
        if (preferred && preferred.role === 'companion' && preferred.verificationStatus === 'verified' && isAvailableFor(preferred, booking) && !(await hasConflict(preferred._id, booking))) {
            next = preferred;
        }
    }
    if (!next) {
        // The chosen companion is either already offered or unavailable: never offer her twice.
        const exclude = [...offered, ...(booking.preferredCompanionId ? [booking.preferredCompanionId] : [])];
        [next] = await findCandidates(booking, requester, exclude, 1);
    }
    if (!next) return failAllocation(bookingId, 'no_companion_available', now);

    const expiresAt = new Date(Math.min(now.getTime() + OFFER_TTL_MS, booking.allocation.deadline.getTime()));
    const pushed = await Booking.findOneAndUpdate(
        { _id: bookingId, 'allocation.state': 'offering', offers: { $not: { $elemMatch: { status: 'offered', expiresAt: { $gt: now } } } } },
        { $push: { offers: { companionId: next._id, status: 'offered', offeredAt: now, expiresAt } } },
        { new: true }
    );
    if (!pushed) return Booking.findById(bookingId); // someone else made the offer first

    const mins = Math.round((expiresAt - now) / 60000);
    await notify(next._id, 'booking_offer', `New paid booking for ${pushed.duration} min. Accept within ${mins} minutes or it goes to someone else.`);
    notifyWhatsAppLater('booking_request', next, { booking: pushed, requester, companion: next });
    return pushed;
}

/**
 * Companion accepts. Exactly one acceptance can succeed: the update only
 * matches while the booking is still offering AND this companion holds a live,
 * unexpired offer. Expired or withdrawn offers can't be accepted.
 * @returns {Promise<{ ok: boolean, booking?: object, reason?: string }>}
 */
export async function acceptOffer(bookingId, companionId, now = new Date()) {
    const current = await Booking.findById(bookingId).select('scheduledDate startTime duration').lean();
    if (!current) return { ok: false, reason: 'not_found' };
    if (await hasConflict(companionId, { ...current, _id: bookingId })) {
        // A live offer for THIS booking is excluded by _id; anything left is a real clash.
        return { ok: false, reason: 'clash' };
    }
    const booking = await Booking.findOneAndUpdate(
        {
            _id: bookingId,
            flow: 'prepaid',
            paymentStatus: 'paid',
            'allocation.state': 'offering',
            offers: { $elemMatch: { companionId, status: 'offered', expiresAt: { $gt: now } } },
        },
        {
            $set: {
                companionId,
                status: 'accepted',
                'allocation.state': 'assigned',
                'allocation.assignedAt': now,
                'offers.$[mine].status': 'accepted',
                'offers.$[mine].respondedAt': now,
            },
        },
        { new: true, arrayFilters: [{ 'mine.companionId': companionId, 'mine.status': 'offered' }] }
    );
    if (!booking) return { ok: false, reason: 'expired_or_taken' };

    const [requester, companion] = await Promise.all([User.findById(booking.requesterId).lean(), User.findById(companionId).lean()]);
    const name = companion?.fullName?.split(' ')[0] || 'Your companion';
    await notify(booking.requesterId, 'booking_confirmed', `${name} confirmed your booking #${refOf(booking)}. Chat is open.`);
    await notify(companionId, 'booking_confirmed', `Booking #${refOf(booking)} is yours. Chat is open.`);
    if (requester) notifyWhatsAppLater('booking_confirmed', requester, { booking, requester, companion });
    return { ok: true, booking };
}

/** Companion declines: the offer closes and the next companion is offered right away. */
export async function declineOffer(bookingId, companionId, now = new Date()) {
    const res = await Booking.updateOne(
        { _id: bookingId, 'allocation.state': 'offering', offers: { $elemMatch: { companionId, status: 'offered' } } },
        { $set: { 'offers.$[mine].status': 'declined', 'offers.$[mine].respondedAt': now } },
        { arrayFilters: [{ 'mine.companionId': companionId, 'mine.status': 'offered' }] }
    );
    if (!res.modifiedCount) return { ok: false };
    await offerNext(bookingId, now);
    return { ok: true };
}

/** Nobody could take it: cancel, withdraw any live offer, refund in full. */
export async function failAllocation(bookingId, reason, now = new Date()) {
    const booking = await Booking.findOneAndUpdate(
        { _id: bookingId, 'allocation.state': 'offering' },
        {
            $set: {
                'allocation.state': 'failed',
                'allocation.failedReason': reason,
                status: 'cancelled',
                cancelledBy: 'system',
                cancelReason: reason,
                cancelledAt: now,
                'offers.$[live].status': 'withdrawn',
            },
        },
        { new: true, arrayFilters: [{ 'live.status': 'offered' }] }
    );
    if (!booking) return Booking.findById(bookingId);
    await issueRefund(bookingId, booking.amountPaid, 'No companion available');
    await notify(booking.requesterId, 'refund', `We couldn’t find an available companion for booking #${refOf(booking)}. Your full payment is being refunded.`);
    const requester = await User.findById(booking.requesterId).lean();
    if (requester) notifyWhatsAppLater('booking_unfulfilled', requester, { booking, requester, amount: booking.amountPaid });
    return Booking.findById(bookingId);
}

/**
 * Housekeeping, run every 30 s by server.js (and safe to run on several
 * instances: every step is a conditional update).
 */
export async function sweep(now = new Date()) {
    // 1. Unpaid prepaid bookings lapse (nothing was charged).
    await Booking.updateMany(
        { flow: 'prepaid', 'allocation.state': 'awaiting_payment', paymentStatus: { $ne: 'paid' }, 'allocation.paymentDeadline': { $lt: now } },
        { $set: { 'allocation.state': 'cancelled', status: 'cancelled', cancelledBy: 'system', cancelReason: 'payment_not_completed', cancelledAt: now } }
    );

    // 2. Offers past their deadline expire; the next companion is offered.
    const withExpired = await Booking.find({ 'allocation.state': 'offering', offers: { $elemMatch: { status: 'offered', expiresAt: { $lte: now } } } }).select('_id').lean();
    for (const { _id } of withExpired) {
        await Booking.updateOne(
            { _id },
            { $set: { 'offers.$[old].status': 'expired', 'offers.$[old].respondedAt': now } },
            { arrayFilters: [{ 'old.status': 'offered', 'old.expiresAt': { $lte: now } }] }
        );
        await offerNext(_id, now);
    }

    // 3. Overall deadline passed with nobody assigned.
    const overdue = await Booking.find({ 'allocation.state': 'offering', 'allocation.deadline': { $lte: now } }).select('_id').lean();
    for (const { _id } of overdue) await failAllocation(_id, 'no_one_accepted_in_time', now);

    // 4. Retry refunds that failed at the provider.
    const retry = await Booking.find({ 'refund.status': 'failed', 'refund.attempts': { $lt: MAX_REFUND_ATTEMPTS } }).select('_id refund').lean();
    for (const b of retry) await issueRefund(b._id, b.refund.amount, b.refund.reason || 'Retry');
}

let timer = null;
export function startAllocationWorker(intervalMs = 30_000) {
    if (timer) return;
    timer = setInterval(() => sweep().catch((e) => console.error('Allocation sweep failed:', e.message)), intervalMs);
    timer.unref?.();
}
