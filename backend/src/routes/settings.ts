import { Router } from 'express';
import { z } from 'zod';
import {
  getPublicEmbeddingSettings,
  getPublicLlmSettings,
  getPublicSearchSettings,
  getPublicWecomSettings,
  getSystemPromptSettings,
  updateEmbeddingSettings,
  updateLlmSettings,
  updateSearchSettings,
  updateWecomSettings,
  updateSystemPromptSettings,
  resetSystemPromptSettings
} from '../services/settingsService.js';
import { refreshWecomAibotConnection } from '../services/wecomAibotLongConnectionService.js';

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
  botId: z.string().optional(),
  corpId: z.string().optional(),
  secret: z.string().optional(),
  token: z.string().optional(),
  encodingAesKey: z.string().optional(),
  openKfid: z.string().optional()
});

const systemPromptSettingsSchema = z.object({
  prompt: z.string().trim().min(20).max(12000)
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

  const settings = updateWecomSettings(parsed.data);
  refreshWecomAibotConnection();
  res.json(settings);
});

router.get('/system-prompt', (_req, res) => {
  res.json(getSystemPromptSettings());
});

router.put('/system-prompt', (req, res) => {
  const parsed = systemPromptSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  res.json(updateSystemPromptSettings(parsed.data));
});

router.delete('/system-prompt', (_req, res) => {
  res.json(resetSystemPromptSettings());
});

export default router;
