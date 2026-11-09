import { describe, it, expect } from 'vitest';
import { applyIdentity, applyLock, defaultVisibilityFor, escapeRegex, matchesSeeGender } from '../../utils/privacy.js';

describe('gender matching', () => {
  it('shows only the chosen gender', () => {
    expect(matchesSeeGender('woman', 'woman')).toBe(true);
    expect(matchesSeeGender('woman', 'man')).toBe(false);
    expect(matchesSeeGender('nonbinary', 'woman')).toBe(false);
  });
  it('everyone / no preference sees all, including companions with no gender set', () => {
    expect(matchesSeeGender('everyone', 'man')).toBe(true);
    expect(matchesSeeGender(undefined, undefined)).toBe(true);
  });
  it('a companion without a gender only appears to "everyone"', () => {
    expect(matchesSeeGender('woman', undefined)).toBe(false);
  });
});

describe('profile lock', () => {
  const profile = { id: 'c1', fullName: 'Ayesha Khan', profilePhoto: 'https://img/a.jpg' };
  it('locked: no photo, first name only', () => {
    expect(applyLock(profile, { profileVisibility: 'locked' })).toMatchObject({ locked: true, profilePhoto: null, fullName: 'Ayesha' });
  });
  it('unlocked for a confirmed booking, and open profiles show everything', () => {
    expect(applyLock(profile, { profileVisibility: 'locked' }, { unlocked: true })).toMatchObject({ locked: false, profilePhoto: 'https://img/a.jpg' });
    expect(applyLock(profile, { profileVisibility: 'open' }).profilePhoto).toBe('https://img/a.jpg');
    expect(applyLock(profile, {}).locked).toBe(false); // older accounts
  });
  it('defaults: men open, women and non-binary locked', () => {
    expect(defaultVisibilityFor('man')).toBe('open');
    expect(defaultVisibilityFor('woman')).toBe('locked');
    expect(defaultVisibilityFor('nonbinary')).toBe('locked');
  });
});

describe('applyIdentity', () => {
  it('stores choices and records consent time', () => {
    const u = {};
    expect(applyIdentity(u, { gender: 'woman', seeGender: 'woman', profileVisibility: 'locked', visibilityConsent: 'true', state: 'Telangana' })).toBeNull();
    expect(u).toMatchObject({ gender: 'woman', seeGender: 'woman', profileVisibility: 'locked', state: 'Telangana' });
    expect(u.visibilityConsentAt).toBeInstanceOf(Date);
  });
  it('refuses visibility changes without consent and bad values', () => {
    expect(applyIdentity({}, { profileVisibility: 'open' })).toMatch(/confirm/);
    expect(applyIdentity({}, { gender: 'alien' })).toMatch(/woman, man/);
    expect(applyIdentity({}, { seeGender: 'x' })).toMatch(/everyone/);
  });
});

describe('escapeRegex', () => {
  it('neutralises regex syntax', () => {
    expect(new RegExp(escapeRegex('(a+)+$')).test('(a+)+$')).toBe(true);
    expect(() => new RegExp(escapeRegex('[unclosed'))).not.toThrow();
  });
});
