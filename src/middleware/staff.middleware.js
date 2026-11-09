import User from '../models/User.js';

export const STAFF_ROLES = ['admin', 'subadmin', 'superadmin'];
export const SUPER_ROLES = ['superadmin'];

/**
 * Staff guard for the app admin routes. Use after authMiddleware.
 *
 * Unlike requireRole, this re-reads the account so a removed sub-admin or a
 * suspended account loses access at once instead of when its 7-day token
 * expires. req.user.role is replaced with the current role.
 *
 *   router.post('/bookings/:id/refund', authMiddleware, requireStaff(...SUPER_ROLES), handler)
 */
export const requireStaff = (...roles) => async (req, res, next) => {
    try {
        if (!req.user?.id) return res.status(401).json({ message: 'No token' });
        const me = await User.findById(req.user.id).select('role suspended fullName phone').lean();
        if (!me || me.suspended || !roles.includes(me.role)) return res.status(403).json({ message: 'Access denied' });
        req.user.role = me.role;
        req.staff = me;
        next();
    } catch (err) {
        console.error('requireStaff error:', err.message);
        res.status(500).json({ message: 'Could not check your access.' });
    }
};
