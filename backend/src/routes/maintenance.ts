import { Router } from 'express';
import { z } from 'zod';
import {
  cleanupOrphanEmbeddings,
  clearAgentHistory,
  deleteConversationsByIds,
  deleteKnowledgeByIds,
  deleteProductsByIds,
  deleteSuggestionsByIds,
  factoryReset,
  getMaintenanceSummary
} from '../services/dataMaintenanceService.js';

const router = Router();
const idsSchema = z.object({ ids: z.array(z.string().trim().min(1)).min(1).max(1000) });
const resetSchema = z.object({
  scope: z.enum(['business', 'factory']),
  confirmed: z.literal(true)
});

router.get('/summary', (_req, res) => {
  res.json({ summary: getMaintenanceSummary() });
});

router.delete('/products', (req, res) => {
  const parsed = idsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  res.json(deleteProductsByIds(parsed.data.ids));
});

router.delete('/knowledge', (req, res) => {
  const parsed = idsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  res.json(deleteKnowledgeByIds(parsed.data.ids));
});

router.delete('/suggestions', (req, res) => {
  const parsed = idsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  res.json(deleteSuggestionsByIds(parsed.data.ids));
});

router.delete('/conversations', (req, res) => {
  const parsed = idsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  res.json(deleteConversationsByIds(parsed.data.ids));
});

router.delete('/agent-history', (_req, res) => {
  res.json(clearAgentHistory());
});

router.post('/cleanup-orphans', (_req, res) => {
  res.json(cleanupOrphanEmbeddings());
});

router.post('/factory-reset', (req, res) => {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  res.json(factoryReset(parsed.data.scope));
});

export default router;
