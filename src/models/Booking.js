
import mongoose from 'mongoose';

/**
 * Two booking flows share this model:
 *
 *   flow 'request' (website, unchanged): request → companion accepts → pay.
 *   flow 'prepaid' (mobile app): pay first → offers go to up to 3 eligible
 *     companions one at a time → the first to accept is assigned atomically
 *     → if nobody accepts in time, cancelled and refunded.
 *
 * Booking state (`status` + `allocation.state`) and payment state
 * (`paymentStatus` + `refund`) are stored separately.
 */

const OfferSchema = new mongoose.Schema({
    companionId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // offered → accepted | declined | expired | withdrawn (another companion won, or the booking ended)
    status: { type: String, enum: ['offered', 'accepted', 'declined', 'expired', 'withdrawn'], default: 'offered' },
    offeredAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    respondedAt: { type: Date },
}, { _id: true });

const BookingSchema = new mongoose.Schema({
    requesterId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    // Request flow: the companion asked. Prepaid flow: empty until a companion is assigned.
    companionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: function () { return this.flow !== 'prepaid'; }
    },
    status: {
        type: String,
        enum: ['pending', 'accepted', 'rejected', 'completed', 'cancelled'],
        default: 'pending'
    },
    message: { type: String, default: '' },
    pricePerHour: { type: Number, required: true },
    startTime: { type: String, required: true },
    // Minutes. Whole hours 1–12 are the fixed packages; 30/90/180 are older website bookings.
    duration: { type: String, enum: ['30', '60', '90', '120', '180', '240', '300', '360', '420', '480', '540', '600', '660', '720'], required: true },
    // Fixed package price in rupees (same for every companion). Absent on older bookings.
    packagePrice: { type: Number },
    // Companion's share (80%) once a companion holds the booking; prsnn keeps 20%.
    companionShare: { type: Number },
    scheduledDate: { type: Date, default: Date.now },
    paymentStatus: {
        type: String,
        enum: ['pending', 'paid', 'failed', 'refunded'],
        default: 'pending'
    },
    // 'simulated' = test payment made while PAYMENT_MODE=simulated (no money moved).
    paymentMode: { type: String, enum: ['razorpay', 'simulated'] },
    razorpayOrderId: { type: String },
    razorpayPaymentId: { type: String },
    razorpaySignature: { type: String },
    amountPaid: { type: Number, default: 0 },
    paidAt: { type: Date },

    // ── Prepaid flow ──
    flow: { type: String, enum: ['request', 'prepaid'], default: 'request' },
    // The companion the customer picked; gets the first offer.
    preferredCompanionId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    // Client-generated key: a retried "create booking" returns the same booking instead of a second one.
    idempotencyKey: { type: String },
    experience: { type: String },
    city: { type: String },
    area: { type: String },
    allocation: {
        // awaiting_payment → offering → assigned | failed ; or cancelled at any point
        state: { type: String, enum: ['awaiting_payment', 'offering', 'assigned', 'failed', 'cancelled'] },
        paymentDeadline: { type: Date },   // unpaid bookings lapse after this
        deadline: { type: Date },          // overall: nobody assigned by now → fail + refund
        assignedAt: { type: Date },
        failedReason: { type: String },
    },
    offers: [OfferSchema],
    refund: {
        status: { type: String, enum: ['none', 'pending', 'processed', 'failed'], default: 'none' },
        amount: { type: Number, default: 0 },  // rupees refunded
        retained: { type: Number, default: 0 }, // rupees kept as the cancellation fee (15%), if any
        reason: { type: String },
        providerRefundId: { type: String },
        requestedAt: { type: Date },
        processedAt: { type: Date },
        attempts: { type: Number, default: 0 },
    },
    cancelledBy: { type: String, enum: ['requester', 'companion', 'system', 'admin'] },
    cancelReason: { type: String },
    cancelledAt: { type: Date },
    dispute: {
        status: { type: String, enum: ['none', 'open', 'resolved'], default: 'none' },
        reason: { type: String },
        openedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        openedAt: { type: Date },
        // Admin replies (also sent to both parties as notifications).
        notes: [{
            by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
            role: { type: String },
            message: { type: String },
            at: { type: Date, default: Date.now },
        }],
        resolution: { type: String },
        resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        resolvedAt: { type: Date },
    },
    // A sub-admin cancelled a paid booking: no money moved, a superadmin decides the refund.
    refundReview: {
        needed: { type: Boolean, default: false },
        note: { type: String },
        requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        requestedAt: { type: Date },
    },

    createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

BookingSchema.index({ requesterId: 1, idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } });
BookingSchema.index({ flow: 1, 'allocation.state': 1 });
BookingSchema.index({ 'offers.companionId': 1, 'offers.status': 1 });
BookingSchema.index({ razorpayOrderId: 1 });
BookingSchema.index({ 'dispute.status': 1, updatedAt: -1 });
BookingSchema.index({ 'refund.status': 1 });

const Booking = mongoose.models.Booking || mongoose.model('Booking', BookingSchema);
export default Booking;
