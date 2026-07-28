import { db } from '../db/database.js';
import type { Intent, KnowledgeChunk, KnowledgeType } from '../types.js';
import { rankByEmbedding } from './embeddingService.js';

const intentKnowledgePriority: Record<Intent, KnowledgeType[]> = {
  product_query: ['product', 'faq', 'size'],
  size_recommendation: ['size', 'product', 'faq'],
  product_recommendation: ['product', 'size', 'faq'],
  after_sale: ['after_sale', 'faq'],
  logistics: ['after_sale', 'faq'],
  complaint: ['after_sale', 'faq', 'product'],
  manual_transfer: ['after_sale', 'faq'],
  operation_task: ['dialogue', 'faq', 'product']
};

function tokenize(text: string) {
  const normalized = text.toLowerCase();
  const words: string[] = [...(normalized.match(/[a-z0-9]+|[\u4e00-\u9fa5]{1,3}/g) ?? [])];
  const keywords = ['商品', '品牌', '类型', '规格', '尺寸', '尺码', '库存', '价格', '链接', '购买', '下单', '发货', '物流', '退货', '换货', '售后', '赔付'];
  for (const keyword of keywords) {
    if (normalized.includes(keyword)) {
      words.push(keyword);
    }
  }
  return words;
}

function scoreChunk(query: string, chunk: KnowledgeChunk, intent: Intent) {
  const queryTokens = tokenize(query);
  const haystack = `${chunk.title} ${chunk.content} ${chunk.tags.join(' ')}`;
  const haystackTokens = tokenize(haystack);
  const haystackSet = new Set(haystackTokens);
  const priorities: KnowledgeType[] = intentKnowledgePriority[intent];

  const overlap = queryTokens.reduce((sum, token) => sum + (haystackSet.has(token) ? 1 : 0), 0);
  const directHit = queryTokens.some((token) => token.length > 1 && haystack.includes(token)) ? 1.2 : 0;
  const typeBoost = priorities.includes(chunk.type)
    ? 1.4 - priorities.indexOf(chunk.type) * 0.2
    : 0.8;

  return (overlap + directHit) * typeBoost;
}

function loadKnowledgeChunks() {
  const knowledgeRows = db
    .prepare("SELECT id, type, title, content, tags, source FROM knowledge_chunks WHERE type != 'product'")
    .all() as Array<Omit<KnowledgeChunk, 'tags'> & { tags: string }>;

  const knowledgeChunks = knowledgeRows
    .map((row) => ({
      ...row,
      type: row.type as KnowledgeType,
      tags: JSON.parse(row.tags || '[]') as string[]
    }));

  const productRows = db
    .prepare('SELECT id, name, brand, category, price, stock, features, size_guide, target_users, scene, purchase_url FROM products')
    .all() as Array<{
      id: string;
      name: string;
      brand: string;
      category: string;
      price: number;
      stock: number;
      features: string;
      size_guide: string;
      target_users: string;
      scene: string;
      purchase_url: string;
    }>;

  const productChunks: KnowledgeChunk[] = productRows.map((product) => ({
    id: `product:${product.id}`,
    type: 'product',
    title: `${product.name} 商品资料`,
    content: [
      `商品名：${product.name}`,
      `品牌：${product.brand}`,
      `商品类型：${product.category}`,
      `价格：${product.price}`,
      `库存：${product.stock}`,
      `特性：${product.features}`,
      product.size_guide ? `尺码建议：${product.size_guide}` : '',
      product.target_users ? `适合人群：${product.target_users}` : '',
      product.scene ? `适用场景：${product.scene}` : '',
      product.purchase_url ? `购买链接：${product.purchase_url}` : ''
    ].filter(Boolean).join('；'),
    tags: [product.name, product.brand, product.category, product.scene].filter(Boolean),
    source: `product:${product.id}`
  }));

  return [...knowledgeChunks, ...productChunks];
}

export function searchKnowledgeBase(query: string, intent: Intent, topK = 5): KnowledgeChunk[] {
  return loadKnowledgeChunks()
    .map((chunk) => ({ ...chunk, score: scoreChunk(query, chunk, intent) }))
    .filter((chunk) => (chunk.score ?? 0) > 0)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, topK);
}

export async function searchKnowledgeBaseHybrid(query: string, intent: Intent, topK = 5): Promise<KnowledgeChunk[]> {
  const chunks = loadKnowledgeChunks();
  const keywordScored = chunks.map((chunk) => ({ ...chunk, score: scoreChunk(query, chunk, intent) }));

  try {
    const embeddingRanked = await rankByEmbedding(query, keywordScored);
    if (embeddingRanked) {
      return embeddingRanked
        .map((chunk) => {
          const keywordScore = chunk.score ?? 0;
          const embeddingScore = Math.max(0, chunk.embeddingScore);
          return {
            ...chunk,
            score: keywordScore + embeddingScore * 6
          };
        })
        .filter((chunk) => (chunk.score ?? 0) > 0.8)
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, topK);
    }
  } catch {
    return searchKnowledgeBase(query, intent, topK);
  }

  return searchKnowledgeBase(query, intent, topK);
}

export function calculateConfidence(matches: KnowledgeChunk[]) {
  if (matches.length === 0) {
    return 0.18;
  }

  const topScore = matches[0]?.score ?? 0;
  return Math.max(0.35, Math.min(0.96, topScore / 8));
}
