import { describe, it, expect, vi, beforeEach } from 'vitest';
import { signup } from '../../controllers/signup.controller.js';
import User from '../../models/User.js';
import * as hashUtils from '../../utils/hash.js';
import * as sendEmailUtils from '../../utils/sendEmail.js';

// Mock dependencies
vi.mock('../../models/User.js', () => {
  const UserMock = function(data) {
    Object.assign(this, data || {});
    this.save = vi.fn().mockResolvedValue({ _id: 'newUserId123' });
  };
  UserMock.findOne = vi.fn();
  return { default: UserMock };
});
User.findOne = vi.fn();

vi.mock('../../utils/hash.js');
vi.mock('../../utils/sendEmail.js');

describe('Signup Controller', () => {
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

  it('should return 400 if fields are missing', async () => {
    req.body = { email: 'test@test.com', password: 'pwd' }; // missing username
    
    await signup(req, res);
    
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "All fields are required" });
  });

  it('should return 400 if username is too short', async () => {
    req.body = { email: 'test@test.com', password: 'pwd', username: 'abc' };
    
    await signup(req, res);
    
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining("Username must be at least 5 characters")
    }));
  });

  it('should return 400 if user already exists', async () => {
    req.body = { email: 'exists@test.com', password: 'password123', username: 'existinguser' };
    User.findOne.mockResolvedValue({ email: 'exists@test.com' });
    
    await signup(req, res);
    
    expect(User.findOne).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining("already exists")
    }));
  });

  it('should return 500 if email sending fails', async () => {
    req.body = { email: 'new@test.com', password: 'password123', username: 'newuser123' };
    User.findOne.mockResolvedValue(null);
    vi.spyOn(hashUtils, 'hashPassword').mockResolvedValue('hashedPassword');
    vi.spyOn(sendEmailUtils, 'sendEmail').mockResolvedValue({ success: false, error: 'SMTP Error' });
    
    await signup(req, res);
    
    expect(hashUtils.hashPassword).toHaveBeenCalledWith('password123');
    expect(sendEmailUtils.sendEmail).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining("failed to send verification email")
    }));
  });

  it('should return 201 on successful signup', async () => {
    req.body = { email: 'success@test.com', password: 'password123', username: 'successuser' };
    User.findOne.mockResolvedValue(null);
    vi.spyOn(hashUtils, 'hashPassword').mockResolvedValue('hashedPassword');
    vi.spyOn(sendEmailUtils, 'sendEmail').mockResolvedValue({ success: true });
    
    await signup(req, res);
    
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      message: expect.stringContaining("User created successfully")
    }));
  });
});
