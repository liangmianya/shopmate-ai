import { nanoid } from 'nanoid';
import { db } from '../db/database.js';
import { detectEmotion, detectIntent, intentLabel } from './intentService.js';
import { generateCustomerReply, streamCustomerReply } from './llmService.js';
import { getLlmSettings } from './settingsService.js';
import { calculateConfidence, searchKnowledgeBaseHybrid } from './ragService.js';
import { routeWebSearch, validateWebSearchResults } from './searchRouterService.js';
import { searchWeb, type WebSource } from './webSearchService.js';
import type { ChatMessage, Emotion, Intent, KnowledgeChunk } from '../types.js';

const now = () => new Date().toISOString();

function buildAnswer(input: string, intent: Intent, emotion: Emotion, matches: KnowledgeChunk[], confidence: number) {
  if (matches.length === 0 || confidence < 0.34) {
    return '按一般跑步装备选择思路，我可以先给你一个参考：如果是日常慢跑，优先看缓震、稳定和尺码舒适度；如果是比赛或速度训练，再考虑更轻、更弹的竞速款。你也可以补充预算、跑步距离、脚型和当前配速，我再帮你缩小选择。';
  }

  const facts = matches.slice(0, 3).map((item) => item.content);

  if (intent === 'complaint') {
    return `理解你的着急，我先帮你按售后流程处理。${facts.join(' ')} 建议你补充订单号和清晰照片，我会把当前情况生成转人工摘要，方便人工客服继续核实。`;
  }

  if (intent === 'after_sale') {
    return `${facts.join(' ')} 如果你的情况涉及质量问题，建议先准备订单号和清晰照片，这样处理会更快。`;
  }

  if (intent === 'size_recommendation') {
    return `${facts.join(' ')} 结合你的描述，尺码选择应优先保证前掌不挤压，并为长距离跑预留脚趾活动空间。`;
  }

  if (intent === 'product_recommendation') {
    return `${facts.join(' ')} 如果你更重视比赛速度，可以优先看竞速鞋；如果日常训练或膝盖敏感，更建议选择缓震训练鞋。`;
  }

  if (emotion === 'negative') {
    return `我理解你的顾虑。${facts.join(' ')} 你可以把具体情况再说细一点，我会先按现有规则帮你判断下一步怎么处理。`;
  }

  return facts.join(' ');
}

function shouldTransfer(intent: Intent, emotion: Emotion, confidence: number, input: string) {
  const explicitManual = ['人工', '转人工', '转接', '真人', '客服接'];
  const highRiskAfterSale = ['投诉', '赔偿', '赔付', '质量问题', '开胶', '断底', '严重脱线', '假货'];
  const unresolvedComplaint = emotion === 'negative' && highRiskAfterSale.some((word) => input.includes(word));

  return (
    intent === 'complaint' ||
    intent === 'manual_transfer' ||
    explicitManual.some((word) => input.includes(word)) ||
    unresolvedComplaint ||
    confidence < 0.18
  );
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
  const intent = detectIntent(input);
  const emotion = detectEmotion(input);
  const matches = await searchKnowledgeBaseHybrid(input, intent, 5);
  const confidence = calculateConfidence(matches);
  const localAnswer = buildAnswer(input, intent, emotion, matches, confidence);
  const manualRequired = shouldTransfer(intent, emotion, confidence, input);
  const webRoute = await routeWebSearch(input, history, confidence, intent, matches);
  let webSources: WebSource[] = [];
  let webSearchError = '';
  let webSearchNote = webRoute.needWebSearch ? `联网搜索计划：${webRoute.reason}；搜索词：${webRoute.query}` : webRoute.reason;

  if (webRoute.needWebSearch) {
    try {
      const rawSources = await searchWeb(webRoute.query || input);
      const validation = await validateWebSearchResults(input, webRoute, rawSources);
      webSources = validation.sources;
      webSearchNote = validation.sources.length
        ? `${webSearchNote}；${validation.note}`
        : `已尝试联网搜索，但没有可用于回答的可靠结果。${validation.note}`;
    } catch (error) {
      webSearchError = error instanceof Error ? error.message : '联网搜索失败';
      webSearchNote = `已尝试联网搜索，但搜索失败：${webSearchError}`;
    }
  }

  return {
    intent,
    emotion,
    matches,
    confidence,
    localAnswer,
    manualRequired,
    webRoute,
    webSources,
    webSearchError,
    webSearchNote
  };
}

export async function handleChat(input: string, history: ChatMessage[] = [], conversationId?: string) {
  const { intent, emotion, matches, confidence, localAnswer, manualRequired, webRoute, webSources, webSearchError, webSearchNote } = await prepareChat(input, history);
  let answer = localAnswer;
  let answerSource: 'llm' | 'local' = 'local';
  let model: string | undefined;
  let fallbackReason = getLlmSettings().apiKey ? '' : '未配置大模型 API Key，已使用本地规则兜底。';

  try {
    const llmReply = await generateCustomerReply(input, history, intent, emotion, matches, confidence, webSources, webSearchNote);
    if (llmReply) {
      answer = llmReply.answer;
      model = llmReply.model;
      answerSource = 'llm';
      fallbackReason = '';
    }
  } catch (error) {
    fallbackReason = error instanceof Error ? error.message : '大模型调用失败，已使用本地规则兜底。';
  }

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
    answerSource,
    model,
    fallbackReason,
    webSearchUsed: webSources.length > 0,
    webSearchAttempted: webRoute.needWebSearch,
    webSearchQuery: webRoute.needWebSearch ? webRoute.query : '',
    webSearchReason: webRoute.reason,
    webSearchScope: webRoute.scope,
    webSearchRouteSource: webRoute.source,
    webSources,
    webSearchError,
    history
  };
}

export async function handleChatStream(
  input: string,
  history: ChatMessage[] = [],
  conversationId: string | undefined,
  onChunk: (chunk: string) => void
) {
  const { intent, emotion, matches, confidence, localAnswer, manualRequired, webRoute, webSources, webSearchError, webSearchNote } = await prepareChat(input, history);
  let answer = '';
  let answerSource: 'llm' | 'local' = 'local';
  let model: string | undefined;
  let fallbackReason = getLlmSettings().apiKey ? '' : '未配置大模型 API Key，已使用本地规则兜底。';

  try {
    for await (const chunk of streamCustomerReply(input, history, intent, emotion, matches, confidence, webSources, webSearchNote)) {
      answer += chunk;
      answerSource = 'llm';
      model = getLlmSettings().model;
      fallbackReason = '';
      onChunk(chunk);
    }
  } catch (error) {
    fallbackReason = error instanceof Error ? error.message : '大模型流式调用失败，已使用本地规则兜底。';
  }

  if (!answer) {
    answer = localAnswer;
    onChunk(answer);
  }

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
    answerSource,
    model,
    fallbackReason,
    webSearchUsed: webSources.length > 0,
    webSearchAttempted: webRoute.needWebSearch,
    webSearchQuery: webRoute.needWebSearch ? webRoute.query : '',
    webSearchReason: webRoute.reason,
    webSearchScope: webRoute.scope,
    webSearchRouteSource: webRoute.source,
    webSources,
    webSearchError,
    history
  };
}
