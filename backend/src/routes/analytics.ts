import { Router } from 'express';
import { z } from 'zod';
import { getOperationAnalytics } from '../services/operationAnalyticsService.js';

const router = Router();
const querySchema = z.object({
  days: z.coerce.number().int().refine((value) => value === 7 || value === 30).default(7)
});

router.get('/', (req, res) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'days must be 7 or 30' });
    return;
  }

  res.json(getOperationAnalytics(parsed.data.days));
});

export default router;
