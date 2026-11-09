
import User from "../models/User.js";
import { sendEmail } from "../utils/sendEmail.js";
import { hashPassword } from "../utils/hash.js";
import crypto from 'crypto';

// Generate a random 6-digit OTP
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Send Verification OTP (for email verification)
 */
export const sendVerificationOtp = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.isEmailVerified) {
      return res.status(400).json({ message: "Email is already verified" });
    }

    const otp = generateOTP();
    user.otp = otp;
    user.otpExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
    await user.save();

    console.log("Sending OTP email to:", user.email);
    const emailRes = await sendEmail({
      to: user.email,
      subject: "Verify your Email",
      text: `Your verification code is ${otp}`,
      html: `<p>Your verification code is <b>${otp}</b>. It expires in 10 minutes.</p>`
    });

    if (!emailRes.success) {
      console.error("Failed to send verification email:", emailRes.error);
      return res.status(500).json({ message: "Failed to send OTP email", error: emailRes.error });
    } else {
      console.log("Verification email sent successfully");
    }

    res.status(200).json({ message: "OTP sent to email" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error sending OTP" });
  }
};

/**
 * Verify Email OTP
 */
export const verifyEmailOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.otp !== otp || user.otpExpires < Date.now()) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    user.isEmailVerified = true;
    if (user.role === 'user') {
      user.verificationStatus = 'verified';
    }
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();

    const isVerified = user.role === 'superadmin' || user.role === 'user' || user.verificationStatus === 'verified';

    const { generateToken } = await import("../utils/token.js");
    const token = generateToken({ userId: user._id, role: user.role });

    res.status(200).json({ 
        message: "Email verified successfully",
        token,
        user: {
            id: user._id,
            email: user.email,
            username: user.username,
            role: user.role,
            is_verified: isVerified,
            verification_status: user.verificationStatus,
            wantsToBeFellow: user.role === 'companion',
            fullName: user.fullName || '',
            profilePhoto: user.profilePhotoUrl
        }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error verifying OTP" });
  }
};

/**
 * Forgot Password - Send OTP
 */
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
        // To prevent email enumeration, we might want to return 200 even if not found, 
        // strictly speaking. But for UX, we'll say not found or just generic message.
        return res.status(404).json({ message: "User with this email does not exist" });
    }

    const otp = generateOTP();
    user.otp = otp;
    user.otpExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
    await user.save();

    console.log("Sending password reset email to:", user.email);
    const emailRes = await sendEmail({
      to: user.email,
      subject: "Password Reset Request",
      text: `Your password reset code is ${otp}`,
      html: `<p>Your password reset code is <b>${otp}</b>. It expires in 10 minutes.</p>`
    });

    if (!emailRes.success) {
      console.error("Failed to send password reset email:", emailRes.error);
      return res.status(500).json({ message: "Failed to send password reset email", error: emailRes.error });
    } else {
      console.log("Password reset email sent successfully");
    }

    res.status(200).json({ message: "Password reset OTP sent to email" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error sending password reset OTP" });
  }
};

/**
 * Reset Password
 */
export const resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    
    if (!newPassword || newPassword.length < 6) {
        return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.otp !== otp || user.otpExpires < Date.now()) {
      return res.status(400).json({ message: "Invalid or expired OTP" });
    }

    const hashedPassword = await hashPassword(newPassword);
    user.password = hashedPassword;
    user.otp = undefined;
    user.otpExpires = undefined;
    await user.save();

    res.status(200).json({ message: "Password reset successfully" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error resetting password" });
  }
};
