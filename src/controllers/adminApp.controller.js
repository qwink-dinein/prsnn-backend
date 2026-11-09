import mongoose from 'mongoose';
import User, { PRIVATE_USER_FIELDS } from '../models/User.js';
import Booking from '../models/Booking.js';
import Message from '../models/Message.js';
import Notification from '../models/Notification.js';
import AuditLog from '../models/AuditLog.js';
import Broadcast from '../models/Broadcast.js';
import DeletedAccount from '../models/DeletedAccount.js';
import { audit } from '../utils/audit.js';
import { issueRefund } from '../utils/refunds.js';
import { sendPush } from '../utils/expoPush.js';
import { normaliseIndianMobile } from '../utils/phone.js';
import { isSuperadminPhone } from '../utils/superadmin.js';
import { cleanPackages, companionShareOf, dayEndMin, dayStartMin, pricing, publicPricing, withinDay } from '../utils/pricing.js';
import { savePricing } from '../services/settings.js';
import { markPaid } from './payment.controller.js';
import { invalidateCompanionsCache } from './fellows.controller.js';

/**
 * In-app admin (ADMIN_SPEC.md). Mounted at /api/admin/app.
 *
 * Roles: 'superadmin' (everything), 'subadmin' (and the website's 'admin'):
 * operations only. Every money, price and push route is guarded with
 * requireStaff('superadmin') in routes/adminApp.routes.js — the app only hides
 * the buttons. Every change writes an AuditLog row.
 */

const isSuper = (req) => req.user.role === 'superadmin';
const STAFF = ['admin', 'subadmin', 'superadmin'];
const isStaffRole = (r) => STAFF.includes(r);
const ref = (b) => String(b._id).slice(-6).toUpperCase();
const validId = (id) => mongoose.isValidObjectId(id);
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const rupees = (n) => Math.round(Number(n) * 100) / 100;

async function notify(userId, type, message) {
    if (!userId) return;
    try {
        await Notification.create({ userId, type, message });
    } catch (e) {
        console.error('Notification failed:', e.message);
    }
}

// ───────────────────────── Views ─────────────────────────

const USER_FIELDS = 'username fullName email phone phoneNumber role verificationStatus suspended suspendedAt suspendedReason city area state gender seeGender profileVisibility profilePhotoUrl backupPhotoUrl idProofFrontUrl idProofBackUrl description tags packages availability startTime endTime createdAt updatedAt pushToken';

export function userView(u) {
    if (!u) return null;
    return {
        id: String(u._id),
        username: u.username,
        fullName: u.fullName ?? '',
        email: u.email,
        phone: u.phone,
        phoneNumber: u.phoneNumber,
        role: u.role,
        verificationStatus: u.verificationStatus,
        suspended: !!u.suspended,
        suspendedAt: u.suspendedAt,
        suspendedReason: u.suspendedReason,
        city: u.city,
        area: u.area,
        state: u.state,
        gender: u.gender,
        seeGender: u.seeGender,
        profileVisibility: u.profileVisibility ?? 'open',
        profilePhotoUrl: u.profilePhotoUrl,
        backupPhotoUrl: u.backupPhotoUrl,
        idProofFrontUrl: u.idProofFrontUrl,
        idProofBackUrl: u.idProofBackUrl,
        description: u.description,
        tags: u.tags ?? [],
        packages: u.packages,
        availability: u.availability,
        startTime: u.startTime,
        endTime: u.endTime,
        hasPushToken: !!u.pushToken,
        createdAt: u.createdAt,
    };
}

const PERSON = 'fullName username phone phoneNumber profilePhotoUrl role';

/** Sub-admins see bookings but not payouts (companionShare / platform share). */
export function bookingAdminView(b, role) {
    const o = typeof b?.toObject === 'function' ? b.toObject() : { ...b };
    delete o.razorpaySignature;
    delete o.idempotencyKey;
    o.ref = ref(o);
    if (role === 'superadmin') {
        o.platformShare = o.companionShare != null ? rupees((o.amountPaid || 0) - o.companionShare) : undefined;
    } else {
        delete o.companionShare;
    }
    return o;
}

const populated = (q) => q.populate('requesterId', PERSON).populate('companionId', PERSON).populate('preferredCompanionId', PERSON);

// ───────────────────────── Overview ─────────────────────────

/** GET /overview — counts for the home screen; money totals for superadmins only. */
export const overview = async (req, res) => {
    try {
        const startOfDay = new Date();
        startOfDay.setHours(0, 0, 0, 0);
        const [pendingVerifications, liveBookings, openDisputes, refundsToReview, failedRefunds, members, companions, bookingsToday] = await Promise.all([
            User.countDocuments({ role: 'companion', verificationStatus: 'pending' }),
            Booking.countDocuments({ status: { $in: ['pending', 'accepted'] } }),
            Booking.countDocuments({ 'dispute.status': 'open' }),
            Booking.countDocuments({ 'refundReview.needed': true }),
            Booking.countDocuments({ 'refund.status': 'failed' }),
            User.countDocuments({ role: 'user' }),
            User.countDocuments({ role: 'companion', verificationStatus: 'verified' }),
            Booking.countDocuments({ createdAt: { $gte: startOfDay } }),
        ]);
        const out = { role: req.user.role, pendingVerifications, liveBookings, openDisputes, refundsToReview, failedRefunds, members, companions, bookingsToday };
        if (isSuper(req)) {
            const [m] = await Booking.aggregate([
                { $match: { paymentStatus: { $in: ['paid', 'refunded'] } } },
                {
                    $group: {
                        _id: null,
                        collected: { $sum: { $ifNull: ['$amountPaid', 0] } },
                        refunded: { $sum: { $cond: [{ $eq: ['$refund.status', 'processed'] }, { $ifNull: ['$refund.amount', 0] }, 0] } },
                        payouts: { $sum: { $ifNull: ['$companionShare', 0] } },
                    },
                },
            ]);
            out.money = { collected: rupees(m?.collected ?? 0), refunded: rupees(m?.refunded ?? 0), companionPayouts: rupees(m?.payouts ?? 0) };
            out.money.platformNet = rupees(out.money.collected - out.money.refunded - out.money.companionPayouts);
        }
        res.status(200).json(out);
    } catch (err) {
        console.error('Admin overview error:', err.message);
        res.status(500).json({ message: 'Could not load the overview.' });
    }
};

// ───────────────────────── Verify ─────────────────────────

/** GET /verifications — companions waiting for review, oldest first. */
export const listVerifications = async (req, res) => {
    try {
        const rows = await User.find({ role: 'companion', verificationStatus: 'pending' }).select(USER_FIELDS).sort({ updatedAt: 1 }).limit(200).lean();
        res.status(200).json(rows.map(userView));
    } catch (err) {
        console.error('List verifications error:', err.message);
        res.status(500).json({ message: 'Could not load companions to verify.' });
    }
};

/** POST /verifications/:id { decision: 'verified' | 'rejected', note? } */
export const decideVerification = async (req, res) => {
    try {
        const { decision, note } = req.body ?? {};
        if (!['verified', 'rejected'].includes(decision)) return res.status(400).json({ message: 'Choose verify or reject.' });
        if (!validId(req.params.id)) return res.status(404).json({ message: 'Companion not found.' });
        const user = await User.findById(req.params.id);
        if (!user || user.role !== 'companion') return res.status(404).json({ message: 'Companion not found.' });
        const before = { verificationStatus: user.verificationStatus };
        user.verificationStatus = decision;
        user.verifiedBy = req.staff?.phone ? `phone:${req.staff.phone}` : String(req.user.id);
        await user.save();
        invalidateCompanionsCache();
        await notify(
            user._id,
            'other',
            decision === 'verified' ? 'You’re verified. Customers can now book you on prsnn.' : `Your verification wasn’t approved${note ? `: ${String(note).slice(0, 200)}` : '.'} You can update your details and submit again.`
        );
        await audit(req, `verification.${decision === 'verified' ? 'approve' : 'reject'}`, { kind: 'user', id: String(user._id) }, before, { verificationStatus: decision, ...(note ? { note: String(note).slice(0, 200) } : {}) });
        res.status(200).json({ message: decision === 'verified' ? 'Companion verified.' : 'Companion rejected.', user: userView(user) });
    } catch (err) {
        console.error('Decide verification error:', err.message);
        res.status(500).json({ message: 'Could not save the decision.' });
    }
};

// ───────────────────────── Users ─────────────────────────

/** GET /users?q=&role=user|companion|staff&suspended=1 */
export const listUsers = async (req, res) => {
    try {
        const { q, role, suspended } = req.query;
        const query = {};
        if (role === 'staff') query.role = { $in: STAFF };
        else if (['user', 'companion', 'admin', 'subadmin', 'superadmin'].includes(role)) query.role = role;
        if (suspended === '1') query.suspended = true;
        if (q && String(q).trim()) {
            const text = String(q).trim().slice(0, 60);
            const rx = new RegExp(escapeRegex(text), 'i');
            const digits = text.replace(/\D/g, '');
            query.$or = [{ fullName: rx }, { username: rx }, { email: rx }, { city: rx }, ...(digits.length >= 4 ? [{ phone: new RegExp(escapeRegex(digits)) }, { phoneNumber: new RegExp(escapeRegex(digits)) }] : [])];
        }
        const rows = await User.find(query).select(USER_FIELDS).sort({ createdAt: -1 }).limit(100).lean();
        res.status(200).json(rows.map(userView));
    } catch (err) {
        console.error('List users error:', err.message);
        res.status(500).json({ message: 'Could not load users.' });
    }
};

/** GET /users/:id — profile plus their recent bookings. */
export const getUser = async (req, res) => {
    try {
        if (!validId(req.params.id)) return res.status(404).json({ message: 'User not found.' });
        const user = await User.findById(req.params.id).select(USER_FIELDS).lean();
        if (!user) return res.status(404).json({ message: 'User not found.' });
        const bookings = await populated(Booking.find({ $or: [{ requesterId: user._id }, { companionId: user._id }] }).sort({ createdAt: -1 }).limit(20)).lean();
        res.status(200).json({ user: userView(user), bookings: bookings.map((b) => bookingAdminView(b, req.user.role)) });
    } catch (err) {
        console.error('Get user error:', err.message);
        res.status(500).json({ message: 'Could not load this user.' });
    }
};

/** Only a superadmin may act on staff accounts; nobody acts on their own role or suspension. */
function guardTarget(req, user) {
    if (!user) return { code: 404, message: 'User not found.' };
    if (String(user._id) === String(req.user.id)) return { code: 400, message: 'You can’t do this to your own account.' };
    if (isStaffRole(user.role) && !isSuper(req)) return { code: 403, message: 'Only a superadmin can change staff accounts.' };
    if (user.role === 'superadmin') return { code: 403, message: 'Superadmins are managed through SUPERADMIN_PHONES.' };
    return null;
}

const EDITABLE = ['fullName', 'city', 'area', 'state', 'description', 'gender', 'seeGender', 'profileVisibility', 'startTime', 'endTime', 'phoneNumber'];
const GENDERS = ['woman', 'man', 'nonbinary'];
const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** PATCH /users/:id — profile, packages offered, availability, visibility. */
export const updateUser = async (req, res) => {
    try {
        if (!validId(req.params.id)) return res.status(404).json({ message: 'User not found.' });
        const user = await User.findById(req.params.id);
        const blocked = guardTarget(req, user);
        if (blocked && !(blocked.code === 400 && user)) return res.status(blocked.code).json({ message: blocked.message });
        const body = req.body ?? {};
        const before = {};
        const after = {};
        const set = (k, v) => {
            before[k] = user[k] && typeof user[k].toObject === 'function' ? user[k].toObject() : user[k];
            user[k] = v;
            after[k] = v;
        };

        for (const k of EDITABLE) {
            if (body[k] === undefined) continue;
            const v = typeof body[k] === 'string' ? body[k].trim() : body[k];
            if (k === 'gender' && v && !GENDERS.includes(v)) return res.status(400).json({ message: 'Unknown gender.' });
            if (k === 'seeGender' && v && ![...GENDERS, 'everyone'].includes(v)) return res.status(400).json({ message: 'Unknown “show me” value.' });
            if (k === 'profileVisibility' && !['open', 'locked'].includes(v)) return res.status(400).json({ message: 'Visibility is open or locked.' });
            if ((k === 'startTime' || k === 'endTime') && v) {
                const [h, m] = String(v).split(':').map(Number);
                if (!HHMM.test(v) || h * 60 + m < dayStartMin() || h * 60 + m > dayEndMin()) return res.status(400).json({ message: `${k} must be HH:MM between ${pricing().dayStart} and ${pricing().dayEnd}.` });
            }
            if (typeof v === 'string' && v.length > (k === 'description' ? 1000 : 120)) return res.status(400).json({ message: `${k} is too long.` });
            set(k, v === '' ? undefined : v);
        }
        if (body.tags !== undefined) {
            if (!Array.isArray(body.tags)) return res.status(400).json({ message: 'tags must be a list.' });
            set('tags', body.tags.map((t) => String(t).trim().slice(0, 30)).filter(Boolean).slice(0, 15));
        }
        if (body.packages !== undefined) {
            const packages = cleanPackages(body.packages);
            if (typeof packages === 'string') return res.status(400).json({ message: packages });
            set('packages', packages);
        }
        if (body.availability !== undefined) {
            if (!body.availability || typeof body.availability !== 'object') return res.status(400).json({ message: 'availability must be { monday: true, … }.' });
            const a = {};
            for (const d of DAYS) a[d] = !!body.availability[d];
            set('availability', a);
        }
        if (!Object.keys(after).length) return res.status(400).json({ message: 'Nothing to change.' });
        await user.save();
        if (user.role === 'companion') invalidateCompanionsCache();
        await audit(req, 'user.edit', { kind: 'user', id: String(user._id) }, before, after);
        res.status(200).json({ message: 'Saved.', user: userView(user) });
    } catch (err) {
        console.error('Update user error:', err.message);
        res.status(500).json({ message: 'Could not save the changes.' });
    }
};

/** POST /users/:id/suspend { suspended: boolean, reason? } */
export const suspendUser = async (req, res) => {
    try {
        if (!validId(req.params.id)) return res.status(404).json({ message: 'User not found.' });
        const user = await User.findById(req.params.id);
        const blocked = guardTarget(req, user);
        if (blocked) return res.status(blocked.code).json({ message: blocked.message });
        const on = req.body?.suspended !== false;
        const before = { suspended: !!user.suspended };
        user.suspended = on;
        user.suspendedAt = on ? new Date() : undefined;
        user.suspendedReason = on ? String(req.body?.reason ?? '').slice(0, 200) || undefined : undefined;
        await user.save();
        if (user.role === 'companion') invalidateCompanionsCache();
        await audit(req, on ? 'user.suspend' : 'user.unsuspend', { kind: 'user', id: String(user._id) }, before, { suspended: on, ...(user.suspendedReason ? { reason: user.suspendedReason } : {}) });
        res.status(200).json({ message: on ? 'Account suspended.' : 'Account restored.', user: userView(user) });
    } catch (err) {
        console.error('Suspend user error:', err.message);
        res.status(500).json({ message: 'Could not change this account.' });
    }
};

/**
 * DELETE /users/:id — same as self-deletion: open unpaid bookings are cancelled,
 * a DeletedAccount row is kept, bookings and payments stay for accounting.
 * Refused while the person has a paid booking that is still open (cancel or
 * refund it first, so nobody loses money silently).
 */
export const deleteUser = async (req, res) => {
    try {
        if (!validId(req.params.id)) return res.status(404).json({ message: 'User not found.' });
        const user = await User.findById(req.params.id);
        const blocked = guardTarget(req, user);
        if (blocked) return res.status(blocked.code).json({ message: blocked.message });
        const mine = { $or: [{ requesterId: user._id }, { companionId: user._id }] };
        const openPaid = await Booking.countDocuments({ ...mine, status: { $in: ['pending', 'accepted'] }, paymentStatus: 'paid' });
        if (openPaid) return res.status(409).json({ message: `This person has ${openPaid} paid booking${openPaid === 1 ? '' : 's'} still open. Cancel or refund ${openPaid === 1 ? 'it' : 'them'} first.` });

        await Booking.updateMany({ ...mine, status: { $in: ['pending', 'accepted'] } }, { $set: { status: 'cancelled', 'allocation.state': 'cancelled', cancelledBy: 'admin', cancelReason: 'account_deleted', cancelledAt: new Date() } });
        await DeletedAccount.create({
            originalUserId: String(user._id),
            username: user.username,
            email: user.email || (user.phone ? `phone:${user.phone}` : 'none'),
            role: user.role,
            deletedBy: req.user.id,
            deletionReason: String(req.body?.reason ?? 'Deleted by admin (app)').slice(0, 200),
        });
        await User.deleteOne({ _id: user._id });
        if (user.role === 'companion') invalidateCompanionsCache();
        await audit(req, 'user.delete', { kind: 'user', id: String(user._id) }, { role: user.role, fullName: user.fullName, phone: user.phone }, {});
        res.status(200).json({ message: 'Account deleted.' });
    } catch (err) {
        console.error('Delete user error:', err.message);
        res.status(500).json({ message: 'Could not delete this account.' });
    }
};

// ───────────────────────── Sub-admins (superadmin) ─────────────────────────

/** GET /admins */
export const listAdmins = async (req, res) => {
    try {
        const rows = await User.find({ role: { $in: STAFF } }).select(USER_FIELDS).sort({ role: -1, createdAt: 1 }).lean();
        res.status(200).json(rows.map(userView));
    } catch (err) {
        console.error('List admins error:', err.message);
        res.status(500).json({ message: 'Could not load the admin list.' });
    }
};

/**
 * POST /admins { phone, fullName? } — make the account with this number a
 * sub-admin. If nobody has the number yet, an account is created for it; they
 * log in with OTP as usual.
 */
export const addAdmin = async (req, res) => {
    try {
        const phone = normaliseIndianMobile(req.body?.phone);
        if (!phone) return res.status(400).json({ message: 'Enter a valid 10-digit Indian mobile number.' });
        if (isSuperadminPhone(phone)) return res.status(400).json({ message: 'This number is already a superadmin.' });
        let user = await User.findOne({ phone });
        const created = !user;
        if (!user) {
            user = new User({ phone, phoneVerified: false, username: `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, verificationStatus: 'verified', fullName: String(req.body?.fullName ?? '').trim().slice(0, 80) || undefined });
        }
        if (user.role === 'superadmin') return res.status(400).json({ message: 'This person is already a superadmin.' });
        if (user.role === 'subadmin') return res.status(200).json({ message: 'Already a sub-admin.', user: userView(user) });
        const before = { role: created ? null : user.role };
        user.role = 'subadmin';
        user.verificationStatus = 'verified';
        await user.save();
        if (before.role === 'companion') invalidateCompanionsCache();
        await notify(user._id, 'other', 'You’ve been made a prsnn sub-admin. Open Profile → Admin in the app.');
        await audit(req, 'admin.add', { kind: 'user', id: String(user._id) }, before, { role: 'subadmin', phone });
        res.status(created ? 201 : 200).json({ message: 'Sub-admin added.', user: userView(user) });
    } catch (err) {
        console.error('Add admin error:', err.message);
        res.status(500).json({ message: 'Could not add the sub-admin.' });
    }
};

/** DELETE /admins/:id — back to a member account. */
export const removeAdmin = async (req, res) => {
    try {
        if (!validId(req.params.id)) return res.status(404).json({ message: 'Admin not found.' });
        const user = await User.findById(req.params.id);
        if (!user || !['subadmin', 'admin'].includes(user.role)) return res.status(404).json({ message: 'Sub-admin not found.' });
        const before = { role: user.role };
        user.role = 'user';
        await user.save();
        await audit(req, 'admin.remove', { kind: 'user', id: String(user._id) }, before, { role: 'user' });
        res.status(200).json({ message: 'Sub-admin removed.', user: userView(user) });
    } catch (err) {
        console.error('Remove admin error:', err.message);
        res.status(500).json({ message: 'Could not remove the sub-admin.' });
    }
};

// ───────────────────────── Bookings ─────────────────────────

export const TAB_QUERY = {
    live: { status: { $in: ['pending', 'accepted'] } },
    refunds: { $or: [{ 'refundReview.needed': true }, { 'refund.status': { $in: ['pending', 'failed', 'processed'] } }] },
    done: { status: { $in: ['completed', 'cancelled', 'rejected'] } },
};

/** GET /bookings?tab=live|refunds|done&q= (q: booking ref, last 6 characters) */
export const listBookings = async (req, res) => {
    try {
        const tab = TAB_QUERY[req.query.tab] ? req.query.tab : 'live';
        const sort = tab === 'live' ? { scheduledDate: 1, startTime: 1 } : { updatedAt: -1 };
        const rows = await populated(Booking.find(TAB_QUERY[tab]).sort(sort).limit(150)).lean();
        const q = String(req.query.q ?? '').trim().toUpperCase();
        const list = q ? rows.filter((b) => ref(b).includes(q)) : rows;
        // Refunds tab: what needs a decision first.
        if (tab === 'refunds') {
            const rank = (b) => (b.refundReview?.needed ? 0 : b.refund?.status === 'failed' ? 1 : b.refund?.status === 'pending' ? 2 : 3);
            list.sort((a, b) => rank(a) - rank(b));
        }
        res.status(200).json(list.map((b) => bookingAdminView(b, req.user.role)));
    } catch (err) {
        console.error('List bookings error:', err.message);
        res.status(500).json({ message: 'Could not load bookings.' });
    }
};

/** GET /bookings/:id — the booking with offers, refund and dispute in full. */
export const getBooking = async (req, res) => {
    try {
        if (!validId(req.params.id)) return res.status(404).json({ message: 'Booking not found.' });
        const b = await populated(Booking.findById(req.params.id)).populate('offers.companionId', PERSON).lean();
        if (!b) return res.status(404).json({ message: 'Booking not found.' });
        res.status(200).json(bookingAdminView(b, req.user.role));
    } catch (err) {
        console.error('Get booking error:', err.message);
        res.status(500).json({ message: 'Could not load this booking.' });
    }
};

/**
 * GET /bookings/:id/messages — the chat, for disputes only (spec: "view chats
 * for disputes"). Reading it is logged.
 */
export const getBookingMessages = async (req, res) => {
    try {
        if (!validId(req.params.id)) return res.status(404).json({ message: 'Booking not found.' });
        const b = await Booking.findById(req.params.id).select('dispute').lean();
        if (!b) return res.status(404).json({ message: 'Booking not found.' });
        if (!b.dispute || b.dispute.status === 'none') return res.status(403).json({ message: 'Chats are only visible for bookings with a reported problem.' });
        const rows = await Message.find({ bookingId: b._id }).sort({ createdAt: 1 }).limit(500).populate('senderId', 'fullName role').lean();
        await audit(req, 'booking.read_chat', { kind: 'booking', id: String(b._id) });
        res.status(200).json(rows.map((m) => ({ _id: m._id, senderId: m.senderId?._id ?? m.senderId, senderName: m.senderId?.fullName ?? '', senderRole: m.senderId?.role, content: m.content, createdAt: m.createdAt })));
    } catch (err) {
        console.error('Admin messages error:', err.message);
        res.status(500).json({ message: 'Could not load the chat.' });
    }
};

/** PATCH /bookings/:id { scheduledDate?, startTime?, message?, city?, area?, status? } — no money fields. */
export const updateBooking = async (req, res) => {
    try {
        if (!validId(req.params.id)) return res.status(404).json({ message: 'Booking not found.' });
        const b = await Booking.findById(req.params.id);
        if (!b) return res.status(404).json({ message: 'Booking not found.' });
        const body = req.body ?? {};
        const before = {};
        const after = {};
        const set = (k, v) => {
            before[k] = b[k];
            b[k] = v;
            after[k] = v;
        };
        if (body.scheduledDate !== undefined) {
            if (!/^\d{4}-\d{2}-\d{2}/.test(String(body.scheduledDate))) return res.status(400).json({ message: 'Date must be YYYY-MM-DD.' });
            set('scheduledDate', new Date(`${String(body.scheduledDate).slice(0, 10)}T00:00:00.000Z`));
        }
        if (body.startTime !== undefined) {
            if (!HHMM.test(String(body.startTime))) return res.status(400).json({ message: 'Time must be HH:MM.' });
            if (!withinDay(body.startTime, b.duration)) return res.status(400).json({ message: `The session must fit between ${pricing().dayStart} and ${pricing().dayEnd}.` });
            set('startTime', body.startTime);
        }
        for (const k of ['message', 'city', 'area']) if (body[k] !== undefined) set(k, String(body[k]).slice(0, 300));
        if (body.status !== undefined) {
            // Marking a session completed is operational; cancelling goes through /cancel (refund rules).
            if (body.status !== 'completed') return res.status(400).json({ message: 'Use Cancel to cancel a booking. Status can only be set to completed here.' });
            if (b.status !== 'accepted') return res.status(400).json({ message: 'Only a confirmed booking can be marked completed.' });
            set('status', 'completed');
        }
        if (!Object.keys(after).length) return res.status(400).json({ message: 'Nothing to change.' });
        await b.save();
        await audit(req, 'booking.edit', { kind: 'booking', id: String(b._id) }, before, after);
        if (after.scheduledDate || after.startTime) {
            const msg = `Booking #${ref(b)} was rescheduled by prsnn support. Check the new time in the app.`;
            await notify(b.requesterId, 'other', msg);
            await notify(b.companionId, 'other', msg);
        }
        res.status(200).json({ message: 'Booking updated.', booking: bookingAdminView(b, req.user.role) });
    } catch (err) {
        console.error('Update booking error:', err.message);
        res.status(500).json({ message: 'Could not update the booking.' });
    }
};

/**
 * POST /bookings/:id/cancel { reason, refundAmount? }
 * Sub-admin: cancels, no money moves. A paid booking is flagged for a
 * superadmin's refund decision (Refunds tab).
 * Superadmin: may pass refundAmount (0 … amountPaid) to refund at once.
 */
export const cancelBooking = async (req, res) => {
    try {
        if (!validId(req.params.id)) return res.status(404).json({ message: 'Booking not found.' });
        const reason = String(req.body?.reason ?? '').trim();
        if (reason.length < 3) return res.status(400).json({ message: 'Give a short reason.' });
        const wantsRefund = req.body?.refundAmount !== undefined && req.body?.refundAmount !== null;
        if (wantsRefund && !isSuper(req)) return res.status(403).json({ message: 'Only a superadmin can refund.' });

        if (wantsRefund) {
            const current = await Booking.findById(req.params.id).select('amountPaid paymentStatus').lean();
            if (!current) return res.status(404).json({ message: 'Booking not found.' });
            const amt = rupees(req.body.refundAmount);
            const max = current.paymentStatus === 'paid' ? current.amountPaid : 0;
            if (!(amt >= 0 && amt <= max)) return res.status(400).json({ message: `Refund must be between ₹0 and ₹${max}.` });
        }

        const now = new Date();
        const b = await Booking.findOneAndUpdate(
            { _id: req.params.id, status: { $in: ['pending', 'accepted'] } },
            {
                $set: { status: 'cancelled', 'allocation.state': 'cancelled', cancelledBy: 'admin', cancelReason: reason.slice(0, 200), cancelledAt: now, 'offers.$[live].status': 'withdrawn' },
            },
            { new: true, arrayFilters: [{ 'live.status': 'offered' }] }
        );
        if (!b) return res.status(409).json({ message: 'This booking is already closed.' });
        // Request-flow bookings have no allocation; don't leave a stray state on them.
        if (b.flow !== 'prepaid') await Booking.updateOne({ _id: b._id }, { $unset: { 'allocation.state': '' } });

        let refund = 'none';
        let refundAmount = 0;
        if (b.paymentStatus === 'paid') {
            if (wantsRefund) {
                refundAmount = Math.min(rupees(req.body.refundAmount), b.amountPaid);
                refund = refundAmount > 0 ? await issueRefund(b._id, refundAmount, `Admin cancelled: ${reason}`.slice(0, 200)) : 'none';
                await Booking.updateOne({ _id: b._id }, { $set: { 'refund.retained': rupees(b.amountPaid - refundAmount), 'refundReview.needed': false } });
            } else {
                await Booking.updateOne({ _id: b._id }, { $set: { refundReview: { needed: true, note: reason.slice(0, 200), requestedBy: req.user.id, requestedAt: now } } });
            }
        }
        const msg = `Booking #${ref(b)} was cancelled by prsnn support.${refundAmount > 0 ? ` ₹${refundAmount} is being refunded.` : b.paymentStatus === 'paid' ? ' We’ll update you about the refund.' : ''}`;
        await notify(b.requesterId, 'booking_cancelled', msg);
        await notify(b.companionId, 'booking_cancelled', `Booking #${ref(b)} was cancelled by prsnn support.`);
        await audit(req, 'booking.cancel', { kind: 'booking', id: String(b._id) }, { status: 'open' }, { status: 'cancelled', reason, ...(wantsRefund ? { refundAmount, refund } : {}) });
        const fresh = await Booking.findById(b._id);
        res.status(200).json({ message: refundAmount > 0 ? `Cancelled. ₹${refundAmount} refund ${refund}.` : b.paymentStatus === 'paid' && !wantsRefund ? 'Cancelled. A superadmin will decide the refund.' : 'Cancelled.', booking: bookingAdminView(fresh ?? b, req.user.role), refund });
    } catch (err) {
        console.error('Admin cancel error:', err.message);
        res.status(500).json({ message: 'Could not cancel the booking.' });
    }
};

/**
 * POST /bookings/:id/reassign { companionId } — give the booking to another
 * verified companion. The amount paid and the 80/20 split don't change.
 */
export const reassignBooking = async (req, res) => {
    try {
        const { companionId } = req.body ?? {};
        if (!validId(req.params.id) || !validId(companionId)) return res.status(400).json({ message: 'Choose a companion.' });
        const [b, c] = await Promise.all([Booking.findById(req.params.id), User.findById(companionId).select('role verificationStatus suspended fullName').lean()]);
        if (!b) return res.status(404).json({ message: 'Booking not found.' });
        if (!['pending', 'accepted'].includes(b.status)) return res.status(409).json({ message: 'Only open bookings can be reassigned.' });
        if (!c || c.role !== 'companion' || c.verificationStatus !== 'verified' || c.suspended) return res.status(400).json({ message: 'That person isn’t an active verified companion.' });
        if (String(b.requesterId) === String(companionId)) return res.status(400).json({ message: 'The customer can’t be their own companion.' });
        if (b.flow === 'prepaid' && b.paymentStatus !== 'paid') return res.status(400).json({ message: 'This booking isn’t paid yet.' });

        const before = { companionId: b.companionId ? String(b.companionId) : null, status: b.status, allocationState: b.allocation?.state };
        const previous = b.companionId;
        b.companionId = companionId;
        if (b.flow === 'prepaid') {
            b.status = 'accepted';
            b.allocation = { ...(b.allocation?.toObject?.() ?? b.allocation ?? {}), state: 'assigned', assignedAt: new Date() };
            for (const o of b.offers ?? []) if (o.status === 'offered') o.status = 'withdrawn';
        }
        if (b.paymentStatus === 'paid') b.companionShare = companionShareOf(b.amountPaid);
        await b.save();
        await notify(companionId, 'booking_confirmed', `prsnn support assigned booking #${ref(b)} to you. Chat is open.`);
        if (previous && String(previous) !== String(companionId)) await notify(previous, 'booking_cancelled', `Booking #${ref(b)} was moved to another companion by prsnn support.`);
        await notify(b.requesterId, 'other', `Your booking #${ref(b)} now has a new companion: ${c.fullName ?? 'a verified companion'}.`);
        await audit(req, 'booking.reassign', { kind: 'booking', id: String(b._id) }, before, { companionId: String(companionId), status: b.status, allocationState: b.allocation?.state });
        res.status(200).json({ message: 'Booking reassigned.', booking: bookingAdminView(b, req.user.role) });
    } catch (err) {
        console.error('Reassign error:', err.message);
        res.status(500).json({ message: 'Could not reassign the booking.' });
    }
};

// ── Money (superadmin; guarded in the router) ──

/** POST /bookings/:id/refund { amount, reason } — full or partial, once per booking. */
export const refundBooking = async (req, res) => {
    try {
        if (!validId(req.params.id)) return res.status(404).json({ message: 'Booking not found.' });
        const b = await Booking.findById(req.params.id);
        if (!b) return res.status(404).json({ message: 'Booking not found.' });
        if (b.paymentStatus !== 'paid') return res.status(400).json({ message: 'Only a paid booking can be refunded.' });
        if (['pending', 'processed'].includes(b.refund?.status)) return res.status(409).json({ message: 'A refund has already been issued for this booking.' });
        const amount = rupees(req.body?.amount ?? b.amountPaid);
        if (!(amount > 0 && amount <= b.amountPaid)) return res.status(400).json({ message: `Refund must be more than ₹0 and at most ₹${b.amountPaid}.` });
        const reason = String(req.body?.reason ?? 'Refund by prsnn support').slice(0, 200);
        const result = await issueRefund(b._id, amount, reason);
        if (result === 'skipped') return res.status(409).json({ message: 'This booking changed just now. Refresh and try again.' });
        await Booking.updateOne({ _id: b._id }, { $set: { 'refund.retained': rupees(b.amountPaid - amount), 'refundReview.needed': false } });
        await notify(b.requesterId, 'refund', `Refund of ₹${amount} started for booking #${ref(b)}.`);
        await audit(req, 'booking.refund', { kind: 'booking', id: String(b._id) }, { refundStatus: b.refund?.status ?? 'none' }, { amount, reason, result });
        res.status(200).json({ message: result === 'failed' ? 'The payment provider refused the refund. Retry it from the Refunds tab.' : `Refund of ₹${amount} ${result}.`, result, booking: bookingAdminView(await Booking.findById(b._id), req.user.role) });
    } catch (err) {
        console.error('Admin refund error:', err.message);
        res.status(500).json({ message: 'Could not issue the refund.' });
    }
};

/** POST /bookings/:id/refund/retry — retry a failed refund with the same amount. */
export const retryRefund = async (req, res) => {
    try {
        if (!validId(req.params.id)) return res.status(404).json({ message: 'Booking not found.' });
        const b = await Booking.findById(req.params.id);
        if (!b) return res.status(404).json({ message: 'Booking not found.' });
        if (b.refund?.status !== 'failed') return res.status(400).json({ message: 'Only a failed refund can be retried.' });
        const result = await issueRefund(b._id, b.refund.amount, b.refund.reason || 'Retry by prsnn support');
        if (result === 'skipped') return res.status(409).json({ message: 'This refund can’t be retried any more (too many attempts). Refund it from the Razorpay dashboard.' });
        await audit(req, 'booking.refund_retry', { kind: 'booking', id: String(b._id) }, { refundStatus: 'failed', attempts: b.refund.attempts }, { result });
        res.status(200).json({ message: `Retry ${result}.`, result, booking: bookingAdminView(await Booking.findById(b._id), req.user.role) });
    } catch (err) {
        console.error('Retry refund error:', err.message);
        res.status(500).json({ message: 'Could not retry the refund.' });
    }
};

/**
 * POST /bookings/:id/mark-paid — record a payment taken outside the app
 * (simulated: no money moves through Razorpay). Runs the normal paid path, so a
 * prepaid booking starts offering companions.
 */
export const markBookingPaid = async (req, res) => {
    try {
        if (!validId(req.params.id)) return res.status(404).json({ message: 'Booking not found.' });
        const b = await Booking.findById(req.params.id);
        if (!b) return res.status(404).json({ message: 'Booking not found.' });
        if (b.paymentStatus === 'paid') return res.status(409).json({ message: 'Already paid.' });
        if (b.status === 'cancelled' || b.status === 'rejected') return res.status(400).json({ message: 'This booking is closed.' });
        const amount = b.packagePrice ?? Math.round(b.pricePerHour * ((parseInt(b.duration, 10) || 60) / 60));
        const { booking, alreadyPaid } = await markPaid(b._id, { paymentId: `admin_${Date.now()}`, amountRupees: amount, mode: 'simulated' });
        if (alreadyPaid) return res.status(409).json({ message: 'Already paid.' });
        await audit(req, 'booking.mark_paid', { kind: 'booking', id: String(b._id) }, { paymentStatus: b.paymentStatus }, { paymentStatus: 'paid', amount, mode: 'simulated' });
        res.status(200).json({ message: `Marked paid (₹${amount}, simulated).`, booking: bookingAdminView(booking ?? b, req.user.role) });
    } catch (err) {
        console.error('Mark paid error:', err.message);
        res.status(500).json({ message: 'Could not mark this booking paid.' });
    }
};

/**
 * POST /bookings/:id/cancellation-fee { retained } — override the fee kept on a
 * cancelled, paid booking before its refund goes out. Refunds amountPaid − retained.
 */
export const overrideCancellationFee = async (req, res) => {
    try {
        if (!validId(req.params.id)) return res.status(404).json({ message: 'Booking not found.' });
        const b = await Booking.findById(req.params.id);
        if (!b) return res.status(404).json({ message: 'Booking not found.' });
        if (b.status !== 'cancelled' || b.paymentStatus !== 'paid') return res.status(400).json({ message: 'Only a cancelled, paid booking has a cancellation fee.' });
        if (['pending', 'processed'].includes(b.refund?.status)) return res.status(409).json({ message: 'The refund has already gone out, so the fee can’t change.' });
        const retained = rupees(req.body?.retained);
        if (!(retained >= 0 && retained <= b.amountPaid)) return res.status(400).json({ message: `Fee must be between ₹0 and ₹${b.amountPaid}.` });
        const amount = rupees(b.amountPaid - retained);
        const result = amount > 0 ? await issueRefund(b._id, amount, `Cancellation fee set to ₹${retained} by prsnn support`) : 'none';
        await Booking.updateOne({ _id: b._id }, { $set: { 'refund.retained': retained, 'refundReview.needed': false } });
        if (amount > 0) await notify(b.requesterId, 'refund', `Refund of ₹${amount} started for booking #${ref(b)}.`);
        await audit(req, 'booking.override_fee', { kind: 'booking', id: String(b._id) }, { retained: b.refund?.retained ?? 0 }, { retained, refund: amount, result });
        res.status(200).json({ message: amount > 0 ? `Fee set to ₹${retained}. ₹${amount} refund ${result}.` : `Fee set to ₹${retained}. Nothing to refund.`, booking: bookingAdminView(await Booking.findById(b._id), req.user.role) });
    } catch (err) {
        console.error('Override fee error:', err.message);
        res.status(500).json({ message: 'Could not change the fee.' });
    }
};

/** DELETE /bookings/:id — remove a booking record. Refused while money is in flight. */
export const deleteBooking = async (req, res) => {
    try {
        if (!validId(req.params.id)) return res.status(404).json({ message: 'Booking not found.' });
        const b = await Booking.findById(req.params.id).lean();
        if (!b) return res.status(404).json({ message: 'Booking not found.' });
        if (b.paymentStatus === 'paid' && !['processed'].includes(b.refund?.status) && ['pending', 'accepted'].includes(b.status)) {
            return res.status(409).json({ message: 'This booking is paid and still open. Cancel and refund it first.' });
        }
        if (b.refund?.status === 'pending') return res.status(409).json({ message: 'A refund is still in progress.' });
        await Booking.deleteOne({ _id: b._id });
        await Message.deleteMany({ bookingId: b._id });
        await audit(req, 'booking.delete', { kind: 'booking', id: String(b._id) }, { status: b.status, paymentStatus: b.paymentStatus, amountPaid: b.amountPaid, requesterId: String(b.requesterId), companionId: b.companionId ? String(b.companionId) : null }, {});
        res.status(200).json({ message: 'Booking deleted.' });
    } catch (err) {
        console.error('Delete booking error:', err.message);
        res.status(500).json({ message: 'Could not delete the booking.' });
    }
};

// ───────────────────────── Disputes ─────────────────────────

/** GET /disputes?status=open|resolved */
export const listDisputes = async (req, res) => {
    try {
        const status = req.query.status === 'resolved' ? 'resolved' : 'open';
        const rows = await populated(Booking.find({ 'dispute.status': status }).sort({ 'dispute.openedAt': status === 'open' ? 1 : -1 }).limit(150)).populate('dispute.openedBy', 'fullName role').lean();
        res.status(200).json(rows.map((b) => bookingAdminView(b, req.user.role)));
    } catch (err) {
        console.error('List disputes error:', err.message);
        res.status(500).json({ message: 'Could not load disputes.' });
    }
};

/** POST /disputes/:id/reply { message, to?: 'both' | 'requester' | 'companion' } — :id is the booking. */
export const replyDispute = async (req, res) => {
    try {
        const message = String(req.body?.message ?? '').trim();
        if (message.length < 2) return res.status(400).json({ message: 'Write a reply.' });
        if (!validId(req.params.id)) return res.status(404).json({ message: 'Dispute not found.' });
        const b = await Booking.findById(req.params.id);
        if (!b || !b.dispute || b.dispute.status === 'none') return res.status(404).json({ message: 'Dispute not found.' });
        const to = ['requester', 'companion'].includes(req.body?.to) ? req.body.to : 'both';
        b.dispute.notes = [...(b.dispute.notes ?? []), { by: req.user.id, role: req.user.role, message: message.slice(0, 1000), at: new Date() }];
        await b.save();
        const text = `prsnn support about booking #${ref(b)}: ${message.slice(0, 400)}`;
        if (to !== 'companion') await notify(b.requesterId, 'dispute', text);
        if (to !== 'requester') await notify(b.companionId, 'dispute', text);
        await audit(req, 'dispute.reply', { kind: 'booking', id: String(b._id) }, undefined, { to, message: message.slice(0, 200) });
        res.status(200).json({ message: 'Reply sent.', booking: bookingAdminView(b, req.user.role) });
    } catch (err) {
        console.error('Dispute reply error:', err.message);
        res.status(500).json({ message: 'Could not send the reply.' });
    }
};

/** POST /disputes/:id/close { resolution } */
export const closeDispute = async (req, res) => {
    try {
        const resolution = String(req.body?.resolution ?? '').trim();
        if (resolution.length < 3) return res.status(400).json({ message: 'Write how it was resolved.' });
        if (!validId(req.params.id)) return res.status(404).json({ message: 'Dispute not found.' });
        const b = await Booking.findById(req.params.id);
        if (!b || b.dispute?.status !== 'open') return res.status(404).json({ message: 'No open dispute on this booking.' });
        b.dispute.status = 'resolved';
        b.dispute.resolution = resolution.slice(0, 1000);
        b.dispute.resolvedBy = req.user.id;
        b.dispute.resolvedAt = new Date();
        await b.save();
        const text = `Your report on booking #${ref(b)} is resolved: ${resolution.slice(0, 300)}`;
        await notify(b.requesterId, 'dispute', text);
        await notify(b.companionId, 'dispute', text);
        await audit(req, 'dispute.close', { kind: 'booking', id: String(b._id) }, { status: 'open' }, { status: 'resolved', resolution: resolution.slice(0, 200) });
        res.status(200).json({ message: 'Dispute closed.', booking: bookingAdminView(b, req.user.role) });
    } catch (err) {
        console.error('Close dispute error:', err.message);
        res.status(500).json({ message: 'Could not close the dispute.' });
    }
};

// ───────────────────────── Notifications (superadmin) ─────────────────────────

/** POST /notifications { userId, message } — one in-app notification to one person. */
export const createNotification = async (req, res) => {
    try {
        const { userId } = req.body ?? {};
        const message = String(req.body?.message ?? '').trim();
        if (!validId(userId) || message.length < 2) return res.status(400).json({ message: 'Choose a person and write a message.' });
        if (!(await User.exists({ _id: userId }))) return res.status(404).json({ message: 'User not found.' });
        const n = await Notification.create({ userId, type: 'other', message: message.slice(0, 500) });
        await audit(req, 'notification.create', { kind: 'notification', id: String(n._id) }, undefined, { userId: String(userId), message: message.slice(0, 200) });
        res.status(201).json(n);
    } catch (err) {
        console.error('Create notification error:', err.message);
        res.status(500).json({ message: 'Could not create the notification.' });
    }
};

/** DELETE /notifications/:id */
export const deleteNotification = async (req, res) => {
    try {
        if (!validId(req.params.id)) return res.status(404).json({ message: 'Notification not found.' });
        const n = await Notification.findByIdAndDelete(req.params.id).lean();
        if (!n) return res.status(404).json({ message: 'Notification not found.' });
        await audit(req, 'notification.delete', { kind: 'notification', id: String(n._id) }, { userId: String(n.userId), message: n.message }, {});
        res.status(200).json({ message: 'Notification deleted.' });
    } catch (err) {
        console.error('Delete notification error:', err.message);
        res.status(500).json({ message: 'Could not delete the notification.' });
    }
};

// ───────────────────────── Prices (superadmin) ─────────────────────────

/** PUT /settings/pricing { ...pricing, repriceUnpaid? } (mounted as /api/admin/settings/pricing) */
export const updatePricing = async (req, res) => {
    try {
        const { repriceUnpaid, ...input } = req.body ?? {};
        const r = await savePricing(input, req.user.id, { repriceUnpaid: repriceUnpaid === true });
        if (r.error) return res.status(400).json({ message: r.error });
        await audit(req, 'settings.pricing', { kind: 'settings', id: 'pricing' }, publicPricing(r.before), { ...publicPricing(r.after), ...(repriceUnpaid ? { repricedUnpaid: r.repriced } : {}) });
        res.status(200).json({ message: repriceUnpaid ? `Prices saved. ${r.repriced} unpaid booking${r.repriced === 1 ? '' : 's'} re-priced.` : 'Prices saved. New bookings use them now.', pricing: publicPricing(r.after), repriced: r.repriced });
    } catch (err) {
        console.error('Update pricing error:', err.message);
        res.status(500).json({ message: 'Could not save the prices.' });
    }
};

// ───────────────────────── Push broadcasts (superadmin) ─────────────────────────

export const AUDIENCE_QUERY = {
    members: { role: 'user', suspended: { $ne: true }, pushToken: { $type: 'string' } },
    companions: { role: 'companion', verificationStatus: 'verified', suspended: { $ne: true }, pushToken: { $type: 'string' } },
};

/** GET /broadcast/audience — how many devices each audience reaches (for the preview). */
export const broadcastAudience = async (req, res) => {
    try {
        const [members, companions] = await Promise.all([User.countDocuments(AUDIENCE_QUERY.members), User.countDocuments(AUDIENCE_QUERY.companions)]);
        res.status(200).json({ members, companions });
    } catch (err) {
        console.error('Audience error:', err.message);
        res.status(500).json({ message: 'Could not count the audience.' });
    }
};

/** POST /broadcast { audience: 'members' | 'companions', title, body } (mounted as /api/admin/broadcast) */
export const broadcast = async (req, res) => {
    try {
        const { audience } = req.body ?? {};
        const title = String(req.body?.title ?? '').trim();
        const body = String(req.body?.body ?? '').trim();
        if (!AUDIENCE_QUERY[audience]) return res.status(400).json({ message: 'Choose Members or Companions.' });
        if (title.length < 2 || title.length > 65) return res.status(400).json({ message: 'Title must be 2–65 characters.' });
        if (body.length < 2 || body.length > 240) return res.status(400).json({ message: 'Message must be 2–240 characters.' });

        const rows = await User.find(AUDIENCE_QUERY[audience]).select('pushToken').lean();
        const tokens = rows.map((r) => r.pushToken);
        const result = await sendPush(tokens, { title, body, data: { kind: 'broadcast' } });
        if (result.invalidTokens.length) await User.updateMany({ pushToken: { $in: result.invalidTokens } }, { $unset: { pushToken: '' } });
        const record = await Broadcast.create({ audience, title, body, sentBy: req.user.id, recipients: tokens.length, sent: result.sent, failed: result.failed, batches: result.batches });
        await audit(req, 'broadcast.send', { kind: 'broadcast', id: String(record._id) }, undefined, { audience, title, recipients: tokens.length, sent: result.sent, failed: result.failed });
        res.status(201).json({ message: tokens.length ? `Sent to ${result.sent} of ${tokens.length} devices.` : 'Nobody in this audience has notifications turned on yet.', broadcast: record });
    } catch (err) {
        console.error('Broadcast error:', err.message);
        res.status(500).json({ message: 'Could not send the broadcast.' });
    }
};

/** GET /broadcasts — latest 50. */
export const listBroadcasts = async (req, res) => {
    try {
        const rows = await Broadcast.find().sort({ createdAt: -1 }).limit(50).populate('sentBy', 'fullName').lean();
        res.status(200).json(rows);
    } catch (err) {
        console.error('List broadcasts error:', err.message);
        res.status(500).json({ message: 'Could not load past broadcasts.' });
    }
};

// ───────────────────────── Activity (superadmin) ─────────────────────────

/** GET /activity?before=<ISO date>&action=<prefix> — 50 at a time, newest first. */
export const listActivity = async (req, res) => {
    try {
        const query = {};
        if (req.query.before) {
            const d = new Date(String(req.query.before));
            if (!Number.isNaN(d.getTime())) query.at = { $lt: d };
        }
        if (req.query.action) query.action = new RegExp(`^${escapeRegex(String(req.query.action).slice(0, 40))}`);
        const rows = await AuditLog.find(query).sort({ at: -1 }).limit(50).populate('actorId', 'fullName phone').lean();
        res.status(200).json(
            rows.map((r) => ({ _id: r._id, action: r.action, role: r.role, actorId: r.actorId?._id ?? r.actorId, actorName: r.actorId?.fullName ?? '', target: r.target, before: r.before, after: r.after, at: r.at }))
        );
    } catch (err) {
        console.error('Activity error:', err.message);
        res.status(500).json({ message: 'Could not load the activity log.' });
    }
};
