import { describe, it, expect } from 'vitest';
import { maskPhoneNumber } from '../../utils/maskPhoneNumber.js';

describe('maskPhoneNumber', () => {
  it('returns input unchanged when null or empty', () => {
    expect(maskPhoneNumber('')).toBe('');
    expect(maskPhoneNumber(null)).toBe(null);
    expect(maskPhoneNumber(undefined)).toBe(undefined);
  });

  it('masks a bare 10-digit phone number', () => {
    expect(maskPhoneNumber('call me at 9876543210')).toBe('call me at ••••••••••');
  });

  it('masks 11+ digit sequences too', () => {
    expect(maskPhoneNumber('contact 919876543210')).toBe('contact ••••••••••');
  });

  it('does not mask sequences shorter than 10 digits', () => {
    expect(maskPhoneNumber('OTP is 123456')).toBe('OTP is 123456');
    expect(maskPhoneNumber('pin 999999999')).toBe('pin 999999999');
  });

  it('masks multiple phone numbers in same message', () => {
    const input = 'either 9876543210 or 8765432109';
    expect(maskPhoneNumber(input)).toBe('either •••••••••• or ••••••••••');
  });

  it('preserves non-digit content surrounding the digits', () => {
    expect(maskPhoneNumber('+91-9876543210 hi')).toBe('+91-•••••••••• hi');
  });
});
