import express from 'express';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { requireStaff, STAFF_ROLES, SUPER_ROLES } from '../middleware/staff.middleware.js';
import * as a from '../controllers/adminApp.controller.js';

/**
 * In-app admin API, mounted at /api/admin/app (ADMIN_SPEC.md).
 *
 * `ops` = any staff role (sub-admins and the website's admins).
 * `money` = superadmin only: every route that moves money, changes prices,
 * sends push, or manages admins. Declared here so a new route can't ship
 * without a guard; the app only hides the buttons.
 */
const router = express.Router();
const ops = [authMiddleware, requireStaff(...STAFF_ROLES)];
const money = [authMiddleware, requireStaff(...SUPER_ROLES)];

router.get('/overview', ops, a.overview);

// Verify companions
router.get('/verifications', ops, a.listVerifications);
router.post('/verifications/:id', ops, a.decideVerification);

// Users and companions
router.get('/users', ops, a.listUsers);
router.get('/users/:id', ops, a.getUser);
router.patch('/users/:id', ops, a.updateUser);
router.post('/users/:id/suspend', ops, a.suspendUser);
router.delete('/users/:id', ops, a.deleteUser);

// Sub-admins
router.get('/admins', money, a.listAdmins);
router.post('/admins', money, a.addAdmin);
router.delete('/admins/:id', money, a.removeAdmin);

// Bookings: operations (no money moves)
router.get('/bookings', ops, a.listBookings);
router.get('/bookings/:id', ops, a.getBooking);
router.get('/bookings/:id/messages', ops, a.getBookingMessages);
router.patch('/bookings/:id', ops, a.updateBooking);
router.post('/bookings/:id/cancel', ops, a.cancelBooking); // refundAmount is refused for sub-admins inside
router.post('/bookings/:id/reassign', ops, a.reassignBooking);

// Bookings: money
router.post('/bookings/:id/refund', money, a.refundBooking);
router.post('/bookings/:id/refund/retry', money, a.retryRefund);
router.post('/bookings/:id/mark-paid', money, a.markBookingPaid);
router.post('/bookings/:id/cancellation-fee', money, a.overrideCancellationFee);
router.delete('/bookings/:id', money, a.deleteBooking);

// Disputes
router.get('/disputes', ops, a.listDisputes);
router.post('/disputes/:id/reply', ops, a.replyDispute);
router.post('/disputes/:id/close', ops, a.closeDispute);

// Notifications
router.post('/notifications', money, a.createNotification);
router.delete('/notifications/:id', money, a.deleteNotification);

// Push broadcasts
router.get('/broadcast/audience', money, a.broadcastAudience);
router.get('/broadcasts', money, a.listBroadcasts);

// Activity log
router.get('/activity', money, a.listActivity);

export default router;

/**
 * Routes the spec names outside /app: PUT /api/admin/settings/pricing and
 * POST /api/admin/broadcast. Mounted on the /api/admin router.
 */
export const adminTopLevel = express.Router();
adminTopLevel.put('/settings/pricing', money, a.updatePricing);
adminTopLevel.post('/broadcast', money, a.broadcast);
