import AuditLog from '../models/AuditLog.js';

/** Keep only the fields that changed (and drop secrets) so the log stays small and safe. */
const SECRET = new Set(['password', 'pinHash', 'phoneOtpHash', 'otp', 'razorpaySignature', 'pushToken']);
export function diff(before = {}, after = {}) {
    const b = {};
    const a = {};
    const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
    for (const k of keys) {
        if (SECRET.has(k)) continue;
        const x = before?.[k];
        const y = after?.[k];
        if (JSON.stringify(x) !== JSON.stringify(y)) {
            b[k] = x;
            a[k] = y;
        }
    }
    return { before: b, after: a };
}

/**
 * Record an admin action. Never throws: a logging failure must not undo the
 * action, but it is reported.
 */
export async function audit(req, action, target, before, after) {
    try {
        const d = before !== undefined || after !== undefined ? diff(before ?? {}, after ?? {}) : { before: undefined, after: undefined };
        await AuditLog.create({ actorId: req.user.id, role: req.user.role, action, target, before: d.before, after: d.after, at: new Date() });
    } catch (err) {
        console.error(`Audit log failed for ${action}:`, err.message);
    }
}
