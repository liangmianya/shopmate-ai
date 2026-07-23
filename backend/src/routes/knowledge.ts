import { Router } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { db } from '../db/database.js';

const router = Router();
const now = () => new Date().toISOString();

const knowledgeItemSchema = z.object({
  question: z.string().min(1),
  answer: z.string().min(1),
  tags: z.array(z.string()).default([]),
  type: z.string().default('faq')
});

const createKnowledgeSchema = z.object({
  items: z.array(knowledgeItemSchema).min(1)
});

function mapKnowledgeRow(row: {
  id: string;
  type: string;
  title: string;
  content: string;
  tags: string;
  source: string;
  created_at: string;
}) {
  return {
    id: row.id,
    type: row.type,
    question: row.title,
    answer: row.content,
    tags: JSON.parse(row.tags || '[]') as string[],
    source: row.source,
    createdAt: row.created_at
  };
}

router.get('/', (_req, res) => {
  const rows = db
    .prepare('SELECT id, type, title, content, tags, source, created_at FROM knowledge_chunks ORDER BY created_at DESC')
    .all() as Array<{
      id: string;
      type: string;
      title: string;
      content: string;
      tags: string;
      source: string;
      created_at: string;
    }>;

  const chunks = rows.map(mapKnowledgeRow);

  res.json({ chunks });
});

router.post('/', (req, res) => {
  const parsed = createKnowledgeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const timestamp = now();
  const insert = db.prepare(`
    INSERT INTO knowledge_chunks (id, type, title, content, tags, source, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const created = parsed.data.items.map((item) => ({
    id: nanoid(),
    type: item.type,
    title: item.question.trim(),
    content: item.answer.trim(),
    tags: JSON.stringify(item.tags.map((tag) => tag.trim()).filter(Boolean)),
    source: 'manual',
    created_at: timestamp
  }));

  db.transaction(() => {
    for (const item of created) {
      insert.run(item.id, item.type, item.title, item.content, item.tags, item.source, item.created_at, timestamp);
    }
  })();

  res.status(201).json({ chunks: created.map(mapKnowledgeRow) });
});

export default router;
