
import express from 'express';
import { createBooking, getUserBookings, getCompanionBookings, updateBookingStatus, getBookingById, cancelBooking, getBookingMessages } from '../controllers/booking.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = express.Router();

// User routes
router.post('/request', authMiddleware, createBooking);
router.get('/my-requests', authMiddleware, getUserBookings);

// Companion routes
router.get('/incoming-requests', authMiddleware, getCompanionBookings);
router.put('/:id/status', authMiddleware, updateBookingStatus);
router.post('/:id/cancel', authMiddleware, cancelBooking);
router.get('/:id/messages', authMiddleware, getBookingMessages);
router.get('/:id', authMiddleware, getBookingById);

export default router;
