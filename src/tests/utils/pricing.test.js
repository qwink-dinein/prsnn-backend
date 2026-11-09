import { describe, it, expect } from 'vitest';
import { PACKAGE_PRICES, cleanPackages, companionShareOf, offeredHours, packagePriceFor, withinDay } from '../../utils/pricing.js';

describe('fixed price list', () => {
  it('matches the published packages', () => {
    expect([1, 2, 4, 6, 12].map((h) => PACKAGE_PRICES[h])).toEqual([399, 699, 1299, 1899, 3599]);
  });
  it('every longer booking costs more in total and less per hour', () => {
    for (let h = 2; h <= 12; h++) {
      expect(PACKAGE_PRICES[h]).toBeGreaterThan(PACKAGE_PRICES[h - 1]);
      expect(PACKAGE_PRICES[h] / h).toBeLessThan(PACKAGE_PRICES[h - 1] / (h - 1));
    }
  });
  it('prices whole hours only', () => {
    expect(packagePriceFor('240')).toBe(1299);
    expect(packagePriceFor('90')).toBeNull();
    expect(packagePriceFor('780')).toBeNull();
  });
  it('companion gets 80%', () => {
    expect(companionShareOf(399)).toBe(319);
    expect(companionShareOf(3599)).toBe(2879);
  });
  it('cleans chosen packages; older companions offer the headline five', () => {
    expect(cleanPackages('[12, 1, 8, 8, 99]')).toEqual([1, 8, 12]);
    expect(cleanPackages('1,2,4')).toEqual([1, 2, 4]);
    expect(cleanPackages([])).toMatch(/at least one/);
    expect(offeredHours({})).toEqual([1, 2, 4, 6, 12]);
  });
  it('sessions fit 07:00–22:00', () => {
    expect(withinDay('07:00', '720')).toBe(true); // 07:00–19:00
    expect(withinDay('10:00', '720')).toBe(true); // ends exactly 22:00
    expect(withinDay('10:30', '720')).toBe(false);
    expect(withinDay('06:30', '60')).toBe(false);
  });
});
