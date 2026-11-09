import express from "express";
import rateLimit from "express-rate-limit";
import { signup } from "../controllers/signup.controller.js";
import { login } from "../controllers/login.controller.js";

import { upload } from "../middleware/upload.middleware.js";

import { sendVerificationOtp, verifyEmailOtp, forgotPassword, resetPassword } from "../controllers/verification.controller.js";
import { sendPhoneOtp, verifyPhoneOtp, setPin, pinLogin } from "../controllers/phoneAuth.controller.js";
import { authMiddleware } from "../middleware/auth.middleware.js";

const router = express.Router();

router.post("/register", upload.single("verificationImage"), signup);
router.post("/login", login);

// Verification Routes
router.post("/verify-email", verifyEmailOtp);
router.post("/resend-otp", sendVerificationOtp);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

// Phone login (mobile app). Tighter limits than the global 100/15 min: each send costs
// money (WhatsApp/SMS) and each verify/PIN try is a guess.
const otpSendLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 8, standardHeaders: true, legacyHeaders: false, message: { message: "Too many codes requested. Please try again in 15 minutes." } });
const guessLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false, message: { message: "Too many attempts. Please try again in 15 minutes." } });

router.post("/phone/send-otp", otpSendLimiter, sendPhoneOtp);
router.post("/phone/verify-otp", guessLimiter, verifyPhoneOtp);
router.post("/pin/set", authMiddleware, setPin);
router.post("/pin/login", guessLimiter, pinLogin);

export default router;
