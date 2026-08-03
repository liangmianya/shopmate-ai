export type RetrievedChunk = {
  id: string;
  type: string;
  title: string;
  content: string;
  tags: string[];
  source: string;
  score: number;
};

export type QaKnowledge = {
  id: string;
  type: string;
  question: string;
  answer: string;
  tags: string[];
  source: string;
  createdAt: string;
};

export type ProductKnowledge = {
  id: string;
  name: string;
  brand: string;
  category: string;
  price: number;
  stock: number;
  features: string;
  sizeGuide: string;
  targetUsers: string;
  scene: string;
  purchaseUrl: string;
};

export type WebSource = {
  title: string;
  url: string;
  snippet: string;
  summary: string;
  siteName: string;
  datePublished?: string;
};

export type ChatResponse = {
  conversationId: string;
  answer: string;
  intent: string;
  intentLabel: string;
  emotion: string;
  confidence: number;
  manualRequired: boolean;
  manualSummary: string;
  retrieved: RetrievedChunk[];
  answerSource: 'llm' | 'local';
  model?: string;
  fallbackReason?: string;
  webSearchUsed: boolean;
  webSources: WebSource[];
  webSearchError?: string;
};

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type AgentTraceStep = {
  label: string;
  detail: string;
  status: 'done' | 'pending' | 'blocked';
};

export type KnowledgeSuggestion = {
  id: string;
  title: string;
  content: string;
  reason: string;
  status: string;
  covered?: boolean;
};

export type AgentToolResult = {
  id: string;
  toolName: string;
  input: unknown;
  output: unknown;
  status: 'success' | 'error';
};

export type AgentResponse = {
  taskId: string;
  summary: string;
  analysis: {
    total: number;
    manualCount: number;
    negativeCount: number;
    topIntents: Array<{ intent: string; count: number }>;
    candidateQuestions: string[];
  };
  suggestions: KnowledgeSuggestion[];
  trace: AgentTraceStep[];
  toolResults?: AgentToolResult[];
  error?: string;
};

export type AgentSkill = {
  id: string;
  name: string;
  description: string;
  version: string;
  instructions: string;
  whenToUse: string;
  inputPlaceholder: string;
  toolPolicy: {
    preferred: string[];
    required: string[];
    forbidden: string[];
  };
  resources: Array<{
    id: string;
    title: string;
    type: 'reference' | 'template' | 'checklist' | 'example';
    description: string;
    content: string;
  }>;
  outputContract: {
    format: 'markdown' | 'table' | 'json' | 'mixed';
    requiredSections: string[];
    rules: string[];
  };
  scripts: Array<{
    id: string;
    name: string;
    description: string;
    command: string;
    enabled: boolean;
    risk: 'low' | 'medium' | 'high';
  }>;
  tags: string[];
  source: 'builtin' | 'imported';
  enabled: boolean;
};

export type LlmSettings = {
  baseUrl: string;
  model: string;
  apiKeySet: boolean;
  apiKeyPreview: string;
};

export type EmbeddingSettings = {
  baseUrl: string;
  model: string;
  apiKeySet: boolean;
  apiKeyPreview: string;
};

export type SearchSettings = {
  enabled: boolean;
  baseUrl: string;
  apiKeySet: boolean;
  apiKeyPreview: string;
  count: number;
};

export type WecomSettings = {
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

export type SystemPromptSettings = {
  prompt: string;
  customized: boolean;
};

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

export function sendChat(message: string, conversationId?: string, history: ChatMessage[] = []) {
  return request<ChatResponse>('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message, conversationId, history })
  });
}

export async function sendChatStream(
  message: string,
  conversationId: string | undefined,
  history: ChatMessage[],
  onChunk: (content: string) => void
) {
  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, conversationId, history })
  });

  if (!response.ok || !response.body) {
    throw new Error(`Request failed: ${response.status}`);
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = 'message';
  let final: ChatResponse | undefined;

  function handleEvent(event: string, data: string) {
    const payload = JSON.parse(data);
    if (event === 'chunk') {
      onChunk(payload.content ?? '');
    }
    if (event === 'done') {
      final = payload as ChatResponse;
    }
    if (event === 'error') {
      throw new Error(payload.message ?? 'Stream failed');
    }
  }

  const reader = response.body.getReader();

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');

    while (boundary >= 0) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const dataLines: string[] = [];
      eventName = 'message';

      for (const line of rawEvent.split('\n')) {
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trim());
        }
      }

      if (dataLines.length) {
        handleEvent(eventName, dataLines.join('\n'));
      }

      boundary = buffer.indexOf('\n\n');
    }
  }

  if (!final) {
    throw new Error('Stream ended without final response');
  }

  return final;
}

export function loadAgentSkills() {
  return request<{ skills: AgentSkill[] }>('/api/agent/skills');
}

export function saveAgentSkillPackage(input: Omit<AgentSkill, 'source'> & { source?: AgentSkill['source'] }) {
  return request<{ skill: AgentSkill }>('/api/agent/skills', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export function runAgentTask(input: string, signal?: AbortSignal, options: { riskConfirmed?: boolean; skillId?: string } = {}) {
  return request<AgentResponse>('/api/agent/tasks', {
    method: 'POST',
    signal,
    body: JSON.stringify({ input, riskConfirmed: options.riskConfirmed, skillId: options.skillId })
  });
}

export function confirmAgentTool(input: { toolName: 'delete_products' | 'delete_knowledge_entries'; toolInput: Record<string, unknown> }) {
  return request<{ toolName: string; output: unknown }>('/api/agent/tools/confirm', {
    method: 'POST',
    body: JSON.stringify({
      toolName: input.toolName,
      input: input.toolInput
    })
  });
}

export async function runAgentTaskStream(
  input: string,
  signal: AbortSignal | undefined,
  handlers: {
    onChunk: (content: string) => void;
    onTrace?: (step: AgentTraceStep) => void;
    onTool?: (tool: AgentToolResult) => void;
  },
  options: { riskConfirmed?: boolean; skillId?: string } = {}
) {
  const response = await fetch('/api/agent/tasks/stream', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input, riskConfirmed: options.riskConfirmed, skillId: options.skillId })
  });

  if (!response.ok || !response.body) {
    throw new Error(`Request failed: ${response.status}`);
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let eventName = 'message';
  let final: AgentResponse | undefined;

  function handleEvent(event: string, data: string) {
    const payload = JSON.parse(data);
    if (event === 'chunk') {
      handlers.onChunk(payload.content ?? '');
    }
    if (event === 'trace') {
      handlers.onTrace?.(payload as AgentTraceStep);
    }
    if (event === 'tool') {
      handlers.onTool?.(payload as AgentToolResult);
    }
    if (event === 'done') {
      final = payload as AgentResponse;
    }
    if (event === 'error') {
      throw new Error(payload.message ?? 'Agent stream failed');
    }
  }

  const reader = response.body.getReader();

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');

    while (boundary >= 0) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const dataLines: string[] = [];
      eventName = 'message';

      for (const line of rawEvent.split('\n')) {
        if (line.startsWith('event:')) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).trim());
        }
      }

      if (dataLines.length) {
        handleEvent(eventName, dataLines.join('\n'));
      }

      boundary = buffer.indexOf('\n\n');
    }
  }

  if (!final) {
    throw new Error('Stream ended without final response');
  }

  return final;
}

export function loadSuggestions() {
  return request<{ suggestions: KnowledgeSuggestion[] }>('/api/agent/suggestions');
}

export function approveSuggestion(id: string) {
  return request<KnowledgeSuggestion>(`/api/agent/suggestions/${id}/approve`, {
    method: 'POST'
  });
}

export function deleteSuggestion(id: string) {
  return request<KnowledgeSuggestion>(`/api/agent/suggestions/${id}`, {
    method: 'DELETE'
  });
}

export function loadProducts() {
  return request<{ products: ProductKnowledge[] }>('/api/products');
}

export function createProducts(items: Array<{
  name: string;
  brand: string;
  category: string;
  price: number;
  stock: number;
  features: string;
  sizeGuide?: string;
  targetUsers?: string;
  scene?: string;
  purchaseUrl?: string;
}>) {
  return request<{ products: ProductKnowledge[]; skippedCount: number }>('/api/products', {
    method: 'POST',
    body: JSON.stringify({ items })
  });
}

export function deleteProduct(id: string) {
  return request<{ deleted: ProductKnowledge }>(`/api/products/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });
}

export function loadKnowledge() {
  return request<{ chunks: QaKnowledge[] }>('/api/knowledge');
}

export function createKnowledge(items: Array<{
  question: string;
  answer: string;
  tags: string[];
  type?: string;
}>) {
  return request<{ chunks: QaKnowledge[] }>('/api/knowledge', {
    method: 'POST',
    body: JSON.stringify({ items })
  });
}

export function deleteKnowledge(id: string) {
  return request<{ deleted: QaKnowledge }>(`/api/knowledge/${encodeURIComponent(id)}`, {
    method: 'DELETE'
  });
}

export function loadLlmSettings() {
  return request<LlmSettings>('/api/settings/llm');
}

export function saveLlmSettings(input: { baseUrl: string; model: string; apiKey?: string }) {
  return request<LlmSettings>('/api/settings/llm', {
    method: 'PUT',
    body: JSON.stringify(input)
  });
}

export function loadEmbeddingSettings() {
  return request<EmbeddingSettings>('/api/settings/embedding');
}

export function saveEmbeddingSettings(input: { baseUrl: string; model: string; apiKey?: string }) {
  return request<EmbeddingSettings>('/api/settings/embedding', {
    method: 'PUT',
    body: JSON.stringify(input)
  });
}

export function loadSearchSettings() {
  return request<SearchSettings>('/api/settings/search');
}

export function saveSearchSettings(input: { enabled: boolean; baseUrl: string; apiKey?: string; count: number }) {
  return request<SearchSettings>('/api/settings/search', {
    method: 'PUT',
    body: JSON.stringify(input)
  });
}

export function loadWecomSettings() {
  return request<WecomSettings>('/api/settings/wecom');
}

export function saveWecomSettings(input: {
  enabled: boolean;
  corpId: string;
  secret?: string;
  token?: string;
  encodingAesKey?: string;
  openKfid: string;
}) {
  return request<WecomSettings>('/api/settings/wecom', {
    method: 'PUT',
    body: JSON.stringify(input)
  });
}

export function loadSystemPromptSettings() {
  return request<SystemPromptSettings>('/api/settings/system-prompt');
}

export function saveSystemPromptSettings(input: { prompt: string }) {
  return request<SystemPromptSettings>('/api/settings/system-prompt', {
    method: 'PUT',
    body: JSON.stringify(input)
  });
}

export function resetSystemPromptSettings() {
  return request<SystemPromptSettings>('/api/settings/system-prompt', {
    method: 'DELETE'
  });
}
