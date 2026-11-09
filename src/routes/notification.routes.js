import express from 'express';
import { getNotifications, clearNotifications } from '../controllers/notification.controller.js';
import { authMiddleware } from '../middleware/auth.middleware.js';

const router = express.Router();

router.get('/', authMiddleware, getNotifications);
router.delete('/clear', authMiddleware, clearNotifications);

export default router;
