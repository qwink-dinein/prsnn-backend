import User from '../models/User.js';
import Booking from '../models/Booking.js';
import { applyLock, escapeRegex, matchesSeeGender } from '../utils/privacy.js';
import { offeredHours } from '../utils/pricing.js';

/**
 * In-memory cache for the verified-companion listing (unfiltered).
 *
 * Viewer-specific rules (gender preference, locked photos) are applied AFTER
 * the cache, per request, so one viewer's view can never leak to another.
 *
 * NOTE: this is per-process. With more than one server instance the caches
 * diverge. Move to Redis before scaling out (see prssn-document R14).
 */
const companionsCache = new Map();
const CACHE_DURATION = 60 * 1000; // 1 minute

/**
 * Drop cached companion listings. Call on anything that changes who appears in
 * the list or what they look like (verification, onboarding, profile edits,
 * privacy changes, deletion).
 */
export const invalidateCompanionsCache = () => {
    companionsCache.clear();
};

const FIELDS = 'username profilePhotoUrl fullName description pricePerHour packages city area state tags availability startTime endTime gender profileVisibility';

/** Public shape used by web and app. Keeps the legacy snake_case keys the website reads. */
export function toPublicCompanion(f) {
    return {
        id: f._id,
        userId: f._id,
        username: f.username,
        profilePhoto: f.profilePhotoUrl,
        fullName: f.fullName,
        description: f.description,
        pricePerHour: f.pricePerHour,
        packages: offeredHours(f),
        city: f.city,
        area: f.area,
        state: f.state,
        gender: f.gender,
        tags: f.tags || [],
        availability: f.availability,
        monday_availability: f.availability?.monday,
        tuesday_availability: f.availability?.tuesday,
        wednesday_availability: f.availability?.wednesday,
        thursday_availability: f.availability?.thursday,
        friday_availability: f.availability?.friday,
        saturday_availability: f.availability?.saturday,
        sunday_availability: f.availability?.sunday,
        start_time: f.startTime,
        end_time: f.endTime,
        startTime: f.startTime,
        endTime: f.endTime,
    };
}

/** The viewer's gender preference: their saved choice, or ?see= for logged-out browsing. */
async function viewerOf(req) {
    if (req.user?.id) {
        const me = await User.findById(req.user.id).select('seeGender').lean();
        if (me) return { id: String(req.user.id), seeGender: me.seeGender };
    }
    const see = typeof req.query.see === 'string' ? req.query.see : undefined;
    return { id: null, seeGender: see };
}

/** Companions this viewer has a confirmed, paid booking with: their photos are unlocked. */
async function unlockedFor(viewerId) {
    if (!viewerId) return new Set();
    const rows = await Booking.find({ requesterId: viewerId, status: { $in: ['accepted', 'completed'] }, paymentStatus: 'paid' })
        .select('companionId')
        .lean();
    return new Set(rows.map((r) => String(r.companionId)));
}

function viewFor(list, viewer, unlocked) {
    return list
        .filter((c) => String(c._id) !== viewer.id)
        .filter((c) => matchesSeeGender(viewer.seeGender, c.gender))
        .map((c) => applyLock(toPublicCompanion(c), c, { unlocked: unlocked.has(String(c._id)) }));
}

/**
 * GET /api/companions — verified companions, filtered for the viewer.
 */
export const getAllCompanions = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 100, 200);
        const skip = (page - 1) * limit;
        const cityFilter = typeof req.query.city === 'string' && req.query.city.trim() ? req.query.city.trim().toLowerCase() : null;

        const cacheKey = `${page}:${limit}`;
        const now = Date.now();
        let rows = companionsCache.get(cacheKey);
        if (!rows || now - rows.timestamp >= CACHE_DURATION) {
            const data = await User.find({ role: 'companion', verificationStatus: 'verified' })
                .select(FIELDS)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean();
            rows = { data, timestamp: now };
            companionsCache.set(cacheKey, rows);
        }

        const viewer = await viewerOf(req);
        const unlocked = await unlockedFor(viewer.id);
        let list = viewFor(rows.data, viewer, unlocked);
        if (cityFilter) list = list.filter((c) => (c.city || '').toLowerCase() === cityFilter);
        res.status(200).json(list);
    } catch (error) {
        console.error('Error fetching companions:', error);
        res.status(500).json({ message: 'Server error fetching companions' });
    }
};

/**
 * GET /api/companions/:id
 */
export const getCompanionById = async (req, res) => {
    try {
        const user = await User.findById(req.params.id).select(`${FIELDS} verificationStatus role`).lean();
        if (!user || user.role !== 'companion' || user.verificationStatus !== 'verified') {
            return res.status(404).json({ message: 'Companion not found or not verified' });
        }
        const viewer = await viewerOf(req);
        // A direct link still respects the viewer's gender preference.
        if (String(user._id) !== viewer.id && !matchesSeeGender(viewer.seeGender, user.gender)) {
            return res.status(404).json({ message: 'Companion not found or not verified' });
        }
        const unlocked = String(user._id) === viewer.id || (await unlockedFor(viewer.id)).has(String(user._id));
        const out = applyLock(toPublicCompanion(user), user, { unlocked });
        res.status(200).json({ ...out, price_per_hour: out.pricePerHour });
    } catch (error) {
        console.error('Error fetching companion:', error);
        res.status(500).json({ message: 'Server error fetching companion' });
    }
};

/**
 * GET /api/companions/search/:query — name, description or tags.
 * User text is escaped before it becomes a RegExp.
 */
export const searchCompanions = async (req, res) => {
    try {
        const regex = new RegExp(escapeRegex(req.params.query), 'i');
        const companions = await User.find({
            role: 'companion',
            verificationStatus: 'verified',
            $or: [{ fullName: regex }, { username: regex }, { description: regex }, { tags: regex }, { area: regex }, { city: regex }],
        })
            .select(FIELDS)
            .sort({ createdAt: -1 })
            .limit(50)
            .lean();
        const viewer = await viewerOf(req);
        const unlocked = await unlockedFor(viewer.id);
        res.status(200).json(viewFor(companions, viewer, unlocked));
    } catch (error) {
        console.error('Error searching companions:', error);
        res.status(500).json({ message: 'Server error searching companions' });
    }
};
