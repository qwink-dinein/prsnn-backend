import crypto from 'crypto';
import User from '../models/User.js';
import { generateToken } from '../utils/token.js';
import { hashPassword, comparePassword } from '../utils/hash.js';
import { deliverOtp } from '../utils/otpDelivery.js';
import { generateCode, hashCode, normaliseIndianMobile, safeEqualHex, WEAK_PINS } from '../utils/phone.js';

/**
 * Phone login for the mobile app.
 *
 *   POST /api/auth/phone/send-otp   { phone, channel? }        → 200 { message, expiresIn }
 *   POST /api/auth/phone/verify-otp { phone, otp, role? }      → 200 { token, user, isNewUser }
 *   POST /api/auth/pin/set          { pin }        (auth)      → 200 { message }
 *   POST /api/auth/pin/login        { phone, pin }             → 200 { token, user }
 *
 * A first successful verify creates the account (role "user" or "companion").
 * Companions start as verificationStatus "not_submitted" and only become
 * bookable after onboarding + admin review, exactly like web sign-ups.
 */

export const OTP_TTL_MS = 5 * 60 * 1000;
export const RESEND_COOLDOWN_MS = 30 * 1000;
export const MAX_OTP_ATTEMPTS = 5;
export const MAX_PIN_ATTEMPTS = 5;
export const PIN_LOCK_MS = 15 * 60 * 1000;

/** Same shape the existing login/verify-email endpoints return, plus phone + hasPin. */
export function sessionUser(user) {
  const isVerified = user.role === 'superadmin' || user.verificationStatus === 'verified';
  return {
    id: user._id,
    email: user.email,
    username: user.username,
    role: user.role,
    is_verified: isVerified,
    verification_status: user.verificationStatus,
    wantsToBeFellow: user.role === 'companion',
    fullName: user.fullName || '',
    profilePhoto: user.profilePhotoUrl,
    phone: user.phone,
    hasPin: !!user.pinHash,
    gender: user.gender,
    seeGender: user.seeGender,
    profileVisibility: user.profileVisibility,
    city: user.city,
  };
}

const newUsername = () => `m${crypto.randomBytes(5).toString('hex')}`;

export const sendPhoneOtp = async (req, res) => {
  try {
    const phone = normaliseIndianMobile(req.body?.phone);
    if (!phone) return res.status(400).json({ message: 'Enter a valid 10-digit Indian mobile number.' });

    const user = await User.findOne({ phone });
    const prior = user ?? (await PendingOtp.get(phone));
    const now = Date.now();
    if (prior?.phoneOtpSentAt && now - new Date(prior.phoneOtpSentAt).getTime() < RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((RESEND_COOLDOWN_MS - (now - new Date(prior.phoneOtpSentAt).getTime())) / 1000);
      return res.status(429).json({ message: `Please wait ${wait} seconds before asking for a new code.` });
    }

    const code = generateCode();
    const sent = await deliverOtp(phone, code, { preferSms: req.body?.channel === 'sms' });
    if (!sent.ok) {
      if (sent.status === 429) return res.status(429).json({ message: 'Too many codes are being sent right now. Please try again in a minute.' });
      if (sent.status === 400) return res.status(400).json({ message: 'We couldn’t send a code to this number on WhatsApp. Try “Send by SMS instead”.' });
      return res.status(503).json({ message: 'We couldn’t send the code right now. Please try again.' });
    }

    // Store only an HMAC of the code. A pending (not yet verified) number gets a stub record
    // only on verify, so an unverified number never creates an account by itself.
    const otpFields = { phoneOtpHash: hashCode(phone, code), phoneOtpExpires: new Date(now + OTP_TTL_MS), phoneOtpAttempts: 0, phoneOtpSentAt: new Date(now) };
    if (user) {
      Object.assign(user, otpFields);
      await user.save();
    } else {
      await PendingOtp.set(phone, otpFields);
    }

    return res.status(200).json({ message: sent.channel === 'sms' ? 'Code sent by SMS.' : 'Code sent on WhatsApp.', channel: sent.channel, expiresIn: OTP_TTL_MS / 1000 });
  } catch (err) {
    console.error('sendPhoneOtp error:', err.message);
    return res.status(500).json({ message: 'Could not send the code. Please try again.' });
  }
};

export const verifyPhoneOtp = async (req, res) => {
  try {
    const phone = normaliseIndianMobile(req.body?.phone);
    const otp = String(req.body?.otp ?? '');
    if (!phone || !/^\d{6}$/.test(otp)) return res.status(400).json({ message: 'Enter the 6-digit code.' });

    let user = await User.findOne({ phone });
    const record = user ?? (await PendingOtp.get(phone));
    if (!record?.phoneOtpHash || !record.phoneOtpExpires) return res.status(400).json({ message: 'Ask for a new code first.' });
    if (new Date(record.phoneOtpExpires).getTime() < Date.now()) return res.status(400).json({ message: 'This code has expired. Ask for a new one.' });
    if ((record.phoneOtpAttempts ?? 0) >= MAX_OTP_ATTEMPTS) return res.status(429).json({ message: 'Too many wrong codes. Ask for a new one.' });

    if (!safeEqualHex(record.phoneOtpHash, hashCode(phone, otp))) {
      if (user) {
        user.phoneOtpAttempts = (user.phoneOtpAttempts ?? 0) + 1;
        await user.save();
      } else await PendingOtp.bump(phone);
      return res.status(400).json({ message: 'That code isn’t right. Check and try again.' });
    }

    let isNewUser = false;
    if (!user) {
      const role = req.body?.role === 'companion' ? 'companion' : 'user';
      user = new User({
        phone,
        phoneVerified: true,
        username: newUsername(),
        role,
        // Members are verified by their phone; companions still need ID review.
        verificationStatus: role === 'companion' ? 'not_submitted' : 'verified',
      });
      isNewUser = true;
      PendingOtp.clear(phone);
    }
    user.phoneVerified = true;
    user.phoneOtpHash = undefined;
    user.phoneOtpExpires = undefined;
    user.phoneOtpAttempts = 0;
    await user.save();

    const token = generateToken({ userId: user._id, role: user.role });
    return res.status(200).json({ token, user: sessionUser(user), isNewUser });
  } catch (err) {
    console.error('verifyPhoneOtp error:', err.message);
    return res.status(500).json({ message: 'Could not verify the code. Please try again.' });
  }
};

export const setPin = async (req, res) => {
  try {
    const pin = String(req.body?.pin ?? '');
    if (!/^\d{4}$/.test(pin)) return res.status(400).json({ message: 'PIN must be 4 digits.' });
    if (WEAK_PINS.has(pin)) return res.status(400).json({ message: 'That PIN is too easy to guess. Try another.' });

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'Account not found.' });
    if (!user.phone) return res.status(400).json({ message: 'Verify your mobile number before setting a PIN.' });

    user.pinHash = await hashPassword(pin);
    user.pinFailedAttempts = 0;
    user.pinLockedUntil = undefined;
    await user.save();
    return res.status(200).json({ message: 'PIN set.' });
  } catch (err) {
    console.error('setPin error:', err.message);
    return res.status(500).json({ message: 'Could not set your PIN.' });
  }
};

export const pinLogin = async (req, res) => {
  try {
    const phone = normaliseIndianMobile(req.body?.phone);
    const pin = String(req.body?.pin ?? '');
    if (!phone || !/^\d{4}$/.test(pin)) return res.status(400).json({ message: 'Enter your 4-digit PIN.' });

    const user = await User.findOne({ phone });
    // Same answer whether the number is unknown or has no PIN, so numbers can't be probed.
    if (!user?.pinHash) return res.status(401).json({ message: 'PIN login isn’t set up for this number. Log in with OTP.' });

    if (user.pinLockedUntil && new Date(user.pinLockedUntil).getTime() > Date.now()) {
      return res.status(429).json({ message: 'Too many wrong PINs. Log in with OTP or try again in 15 minutes.' });
    }

    const ok = await comparePassword(pin, user.pinHash);
    if (!ok) {
      user.pinFailedAttempts = (user.pinFailedAttempts ?? 0) + 1;
      if (user.pinFailedAttempts >= MAX_PIN_ATTEMPTS) {
        user.pinFailedAttempts = 0;
        user.pinLockedUntil = new Date(Date.now() + PIN_LOCK_MS);
      }
      await user.save();
      return res.status(401).json({ message: 'Incorrect PIN.' });
    }

    user.pinFailedAttempts = 0;
    user.pinLockedUntil = undefined;
    await user.save();
    const token = generateToken({ userId: user._id, role: user.role });
    return res.status(200).json({ token, user: sessionUser(user) });
  } catch (err) {
    console.error('pinLogin error:', err.message);
    return res.status(500).json({ message: 'Could not log you in.' });
  }
};

/**
 * Codes for numbers that don't have an account yet. Kept in memory for the
 * 5-minute code lifetime so an unverified number never creates a database row.
 * NOTE: per-process — with several server instances, move this to Redis
 * (same caveat as the companions cache in fellows.controller.js).
 */
const pending = new Map();
export const PendingOtp = {
  async set(phone, fields) {
    pending.set(phone, { ...fields });
    // Opportunistic cleanup so the map can't grow without bound.
    if (pending.size > 5000) for (const [k, v] of pending) if (new Date(v.phoneOtpExpires).getTime() < Date.now()) pending.delete(k);
  },
  async get(phone) {
    return pending.get(phone) ?? null;
  },
  async bump(phone) {
    const r = pending.get(phone);
    if (r) r.phoneOtpAttempts = (r.phoneOtpAttempts ?? 0) + 1;
  },
  clear(phone) {
    pending.delete(phone);
  },
  _reset() {
    pending.clear();
  },
};
