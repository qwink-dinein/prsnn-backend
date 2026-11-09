import express from 'express';
import { getAllCompanions, getCompanionById, searchCompanions } from '../controllers/fellows.controller.js';

const router = express.Router();

router.get('/', getAllCompanions);
router.get('/:id', getCompanionById);
router.get('/search/:query', searchCompanions);

export default router;
