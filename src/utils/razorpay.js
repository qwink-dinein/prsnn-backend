import Razorpay from 'razorpay';

/**
 * Razorpay client, built on first use.
 *
 * Constructing at module scope meant a missing RAZORPAY_KEY_ID threw during
 * import, which failed app.js and stopped the entire API from booting. Building
 * it lazily confines a misconfiguration to the payment routes.
 */
let razorpayClient = null;
export const getRazorpay = () => {
    if (!razorpayClient) {
        const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET } = process.env;
        if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
            throw new Error('Razorpay is not configured on this server.');
        }
        razorpayClient = new Razorpay({ key_id: RAZORPAY_KEY_ID, key_secret: RAZORPAY_KEY_SECRET });
    }
    return razorpayClient;
};

/** Amount owed for a booking, in paise. Single source of truth (app mirrors it). */
export const amountDueInPaise = (booking) => {
    const hours = (parseInt(booking.duration, 10) || 60) / 60;
    return Math.round(booking.pricePerHour * hours * 100);
};

/** PAYMENT_MODE=simulated → test checkout, no money moves. Default 'razorpay'. */
export const paymentMode = () => (process.env.PAYMENT_MODE === 'simulated' ? 'simulated' : 'razorpay');
