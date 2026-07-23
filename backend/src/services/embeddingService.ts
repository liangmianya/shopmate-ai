import { db } from '../db/database.js';
import type { KnowledgeChunk } from '../types.js';
import { getEmbeddingSettings } from './settingsService.js';

type EmbeddingResponse = {
  data?: Array<{
    embedding?: number[];
  }>;
};

function buildChunkText(chunk: KnowledgeChunk) {
  return `${chunk.title}\n${chunk.content}\n标签：${chunk.tags.join('、')}`;
}

function cosineSimilarity(a: number[], b: number[]) {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }

  if (!normA || !normB) {
    return 0;
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function requestEmbeddings(input: string[]) {
  const settings = getEmbeddingSettings();
  if (!settings.apiKey) {
    return undefined;
  }

  const response = await fetch(`${settings.baseUrl.replace(/\/$/, '')}/embeddings`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: settings.model,
      input
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Embedding request failed: ${response.status}${detail ? ` ${detail.slice(0, 200)}` : ''}`);
  }

  const payload = (await response.json()) as EmbeddingResponse;
  const vectors = payload.data?.map((item) => item.embedding).filter((item): item is number[] => Array.isArray(item));

  if (!vectors || vectors.length !== input.length) {
    throw new Error('Embedding response count did not match input count');
  }

  return {
    model: settings.model,
    vectors
  };
}

function readStoredEmbedding(chunkId: string, model: string) {
  const row = db
    .prepare('SELECT vector FROM knowledge_embeddings WHERE chunk_id = ? AND model = ?')
    .get(chunkId, model) as { vector: string } | undefined;

  if (!row) {
    return undefined;
  }

  return JSON.parse(row.vector) as number[];
}

function writeStoredEmbedding(chunkId: string, model: string, vector: number[]) {
  db.prepare(`
    INSERT INTO knowledge_embeddings (chunk_id, model, vector, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(chunk_id) DO UPDATE SET model = excluded.model, vector = excluded.vector, updated_at = excluded.updated_at
  `).run(chunkId, model, JSON.stringify(vector), new Date().toISOString());
}

export async function rankByEmbedding(query: string, chunks: KnowledgeChunk[]) {
  const settings = getEmbeddingSettings();
  if (!settings.apiKey || chunks.length === 0) {
    return undefined;
  }

  const chunkVectors = new Map<string, number[]>();
  const missingChunks = chunks.filter((chunk) => {
    const stored = readStoredEmbedding(chunk.id, settings.model);
    if (stored) {
      chunkVectors.set(chunk.id, stored);
      return false;
    }
    return true;
  });

  if (missingChunks.length) {
    const generated = await requestEmbeddings(missingChunks.map(buildChunkText));
    if (!generated) {
      return undefined;
    }

    missingChunks.forEach((chunk, index) => {
      const vector = generated.vectors[index];
      writeStoredEmbedding(chunk.id, generated.model, vector);
      chunkVectors.set(chunk.id, vector);
    });
  }

  const queryResult = await requestEmbeddings([query]);
  const queryVector = queryResult?.vectors[0];
  if (!queryVector) {
    return undefined;
  }

  return chunks
    .map((chunk) => ({
      ...chunk,
      embeddingScore: cosineSimilarity(queryVector, chunkVectors.get(chunk.id) ?? [])
    }))
    .sort((a, b) => b.embeddingScore - a.embeddingScore);
}
