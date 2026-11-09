import { describe, it, expect } from 'vitest';
import { hashPassword, comparePassword } from '../../utils/hash.js';

describe('Hash Utilities', () => {
  it('should hash a password into a different string', async () => {
    const password = 'mySecretPassword123';
    const hash = await hashPassword(password);
    
    expect(hash).toBeDefined();
    expect(hash).not.toBe(password);
    expect(typeof hash).toBe('string');
  });

  it('should verify a correct password against its hash', async () => {
    const password = 'mySecretPassword123';
    const hash = await hashPassword(password);
    
    const isValid = await comparePassword(password, hash);
    expect(isValid).toBe(true);
  });

  it('should reject an incorrect password against a hash', async () => {
    const password = 'mySecretPassword123';
    const wrongPassword = 'wrongPassword456';
    const hash = await hashPassword(password);
    
    const isValid = await comparePassword(wrongPassword, hash);
    expect(isValid).toBe(false);
  });
});
