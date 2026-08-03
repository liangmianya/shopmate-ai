import { Router } from 'express';
import { z } from 'zod';
import { approveKnowledgeSuggestion, confirmHighRiskAgentTool, deleteKnowledgeSuggestion, listSuggestions, runAgentTask } from '../services/agentService.js';
import { listAgentSkills, saveImportedAgentSkill } from '../services/skillService.js';

const router = Router();

router.post('/tasks', async (req, res) => {
  const controller = new AbortController();
  const abortTask = () => {
    if (!res.writableEnded) {
      controller.abort();
    }
  };

  req.on('aborted', abortTask);
  res.on('close', abortTask);

  const schema = z.object({
    input: z.string().min(1),
    riskConfirmed: z.boolean().optional(),
    skillId: z.string().min(1).optional()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    req.off('aborted', abortTask);
    res.off('close', abortTask);
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const result = await runAgentTask(parsed.data.input, controller.signal, undefined, {
      riskConfirmed: parsed.data.riskConfirmed,
      skillId: parsed.data.skillId
    });
    if (!controller.signal.aborted && !res.headersSent) {
      res.json(result);
    }
  } catch (error) {
    if (!controller.signal.aborted && !res.headersSent) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Agent task failed' });
    }
  } finally {
    req.off('aborted', abortTask);
    res.off('close', abortTask);
  }
});

router.post('/tasks/stream', async (req, res) => {
  const controller = new AbortController();
  const abortTask = () => {
    if (!res.writableEnded) {
      controller.abort();
    }
  };

  req.on('aborted', abortTask);
  res.on('close', abortTask);

  const schema = z.object({
    input: z.string().min(1),
    riskConfirmed: z.boolean().optional(),
    skillId: z.string().min(1).optional()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    req.off('aborted', abortTask);
    res.off('close', abortTask);
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  let streamedContent = '';

  const send = (event: string, data: unknown) => {
    if (controller.signal.aborted || res.writableEnded) {
      return;
    }
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const sendSummaryIfNeeded = (summary: string) => {
    if (streamedContent.trim()) {
      return;
    }
    for (const match of summary.match(/[\s\S]{1,24}/g) ?? []) {
      streamedContent += match;
      send('chunk', { content: match });
    }
  };

  try {
    const result = await runAgentTask(parsed.data.input, controller.signal, {
      onChunk: (chunk) => {
        streamedContent += chunk;
        send('chunk', { content: chunk });
      },
      onTrace: (step) => send('trace', step),
      onToolResult: (toolResult) => send('tool', toolResult)
    }, {
      riskConfirmed: parsed.data.riskConfirmed,
      skillId: parsed.data.skillId
    });

    sendSummaryIfNeeded(result.summary);
    send('done', result);
  } catch (error) {
    if (!controller.signal.aborted) {
      send('error', { message: error instanceof Error ? error.message : 'Agent stream failed' });
    }
  } finally {
    req.off('aborted', abortTask);
    res.off('close', abortTask);
    res.end();
  }
});

router.get('/suggestions', (_req, res) => {
  res.json({ suggestions: listSuggestions() });
});

router.get('/skills', (_req, res) => {
  res.json({ skills: listAgentSkills() });
});

router.post('/skills', (req, res) => {
  const toolPolicySchema = z.object({
    preferred: z.array(z.string().min(1)).default([]),
    required: z.array(z.string().min(1)).default([]),
    forbidden: z.array(z.string().min(1)).default([])
  }).default({ preferred: [], required: [], forbidden: [] });

  const resourceSchema = z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    type: z.enum(['reference', 'template', 'checklist', 'example']),
    description: z.string().default(''),
    content: z.string().default('')
  });

  const outputContractSchema = z.object({
    format: z.enum(['markdown', 'table', 'json', 'mixed']).default('markdown'),
    requiredSections: z.array(z.string().min(1)).default([]),
    rules: z.array(z.string().min(1)).default([])
  }).default({
    format: 'markdown',
    requiredSections: [],
    rules: []
  });

  const scriptSchema = z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    description: z.string().default(''),
    command: z.string().default(''),
    enabled: z.boolean().default(false),
    risk: z.enum(['low', 'medium', 'high']).default('medium')
  });

  const schema = z.object({
    id: z.string().min(1).max(120).regex(/^[a-zA-Z0-9_-]+$/),
    name: z.string().min(1).max(80),
    description: z.string().min(1).max(300),
    version: z.string().min(1).max(40).optional(),
    instructions: z.string().min(1).max(12000),
    whenToUse: z.string().max(1000).optional(),
    inputPlaceholder: z.string().max(200).optional(),
    toolPolicy: toolPolicySchema.optional(),
    resources: z.array(resourceSchema).max(20).optional(),
    outputContract: outputContractSchema.optional(),
    scripts: z.array(scriptSchema).max(20).optional(),
    tags: z.array(z.string().min(1).max(24)).max(10).optional(),
    enabled: z.boolean().optional()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  res.json({ skill: saveImportedAgentSkill(parsed.data) });
});

router.post('/suggestions/:id/approve', (req, res) => {
  const result = approveKnowledgeSuggestion(req.params.id);
  if (!result) {
    res.status(404).json({ error: 'Suggestion not found' });
    return;
  }
  res.json(result);
});

router.delete('/suggestions/:id', (req, res) => {
  const result = deleteKnowledgeSuggestion(req.params.id);
  if (!result) {
    res.status(404).json({ error: 'Suggestion not found' });
    return;
  }
  res.json(result);
});

router.post('/tools/confirm', (req, res) => {
  const schema = z.object({
    toolName: z.enum(['delete_products', 'delete_knowledge_entries']),
    input: z.record(z.string(), z.unknown())
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    res.json(confirmHighRiskAgentTool(parsed.data.toolName, parsed.data.input));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Tool confirmation failed' });
  }
});

export default router;
