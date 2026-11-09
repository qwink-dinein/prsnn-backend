import { describe, it, expect } from 'vitest';
import { isSuperadminPhone, superadminPhones, syncSuperadmin } from '../../utils/superadmin.js';

const ENV = '98765 43210, +91 9123456789, junk, 12345';

describe('SUPERADMIN_PHONES', () => {
  it('parses 10-digit numbers in any format and ignores junk', () => {
    expect([...superadminPhones(ENV)]).toEqual(['9876543210', '9123456789']);
    expect(superadminPhones(undefined).size).toBe(0);
  });
  it('matches stored 91XXXXXXXXXX phones', () => {
    expect(isSuperadminPhone('919876543210', ENV)).toBe(true);
    expect(isSuperadminPhone('919999999999', ENV)).toBe(false);
    expect(isSuperadminPhone(undefined, ENV)).toBe(false);
  });
});

describe('syncSuperadmin', () => {
  it('promotes a listed phone on login', () => {
    const u = { phone: '919876543210', role: 'user', verificationStatus: 'not_submitted' };
    expect(syncSuperadmin(u, ENV)).toBe(true);
    expect(u).toMatchObject({ role: 'superadmin', superadminViaEnv: true, verificationStatus: 'verified' });
    expect(syncSuperadmin(u, ENV)).toBe(false);
  });
  it('demotes an env-promoted account once its number is removed', () => {
    const u = { phone: '919876543210', role: 'superadmin', superadminViaEnv: true };
    expect(syncSuperadmin(u, '')).toBe(true);
    expect(u.role).toBe('user');
  });
  it('leaves superadmins made another way, and everyone else, alone', () => {
    const web = { phone: '919000000000', role: 'superadmin' };
    expect(syncSuperadmin(web, ENV)).toBe(false);
    expect(web.role).toBe('superadmin');
    const sub = { phone: '919000000001', role: 'subadmin' };
    expect(syncSuperadmin(sub, ENV)).toBe(false);
    expect(syncSuperadmin({ role: 'user' }, ENV)).toBe(false);
  });
});
