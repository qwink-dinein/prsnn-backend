
import mongoose from 'mongoose';

const BookingSchema = new mongoose.Schema({
    requesterId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    },
    companionId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    },
    status: { 
        type: String, 
        enum: ['pending', 'accepted', 'rejected', 'completed', 'cancelled'], 
        default: 'pending' 
    },
    message: { type: String, default: '' },
    pricePerHour: { type: Number, required: true },
    startTime: { type: String, required: true },
    duration: { type: String, enum: ['30', '60', '90', '120', '180', '240'], required: true },
    scheduledDate: { type: Date, default: Date.now },
    paymentStatus: { 
        type: String, 
        enum: ['pending', 'paid', 'failed', 'refunded'], 
        default: 'pending' 
    },
    razorpayOrderId: { type: String },
    razorpayPaymentId: { type: String },
    razorpaySignature: { type: String },
    amountPaid: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

const Booking = mongoose.model('Booking', BookingSchema);
export default Booking;
