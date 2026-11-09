
import express from 'express';
import { createPaymentIntent, verifyPayment } from '../controllers/payment.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
const router = express.Router();

router.post('/create-intent', authMiddleware, createPaymentIntent);
router.post('/verify-payment', authMiddleware, verifyPayment);

export default router;
