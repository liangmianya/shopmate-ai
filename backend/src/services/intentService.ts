import type { ChatMessage, Emotion, Intent } from '../types.js';
import { getLlmSettings } from './settingsService.js';

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

export type CustomerMessageClassification = {
  intent: Intent;
  emotion: Emotion;
  manualRequired: boolean;
  reason: string;
  source: 'llm';
};

const validIntents = new Set<Intent>([
  'product_query',
  'size_recommendation',
  'product_recommendation',
  'after_sale',
  'logistics',
  'complaint',
  'manual_transfer',
  'operation_task'
]);

const validEmotions = new Set<Emotion>(['neutral', 'positive', 'negative']);

function recentHistory(history: ChatMessage[]) {
  return history
    .slice(-6)
    .filter((item) => item.content.trim())
    .map((item) => `${item.role === 'user' ? '用户' : '助手'}：${item.content.trim()}`)
    .join('\n');
}

function extractJsonObject(content: string) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? trimmed.match(/\{[\s\S]*\}/)?.[0] ?? trimmed;
  return JSON.parse(candidate) as Record<string, unknown>;
}

function normalizeClassification(raw: Record<string, unknown>): CustomerMessageClassification {
  const rawIntent = typeof raw.intent === 'string' ? raw.intent : '';
  const rawEmotion = typeof raw.emotion === 'string' ? raw.emotion : '';
  const reason = typeof raw.reason === 'string' ? raw.reason.trim() : '';

  if (!validIntents.has(rawIntent as Intent)) {
    throw new Error(`大模型分类返回了无效意图：${rawIntent || '空'}`);
  }

  if (!validEmotions.has(rawEmotion as Emotion)) {
    throw new Error(`大模型分类返回了无效情绪：${rawEmotion || '空'}`);
  }

  return {
    intent: rawIntent as Intent,
    emotion: rawEmotion as Emotion,
    manualRequired: raw.manualRequired === true,
    reason: reason || '大模型已返回结构化分类。',
    source: 'llm'
  };
}

async function requestClassification(input: string, history: ChatMessage[]) {
  const { apiKey, baseUrl, model } = getLlmSettings();
  if (!apiKey) {
    throw new Error('未配置大模型 API Key，无法进行客服消息分类。');
  }

  const messages = [
    {
      role: 'system' as const,
      content: [
        '你是 ShopMate AI 的客服消息分类器，只做结构化分类，不回答客户问题。',
        '必须只输出 JSON，不要解释。JSON 字段：intent(string), emotion(string), manualRequired(boolean), reason(string)。',
        'intent 只能是：product_query、size_recommendation、product_recommendation、after_sale、logistics、complaint、manual_transfer、operation_task。',
        'emotion 只能是：neutral、positive、negative。',
        'manualRequired 只在客户明确要求人工、投诉/强烈不满、赔付/质量争议、订单或售后需要人工核实时为 true。',
        '优先理解整句话和最近对话上下文，不要只按单个词面判断。'
      ].join('\n')
    },
    {
      role: 'user' as const,
      content: [
        `最近对话：\n${recentHistory(history) || '无'}`,
        `当前客户消息：${input}`
      ].join('\n\n')
    }
  ];

  let response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages
    })
  });

  if (!response.ok && [400, 404, 422].includes(response.status)) {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages
      })
    });
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`大模型分类请求失败：${response.status}${detail ? ` ${detail.slice(0, 200)}` : ''}`);
  }

  const payload = (await response.json()) as ChatCompletionResponse;
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('大模型分类响应为空。');
  }
  return content;
}

export async function classifyCustomerMessage(input: string, history: ChatMessage[] = []): Promise<CustomerMessageClassification> {
  const content = await requestClassification(input, history);
  return normalizeClassification(extractJsonObject(content));
}

export function intentLabel(intent: Intent) {
  const labels: Record<Intent, string> = {
    product_query: '商品咨询',
    size_recommendation: '尺码推荐',
    product_recommendation: '商品推荐',
    after_sale: '售后政策',
    logistics: '物流订单',
    complaint: '投诉安抚',
    manual_transfer: '转人工',
    operation_task: '运营任务'
  };

  return labels[intent];
}
