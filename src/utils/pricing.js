/**
 * prsnn pricing: one price list for every companion (owner decision 2026-11-09).
 * Companions don't set their own rate; they choose which durations they offer.
 *
 * The values below are the DEFAULTS. A superadmin can change them in the app
 * (PUT /api/admin/settings/pricing); the saved copy lives in the Settings
 * collection under key 'pricing' and is applied here by services/settings.js.
 * Everything that prices, splits or times a booking reads `pricing()` so a
 * change takes effect for new bookings without a deploy. Existing bookings keep
 * their stored `packagePrice`.
 *
 * The anchors 1, 2, 4, 6 and 12 hours are the published packages. The hours in
 * between follow the same curve (+₹300 per extra hour up to 10 h, then +₹250),
 * so every longer booking has a lower effective hourly rate.
 * The app bundles the same defaults in src/domain/pricing.ts as its fallback.
 */
export const BASE_RATE = 399;

export const PACKAGE_PRICES = Object.freeze({
    1: 399,
    2: 699,
    3: 999,
    4: 1299,
    5: 1599,
    6: 1899,
    7: 2199,
    8: 2499,
    9: 2799,
    10: 3099,
    11: 3349,
    12: 3599,
});

/** The five headline packages shown first to customers. */
export const HEADLINE_HOURS = [1, 2, 4, 6, 12];
export const ALL_HOURS = Object.keys(PACKAGE_PRICES).map(Number);

/** prsnn keeps 20% of each completed booking; the companion receives 80%. */
export const PLATFORM_SHARE = 0.2;
/** Customer cancellation (15+ minutes before the start): 85% refunded, 15% retained. */
export const CANCELLATION_FEE = 0.15;
export const CANCELLATION_CUTOFF_MINUTES = 15;

/** Sessions run inside 07:00–22:00 (IST). */
export const DAY_START_MIN = 7 * 60;
export const DAY_END_MIN = 22 * 60;

export const DEFAULT_PRICING = Object.freeze({
    packagePrices: PACKAGE_PRICES,
    platformShare: PLATFORM_SHARE,
    cancellationFee: CANCELLATION_FEE,
    cancellationCutoffMinutes: CANCELLATION_CUTOFF_MINUTES,
    offerMinMinutes: Number(process.env.OFFER_MIN_MINUTES) || 15,
    offerMaxMinutes: Number(process.env.OFFER_MAX_MINUTES) || 300,
    dayStart: '07:00',
    dayEnd: '22:00',
    headlineHours: HEADLINE_HOURS,
});

let current = DEFAULT_PRICING;

/** The pricing in force right now (defaults until a saved copy is applied). */
export const pricing = () => current;

/** Replace the pricing in force. Input must already be validated. */
export function applyPricing(value) {
    current = Object.freeze({ ...DEFAULT_PRICING, ...value, packagePrices: Object.freeze({ ...(value?.packagePrices ?? DEFAULT_PRICING.packagePrices) }) });
    return current;
}

/** Back to the defaults (tests). */
export const resetPricing = () => {
    current = DEFAULT_PRICING;
};

const toMin = (hhmm) => {
    const [h, m] = String(hhmm).split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
};
export const dayStartMin = () => toMin(current.dayStart);
export const dayEndMin = () => toMin(current.dayEnd);

export const hoursOf = (duration) => (parseInt(duration, 10) || 60) / 60;

/** Package price in rupees for whole hours 1–12, else null. */
export function packagePriceFor(duration) {
    const h = hoursOf(duration);
    return Number.isInteger(h) && current.packagePrices[h] ? current.packagePrices[h] : null;
}

/** What the companion receives for a booking amount (rupees, rounded down to whole rupees). */
export const companionShareOf = (amount) => Math.floor(Number(amount) * (1 - current.platformShare));

/** Validates a companion's chosen hours. Returns a clean sorted list or an error string. */
export function cleanPackages(input) {
    let list = input;
    if (typeof list === 'string') {
        try {
            list = JSON.parse(list);
        } catch {
            list = list.split(',');
        }
    }
    if (!Array.isArray(list)) return 'Choose at least one duration you offer.';
    const hours = [...new Set(list.map((x) => parseInt(x, 10)).filter((h) => PACKAGE_PRICES[h]))].sort((a, b) => a - b);
    if (!hours.length) return 'Choose at least one duration you offer.';
    return hours;
}

/** Durations a companion offers (older companions: the headline packages). */
export const offeredHours = (companion) => (Array.isArray(companion?.packages) && companion.packages.length ? companion.packages : current.headlineHours);

/** Start ≥ dayStart and end ≤ dayEnd. `startTime` is "HH:MM". */
export function withinDay(startTime, duration) {
    const start = toMin(startTime);
    return start >= dayStartMin() && start + (parseInt(duration, 10) || 60) <= dayEndMin();
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const FIELDS = ['platformShare', 'cancellationFee', 'cancellationCutoffMinutes', 'offerMinMinutes', 'offerMaxMinutes', 'dayStart', 'dayEnd', 'headlineHours'];

/**
 * Validate a pricing update (partial allowed: missing fields keep `base`).
 * Rules: a price for every hour 1–12 in whole rupees; each longer package costs
 * more in total and less per hour; shares and fees are fractions; the day
 * window and offer window make sense.
 * @returns {{ value: object } | { error: string }}
 */
export function validatePricing(input, base = current) {
    if (!input || typeof input !== 'object') return { error: 'Send the pricing settings.' };
    const v = { ...base, packagePrices: { ...base.packagePrices } };
    for (const k of FIELDS) if (input[k] !== undefined) v[k] = input[k];
    if (input.packagePrices !== undefined) {
        if (!input.packagePrices || typeof input.packagePrices !== 'object') return { error: 'packagePrices must be an object of hours → rupees.' };
        for (const [k, price] of Object.entries(input.packagePrices)) {
            const h = Number(k);
            if (!ALL_HOURS.includes(h)) return { error: `Unknown package: ${k} hours. Use 1–12.` };
            const n = Number(price);
            if (!Number.isInteger(n) || n < 1 || n > 100000) return { error: `Price for ${h} h must be a whole number of rupees between 1 and 100000.` };
            v.packagePrices[h] = n;
        }
    }
    for (let h = 2; h <= 12; h++) {
        const a = v.packagePrices[h - 1];
        const b = v.packagePrices[h];
        if (!(b > a)) return { error: `${h} h (₹${b}) must cost more than ${h - 1} h (₹${a}).` };
        if (!(b / h < a / (h - 1))) return { error: `${h} h must cost less per hour than ${h - 1} h (₹${Math.round(b / h)}/h vs ₹${Math.round(a / (h - 1))}/h).` };
    }
    const frac = (x, max) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= max;
    if (!frac(v.platformShare, 0.5)) return { error: 'platformShare must be between 0 and 0.5.' };
    if (!frac(v.cancellationFee, 1)) return { error: 'cancellationFee must be between 0 and 1.' };
    const int = (x, lo, hi) => Number.isInteger(x) && x >= lo && x <= hi;
    if (!int(v.cancellationCutoffMinutes, 0, 24 * 60)) return { error: 'cancellationCutoffMinutes must be 0–1440.' };
    if (!int(v.offerMinMinutes, 5, 24 * 60)) return { error: 'offerMinMinutes must be 5–1440.' };
    if (!int(v.offerMaxMinutes, v.offerMinMinutes, 24 * 60)) return { error: 'offerMaxMinutes must be at least offerMinMinutes and at most 1440.' };
    if (!HHMM.test(String(v.dayStart)) || !HHMM.test(String(v.dayEnd))) return { error: 'dayStart and dayEnd must be HH:MM.' };
    if (toMin(v.dayEnd) - toMin(v.dayStart) < 60) return { error: 'dayEnd must be at least an hour after dayStart.' };
    if (!Array.isArray(v.headlineHours) || !v.headlineHours.length) return { error: 'Choose at least one headline package.' };
    const hl = [...new Set(v.headlineHours.map(Number))].sort((a, b) => a - b);
    if (hl.some((h) => !ALL_HOURS.includes(h))) return { error: 'headlineHours must be between 1 and 12.' };
    v.headlineHours = hl;
    return { value: v };
}

/** The public shape (GET /api/settings/pricing). */
export const publicPricing = (p = current) => ({
    packagePrices: p.packagePrices,
    platformShare: p.platformShare,
    cancellationFee: p.cancellationFee,
    cancellationCutoffMinutes: p.cancellationCutoffMinutes,
    offerMinMinutes: p.offerMinMinutes,
    offerMaxMinutes: p.offerMaxMinutes,
    dayStart: p.dayStart,
    dayEnd: p.dayEnd,
    headlineHours: p.headlineHours,
});
