import { Router } from 'express';
import { z } from 'zod';
import {
  getManagedConversationMessages,
  listManagedConversations,
  releaseManagedConversation,
  sendManagedManualMessage,
  takeoverManagedConversation
} from '../services/conversationManagementService.js';

const router = Router();

const messageSchema = z.object({
  content: z.string().trim().min(1).max(2000)
});

router.get('/', (_req, res) => {
  res.json({ conversations: listManagedConversations() });
});

router.get('/:conversationId/messages', (req, res) => {
  try {
    res.json({ messages: getManagedConversationMessages(req.params.conversationId) });
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : 'Conversation not found' });
  }
});

router.post('/:conversationId/takeover', (req, res) => {
  try {
    res.json({ conversation: takeoverManagedConversation(req.params.conversationId) });
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : 'Conversation not found' });
  }
});

router.post('/:conversationId/release', (req, res) => {
  try {
    res.json({ conversation: releaseManagedConversation(req.params.conversationId) });
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : 'Conversation not found' });
  }
});

router.post('/:conversationId/messages', (req, res) => {
  const parsed = messageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    res.json(sendManagedManualMessage(req.params.conversationId, parsed.data.content));
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'Manual message failed' });
  }
});

export default router;
