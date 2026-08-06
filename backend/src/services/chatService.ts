import { nanoid } from 'nanoid';
import { db } from '../db/database.js';
import { classifyCustomerMessage, intentLabel } from './intentService.js';
import { generateCustomerAgentReply } from './customerAgentService.js';
import { calculateConfidence, searchKnowledgeBaseHybrid } from './ragService.js';
import type { ChatMessage, Emotion, Intent, KnowledgeChunk } from '../types.js';

const now = () => new Date().toISOString();
const MAX_SERVER_HISTORY_MESSAGES = 16;

function loadConversationHistory(conversationId: string, limit = MAX_SERVER_HISTORY_MESSAGES): ChatMessage[] {
  const rows = db.prepare(`
    SELECT role, content
    FROM messages
    WHERE conversation_id = ?
      AND role IN ('user', 'assistant')
      AND content IS NOT NULL
      AND trim(content) != ''
    ORDER BY created_at DESC, rowid DESC
    LIMIT ?
  `).all(conversationId, limit) as Array<{ role: ChatMessage['role']; content: string }>;

  return rows
    .reverse()
    .map((row) => ({
      role: row.role,
      content: row.content
    }));
}

function resolveHistory(history: ChatMessage[], conversationId?: string) {
  if (history.length || !conversationId) {
    return history;
  }

  return loadConversationHistory(conversationId);
}

function buildManualSummary(input: string, answer: string, intent: Intent, emotion: Emotion, matches: KnowledgeChunk[]) {
  return [
    `客户问题：${input}`,
    `识别意图：${intentLabel(intent)}`,
    `客户情绪：${emotion === 'negative' ? '负面' : emotion === 'positive' ? '正向' : '中性'}`,
    `已参考知识：${matches.map((item) => item.title).join('、') || '无'}`,
    `已回复内容：${answer}`,
    '建议处理：核实订单和商品状态，必要时要求客户补充照片或转售后专员确认。'
  ].join('\n');
}

function saveChatResult({
  input,
  answer,
  intent,
  emotion,
  matches,
  manualRequired,
  conversationId
}: {
  input: string;
  answer: string;
  intent: Intent;
  emotion: Emotion;
  matches: KnowledgeChunk[];
  manualRequired: boolean;
  conversationId?: string;
}) {
  const summary = manualRequired ? buildManualSummary(input, answer, intent, emotion, matches) : '';
  const id = conversationId || nanoid();
  const timestamp = now();

  const saveConversation = db.transaction(() => {
    const existing = db.prepare('SELECT id FROM conversations WHERE id = ?').get(id);

    if (!existing) {
      db.prepare(`
        INSERT INTO conversations (id, customer_id, channel, status, intent, emotion, manual_required, summary, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, 'guest', 'web', manualRequired ? 'manual_required' : 'active', intent, emotion, manualRequired ? 1 : 0, summary, timestamp, timestamp);
    } else {
      db.prepare(`
        UPDATE conversations
        SET status = ?, intent = ?, emotion = ?, manual_required = ?, summary = ?, updated_at = ?
        WHERE id = ?
      `).run(manualRequired ? 'manual_required' : 'active', intent, emotion, manualRequired ? 1 : 0, summary, timestamp, id);
    }

    db.prepare('INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(nanoid(), id, 'user', input, timestamp);
    db.prepare('INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(nanoid(), id, 'assistant', answer, timestamp);
  });

  saveConversation();

  return { id, summary };
}

async function prepareChat(input: string, history: ChatMessage[]) {
  const classification = await classifyCustomerMessage(input, history);
  const { intent, emotion } = classification;
  const matches = await searchKnowledgeBaseHybrid(input, intent, 5);
  const confidence = calculateConfidence(matches);
  const manualRequired = classification.manualRequired || confidence < 0.18;

  return {
    intent,
    emotion,
    matches,
    confidence,
    manualRequired
  };
}

export async function handleChat(input: string, history: ChatMessage[] = [], conversationId?: string) {
  const resolvedHistory = resolveHistory(history, conversationId);
  const { intent, emotion, matches, confidence, manualRequired } = await prepareChat(input, resolvedHistory);
  const agentReply = await generateCustomerAgentReply(input, resolvedHistory, intent, emotion, confidence);
  const answer = agentReply.answer;
  const saved = saveChatResult({ input, answer, intent, emotion, matches, manualRequired, conversationId });

  return {
    conversationId: saved.id,
    answer,
    intent,
    intentLabel: intentLabel(intent),
    emotion,
    confidence,
    manualRequired,
    manualSummary: saved.summary,
    retrieved: matches,
    answerSource: 'llm' as const,
    model: agentReply.model,
    fallbackReason: '',
    webSearchUsed: agentReply.webSources.length > 0,
    webSearchAttempted: agentReply.webSearchAttempted,
    webSearchQuery: agentReply.webSearchQuery,
    webSearchReason: agentReply.webSearchReason,
    webSearchScope: agentReply.webSearchAttempted ? 'external_public_info' : 'local_business_knowledge',
    webSearchRouteSource: 'agent',
    webSources: agentReply.webSources,
    webSearchError: agentReply.webSearchError,
    toolTrace: agentReply.toolTrace,
    history: resolvedHistory
  };
}

export async function handleChatStream(
  input: string,
  history: ChatMessage[] = [],
  conversationId: string | undefined,
  onChunk: (chunk: string) => void
) {
  const resolvedHistory = resolveHistory(history, conversationId);
  const { intent, emotion, matches, confidence, manualRequired } = await prepareChat(input, resolvedHistory);
  const agentReply = await generateCustomerAgentReply(input, resolvedHistory, intent, emotion, confidence);
  const answer = agentReply.answer;
  onChunk(answer);

  const saved = saveChatResult({ input, answer, intent, emotion, matches, manualRequired, conversationId });

  return {
    conversationId: saved.id,
    answer,
    intent,
    intentLabel: intentLabel(intent),
    emotion,
    confidence,
    manualRequired,
    manualSummary: saved.summary,
    retrieved: matches,
    answerSource: 'llm' as const,
    model: agentReply.model,
    fallbackReason: '',
    webSearchUsed: agentReply.webSources.length > 0,
    webSearchAttempted: agentReply.webSearchAttempted,
    webSearchQuery: agentReply.webSearchQuery,
    webSearchReason: agentReply.webSearchReason,
    webSearchScope: agentReply.webSearchAttempted ? 'external_public_info' : 'local_business_knowledge',
    webSearchRouteSource: 'agent',
    webSources: agentReply.webSources,
    webSearchError: agentReply.webSearchError,
    toolTrace: agentReply.toolTrace,
    history: resolvedHistory
  };
}
