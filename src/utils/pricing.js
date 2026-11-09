/**
 * prsnn pricing: one price list for every companion (owner decision 2026-11-09).
 * Companions don't set their own rate; they choose which durations they offer.
 *
 * The anchors 1, 2, 4, 6 and 12 hours are the published packages. The hours in
 * between follow the same curve (+₹300 per extra hour up to 10 h, then +₹250),
 * so every longer booking has a lower effective hourly rate.
 * The app mirrors this table in src/domain/pricing.ts — keep them identical.
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

export const hoursOf = (duration) => (parseInt(duration, 10) || 60) / 60;

/** Package price in rupees for whole hours 1–12, else null. */
export function packagePriceFor(duration) {
    const h = hoursOf(duration);
    return Number.isInteger(h) && PACKAGE_PRICES[h] ? PACKAGE_PRICES[h] : null;
}

/** What the companion receives for a booking amount (rupees, rounded down to whole rupees). */
export const companionShareOf = (amount) => Math.floor(Number(amount) * (1 - PLATFORM_SHARE));

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

/** Durations a companion offers (older companions: the five headline packages). */
export const offeredHours = (companion) => (Array.isArray(companion?.packages) && companion.packages.length ? companion.packages : HEADLINE_HOURS);

/** Start ≥ 07:00 and end ≤ 22:00. `startTime` is "HH:MM". */
export function withinDay(startTime, duration) {
    const [h, m] = String(startTime).split(':').map(Number);
    const start = (h || 0) * 60 + (m || 0);
    return start >= DAY_START_MIN && start + (parseInt(duration, 10) || 60) <= DAY_END_MIN;
}
