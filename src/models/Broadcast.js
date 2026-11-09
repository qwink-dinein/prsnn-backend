import mongoose from 'mongoose';

/** A push notification sent by a superadmin to all members or all companions. */
const BroadcastSchema = new mongoose.Schema({
    audience: { type: String, enum: ['members', 'companions'], required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    recipients: { type: Number, default: 0 },  // accounts with a push token
    sent: { type: Number, default: 0 },        // accepted by Expo
    failed: { type: Number, default: 0 },
    batches: { type: Number, default: 0 },
}, { timestamps: true });

BroadcastSchema.index({ createdAt: -1 });

const Broadcast = mongoose.models.Broadcast || mongoose.model('Broadcast', BroadcastSchema);
export default Broadcast;
