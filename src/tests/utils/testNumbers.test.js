import { describe, it, expect } from 'vitest';
import { testCodeFor, testNumbers } from '../../utils/testNumbers.js';

describe('OTP_TEST_NUMBERS', () => {
  const env = '90000 00000:111111, +919000000001:222222, 12345:000000, 9000000002:12';
  it('parses valid number:code pairs only', () => {
    expect([...testNumbers(env).entries()]).toEqual([['9000000000', '111111'], ['9000000001', '222222']]);
    expect(testNumbers(undefined).size).toBe(0);
  });
  it('matches stored 91XXXXXXXXXX numbers; real numbers get no code', () => {
    expect(testCodeFor('919000000001', env)).toBe('222222');
    expect(testCodeFor('919876543210', env)).toBeNull();
  });
});
