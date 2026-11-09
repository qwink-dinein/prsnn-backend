import express from 'express';
import { getPublicStats } from '../controllers/public.controller.js';

const router = express.Router();

router.get('/stats', getPublicStats);

export default router;
