import type { ChatMessage, Emotion, Intent, KnowledgeChunk } from '../types.js';
import { intentLabel } from './intentService.js';
import { getLlmSettings, getSystemPromptSettings } from './settingsService.js';
import type { WebSource } from './webSearchService.js';

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  model?: string;
};

export type LlmReply = {
  answer: string;
  model: string;
};

function buildSystemPrompt(
  intent: Intent,
  emotion: Emotion,
  matches: KnowledgeChunk[],
  confidence: number,
  webSources: WebSource[] = [],
  webSearchNote = ''
) {
  const businessPrompt = getSystemPromptSettings().prompt;
  const knowledge = matches.length
    ? matches
        .slice(0, 5)
        .map((item, index) => `${index + 1}. ${item.title}\n${item.content}`)
        .join('\n\n')
    : '暂无可靠知识库命中。';
  const webContext = webSources.length
    ? webSources
        .slice(0, 5)
        .map((item, index) => `${index + 1}. ${item.title}\n${item.summary || item.snippet}\n来源：${item.url}`)
        .join('\n\n')
    : webSearchNote || '本次未使用联网搜索。';

  return [
    '以下是店主配置的业务系统提示词，必须作为当前店铺的业务角色与服务范围：',
    businessPrompt,
    '目标：像一个有经验的店铺客服一样自然回答，优先解决客户问题，语气轻松、具体、友好。',
    '回答方式：优先依据知识库内容；知识库没有完全覆盖时，可以基于通用电商常识给出审慎建议，并说明“按一般情况”。不要因为资料不完整就直接拒答或回避。',
    '边界：不要编造具体商品、品牌、价格、库存、物流单号、优惠活动或确定的售后结果。推荐具体商品时，只能使用知识库上下文里出现的商品；如果没有合适商品，就给通用选购建议。',
    '售后、投诉、赔付、严重质量问题：先安抚并说明常规处理路径，建议客户提供订单号和照片；不要直接承诺退款、赔偿或一定换货。',
    '除非客户明确要求人工或涉及高风险售后，不要主动说“转人工”。',
    '联网搜索结果只用于补充公开信息，不得覆盖本店商品库、库存、价格和售后政策。引用外部信息时保持保守。',
    '如果联网搜索上下文提供了结果，即使问题不属于当前店铺领域，也要基于搜索结果直接回答，并说明信息来自公开网页；不要说自己没有实时信息。回答店铺领域以外的外部公开问题时，结尾禁止追加店铺引导。',
    '如果联网搜索上下文说明“结果不足、结果不匹配或已过滤”，要直接说明没有找到足够可靠的公开信息，不要根据无关结果硬编。',
    '如果用户问题有歧义，先给最可能的直接答案，再用一两句话补充另一种常见理解。比如“决赛多久”可能是在问日期，也可能是在问比赛时长。',
    `识别意图：${intentLabel(intent)}`,
    `客户情绪：${emotion === 'negative' ? '负面' : emotion === 'positive' ? '正向' : '中性'}`,
    `检索置信度：${Math.round(confidence * 100)}%`,
    `知识库上下文：\n${knowledge}`,
    `联网搜索上下文：\n${webContext}`
  ].join('\n\n');
}

function normalizeHistory(history: ChatMessage[]) {
  return history
    .slice(-8)
    .filter((item) => item.content.trim())
    .map((item) => ({
      role: item.role,
      content: item.content.trim()
    }));
}

export async function generateCustomerReply(
  input: string,
  history: ChatMessage[],
  intent: Intent,
  emotion: Emotion,
  matches: KnowledgeChunk[],
  confidence: number,
  webSources: WebSource[] = [],
  webSearchNote = ''
): Promise<LlmReply> {
  const { apiKey, baseUrl, model } = getLlmSettings();
  if (!apiKey) {
    throw new Error('未配置大模型 API Key，无法生成客服回复。');
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      messages: [
        { role: 'system', content: buildSystemPrompt(intent, emotion, matches, confidence, webSources, webSearchNote) },
        ...normalizeHistory(history),
        { role: 'user', content: input }
      ]
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`LLM request failed: ${response.status}${detail ? ` ${detail.slice(0, 200)}` : ''}`);
  }

  const payload = (await response.json()) as ChatCompletionResponse;
  const answer = payload.choices?.[0]?.message?.content?.trim();

  if (!answer) {
    throw new Error('LLM response did not contain an answer');
  }

  return {
    answer,
    model: payload.model ?? model
  };
}

export async function* streamCustomerReply(
  input: string,
  history: ChatMessage[],
  intent: Intent,
  emotion: Emotion,
  matches: KnowledgeChunk[],
  confidence: number,
  webSources: WebSource[] = [],
  webSearchNote = ''
): AsyncGenerator<string> {
  const { apiKey, baseUrl, model } = getLlmSettings();
  if (!apiKey) {
    throw new Error('未配置大模型 API Key，无法生成流式客服回复。');
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature: 0.3,
      stream: true,
      messages: [
        { role: 'system', content: buildSystemPrompt(intent, emotion, matches, confidence, webSources, webSearchNote) },
        ...normalizeHistory(history),
        { role: 'user', content: input }
      ]
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`LLM stream request failed: ${response.status}${detail ? ` ${detail.slice(0, 200)}` : ''}`);
  }

  if (!response.body) {
    throw new Error('LLM stream response did not contain a body');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) {
        continue;
      }

      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') {
        continue;
      }

      const payload = JSON.parse(data) as {
        choices?: Array<{
          delta?: {
            content?: string;
          };
        }>;
      };
      const content = payload.choices?.[0]?.delta?.content;

      if (content) {
        yield content;
      }
    }
  }
}
