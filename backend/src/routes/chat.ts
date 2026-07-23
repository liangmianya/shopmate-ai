import { Router } from 'express';
import { z } from 'zod';
import { handleChat, handleChatStream } from '../services/chatService.js';

const router = Router();

const chatSchema = z.object({
  message: z.string().min(1),
  conversationId: z.string().optional(),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string()
  })).optional()
});

router.post('/', async (req, res, next) => {
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    res.json(await handleChat(parsed.data.message, parsed.data.history ?? [], parsed.data.conversationId));
  } catch (error) {
    next(error);
  }
});

router.post('/stream', async (req, res) => {
  const parsed = chatSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const final = await handleChatStream(
      parsed.data.message,
      parsed.data.history ?? [],
      parsed.data.conversationId,
      (chunk) => send('chunk', { content: chunk })
    );

    send('done', final);
  } catch (error) {
    send('error', { message: error instanceof Error ? error.message : 'Stream failed' });
  } finally {
    res.end();
  }
});

export default router;
