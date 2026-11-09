import { describe, it, expect, vi, beforeEach } from 'vitest';
import { login } from '../../controllers/login.controller.js';
import User from '../../models/User.js';
import * as hashUtils from '../../utils/hash.js';
import * as tokenUtils from '../../utils/token.js';
import * as sendEmailUtils from '../../utils/sendEmail.js';

// Mock dependencies
vi.mock('../../models/User.js');
vi.mock('../../utils/hash.js');
vi.mock('../../utils/token.js');
vi.mock('../../utils/sendEmail.js', () => ({
  sendEmail: vi.fn().mockResolvedValue({ success: true })
}));

describe('Login Controller', () => {
  let req;
  let res;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      body: {}
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn()
    };
  });

  it('should return 400 if email/username or password are missing', async () => {
    req.body = { email: 'test@test.com' }; // missing password
    
    await login(req, res);
    
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining('required')
    }));
  });

  it('should return 404 if user is not found', async () => {
    req.body = { email: 'notfound@test.com', password: 'password123' };
    User.findOne.mockResolvedValue(null);
    
    await login(req, res);
    
    expect(User.findOne).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: "No account found with this email or username" });
  });

  it('should return 401 if password does not match', async () => {
    req.body = { email: 'user@test.com', password: 'wrongPassword' };
    User.findOne.mockResolvedValue({ email: 'user@test.com', password: 'hashedPassword' });
    vi.spyOn(hashUtils, 'comparePassword').mockResolvedValue(false);
    
    await login(req, res);
    
    expect(hashUtils.comparePassword).toHaveBeenCalledWith('wrongPassword', 'hashedPassword');
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: "Invalid password" });
  });

  it('should return 403 and send OTP if email is not verified', async () => {
    req.body = { email: 'unverified@test.com', password: 'password123' };
    const mockUser = { 
      email: 'unverified@test.com', 
      password: 'hashedPassword', 
      isEmailVerified: false, 
      role: 'user',
      save: vi.fn().mockResolvedValue(true)
    };
    User.findOne.mockResolvedValue(mockUser);
    vi.spyOn(hashUtils, 'comparePassword').mockResolvedValue(true);
    
    await login(req, res);
    
    expect(mockUser.save).toHaveBeenCalled(); // Should save new OTP
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining("Email verification required"),
      emailVerificationRequired: true
    }));
  });

  it('should return 200 with token and user details on successful login', async () => {
    req.body = { email: 'verified@test.com', password: 'password123' };
    const mockUser = { 
      _id: 'userId123',
      email: 'verified@test.com', 
      username: 'verifieduser',
      password: 'hashedPassword', 
      isEmailVerified: true, 
      role: 'user',
      verificationStatus: 'verified'
    };
    
    User.findOne.mockResolvedValue(mockUser);
    vi.spyOn(hashUtils, 'comparePassword').mockResolvedValue(true);
    vi.spyOn(tokenUtils, 'generateToken').mockReturnValue('fake_jwt_token');
    
    await login(req, res);
    
    expect(tokenUtils.generateToken).toHaveBeenCalledWith({ userId: 'userId123', role: 'user' });
    expect(res.json).toHaveBeenCalledWith({
      token: 'fake_jwt_token',
      user: expect.objectContaining({
        id: 'userId123',
        email: 'verified@test.com',
        is_verified: true
      })
    });
  });
});
