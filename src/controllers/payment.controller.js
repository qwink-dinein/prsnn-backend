
import { getRazorpay, amountDueInPaise, paymentMode } from '../utils/razorpay.js';
import crypto from 'crypto';
import Booking from '../models/Booking.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import { notifyWhatsAppLater } from '../utils/whatsappNotify.js';
import { onPrepaidPaid } from '../services/allocation.js';
import { companionShareOf } from '../utils/pricing.js';

/**
 * PAYMENT_MODE=simulated turns on a test checkout for the mobile app: no
 * Razorpay call, no money moves, the booking is marked paid with
 * paymentMode 'simulated'. Use it on the TESTING service only — the website
 * still needs Razorpay order ids, so production keeps the default 'razorpay'.
 */
export { paymentMode };

/**
 * Why this booking can't be paid right now, or null.
 * Request flow (website): only after the companion accepted.
 * Prepaid flow (app): only while awaiting payment (before the payment window lapses).
 */
export function payableError(booking) {
    if (booking.paymentStatus === 'paid') return null; // handled as idempotent success by callers
    if (booking.flow === 'prepaid') {
        if (booking.allocation?.state !== 'awaiting_payment') return "This booking can no longer be paid. Please start a new booking.";
        return null;
    }
    if (booking.status !== 'accepted') return "Booking must be accepted before payment.";
    return null;
}

/**
 * Shared by verify, webhook and simulated payments. Atomic: only the first
 * caller flips the booking to paid (a verify racing the webhook can't double
 * count). Prepaid bookings then start companion allocation.
 * @returns {Promise<{ booking, alreadyPaid: boolean }>}
 */
export async function markPaid(bookingId, { paymentId, signature, amountRupees, mode }) {
    const updated = await Booking.findOneAndUpdate(
        { _id: bookingId, paymentStatus: { $ne: 'paid' } },
        {
            $set: {
                paymentStatus: 'paid',
                paymentMode: mode,
                razorpayPaymentId: paymentId,
                ...(signature ? { razorpaySignature: signature } : {}),
                amountPaid: amountRupees,
                paidAt: new Date(),
            },
        },
        { new: true }
    );
    if (!updated) return { booking: await Booking.findById(bookingId), alreadyPaid: true };

    if (updated.flow === 'prepaid') {
        const after = await onPrepaidPaid(updated._id);
        return { booking: after ?? updated, alreadyPaid: false };
    }

    await Booking.updateOne({ _id: updated._id }, { $set: { companionShare: companionShareOf(amountRupees) } });
    const refId = updated._id.toString().slice(-6).toUpperCase();
    await Notification.create({
        userId: updated.companionId,
        type: 'payment_completed',
        message: `Payment received for booking #${refId}. Chat is now open.`
    });
    const [requester, companion] = await Promise.all([User.findById(updated.requesterId), User.findById(updated.companionId)]);
    if (companion) notifyWhatsAppLater('payment_received', companion, { booking: updated, requester, companion, amount: amountRupees });
    return { booking: updated, alreadyPaid: false };
}

export const createPaymentIntent = async (req, res) => {
    try {
        const { bookingId } = req.body;
        const userId = req.user.id; // From auth middleware

        const booking = await Booking.findById(bookingId);
        
        if (!booking) {
            return res.status(404).json({ message: "Booking not found." });
        }

        // Ensure the user requesting payment is the one who made the booking
        if (booking.requesterId.toString() !== userId) {
            return res.status(403).json({ message: "Unauthorized to pay for this booking." });
        }

        if (booking.paymentStatus === 'paid') {
            return res.status(400).json({ message: "Booking is already paid." });
        }
        const notPayable = payableError(booking);
        if (notPayable) return res.status(400).json({ message: notPayable });

        // Calculate amount (duration stored as minutes string)
        const amountInPaise = amountDueInPaise(booking);

        if (paymentMode() === 'simulated') {
            return res.status(200).json({
                mode: 'simulated',
                orderId: `sim_${booking._id}`,
                amount: amountInPaise,
                currency: 'INR'
            });
        }

        // IDEMPOTENCY: If an order was already created for this booking, reuse it
        // This prevents duplicate orders if the user clicks Pay multiple times
        if (booking.razorpayOrderId) {
            try {
                const existingOrder = await getRazorpay().orders.fetch(booking.razorpayOrderId);
                if (existingOrder && existingOrder.status !== 'paid') {
                    return res.status(200).json({
                        orderId: existingOrder.id,
                        amount: existingOrder.amount,
                        currency: existingOrder.currency,
                        keyId: process.env.RAZORPAY_KEY_ID,
                        mode: 'razorpay'
                    });
                }
            } catch (fetchErr) {
                // If fetch fails, fall through and create a new order
                console.warn("Could not fetch existing Razorpay order, creating new one:", fetchErr.message);
            }
        }

        // Create a new Razorpay Order
        const options = {
            amount: amountInPaise,
            currency: 'INR',
            receipt: booking._id.toString(),
            notes: {
                bookingId: booking._id.toString(),
                requesterId: userId
            }
        };

        const order = await getRazorpay().orders.create(options);

        // Save the order ID to the booking
        booking.razorpayOrderId = order.id;
        await booking.save();

        res.status(200).json({
            orderId: order.id,
            amount: amountInPaise,
            currency: 'INR',
            keyId: process.env.RAZORPAY_KEY_ID,
            mode: 'razorpay'
        });

    } catch (error) {
        console.error("Create Payment Intent Error:", error);
        res.status(500).json({ message: "Failed to create payment intent.", error: "Payment initialization failed." });
    }
};

export const verifyPayment = async (req, res) => {
    try {
        const { razorpayOrderId, razorpayPaymentId, razorpaySignature, bookingId } = req.body;

        if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature || !bookingId) {
            return res.status(400).json({ message: "Payment details and Booking ID are required." });
        }

        // 1. The signature proves a payment happened on OUR merchant account.
        //    On its own it says nothing about WHICH booking that payment was for.
        const body = razorpayOrderId + "|" + razorpayPaymentId;

        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(body.toString())
            .digest('hex');

        const providedSignature = Buffer.from(String(razorpaySignature), 'utf8');
        const computedSignature = Buffer.from(expectedSignature, 'utf8');
        const signatureValid =
            providedSignature.length === computedSignature.length &&
            crypto.timingSafeEqual(providedSignature, computedSignature);

        if (!signatureValid) {
            return res.status(400).json({ message: "Payment signature verification failed." });
        }

        const booking = await Booking.findById(bookingId);
        if (!booking) {
            return res.status(404).json({ message: "Booking not found." });
        }

        // 2. The caller must own this booking.
        if (booking.requesterId.toString() !== req.user.id.toString()) {
            return res.status(403).json({ message: "Unauthorized to pay for this booking." });
        }

        // 3. The order must be the one WE created for THIS booking. Without this,
        //    a genuine signature from a cheap booking can be replayed against an
        //    expensive one.
        if (!booking.razorpayOrderId || booking.razorpayOrderId !== razorpayOrderId) {
            return res.status(400).json({ message: "This payment does not belong to this booking." });
        }

        // Idempotent: If already marked paid (e.g., webhook already processed), just return success
        if (booking.paymentStatus === 'paid') {
            return res.status(200).json({ message: "Payment already verified.", booking });
        }

        // Fetch the payment from Razorpay — the authoritative record of what was charged.
        const payment = await getRazorpay().payments.fetch(razorpayPaymentId);

        // 4. The payment must belong to the order we just matched.
        if (payment.order_id !== razorpayOrderId) {
            return res.status(400).json({ message: "Payment does not match the order." });
        }

        // 5. It must actually have been captured, not merely created or authorized.
        if (payment.status !== 'captured') {
            return res.status(400).json({ message: `Payment is not complete (status: ${payment.status}).` });
        }

        // 6. The amount charged must cover what is owed.
        const expectedPaise = amountDueInPaise(booking);
        if (payment.amount < expectedPaise) {
            console.error(
                `Underpayment on booking ${booking._id}: paid ${payment.amount} paise, owed ${expectedPaise}`
            );
            return res.status(400).json({ message: "Amount paid is less than the amount due." });
        }

        const result = await markPaid(booking._id, { paymentId: razorpayPaymentId, signature: razorpaySignature, amountRupees: payment.amount / 100, mode: 'razorpay' });

        res.status(200).json({ message: "Payment verified successfully.", booking: result.booking });

    } catch (error) {
        console.error("Verify Payment Error:", error);
        res.status(500).json({ message: "Failed to verify payment.", error: error.message });
    }
};

/**
 * POST /api/payments/simulate { bookingId, outcome?: 'success' | 'failure' }
 * Test checkout. Refused unless PAYMENT_MODE=simulated. Same ownership and
 * state checks as a real payment; 'failure' changes nothing (lets the app
 * test its failed-payment path).
 */
export const simulatePayment = async (req, res) => {
    try {
        if (paymentMode() !== 'simulated') {
            return res.status(403).json({ message: "Simulated payments are turned off on this server." });
        }
        const { bookingId, outcome = 'success' } = req.body;
        const booking = await Booking.findById(bookingId);
        if (!booking) return res.status(404).json({ message: "Booking not found." });
        if (booking.requesterId.toString() !== req.user.id.toString()) {
            return res.status(403).json({ message: "Unauthorized to pay for this booking." });
        }
        if (booking.paymentStatus === 'paid') {
            return res.status(200).json({ message: "Payment already completed.", booking });
        }
        const notPayable = payableError(booking);
        if (notPayable) return res.status(400).json({ message: notPayable });
        if (outcome === 'failure') {
            return res.status(402).json({ message: "Test payment declined. No money was taken." });
        }
        const result = await markPaid(booking._id, {
            paymentId: `sim_pay_${booking._id}`,
            amountRupees: amountDueInPaise(booking) / 100,
            mode: 'simulated'
        });
        res.status(200).json({ message: "Test payment successful.", booking: result.booking });
    } catch (error) {
        console.error("Simulate Payment Error:", error.message);
        res.status(500).json({ message: "Failed to complete test payment." });
    }
};

/**
 * POST /api/payments/webhook — Razorpay server-to-server events.
 * Mounted with express.raw() in app.js: the signature is an HMAC of the exact
 * raw body with RAZORPAY_WEBHOOK_SECRET (X-Razorpay-Signature). This is the
 * source of truth when the app closes before it can call verify-payment.
 *   payment.captured  → booking paid (amount checked) → allocation starts
 *   refund.processed  → refund marked processed
 * Always idempotent; unknown events are acknowledged.
 */
export const razorpayWebhook = async (req, res) => {
    try {
        const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
        if (!secret) return res.status(503).json({ message: 'Webhook not configured.' });
        const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));
        const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
        const given = String(req.headers['x-razorpay-signature'] || '');
        const ok = given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
        if (!ok) return res.status(400).json({ message: 'Invalid signature.' });

        const event = JSON.parse(raw.toString('utf8'));
        if (event.event === 'payment.captured') {
            const p = event.payload?.payment?.entity;
            if (p?.order_id) {
                const booking = await Booking.findOne({ razorpayOrderId: p.order_id });
                if (booking && booking.paymentStatus !== 'paid') {
                    if (p.amount >= amountDueInPaise(booking)) {
                        await markPaid(booking._id, { paymentId: p.id, amountRupees: p.amount / 100, mode: 'razorpay' });
                    } else {
                        console.error(`Webhook underpayment on booking ${booking._id}: ${p.amount} < ${amountDueInPaise(booking)}`);
                    }
                }
            }
        } else if (event.event === 'refund.processed') {
            const r = event.payload?.refund?.entity;
            if (r?.id) {
                await Booking.updateOne({ 'refund.providerRefundId': r.id }, { $set: { 'refund.status': 'processed', 'refund.processedAt': new Date() } });
            }
        }
        res.status(200).json({ ok: true });
    } catch (error) {
        console.error('Razorpay webhook error:', error.message);
        res.status(500).json({ message: 'Webhook processing failed.' });
    }
};
