import type { ChatMessage, Intent, KnowledgeChunk } from '../types.js';
import { getLlmSettings, getSearchSettings } from './settingsService.js';
import { shouldUseWebSearch, type WebSource } from './webSearchService.js';

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

const privateOrOrderWords = ['订单', '物流单号', '快递单号', '手机号', '手机号码', '地址', '收货人', '身份证', '账号', '账户'];
const businessWords = ['库存', '本店价格', '价格', '多少钱', '尺码', '码数', '退货', '换货', '售后', '赔偿', '赔付', '发货', '商品', '推荐'];
const explicitWebWords = ['网上', '联网', '搜索', '搜一下', '查一下', '查查', '最新', '近期', '官网', '新闻', '趋势', '口碑', '测评', '公开资料'];
const externalTopicWords = ['电影', '电视剧', '剧集', '综艺', '动漫', '小说', '书', '奥运', '世界杯', '赛程', '决赛', '半决赛', '评分', '影评', '票房', '上映'];
const businessIntents = new Set<Intent>([
  'product_query',
  'size_recommendation',
  'product_recommendation',
  'after_sale',
  'logistics',
  'complaint',
  'manual_transfer'
]);

const includesAny = (text: string, words: string[]) => words.some((word) => text.includes(word));

function recentHistory(history: ChatMessage[]) {
  return history
    .slice(-6)
    .filter((item) => item.content.trim())
    .map((item) => `${item.role === 'user' ? '用户' : '助手'}：${item.content.trim()}`)
    .join('\n');
}

function cleanSearchQuery(input: string) {
  return input
    .replace(/(帮我|麻烦)?(搜索|搜一下|查一下|查查|网上|联网|公开资料)/g, ' ')
    .replace(/[？?！!。]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractRequestedTitle(input: string) {
  const quoted = input.match(/[《“"]([^》”"]{2,40})[》”"]/)?.[1]?.trim();
  if (quoted) {
    return quoted;
  }

  return input
    .match(/(?:电影|电视剧|剧集|剧|动漫|动画|综艺|小说|书)\s*([\u4e00-\u9fa5A-Za-z0-9·:： -]{2,30}?)(?:好看|评分|口碑|影评|怎么样|讲什么|上映|搜索|吗|呢|$)/)?.[1]
    ?.trim();
}

function buildFastSearchQuery(input: string) {
  const cleaned = cleanSearchQuery(input);
  const title = extractRequestedTitle(input);
  const isMovie = input.includes('电影');
  const isTv = includesAny(input, ['电视剧', '剧集']);
  const wantsReview = includesAny(input, ['好看', '评分', '口碑', '影评', '评价', '怎么样']);

  if (input.includes('巴黎奥运会') || input.includes('巴黎奥运')) {
    return `2024 巴黎奥运会 官方 举办地点`;
  }

  if (includesAny(input, ['奥运', '世界杯', '赛程', '决赛', '半决赛'])) {
    return `${cleaned} 官方 信息`;
  }

  if (title && (isMovie || isTv || wantsReview)) {
    return [
      `《${title}》`,
      isMovie ? '电影' : '',
      isTv ? '电视剧' : '',
      wantsReview ? '评分 口碑 影评' : ''
    ].filter(Boolean).join(' ');
  }

  return cleaned || input.trim();
}

function getFastRoute(input: string, intent: Intent, matches: KnowledgeChunk[], confidence: number): SearchRoute | undefined {
  const normalized = input.toLowerCase();
  const hasPrivateOrOrder = includesAny(normalized, privateOrOrderWords);
  const wantsWeb = includesAny(normalized, explicitWebWords);
  const hasExternalTopic = includesAny(normalized, externalTopicWords);
  const hasBusinessWord = includesAny(normalized, businessWords);

  if (hasPrivateOrOrder && !wantsWeb) {
    return {
      needWebSearch: false,
      query: '',
      reason: '命中订单、物流、手机号或地址等私密/内部信息，直接走本地客服流程，不联网。',
      scope: 'private_or_order_info',
      source: 'fast_path'
    };
  }

  if (wantsWeb || hasExternalTopic) {
    return {
      needWebSearch: true,
      query: buildFastSearchQuery(input),
      reason: wantsWeb ? '用户明确表达了联网/公开搜索意图，直接进入搜索快路径。' : '用户问题属于外部公开信息，直接进入搜索快路径。',
      scope: 'external_public_info',
      source: 'fast_path'
    };
  }

  if (businessIntents.has(intent) && hasBusinessWord && matches.length > 0 && confidence >= 0.38) {
    return {
      needWebSearch: false,
      query: '',
      reason: '本店业务问题已有较高置信知识库命中，跳过联网搜索路由。',
      scope: 'local_business_knowledge',
      source: 'fast_path'
    };
  }

  if (businessIntents.has(intent) && matches.length > 0 && confidence >= 0.55) {
    return {
      needWebSearch: false,
      query: '',
      reason: '本地知识库高置信命中，直接走客服回答快路径。',
      scope: 'local_business_knowledge',
      source: 'fast_path'
    };
  }

  return undefined;
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
    return undefined;
  }

  let response = await requestRouterCompletion(baseUrl, apiKey, model, messages, true);

  if (!response.ok && [400, 404, 422].includes(response.status)) {
    response = await requestRouterCompletion(baseUrl, apiKey, model, messages, false);
  }

  if (!response.ok) {
    return undefined;
  }

  const payload = (await response.json()) as ChatCompletionResponse;
  return payload.choices?.[0]?.message?.content?.trim();
}

function normalizeRoute(raw: Record<string, unknown>, input: string): SearchRoute {
  const needWebSearch = raw.needWebSearch === true;
  const rawScope = typeof raw.scope === 'string' ? raw.scope : 'local_business_knowledge';
  const scope = validScopes.has(rawScope as SearchScope) ? rawScope as SearchScope : 'local_business_knowledge';
  const query = typeof raw.query === 'string' ? raw.query.trim() : '';
  const reason = typeof raw.reason === 'string' ? raw.reason.trim() : '';
  const queryTarget = query || input.trim();
  const vagueReferenceOnly = /^(这个|这款|这个牌子|这个品牌|它|靠谱吗|怎么样)[\s？?。!！]*$/.test(queryTarget)
    || (/^(这个|这款|这个牌子|这个品牌|它)/.test(queryTarget) && queryTarget.length <= 12 && !extractRequestedTitle(queryTarget));

  return {
    needWebSearch: needWebSearch && !vagueReferenceOnly && scope === 'external_public_info' && Boolean(queryTarget),
    query: queryTarget,
    reason: vagueReferenceOnly
      ? '用户没有提供明确品牌、商品或作品实体，跳过联网搜索，优先追问或基于本地上下文回答。'
      : reason || (needWebSearch ? '模型判断需要查询外部公开信息。' : '模型判断优先使用本店知识库或直接回答。'),
    scope: vagueReferenceOnly ? 'local_business_knowledge' : scope,
    source: 'llm'
  };
}

function fallbackRoute(input: string, confidence: number): SearchRoute {
  const needWebSearch = shouldUseWebSearch(input, confidence);
  const cleanedQuery = cleanSearchQuery(input);

  return {
    needWebSearch,
    query: cleanedQuery || input.trim(),
    reason: needWebSearch ? '大模型路由不可用，已使用本地规则触发联网搜索。' : '大模型路由不可用，本地规则未触发联网搜索。',
    scope: needWebSearch ? 'external_public_info' : 'local_business_knowledge',
    source: 'fallback'
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

  const fastRoute = getFastRoute(input, intent, matches, confidence);
  if (fastRoute) {
    return fastRoute;
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
        'query 要改写成干净搜索词：去掉“搜索/查一下”等指令词，保留用户修正和上下文约束；作品名尽量用书名号精确表达；遇到同名歧义时加入限定词，例如电影/电视剧/品牌/年份/评分/影评/口碑。',
        '如果用户强调“我说的是电影/不是电视剧/不是某某”，query 里必须体现这个限定，并可加入排除性词语。'
      ].join('\n')
    },
    {
      role: 'user',
      content: [
        `最近对话：\n${recentHistory(history) || '无'}`,
        `本地知识库检索置信度：${Math.round(confidence * 100)}%`,
        `当前用户问题：${input}`
      ].join('\n\n')
    }
  ]);

  if (!content) {
    return fallbackRoute(input, confidence);
  }

  try {
    return normalizeRoute(extractJsonObject(content), input);
  } catch {
    return fallbackRoute(input, confidence);
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

function isClearlyLowQuality(source: WebSource) {
  const text = `${source.title} ${source.url} ${source.snippet} ${source.summary}`.toLowerCase();
  return [
    '免费高清',
    '全集免费播放',
    '免费在线观看',
    '在线观看',
    'voddetail',
    'm3u8',
    '星辰影院',
    '美美影院',
    '观后感(精选',
    '观后感优秀',
    '作文',
    '范文',
    'ruiwen.com',
    'qunzou.com'
  ].some((word) => text.includes(word.toLowerCase()));
}

function isLikelyDifferentNamedWork(input: string, route: SearchRoute, source: WebSource) {
  const title = extractRequestedTitle(input) || extractRequestedTitle(route.query);
  if (!title) {
    return false;
  }

  const sourceTitle = source.title.replace(/\s+/g, '');
  const compactTitle = title.replace(/\s+/g, '');
  const index = sourceTitle.indexOf(compactTitle);
  if (index <= 0) {
    return false;
  }

  const prefix = sourceTitle.slice(Math.max(0, index - 4), index);
  return /[\u4e00-\u9fa5]{2,}$/.test(prefix);
}

function isMovieQuestion(input: string, route: SearchRoute) {
  return `${input} ${route.query}`.includes('电影');
}

function isMediaOrReviewQuestion(input: string, route: SearchRoute) {
  const text = `${input} ${route.query}`;
  return includesAny(text, ['电影', '电视剧', '剧集', '综艺', '动漫', '小说', '书', '评分', '影评', '口碑', '好看', '观感']);
}

function hasMediaTypeMismatch(input: string, route: SearchRoute, source: WebSource) {
  const text = `${source.title} ${source.snippet} ${source.summary}`;
  if (isMovieQuestion(input, route) && includesAny(text, ['电视剧', '剧集', '首播', '集数', '国产剧', '连续剧'])) {
    return true;
  }

  return false;
}

function hasAmbiguousNamedWork(input: string, route: SearchRoute, sources: WebSource[]) {
  return sources.some((source) => isLikelyDifferentNamedWork(input, route, source) || hasMediaTypeMismatch(input, route, source));
}

export async function validateWebSearchResults(input: string, route: SearchRoute, sources: WebSource[]): Promise<SearchValidation> {
  const candidates = sources
    .filter((source) => !isClearlyLowQuality(source) && !isLikelyDifferentNamedWork(input, route, source) && !hasMediaTypeMismatch(input, route, source))
    .slice(0, 8);

  if (!sources.length) {
    return { sources: [], note: '联网搜索没有返回结果。' };
  }

  if (!candidates.length) {
    return { sources: [], note: '联网搜索结果主要来自低质量、类型不匹配或播放聚合页面，已过滤。' };
  }

  const needsLlmValidation = isMediaOrReviewQuestion(input, route) || hasAmbiguousNamedWork(input, route, sources);

  if (!needsLlmValidation) {
    return {
      sources: candidates.slice(0, 5),
      note: '联网搜索结果已通过基础来源和相关性过滤。'
    };
  }

  const content = await callRouterModel([
    {
      role: 'system',
      content: [
        '你是 ShopMate AI 的搜索结果验收器，只判断搜索结果是否真的能回答用户问题。',
        '必须只输出 JSON，不要解释。JSON 字段：acceptedIndexes(number[]), note(string)。acceptedIndexes 使用候选结果里的 #编号。',
        '只保留和用户问题实体、类型、时间、限定条件匹配的结果。',
        '作品名必须精确匹配；不要把“包含用户标题但前后多了其他汉字”的另一部作品当成同一作品。例如《群星闪耀时》不是《人类群星闪耀时》。',
        '如果用户问电影，却结果显示电视剧、剧集、首播、集数、国产剧，除非用户也接受电视剧，否则不要保留。',
        '如果用户问评分/口碑，优先保留豆瓣、猫眼、淘票票、IMDb、百科、主流媒体或可信影评内容；范文站、作文站、盗版播放站、无关聚合页不要保留。',
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
    return {
      sources: isMediaOrReviewQuestion(input, route) ? [] : candidates.slice(0, 5),
      note: isMediaOrReviewQuestion(input, route)
        ? '搜索结果需要进一步语义验收，但验收模型不可用，未使用这些结果。'
        : '结果验收模型不可用，已使用基础来源过滤。'
    };
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
  } catch {
    return {
      sources: candidates.slice(0, 5),
      note: '结果验收解析失败，已使用基础来源过滤。'
    };
  }
}
