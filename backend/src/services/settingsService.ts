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
  corpId: string;
  secret: string;
  token: string;
  encodingAesKey: string;
  openKfid: string;
};

export type PublicWecomSettings = {
  enabled: boolean;
  corpId: string;
  secretSet: boolean;
  secretPreview: string;
  tokenSet: boolean;
  tokenPreview: string;
  encodingAesKeySet: boolean;
  encodingAesKeyPreview: string;
  openKfid: string;
  callbackPath: string;
};

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
const DEFAULT_SEARCH_BASE_URL = 'https://api.bochaai.com/v1';

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
    corpId: readSetting('wecom.corpId') || process.env.WECOM_CORP_ID || '',
    secret: readSetting('wecom.secret') || process.env.WECOM_SECRET || '',
    token: readSetting('wecom.token') || process.env.WECOM_TOKEN || '',
    encodingAesKey: readSetting('wecom.encodingAesKey') || process.env.WECOM_ENCODING_AES_KEY || '',
    openKfid: readSetting('wecom.openKfid') || process.env.WECOM_OPEN_KFID || ''
  };
}

export function getPublicWecomSettings(): PublicWecomSettings {
  const settings = getWecomSettings();

  return {
    enabled: settings.enabled,
    corpId: settings.corpId,
    secretSet: Boolean(settings.secret),
    secretPreview: previewSecret(settings.secret),
    tokenSet: Boolean(settings.token),
    tokenPreview: previewSecret(settings.token),
    encodingAesKeySet: Boolean(settings.encodingAesKey),
    encodingAesKeyPreview: previewSecret(settings.encodingAesKey),
    openKfid: settings.openKfid,
    callbackPath: '/api/channels/wecom/kf/callback'
  };
}

export function updateWecomSettings(input: {
  enabled?: boolean;
  corpId?: string;
  secret?: string;
  token?: string;
  encodingAesKey?: string;
  openKfid?: string;
}) {
  if (typeof input.enabled === 'boolean') {
    writeSetting('wecom.enabled', String(input.enabled));
  }

  const corpId = input.corpId?.trim();
  const secret = input.secret?.trim();
  const token = input.token?.trim();
  const encodingAesKey = input.encodingAesKey?.trim();
  const openKfid = input.openKfid?.trim();

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
