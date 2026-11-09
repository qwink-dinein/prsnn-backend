import mongoose from 'mongoose';
import Settings from '../models/Settings.js';
import Booking from '../models/Booking.js';
import { applyPricing, pricing, validatePricing } from '../utils/pricing.js';

/**
 * Loads the saved pricing (Settings key 'pricing') into utils/pricing.js.
 * Cached for 60 s so every request can call refreshPricing() cheaply and
 * several server instances converge within a minute of a change.
 */
export const PRICING_TTL_MS = 60 * 1000;
let loadedAt = 0;

export async function refreshPricing({ force = false } = {}) {
    if (!force && Date.now() - loadedAt < PRICING_TTL_MS) return pricing();
    // No database (unit tests, boot before connect): keep what we have.
    if (mongoose.connection?.readyState !== 1) return pricing();
    try {
        const doc = await Settings.findOne({ key: 'pricing' }).lean();
        if (doc?.value) {
            const checked = validatePricing(doc.value, pricing());
            if (checked.value) applyPricing(checked.value);
            else console.error('Saved pricing is invalid, keeping the current one:', checked.error);
        }
        loadedAt = Date.now();
    } catch (err) {
        console.error('Could not load pricing settings:', err.message);
    }
    return pricing();
}

/** Keep pricing fresh in the background (server.js). */
export function startPricingRefresh() {
    refreshPricing({ force: true });
    const t = setInterval(() => refreshPricing({ force: true }), PRICING_TTL_MS);
    t.unref?.();
    return t;
}

/**
 * Save a validated pricing update and apply it at once on this instance.
 * `repriceUnpaid` also moves prepaid bookings still awaiting payment to the
 * new package prices; paid and older bookings always keep their packagePrice.
 * @returns {{ before, after, repriced } | { error }}
 */
export async function savePricing(input, actorId, { repriceUnpaid = false } = {}) {
    const before = pricing();
    const checked = validatePricing(input, before);
    if (checked.error) return { error: checked.error };
    await Settings.findOneAndUpdate({ key: 'pricing' }, { $set: { value: checked.value, updatedBy: actorId } }, { upsert: true, new: true });
    const after = applyPricing(checked.value);
    loadedAt = Date.now();

    let repriced = 0;
    if (repriceUnpaid) {
        for (const [h, price] of Object.entries(after.packagePrices)) {
            const r = await Booking.updateMany(
                { flow: 'prepaid', 'allocation.state': 'awaiting_payment', paymentStatus: 'pending', duration: String(Number(h) * 60), packagePrice: { $ne: price } },
                { $set: { packagePrice: price } }
            );
            repriced += r?.modifiedCount ?? 0;
        }
    }
    return { before, after, repriced };
}
