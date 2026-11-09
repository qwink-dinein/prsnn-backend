import express from 'express';
import { getProfile, checkProfile, onboardBasic, onboardCompanion, onboardAdmin, updateProfile } from '../controllers/profile.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { upload } from '../middleware/upload.middleware.js';

const router = express.Router();

router.get('/', authMiddleware, getProfile);
router.get('/check', authMiddleware, checkProfile);

// Basic user onboarding (non-companion)
router.post('/onboard-basic', authMiddleware, upload.fields([
    { name: 'profilePhoto', maxCount: 1 },
    { name: 'idProofFront', maxCount: 1 },
    { name: 'idProofBack', maxCount: 1 }
]), onboardBasic);

// Companion onboarding with front and back ID proof
router.post('/onboard-companion', authMiddleware, upload.fields([
    { name: 'profilePhoto', maxCount: 1 },
    { name: 'backupPhoto', maxCount: 1 },
    { name: 'idProofFront', maxCount: 1 },
    { name: 'idProofBack', maxCount: 1 }
]), onboardCompanion);

// Admin onboarding
router.post('/admin-onboard', authMiddleware, upload.fields([
    { name: 'photo', maxCount: 1 },
    { name: 'backupPhoto', maxCount: 1 },
    { name: 'adminVerificationDocument', maxCount: 1 }
]), onboardAdmin);

// Update profile
router.put('/update', authMiddleware, upload.fields([
    { name: 'profilePhoto', maxCount: 1 },
    { name: 'backupPhoto', maxCount: 1 },
    { name: 'photo', maxCount: 1 }
]), updateProfile);

export default router;
