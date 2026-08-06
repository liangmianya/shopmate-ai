import type { ChatMessage, Intent, KnowledgeChunk } from '../types.js';
import { getLlmSettings, getSearchSettings } from './settingsService.js';
import type { WebSource } from './webSearchService.js';

export type SearchScope =
  | 'external_public_info'
  | 'local_business_knowledge'
  | 'private_or_order_info'
  | 'unsafe_or_not_supported';

export type SearchRoute = {
  needWebSearch: boolean;
  query: string;
  reason: string;
  scope: SearchScope;
  source: 'fast_path' | 'llm' | 'fallback';
};

export type SearchValidation = {
  sources: WebSource[];
  note: string;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

const validScopes = new Set<SearchScope>([
  'external_public_info',
  'local_business_knowledge',
  'private_or_order_info',
  'unsafe_or_not_supported'
]);

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

async function requestRouterCompletion(
  baseUrl: string,
  apiKey: string,
  model: string,
  messages: Array<{ role: 'system' | 'user'; content: string }>,
  useJsonMode: boolean
) {
  return fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      ...(useJsonMode ? { response_format: { type: 'json_object' } } : {}),
      messages
    })
  });
}

async function callRouterModel(messages: Array<{ role: 'system' | 'user'; content: string }>) {
  const { apiKey, baseUrl, model } = getLlmSettings();
  if (!apiKey) {
    throw new Error('未配置大模型 API Key，无法进行联网搜索路由。');
  }

  let response = await requestRouterCompletion(baseUrl, apiKey, model, messages, true);

  if (!response.ok && [400, 404, 422].includes(response.status)) {
    response = await requestRouterCompletion(baseUrl, apiKey, model, messages, false);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`联网搜索路由模型请求失败：${response.status}${detail ? ` ${detail.slice(0, 200)}` : ''}`);
  }

  const payload = (await response.json()) as ChatCompletionResponse;
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('联网搜索路由模型响应为空。');
  }
  return content;
}

function normalizeRoute(raw: Record<string, unknown>, input: string): SearchRoute {
  const needWebSearch = raw.needWebSearch === true;
  const rawScope = typeof raw.scope === 'string' ? raw.scope : 'local_business_knowledge';
  const scope = validScopes.has(rawScope as SearchScope) ? rawScope as SearchScope : 'local_business_knowledge';
  const query = typeof raw.query === 'string' ? raw.query.trim() : '';
  const reason = typeof raw.reason === 'string' ? raw.reason.trim() : '';
  const queryTarget = query || input.trim();

  return {
    needWebSearch: needWebSearch && scope === 'external_public_info' && Boolean(queryTarget),
    query: queryTarget,
    reason: reason || (needWebSearch ? '模型判断需要查询外部公开信息。' : '模型判断优先使用本店知识库或直接回答。'),
    scope,
    source: 'llm'
  };
}

export async function routeWebSearch(input: string, history: ChatMessage[], confidence: number): Promise<SearchRoute>;
export async function routeWebSearch(input: string, history: ChatMessage[], confidence: number, intent: Intent, matches: KnowledgeChunk[]): Promise<SearchRoute>;
export async function routeWebSearch(
  input: string,
  history: ChatMessage[],
  confidence: number,
  intent: Intent = 'product_query',
  matches: KnowledgeChunk[] = []
): Promise<SearchRoute> {
  const searchSettings = getSearchSettings();
  if (!searchSettings.enabled || !searchSettings.apiKey) {
    return {
      needWebSearch: false,
      query: '',
      reason: '联网搜索未启用或未配置 API Key。',
      scope: 'local_business_knowledge',
      source: 'fallback'
    };
  }

  const content = await callRouterModel([
    {
      role: 'system',
      content: [
        '你是 ShopMate AI 的联网搜索路由器，只负责判断是否需要查询外部公开网页，并生成搜索词。',
        '必须只输出 JSON，不要解释。JSON 字段：needWebSearch(boolean), scope(string), query(string), reason(string)。',
        'scope 只能是 external_public_info、local_business_knowledge、private_or_order_info、unsafe_or_not_supported。',
        'ShopMate AI 本职是电商客服：本店商品、库存、价格、尺码、售后、订单、物流、投诉，默认走本地知识库，不要联网覆盖本店信息。',
        '如果用户询问公开网页信息，例如影视评分/口碑、新闻、体育赛程、品牌公开评价、第三方测评、百科事实、近期事件，应选择 external_public_info，即使用户没有写“搜索”。',
        '如果用户询问订单号、手机号、地址、个人物流、账号等私密或内部信息，应选择 private_or_order_info 且 needWebSearch=false。',
        '如果用户只说“这个牌子/这款/它靠谱吗/怎么样”，但最近对话里没有明确品牌、商品或作品实体，不要联网搜索，应选择 local_business_knowledge 且 needWebSearch=false，并让最终回答去追问具体对象。',
        'query 要改写成干净搜索词：去掉“搜索/查一下”等指令词，保留用户修正、实体、时间和上下文约束。',
        '如果用户表达含糊、缺少明确查询对象，needWebSearch=false，让最终回答基于上下文追问。'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        `最近对话：\n${recentHistory(history) || '无'}`,
        `本地知识库检索置信度：${Math.round(confidence * 100)}%`,
        `当前客服意图：${intent}`,
        `本地知识命中数量：${matches.length}`,
        `当前用户问题：${input}`
      ].join('\n\n')
    }
  ]);

  try {
    return normalizeRoute(extractJsonObject(content), input);
  } catch (error) {
    throw new Error(`联网搜索路由解析失败：${error instanceof Error ? error.message : '未知错误'}`);
  }
}

function summarizeSources(sources: WebSource[]) {
  return sources
    .slice(0, 8)
    .map((item, index) => [
      `#${index}`,
      `标题：${item.title}`,
      `站点：${item.siteName}`,
      `链接：${item.url}`,
      `摘要：${item.summary || item.snippet}`
    ].join('\n'))
    .join('\n\n');
}

export async function validateWebSearchResults(input: string, route: SearchRoute, sources: WebSource[]): Promise<SearchValidation> {
  if (!sources.length) {
    return { sources: [], note: '联网搜索没有返回结果。' };
  }

  const candidates = sources.slice(0, 8);

  const content = await callRouterModel([
    {
      role: 'system',
      content: [
        '你是 ShopMate AI 的搜索结果验收器，只判断搜索结果是否真的能回答用户问题。',
        '必须只输出 JSON，不要解释。JSON 字段：acceptedIndexes(number[]), note(string)。acceptedIndexes 使用候选结果里的 #编号。',
        '只保留和用户问题实体、类型、时间、限定条件匹配，且来源摘要足以支撑回答的结果。',
        '如果结果不足以可靠回答，acceptedIndexes 返回空数组，并在 note 里说明缺口。'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        `用户问题：${input}`,
        `搜索词：${route.query}`,
        `路由原因：${route.reason}`,
        `候选结果：\n${summarizeSources(candidates)}`
      ].join('\n\n')
    }
  ]);

  if (!content) {
    throw new Error('搜索结果验收模型响应为空。');
  }

  try {
    const raw = extractJsonObject(content);
    const acceptedIndexes = Array.isArray(raw.acceptedIndexes)
      ? raw.acceptedIndexes.filter((index): index is number => Number.isInteger(index) && index >= 0 && index < candidates.length)
      : [];
    const note = typeof raw.note === 'string' ? raw.note.trim() : '';

    return {
      sources: acceptedIndexes.map((index) => candidates[index]).slice(0, 5),
      note: note || (acceptedIndexes.length ? '联网搜索结果已通过相关性验收。' : '联网搜索结果与用户问题不够匹配。')
    };
  } catch (error) {
    throw new Error(`搜索结果验收解析失败：${error instanceof Error ? error.message : '未知错误'}`);
  }
}
