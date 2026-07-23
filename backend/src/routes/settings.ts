import { Router } from 'express';
import { z } from 'zod';
import {
  getPublicEmbeddingSettings,
  getPublicLlmSettings,
  getPublicSearchSettings,
  getPublicWecomSettings,
  updateEmbeddingSettings,
  updateLlmSettings,
  updateSearchSettings,
  updateWecomSettings
} from '../services/settingsService.js';

const router = Router();

const llmSettingsSchema = z.object({
  baseUrl: z.string().url().optional(),
  model: z.string().min(1).optional(),
  apiKey: z.string().optional()
});

const searchSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  count: z.number().int().min(1).max(10).optional()
});

const wecomSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  corpId: z.string().optional(),
  secret: z.string().optional(),
  token: z.string().optional(),
  encodingAesKey: z.string().optional(),
  openKfid: z.string().optional()
});

router.get('/llm', (_req, res) => {
  res.json(getPublicLlmSettings());
});

router.put('/llm', (req, res) => {
  const parsed = llmSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  res.json(updateLlmSettings(parsed.data));
});

router.get('/embedding', (_req, res) => {
  res.json(getPublicEmbeddingSettings());
});

router.put('/embedding', (req, res) => {
  const parsed = llmSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  res.json(updateEmbeddingSettings(parsed.data));
});

router.get('/search', (_req, res) => {
  res.json(getPublicSearchSettings());
});

router.put('/search', (req, res) => {
  const parsed = searchSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  res.json(updateSearchSettings(parsed.data));
});

router.get('/wecom', (_req, res) => {
  res.json(getPublicWecomSettings());
});

router.put('/wecom', (req, res) => {
  const parsed = wecomSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  res.json(updateWecomSettings(parsed.data));
});

export default router;
