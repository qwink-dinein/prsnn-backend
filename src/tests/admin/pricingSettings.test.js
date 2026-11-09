import { describe, it, expect, afterEach } from 'vitest';
import { DEFAULT_PRICING, PACKAGE_PRICES, applyPricing, companionShareOf, packagePriceFor, pricing, publicPricing, resetPricing, validatePricing, withinDay, offeredHours } from '../../utils/pricing.js';

afterEach(() => resetPricing());

describe('pricing defaults', () => {
  it('match the published packages and policy', () => {
    expect(DEFAULT_PRICING.packagePrices).toBe(PACKAGE_PRICES);
    expect(publicPricing()).toMatchObject({ platformShare: 0.2, cancellationFee: 0.15, cancellationCutoffMinutes: 15, offerMinMinutes: 15, offerMaxMinutes: 300, dayStart: '07:00', dayEnd: '22:00', headlineHours: [1, 2, 4, 6, 12] });
  });
});

describe('validatePricing', () => {
  it('accepts a partial update and keeps the rest', () => {
    const r = validatePricing({ packagePrices: { 1: 449 } });
    expect(r.error).toBeUndefined();
    expect(r.value.packagePrices[1]).toBe(449);
    expect(r.value.packagePrices[2]).toBe(699);
    expect(r.value.platformShare).toBe(0.2);
  });
  it('prices must rise with hours', () => {
    expect(validatePricing({ packagePrices: { 3: 650 } }).error).toMatch(/3 h .* must cost more than 2 h/);
  });
  it('per-hour price must fall', () => {
    expect(validatePricing({ packagePrices: { 2: 800 } }).error).toMatch(/less per hour/);
  });
  it('rejects nonsense values', () => {
    expect(validatePricing({ packagePrices: { 13: 5000 } }).error).toMatch(/Unknown package/);
    expect(validatePricing({ packagePrices: { 1: 399.5 } }).error).toMatch(/whole number/);
    expect(validatePricing({ platformShare: 0.9 }).error).toMatch(/platformShare/);
    expect(validatePricing({ cancellationFee: -1 }).error).toMatch(/cancellationFee/);
    expect(validatePricing({ offerMinMinutes: 60, offerMaxMinutes: 30 }).error).toMatch(/offerMaxMinutes/);
    expect(validatePricing({ dayStart: '7am' }).error).toMatch(/HH:MM/);
    expect(validatePricing({ dayStart: '21:30', dayEnd: '22:00' }).error).toMatch(/an hour after/);
    expect(validatePricing({ headlineHours: [] }).error).toMatch(/headline/);
    expect(validatePricing(null).error).toBeTruthy();
  });
  it('sorts and de-duplicates headline hours', () => {
    expect(validatePricing({ headlineHours: [4, 1, 4] }).value.headlineHours).toEqual([1, 4]);
  });
});

describe('applyPricing', () => {
  it('changes prices, split, day window and headline packages for new bookings', () => {
    const { value } = validatePricing({ packagePrices: { 1: 449 }, platformShare: 0.25, dayStart: '08:00', headlineHours: [1, 2] });
    applyPricing(value);
    expect(packagePriceFor('60')).toBe(449);
    expect(companionShareOf(400)).toBe(300);
    expect(withinDay('07:30', '60')).toBe(false);
    expect(withinDay('08:00', '60')).toBe(true);
    expect(offeredHours({})).toEqual([1, 2]);
    expect(pricing().packagePrices[12]).toBe(3599);
  });
});
