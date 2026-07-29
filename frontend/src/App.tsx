import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Archive,
  Bot,
  Check,
  ChevronRight,
  ClipboardCheck,
  Database,
  FileText,
  KeyRound,
  Layers,
  Link,
  MessagesSquare,
  Package,
  Play,
  Plus,
  RefreshCcw,
  Search,
  Send,
  Settings2,
  Trash2,
  Wrench,
  X
} from 'lucide-react';
import {
  Books,
  CaretRight,
  ChartDonut,
  ChatsCircle,
  FileText as PhosphorFileText,
  GearSix,
  Robot,
  ShareNetwork
} from '@phosphor-icons/react';
import type {
  Icon as PhosphorIcon
} from '@phosphor-icons/react';
import {
  AgentResponse,
  AgentToolResult,
  ChatResponse,
  ChatMessage,
  EmbeddingSettings,
  KnowledgeSuggestion,
  LlmSettings,
  ProductKnowledge,
  QaKnowledge,
  SearchSettings,
  SystemPromptSettings,
  WecomSettings,
  approveSuggestion,
  confirmAgentTool,
  createKnowledge,
  createProducts,
  deleteKnowledge,
  deleteProduct,
  loadEmbeddingSettings,
  loadKnowledge,
  loadLlmSettings,
  loadProducts,
  loadSearchSettings,
  loadSuggestions,
  loadSystemPromptSettings,
  loadWecomSettings,
  resetSystemPromptSettings,
  runAgentTaskStream,
  saveEmbeddingSettings,
  saveLlmSettings,
  saveSearchSettings,
  saveSystemPromptSettings,
  saveWecomSettings,
  sendChatStream
} from './api';
import shopmateLogo from './assets/shopmate-logo.png';
import katex from 'katex';
import 'katex/dist/katex.min.css';

type WorkspaceTab = 'agent' | 'customer' | 'knowledge' | 'settings' | 'channels' | 'analysis' | 'reports';

type Message = ChatMessage;

type EvidenceFilter = 'all' | 'knowledge' | 'web';

type EvidenceItem = {
  id: string;
  kind: 'knowledge' | 'web';
  label: string;
  title: string;
  meta: string;
  summary: string;
  url?: string;
};

type AgentMessage =
  | {
      id: string;
      role: 'user';
      content: string;
    }
  | {
      id: string;
      role: 'assistant';
      content: string;
      result?: AgentResponse;
    };

const tabs: Array<{
  id: WorkspaceTab;
  label: string;
  description: string;
  icon: PhosphorIcon;
}> = [
  {
    id: 'agent',
    label: '运营 Agent',
    description: '对话式任务执行',
    icon: Robot
  },
  {
    id: 'customer',
    label: '智能客服',
    description: 'RAG 客户接待',
    icon: ChatsCircle
  },
  {
    id: 'knowledge',
    label: '知识库',
    description: 'FAQ 审核入库',
    icon: Books
  },
  {
    id: 'settings',
    label: '系统设置',
    description: '提示词与模型配置',
    icon: GearSix
  },
  {
    id: 'channels',
    label: '渠道接入',
    description: '企业微信客服',
    icon: ShareNetwork
  },
  {
    id: 'analysis',
    label: '对话分析',
    description: '高频问题洞察',
    icon: ChartDonut
  },
  {
    id: 'reports',
    label: '运营报表',
    description: '日报和指标',
    icon: PhosphorFileText
  }
];

const demoQuestions = [
  '我想买一款适合通勤用的商品，预算 200 左右，有推荐吗？',
  '我收到后发现不太合适，想退货，需要满足什么条件？',
  '这个商品有购买链接吗？'
];

const formatPercent = (value: number) => `${Math.round(value * 100)}%`;

function cx(...items: Array<string | false | undefined>) {
  return items.filter(Boolean).join(' ');
}

function createClientId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'warn' | 'good' }) {
  return (
    <div className={cx('stat', tone)}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EmptyState({ text, icon: Icon = Archive }: { text: string; icon?: typeof Archive }) {
  return (
    <div className="empty">
      <Icon size={20} />
      <span>{text}</span>
    </div>
  );
}

function MathFormula({ value, block = false }: { value: string; block?: boolean }) {
  try {
    return (
      <span
        className={cx('mathFormula', block && 'block')}
        dangerouslySetInnerHTML={{
          __html: katex.renderToString(value, {
            displayMode: block,
            throwOnError: false,
            strict: false,
            trust: false
          })
        }}
      />
    );
  } catch {
    return <code className={cx('mathFallback', block && 'block')}>{block ? `$$${value}$$` : `$${value}$`}</code>;
  }
}

function renderInlineMarkdown(text: string) {
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  const tokenPattern = /(\*\*[^*]+\*\*|\\\((.+?)\\\)|(?<!\$)\$(?!\$)(.+?)(?<!\$)\$(?!\$))/g;
  const pushText = (value: string) => {
    if (!value) {
      return;
    }
    nodes.push(<span key={`text-${nodes.length}`}>{value}</span>);
  };

  for (const match of text.matchAll(tokenPattern)) {
    const token = match[0];
    const index = match.index ?? 0;
    pushText(text.slice(cursor, index));

    if (token.startsWith('**') && token.endsWith('**')) {
      nodes.push(<strong key={`strong-${nodes.length}`}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<MathFormula key={`math-${nodes.length}`} value={match[2] ?? match[3] ?? ''} />);
    }

    cursor = index + token.length;
  }

  pushText(text.slice(cursor));
  return nodes;
}

function parseMarkdownTableRow(line: string) {
  const trimmed = line.trim();
  const normalized = trimmed.startsWith('|') && trimmed.endsWith('|')
    ? trimmed.slice(1, -1)
    : trimmed;
  return normalized.split('|').map((cell) => cell.trim());
}

function isMarkdownTableSeparator(line: string) {
  const cells = parseMarkdownTableRow(line);
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function isMarkdownTableCandidate(line: string) {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) {
    return false;
  }
  return parseMarkdownTableRow(trimmed).length >= 2;
}

function MarkdownMessage({ content }: { content: string }) {
  const lines = content.split('\n');
  const blocks: React.ReactNode[] = [];
  let listItems: string[] = [];
  let tableLines: string[] = [];
  let mathLines: string[] = [];
  let inMathBlock = false;

  const pushParagraph = (line: string, key: string | number) => {
    const trimmed = line.trim();
    if (!trimmed) {
      blocks.push(<br key={`br-${key}`} />);
      return;
    }
    blocks.push(<p key={`p-${key}`}>{renderInlineMarkdown(trimmed)}</p>);
  };

  const flushList = () => {
    if (!listItems.length) {
      return;
    }
    blocks.push(
      <ul key={`list-${blocks.length}`}>
        {listItems.map((item, index) => (
          <li key={`${item}-${index}`}>{renderInlineMarkdown(item)}</li>
        ))}
      </ul>
    );
    listItems = [];
  };

  const flushTable = () => {
    if (!tableLines.length) {
      return;
    }

    if (tableLines.length >= 2 && isMarkdownTableSeparator(tableLines[1])) {
      const headers = parseMarkdownTableRow(tableLines[0]);
      const rows = tableLines.slice(2).map(parseMarkdownTableRow);
      blocks.push(
        <div key={`table-${blocks.length}`} className="markdownTableWrap">
          <table>
            <thead>
              <tr>
                {headers.map((header, index) => (
                  <th key={`${header}-${index}`}>{renderInlineMarkdown(header)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rowIndex) => (
                <tr key={`row-${rowIndex}`}>
                  {headers.map((_, cellIndex) => (
                    <td key={`cell-${rowIndex}-${cellIndex}`}>{renderInlineMarkdown(row[cellIndex] ?? '')}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    } else {
      tableLines.forEach((line, index) => pushParagraph(line, `table-fallback-${blocks.length}-${index}`));
    }

    tableLines = [];
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const singleLineMath = trimmed.match(/^\$\$([\s\S]+)\$\$$/) ?? trimmed.match(/^\\\[([\s\S]+)\\\]$/);
    const listMatch = trimmed.match(/^[-*]\s+(.+)$/) ?? trimmed.match(/^\d+[.)]\s+(.+)$/);

    if (inMathBlock) {
      if (trimmed.endsWith('$$')) {
        mathLines.push(trimmed.slice(0, -2));
        blocks.push(<MathFormula key={`math-block-${index}`} value={mathLines.join('\n')} block />);
        mathLines = [];
        inMathBlock = false;
      } else {
        mathLines.push(line);
      }
      return;
    }

    if (singleLineMath) {
      flushTable();
      flushList();
      blocks.push(<MathFormula key={`math-${index}`} value={singleLineMath[1]} block />);
      return;
    }

    if (trimmed.startsWith('$$')) {
      flushTable();
      flushList();
      const rest = trimmed.slice(2);
      if (rest) {
        mathLines.push(rest);
      }
      inMathBlock = true;
      return;
    }

    if (isMarkdownTableCandidate(trimmed)) {
      flushList();
      tableLines.push(trimmed);
      return;
    }

    flushTable();

    if (listMatch) {
      listItems.push(listMatch[1]);
      return;
    }

    flushList();
    pushParagraph(trimmed, index);
  });

  flushTable();
  flushList();

  if (inMathBlock) {
    blocks.push(<code key="unfinished-math" className="mathFallback block">{`$$${mathLines.join('\n')}`}</code>);
  }

  return <div className="markdownMessage">{blocks}</div>;
}

function PageHeader({
  eyebrow,
  title,
  description,
  action
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="workspaceHeader">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {description && <p className="pageDescription">{description}</p>}
      </div>
      {action}
    </header>
  );
}

function compactText(value: string, limit = 110) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}...` : normalized;
}

function getHost(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function buildEvidenceItems(result: ChatResponse): EvidenceItem[] {
  const knowledgeItems = result.retrieved.map((chunk) => ({
    id: `knowledge:${chunk.id}`,
    kind: 'knowledge' as const,
    label: chunk.type,
    title: chunk.title,
    meta: `知识库 · ${chunk.source}`,
    summary: chunk.content
  }));

  const webItems = result.webSources.map((source) => ({
    id: `web:${source.url}`,
    kind: 'web' as const,
    label: '联网',
    title: source.title,
    meta: source.siteName || getHost(source.url),
    summary: source.summary || source.snippet || source.url,
    url: source.url
  }));

  return [...knowledgeItems, ...webItems];
}

function EvidenceList({
  items,
  filter,
  onFilterChange,
  webSearchError
}: {
  items: EvidenceItem[];
  filter: EvidenceFilter;
  onFilterChange: (filter: EvidenceFilter) => void;
  webSearchError?: string;
}) {
  const knowledgeCount = items.filter((item) => item.kind === 'knowledge').length;
  const webCount = items.filter((item) => item.kind === 'web').length;
  const filteredItems = filter === 'all' ? items : items.filter((item) => item.kind === filter);

  return (
    <div className="evidencePanel">
      <div className="evidenceTabs" role="tablist" aria-label="依据来源筛选">
        <button className={cx(filter === 'all' && 'active')} onClick={() => onFilterChange('all')} type="button">
          全部 {items.length}
        </button>
        <button className={cx(filter === 'knowledge' && 'active')} onClick={() => onFilterChange('knowledge')} type="button">
          知识库 {knowledgeCount}
        </button>
        <button className={cx(filter === 'web' && 'active')} onClick={() => onFilterChange('web')} type="button">
          联网 {webCount}
        </button>
      </div>

      {webSearchError && filter !== 'knowledge' && <p className="evidenceError">{webSearchError}</p>}

      {filteredItems.length ? (
        <div className="evidenceList">
          {filteredItems.map((item) => {
            const content = (
              <>
                <div className="evidenceMeta">
                  <span>{item.kind === 'knowledge' ? '知识库' : '联网'}</span>
                  <small>{item.label}</small>
                </div>
                <strong>{item.title}</strong>
                <em>{item.meta}</em>
                <p>{compactText(item.summary)}</p>
              </>
            );

            return item.url ? (
              <a key={item.id} className="evidenceItem" href={item.url} target="_blank" rel="noreferrer">
                {content}
              </a>
            ) : (
              <article key={item.id} className="evidenceItem">
                {content}
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState text="暂无对应依据。" icon={Search} />
      )}
    </div>
  );
}

function compactToolOutput(value: unknown, limit = 1200) {
  if (value === undefined || value === null || value === '') {
    return '无返回内容';
  }

  const raw = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return raw.length > limit ? `${raw.slice(0, limit)}\n...已截断 ${raw.length - limit} 字符` : raw;
}

type AgentKnowledgeReference = {
  id: string;
  title: string;
  content: string;
  source?: string;
  type?: string;
};

function isKnowledgeReference(value: unknown): value is AgentKnowledgeReference {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const item = value as Partial<AgentKnowledgeReference>;
  return typeof item.id === 'string' && typeof item.title === 'string' && typeof item.content === 'string';
}

function collectAgentKnowledgeReferences(result?: AgentResponse) {
  const references = new Map<string, AgentKnowledgeReference>();

  for (const tool of result?.toolResults ?? []) {
    if (tool.toolName !== 'search_knowledge_entries' || tool.status !== 'success') {
      continue;
    }

    const output = tool.output as unknown;
    const candidates = Array.isArray(output)
      ? output
      : output && typeof output === 'object' && Array.isArray((output as { matches?: unknown[] }).matches)
        ? (output as { matches: unknown[] }).matches
        : [];

    for (const item of candidates) {
      if (isKnowledgeReference(item)) {
        references.set(item.id, item);
      }
    }
  }

  return [...references.values()];
}

type AgentExecutionItem =
  | {
      kind: 'thought';
      key: string;
      title: string;
      detail: string;
      status: AgentResponse['trace'][number]['status'];
    }
  | {
      kind: 'tool';
      key: string;
      title: string;
      detail?: string;
      tool: AgentToolResult;
    };

function isToolTraceStep(step: AgentResponse['trace'][number]) {
  return step.label.includes('工具调用') || step.detail.includes('执行成功') || step.detail.includes('执行失败');
}

function isPlanningTraceStep(step: AgentResponse['trace'][number]) {
  return step.label.includes('规划') || step.detail.includes('模型请求调用');
}

function formatThoughtTitle(step: AgentResponse['trace'][number]) {
  if (isPlanningTraceStep(step)) {
    return '思考 / 规划';
  }
  if (step.label.includes('总结')) {
    return '总结';
  }
  if (step.label.includes('启动')) {
    return '启动';
  }
  return step.label;
}

function findMatchingTool(
  step: AgentResponse['trace'][number],
  tools: AgentToolResult[],
  consumed: Set<number>,
  fallbackStart: number
) {
  const exactIndex = tools.findIndex((tool, index) => (
    !consumed.has(index) && (step.detail.includes(tool.toolName) || step.label.includes(tool.toolName))
  ));
  if (exactIndex >= 0) {
    return exactIndex;
  }

  for (let index = fallbackStart; index < tools.length; index += 1) {
    if (!consumed.has(index)) {
      return index;
    }
  }

  return -1;
}

function buildAgentExecutionItems(result: AgentResponse): AgentExecutionItem[] {
  const tools = result.toolResults ?? [];
  const consumedTools = new Set<number>();
  const items: AgentExecutionItem[] = [];
  let nextToolIndex = 0;

  result.trace.forEach((step, traceIndex) => {
    if (isToolTraceStep(step)) {
      const toolIndex = findMatchingTool(step, tools, consumedTools, nextToolIndex);
      if (toolIndex >= 0) {
        consumedTools.add(toolIndex);
        nextToolIndex = toolIndex + 1;
        const tool = tools[toolIndex];
        items.push({
          kind: 'tool',
          key: `tool:${tool.id}:${traceIndex}`,
          title: tool.toolName,
          detail: step.detail,
          tool
        });
        return;
      }
    }

    items.push({
      kind: 'thought',
      key: `trace:${step.label}:${traceIndex}`,
      title: formatThoughtTitle(step),
      detail: step.detail,
      status: step.status
    });
  });

  tools.forEach((tool, toolIndex) => {
    if (!consumedTools.has(toolIndex)) {
      items.push({
        kind: 'tool',
        key: `tool:${tool.id}`,
        title: tool.toolName,
        tool
      });
    }
  });

  return items;
}

function AgentExecutionPanel({
  result,
  isRunning
}: {
  result: AgentResponse;
  isRunning: boolean;
}) {
  const [open, setOpen] = useState(isRunning);
  const wasRunningRef = useRef(isRunning);
  const toolResults = result.toolResults ?? [];
  const executionItems = buildAgentExecutionItems(result);
  const hasExecution = isRunning || result.trace.length > 0 || toolResults.length > 0;

  useEffect(() => {
    if (isRunning) {
      setOpen(true);
    }
    if (wasRunningRef.current && !isRunning) {
      setOpen(false);
    }
    wasRunningRef.current = isRunning;
  }, [isRunning]);

  if (!hasExecution) {
    return null;
  }

  return (
    <section className={cx('agentExecution', open && 'open')}>
      <button className="agentExecutionToggle" type="button" onClick={() => setOpen((current) => !current)}>
        <span>
          <ChevronRight size={14} className={open ? 'open' : ''} />
          <Layers size={15} />
          <strong>执行链路</strong>
        </span>
        <small>
          {isRunning ? '运行中' : '已完成'} · {result.trace.length} 步 · {toolResults.length} 个工具
        </small>
      </button>

      {open && (
        <div className="agentExecutionBody">
          {executionItems.length > 0 ? (
            <div className="agentExecutionTimeline">
              {executionItems.map((item) => (
                item.kind === 'tool' ? (
                  <article key={item.key} className={cx('agentExecutionItem', 'tool', item.tool.status === 'error' && 'error')}>
                    <span className="agentExecutionMarker"><Wrench size={13} /></span>
                    <div className="agentExecutionContent">
                      <div className="agentExecutionItemHeader">
                        <span>行动 / 工具调用</span>
                        <strong>{item.title}</strong>
                        <em>{item.tool.status === 'success' ? '成功' : '失败'}</em>
                      </div>
                      {item.detail && <p>{item.detail}</p>}
                      <div className="agentToolPayload">
                        <details>
                          <summary>调用参数</summary>
                          <pre>{compactToolOutput(item.tool.input, 800)}</pre>
                        </details>
                        <div>
                          <span>观察 / 返回结果</span>
                          <pre>{compactToolOutput(item.tool.output)}</pre>
                        </div>
                      </div>
                    </div>
                  </article>
                ) : (
                  <article key={item.key} className={cx('agentExecutionItem', 'thought', item.status === 'blocked' && 'blocked')}>
                    <span className="agentExecutionMarker">
                      {item.status === 'blocked' ? <AlertTriangle size={13} /> : <Check size={13} />}
                    </span>
                    <div className="agentExecutionContent">
                      <div className="agentExecutionItemHeader">
                        <span>{item.title}</span>
                      </div>
                      <p>{item.detail}</p>
                    </div>
                  </article>
                )
              ))}
            </div>
          ) : (
            <p className="agentExecutionEmpty">等待 Agent 规划或工具返回...</p>
          )}
        </div>
      )}
    </section>
  );
}

function AgentReferences({ references }: { references: AgentKnowledgeReference[] }) {
  if (!references.length) {
    return null;
  }

  return (
    <section className="agentReferences">
      <div className="agentReferencesTitle">
        <Database size={14} />
        <strong>知识库引用</strong>
      </div>
      <div className="agentReferenceList">
        {references.slice(0, 6).map((item) => (
          <article key={item.id}>
            <span>{item.type || '知识库'}{item.source ? ` · ${item.source}` : ''}</span>
            <strong>{item.title}</strong>
            <p>{compactText(item.content, 140)}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function AgentAssistantMessage({ result, content, isRunning }: { result?: AgentResponse; content: string; isRunning: boolean }) {
  if (!result) {
    return (
      <div className="agentAnswerBubble">
        {content ? <MarkdownMessage content={content} /> : <p className="typingDot">正在思考...</p>}
      </div>
    );
  }

  const references = collectAgentKnowledgeReferences(result);

  return (
    <div className="agentResponse">
      <AgentExecutionPanel result={result} isRunning={isRunning} />

      <div className="agentAnswerBubble">
        {content ? <MarkdownMessage content={content} /> : <p className="typingDot">正在思考...</p>}
      </div>

      <AgentReferences references={references} />
    </div>
  );
}

type AgentConfirmationRequest = {
  id: string;
  command: string;
  toolName: 'delete_products' | 'delete_knowledge_entries';
  toolInput: Record<string, unknown>;
  title: string;
  message: string;
  matchedCount: number;
  deleteAll: boolean;
  preview: Array<{ id: string; label: string }>;
};

function getToolConfirmationRequest(tool: AgentToolResult, command: string): AgentConfirmationRequest | undefined {
  if (!['delete_products', 'delete_knowledge_entries'].includes(tool.toolName) || tool.status !== 'success') {
    return undefined;
  }
  const toolName = tool.toolName as 'delete_products' | 'delete_knowledge_entries';

  const output = tool.output as {
    action?: string;
    confirmationRequired?: boolean;
    matchedCount?: number;
    deleteAll?: boolean;
    preview?: Array<Partial<ProductKnowledge> & { id?: string; title?: string; type?: string }>;
    message?: string;
  };
  if (output.action !== 'confirmation_required' || !output.confirmationRequired) {
    return undefined;
  }

  const preview = (output.preview ?? []).map((item, index) => ({
    id: item.id ?? `${tool.id}-${index}`,
    label: tool.toolName === 'delete_products'
      ? [item.brand, item.name].filter(Boolean).join(' ') || item.category || '未命名商品'
      : [item.title, item.type ? `(${item.type})` : ''].filter(Boolean).join(' ') || '未命名条目'
  }));

  return {
    id: tool.id,
    command,
    toolName,
    toolInput: tool.input as Record<string, unknown>,
    title: toolName === 'delete_products'
      ? output.deleteAll ? '确认清空商品库' : '确认删除商品'
      : '确认删除知识库条目',
    message: output.message || '该工具调用需要确认后才会执行。',
    matchedCount: output.matchedCount ?? output.preview?.length ?? 0,
    deleteAll: Boolean(output.deleteAll),
    preview
  };
}

function summarizeConfirmedTool(toolName: string, output: unknown) {
  const payload = output as {
    deletedCount?: number;
    deleted?: Array<{ name?: string; brand?: string; title?: string; category?: string; type?: string }>;
  };
  const deleted = payload.deleted ?? [];
  const labels = deleted.slice(0, 8).map((item) => (
    toolName === 'delete_products'
      ? [item.brand, item.name, item.category ? `(${item.category})` : ''].filter(Boolean).join(' ')
      : [item.title, item.type ? `(${item.type})` : ''].filter(Boolean).join(' ')
  )).filter(Boolean);
  const count = payload.deletedCount ?? deleted.length;
  const suffix = labels.length ? `：${labels.join('、')}${deleted.length > labels.length ? '等' : ''}` : '';

  return toolName === 'delete_products'
    ? `已确认并删除 ${count} 个商品${suffix}。`
    : `已确认并删除 ${count} 条知识库条目${suffix}。`;
}

function AgentPage({
  productCount,
  knowledgeCount,
  suggestions,
  onRefresh
}: {
  productCount: number;
  knowledgeCount: number;
  suggestions: KnowledgeSuggestion[];
  onRefresh: () => Promise<void>;
}) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmingTool, setConfirmingTool] = useState(false);
  const [confirmationRequest, setConfirmationRequest] = useState<AgentConfirmationRequest>();
  const [runningAssistantId, setRunningAssistantId] = useState<string>();
  const abortControllerRef = useRef<AbortController | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        '我是运营 Agent。你可以直接给我一个运营任务，例如维护商品库、查询库存、整理报表、分析客服数据或生成知识库草稿。我会按任务需要选择工具，并在对话里展示执行链路和结果。'
    }
  ]);

  async function submit(nextInput = input, options: { riskConfirmed?: boolean } = {}) {
    if (busy) {
      abortControllerRef.current?.abort();
      return;
    }

    const command = nextInput.trim();
    if (!command) {
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const assistantId = createClientId();
    const initialResult: AgentResponse = {
      taskId: assistantId,
      summary: '',
      analysis: {
        total: 0,
        manualCount: 0,
        negativeCount: 0,
        topIntents: [],
        candidateQuestions: []
      },
      suggestions: [],
      trace: [],
      toolResults: []
    };

    setInput('');
    setConfirmationRequest(undefined);
    setRunningAssistantId(assistantId);
    setBusy(true);
    setMessages((current) => [
      ...current,
      { id: createClientId(), role: 'user', content: command },
      { id: assistantId, role: 'assistant', content: '', result: initialResult }
    ]);

    try {
      const result = await runAgentTaskStream(command, controller.signal, {
        onChunk: (content) => {
          setMessages((current) => current.map((message) => (
            message.id === assistantId && message.role === 'assistant'
              ? { ...message, content: `${message.content}${content}` }
              : message
          )));
        },
        onTrace: (step) => {
          setMessages((current) => current.map((message) => (
            message.id === assistantId && message.role === 'assistant'
              ? {
                  ...message,
                  result: {
                    ...(message.result ?? initialResult),
                    trace: [...(message.result?.trace ?? []), step]
                  }
                }
              : message
          )));
        },
        onTool: (tool) => {
          const confirmation = getToolConfirmationRequest(tool, command);
          if (confirmation) {
            setConfirmationRequest(confirmation);
          }

          setMessages((current) => current.map((message) => (
            message.id === assistantId && message.role === 'assistant'
              ? {
                  ...message,
                  result: {
                    ...(message.result ?? initialResult),
                    toolResults: [...(message.result?.toolResults ?? []), tool]
                  }
                }
              : message
          )));
        }
      }, { riskConfirmed: options.riskConfirmed });
      setMessages((current) => current.map((message) => (
        message.id === assistantId && message.role === 'assistant'
          ? {
              ...message,
              id: result.taskId,
              content: result.summary,
              result
            }
          : message
      )));
      await onRefresh();
    } catch (error) {
      const stopped = error instanceof DOMException && error.name === 'AbortError';
      setMessages((current) => current.map((message) => (
        message.id === assistantId && message.role === 'assistant'
          ? {
              ...message,
              content: stopped ? '已停止本次运营 Agent 运行。' : error instanceof Error ? `请求失败：${error.message}` : '请求失败，请稍后重试。',
              result: undefined
            }
          : message
      )));
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setRunningAssistantId(undefined);
      setBusy(false);
    }
  }

  async function confirmPendingTool() {
    if (!confirmationRequest || confirmingTool) {
      return;
    }

    setConfirmingTool(true);
    try {
      const result = await confirmAgentTool({
        toolName: confirmationRequest.toolName,
        toolInput: confirmationRequest.toolInput
      });
      setMessages((current) => [
        ...current,
        {
          id: createClientId(),
          role: 'assistant',
          content: summarizeConfirmedTool(result.toolName, result.output)
        }
      ]);
      setConfirmationRequest(undefined);
      await onRefresh();
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: createClientId(),
          role: 'assistant',
          content: error instanceof Error ? `确认执行失败：${error.message}` : '确认执行失败，请稍后重试。'
        }
      ]);
    } finally {
      setConfirmingTool(false);
    }
  }

  const latestResult = [...messages]
    .reverse()
    .find((message): message is Extract<AgentMessage, { role: 'assistant'; result?: AgentResponse }> => message.role === 'assistant' && Boolean(message.result))
    ?.result;

  return (
    <section className="workspacePage agentWorkspace">
      <PageHeader
        title="运营 Agent"
        action={
          <div className="headerStats">
            <Stat label="商品库" value={`${productCount}`} />
            <Stat label="知识条目" value={`${knowledgeCount}`} />
            <Stat label="待审核" value={`${suggestions.filter((item) => item.status !== 'approved').length}`} />
          </div>
        }
      />

      <div className="agentLayout">
        <div className="agentConversation">
          <div className="agentMessages">
            {messages.map((message) => (
              <div key={message.id} className={cx('agentMessage', message.role)}>
                <div className="messageAvatar">{message.role === 'assistant' ? <Bot size={16} /> : <span>你</span>}</div>
                <div className="messageBody">
                  {message.role === 'assistant' ? (
                    <AgentAssistantMessage
                      content={message.content}
                      result={message.result}
                      isRunning={busy && message.id === runningAssistantId}
                    />
                  ) : (
                    <p>{message.content}</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="agentComposerWrap">
            <form
              className="codexComposer"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="给运营 Agent 一个任务"
                rows={4}
              />
              <div className="composerFooter">
                <button className="primaryButton" type="submit">
                  {busy ? <X size={16} /> : <Play size={16} />}
                  {busy ? '停止' : '运行'}
                </button>
              </div>
            </form>

            {confirmationRequest && (
              <div className="agentConfirmationCard">
                <div>
                  <AlertTriangle size={16} />
                  <strong>{confirmationRequest.title}</strong>
                </div>
                <p>{confirmationRequest.message}</p>
                {confirmationRequest.preview.length ? (
                  <div className="confirmationPreview">
                    {confirmationRequest.preview.slice(0, 6).map((item) => (
                      <span key={item.id}>{item.label}</span>
                    ))}
                    {confirmationRequest.matchedCount > 6 && <span>等 {confirmationRequest.matchedCount} 项</span>}
                  </div>
                ) : (
                  <small>没有匹配到可删除商品。</small>
                )}
                <div className="confirmationActions">
                  <button className="ghostButton" disabled={confirmingTool} onClick={() => setConfirmationRequest(undefined)} type="button">
                    取消
                  </button>
                  <button
                    className="primaryButton danger"
                    disabled={confirmingTool || confirmationRequest.matchedCount === 0}
                    onClick={confirmPendingTool}
                    type="button"
                  >
                    <Trash2 size={15} />
                    {confirmingTool ? '执行中' : confirmationRequest.toolName === 'delete_products' ? '确认删除商品' : '确认删除条目'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <aside className="agentSide">
          <div className="sidePanel">
            <div className="sideTitle">
              <Activity size={16} />
              <strong>运行状态</strong>
            </div>
            <div className="statusList">
              {(latestResult?.trace.slice(-5) ?? [
                { label: 'LangGraph', detail: '等待任务输入。', status: 'pending' as const }
              ]).map((step, index) => (
                <span key={`${step.label}-${index}`}>
                  {step.status === 'blocked' ? <AlertTriangle size={13} /> : <Check size={13} />}
                  {step.label}
                </span>
              ))}
            </div>
          </div>

          <div className="sidePanel">
            <div className="sideTitle">
              <ClipboardCheck size={16} />
              <strong>最近知识建议</strong>
            </div>
            {suggestions.slice(0, 4).length ? (
              <div className="miniSuggestions">
                {suggestions.slice(0, 4).map((item) => (
                  <article key={item.id}>
                    <span>{item.status === 'approved' ? '已入库' : '待审核'}</span>
                    <strong>{item.title}</strong>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState text="暂无建议。" icon={ClipboardCheck} />
            )}
          </div>
        </aside>
      </div>
    </section>
  );
}

function CustomerPage({ onRefresh }: { onRefresh: () => Promise<void> }) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: '你好，我是电商客服助手。可以问我商品推荐、规格选择、售后规则或物流订单问题。'
    }
  ]);
  const [input, setInput] = useState(demoQuestions[0]);
  const [conversationId, setConversationId] = useState<string>();
  const [result, setResult] = useState<ChatResponse>();
  const [busy, setBusy] = useState(false);
  const [debugOpen, setDebugOpen] = useState(false);
  const [evidenceFilter, setEvidenceFilter] = useState<EvidenceFilter>('all');

  const evidenceItems = useMemo(() => {
    if (!result) {
      return [];
    }
    return buildEvidenceItems(result);
  }, [result]);

  const evidenceSummary = useMemo(() => {
    if (!evidenceItems.length) {
      return '暂无依据';
    }

    const knowledgeCount = evidenceItems.filter((item) => item.kind === 'knowledge').length;
    const webCount = evidenceItems.filter((item) => item.kind === 'web').length;
    return `知识库 ${knowledgeCount} · 联网 ${webCount}`;
  }, [evidenceItems]);

  async function submit(nextInput = input) {
    const message = nextInput.trim();
    if (!message) {
      return;
    }

    setBusy(true);
    setMessages((current) => [...current, { role: 'user', content: message }, { role: 'assistant', content: '' }]);

    try {
      const next = await sendChatStream(message, conversationId, messages, (chunk) => {
        setMessages((current) => {
          const updated = [...current];
          for (let index = updated.length - 1; index >= 0; index -= 1) {
            if (updated[index].role === 'assistant') {
              updated[index] = { ...updated[index], content: `${updated[index].content}${chunk}` };
              break;
            }
          }
          return updated;
        });
      });
      setConversationId(next.conversationId);
      setResult(next);
      setMessages((current) => {
        const updated = [...current];
        for (let index = updated.length - 1; index >= 0; index -= 1) {
          if (updated[index].role === 'assistant') {
            updated[index] = { ...updated[index], content: next.answer };
            break;
          }
        }
        return updated;
      });
      setInput('');
      await onRefresh();
    } catch (error) {
      setMessages((current) => {
        const updated = [...current];
        for (let index = updated.length - 1; index >= 0; index -= 1) {
          if (updated[index].role === 'assistant') {
            updated[index] = {
              ...updated[index],
              content: error instanceof Error ? `请求失败：${error.message}` : '请求失败，请稍后重试。'
            };
            break;
          }
        }
        return updated;
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="workspacePage">
      <PageHeader
        eyebrow="Customer Service"
        title="智能客服"
        description="客户侧 RAG 问答，展示意图识别、检索命中、置信度和转人工摘要。"
      />

      <div className="customerLayout">
        <section className="panel chatPanel flat">
          <div className="panelHeader">
            <div>
              <span className="iconBadge"><MessagesSquare size={18} /></span>
              <h2>客户会话</h2>
            </div>
            <button className="ghostButton" onClick={() => setMessages(messages.slice(0, 1))} type="button">
              <RefreshCcw size={16} />
            </button>
          </div>

          <div className="conversationStatus">
            <span>自动接待中</span>
            <span>{result ? result.intentLabel : '等待客户问题'}</span>
            {result && <span>置信度 {formatPercent(result.confidence)}</span>}
            {result && <strong>{result.manualRequired ? '建议转人工' : '可自动回复'}</strong>}
          </div>

          <div className="messages">
            {messages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={`message ${message.role}`}>
                <span>{message.content ? <MarkdownMessage content={message.content} /> : <span className="thinkingState">正在思考...</span>}</span>
              </div>
            ))}
          </div>

          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <div className="customerPromptBar">
              <span>试试</span>
              {demoQuestions.map((question) => (
                <button key={question} onClick={() => setInput(question)} type="button">
                  {question}
                </button>
              ))}
            </div>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="输入客户问题"
              rows={3}
            />
            <button className="primaryButton" disabled={busy} type="submit">
              <Send size={17} />
              {busy ? '处理中' : '发送'}
            </button>
          </form>
        </section>

        <aside className="panel insightPanel flat">
          <div className="panelHeader">
            <div>
              <span className="iconBadge"><Settings2 size={18} /></span>
              <h2>RAG 决策</h2>
            </div>
          </div>

          {result ? (
            <div className="inspectorStack">
              <section className="inspectorSection pinned">
                <div className="inspectorTitle">
                  <strong>当前判断</strong>
                  <span>{result.manualRequired ? '需要关注' : '正常'}</span>
                </div>
                <div className="decisionGrid">
                  <div>
                    <span>意图</span>
                    <strong>{result.intentLabel}</strong>
                  </div>
                  <div>
                    <span>置信度</span>
                    <strong className={result.confidence < 0.45 ? 'warnText' : ''}>{formatPercent(result.confidence)}</strong>
                  </div>
                  <div>
                    <span>处理建议</span>
                    <strong>{result.manualRequired ? '转人工' : '自动回复'}</strong>
                  </div>
                  <div>
                    <span>依据数量</span>
                    <strong>{evidenceItems.length}</strong>
                  </div>
                </div>
              </section>

              <section className="inspectorSection">
                <div className="inspectorTitle">
                  <strong>依据来源</strong>
                  <span>{evidenceSummary}</span>
                </div>
                <EvidenceList
                  items={evidenceItems}
                  filter={evidenceFilter}
                  onFilterChange={setEvidenceFilter}
                  webSearchError={result.webSearchError}
                />
              </section>

              {result.manualRequired && (
                <section className="manualBox">
                  <div>
                    <AlertTriangle size={17} />
                    <strong>转人工摘要</strong>
                  </div>
                  <pre>{result.manualSummary}</pre>
                </section>
              )}

              <section className="inspectorSection debugSection">
                <button className="debugToggle" type="button" onClick={() => setDebugOpen((open) => !open)}>
                  <span>调试信息</span>
                  <ChevronRight size={15} className={debugOpen ? 'open' : ''} />
                </button>
                {debugOpen && (
                  <div className="debugBody">
                    <div>
                      <span>模型</span>
                      <strong>{result.model ?? 'mimo-v2.5-pro'}</strong>
                    </div>
                    <div>
                      <span>回复来源</span>
                      <strong>{result.answerSource === 'llm' ? '大模型' : '本地兜底'}</strong>
                    </div>
                    <div>
                      <span>原始意图</span>
                      <strong>{result.intent}</strong>
                    </div>
                    {result.fallbackReason && (
                      <div>
                        <span>兜底原因</span>
                        <strong>{result.fallbackReason}</strong>
                      </div>
                    )}
                  </div>
                )}
              </section>
            </div>
          ) : (
            <EmptyState text="发送一条客户问题后，这里会展示检索和转人工信息。" icon={Search} />
          )}
        </aside>
      </div>
    </section>
  );
}

function KnowledgePage({
  suggestions,
  qaItems,
  products,
  onApprove,
  onCreateQa,
  onCreateProducts,
  onDeleteQa,
  onDeleteProduct
}: {
  suggestions: KnowledgeSuggestion[];
  qaItems: QaKnowledge[];
  products: ProductKnowledge[];
  onApprove: (id: string) => Promise<void>;
  onCreateQa: (items: Array<{ question: string; answer: string; tags: string[] }>) => Promise<void>;
  onDeleteQa: (id: string) => Promise<void>;
  onCreateProducts: (items: Array<{
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
  }>) => Promise<{ createdCount: number; skippedCount: number }>;
  onDeleteProduct: (id: string) => Promise<void>;
}) {
  const [library, setLibrary] = useState<'qa' | 'products'>('qa');
  const [createOpen, setCreateOpen] = useState(false);
  const [qaQuestion, setQaQuestion] = useState('');
  const [qaAnswer, setQaAnswer] = useState('');
  const [qaTags, setQaTags] = useState('');
  const [qaBatch, setQaBatch] = useState('');
  const [productName, setProductName] = useState('');
  const [productBrand, setProductBrand] = useState('');
  const [productCategory, setProductCategory] = useState('');
  const [productPrice, setProductPrice] = useState('0');
  const [productStock, setProductStock] = useState('0');
  const [productFeatures, setProductFeatures] = useState('');
  const [productPurchaseUrl, setProductPurchaseUrl] = useState('');
  const [productBatch, setProductBatch] = useState('');
  const [libraryNotice, setLibraryNotice] = useState('');
  const [deletingId, setDeletingId] = useState('');
  const [creatingTarget, setCreatingTarget] = useState<'qa' | 'qaBatch' | 'product' | 'productBatch' | ''>('');
  const visibleQa = qaItems.filter((item) => item.type !== 'product');
  const parseTags = (value: string) => value.split(/[,，、]/).map((tag) => tag.trim()).filter(Boolean);

  async function submitQa() {
    if (creatingTarget) {
      return;
    }

    const question = qaQuestion.trim();
    const answer = qaAnswer.trim();
    if (!question || !answer) {
      setLibraryNotice('问答库需要填写问题和答案。');
      return;
    }

    setCreatingTarget('qa');
    try {
      await onCreateQa([{ question, answer, tags: parseTags(qaTags) }]);
      setQaQuestion('');
      setQaAnswer('');
      setQaTags('');
      setLibraryNotice('已新增 1 条问答。');
      setCreateOpen(false);
    } finally {
      setCreatingTarget('');
    }
  }

  async function submitQaBatch() {
    if (creatingTarget) {
      return;
    }

    const items = qaBatch
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [question = '', answer = '', tags = ''] = line.split('|').map((part) => part.trim());
        return { question, answer, tags: parseTags(tags) };
      })
      .filter((item) => item.question && item.answer);

    if (!items.length) {
      setLibraryNotice('批量问答格式：问题 | 答案 | 标签1,标签2。');
      return;
    }

    setCreatingTarget('qaBatch');
    try {
      await onCreateQa(items);
      setQaBatch('');
      setLibraryNotice(`已批量新增 ${items.length} 条问答。`);
      setCreateOpen(false);
    } finally {
      setCreatingTarget('');
    }
  }

  async function submitProduct() {
    if (creatingTarget) {
      return;
    }

    const name = productName.trim();
    const brand = productBrand.trim();
    const category = productCategory.trim();
    const features = productFeatures.trim();
    if (!name || !brand || !category || !features) {
      setLibraryNotice('商品库需要填写商品名、品牌、类型和特性。');
      return;
    }

    setCreatingTarget('product');
    try {
      const result = await onCreateProducts([{
        name,
        brand,
        category,
        features,
        price: Number(productPrice) || 0,
        stock: Math.max(0, Math.floor(Number(productStock) || 0)),
        purchaseUrl: productPurchaseUrl.trim()
      }]);
      setProductName('');
      setProductBrand('');
      setProductCategory('');
      setProductPrice('0');
      setProductStock('0');
      setProductFeatures('');
      setProductPurchaseUrl('');
      setLibraryNotice(result.createdCount ? '已新增 1 个商品。' : '已跳过重复商品。');
      setCreateOpen(false);
    } finally {
      setCreatingTarget('');
    }
  }

  async function submitProductBatch() {
    if (creatingTarget) {
      return;
    }

    const items = productBatch
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name = '', category = '', brand = '', features = '', stock = '0', price = '0', purchaseUrl = ''] = line
          .split('|')
          .map((part) => part.trim());
        return {
          name,
          category,
          brand,
          features,
          stock: Math.max(0, Math.floor(Number(stock) || 0)),
          price: Number(price) || 0,
          purchaseUrl
        };
      })
      .filter((item) => item.name && item.category && item.brand && item.features);

    if (!items.length) {
      setLibraryNotice('批量商品格式：商品名 | 商品类型 | 品牌 | 特性 | 库存 | 价格 | 购买链接。');
      return;
    }

    setCreatingTarget('productBatch');
    try {
      const result = await onCreateProducts(items);
      setProductBatch('');
      setLibraryNotice(`已批量新增 ${result.createdCount} 个商品，跳过 ${result.skippedCount} 个重复商品。`);
      setCreateOpen(false);
    } finally {
      setCreatingTarget('');
    }
  }

  async function deleteQaItem(item: QaKnowledge) {
    if (!window.confirm(`确定删除问答“${item.question}”吗？`)) {
      return;
    }

    setDeletingId(item.id);
    try {
      await onDeleteQa(item.id);
      setLibraryNotice('已删除 1 条问答。');
    } catch {
      setLibraryNotice('删除问答失败，请稍后重试。');
    } finally {
      setDeletingId('');
    }
  }

  async function deleteProductItem(product: ProductKnowledge) {
    if (!window.confirm(`确定删除商品“${product.name}”吗？`)) {
      return;
    }

    setDeletingId(product.id);
    try {
      await onDeleteProduct(product.id);
      setLibraryNotice('已删除 1 个商品。');
    } catch {
      setLibraryNotice('删除商品失败，请稍后重试。');
    } finally {
      setDeletingId('');
    }
  }

  return (
    <section className="workspacePage">
      <PageHeader
        eyebrow="Knowledge Base"
        title="知识库"
        description="客服 RAG 使用两个业务库：问答库负责标准问答和标签，商品库负责商品结构化信息。"
        action={
          <div className="headerStats">
            <Stat label="问答库" value={`${visibleQa.length}`} />
            <Stat label="商品库" value={`${products.length}`} />
            <Stat label="待审核" value={`${suggestions.filter((item) => item.status !== 'approved').length}`} />
          </div>
        }
      />

      <div className="libraryToolbar">
        <div className="libraryTabs">
          <button className={cx(library === 'qa' && 'active')} onClick={() => setLibrary('qa')} type="button">
            问答库
          </button>
          <button className={cx(library === 'products' && 'active')} onClick={() => setLibrary('products')} type="button">
            商品库
          </button>
        </div>
        <button
          className="primaryButton"
          onClick={() => {
            setLibraryNotice('');
            setCreateOpen(true);
          }}
          type="button"
        >
          <Plus size={16} />
          {library === 'qa' ? '新建问答' : '新建商品'}
        </button>
      </div>

      {library === 'qa' ? (
        <div className="knowledgeLibrary">
          <section className="libraryMain">
            {visibleQa.length ? (
              visibleQa.map((item) => (
                <article key={item.id} className="knowledgeItem">
                  <div className="knowledgeItemHeader">
                    <div>
                      <span>{item.type}</span>
                      <strong>{item.question}</strong>
                    </div>
                    <button
                      aria-label={`删除问答：${item.question}`}
                      className="iconButton danger"
                      disabled={deletingId === item.id}
                      onClick={() => deleteQaItem(item)}
                      title="删除问答"
                      type="button"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                  <p>{item.answer}</p>
                  <div className="tagRow">
                    {item.tags.map((tag) => (
                      <span key={`${item.id}-${tag}`}>{tag}</span>
                    ))}
                  </div>
                </article>
              ))
            ) : (
              <EmptyState text="问答库暂无内容。" icon={ClipboardCheck} />
            )}
          </section>

          <aside className="librarySide">
            <div className="panel flat">
              <div className="panelHeader">
                <div>
                  <span className="iconBadge"><ClipboardCheck size={18} /></span>
                  <h2>待审核问答</h2>
                </div>
              </div>

              <div className="suggestionStack">
                {suggestions.length ? (
                  suggestions.map((item) => (
                    <article key={item.id} className={cx('suggestion', item.status)}>
                      <div className="suggestionHeader">
                        <div>
                          <span>{item.status === 'approved' ? '已入库' : '待审核'}</span>
                          <strong>{item.title}</strong>
                        </div>
                        {item.status !== 'approved' && (
                          <button className="smallButton" onClick={() => onApprove(item.id)} type="button">
                            <FileText size={15} />
                            入库
                          </button>
                        )}
                      </div>
                      <p>{item.content}</p>
                      <small>{item.reason}</small>
                    </article>
                  ))
                ) : (
                  <EmptyState text="暂无知识建议。先到运营 Agent 中执行一次对话分析任务。" icon={ClipboardCheck} />
                )}
              </div>
            </div>
          </aside>
        </div>
      ) : (
        <div className="productKnowledgeGrid">
          {products.length ? (
            products.map((product) => (
              <article key={product.id} className="productKnowledgeItem">
                <div className="knowledgeItemHeader">
                  <div>
                    <span>{product.category}</span>
                    <strong>{product.name}</strong>
                  </div>
                  <button
                    aria-label={`删除商品：${product.name}`}
                    className="iconButton danger"
                    disabled={deletingId === product.id}
                    onClick={() => deleteProductItem(product)}
                    title="删除商品"
                    type="button"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                <div className="productFacts">
                  <span>品牌：{product.brand}</span>
                  <span>库存：{product.stock}</span>
                  <span>价格：¥{product.price}</span>
                </div>
                <p>{product.features}</p>
                {product.purchaseUrl && (
                  <a className="productLink" href={product.purchaseUrl} target="_blank" rel="noreferrer">
                    <Link size={14} />
                    购买链接
                  </a>
                )}
                <small>{product.scene}</small>
              </article>
            ))
          ) : (
            <EmptyState text="商品库暂无内容。" icon={Package} />
          )}
        </div>
      )}

      {createOpen && (
        <div className="modalOverlay" role="presentation" onMouseDown={() => setCreateOpen(false)}>
          <div className="modalPanel" role="dialog" aria-modal="true" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modalHeader">
              <div>
                <span className="iconBadge">{library === 'qa' ? <FileText size={18} /> : <Package size={18} />}</span>
                <h2>{library === 'qa' ? '新建问答' : '新建商品'}</h2>
              </div>
              <button className="ghostButton" onClick={() => setCreateOpen(false)} type="button" aria-label="关闭">
                <X size={16} />
              </button>
            </div>

            {library === 'qa' ? (
              <div className="modalContent">
                <section className="modalSection">
                  <h3>单条新建</h3>
                  <div className="settingsForm">
                    <label>
                      <span>问题</span>
                      <input value={qaQuestion} onChange={(event) => setQaQuestion(event.target.value)} placeholder="例：这款商品适合敏感肌吗？" />
                    </label>
                    <label>
                      <span>答案</span>
                      <textarea value={qaAnswer} onChange={(event) => setQaAnswer(event.target.value)} placeholder="填写标准客服回答" rows={4} />
                    </label>
                    <label>
                      <span>标签</span>
                      <input value={qaTags} onChange={(event) => setQaTags(event.target.value)} placeholder="适用人群,敏感肌,售前咨询" />
                    </label>
                    <button className="primaryButton" disabled={Boolean(creatingTarget)} onClick={submitQa} type="button">
                      <Check size={16} />
                      {creatingTarget === 'qa' ? '新增中' : '新增问答'}
                    </button>
                  </div>
                </section>

                <section className="modalSection">
                  <h3>批量导入</h3>
                  <p className="importHint">回车换条，一行一条；每行内部用 <strong>|</strong> 分隔字段。</p>
                  <textarea
                    value={qaBatch}
                    onChange={(event) => setQaBatch(event.target.value)}
                    placeholder={'问题 | 答案 | 标签1,标签2\n这款商品适合敏感肌吗？ | 建议先查看成分和适用说明，敏感肌可先局部试用。 | 适用人群,敏感肌'}
                    rows={8}
                  />
                  <button className="smallButton" disabled={Boolean(creatingTarget)} onClick={submitQaBatch} type="button">
                    {creatingTarget === 'qaBatch' ? '导入中' : '批量新增'}
                  </button>
                </section>
              </div>
            ) : (
              <div className="modalContent">
                <section className="modalSection">
                  <h3>单条新建</h3>
                  <div className="settingsForm">
                    <label>
                      <span>商品名</span>
                      <input value={productName} onChange={(event) => setProductName(event.target.value)} placeholder="例：多效修护眼霜" />
                    </label>
                    <div className="compactFields">
                      <label>
                        <span>商品类型</span>
                        <input value={productCategory} onChange={(event) => setProductCategory(event.target.value)} placeholder="眼部护理" />
                      </label>
                      <label>
                        <span>品牌</span>
                        <input value={productBrand} onChange={(event) => setProductBrand(event.target.value)} placeholder="VitaSkin" />
                      </label>
                    </div>
                    <div className="compactFields">
                      <label>
                        <span>库存</span>
                        <input value={productStock} onChange={(event) => setProductStock(event.target.value)} type="number" min="0" />
                      </label>
                      <label>
                        <span>价格</span>
                        <input value={productPrice} onChange={(event) => setProductPrice(event.target.value)} type="number" min="0" />
                      </label>
                    </div>
                    <label>
                      <span>特性</span>
                      <textarea value={productFeatures} onChange={(event) => setProductFeatures(event.target.value)} placeholder="填写商品核心卖点和适用场景" rows={4} />
                    </label>
                    <label>
                      <span>购买链接</span>
                      <input value={productPurchaseUrl} onChange={(event) => setProductPurchaseUrl(event.target.value)} placeholder="https://example.com/products/..." type="url" />
                    </label>
                    <button className="primaryButton" disabled={Boolean(creatingTarget)} onClick={submitProduct} type="button">
                      <Check size={16} />
                      {creatingTarget === 'product' ? '新增中' : '新增商品'}
                    </button>
                  </div>
                </section>

                <section className="modalSection">
                  <h3>批量导入</h3>
                  <p className="importHint">回车换条，一行一条；每行内部用 <strong>|</strong> 分隔字段。</p>
                  <textarea
                    value={productBatch}
                    onChange={(event) => setProductBatch(event.target.value)}
                    placeholder={'商品名 | 商品类型 | 品牌 | 特性 | 库存 | 价格 | 购买链接\n多效修护眼霜 | 眼部护理 | VitaSkin | 淡化黑眼圈，改善干纹 | 86 | 199 | https://example.com/products/eye-cream'}
                    rows={8}
                  />
                  <button className="smallButton" disabled={Boolean(creatingTarget)} onClick={submitProductBatch} type="button">
                    {creatingTarget === 'productBatch' ? '导入中' : '批量新增'}
                  </button>
                </section>
              </div>
            )}

            {libraryNotice && <div className="settingsNotice">{libraryNotice}</div>}
          </div>
        </div>
      )}
    </section>
  );
}

function SettingsPage() {
  const [llmSettings, setLlmSettings] = useState<LlmSettings>();
  const [embeddingSettings, setEmbeddingSettings] = useState<EmbeddingSettings>();
  const [searchSettings, setSearchSettings] = useState<SearchSettings>();
  const [systemPromptSettings, setSystemPromptSettings] = useState<SystemPromptSettings>();
  const [llmBaseUrl, setLlmBaseUrl] = useState('https://api.openai.com/v1');
  const [llmModel, setLlmModel] = useState('gpt-4o-mini');
  const [llmApiKey, setLlmApiKey] = useState('');
  const [embeddingBaseUrl, setEmbeddingBaseUrl] = useState('https://api.openai.com/v1');
  const [embeddingModel, setEmbeddingModel] = useState('text-embedding-3-small');
  const [embeddingApiKey, setEmbeddingApiKey] = useState('');
  const [searchEnabled, setSearchEnabled] = useState(false);
  const [searchBaseUrl, setSearchBaseUrl] = useState('https://api.bochaai.com/v1');
  const [searchApiKey, setSearchApiKey] = useState('');
  const [searchCount, setSearchCount] = useState('5');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [busyTarget, setBusyTarget] = useState<'llm' | 'embedding' | 'search' | 'systemPrompt' | ''>('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    Promise.all([loadLlmSettings(), loadEmbeddingSettings(), loadSearchSettings(), loadSystemPromptSettings()])
      .then(([llm, embedding, search, promptSettings]) => {
        setLlmSettings(llm);
        setLlmBaseUrl(llm.baseUrl);
        setLlmModel(llm.model);
        setEmbeddingSettings(embedding);
        setEmbeddingBaseUrl(embedding.baseUrl);
        setEmbeddingModel(embedding.model);
        setSearchSettings(search);
        setSearchEnabled(search.enabled);
        setSearchBaseUrl(search.baseUrl);
        setSearchCount(String(search.count));
        setSystemPromptSettings(promptSettings);
        setSystemPrompt(promptSettings.prompt);
      })
      .catch(() => setNotice('读取系统配置失败，请确认后端服务已启动。'));
  }, []);

  async function submitLlm() {
    setBusyTarget('llm');
    setNotice('');

    try {
      const next = await saveLlmSettings({ baseUrl: llmBaseUrl, model: llmModel, apiKey: llmApiKey });
      setLlmSettings(next);
      setLlmApiKey('');
      setNotice('对话模型配置已保存。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '保存失败。');
    } finally {
      setBusyTarget('');
    }
  }

  async function submitEmbedding() {
    setBusyTarget('embedding');
    setNotice('');

    try {
      const next = await saveEmbeddingSettings({
        baseUrl: embeddingBaseUrl,
        model: embeddingModel,
        apiKey: embeddingApiKey
      });
      setEmbeddingSettings(next);
      setEmbeddingApiKey('');
      setNotice('Embedding 配置已保存。后续客服检索会优先使用向量混合召回。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '保存失败。');
    } finally {
      setBusyTarget('');
    }
  }

  async function submitSearch() {
    setBusyTarget('search');
    setNotice('');

    try {
      const next = await saveSearchSettings({
        enabled: searchEnabled,
        baseUrl: searchBaseUrl,
        apiKey: searchApiKey,
        count: Math.max(1, Math.min(10, Math.floor(Number(searchCount) || 5)))
      });
      setSearchSettings(next);
      setSearchApiKey('');
      setNotice('联网搜索配置已保存。客服会在需要外部公开信息时调用博查搜索。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '保存失败。');
    } finally {
      setBusyTarget('');
    }
  }

  async function submitSystemPrompt() {
    setBusyTarget('systemPrompt');
    setNotice('');

    try {
      const next = await saveSystemPromptSettings({ prompt: systemPrompt });
      setSystemPromptSettings(next);
      setSystemPrompt(next.prompt);
      setNotice('业务系统提示词已保存，后续运营 Agent 和智能客服会使用新配置。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '保存失败。');
    } finally {
      setBusyTarget('');
    }
  }

  async function resetSystemPrompt() {
    setBusyTarget('systemPrompt');
    setNotice('');

    try {
      const next = await resetSystemPromptSettings();
      setSystemPromptSettings(next);
      setSystemPrompt(next.prompt);
      setNotice('已恢复通用电商的默认业务系统提示词。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '恢复默认失败。');
    } finally {
      setBusyTarget('');
    }
  }

  return (
    <section className="workspacePage">
      <PageHeader
        eyebrow="System Settings"
        title="系统设置"
        description="维护店铺业务提示词与模型服务配置。提示词保存后立即用于运营 Agent 和智能客服。"
        action={
          <Stat
            label="联网搜索"
            value={searchSettings?.enabled && searchSettings.apiKeySet ? '已启用' : '未启用'}
            tone={searchSettings?.enabled && searchSettings.apiKeySet ? 'good' : 'warn'}
          />
        }
      />

      <section className="panel flat systemPromptPanel">
        <div className="panelHeader">
          <div>
            <span className="iconBadge"><Bot size={18} /></span>
            <h2>业务系统提示词</h2>
          </div>
          <span className={cx('promptStatus', systemPromptSettings?.customized && 'customized')}>
            {systemPromptSettings?.customized ? '自定义配置' : '默认配置'}
          </span>
        </div>

        <form
          className="settingsForm"
          onSubmit={(event) => {
            event.preventDefault();
            submitSystemPrompt();
          }}
        >
          <label>
            <span>系统提示词</span>
            <textarea
              className="systemPromptInput"
              value={systemPrompt}
              onChange={(event) => setSystemPrompt(event.target.value)}
              placeholder="定义店铺所属领域、服务范围、话术风格、业务规则与边界。"
              rows={12}
              maxLength={12000}
            />
          </label>

          <div className="systemPromptFooter">
            <span>{systemPrompt.length}/12000</span>
            <div className="settingsActions">
              <button className="ghostButton" disabled={busyTarget === 'systemPrompt'} onClick={resetSystemPrompt} type="button">
                <RefreshCcw size={16} />
                恢复默认
              </button>
              <button className="primaryButton" disabled={busyTarget === 'systemPrompt'} type="submit">
                <Check size={16} />
                {busyTarget === 'systemPrompt' ? '保存中' : '保存系统提示词'}
              </button>
            </div>
          </div>
        </form>
      </section>

      <div className="settingsGrid">
        <section className="panel flat">
          <div className="panelHeader">
            <div>
              <span className="iconBadge"><KeyRound size={18} /></span>
              <h2>大模型接口</h2>
            </div>
          </div>

          <form
            className="settingsForm"
            onSubmit={(event) => {
              event.preventDefault();
              submitLlm();
            }}
          >
            <label>
              <span>API Base URL</span>
              <input
                value={llmBaseUrl}
                onChange={(event) => setLlmBaseUrl(event.target.value)}
                placeholder="https://api.openai.com/v1"
                type="url"
              />
            </label>

            <label>
              <span>模型名</span>
              <input
                value={llmModel}
                onChange={(event) => setLlmModel(event.target.value)}
                placeholder="gpt-4o-mini"
                type="text"
              />
            </label>

            <label>
              <span>API Key</span>
              <input
                value={llmApiKey}
                onChange={(event) => setLlmApiKey(event.target.value)}
                placeholder={llmSettings?.apiKeySet ? '留空则保留已保存的 Key' : '请输入 API Key'}
                type="password"
                autoComplete="off"
              />
            </label>

            <div className="settingsActions">
              <button className="primaryButton" disabled={busyTarget === 'llm'} type="submit">
                <Check size={16} />
                {busyTarget === 'llm' ? '保存中' : '保存对话模型'}
              </button>
            </div>
          </form>
        </section>

        <section className="panel flat">
          <div className="panelHeader">
            <div>
              <span className="iconBadge"><Search size={18} /></span>
              <h2>Embedding 接口</h2>
            </div>
          </div>

          <form
            className="settingsForm"
            onSubmit={(event) => {
              event.preventDefault();
              submitEmbedding();
            }}
          >
            <label>
              <span>Embedding Base URL</span>
              <input
                value={embeddingBaseUrl}
                onChange={(event) => setEmbeddingBaseUrl(event.target.value)}
                placeholder="https://api.openai.com/v1"
                type="url"
              />
            </label>

            <label>
              <span>Embedding 模型名</span>
              <input
                value={embeddingModel}
                onChange={(event) => setEmbeddingModel(event.target.value)}
                placeholder="BAAI/bge-m3 或 text-embedding-3-small"
                type="text"
              />
            </label>

            <label>
              <span>Embedding API Key</span>
              <input
                value={embeddingApiKey}
                onChange={(event) => setEmbeddingApiKey(event.target.value)}
                placeholder={embeddingSettings?.apiKeySet ? '留空则保留已保存的 Key' : '请输入 Embedding API Key'}
                type="password"
                autoComplete="off"
              />
            </label>

            <div className="settingsActions">
              <button className="primaryButton" disabled={busyTarget === 'embedding'} type="submit">
                <Check size={16} />
                {busyTarget === 'embedding' ? '保存中' : '保存 Embedding'}
              </button>
            </div>
          </form>
        </section>

        <section className="panel flat">
          <div className="panelHeader">
            <div>
              <span className="iconBadge"><Search size={18} /></span>
              <h2>联网搜索</h2>
            </div>
          </div>

          <form
            className="settingsForm"
            onSubmit={(event) => {
              event.preventDefault();
              submitSearch();
            }}
          >
            <label className="checkLine">
              <input checked={searchEnabled} onChange={(event) => setSearchEnabled(event.target.checked)} type="checkbox" />
              <span>启用博查联网搜索</span>
            </label>

            <label>
              <span>Search Base URL</span>
              <input
                value={searchBaseUrl}
                onChange={(event) => setSearchBaseUrl(event.target.value)}
                placeholder="https://api.bochaai.com/v1"
                type="url"
              />
            </label>

            <label>
              <span>Search API Key</span>
              <input
                value={searchApiKey}
                onChange={(event) => setSearchApiKey(event.target.value)}
                placeholder={searchSettings?.apiKeySet ? '留空则保留已保存的 Key' : '请输入博查 API Key'}
                type="password"
                autoComplete="off"
              />
            </label>

            <label>
              <span>最多来源数</span>
              <input value={searchCount} onChange={(event) => setSearchCount(event.target.value)} type="number" min="1" max="10" />
            </label>

            <div className="settingsActions">
              <button className="primaryButton" disabled={busyTarget === 'search'} type="submit">
                <Check size={16} />
                {busyTarget === 'search' ? '保存中' : '保存搜索配置'}
              </button>
            </div>
          </form>
        </section>

        <aside className="panel flat settingsStatusPanel">
          <div className="panelHeader">
            <div>
              <span className="iconBadge"><Settings2 size={18} /></span>
              <h2>当前生效配置</h2>
            </div>
          </div>

          <div className="settingsSummary">
            <Stat label="对话模型" value={llmSettings?.model ?? llmModel} />
            <Stat
              label="对话 Key"
              value={llmSettings?.apiKeySet ? llmSettings.apiKeyPreview || '已配置' : '未配置'}
              tone={llmSettings?.apiKeySet ? 'good' : 'warn'}
            />
            <Stat label="Embedding 模型" value={embeddingSettings?.model ?? embeddingModel} />
            <Stat
              label="Embedding Key"
              value={embeddingSettings?.apiKeySet ? embeddingSettings.apiKeyPreview || '已配置' : '未配置'}
              tone={embeddingSettings?.apiKeySet ? 'good' : 'warn'}
            />
            <Stat
              label="联网搜索"
              value={searchSettings?.enabled && searchSettings.apiKeySet ? '博查已启用' : '未启用'}
              tone={searchSettings?.enabled && searchSettings.apiKeySet ? 'good' : 'warn'}
            />
            <div className="callout">
              <div>
                <Database size={17} />
                <strong>RAG 检索</strong>
              </div>
              <p>配置 Embedding 后，客服会请求 `{embeddingBaseUrl}/embeddings`，并用关键词分数 + 向量相似度混合召回知识片段。</p>
            </div>
            {notice && <div className="settingsNotice">{notice}</div>}
          </div>
        </aside>
      </div>
    </section>
  );
}

function ChannelsPage() {
  const [settings, setSettings] = useState<WecomSettings>();
  const [enabled, setEnabled] = useState(false);
  const [corpId, setCorpId] = useState('');
  const [secret, setSecret] = useState('');
  const [token, setToken] = useState('');
  const [encodingAesKey, setEncodingAesKey] = useState('');
  const [openKfid, setOpenKfid] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    loadWecomSettings()
      .then((next) => {
        setSettings(next);
        setEnabled(next.enabled);
        setCorpId(next.corpId);
        setOpenKfid(next.openKfid);
      })
      .catch(() => setNotice('读取企业微信配置失败，请确认后端服务已启动。'));
  }, []);

  const callbackUrl = `${window.location.origin.replace(/:5173$/, ':4000')}${settings?.callbackPath ?? '/api/channels/wecom/kf/callback'}`;

  async function submitWecom() {
    setBusy(true);
    setNotice('');

    try {
      const next = await saveWecomSettings({
        enabled,
        corpId,
        secret,
        token,
        encodingAesKey,
        openKfid
      });
      setSettings(next);
      setSecret('');
      setToken('');
      setEncodingAesKey('');
      setNotice('企业微信客服配置已保存。把回调 URL 填到企业微信后台后即可验证。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '保存失败。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="workspacePage">
      <PageHeader
        eyebrow="Channel Integrations"
        title="渠道接入"
        description="第一阶段接入企业微信「微信客服」文本消息：客户发消息后，ShopMate AI 自动回复，必要时提示人工跟进。"
        action={<Stat label="企业微信客服" value={settings?.enabled ? '已启用' : '未启用'} tone={settings?.enabled ? 'good' : 'warn'} />}
      />

      <div className="settingsGrid">
        <section className="panel flat">
          <div className="panelHeader">
            <div>
              <span className="iconBadge"><Link size={18} /></span>
              <h2>企业微信客服</h2>
            </div>
          </div>

          <form
            className="settingsForm"
            onSubmit={(event) => {
              event.preventDefault();
              submitWecom();
            }}
          >
            <label className="checkLine">
              <input checked={enabled} onChange={(event) => setEnabled(event.target.checked)} type="checkbox" />
              <span>启用企业微信客服接入</span>
            </label>

            <label>
              <span>CorpID</span>
              <input value={corpId} onChange={(event) => setCorpId(event.target.value)} placeholder="企业 ID" />
            </label>

            <label>
              <span>微信客服 Secret</span>
              <input
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
                placeholder={settings?.secretSet ? `留空保留：${settings.secretPreview}` : '请输入微信客服 Secret'}
                type="password"
                autoComplete="off"
              />
            </label>

            <label>
              <span>Token</span>
              <input
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder={settings?.tokenSet ? `留空保留：${settings.tokenPreview}` : '企业微信回调 Token'}
                type="password"
                autoComplete="off"
              />
            </label>

            <label>
              <span>EncodingAESKey</span>
              <input
                value={encodingAesKey}
                onChange={(event) => setEncodingAesKey(event.target.value)}
                placeholder={settings?.encodingAesKeySet ? `留空保留：${settings.encodingAesKeyPreview}` : '43 位 EncodingAESKey'}
                type="password"
                autoComplete="off"
              />
            </label>

            <label>
              <span>默认 open_kfid</span>
              <input value={openKfid} onChange={(event) => setOpenKfid(event.target.value)} placeholder="客服账号 open_kfid" />
            </label>

            <div className="settingsActions">
              <button className="primaryButton" disabled={busy} type="submit">
                <Check size={16} />
                {busy ? '保存中' : '保存企业微信配置'}
              </button>
            </div>
          </form>
        </section>

        <aside className="panel flat">
          <div className="panelHeader">
            <div>
              <span className="iconBadge"><Settings2 size={18} /></span>
              <h2>回调配置</h2>
            </div>
          </div>

          <div className="settingsSummary">
            <Stat label="CorpID" value={settings?.corpId ? '已填写' : '未填写'} tone={settings?.corpId ? 'good' : 'warn'} />
            <Stat label="Secret" value={settings?.secretSet ? '已配置' : '未配置'} tone={settings?.secretSet ? 'good' : 'warn'} />
            <Stat label="Token" value={settings?.tokenSet ? '已配置' : '未配置'} tone={settings?.tokenSet ? 'good' : 'warn'} />
            <Stat label="EncodingAESKey" value={settings?.encodingAesKeySet ? '已配置' : '未配置'} tone={settings?.encodingAesKeySet ? 'good' : 'warn'} />
            <div className="callout">
              <div>
                <Link size={17} />
                <strong>回调 URL</strong>
              </div>
              <p>{callbackUrl}</p>
            </div>
            <div className="callout">
              <div>
                <Database size={17} />
                <strong>当前 MVP</strong>
              </div>
              <p>支持微信客服文本消息自动回复。图片、语音、复杂人工坐席分配先不做，避免第一版接入失控。</p>
            </div>
            {notice && <div className="settingsNotice">{notice}</div>}
          </div>
        </aside>
      </div>
    </section>
  );
}

function PlaceholderPage({
  tab,
  productCount,
  knowledgeCount,
  suggestions
}: {
  tab: WorkspaceTab;
  productCount: number;
  knowledgeCount: number;
  suggestions: KnowledgeSuggestion[];
}) {
  const content: Record<Exclude<WorkspaceTab, 'agent' | 'customer' | 'knowledge' | 'settings' | 'channels'>, {
    eyebrow: string;
    title: string;
    description: string;
    icon: PhosphorIcon;
    actions: string[];
  }> = {
    analysis: {
      eyebrow: 'Dialogue Analysis',
      title: '对话分析',
      description: '这里会承接 Agent 分析结果，展示高频问题、转人工原因、情绪分布和知识缺口。',
      icon: ChartDonut,
      actions: ['高频问题', '转人工原因', '情绪分类', '知识缺口']
    },
    reports: {
      eyebrow: 'Reports',
      title: '运营报表',
      description: '这里会输出每日咨询量、自动回复率、转人工率、商品咨询排行和优化动作。',
      icon: PhosphorFileText,
      actions: ['日报生成', '自动回复率', '商品排行', '优化建议']
    }
  };

  const item = content[tab as Exclude<WorkspaceTab, 'agent' | 'customer' | 'knowledge' | 'settings' | 'channels'>];
  const Icon = item.icon;

  return (
    <section className="workspacePage">
      <PageHeader eyebrow={item.eyebrow} title={item.title} description={item.description} />
      <div className="placeholderPanel">
        <Icon size={30} weight="duotone" />
        <div>
          <h2>{item.title}</h2>
          <p>{item.description}</p>
        </div>
        <div className="placeholderStats">
          <Stat label="商品库" value={`${productCount}`} />
          <Stat label="知识条目" value={`${knowledgeCount}`} />
          <Stat label="知识建议" value={`${suggestions.length}`} />
        </div>
        <div className="loop">
          {item.actions.map((action) => (
            <span key={action}>{action}</span>
          ))}
        </div>
      </div>
    </section>
  );
}

export function App() {
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('agent');
  const [suggestions, setSuggestions] = useState<KnowledgeSuggestion[]>([]);
  const [products, setProducts] = useState<ProductKnowledge[]>([]);
  const [knowledgeItems, setKnowledgeItems] = useState<QaKnowledge[]>([]);
  const productCount = products.length;
  const knowledgeCount = knowledgeItems.length;

  async function refreshMeta() {
    const [productData, knowledgeData, suggestionData] = await Promise.all([
      loadProducts(),
      loadKnowledge(),
      loadSuggestions()
    ]);
    setProducts(productData.products);
    setKnowledgeItems(knowledgeData.chunks);
    setSuggestions(suggestionData.suggestions);
  }

  async function handleApprove(id: string) {
    await approveSuggestion(id);
    await refreshMeta();
  }

  async function handleCreateQa(items: Array<{ question: string; answer: string; tags: string[] }>) {
    await createKnowledge(items);
    await refreshMeta();
  }

  async function handleCreateProducts(items: Array<{
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
    const result = await createProducts(items);
    await refreshMeta();
    return {
      createdCount: result.products.length,
      skippedCount: result.skippedCount
    };
  }

  async function handleDeleteQa(id: string) {
    await deleteKnowledge(id);
    await refreshMeta();
  }

  async function handleDeleteProduct(id: string) {
    await deleteProduct(id);
    await refreshMeta();
  }

  useEffect(() => {
    refreshMeta().catch(() => undefined);
  }, []);

  return (
    <main className="productShell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark">
            <img src={shopmateLogo} alt="ShopMate AI logo" />
          </div>
          <div>
            <strong>ShopMate AI</strong>
          </div>
        </div>

        <nav className="sidebarNav">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                className={cx('navItem', active && 'active')}
                type="button"
                onClick={() => setActiveTab(tab.id)}
              >
                <Icon size={19} weight="duotone" />
                <span>
                  <strong>{tab.label}</strong>
                  <small>{tab.description}</small>
                </span>
                {active && <CaretRight size={15} weight="bold" />}
              </button>
            );
          })}
        </nav>

        <div className="sidebarFooter">
          <span>Local MVP</span>
          <strong>RAG + Tool Calling</strong>
        </div>
      </aside>

      <section className="workspace">
        {activeTab === 'agent' && (
          <AgentPage
            productCount={productCount}
            knowledgeCount={knowledgeCount}
            suggestions={suggestions}
            onRefresh={refreshMeta}
          />
        )}
        {activeTab === 'customer' && <CustomerPage onRefresh={refreshMeta} />}
        {activeTab === 'knowledge' && (
          <KnowledgePage
            suggestions={suggestions}
            qaItems={knowledgeItems}
            products={products}
            onApprove={handleApprove}
            onCreateQa={handleCreateQa}
            onCreateProducts={handleCreateProducts}
            onDeleteQa={handleDeleteQa}
            onDeleteProduct={handleDeleteProduct}
          />
        )}
        {activeTab === 'settings' && <SettingsPage />}
        {activeTab === 'channels' && <ChannelsPage />}
        {activeTab !== 'agent' && activeTab !== 'customer' && activeTab !== 'knowledge' && activeTab !== 'settings' && activeTab !== 'channels' && (
          <PlaceholderPage
            tab={activeTab}
            productCount={productCount}
            knowledgeCount={knowledgeCount}
            suggestions={suggestions}
          />
        )}
      </section>
    </main>
  );
}
