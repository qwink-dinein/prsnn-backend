
import User from "../models/User.js";
import Admin from "../models/Admin.js"; // In case we need to verify admin specific logic
import { comparePassword } from "../utils/hash.js";
import { generateToken } from "../utils/token.js";

/**
 * Login Controller
 * Authenticates users using MongoDB only.
 */
export const login = async (req, res) => {
  try {
    // Never log req.body or `password` here — these logs are retained by the
    // host and forwarded to Sentry, which would expose live credentials.
    const { email: inputIdentifier, password } = req.body; // Can be email or username

    if (!inputIdentifier || !password) {
        return res.status(400).json({ message: "Email/Username and password are required" });
    }

    const identifier = inputIdentifier.toLowerCase();

    // 1. Find User by email OR username
    const user = await User.findOne({
        $or: [
            { email: identifier },
            { username: identifier }
        ]
    });

    if (!user) {
        return res.status(404).json({ message: "No account found with this email or username" });
    }

    // 2. Verify password
    const isMatch = await comparePassword(password, user.password);
    if (!isMatch) {
        return res.status(401).json({ message: "Invalid password" });
    }

    // 3. Check for Email Verification
    if (!user.isEmailVerified && user.role !== 'superadmin' && user.role !== 'admin') {
        // Generate and send new OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        user.otp = otp;
        user.otpExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
        await user.save();

        // Send verification email (async, non-blocking)
        const { sendEmail } = await import('../utils/sendEmail.js');
        sendEmail({
            to: user.email,
            subject: "Verify your Email - OTP Resent",
            text: `Your verification code is ${otp}. It expires in 10 minutes.`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #333;">Email Verification Required</h2>
                    <p>You attempted to log in, but your email is not verified yet.</p>
                    <p>Your verification code is:</p>
                    <h1 style="color: #572bf1; letter-spacing: 5px; text-align: center;">${otp}</h1>
                    <p style="color: #666; font-size: 14px;">This code expires in 10 minutes.</p>
                    <p>Please verify your email to continue.</p>
                </div>
            `
        }).catch(emailError => {
            console.error("Failed to send verification email:", emailError);
        });

        return res.status(403).json({ 
            message: "Email verification required. A new OTP has been sent to your email.",
            emailVerificationRequired: true,
            email: user.email
        });
    }

    // 3. Generate Token
    const token = generateToken({ 
        userId: user._id, 
        role: user.role 
    });

    // 4. Determine verification status
    // Super admins are verified by default
    const isVerified = user.role === 'superadmin' || user.verificationStatus === 'verified';

    return res.json({
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
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ message: "Internal server error: " + err.message });
  }
};
