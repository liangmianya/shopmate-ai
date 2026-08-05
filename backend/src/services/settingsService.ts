import { db } from '../db/database.js';

export type LlmSettings = {
  baseUrl: string;
  model: string;
  apiKey: string;
};

export type PublicLlmSettings = {
  baseUrl: string;
  model: string;
  apiKeySet: boolean;
  apiKeyPreview: string;
};

export type EmbeddingSettings = {
  baseUrl: string;
  model: string;
  apiKey: string;
};

export type PublicEmbeddingSettings = {
  baseUrl: string;
  model: string;
  apiKeySet: boolean;
  apiKeyPreview: string;
};

export type SearchSettings = {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  count: number;
};

export type PublicSearchSettings = {
  enabled: boolean;
  baseUrl: string;
  apiKeySet: boolean;
  apiKeyPreview: string;
  count: number;
};

export type WecomSettings = {
  enabled: boolean;
  botId: string;
  corpId: string;
  secret: string;
  token: string;
  encodingAesKey: string;
  openKfid: string;
};

export type PublicWecomSettings = {
  enabled: boolean;
  botId: string;
  secretSet: boolean;
  secretPreview: string;
  websocketUrl: string;
  connectionMode: 'long_connection';
};

export type SystemPromptSettings = {
  prompt: string;
  customized: boolean;
};

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
const DEFAULT_SEARCH_BASE_URL = 'https://api.bochaai.com/v1';

export const DEFAULT_BUSINESS_SYSTEM_PROMPT = [
  '你是 ShopMate AI，一名面向电商店铺的中文智能助手。',
  '服务目标：基于商品资料、知识库和店铺规则，协助客户完成商品咨询、选购、售后和订单相关沟通，并协助店主完成运营分析与知识库维护。',
  '沟通要求：表达准确、自然、简洁；不确定的信息要明确说明，不编造商品、价格、库存、物流、活动或售后结论。',
  '业务边界：涉及退款、赔付、投诉、质量争议或需要人工核实的事项，说明处理路径并建议补充订单信息或相关凭证，不作超出店铺规则的承诺。',
  '请以当前知识库、商品库和用户提供的信息为准；当资料不足时，先提出最关键的补充问题或给出明确的下一步。'
].join('\n');

const now = () => new Date().toISOString();

function readSetting(key: string) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

function writeSetting(key: string, value: string) {
  db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, now());
}

export function getLlmSettings(): LlmSettings {
  return {
    baseUrl: readSetting('llm.baseUrl') || process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL,
    model: readSetting('llm.model') || process.env.LLM_MODEL || process.env.OPENAI_MODEL || DEFAULT_MODEL,
    apiKey: readSetting('llm.apiKey') || process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || ''
  };
}

export function getPublicLlmSettings(): PublicLlmSettings {
  const settings = getLlmSettings();
  const preview = settings.apiKey.length > 8
    ? `${settings.apiKey.slice(0, 4)}...${settings.apiKey.slice(-4)}`
    : '';

  return {
    baseUrl: settings.baseUrl,
    model: settings.model,
    apiKeySet: Boolean(settings.apiKey),
    apiKeyPreview: preview
  };
}

export function updateLlmSettings(input: { baseUrl?: string; model?: string; apiKey?: string }) {
  const baseUrl = input.baseUrl?.trim();
  const model = input.model?.trim();
  const apiKey = input.apiKey?.trim();

  if (baseUrl) {
    writeSetting('llm.baseUrl', baseUrl.replace(/\/$/, ''));
  }

  if (model) {
    writeSetting('llm.model', model);
  }

  if (apiKey) {
    writeSetting('llm.apiKey', apiKey);
  }

  return getPublicLlmSettings();
}

export function getEmbeddingSettings(): EmbeddingSettings {
  return {
    baseUrl: readSetting('embedding.baseUrl') || process.env.EMBEDDING_BASE_URL || process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL,
    model: readSetting('embedding.model') || process.env.EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL,
    apiKey: readSetting('embedding.apiKey') || process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || ''
  };
}

export function getPublicEmbeddingSettings(): PublicEmbeddingSettings {
  const settings = getEmbeddingSettings();
  const preview = settings.apiKey.length > 8
    ? `${settings.apiKey.slice(0, 4)}...${settings.apiKey.slice(-4)}`
    : '';

  return {
    baseUrl: settings.baseUrl,
    model: settings.model,
    apiKeySet: Boolean(settings.apiKey),
    apiKeyPreview: preview
  };
}

export function updateEmbeddingSettings(input: { baseUrl?: string; model?: string; apiKey?: string }) {
  const baseUrl = input.baseUrl?.trim();
  const model = input.model?.trim();
  const apiKey = input.apiKey?.trim();

  if (baseUrl) {
    writeSetting('embedding.baseUrl', baseUrl.replace(/\/$/, ''));
  }

  if (model) {
    writeSetting('embedding.model', model);
  }

  if (apiKey) {
    writeSetting('embedding.apiKey', apiKey);
  }

  return getPublicEmbeddingSettings();
}

export function getSearchSettings(): SearchSettings {
  const enabled = readSetting('search.enabled');
  const count = Number(readSetting('search.count') || process.env.SEARCH_COUNT || 5);

  return {
    enabled: enabled === undefined ? false : enabled === 'true',
    baseUrl: readSetting('search.baseUrl') || process.env.SEARCH_BASE_URL || DEFAULT_SEARCH_BASE_URL,
    apiKey: readSetting('search.apiKey') || process.env.SEARCH_API_KEY || process.env.BOCHA_API_KEY || '',
    count: Number.isFinite(count) ? Math.max(1, Math.min(10, count)) : 5
  };
}

export function getPublicSearchSettings(): PublicSearchSettings {
  const settings = getSearchSettings();
  const preview = settings.apiKey.length > 8
    ? `${settings.apiKey.slice(0, 4)}...${settings.apiKey.slice(-4)}`
    : '';

  return {
    enabled: settings.enabled,
    baseUrl: settings.baseUrl,
    apiKeySet: Boolean(settings.apiKey),
    apiKeyPreview: preview,
    count: settings.count
  };
}

export function updateSearchSettings(input: { enabled?: boolean; baseUrl?: string; apiKey?: string; count?: number }) {
  const baseUrl = input.baseUrl?.trim();
  const apiKey = input.apiKey?.trim();

  if (typeof input.enabled === 'boolean') {
    writeSetting('search.enabled', String(input.enabled));
  }

  if (baseUrl) {
    writeSetting('search.baseUrl', baseUrl.replace(/\/$/, ''));
  }

  if (apiKey) {
    writeSetting('search.apiKey', apiKey);
  }

  if (typeof input.count === 'number' && Number.isFinite(input.count)) {
    writeSetting('search.count', String(Math.max(1, Math.min(10, Math.floor(input.count)))));
  }

  return getPublicSearchSettings();
}

function previewSecret(value: string) {
  return value.length > 8 ? `${value.slice(0, 4)}...${value.slice(-4)}` : '';
}

export function getWecomSettings(): WecomSettings {
  const enabled = readSetting('wecom.enabled');

  return {
    enabled: enabled === undefined ? false : enabled === 'true',
    botId: readSetting('wecom.botId') || process.env.WECOM_BOT_ID || process.env.WECOM_AIBOT_ID || '',
    corpId: readSetting('wecom.corpId') || process.env.WECOM_CORP_ID || '',
    secret: readSetting('wecom.secret') || process.env.WECOM_AIBOT_SECRET || process.env.WECOM_SECRET || '',
    token: readSetting('wecom.token') || process.env.WECOM_TOKEN || '',
    encodingAesKey: readSetting('wecom.encodingAesKey') || process.env.WECOM_ENCODING_AES_KEY || '',
    openKfid: readSetting('wecom.openKfid') || process.env.WECOM_OPEN_KFID || ''
  };
}

export function getPublicWecomSettings(): PublicWecomSettings {
  const settings = getWecomSettings();

  return {
    enabled: settings.enabled,
    botId: settings.botId,
    secretSet: Boolean(settings.secret),
    secretPreview: previewSecret(settings.secret),
    websocketUrl: 'wss://openws.work.weixin.qq.com',
    connectionMode: 'long_connection'
  };
}

export function updateWecomSettings(input: {
  enabled?: boolean;
  botId?: string;
  corpId?: string;
  secret?: string;
  token?: string;
  encodingAesKey?: string;
  openKfid?: string;
}) {
  if (typeof input.enabled === 'boolean') {
    writeSetting('wecom.enabled', String(input.enabled));
  }

  const botId = input.botId?.trim();
  const corpId = input.corpId?.trim();
  const secret = input.secret?.trim();
  const token = input.token?.trim();
  const encodingAesKey = input.encodingAesKey?.trim();
  const openKfid = input.openKfid?.trim();

  if (botId) {
    writeSetting('wecom.botId', botId);
  }

  if (corpId) {
    writeSetting('wecom.corpId', corpId);
  }

  if (secret) {
    writeSetting('wecom.secret', secret);
  }

  if (token) {
    writeSetting('wecom.token', token);
  }

  if (encodingAesKey) {
    writeSetting('wecom.encodingAesKey', encodingAesKey);
  }

  if (openKfid) {
    writeSetting('wecom.openKfid', openKfid);
  }

  return getPublicWecomSettings();
}

export function getSystemPromptSettings(): SystemPromptSettings {
  const savedPrompt = readSetting('agent.systemPrompt');

  return {
    prompt: savedPrompt || DEFAULT_BUSINESS_SYSTEM_PROMPT,
    customized: Boolean(savedPrompt)
  };
}

export function updateSystemPromptSettings(input: { prompt: string }) {
  const prompt = input.prompt.trim();
  writeSetting('agent.systemPrompt', prompt);
  return getSystemPromptSettings();
}

export function resetSystemPromptSettings() {
  db.prepare('DELETE FROM app_settings WHERE key = ?').run('agent.systemPrompt');
  return getSystemPromptSettings();
}
