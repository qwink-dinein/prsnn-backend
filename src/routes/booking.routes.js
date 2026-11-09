
import express from 'express';
import { createBooking, getUserBookings, getCompanionBookings, updateBookingStatus, getBookingById, cancelBooking, getBookingMessages } from '../controllers/booking.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { createPrepaidBooking, getPolicy, acceptPrepaidOffer, declinePrepaidOffer, openDispute } from '../controllers/prepaid.controller.js';

const router = express.Router();

// Prepaid flow (mobile app): pay first, then companion allocation
router.get('/prepaid/policy', getPolicy);
router.post('/prepaid', authMiddleware, createPrepaidBooking);
router.post('/:id/offer/accept', authMiddleware, acceptPrepaidOffer);
router.post('/:id/offer/decline', authMiddleware, declinePrepaidOffer);
router.post('/:id/dispute', authMiddleware, openDispute);

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
