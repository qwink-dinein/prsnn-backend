import express from 'express';
import { getAllCompanions, getCompanionById, searchCompanions } from '../controllers/fellows.controller.js';

import { optionalAuth } from '../middleware/auth.middleware.js';

const router = express.Router();

// Public, but the answer depends on who asks (gender preference, unlocked photos).

router.get('/', optionalAuth, getAllCompanions);
router.get('/search/:query', optionalAuth, searchCompanions);
router.get('/:id', optionalAuth, getCompanionById);

export default router;
