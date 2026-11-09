
import Booking from '../models/Booking.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import Message from '../models/Message.js';
import { maskPhoneNumber } from '../utils/maskPhoneNumber.js';

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

        const pricePerHour = companion.pricePerHour;
        if (!pricePerHour) {
            return res.status(400).json({ message: "Companion does not have a price set." });
        }

        const newBooking = new Booking({
            requesterId,
            companionId,
            pricePerHour, 
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

        res.status(201).json({ message: "Booking request sent successfully!", booking: newBooking });
    } catch (error) {
        console.error("Create Booking Error:", error);
        res.status(500).json({ message: "Failed to create booking request.", details: error.message });
    }
};

export const getUserBookings = async (req, res) => {
    try {
        const userId = req.user.id;
        // Find bookings where user is requester
        const bookings = await Booking.find({ requesterId: userId })
            .populate('companionId', 'fullName profilePhotoUrl pricePerHour')
            .sort({ createdAt: -1 });
        
        res.status(200).json(bookings);
    } catch (error) {
        console.error("Get User Bookings Error:", error);
        res.status(500).json({ message: "Failed to fetch bookings." });
    }
};

export const getCompanionBookings = async (req, res) => {
    try {
        const userId = req.user.id;
        // Find bookings where user is companion (receiver)
        const bookings = await Booking.find({ companionId: userId })
            .populate('requesterId', 'fullName profilePhotoUrl phoneNumber')
            .sort({ createdAt: -1 });

        res.status(200).json(bookings);
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

        // Verify that the user is the companion for this booking
        if (booking.companionId.toString() !== userId.toString()) {
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
            .populate('requesterId', 'fullName profilePhotoUrl')
            .populate('companionId', 'fullName profilePhotoUrl');

        if (!booking) {
            return res.status(404).json({ message: "Booking not found." });
        }

        const requesterIdStr = (booking.requesterId?._id || booking.requesterId).toString();
        const companionIdStr = (booking.companionId?._id || booking.companionId).toString();
        const isParticipant = requesterIdStr === userId.toString() || companionIdStr === userId.toString();

        if (!isParticipant) {
            return res.status(403).json({ message: "Not authorized to view this booking." });
        }

        res.status(200).json(booking);
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
            booking.companionId.toString() === userId.toString();

        if (!isParticipant) {
            return res.status(403).json({ message: "Not authorized to view this chat." });
        }

        // Same paywall as the socket join — otherwise chat history is readable
        // over HTTP even when the socket refuses the room.
        const isCompanion = booking.companionId.toString() === userId.toString();
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
        
        const isCompanion = booking.companionId.toString() === userId.toString();
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
