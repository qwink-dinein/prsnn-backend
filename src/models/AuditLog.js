import mongoose from 'mongoose';

/**
 * One row per admin action (ADMIN_SPEC.md). Written by utils/audit.js; read by
 * superadmins in the app's Activity list. Never edited or deleted by the API.
 */
const AuditLogSchema = new mongoose.Schema({
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    role: { type: String, required: true },
    action: { type: String, required: true },          // e.g. 'booking.refund', 'user.suspend'
    target: {
        kind: { type: String },                          // 'user' | 'booking' | 'settings' | 'broadcast' | 'notification'
        id: { type: String },
    },
    before: { type: mongoose.Schema.Types.Mixed },
    after: { type: mongoose.Schema.Types.Mixed },
    at: { type: Date, default: Date.now },
});

AuditLogSchema.index({ at: -1 });
AuditLogSchema.index({ 'target.kind': 1, 'target.id': 1, at: -1 });

const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', AuditLogSchema);
export default AuditLog;
