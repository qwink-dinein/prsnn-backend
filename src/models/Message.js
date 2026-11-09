
import mongoose from 'mongoose';

const MessageSchema = new mongoose.Schema({
    bookingId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'Booking', 
        required: true 
    },
    senderId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    },
    content: { 
        type: String, 
        required: true,
        trim: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

MessageSchema.index({ bookingId: 1, createdAt: 1 });

const Message = mongoose.model('Message', MessageSchema);
export default Message;
