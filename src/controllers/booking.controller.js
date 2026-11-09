
import Booking from '../models/Booking.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import Message from '../models/Message.js';
import { maskPhoneNumber } from '../utils/maskPhoneNumber.js';
import { notifyWhatsAppLater } from '../utils/whatsappNotify.js';
import { applyLock } from '../utils/privacy.js';
import { cancelPrepaid } from './prepaid.controller.js';
import { BASE_RATE, packagePriceFor, withinDay } from '../utils/pricing.js';

const PERSON_FIELDS = 'fullName profilePhotoUrl pricePerHour profileVisibility';

/** A person's public bits as the other party sees them (photo hidden while locked). */
function personView(p, unlocked) {
    if (!p || typeof p !== 'object' || !p._id) return p;
    const base = { _id: p._id, fullName: p.fullName, profilePhotoUrl: p.profilePhotoUrl, pricePerHour: p.pricePerHour, phoneNumber: undefined };
    const locked = applyLock({ fullName: base.fullName, profilePhoto: base.profilePhotoUrl }, p, { unlocked });
    return { ...base, fullName: locked.fullName, profilePhotoUrl: locked.profilePhoto ?? undefined, locked: locked.locked };
}

/** Confirmed and paid between these two people: each can see the other. */
const confirmedPaid = (b) => ['accepted', 'completed'].includes(b.status) && b.paymentStatus === 'paid';

/**
 * Booking as one participant sees it. Prepaid offers to other companions are
 * never revealed to the customer (only how many were tried and the current
 * deadline); a companion only sees their own offer.
 */
export function bookingView(b, viewerId) {
    const o = typeof b.toObject === 'function' ? b.toObject() : { ...b };
    const me = String(viewerId);
    const unlocked = confirmedPaid(o);
    o.requesterId = personView(o.requesterId, unlocked);
    o.companionId = personView(o.companionId, unlocked);
    o.preferredCompanionId = personView(o.preferredCompanionId, unlocked);
    if (o.flow === 'prepaid') {
        const offers = o.offers || [];
        const live = offers.find((x) => x.status === 'offered');
        const requesterId = String(o.requesterId?._id ?? o.requesterId);
        if (requesterId === me) {
            o.offerSummary = { tried: offers.length, liveUntil: live?.expiresAt ?? null };
        } else {
            const mine = offers.find((x) => String(x.companionId?._id ?? x.companionId) === me);
            o.myOffer = mine ? { status: mine.status, expiresAt: mine.expiresAt, offeredAt: mine.offeredAt } : null;
        }
        delete o.offers;
        delete o.idempotencyKey;
    }
    delete o.razorpaySignature;
    return o;
}

export const createBooking = async (req, res) => {
    try {
        const { companionId, message, duration, scheduledDate, startTime } = req.body;
        const requesterId = req.user.id;

        if (!companionId) {
            return res.status(400).json({ message: "Companion ID is required." });
        }

        if (requesterId === companionId) {
            return res.status(400).json({ message: "You cannot book yourself." });
        }

        if (!scheduledDate || !startTime) {
            return res.status(400).json({ message: "Date and Time are required." });
        }

        const requester = await User.findById(requesterId);
        if (!requester) {
            return res.status(404).json({ message: "Account not found." });
        }
        // Verification check removed as per requirements

        // Fetch companion
        const companion = await User.findById(companionId);
        if (!companion || companion.role !== 'companion') {
             return res.status(404).json({ message: "Companion not found." });
        }

        // 1. Validate Day Availability
        const bookingDayIndex = new Date(scheduledDate).getDay(); // 0 = Sunday
        const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        const dayName = days[bookingDayIndex];

        if (!companion.availability || !companion.availability[dayName]) {
            return res.status(400).json({ message: `Companion is not available on ${dayName.charAt(0).toUpperCase() + dayName.slice(1)}s.` });
        }

        // 2. Validate Time Availability
        if (companion.startTime && companion.endTime) {
            // Simple string comparison for HH:MM works if format is consistent (09:00 vs 9:00 might fail, assuming typical HH:MM)
            // Ideally parse to minutes
            const toMinutes = (timeStr) => {
                const [h, m] = timeStr.split(':').map(Number);
                return h * 60 + m;
            };

            const bookingMin = toMinutes(startTime);
            const startMin = toMinutes(companion.startTime);
            const endMin = toMinutes(companion.endTime);

            if (bookingMin < startMin || bookingMin > endMin) {
                return res.status(400).json({ 
                    message: `Companion is only available between ${companion.startTime} and ${companion.endTime}.` 
                });
            }
        }

        if (!withinDay(startTime, duration || '60')) {
            return res.status(400).json({ message: "Sessions must start at or after 7:00 AM and finish by 10:00 PM." });
        }
        // Same price list for every companion; older website durations (30/90 min) fall back to the base rate.
        const pricePerHour = BASE_RATE;
        const packagePrice = packagePriceFor(duration || '60');

        const newBooking = new Booking({
            requesterId,
            companionId,
            pricePerHour,
            ...(packagePrice ? { packagePrice } : {}),
            duration: duration || '60',
            message: message || "I would like to request your presence.",
            startTime: startTime,
            scheduledDate: scheduledDate,
            status: 'pending'
        });

        await newBooking.save();

        const requesterName = requester.fullName || requester.username || 'Someone';

        await Notification.create({
            userId: companionId,
            type: 'booking_request',
            message: `${requesterName} has sent you a booking request.`
        });
        notifyWhatsAppLater('booking_request', companion, { booking: newBooking, requester, companion });

        res.status(201).json({ message: "Booking request sent successfully!", booking: newBooking });
    } catch (error) {
        console.error("Create Booking Error:", error);
        res.status(500).json({ message: "Failed to create booking request." });
    }
};

export const getUserBookings = async (req, res) => {
    try {
        const userId = req.user.id;
        // Find bookings where user is requester
        const bookings = await Booking.find({ requesterId: userId })
            .populate('companionId', PERSON_FIELDS)
            .populate('preferredCompanionId', PERSON_FIELDS)
            .sort({ createdAt: -1 });

        res.status(200).json(bookings.map((b) => bookingView(b, userId)));
    } catch (error) {
        console.error("Get User Bookings Error:", error);
        res.status(500).json({ message: "Failed to fetch bookings." });
    }
};

export const getCompanionBookings = async (req, res) => {
    try {
        const userId = req.user.id;
        // Find bookings where user is companion (receiver)
        // Request-flow bookings addressed to me, prepaid bookings assigned to me,
        // and prepaid offers made to me (live, answered or expired).
        const bookings = await Booking.find({
            $or: [{ companionId: userId }, { flow: 'prepaid', 'offers.companionId': userId }],
            $nor: [{ flow: 'prepaid', 'allocation.state': 'awaiting_payment' }],
        })
            .populate('requesterId', PERSON_FIELDS)
            .sort({ createdAt: -1 });

        res.status(200).json(bookings.map((b) => bookingView(b, userId)));
    } catch (error) {
        console.error("Get Companion Bookings Error:", error);
        res.status(500).json({ message: "Failed to fetch bookings." });
    }
};

export const updateBookingStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const userId = req.user.id;

        const booking = await Booking.findById(id);
        if (!booking) {
            return res.status(404).json({ message: "Booking not found." });
        }

        if (booking.flow === 'prepaid') {
            // Prepaid: accept/decline go through the offer endpoints; cancelling
            // follows the refund policy. Only "completed" is set here.
            if (status === 'cancelled' || status === 'rejected') {
                const r = await cancelPrepaid(booking, userId);
                return res.status(r.code).json({ message: r.message, booking: r.booking });
            }
            if (status !== 'completed') {
                return res.status(400).json({ message: "Use the offer buttons to accept or decline this booking." });
            }
        }

        // Verify that the user is the companion for this booking
        if (!booking.companionId || booking.companionId.toString() !== userId.toString()) {
            return res.status(403).json({ message: "Not authorized to update this booking." });
        }

        if (!['accepted', 'rejected', 'completed', 'cancelled'].includes(status)) {
            return res.status(400).json({ message: "Invalid status." });
        }

        booking.status = status;
        await booking.save();

        if (status === 'accepted') {
            const requester = await User.findById(booking.requesterId);
            const requesterName = requester ? (requester.fullName || requester.username || 'Someone') : 'Someone';
            
            // Notify the companion (as per prompt example)
            await Notification.create({
                userId: userId, // Companion
                type: 'booking_accepted',
                message: `You have accepted the booking from ${requesterName}.`
            });
            
            // Notify the requester
            const companion = await User.findById(userId);
            const companionName = companion ? (companion.fullName || companion.username || 'A Companion') : 'A Companion';
            await Notification.create({
                userId: booking.requesterId, // Requester
                type: 'booking_accepted',
                message: `${companionName} has accepted your booking request.`
            });
            if (requester) {
                const amount = booking.pricePerHour * ((parseInt(booking.duration, 10) || 60) / 60);
                notifyWhatsAppLater('booking_accepted', requester, { booking, requester, companion, amount });
            }
        }

        res.status(200).json({ message: `Booking ${status} successfully.`, booking });
    } catch (error) {
        console.error("Update Booking Status Error:", error);
        res.status(500).json({ message: "Failed to update booking status." });
    }
};

export const getBookingById = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const booking = await Booking.findById(id)
            .populate('requesterId', PERSON_FIELDS)
            .populate('companionId', PERSON_FIELDS)
            .populate('preferredCompanionId', PERSON_FIELDS);

        if (!booking) {
            return res.status(404).json({ message: "Booking not found." });
        }

        const requesterIdStr = (booking.requesterId?._id || booking.requesterId).toString();
        const companionIdStr = booking.companionId ? (booking.companionId?._id || booking.companionId).toString() : '';
        const offeredTo = (booking.offers || []).some((o) => String(o.companionId) === userId.toString());
        const isParticipant = requesterIdStr === userId.toString() || companionIdStr === userId.toString() || offeredTo;

        if (!isParticipant) {
            return res.status(403).json({ message: "Not authorized to view this booking." });
        }

        res.status(200).json(bookingView(booking, userId));
    } catch (error) {
        console.error("Get Booking Error:", error);
        res.status(500).json({ message: "Failed to fetch booking details." });
    }
};

export const getBookingMessages = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
        const before = req.query.before ? new Date(req.query.before) : null;

        const booking = await Booking.findById(id).select('requesterId companionId status paymentStatus');
        if (!booking) {
            return res.status(404).json({ message: "Booking not found." });
        }

        const isParticipant =
            booking.requesterId.toString() === userId.toString() ||
            String(booking.companionId ?? "") === userId.toString();

        if (!isParticipant) {
            return res.status(403).json({ message: "Not authorized to view this chat." });
        }

        // Same paywall as the socket join — otherwise chat history is readable
        // over HTTP even when the socket refuses the room.
        const isCompanion = String(booking.companionId ?? "") === userId.toString();
        if (!isCompanion && booking.paymentStatus !== 'paid') {
            return res.status(403).json({ message: "Payment is required before entering this session." });
        }

        const query = { bookingId: id };
        if (before && !isNaN(before.getTime())) {
            query.createdAt = { $lt: before };
        }

        const messages = await Message.find(query)
            .sort({ createdAt: -1 })
            .limit(limit)
            .lean();

        const ordered = messages.reverse().map(msg => {
            if (msg.senderId.toString() !== userId.toString()) {
                msg.content = maskPhoneNumber(msg.content);
            }
            return msg;
        });

        const hasMore = messages.length === limit;

        res.status(200).json({
            messages: ordered,
            hasMore,
            oldest: ordered.length > 0 ? ordered[0].createdAt : null
        });
    } catch (error) {
        console.error("Get Booking Messages Error:", error);
        res.status(500).json({ message: "Failed to fetch messages." });
    }
};

export const cancelBooking = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;
        
        const booking = await Booking.findById(id);
        if (!booking) {
            return res.status(404).json({ message: "Booking not found." });
        }
        
        if (booking.flow === 'prepaid') {
            const r = await cancelPrepaid(booking, userId);
            return res.status(r.code).json({ message: r.message, booking: r.booking, refund: r.refund });
        }

        const isCompanion = String(booking.companionId ?? "") === userId.toString();
        const isRequester = booking.requesterId.toString() === userId.toString();

        if (!isCompanion && !isRequester) {
            return res.status(403).json({ message: "Not authorized to cancel this session." });
        }
        
        booking.status = 'cancelled';
        await booking.save();
        
        res.status(200).json({ message: "Session cancelled.", booking });
    } catch (error) {
        console.error("Cancel Booking Error:", error);
        res.status(500).json({ message: "Failed to cancel session." });
    }
};
