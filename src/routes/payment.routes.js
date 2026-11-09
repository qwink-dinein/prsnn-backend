
import express from 'express';
import { createPaymentIntent, verifyPayment, simulatePayment } from '../controllers/payment.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
const router = express.Router();

router.post('/create-intent', authMiddleware, createPaymentIntent);
router.post('/verify-payment', authMiddleware, verifyPayment);
router.post('/simulate', authMiddleware, simulatePayment);

export default router;
