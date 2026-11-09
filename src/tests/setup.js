import { vi } from 'vitest';

// Set up required environment variables
process.env.JWT_SECRET = 'test_secret_key_for_jwt';

// Mock dependencies globally that we don't want actually running in tests
vi.mock('../utils/sendEmail.js', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true })
}));
