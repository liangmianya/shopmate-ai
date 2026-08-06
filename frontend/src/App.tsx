import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Archive,
  Bot,
  Check,
  ChevronRight,
  ClipboardCheck,
  Database,
  Download,
  FileText,
  KeyRound,
  Layers,
  Leaf,
  Link,
  MessagesSquare,
  Package,
  Plus,
  RefreshCcw,
  Search,
  Send,
  Settings2,
  Trash2,
  Upload,
  Wrench,
  X
} from 'lucide-react';
import {
  Books,
  CaretRight,
  ChartDonut,
  ChatCircleDots,
  FileText as PhosphorFileText,
  GearSix,
  Headset,
  Moon,
  PaperPlaneTilt,
  Robot,
  ShareNetwork,
  Sun
} from '@phosphor-icons/react';
import type {
  Icon as PhosphorIcon
} from '@phosphor-icons/react';
import {
  AgentResponse,
  AgentSkill,
  AgentToolResult,
  ChatResponse,
  ChatMessage,
  EmbeddingSettings,
  KnowledgeSuggestion,
  LlmSettings,
  MaintenanceSummary,
  ManagedConversation,
  ManagedConversationMessage,
  OperationAnalytics,
  ProductKnowledge,
  QaKnowledge,
  SearchSettings,
  SystemPromptSettings,
  WecomSettings,
  approveSuggestion,
  confirmAgentTool,
  createKnowledge,
  createProducts,
  cleanupOrphanEmbeddings,
  clearAgentHistory,
  deleteKnowledge,
  deleteKnowledgeBatch,
  deleteProduct,
  deleteProductsBatch,
  deleteSuggestion,
  loadEmbeddingSettings,
  loadAgentSkills,
  loadManagedConversationMessages,
  loadManagedConversations,
  loadMaintenanceSummary,
  loadOperationAnalytics,
  loadKnowledge,
  loadLlmSettings,
  loadProducts,
  loadSearchSettings,
  loadSuggestions,
  loadSystemPromptSettings,
  loadWecomSettings,
  resetSystemPromptSettings,
  factoryResetData,
  runAgentTaskStream,
  saveEmbeddingSettings,
  saveLlmSettings,
  saveSearchSettings,
  saveSystemPromptSettings,
  saveWecomSettings,
  sendChatStream,
  releaseManagedConversation,
  sendManagedConversationMessage,
  takeoverManagedConversation
} from './api';
import shopmateLogo from './assets/shopmate-logo.png';
import katex from 'katex';
import JSZip from 'jszip';
import 'katex/dist/katex.min.css';

type WorkspaceTab = 'agent' | 'customer' | 'conversations' | 'knowledge' | 'settings' | 'channels' | 'analysis' | 'reports';

type Message = ChatMessage;

type ThemeMode = 'light' | 'dark' | 'mist' | 'forest';

type AgentSubview = 'chat' | 'skills';

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
    icon: Headset
  },
  {
    id: 'conversations',
    label: '对话管理',
    description: '接管企微会话',
    icon: ChatCircleDots
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

function themeLabel(theme: ThemeMode) {
  const labels: Record<ThemeMode, string> = {
    light: '白色皮肤',
    dark: '黑色皮肤',
    mist: '雾蓝皮肤',
    forest: '森绿皮肤'
  };
  return labels[theme];
}

function formatChatTime(value: string) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatAnalyticsDay(value: string) {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}

function emotionLabel(value: OperationAnalytics['emotions'][number]['label']) {
  if (value === 'positive') {
    return '正向';
  }
  if (value === 'negative') {
    return '负向';
  }
  return '中性';
}

function conversationStatusText(status: ManagedConversation['status']) {
  if (status === 'manual_active') {
    return '人工接管中';
  }

  if (status === 'manual_required') {
    return '建议人工关注';
  }

  return '机器人接待中';
}

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
      <span className="emptyIcon">
        <Icon size={24} />
      </span>
      <strong>{text}</strong>
    </div>
  );
}

function SelectAllButton({
  checked,
  disabled,
  onClick,
  label = '全选'
}: {
  checked: boolean;
  disabled?: boolean;
  onClick: () => void;
  label?: string;
}) {
  return (
    <button
      aria-pressed={checked}
      className={cx('selectAllButton', checked && 'active')}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      <span className="selectAllIcon" aria-hidden="true">
        {checked && <Check size={13} strokeWidth={3} />}
      </span>
      <span>{label}</span>
    </button>
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
  title,
  action
}: {
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="workspaceHeader">
      <div className="workspaceHeaderTitle">
        <h1>{title}</h1>
      </div>
      {action && <div className="workspaceHeaderAction">{action}</div>}
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

type AgentReference = {
  id: string;
  kind: 'knowledge' | 'web';
  title: string;
  content: string;
  source?: string;
  type?: string;
  url?: string;
};

function isKnowledgeReference(value: unknown): value is AgentReference {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const item = value as Partial<AgentReference>;
  return typeof item.id === 'string' && typeof item.title === 'string' && typeof item.content === 'string';
}

function isWebSourceReference(value: unknown): value is {
  title: string;
  url: string;
  snippet?: string;
  summary?: string;
  siteName?: string;
  datePublished?: string;
} {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const item = value as { title?: unknown; url?: unknown };
  return typeof item.title === 'string' && typeof item.url === 'string';
}

function collectAgentReferences(result?: AgentResponse) {
  const references = new Map<string, AgentReference>();

  for (const tool of result?.toolResults ?? []) {
    if (tool.status !== 'success') {
      continue;
    }

    if (tool.toolName === 'search_knowledge_entries') {
      const output = tool.output as unknown;
      const candidates = Array.isArray(output)
        ? output
        : output && typeof output === 'object' && Array.isArray((output as { matches?: unknown[] }).matches)
          ? (output as { matches: unknown[] }).matches
          : [];

      for (const item of candidates) {
        if (isKnowledgeReference(item)) {
          references.set(`knowledge:${item.id}`, { ...item, kind: 'knowledge' });
        }
      }
    }

    if (tool.toolName === 'search_public_web') {
      const output = tool.output as { sources?: unknown[] };
      for (const item of output.sources ?? []) {
        if (isWebSourceReference(item)) {
          references.set(`web:${item.url}`, {
            id: item.url,
            kind: 'web',
            title: item.title,
            content: item.summary || item.snippet || item.url,
            source: item.siteName || getHost(item.url),
            type: item.datePublished ? `联网 · ${item.datePublished}` : '联网',
            url: item.url
          });
        }
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

function AgentReferences({ references }: { references: AgentReference[] }) {
  if (!references.length) {
    return null;
  }

  return (
    <section className="agentReferences">
      <div className="agentReferencesTitle">
        <Database size={14} />
        <strong>引用来源</strong>
      </div>
      <div className="agentReferenceList">
        {references.slice(0, 6).map((item) => {
          const content = (
            <>
              <span>{item.type || (item.kind === 'web' ? '联网' : '知识库')}{item.source ? ` · ${item.source}` : ''}</span>
              <strong>{item.title}</strong>
              <p>{compactText(item.content, 140)}</p>
            </>
          );

          return item.url ? (
            <a key={item.id} href={item.url} target="_blank" rel="noreferrer">
              {content}
            </a>
          ) : (
            <article key={item.id}>
              {content}
            </article>
          );
        })}
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

  const references = collectAgentReferences(result);

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

function skillIcon(skill: AgentSkill): PhosphorIcon {
  if (skill.id.includes('data') || skill.tags.includes('分析')) {
    return ChartDonut;
  }

  if (skill.id.includes('copy') || skill.tags.includes('文案')) {
    return PhosphorFileText;
  }

  return Books;
}

function formatSkillPolicy(skill: AgentSkill) {
  const preferred = skill.toolPolicy.preferred.length
    ? `优先 ${skill.toolPolicy.preferred.length} 个工具`
    : '按需选工具';
  const resources = `${skill.resources.length} 个资源`;
  const scripts = skill.scripts.some((script) => script.enabled)
    ? '含脚本'
    : skill.scripts.length
      ? '脚本未启用'
      : '无脚本';

  return `${preferred} · ${resources} · ${skill.outputContract.format} · ${scripts}`;
}

function formatSkillSource(skill: AgentSkill) {
  if (skill.source === 'github') {
    return `GitHub · ${skill.entryFile || 'SKILL.md'}`;
  }
  if (skill.packageKind === 'filesystem') {
    return `本地包 · ${skill.entryFile || 'SKILL.md'}`;
  }
  return skill.source === 'imported' ? '导入包' : '内置包';
}

function formatSkillContract(skill: AgentSkill) {
  const sections = skill.outputContract.requiredSections.slice(0, 3).join(' / ');
  return sections || '无固定输出段落';
}

function createSkillImportId(fileName: string) {
  const normalized = fileName
    .replace(/\.(md|zip)$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return `imported-${normalized || 'skill'}-${Date.now().toString(36)}`;
}

function findSkillMarkdownSection(markdown: string, heading: RegExp) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => heading.test(line.trim()));
  if (start < 0) {
    return '';
  }

  const section: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,2}\s+/.test(line.trim())) {
      break;
    }
    section.push(line);
  }
  return section.join('\n').trim();
}

function parseSkillMarkdown(markdown: string, fileName: string): AgentSkill {
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const yamlName = markdown.match(/^name:\s*["']?(.+?)["']?\s*$/mi)?.[1]?.trim();
  const yamlDescription = markdown.match(/^description:\s*["']?(.+?)["']?\s*$/mi)?.[1]?.trim();
  const firstParagraph = markdown
    .split(/\r?\n/)
    .find((line) => line.trim() && !line.trim().startsWith('#') && !line.trim().startsWith('---') && !line.includes(':'))
    ?.trim();
  const name = yamlName || title || fileName.replace(/\.(md|zip)$/i, '');
  const description = yamlDescription || firstParagraph || '从本地文件导入的运营 Agent Skill。';
  const whenToUse = findSkillMarkdownSection(markdown, /^#{1,2}\s+(when to use|适用场景|何时使用)/i);

  return {
    id: createSkillImportId(fileName),
    name,
    description: compactText(description, 300),
    version: '1.0.0',
    instructions: markdown,
    whenToUse,
    inputPlaceholder: `使用${name}完成一个任务`,
    toolPolicy: { preferred: [], required: [], forbidden: [] },
    resources: [],
    outputContract: { format: 'markdown', requiredSections: [], rules: [] },
    scripts: [],
    tags: ['导入'],
    source: 'imported',
    sourceUrl: '',
    packageKind: 'database',
    entryFile: fileName,
    packageDir: '',
    enabled: true
  };
}

async function readSkillImport(file: File) {
  if (/\.md$/i.test(file.name)) {
    return parseSkillMarkdown(await file.text(), file.name);
  }

  if (/\.zip$/i.test(file.name)) {
    const archive = await JSZip.loadAsync(file);
    const entries = Object.values(archive.files).filter((entry) => !entry.dir);
    const skillFile = entries.find((entry) => /(^|\/)SKILL\.md$/i.test(entry.name))
      ?? entries.find((entry) => /\.md$/i.test(entry.name));
    if (!skillFile) {
      throw new Error('压缩包中没有找到 SKILL.md 或 Markdown 文件。');
    }
    return parseSkillMarkdown(await skillFile.async('string'), skillFile.name);
  }

  throw new Error('请选择 .md 或 .zip 格式的 Skill 文件。');
}

function AgentSkillSidebar({
  skills,
  selectedSkillId,
  onSelect,
  onOpenManager
}: {
  skills: AgentSkill[];
  selectedSkillId?: string;
  onSelect: (id?: string) => void;
  onOpenManager: () => void;
}) {
  const selectedSkill = skills.find((skill) => skill.id === selectedSkillId);
  const previewSkills = skills.slice(0, 3);

  return (
    <aside className="skillSidebar" aria-label="运营 Agent 技能">
      <div className="skillPanel">
        <div className="skillHeader">
          <span>能力包</span>
          <button className="skillManageButton" onClick={onOpenManager} type="button">
            <Settings2 size={14} />
            管理技能
          </button>
        </div>

        <section className="skillCurrent">
          <small>当前</small>
          {selectedSkill ? (
            <button className="skillCurrentCard active" onClick={() => onSelect(undefined)} type="button">
              <span>
                <strong>{selectedSkill.name}</strong>
                <em>{formatSkillSource(selectedSkill)}</em>
                <em>{formatSkillPolicy(selectedSkill)}</em>
              </span>
              <X size={14} />
            </button>
          ) : (
            <div className="skillCurrentCard">
              <span>
                <strong>普通模式</strong>
                <em>按任务自动选择工具</em>
              </span>
            </div>
          )}
        </section>

        <section className="skillList">
          <small>可用技能库 · {skills.length}</small>
          {previewSkills.map((skill) => {
            const Icon = skillIcon(skill);
            const active = skill.id === selectedSkillId;
            return (
              <button
                key={skill.id}
                className={cx('skillCard', active && 'active')}
                onClick={() => onSelect(active ? undefined : skill.id)}
                type="button"
              >
                <Icon size={18} weight="duotone" />
                <span>
                  <strong>{skill.name}</strong>
                  <em>{compactText(skill.description, 58)}</em>
                </span>
              </button>
            );
          })}
          {skills.length > previewSkills.length && (
            <button className="skillMoreButton" onClick={onOpenManager} type="button">
              查看全部 {skills.length} 个技能
              <ChevronRight size={15} />
            </button>
          )}
        </section>
      </div>
    </aside>
  );
}

function AgentSkillManager({
  skills,
  selectedSkillId,
  onSelect,
  onBack,
  onToggle,
  onDelete,
  onUpdate,
  onImport,
  onUseInConversation
}: {
  skills: AgentSkill[];
  selectedSkillId?: string;
  onSelect: (id: string) => void;
  onBack: () => void;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (skill: AgentSkill) => void;
  onImport: (file: File) => Promise<void>;
  onUseInConversation: (id: string) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const selectedSkill = skills.find((skill) => skill.id === selectedSkillId) ?? skills[0];
  const [editing, setEditing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState('');
  const [draftPlaceholder, setDraftPlaceholder] = useState('');
  const [draftInstructions, setDraftInstructions] = useState('');

  useEffect(() => {
    if (!selectedSkill) {
      return;
    }
    setDraftPlaceholder(selectedSkill.inputPlaceholder);
    setDraftInstructions(selectedSkill.instructions);
    setEditing(false);
  }, [selectedSkill?.id]);

  async function handleImport(file?: File) {
    if (!file) {
      return;
    }
    setImporting(true);
    setNotice('');
    try {
      await onImport(file);
      setNotice(`已导入 ${file.name}，仅在当前浏览器会话中可用。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '导入失败，请检查文件格式。');
    } finally {
      setImporting(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  }

  return (
    <section className="workspacePage skillManagerWorkspace">
      <PageHeader
        title="技能管理"
        action={
          <button className="ghostButton skillBackButton" onClick={onBack} type="button">
            <ArrowLeft size={16} />
            返回对话
          </button>
        }
      />

      <div className="skillManagerToolbar">
        <div>
          <span>运营 Agent</span>
          <p>管理当前会话可用的能力包。</p>
        </div>
        <input
          ref={fileInputRef}
          accept=".md,.zip,text/markdown,application/zip,application/x-zip-compressed"
          className="skillImportInput"
          onChange={(event) => handleImport(event.target.files?.[0])}
          type="file"
        />
        <button className="primaryButton" disabled={importing} onClick={() => fileInputRef.current?.click()} type="button">
          <Upload size={16} />
          {importing ? '正在导入' : '导入 Skill'}
        </button>
      </div>

      {notice && <div className="skillNotice">{notice}</div>}

      <div className="skillManagerLayout">
        <section className="skillCatalog" aria-label="可用技能库">
          <div className="skillCatalogHeader">
            <h2>可用技能库</h2>
            <span>{skills.length} 个</span>
          </div>
          <div className="skillCatalogList">
            {skills.length ? skills.map((skill) => {
              const Icon = skillIcon(skill);
              const active = skill.id === selectedSkill?.id;
              return (
                <button className={cx('skillCatalogItem', active && 'active')} key={skill.id} onClick={() => onSelect(skill.id)} type="button">
                  <Icon size={18} weight="duotone" />
                  <span>
                    <strong>{skill.name}</strong>
                    <small>{formatSkillSource(skill)}</small>
                  </span>
                  <i>{skill.enabled ? '已启用' : '已关闭'}</i>
                </button>
              );
            }) : <EmptyState text="当前没有可用 Skill" icon={Books} />}
          </div>
        </section>

        {selectedSkill && (
          <section className="skillDetail">
            <div className="skillDetailHeading">
              <div>
                <span>{formatSkillSource(selectedSkill)}</span>
                <h2>{selectedSkill.name}</h2>
                <p>{selectedSkill.description}</p>
              </div>
              <button
                aria-checked={selectedSkill.enabled}
                className={cx('skillSwitch', selectedSkill.enabled && 'active')}
                onClick={() => onToggle(selectedSkill.id)}
                role="switch"
                type="button"
              >
                <i />
                {selectedSkill.enabled ? '已启用' : '已关闭'}
              </button>
            </div>

            <div className="skillDetailMeta">
              <div><span>适用场景</span><strong>{selectedSkill.whenToUse || '按任务自动匹配'}</strong></div>
              <div><span>工具策略</span><strong>{formatSkillPolicy(selectedSkill)}</strong></div>
              <div><span>输出约束</span><strong>{formatSkillContract(selectedSkill)}</strong></div>
            </div>

            {editing ? (
              <div className="skillConfigForm">
                <label>
                  <span>任务输入提示</span>
                  <input value={draftPlaceholder} onChange={(event) => setDraftPlaceholder(event.target.value)} />
                </label>
                <label>
                  <span>执行说明</span>
                  <textarea rows={12} value={draftInstructions} onChange={(event) => setDraftInstructions(event.target.value)} />
                </label>
                <div className="skillDetailActions">
                  <button className="ghostButton skillActionButton" onClick={() => setEditing(false)} type="button">取消</button>
                  <button
                    className="primaryButton"
                    onClick={() => {
                      onUpdate({ ...selectedSkill, inputPlaceholder: draftPlaceholder, instructions: draftInstructions });
                      setEditing(false);
                    }}
                    type="button"
                  >
                    保存本次配置
                  </button>
                </div>
              </div>
            ) : (
              <div className="skillDetailActions">
                <button
                  className="primaryButton"
                  disabled={!selectedSkill.enabled}
                  onClick={() => onUseInConversation(selectedSkill.id)}
                  type="button"
                >
                  用于当前对话
                </button>
                <button className="ghostButton skillActionButton" onClick={() => setEditing(true)} type="button">
                  <Settings2 size={16} />
                  配置
                </button>
                <button className="ghostButton skillActionButton dangerAction" onClick={() => onDelete(selectedSkill.id)} type="button">
                  <Trash2 size={16} />
                  删除
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </section>
  );
}

function AgentPage({
  productCount,
  knowledgeCount,
  suggestions,
  skills,
  onRefresh
}: {
  productCount: number;
  knowledgeCount: number;
  suggestions: KnowledgeSuggestion[];
  skills: AgentSkill[];
  onRefresh: () => Promise<void>;
}) {
  const [agentSubview, setAgentSubview] = useState<AgentSubview>('chat');
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmingTool, setConfirmingTool] = useState(false);
  const [confirmationRequest, setConfirmationRequest] = useState<AgentConfirmationRequest>();
  const [runningAssistantId, setRunningAssistantId] = useState<string>();
  const [selectedSkillId, setSelectedSkillId] = useState<string>();
  const [skillManagerFocusId, setSkillManagerFocusId] = useState<string>();
  const [importedSkills, setImportedSkills] = useState<AgentSkill[]>([]);
  const [disabledSkillIds, setDisabledSkillIds] = useState<string[]>([]);
  const [skillOverrides, setSkillOverrides] = useState<Record<string, Pick<AgentSkill, 'inputPlaceholder' | 'instructions'>>>({});
  const abortControllerRef = useRef<AbortController | null>(null);
  const managedSkills = useMemo(() => (
    [...skills, ...importedSkills].map((skill) => ({
      ...skill,
      ...skillOverrides[skill.id],
      enabled: skill.enabled && !disabledSkillIds.includes(skill.id)
    }))
  ), [disabledSkillIds, importedSkills, skillOverrides, skills]);
  const availableSkills = useMemo(
    () => managedSkills.filter((skill) => skill.enabled),
    [managedSkills]
  );
  const selectedSkill = useMemo(
    () => availableSkills.find((skill) => skill.id === selectedSkillId),
    [availableSkills, selectedSkillId]
  );
  const [messages, setMessages] = useState<AgentMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        '我是运营 Agent。你可以直接给我一个运营任务，例如维护商品库、查询库存、整理报表、分析客服数据或生成知识库草稿。我会按任务需要选择工具，并在对话里展示执行链路和结果。'
    }
  ]);

  useEffect(() => {
    if (selectedSkillId && !availableSkills.some((skill) => skill.id === selectedSkillId)) {
      setSelectedSkillId(undefined);
    }
  }, [availableSkills, selectedSkillId]);

  function openSkillManager() {
    setSkillManagerFocusId(selectedSkillId ?? availableSkills[0]?.id ?? managedSkills[0]?.id);
    setAgentSubview('skills');
  }

  function toggleSkill(skillId: string) {
    setDisabledSkillIds((current) => (
      current.includes(skillId)
        ? current.filter((id) => id !== skillId)
        : [...current, skillId]
    ));
  }

  function deleteSkill(skillId: string) {
    setImportedSkills((current) => current.filter((skill) => skill.id !== skillId));
    setDisabledSkillIds((current) => current.includes(skillId) ? current : [...current, skillId]);
    if (selectedSkillId === skillId) {
      setSelectedSkillId(undefined);
    }
    if (skillManagerFocusId === skillId) {
      setSkillManagerFocusId(managedSkills.find((skill) => skill.id !== skillId)?.id);
    }
  }

  function updateSkill(skill: AgentSkill) {
    setSkillOverrides((current) => ({
      ...current,
      [skill.id]: {
        inputPlaceholder: skill.inputPlaceholder,
        instructions: skill.instructions
      }
    }));
    setImportedSkills((current) => current.map((item) => item.id === skill.id ? skill : item));
  }

  async function importSkill(file: File) {
    const skill = await readSkillImport(file);
    setImportedSkills((current) => [...current, skill]);
    setDisabledSkillIds((current) => current.filter((id) => id !== skill.id));
    setSkillManagerFocusId(skill.id);
  }

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
      }, { riskConfirmed: options.riskConfirmed, skillId: selectedSkill?.id });
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

  if (agentSubview === 'skills') {
    return (
      <AgentSkillManager
        skills={managedSkills}
        selectedSkillId={skillManagerFocusId}
        onBack={() => setAgentSubview('chat')}
        onDelete={deleteSkill}
        onImport={importSkill}
        onSelect={setSkillManagerFocusId}
        onToggle={toggleSkill}
        onUpdate={updateSkill}
        onUseInConversation={(skillId) => {
          setSelectedSkillId(skillId);
          setAgentSubview('chat');
        }}
      />
    );
  }

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
                placeholder={selectedSkill?.inputPlaceholder || '给运营 Agent 一个任务'}
                rows={4}
              />
              <div className="composerFooter">
                <button
                  aria-label={busy ? '停止运行' : '运行任务'}
                  className="primaryButton iconOnly"
                  title={busy ? '停止运行' : '运行任务'}
                  type="submit"
                >
                  {busy ? <X size={16} /> : <PaperPlaneTilt size={17} weight="duotone" />}
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

        <AgentSkillSidebar
          skills={availableSkills}
          selectedSkillId={selectedSkill?.id}
          onSelect={setSelectedSkillId}
          onOpenManager={openSkillManager}
        />
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
      <PageHeader title="智能客服" />

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

function ConversationManagementPage() {
  const [conversations, setConversations] = useState<ManagedConversation[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [messages, setMessages] = useState<ManagedConversationMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const selectedIdRef = useRef<string>();
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const selectedConversation = conversations.find((item) => item.id === selectedId);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  async function refreshConversations(nextSelectedId = selectedId) {
    const result = await loadManagedConversations();
    setConversations(result.conversations);

    if (!nextSelectedId && result.conversations.length) {
      setSelectedId(result.conversations[0].id);
      return result.conversations[0].id;
    }

    if (nextSelectedId && !result.conversations.some((item) => item.id === nextSelectedId)) {
      const fallback = result.conversations[0]?.id;
      setSelectedId(fallback);
      return fallback;
    }

    return nextSelectedId;
  }

  async function refreshMessages(conversationId = selectedId) {
    if (!conversationId) {
      setMessages([]);
      return;
    }

    const result = await loadManagedConversationMessages(conversationId);
    setMessages(result.messages);
  }

  useEffect(() => {
    refreshConversations().catch(() => setNotice('读取会话列表失败，请确认后端服务已启动。'));
  }, []);

  useEffect(() => {
    refreshMessages().catch(() => setNotice('读取聊天记录失败。'));
  }, [selectedId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const currentSelectedId = selectedIdRef.current;
      refreshConversations(currentSelectedId)
        .then((nextSelectedId) => {
          if (nextSelectedId) {
            return refreshMessages(nextSelectedId);
          }
          return undefined;
        })
        .catch(() => undefined);
    }, 3000);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  async function refreshAll() {
    setNotice('');
    try {
      const nextSelectedId = await refreshConversations(selectedId);
      await refreshMessages(nextSelectedId);
    } catch {
      setNotice('刷新失败。');
    }
  }

  async function updateTakeover(mode: 'takeover' | 'release') {
    if (!selectedId || busy) {
      return;
    }

    setBusy(true);
    setNotice('');
    try {
      if (mode === 'takeover') {
        await takeoverManagedConversation(selectedId);
        setNotice('已接管该会话，机器人会暂停自动回复。');
      } else {
        await releaseManagedConversation(selectedId);
        setNotice('已恢复机器人自动接待。');
      }
      await refreshConversations(selectedId);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '状态更新失败。');
    } finally {
      setBusy(false);
    }
  }

  async function submitManualMessage() {
    const content = draft.trim();
    if (!selectedId || !content || busy) {
      return;
    }

    setBusy(true);
    setNotice('');
    try {
      await sendManagedConversationMessage(selectedId, content);
      setDraft('');
      await refreshConversations(selectedId);
      await refreshMessages(selectedId);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '发送失败。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="workspacePage conversationWorkspace">
      <PageHeader
        title="对话管理"
        action={<Stat label="企微会话" value={`${conversations.length}`} tone={conversations.length ? 'good' : 'warn'} />}
      />

      <div className="conversationConsole">
        <aside className="conversationList">
          <div className="conversationListHeader">
            <strong>会话</strong>
            <button className="ghostButton compact" onClick={refreshAll} type="button">
              <RefreshCcw size={14} />
              刷新
            </button>
          </div>

          {conversations.length ? (
            conversations.map((conversation) => (
              <button
                key={conversation.id}
                className={cx('conversationListItem', selectedId === conversation.id && 'active')}
                onClick={() => setSelectedId(conversation.id)}
                type="button"
              >
                <span className="conversationAvatar">{conversation.objectType === 'group' ? '群' : '客'}</span>
                <span className="conversationListBody">
                  <span>
                    <strong>{conversation.displayName}</strong>
                    <small>{formatChatTime(conversation.lastMessageAt)}</small>
                  </span>
                  <em>{conversation.lastMessage || '暂无消息'}</em>
                  <small>{conversationStatusText(conversation.status)}</small>
                </span>
              </button>
            ))
          ) : (
            <EmptyState text="还没有企业微信机器人会话。用户发来消息后会出现在这里。" icon={MessagesSquare} />
          )}
        </aside>

        <section className="chatPanel">
          {selectedConversation ? (
            <>
              <header className="chatPanelHeader">
                <div>
                  <h2>{selectedConversation.displayName}</h2>
                  <p>
                    {selectedConversation.objectType === 'group' ? '群聊' : '单聊'} · {selectedConversation.objectId}
                    {selectedConversation.botId && ` · Bot ${selectedConversation.botId}`}
                  </p>
                </div>
                <div className="chatHeaderActions">
                  <span className={cx('statusPill', selectedConversation.status)}>{conversationStatusText(selectedConversation.status)}</span>
                  {selectedConversation.status === 'manual_active' ? (
                    <button className="ghostButton" disabled={busy} onClick={() => updateTakeover('release')} type="button">
                      恢复机器人
                    </button>
                  ) : (
                    <button className="primaryButton" disabled={busy} onClick={() => updateTakeover('takeover')} type="button">
                      人工接管
                    </button>
                  )}
                </div>
              </header>

              <div className="chatMessages">
                {messages.length ? (
                  messages.map((message) => (
                    <div key={message.id} className={cx('chatBubbleRow', message.role === 'assistant' && 'mine')}>
                      <div className={cx('chatBubble', message.role === 'assistant' && 'mine')}>
                        <small>
                          {message.senderType === 'manual' ? '人工客服' : message.senderType === 'bot' ? '机器人' : '对方'}
                          <span>{formatChatTime(message.createdAt)}</span>
                        </small>
                        <p>{message.content}</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyState text="这个会话暂时没有可展示的聊天记录。" icon={MessagesSquare} />
                )}
                <div ref={messagesEndRef} />
              </div>

              <form
                className="manualComposer"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitManualMessage();
                }}
              >
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  disabled={selectedConversation.status !== 'manual_active' || busy}
                  placeholder={selectedConversation.status === 'manual_active' ? '以机器人身份发送人工回复' : '先点击“人工接管”再回复'}
                  rows={3}
                />
                <button className="primaryButton" disabled={selectedConversation.status !== 'manual_active' || !draft.trim() || busy} type="submit">
                  <Send size={15} />
                  {busy ? '发送中' : '发送'}
                </button>
              </form>
            </>
          ) : (
            <EmptyState text="选择一个会话后查看聊天记录。" icon={MessagesSquare} />
          )}

          {notice && <div className="settingsNotice conversationNotice">{notice}</div>}
        </section>
      </div>
    </section>
  );
}

function KnowledgePage({
  suggestions,
  qaItems,
  products,
  onApprove,
  onDeleteSuggestion,
  onCreateQa,
  onCreateProducts,
  onDeleteQa,
  onDeleteProduct,
  onDeleteQaItems,
  onDeleteProducts
}: {
  suggestions: KnowledgeSuggestion[];
  qaItems: QaKnowledge[];
  products: ProductKnowledge[];
  onApprove: (id: string) => Promise<void>;
  onDeleteSuggestion: (id: string) => Promise<void>;
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
  onDeleteQaItems: (ids: string[]) => Promise<{ deletedCount: number }>;
  onDeleteProducts: (ids: string[]) => Promise<{ deletedCount: number }>;
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [selectedSuggestionIds, setSelectedSuggestionIds] = useState<Set<string>>(() => new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [suggestionBatchDeleting, setSuggestionBatchDeleting] = useState(false);
  const [creatingTarget, setCreatingTarget] = useState<'qa' | 'qaBatch' | 'product' | 'productBatch' | ''>('');
  const visibleQa = qaItems.filter((item) => item.type !== 'product');
  const pendingSuggestions = suggestions.filter((item) => item.status !== 'approved');
  const [expandedSuggestionIds, setExpandedSuggestionIds] = useState<Set<string>>(() => new Set());
  const selectedPendingSuggestionIds = pendingSuggestions.filter((item) => selectedSuggestionIds.has(item.id)).map((item) => item.id);
  const allPendingSuggestionsSelected = Boolean(pendingSuggestions.length) && selectedPendingSuggestionIds.length === pendingSuggestions.length;
  const parseTags = (value: string) => value.split(/[,，、]/).map((tag) => tag.trim()).filter(Boolean);

  function toggleSuggestion(id: string) {
    setExpandedSuggestionIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleSelection(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleSelectAll(items: Array<{ id: string }>) {
    setSelectedIds((current) => current.size === items.length ? new Set() : new Set(items.map((item) => item.id)));
  }

  function toggleSuggestionSelection(id: string) {
    setSelectedSuggestionIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleSelectAllSuggestions() {
    setSelectedSuggestionIds(() => allPendingSuggestionsSelected ? new Set() : new Set(pendingSuggestions.map((item) => item.id)));
  }

  async function approveSuggestionItem(id: string) {
    await onApprove(id);
    setSelectedSuggestionIds((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }

  async function deleteSelectedItems() {
    const ids = [...selectedIds];
    if (!ids.length || batchDeleting) {
      return;
    }
    const label = library === 'qa' ? '问答' : '商品';
    if (!window.confirm(`确定删除选中的 ${ids.length} 条${label}吗？关联的检索向量也会一并清理。`)) {
      return;
    }

    setBatchDeleting(true);
    try {
      const result = library === 'qa' ? await onDeleteQaItems(ids) : await onDeleteProducts(ids);
      setSelectedIds(new Set());
      setLibraryNotice(`已删除 ${result.deletedCount} 条${label}。`);
    } catch {
      setLibraryNotice(`批量删除${label}失败，请稍后重试。`);
    } finally {
      setBatchDeleting(false);
    }
  }

  async function deleteSelectedSuggestions() {
    const ids = selectedPendingSuggestionIds;
    if (!ids.length || suggestionBatchDeleting) {
      return;
    }
    if (!window.confirm(`确定删除选中的 ${ids.length} 条待审核问答吗？`)) {
      return;
    }

    setSuggestionBatchDeleting(true);
    try {
      for (const id of ids) {
        await onDeleteSuggestion(id);
      }
      setSelectedSuggestionIds(new Set());
      setLibraryNotice(`已删除 ${ids.length} 条待审核问答。`);
    } catch {
      setLibraryNotice('批量删除待审核问答失败，请稍后重试。');
    } finally {
      setSuggestionBatchDeleting(false);
    }
  }

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

  async function deleteSuggestionItem(item: KnowledgeSuggestion) {
    const label = item.status === 'approved' ? '已入库建议记录' : '待审核建议';
    const suffix = item.status === 'approved' ? '这只会移除建议记录，不会删除已入库的正式问答。' : '';
    if (!window.confirm(`确定删除${label}“${item.title}”吗？${suffix}`)) {
      return;
    }

    setDeletingId(item.id);
    try {
      await onDeleteSuggestion(item.id);
      setSelectedSuggestionIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
      setLibraryNotice(`已删除${label}。`);
    } catch {
      setLibraryNotice('删除待审核问答失败，请稍后重试。');
    } finally {
      setDeletingId('');
    }
  }

  return (
    <section className="workspacePage">
      <PageHeader
        title="知识库"
        action={
          <div className="headerStats">
            <Stat label="问答库" value={`${visibleQa.length}`} />
            <Stat label="商品库" value={`${products.length}`} />
            <Stat label="待审核" value={`${pendingSuggestions.length}`} />
          </div>
        }
      />

      <div className="knowledgeLibrary">
        <section className="libraryWorkbench">
          <div className="libraryToolbar">
            <div className="libraryTabs">
              <button className={cx(library === 'qa' && 'active')} onClick={() => { setLibrary('qa'); setSelectedIds(new Set()); }} type="button">
                问答库
              </button>
              <button className={cx(library === 'products' && 'active')} onClick={() => { setLibrary('products'); setSelectedIds(new Set()); }} type="button">
                商品库
              </button>
            </div>
            <div className="libraryActions libraryBatchActions">
              {selectedIds.size > 0 && (
                <button
                  className="ghostButton dangerAction batchDeleteButton"
                  disabled={batchDeleting}
                  onClick={deleteSelectedItems}
                  type="button"
                >
                  <Trash2 size={16} />
                  {batchDeleting ? '删除中' : `删除 ${selectedIds.size} 条`}
                </button>
              )}
              <SelectAllButton
                checked={library === 'qa' ? Boolean(visibleQa.length) && selectedIds.size === visibleQa.length : Boolean(products.length) && selectedIds.size === products.length}
                disabled={library === 'qa' ? !visibleQa.length || batchDeleting : !products.length || batchDeleting}
                onClick={() => toggleSelectAll(library === 'qa' ? visibleQa : products)}
              />
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
          </div>

          {library === 'qa' ? (
            <section className="libraryMain">
            {visibleQa.length ? (
              visibleQa.map((item) => (
                <article key={item.id} className="knowledgeItem">
                  <div className="knowledgeItemHeader">
                    <label className="itemSelectControl" title={`选择问答：${item.question}`}>
                      <input checked={selectedIds.has(item.id)} onChange={() => toggleSelection(item.id)} type="checkbox" />
                    </label>
                    <div className="knowledgeItemTitle">
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
          ) : (
            <div className="productKnowledgeGrid">
          {products.length ? (
            products.map((product) => (
              <article key={product.id} className="productKnowledgeItem">
                <div className="knowledgeItemHeader">
                  <label className="itemSelectControl" title={`选择商品：${product.name}`}>
                    <input checked={selectedIds.has(product.id)} onChange={() => toggleSelection(product.id)} type="checkbox" />
                  </label>
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
                  <span><small>品牌</small><strong>{product.brand}</strong></span>
                  <span><small>库存</small><strong>{product.stock}</strong></span>
                  <span><small>价格</small><strong>¥{product.price}</strong></span>
                </div>
                <p>{product.features}</p>
                <div className="productCardFooter">
                  {product.scene && <small>{product.scene}</small>}
                  {product.purchaseUrl && (
                    <a className="productLink" href={product.purchaseUrl} target="_blank" rel="noreferrer">
                      <Link size={14} />
                      购买链接
                    </a>
                  )}
                </div>
              </article>
            ))
          ) : (
            <EmptyState text="商品库暂无内容。" icon={Package} />
          )}
            </div>
          )}
        </section>

        <aside className="librarySide">
          <div className="panel flat">
            <div className="panelHeader">
              <div>
                <span className="iconBadge"><ClipboardCheck size={18} /></span>
                <h2>待审核问答</h2>
              </div>
              <div className={cx('suggestionPanelActions', selectedPendingSuggestionIds.length === 0 && 'idle')}>
                <SelectAllButton
                  checked={allPendingSuggestionsSelected}
                  disabled={!pendingSuggestions.length || suggestionBatchDeleting}
                  onClick={toggleSelectAllSuggestions}
                />
                {selectedPendingSuggestionIds.length > 0 && (
                <span className="batchDeleteSlot">
                  <button
                    className="ghostButton dangerAction batchDeleteButton"
                    disabled={suggestionBatchDeleting}
                    onClick={deleteSelectedSuggestions}
                    type="button"
                  >
                    <Trash2 size={16} />
                    {suggestionBatchDeleting ? '删除中' : `删除 ${selectedPendingSuggestionIds.length} 条`}
                  </button>
                </span>
                )}
              </div>
            </div>

            <div className="suggestionStack">
              {pendingSuggestions.length ? (
                pendingSuggestions.map((item) => {
                  const expanded = expandedSuggestionIds.has(item.id);
                  return (
                  <article key={item.id} className={cx('suggestion', item.status, !expanded && 'collapsed')}>
                    <div className="suggestionHeader">
                      <button
                        aria-expanded={expanded}
                        aria-label={`${expanded ? '收起' : '展开'}待审核问答：${item.title}`}
                        className="suggestionExpandButton"
                        onClick={() => toggleSuggestion(item.id)}
                        title={expanded ? '收起' : '展开'}
                        type="button"
                      >
                        <ChevronRight size={14} className={expanded ? 'open' : ''} />
                      </button>
                      <label className="itemSelectControl suggestionSelectControl" title={`选择待审核问答：${item.title}`}>
                        <input
                          checked={selectedSuggestionIds.has(item.id)}
                          disabled={suggestionBatchDeleting}
                          onChange={() => toggleSuggestionSelection(item.id)}
                          type="checkbox"
                        />
                      </label>
                      <div className="suggestionTitle">
                        <span>待审核</span>
                        <strong>{item.title}</strong>
                      </div>
                      <div className="suggestionActions">
                        <button className="smallButton" disabled={suggestionBatchDeleting} onClick={() => approveSuggestionItem(item.id)} type="button">
                          <FileText size={15} />
                          入库
                        </button>
                        <button
                          aria-label={`删除待审核问答：${item.title}`}
                          className="iconButton danger"
                          disabled={deletingId === item.id || suggestionBatchDeleting}
                          onClick={() => deleteSuggestionItem(item)}
                          title="删除建议"
                          type="button"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                    {expanded && (
                      <div className="suggestionBody">
                        <p>{item.content}</p>
                        <small>{item.reason}</small>
                      </div>
                    )}
                  </article>
                  );
                })
              ) : (
                <EmptyState text="暂无待审核问答。" icon={ClipboardCheck} />
              )}
            </div>
          </div>
        </aside>
        </div>

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

function SettingsPage({
  themeMode,
  onThemeChange,
  onFactoryReset
}: {
  themeMode: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  onFactoryReset: (scope: 'business' | 'factory') => Promise<unknown>;
}) {
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
  const [maintenanceSummary, setMaintenanceSummary] = useState<MaintenanceSummary>();
  const [busyTarget, setBusyTarget] = useState<'llm' | 'embedding' | 'search' | 'systemPrompt' | 'maintenance' | ''>('');
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

  async function refreshMaintenanceSummary() {
    const result = await loadMaintenanceSummary();
    setMaintenanceSummary(result.summary);
  }

  useEffect(() => {
    refreshMaintenanceSummary().catch(() => setNotice('读取数据维护统计失败，请确认后端服务已启动。'));
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

  async function removeOrphanEmbeddings() {
    setBusyTarget('maintenance');
    setNotice('');
    try {
      const result = await cleanupOrphanEmbeddings();
      await refreshMaintenanceSummary();
      setNotice(result.deletedCount ? `已清理 ${result.deletedCount} 条失效向量。` : '没有发现失效向量。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '清理失效向量失败。');
    } finally {
      setBusyTarget('');
    }
  }

  async function removeAgentHistory() {
    if (!window.confirm('确定清空所有 Agent 任务和工具调用记录吗？此操作不可撤销。')) {
      return;
    }
    setBusyTarget('maintenance');
    setNotice('');
    try {
      const result = await clearAgentHistory();
      await refreshMaintenanceSummary();
      setNotice(`已清空 ${result.agentTasks} 条 Agent 任务和 ${result.toolCallLogs} 条工具日志。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '清空 Agent 历史失败。');
    } finally {
      setBusyTarget('');
    }
  }

  async function resetData(scope: 'business' | 'factory') {
    const label = scope === 'factory' ? '完全恢复出厂' : '清空业务数据';
    const confirmation = scope === 'factory'
      ? window.prompt('将清空业务数据、数据库配置与导入技能。请输入“恢复出厂”确认。')
      : window.prompt('将清空商品、知识、会话、建议、任务和向量数据。请输入“清空数据”确认。');
    const expected = scope === 'factory' ? '恢复出厂' : '清空数据';
    if (confirmation !== expected) {
      return;
    }
    setBusyTarget('maintenance');
    setNotice('');
    try {
      await onFactoryReset(scope);
      if (scope === 'factory') {
        window.location.reload();
        return;
      }
      await refreshMaintenanceSummary();
      setNotice(`已完成${label}。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : `${label}失败。`);
    } finally {
      setBusyTarget('');
    }
  }

  return (
    <section className="workspacePage">
      <PageHeader
        title="系统设置"
        action={
          <Stat
            label="联网搜索"
            value={searchSettings?.enabled && searchSettings.apiKeySet ? '已启用' : '未启用'}
            tone={searchSettings?.enabled && searchSettings.apiKeySet ? 'good' : 'warn'}
          />
        }
      />

      <section className="panel flat themeSettingsPanel">
        <div className="panelHeader">
          <div>
            <span className="iconBadge">{themeMode === 'dark' ? <Moon size={18} weight="duotone" /> : themeMode === 'forest' ? <Leaf size={18} /> : <Sun size={18} weight="duotone" />}</span>
            <h2>界面皮肤</h2>
          </div>
          <span className="themeCurrentLabel">{themeLabel(themeMode)}</span>
        </div>

        <div className="themeSwitcher" role="radiogroup" aria-label="界面皮肤">
          <button
            aria-checked={themeMode === 'light'}
            className={cx('themeOption', themeMode === 'light' && 'active')}
            onClick={() => onThemeChange('light')}
            role="radio"
            type="button"
          >
            <span className="themePreview light"><Sun size={18} weight="duotone" /></span>
            <span>
              <strong>白色皮肤</strong>
              <small>适合日常办公和明亮环境。</small>
            </span>
          </button>

          <button
            aria-checked={themeMode === 'mist'}
            className={cx('themeOption', themeMode === 'mist' && 'active')}
            onClick={() => onThemeChange('mist')}
            role="radio"
            type="button"
          >
            <span className="themePreview mist"><Sun size={18} weight="duotone" /></span>
            <span>
              <strong>雾蓝皮肤</strong>
              <small>清爽克制，适合长时间查看数据。</small>
            </span>
          </button>

          <button
            aria-checked={themeMode === 'dark'}
            className={cx('themeOption', themeMode === 'dark' && 'active')}
            onClick={() => onThemeChange('dark')}
            role="radio"
            type="button"
          >
            <span className="themePreview dark"><Moon size={18} weight="duotone" /></span>
            <span>
              <strong>黑色皮肤</strong>
              <small>适合夜间使用和低亮度环境。</small>
            </span>
          </button>

          <button
            aria-checked={themeMode === 'forest'}
            className={cx('themeOption', themeMode === 'forest' && 'active')}
            onClick={() => onThemeChange('forest')}
            role="radio"
            type="button"
          >
            <span className="themePreview forest"><Leaf size={18} /></span>
            <span>
              <strong>森绿皮肤</strong>
              <small>低饱和自然色，适合日常客服运营。</small>
            </span>
          </button>
        </div>
      </section>

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
            <label className={cx('settingsSwitchLine', searchEnabled && 'active')} title="启用博查联网搜索">
              <input
                aria-label="启用博查联网搜索"
                checked={searchEnabled}
                onChange={(event) => setSearchEnabled(event.target.checked)}
                type="checkbox"
              />
              <i aria-hidden="true" />
            </label>
          </div>

          <form
            className="settingsForm"
            onSubmit={(event) => {
              event.preventDefault();
              submitSearch();
            }}
          >
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

      <section className="panel flat dataMaintenancePanel">
        <div className="panelHeader">
          <div>
            <span className="iconBadge"><Archive size={18} /></span>
            <h2>数据维护</h2>
          </div>
          <span className={cx('promptStatus', maintenanceSummary?.orphanEmbeddings ? 'customized' : '')}>
            {maintenanceSummary?.orphanEmbeddings ? `${maintenanceSummary.orphanEmbeddings} 条待清理` : '数据正常'}
          </span>
        </div>

        <div className="maintenanceStats">
          <Stat label="商品" value={`${maintenanceSummary?.products ?? '-'}`} />
          <Stat label="知识" value={`${maintenanceSummary?.knowledgeChunks ?? '-'}`} />
          <Stat label="会话" value={`${maintenanceSummary?.conversations ?? '-'}`} />
          <Stat label="任务日志" value={`${(maintenanceSummary?.agentTasks ?? 0) + (maintenanceSummary?.toolCallLogs ?? 0)}`} />
          <Stat label="检索向量" value={`${maintenanceSummary?.embeddings ?? '-'}`} />
          <Stat label="失效向量" value={`${maintenanceSummary?.orphanEmbeddings ?? '-'}`} tone={maintenanceSummary?.orphanEmbeddings ? 'warn' : 'good'} />
        </div>

        <div className="maintenanceActions">
          <button className="ghostButton" disabled={busyTarget === 'maintenance'} onClick={removeOrphanEmbeddings} type="button">
            <RefreshCcw size={16} />
            清理失效向量
          </button>
          <button className="ghostButton" disabled={busyTarget === 'maintenance'} onClick={removeAgentHistory} type="button">
            <Trash2 size={16} />
            清空 Agent 历史
          </button>
          <button className="ghostButton dangerAction" disabled={busyTarget === 'maintenance'} onClick={() => resetData('business')} type="button">
            <Archive size={16} />
            清空业务数据
          </button>
          <button className="primaryButton danger" disabled={busyTarget === 'maintenance'} onClick={() => resetData('factory')} type="button">
            <AlertTriangle size={16} />
            完全恢复出厂
          </button>
        </div>
      </section>
    </section>
  );
}

function ChannelsPage() {
  const [settings, setSettings] = useState<WecomSettings>();
  const [enabled, setEnabled] = useState(false);
  const [botId, setBotId] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    loadWecomSettings()
      .then((next) => {
        setSettings(next);
        setEnabled(next.enabled);
        setBotId(next.botId);
      })
      .catch(() => setNotice('读取企业微信配置失败，请确认后端服务已启动。'));
  }, []);

  async function submitWecom() {
    setBusy(true);
    setNotice('');

    try {
      const next = await saveWecomSettings({
        enabled,
        botId,
        secret
      });
      setSettings(next);
      setSecret('');
      setNotice('企业微信智能机器人长连接配置已保存，后端会按 BotID 和 Secret 重新建立连接。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '保存失败。');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="workspacePage">
      <PageHeader
        title="渠道接入"
        action={<Stat label="企业微信客服" value={settings?.enabled ? '已启用' : '未启用'} tone={settings?.enabled ? 'good' : 'warn'} />}
      />

      <div className="settingsGrid">
        <section className="panel flat">
          <div className="panelHeader">
            <div>
              <span className="iconBadge"><Link size={18} /></span>
              <h2>企业微信智能机器人</h2>
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
              <span>启用长连接接入</span>
            </label>

            <label>
              <span>BotID</span>
              <input value={botId} onChange={(event) => setBotId(event.target.value)} placeholder="智能机器人的 BotID" />
            </label>

            <label>
              <span>长连接 Secret</span>
              <input
                value={secret}
                onChange={(event) => setSecret(event.target.value)}
                placeholder={settings?.secretSet ? `留空保留：${settings.secretPreview}` : '长连接专用 Secret'}
                type="password"
                autoComplete="off"
              />
            </label>

            <div className="settingsActions">
              <button className="primaryButton" disabled={busy} type="submit">
                <Check size={16} />
                {busy ? '保存中' : '保存长连接配置'}
              </button>
            </div>
          </form>
        </section>

        <aside className="panel flat">
          <div className="panelHeader">
            <div>
              <span className="iconBadge"><Settings2 size={18} /></span>
              <h2>长连接配置</h2>
            </div>
          </div>

          <div className="settingsSummary">
            <Stat label="BotID" value={settings?.botId ? '已填写' : '未填写'} tone={settings?.botId ? 'good' : 'warn'} />
            <Stat label="Secret" value={settings?.secretSet ? '已配置' : '未配置'} tone={settings?.secretSet ? 'good' : 'warn'} />
            <div className="callout">
              <div>
                <Link size={17} />
                <strong>WebSocket 地址</strong>
              </div>
              <p>{settings?.websocketUrl ?? 'wss://openws.work.weixin.qq.com'}</p>
            </div>
            <div className="callout">
              <div>
                <KeyRound size={17} />
                <strong>后台配置</strong>
              </div>
              <p>在企业微信智能机器人配置页开启 API 模式，并选择长连接；该模式只使用 BotID 和长连接 Secret，不使用回调 Token 或 EncodingAESKey。</p>
            </div>
            <div className="callout">
              <div>
                <Database size={17} />
                <strong>当前支持</strong>
              </div>
              <p>支持 `aibot_msg_callback` 文本消息自动回复，并通过 `aibot_respond_msg` 主动推送流式最终结果。</p>
            </div>
            {notice && <div className="settingsNotice">{notice}</div>}
          </div>
        </aside>
      </div>

    </section>
  );
}

function AnalyticsToolbar({
  days,
  onDaysChange,
  onRefresh,
  loading,
  exportReport
}: {
  days: 7 | 30;
  onDaysChange: (value: 7 | 30) => void;
  onRefresh: () => void;
  loading: boolean;
  exportReport?: () => void;
}) {
  return (
    <div className="analyticsToolbar">
      <div className="periodControl" aria-label="统计周期">
        <button className={cx(days === 7 && 'active')} onClick={() => onDaysChange(7)} type="button">近 7 天</button>
        <button className={cx(days === 30 && 'active')} onClick={() => onDaysChange(30)} type="button">近 30 天</button>
      </div>
      <button className="iconButton" aria-label="刷新数据" disabled={loading} onClick={onRefresh} title="刷新数据" type="button">
        <RefreshCcw size={16} />
      </button>
      {exportReport && (
        <button className="ghostButton analyticsExport" disabled={loading} onClick={exportReport} type="button">
          <Download size={15} />
          导出 CSV
        </button>
      )}
    </div>
  );
}

function MetricCard({ label, value, note, tone }: { label: string; value: string; note: string; tone?: 'accent' | 'warning' }) {
  return (
    <article className={cx('analyticsMetric', tone)}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{note}</small>
    </article>
  );
}

function RankedBars({ items, emptyText }: { items: Array<{ label: string; count: number }>; emptyText: string }) {
  const max = Math.max(...items.map((item) => item.count), 1);
  return items.length ? (
    <div className="rankedBars">
      {items.map((item) => (
        <div className="rankedBar" key={item.label}>
          <span title={item.label}>{item.label}</span>
          <div><i style={{ width: `${Math.max((item.count / max) * 100, item.count ? 5 : 0)}%` }} /></div>
          <strong>{item.count}</strong>
        </div>
      ))}
    </div>
  ) : <EmptyState text={emptyText} icon={ChartDonut} />;
}

function ConversationAnalysisPage() {
  const [days, setDays] = useState<7 | 30>(7);
  const [analytics, setAnalytics] = useState<OperationAnalytics>();
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');

  async function refresh() {
    setLoading(true);
    setNotice('');
    try {
      setAnalytics(await loadOperationAnalytics(days));
    } catch {
      setNotice('读取对话分析失败，请确认后端服务已启动。');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [days]);

  return (
    <section className="workspacePage analyticsPage">
      <PageHeader
        title="对话分析"
        action={<AnalyticsToolbar days={days} exportReport={undefined} loading={loading} onDaysChange={setDays} onRefresh={refresh} />}
      />

      {notice && <div className="settingsNotice">{notice}</div>}

      <div className="analyticsMetrics">
        <MetricCard label="咨询会话" value={`${analytics?.overview.conversations ?? 0}`} note={`${days} 天内有客户消息的会话`} />
        <MetricCard label="客户消息" value={`${analytics?.overview.userMessages ?? 0}`} note="来自企业微信机器人会话" />
        <MetricCard label="人工待处理" value={`${analytics?.overview.activeManualConversations ?? 0}`} note="当前仍处于人工接管状态" tone="warning" />
        <MetricCard label="人工介入率" value={formatPercent(analytics?.overview.manualInterventionRate ?? 0)} note="周期内发生人工回复的会话占比" tone="accent" />
      </div>

      <div className="analyticsGrid analysisTopGrid">
        <section className="panel analyticsPanel">
          <div className="panelHeader compactHeader">
            <div><span className="iconBadge"><ChartDonut size={18} /></span><h2>咨询意图</h2></div>
            <small>按会话当前识别结果</small>
          </div>
          <RankedBars items={analytics?.intents ?? []} emptyText="这个周期还没有可分析的会话。" />
        </section>

        <section className="panel analyticsPanel">
          <div className="panelHeader compactHeader">
            <div><span className="iconBadge"><AlertTriangle size={18} /></span><h2>客户情绪</h2></div>
            <small>识别结果会随着最近一轮对话更新</small>
          </div>
          <div className="emotionList">
            {(analytics?.emotions ?? []).map((item) => (
              <div className={cx('emotionRow', item.label)} key={item.label}>
                <span>{emotionLabel(item.label)}</span><strong>{item.count}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="analyticsGrid analysisBottomGrid">
        <section className="panel analyticsPanel">
          <div className="panelHeader compactHeader">
            <div><span className="iconBadge"><MessagesSquare size={18} /></span><h2>高频问题</h2></div>
            <small>相同客户原话合并计数</small>
          </div>
          {analytics?.frequentQuestions.length ? (
            <div className="questionList">
              {analytics.frequentQuestions.map((item, index) => (
                <article key={`${item.text}-${index}`}>
                  <span>{index + 1}</span><p>{item.text}</p><strong>{item.count} 次</strong>
                </article>
              ))}
            </div>
          ) : <EmptyState text="这个周期暂时没有客户提问。" icon={MessagesSquare} />}
        </section>

        <section className="panel analyticsPanel">
          <div className="panelHeader compactHeader">
            <div><span className="iconBadge"><ClipboardCheck size={18} /></span><h2>知识缺口</h2></div>
            <small>来自转人工或人工接管的会话</small>
          </div>
          {analytics?.knowledgeGaps.length ? (
            <div className="insightList">
              {analytics.knowledgeGaps.map((item) => (
                <article key={item.id}>
                  <div><strong>{item.intent}</strong><small>{item.displayName} · {formatChatTime(item.updatedAt)}</small></div>
                  <p>{item.question}</p>
                </article>
              ))}
            </div>
          ) : <EmptyState text="暂未发现需要补充标准答复的会话。" icon={ClipboardCheck} />}
        </section>
      </div>
    </section>
  );
}

function OperationReportsPage() {
  const [days, setDays] = useState<7 | 30>(7);
  const [analytics, setAnalytics] = useState<OperationAnalytics>();
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');

  async function refresh() {
    setLoading(true);
    setNotice('');
    try {
      setAnalytics(await loadOperationAnalytics(days));
    } catch {
      setNotice('读取运营报表失败，请确认后端服务已启动。');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, [days]);

  function exportReport() {
    if (!analytics) {
      return;
    }

    const quote = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
    const rows = [
      ['日期', '客户消息', '机器人回复', '人工回复'],
      ...analytics.daily.map((item) => [item.day, item.userMessages, item.botMessages, item.manualMessages])
    ];
    const blob = new Blob([`\ufeff${rows.map((row) => row.map(quote).join(',')).join('\n')}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `ShopMate-运营报表-${analytics.range.days}天-${analytics.range.generatedAt.slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const maxDailyMessages = Math.max(...(analytics?.daily.map((item) => item.userMessages) ?? []), 1);

  return (
    <section className="workspacePage analyticsPage">
      <PageHeader
        title="运营报表"
        action={<AnalyticsToolbar days={days} exportReport={exportReport} loading={loading} onDaysChange={setDays} onRefresh={refresh} />}
      />

      {notice && <div className="settingsNotice">{notice}</div>}

      <div className="analyticsMetrics">
        <MetricCard label="咨询会话" value={`${analytics?.overview.conversations ?? 0}`} note="周期内发起咨询的对象数" />
        <MetricCard label="机器人回复" value={`${analytics?.overview.botMessages ?? 0}`} note="自动回复消息量" tone="accent" />
        <MetricCard label="自动回复率" value={formatPercent(analytics?.overview.autoReplyRate ?? 0)} note="机器人回复占全部已回复消息" tone="accent" />
        <MetricCard label="人工回复" value={`${analytics?.overview.manualMessages ?? 0}`} note={`${analytics?.overview.manuallyHandledConversations ?? 0} 个会话已人工介入`} tone="warning" />
      </div>

      <section className="panel analyticsPanel reportTrendPanel">
        <div className="panelHeader compactHeader">
          <div><span className="iconBadge"><ChartDonut size={18} /></span><h2>每日咨询趋势</h2></div>
          <small>柱高表示当天客户消息量</small>
        </div>
        <div className="dailyBars">
          {(analytics?.daily ?? []).map((item) => (
            <div className="dailyBar" key={item.day}>
              <strong>{item.userMessages}</strong>
              <div className="dailyBarTrack"><i style={{ height: `${Math.max((item.userMessages / maxDailyMessages) * 100, item.userMessages ? 7 : 0)}%` }} /></div>
              <span>{formatAnalyticsDay(item.day)}</span>
            </div>
          ))}
        </div>
        <div className="reportLegend"><span><i className="user" />客户消息</span><span><i className="bot" />机器人 {analytics?.overview.botMessages ?? 0}</span><span><i className="manual" />人工 {analytics?.overview.manualMessages ?? 0}</span></div>
      </section>

      <div className="analyticsGrid reportBottomGrid">
        <section className="panel analyticsPanel">
          <div className="panelHeader compactHeader">
            <div><span className="iconBadge"><MessagesSquare size={18} /></span><h2>处理构成</h2></div>
            <small>回复消息按处理方统计</small>
          </div>
          <RankedBars items={[
            { label: '机器人回复', count: analytics?.overview.botMessages ?? 0 },
            { label: '人工回复', count: analytics?.overview.manualMessages ?? 0 }
          ]} emptyText="这个周期还没有回复记录。" />
        </section>

        <section className="panel analyticsPanel">
          <div className="panelHeader compactHeader">
            <div><span className="iconBadge"><AlertTriangle size={18} /></span><h2>待人工会话</h2></div>
            <small>目前处于人工接管状态</small>
          </div>
          {analytics?.pendingManual.length ? (
            <div className="insightList compact">
              {analytics.pendingManual.map((item) => (
                <article key={item.id}>
                  <div><strong>{item.displayName}</strong><small>{formatChatTime(item.updatedAt)}</small></div>
                  <p>{item.lastMessage || '暂时没有最新消息'}</p>
                </article>
              ))}
            </div>
          ) : <EmptyState text="当前没有正在人工接管的会话。" icon={ClipboardCheck} />}
        </section>
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
  const content: Record<Exclude<WorkspaceTab, 'agent' | 'customer' | 'conversations' | 'knowledge' | 'settings' | 'channels'>, {
    title: string;
    description: string;
    icon: PhosphorIcon;
    actions: string[];
  }> = {
    analysis: {
      title: '对话分析',
      description: '这里会承接 Agent 分析结果，展示高频问题、转人工原因、情绪分布和知识缺口。',
      icon: ChartDonut,
      actions: ['高频问题', '转人工原因', '情绪分类', '知识缺口']
    },
    reports: {
      title: '运营报表',
      description: '这里会输出每日咨询量、自动回复率、转人工率、商品咨询排行和优化动作。',
      icon: PhosphorFileText,
      actions: ['日报生成', '自动回复率', '商品排行', '优化建议']
    }
  };

  const item = content[tab as Exclude<WorkspaceTab, 'agent' | 'customer' | 'conversations' | 'knowledge' | 'settings' | 'channels'>];
  const Icon = item.icon;

  return (
    <section className="workspacePage">
      <PageHeader title={item.title} />
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
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') {
      return 'light';
    }

    const savedTheme = window.localStorage.getItem('shopmate-theme');
    return savedTheme === 'dark' || savedTheme === 'mist' || savedTheme === 'forest' ? savedTheme : 'light';
  });
  const [suggestions, setSuggestions] = useState<KnowledgeSuggestion[]>([]);
  const [products, setProducts] = useState<ProductKnowledge[]>([]);
  const [knowledgeItems, setKnowledgeItems] = useState<QaKnowledge[]>([]);
  const [agentSkills, setAgentSkills] = useState<AgentSkill[]>([]);
  const productCount = products.length;
  const knowledgeCount = knowledgeItems.length;

  async function refreshMeta() {
    const [productData, knowledgeData, suggestionData, skillData] = await Promise.all([
      loadProducts(),
      loadKnowledge(),
      loadSuggestions(),
      loadAgentSkills()
    ]);
    setProducts(productData.products);
    setKnowledgeItems(knowledgeData.chunks);
    setSuggestions(suggestionData.suggestions);
    setAgentSkills(skillData.skills);
  }

  async function handleApprove(id: string) {
    await approveSuggestion(id);
    await refreshMeta();
  }

  async function handleDeleteSuggestion(id: string) {
    await deleteSuggestion(id);
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

  async function handleDeleteQaItems(ids: string[]) {
    const result = await deleteKnowledgeBatch(ids);
    await refreshMeta();
    return result;
  }

  async function handleDeleteProducts(ids: string[]) {
    const result = await deleteProductsBatch(ids);
    await refreshMeta();
    return result;
  }

  async function handleFactoryReset(scope: 'business' | 'factory') {
    const result = await factoryResetData(scope);
    if (scope === 'factory') {
      window.localStorage.removeItem('shopmate-theme');
      setThemeMode('light');
    }
    await refreshMeta();
    return result;
  }

  useEffect(() => {
    refreshMeta().catch(() => undefined);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    window.localStorage.setItem('shopmate-theme', themeMode);
  }, [themeMode]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [activeTab]);

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
            skills={agentSkills}
            onRefresh={refreshMeta}
          />
        )}
        {activeTab === 'customer' && <CustomerPage onRefresh={refreshMeta} />}
        {activeTab === 'conversations' && <ConversationManagementPage />}
        {activeTab === 'knowledge' && (
          <KnowledgePage
            suggestions={suggestions}
            qaItems={knowledgeItems}
            products={products}
            onApprove={handleApprove}
            onDeleteSuggestion={handleDeleteSuggestion}
            onCreateQa={handleCreateQa}
            onCreateProducts={handleCreateProducts}
            onDeleteQa={handleDeleteQa}
            onDeleteProduct={handleDeleteProduct}
            onDeleteQaItems={handleDeleteQaItems}
            onDeleteProducts={handleDeleteProducts}
          />
        )}
        {activeTab === 'settings' && <SettingsPage themeMode={themeMode} onThemeChange={setThemeMode} onFactoryReset={handleFactoryReset} />}
        {activeTab === 'channels' && <ChannelsPage />}
        {activeTab === 'analysis' && <ConversationAnalysisPage />}
        {activeTab === 'reports' && <OperationReportsPage />}
      </section>
    </main>
  );
}
