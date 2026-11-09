import { describe, it, expect } from 'vitest';
import { generateToken } from '../../utils/token.js';
import jwt from 'jsonwebtoken';

describe('Token Utilities', () => {
  it('should generate a valid JWT token', () => {
    const payload = { userId: '12345', role: 'admin' };
    const token = generateToken(payload);
    
    expect(token).toBeDefined();
    expect(typeof token).toBe('string');
    
    // Verify the token can be decoded with the same secret
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    expect(decoded.userId).toBe(payload.userId);
    expect(decoded.role).toBe(payload.role);
    expect(decoded.exp).toBeDefined(); // expiresIn was set to 7d
  });
});
