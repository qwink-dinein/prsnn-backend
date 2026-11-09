import express from 'express';
import { refreshPricing } from '../services/settings.js';
import { publicPricing } from '../utils/pricing.js';

const router = express.Router();

/** GET /api/settings/pricing — public; the app falls back to its bundled table. Cached 60 s. */
router.get('/pricing', async (req, res) => {
    try {
        const p = await refreshPricing();
        res.set('Cache-Control', 'public, max-age=60');
        res.status(200).json(publicPricing(p));
    } catch (err) {
        console.error('Get pricing error:', err.message);
        res.status(500).json({ message: 'Could not load prices.' });
    }
});

export default router;
