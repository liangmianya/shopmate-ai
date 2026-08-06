import type { ChatMessage, Emotion, Intent, KnowledgeChunk } from '../types.js';
import { intentLabel } from './intentService.js';
import { calculateConfidence, searchKnowledgeBaseHybrid } from './ragService.js';
import { getLlmSettings, getSystemPromptSettings } from './settingsService.js';
import { searchWeb, type WebSource } from './webSearchService.js';

type AgentAction =
  | {
      type: 'tool';
      tool: 'web_search' | 'search_shop_knowledge';
      input?: Record<string, unknown>;
    }
  | {
      type: 'final';
      answer: string;
    };

type AgentMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type CustomerAgentResult = {
  answer: string;
  model: string;
  webSources: WebSource[];
  webSearchAttempted: boolean;
  webSearchQuery: string;
  webSearchReason: string;
  webSearchError: string;
  toolTrace: Array<{
    tool: string;
    input: unknown;
    status: 'success' | 'error';
    summary: string;
  }>;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  model?: string;
};

const MAX_AGENT_STEPS = 5;
const MAX_FINAL_REVIEW_RETRIES = 2;
const MAX_TOOL_OBSERVATION_CHARS = 3600;

function normalizeHistory(history: ChatMessage[]) {
  return history
    .slice(-8)
    .filter((item) => item.content.trim())
    .map((item) => ({
      role: item.role,
      content: item.content.trim()
    }));
}

function extractJsonObject(content: string) {
  const trimmed = content.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? trimmed.match(/\{[\s\S]*\}/)?.[0] ?? trimmed;
  return JSON.parse(candidate) as Record<string, unknown>;
}

function recoverFinalAction(content: string): AgentAction | undefined {
  const trimmed = content.trim();
  const unfenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim() ?? trimmed;
  if (!/"type"\s*:\s*"final"/.test(unfenced)) {
    return undefined;
  }

  const answerPrefix = unfenced.match(/"answer"\s*:\s*"/);
  if (!answerPrefix || answerPrefix.index === undefined) {
    return undefined;
  }

  const start = answerPrefix.index + answerPrefix[0].length;
  const objectEnd = unfenced.lastIndexOf('}');
  const lastQuoteBeforeEnd = objectEnd > start ? unfenced.lastIndexOf('"', objectEnd) : unfenced.lastIndexOf('"');
  if (lastQuoteBeforeEnd <= start) {
    return undefined;
  }

  const answer = unfenced
    .slice(start, lastQuoteBeforeEnd)
    .replace(/\\n/g, '\n')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
    .trim();

  return answer ? { type: 'final', answer } : undefined;
}

function normalizeAction(content: string): AgentAction {
  let raw: Record<string, unknown>;
  try {
    raw = extractJsonObject(content);
  } catch (error) {
    const recovered = recoverFinalAction(content);
    if (recovered) {
      return recovered;
    }
    throw error;
  }

  const type = typeof raw.type === 'string' ? raw.type : '';

  if (type === 'final') {
    const answer = typeof raw.answer === 'string' ? raw.answer.trim() : '';
    if (!answer) {
      throw new Error('Agent final answer is empty.');
    }
    return { type: 'final', answer };
  }

  if (type === 'tool') {
    const tool = typeof raw.tool === 'string' ? raw.tool : '';
    if (tool !== 'web_search' && tool !== 'search_shop_knowledge') {
      throw new Error(`Agent requested unsupported tool: ${tool || 'empty'}.`);
    }
    return {
      type: 'tool',
      tool,
      input: raw.input && typeof raw.input === 'object' && !Array.isArray(raw.input)
        ? raw.input as Record<string, unknown>
        : {}
    };
  }

  throw new Error(`Agent returned invalid action type: ${type || 'empty'}.`);
}

async function requestAgentCompletion(messages: AgentMessage[]) {
  const { apiKey, baseUrl, model } = getLlmSettings();
  if (!apiKey) {
    throw new Error('未配置大模型 API Key，无法生成客服回复。');
  }

  let response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
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
        temperature: 0.2,
        messages
      })
    });
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Agent LLM request failed: ${response.status}${detail ? ` ${detail.slice(0, 200)}` : ''}`);
  }

  const payload = await response.json() as ChatCompletionResponse;
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error('Agent LLM response did not contain content.');
  }

  return {
    content,
    model: payload.model ?? model
  };
}

async function requestJsonCompletion(messages: AgentMessage[], errorPrefix: string) {
  const { apiKey, baseUrl, model } = getLlmSettings();
  if (!apiKey) {
    throw new Error('未配置大模型 API Key，无法生成客服回复。');
  }

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
    throw new Error(`${errorPrefix}: ${response.status}${detail ? ` ${detail.slice(0, 200)}` : ''}`);
  }

  const payload = await response.json() as ChatCompletionResponse;
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error(`${errorPrefix}: empty response`);
  }
  return extractJsonObject(content);
}

async function reviewFinalAnswer({
  input,
  history,
  answer,
  toolTrace,
  webSources
}: {
  input: string;
  history: ChatMessage[];
  answer: string;
  toolTrace: CustomerAgentResult['toolTrace'];
  webSources: WebSource[];
}): Promise<{ sufficient: boolean; reason: string; retryInstruction: string }> {
  try {
    const raw = await requestJsonCompletion([
      {
        role: 'system',
        content: [
          '你是客服 Agent 的最终答案质检器，只判断答案是否完成客户刚才的目标，不替客户回答。',
          '必须只输出 JSON：sufficient(boolean), reason(string), retryInstruction(string)。',
          '如果客户要求推荐、名单、具体名字、账号名、有哪些，答案应包含具体对象；只给搜索关键词、筛选方法、泛泛建议通常不充分。',
          '如果客户明确要求搜索外部公开信息，而答案说没找到具体结果，只有在工具记录显示已经尝试多个明显不同的搜索方向，或搜索工具失败/无结果时才算充分。',
          '如果答案把“博主A/A-J/某博主/TOP1”等占位符当具体对象，必须判为不充分。',
          '如果外部公开问题答案加入店铺商品导购，且当前用户问题没有明确购买、链接、色号、配产品或店铺商品诉求，应判为不充分；即使只是“在店里帮你找产品”“有产品想试试告诉我”这种轻导购也要删掉。',
          'retryInstruction 要给 Agent 一个简短可执行的下一步，例如换哪些搜索方向、需要哪些字段，或要求删掉不相关导购。'
        ].join('\n')
      },
      {
        role: 'user',
        content: [
          `最近对话：\n${normalizeHistory(history).map((item) => `${item.role}: ${item.content}`).join('\n') || '无'}`,
          `当前用户问题：${input}`,
          `候选答案：\n${answer}`,
          `工具记录：\n${JSON.stringify(toolTrace, null, 2)}`,
          `联网来源标题：\n${webSources.map((source, index) => `#${index} ${source.title} ${source.url}`).join('\n') || '无'}`
        ].join('\n\n')
      }
    ], 'Agent final review failed');

    return {
      sufficient: raw.sufficient === true,
      reason: typeof raw.reason === 'string' ? raw.reason.trim() : '',
      retryInstruction: typeof raw.retryInstruction === 'string' ? raw.retryInstruction.trim() : ''
    };
  } catch {
    return {
      sufficient: true,
      reason: '质检失败，放行当前答案。',
      retryInstruction: ''
    };
  }
}

function buildAgentSystemPrompt(intent: Intent, emotion: Emotion, confidence: number) {
  const businessPrompt = getSystemPromptSettings().prompt;

  return [
    '以下是店主配置的业务系统提示词，必须作为当前店铺的业务角色与服务范围：',
    businessPrompt,
    '你是 ShopMate AI 的客服 Agent。你可以在内部使用工具获取信息，但最终给客户的回答里不要提工具名、内部动作、JSON 或“路由”。',
    '你每一步必须只输出一个 JSON 对象，不要输出 Markdown、解释或多余文本。',
    '可输出两种 JSON：',
    '{"type":"tool","tool":"web_search","input":{"query":"搜索词","objective":"要完成的客户目标","requiredFields":["必须拿到的字段"]}}',
    '{"type":"tool","tool":"search_shop_knowledge","input":{"query":"店内商品/规则检索词"}}',
    '{"type":"final","answer":"给客户看的自然中文回复"}',
    '工具使用原则：',
    '1. 用户询问本店商品、库存、价格、购买链接、售后规则时，先用 search_shop_knowledge；推荐具体商品只能依据店内检索结果。',
    '2. 用户询问外部公开信息、近期信息、公开账号/博主/达人/UP主/教程/榜单/第三方评价，或明确说“搜索/查一下”，应使用 web_search。',
    '2a. 如果用户只说“这个/它靠谱吗/怎么样/好不好”，且最近对话中的指代对象是店内商品或商品品类，不要主动联网查外部评价；先用 search_shop_knowledge 基于店内资料回答，信息不足时追问具体商品或说明可再按用户要求查公开评价。',
    '3. 如果用户要求“推荐、名单、具体名字、账号名、有哪些”，最终答案必须给具体对象；如果搜索结果没有具体对象，要换不同搜索词继续搜，不能只给搜索关键词或方法论冒充答案。',
    '4. 搜索结果里的“博主A、A-J、某博主、TOP1”等占位符不是具体名字；没有账号名、昵称、人名或明确可搜索名称，就不能当作具体推荐。',
    '5. 外部公开问题如果已使用联网搜索，回答应基于搜索结果并说明信息来自公开网页；除非当前用户消息明确询问店铺商品、购买、链接、色号或要按教程配产品，不要追加店铺商品导购，也不要用“在店里帮你找产品”等话术收尾。',
    '6. 如果达到工具步数上限仍找不到足够可靠信息，要诚实说明没找到可靠具体结果，并给最短的下一步建议；不要编造来源、榜单或名字。',
    '7. 对客户情绪保持友好克制；不要辱骂、嘲讽、攻击客户。',
    `识别意图：${intentLabel(intent)}`,
    `客户情绪：${emotion === 'negative' ? '负面' : emotion === 'positive' ? '正向' : '中性'}`,
    `初始本地检索置信度：${Math.round(confidence * 100)}%`
  ].join('\n\n');
}

function summarizeKnowledge(matches: KnowledgeChunk[]) {
  if (!matches.length) {
    return '未找到匹配的店内商品或知识。';
  }

  return matches
    .slice(0, 6)
    .map((item, index) => [
      `#${index}`,
      `标题：${item.title}`,
      `类型：${item.type}`,
      `来源：${item.source}`,
      `内容：${item.content}`
    ].join('\n'))
    .join('\n\n');
}

function summarizeSources(sources: WebSource[]) {
  if (!sources.length) {
    return '联网搜索没有返回结果。';
  }

  return sources
    .slice(0, 6)
    .map((item, index) => [
      `#${index}`,
      `标题：${item.title}`,
      `站点：${item.siteName}`,
      `链接：${item.url}`,
      item.datePublished ? `发布时间：${item.datePublished}` : '',
      `摘要：${item.summary || item.snippet || '无摘要'}`
    ].filter(Boolean).join('\n'))
    .join('\n\n');
}

function truncateObservation(content: string) {
  return content.length > MAX_TOOL_OBSERVATION_CHARS
    ? `${content.slice(0, MAX_TOOL_OBSERVATION_CHARS)}\n...（已截断）`
    : content;
}

function asString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function stripTrailingShopUpsell(answer: string, toolTrace: CustomerAgentResult['toolTrace']) {
  const usedWebSearch = toolTrace.some((item) => item.tool === 'web_search' && item.status === 'success');
  const usedShopKnowledge = toolTrace.some((item) => item.tool === 'search_shop_knowledge' && item.status === 'success');
  if (!usedWebSearch || usedShopKnowledge) {
    return answer;
  }

  const lines = answer.split('\n');
  const upsellPattern = /(店里|本店|商品|产品|购买|下单|链接|色号|库存)/;
  while (lines.length) {
    const last = lines[lines.length - 1].trim();
    if (!last) {
      lines.pop();
      continue;
    }
    if (!upsellPattern.test(last)) {
      break;
    }
    lines.pop();
  }

  return lines.join('\n').trim() || answer;
}

async function executeAgentTool(
  action: Extract<AgentAction, { type: 'tool' }>,
  intent: Intent
): Promise<{
  observation: string;
  webSources: WebSource[];
  webSearchAttempted: boolean;
  webSearchQuery: string;
  webSearchReason: string;
}> {
  if (action.tool === 'web_search') {
    const query = asString(action.input?.query);
    const objective = asString(action.input?.objective);
    const requiredFields = Array.isArray(action.input?.requiredFields)
      ? action.input?.requiredFields.filter((item): item is string => typeof item === 'string')
      : [];

    if (!query) {
      return {
        observation: 'web_search 失败：缺少 query。',
        webSources: [],
        webSearchAttempted: true,
        webSearchQuery: '',
        webSearchReason: objective || 'Agent requested web search but did not provide a query.'
      };
    }

    const sources = await searchWeb(query, 6);
    const observation = [
      `web_search 结果。搜索词：${query}`,
      objective ? `目标：${objective}` : '',
      requiredFields.length ? `必须字段：${requiredFields.join('、')}` : '',
      '请判断这些结果是否足以直接回答客户；如果客户要具体名单，必须从结果中拿到具体名称，不能把占位符当名字。',
      summarizeSources(sources)
    ].filter(Boolean).join('\n\n');

    return {
      observation,
      webSources: sources,
      webSearchAttempted: true,
      webSearchQuery: query,
      webSearchReason: objective || 'Agent decided public web information was needed.'
    };
  }

  const query = asString(action.input?.query);
  const matches = await searchKnowledgeBaseHybrid(query || '', intent, 6);
  const confidence = calculateConfidence(matches);
  const observation = [
    `search_shop_knowledge 结果。检索词：${query || '空'}`,
    `置信度：${Math.round(confidence * 100)}%`,
    '推荐具体店内商品、价格、库存、购买链接时，只能使用以下结果里的信息。',
    summarizeKnowledge(matches)
  ].join('\n\n');

  return {
    observation,
    webSources: [],
    webSearchAttempted: false,
    webSearchQuery: '',
    webSearchReason: ''
  };
}

export async function generateCustomerAgentReply(
  input: string,
  history: ChatMessage[],
  intent: Intent,
  emotion: Emotion,
  confidence: number
): Promise<CustomerAgentResult> {
  const messages: AgentMessage[] = [
    { role: 'system', content: buildAgentSystemPrompt(intent, emotion, confidence) },
    ...normalizeHistory(history),
    { role: 'user', content: input }
  ];
  const webSources: WebSource[] = [];
  const toolTrace: CustomerAgentResult['toolTrace'] = [];
  let model = getLlmSettings().model;
  let webSearchAttempted = false;
  let webSearchQuery = '';
  let webSearchReason = '';
  let webSearchError = '';
  let finalReviewRetries = 0;

  for (let step = 0; step < MAX_AGENT_STEPS; step += 1) {
    const completion = await requestAgentCompletion(messages);
    model = completion.model;

    let action: AgentAction;
    try {
      action = normalizeAction(completion.content);
    } catch (error) {
      messages.push({
        role: 'assistant',
        content: completion.content
      });
      messages.push({
        role: 'user',
        content: `内部格式错误：${error instanceof Error ? error.message : '无法解析 JSON'}。请严格只输出 {"type":"tool",...} 或 {"type":"final","answer":"..."}。`
      });
      continue;
    }

    if (action.type === 'final') {
      const review = await reviewFinalAnswer({
        input,
        history,
        answer: action.answer,
        toolTrace,
        webSources
      });

      if (!review.sufficient && finalReviewRetries < MAX_FINAL_REVIEW_RETRIES) {
        finalReviewRetries += 1;
        messages.push({
          role: 'assistant',
          content: JSON.stringify(action)
        });
        messages.push({
          role: 'user',
          content: [
            '内部质检未通过，请继续使用工具或重写 final。',
            `原因：${review.reason || '答案没有充分满足客户目标。'}`,
            `下一步：${review.retryInstruction || '补齐客户要求的具体结果；如果仍找不到，要展示已尝试的不同方向并简短说明。'}`
          ].join('\n')
        });
        continue;
      }

      return {
        answer: stripTrailingShopUpsell(action.answer, toolTrace),
        model,
        webSources,
        webSearchAttempted,
        webSearchQuery,
        webSearchReason,
        webSearchError,
        toolTrace
      };
    }

    messages.push({
      role: 'assistant',
      content: JSON.stringify(action)
    });

    try {
      const result = await executeAgentTool(action, intent);
      if (result.webSearchAttempted) {
        webSearchAttempted = true;
        webSearchQuery = result.webSearchQuery || webSearchQuery;
        webSearchReason = result.webSearchReason || webSearchReason;
        webSources.push(...result.webSources);
      }

      const observation = truncateObservation(result.observation);
      toolTrace.push({
        tool: action.tool,
        input: action.input ?? {},
        status: 'success',
        summary: observation.slice(0, 240)
      });
      messages.push({
        role: 'user',
        content: `内部观察：\n${observation}`
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : '工具执行失败';
      if (action.tool === 'web_search') {
        webSearchAttempted = true;
        webSearchError = message;
      }
      toolTrace.push({
        tool: action.tool,
        input: action.input ?? {},
        status: 'error',
        summary: message
      });
      messages.push({
        role: 'user',
        content: `内部观察：${action.tool} 执行失败：${message}。请根据已有信息继续；不要假装拿到了失败工具的结果。`
      });
    }
  }

  messages.push({
    role: 'user',
    content: '内部提醒：工具步数已达上限。请现在输出 final JSON；如信息不足，诚实说明缺口，不要编造。'
  });

  const completion = await requestAgentCompletion(messages);
  model = completion.model;
  const action = normalizeAction(completion.content);
  if (action.type !== 'final') {
    throw new Error('Agent reached step limit but did not provide final answer.');
  }

  return {
    answer: stripTrailingShopUpsell(action.answer, toolTrace),
    model,
    webSources,
    webSearchAttempted,
    webSearchQuery,
    webSearchReason,
    webSearchError,
    toolTrace
  };
}
