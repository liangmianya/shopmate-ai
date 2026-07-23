import { Router } from 'express';
import { z } from 'zod';
import { approveKnowledgeSuggestion, listSuggestions, runAgentTask } from '../services/agentService.js';

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

  const schema = z.object({ input: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    req.off('aborted', abortTask);
    res.off('close', abortTask);
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const result = await runAgentTask(parsed.data.input, controller.signal);
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

  const schema = z.object({ input: z.string().min(1) });
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

router.post('/suggestions/:id/approve', (req, res) => {
  const result = approveKnowledgeSuggestion(req.params.id);
  if (!result) {
    res.status(404).json({ error: 'Suggestion not found' });
    return;
  }
  res.json(result);
});

export default router;
