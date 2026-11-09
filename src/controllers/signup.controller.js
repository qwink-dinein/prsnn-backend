
import User from "../models/User.js";

import { hashPassword } from "../utils/hash.js";
import { sendEmail } from "../utils/sendEmail.js";

/**
 * Signup Controller
 * Creates a new account in MongoDB.
 */

export const signup = async (req, res) => {
  try {
    const { email: inputEmail, password, username, fullName, phoneNumber, role: inputRole } = req.body;

    if (!inputEmail || !password || !username) {
        return res.status(400).json({ message: "All fields are required" });
    }

    // Validate username length
    if (username.length < 5) {
        return res.status(400).json({ message: "Username must be at least 5 characters long" });
    }

    const email = inputEmail.toLowerCase();
    const role = inputRole === 'companion' ? 'companion' : 'user';

    // 1. Check if user exists (username or email)
    const existingUser = await User.findOne({
        $or: [
            { email: email },
            { username: username }
        ]
    });

    if (existingUser) {
        return res.status(400).json({ message: "An account with this email or username already exists" });
    }

    const hashed = await hashPassword(password);

    // 2. Create User
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const newUser = new User({
        email,
        username,
        fullName: fullName || '',
        phoneNumber: phoneNumber || '',
        password: hashed,
        role,
        verificationStatus: role === 'companion' ? 'pending' : 'verified',
        otp,
        otpExpires: Date.now() + 10 * 60 * 1000 // 10 minutes
    });

    await newUser.save();



    // 4. Send Verification Email (Async - Non-blocking but awaited for logging)
    console.log("Attempting to send verification email to:", newUser.email);
    const emailRes = await sendEmail({
        to: newUser.email,
        subject: "Verify your Email",
        text: `Your verification code is ${otp}`,
        html: `<p>Your verification code is <b>${otp}</b>. It expires in 10 minutes.</p>`
    });

    if (!emailRes.success) {
        console.error("Failed to send verification email:", emailRes.error);
        // Optional: delete user if email fails to allow retry? 
        // For now, just return error so user knows.
        return res.status(500).json({ 
            message: "User created but failed to send verification email. Please contact support or try logging in and requesting a new OTP.",
            error: emailRes.error,
            userId: newUser._id
        });
    } else {
        console.log("Verification email sent successfully");
        
        const { generateToken } = await import("../utils/token.js");
        const token = generateToken({ userId: newUser._id, role: newUser.role });

        res.status(201).json({ 
            message: "User created successfully. Please check your email for verification code.", 
            userId: newUser._id,
            token,
            user: {
                id: newUser._id,
                email: newUser.email,
                username: newUser.username,
                role: newUser.role,
                is_verified: newUser.verificationStatus === 'verified',
                verification_status: newUser.verificationStatus,
                wantsToBeFellow: newUser.role === 'companion',
                fullName: newUser.fullName || '',
                profilePhoto: newUser.profilePhotoUrl
            }
        });
    }
  } catch (err) {
    console.error("Signup error:", err);
    res.status(500).json({ message: "Internal server error during signup: " + err.message });
  }
};
