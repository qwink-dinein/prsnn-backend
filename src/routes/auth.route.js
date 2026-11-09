import express from "express";
import { signup } from "../controllers/signup.controller.js";
import { login } from "../controllers/login.controller.js";

import { upload } from "../middleware/upload.middleware.js";

import { sendVerificationOtp, verifyEmailOtp, forgotPassword, resetPassword } from "../controllers/verification.controller.js";

const router = express.Router();

router.post("/register", upload.single("verificationImage"), signup);
router.post("/login", login);

// Verification Routes
router.post("/verify-email", verifyEmailOtp);
router.post("/resend-otp", sendVerificationOtp);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

export default router;
