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
  Gauge,
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
  Sparkles,
  Wrench,
  X
} from 'lucide-react';
import {
  AgentResponse,
  ChatResponse,
  ChatMessage,
  EmbeddingSettings,
  KnowledgeSuggestion,
  LlmSettings,
  ProductKnowledge,
  QaKnowledge,
  SearchSettings,
  WecomSettings,
  approveSuggestion,
  createKnowledge,
  createProducts,
  loadEmbeddingSettings,
  loadKnowledge,
  loadLlmSettings,
  loadProducts,
  loadSearchSettings,
  loadSuggestions,
  loadWecomSettings,
  runAgentTaskStream,
  saveEmbeddingSettings,
  saveLlmSettings,
  saveSearchSettings,
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
  icon: typeof Bot;
}> = [
  {
    id: 'agent',
    label: '运营 Agent',
    description: '对话式任务执行',
    icon: Bot
  },
  {
    id: 'customer',
    label: '智能客服',
    description: 'RAG 客户接待',
    icon: MessagesSquare
  },
  {
    id: 'knowledge',
    label: '知识库',
    description: 'FAQ 审核入库',
    icon: Database
  },
  {
    id: 'settings',
    label: '模型设置',
    description: 'API URL 与 Key',
    icon: KeyRound
  },
  {
    id: 'channels',
    label: '渠道接入',
    description: '企业微信客服',
    icon: Link
  },
  {
    id: 'analysis',
    label: '对话分析',
    description: '高频问题洞察',
    icon: Gauge
  },
  {
    id: 'reports',
    label: '运营报表',
    description: '日报和指标',
    icon: FileText
  }
];

const demoQuestions = [
  '我平时 42 码，脚有点宽，想买一双半马比赛鞋，推荐哪款？',
  '我穿了一次发现鞋底磨得很厉害，想退货，你们必须给我退。',
  '宽脚能穿竞速鞋吗？'
];

const agentExamples = [
  '分析今天的客服对话，总结高频问题，并给我知识库补充建议。',
  '检查最近转人工的问题，告诉我哪些知识库内容需要补。',
  '把今天的客服情况整理成一份运营日报。'
];

const formatPercent = (value: number) => `${Math.round(value * 100)}%`;

function cx(...items: Array<string | false | undefined>) {
  return items.filter(Boolean).join(' ');
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

function MarkdownMessage({ content }: { content: string }) {
  const lines = content.split('\n');
  const blocks: React.ReactNode[] = [];
  let listItems: string[] = [];
  let mathLines: string[] = [];
  let inMathBlock = false;

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
      flushList();
      blocks.push(<MathFormula key={`math-${index}`} value={singleLineMath[1]} block />);
      return;
    }

    if (trimmed.startsWith('$$')) {
      flushList();
      const rest = trimmed.slice(2);
      if (rest) {
        mathLines.push(rest);
      }
      inMathBlock = true;
      return;
    }

    if (listMatch) {
      listItems.push(listMatch[1]);
      return;
    }

    flushList();

    if (!trimmed) {
      blocks.push(<br key={`br-${index}`} />);
      return;
    }

    blocks.push(<p key={`${trimmed}-${index}`}>{renderInlineMarkdown(trimmed)}</p>);
  });

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
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="workspaceHeader">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="pageDescription">{description}</p>
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

function AgentAssistantMessage({ result, content }: { result?: AgentResponse; content: string }) {
  if (!result) {
    return content ? <MarkdownMessage content={content} /> : <p className="typingDot">正在思考...</p>;
  }

  const toolResults = result.toolResults ?? [];

  return (
    <div className="agentResponse">
      {content ? <MarkdownMessage content={content} /> : <p className="typingDot">正在思考...</p>}

      <div className="agentPlan">
        <div className="agentBlockTitle">
          <Layers size={15} />
          <strong>执行链路</strong>
        </div>
        {result.trace.map((step, index) => (
          <div key={`${step.label}-${index}`} className="agentTraceRow">
            <span><Check size={13} /></span>
            <div>
              <strong>{step.label}</strong>
              <p>{step.detail}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="agentToolGrid">
        {toolResults.length ? (
          toolResults.slice(0, 6).map((tool) => (
            <div key={tool.id}>
              <Wrench size={15} />
              <span>{tool.status === 'success' ? 'success' : 'error'}</span>
              <strong>{tool.toolName}</strong>
            </div>
          ))
        ) : (
          <>
            <div>
              <Wrench size={15} />
              <span>LangGraph</span>
              <strong>未调用工具</strong>
            </div>
            <div>
              <AlertTriangle size={15} />
              <span>manualRequired</span>
              <strong>{result.analysis.manualCount} 条</strong>
            </div>
            <div>
              <ClipboardCheck size={15} />
              <span>knowledgeDrafts</span>
              <strong>{result.suggestions.length} 条建议</strong>
            </div>
          </>
        )}
      </div>

      <div className="agentSuggestionsInline">
        <div className="agentBlockTitle">
          <Sparkles size={15} />
          <strong>知识库补充草稿</strong>
        </div>
        {result.suggestions.map((item) => (
          <article key={item.id}>
            <strong>{item.title}</strong>
            <p>{item.content}</p>
          </article>
        ))}
      </div>
    </div>
  );
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
  const [input, setInput] = useState(agentExamples[0]);
  const [busy, setBusy] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [messages, setMessages] = useState<AgentMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        '我是运营 Agent。你可以直接给我一个运营任务，例如分析客服对话、生成知识库补充建议、整理运营日报或检查转人工原因。我会在对话里展示计划、工具调用和结果。'
    }
  ]);

  async function submit(nextInput = input) {
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
    const assistantId = crypto.randomUUID();
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
    setBusy(true);
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: 'user', content: command },
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
                  content: step.label === 'LangGraph 启动'
                    ? message.content
                    : message.content
                      ? `${message.content}\n\n> ${step.label}：${step.detail}`
                      : `> ${step.label}：${step.detail}`,
                  result: {
                    ...(message.result ?? initialResult),
                    trace: [...(message.result?.trace ?? []), step]
                  }
                }
              : message
          )));
        },
        onTool: (tool) => {
          setMessages((current) => current.map((message) => (
            message.id === assistantId && message.role === 'assistant'
              ? {
                  ...message,
                  content: message.content
                    ? `${message.content}\n\n> 工具 ${tool.toolName} ${tool.status === 'success' ? '执行成功' : '执行失败'}`
                    : `> 工具 ${tool.toolName} ${tool.status === 'success' ? '执行成功' : '执行失败'}`,
                  result: {
                    ...(message.result ?? initialResult),
                    toolResults: [...(message.result?.toolResults ?? []), tool]
                  }
                }
              : message
          )));
        }
      });
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
      setBusy(false);
    }
  }

  const latestResult = [...messages]
    .reverse()
    .find((message): message is Extract<AgentMessage, { role: 'assistant'; result?: AgentResponse }> => message.role === 'assistant' && Boolean(message.result))
    ?.result;

  return (
    <section className="workspacePage agentWorkspace">
      <PageHeader
        eyebrow="Agent Workspace"
        title="运营 Agent"
        description="像 Codex 一样通过对话下达任务，Agent 负责拆解、调用工具、沉淀结果。"
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
                    <AgentAssistantMessage content={message.content} result={message.result} />
                  ) : (
                    <p>{message.content}</p>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="agentComposerWrap">
            <div className="examplePrompts">
              {agentExamples.map((example) => (
                <button key={example} type="button" onClick={() => setInput(example)}>
                  {example}
                </button>
              ))}
            </div>
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
                <div>
                  <span>tools: shell, python, operation_data, knowledge_draft</span>
                </div>
                <button className="primaryButton" type="submit">
                  {busy ? <X size={16} /> : <Play size={16} />}
                  {busy ? '停止' : '运行'}
                </button>
              </div>
            </form>
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
      content: '你好，我是跑步装备客服助手。可以问我商品推荐、尺码选择、售后规则或物流订单问题。'
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
  onCreateProducts
}: {
  suggestions: KnowledgeSuggestion[];
  qaItems: QaKnowledge[];
  products: ProductKnowledge[];
  onApprove: (id: string) => Promise<void>;
  onCreateQa: (items: Array<{ question: string; answer: string; tags: string[] }>) => Promise<void>;
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
  }>) => Promise<void>;
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
  const [productBatch, setProductBatch] = useState('');
  const [libraryNotice, setLibraryNotice] = useState('');
  const visibleQa = qaItems.filter((item) => item.type !== 'product');
  const parseTags = (value: string) => value.split(/[,，、]/).map((tag) => tag.trim()).filter(Boolean);

  async function submitQa() {
    const question = qaQuestion.trim();
    const answer = qaAnswer.trim();
    if (!question || !answer) {
      setLibraryNotice('问答库需要填写问题和答案。');
      return;
    }

    await onCreateQa([{ question, answer, tags: parseTags(qaTags) }]);
    setQaQuestion('');
    setQaAnswer('');
    setQaTags('');
    setLibraryNotice('已新增 1 条问答。');
    setCreateOpen(false);
  }

  async function submitQaBatch() {
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

    await onCreateQa(items);
    setQaBatch('');
    setLibraryNotice(`已批量新增 ${items.length} 条问答。`);
    setCreateOpen(false);
  }

  async function submitProduct() {
    const name = productName.trim();
    const brand = productBrand.trim();
    const category = productCategory.trim();
    const features = productFeatures.trim();
    if (!name || !brand || !category || !features) {
      setLibraryNotice('商品库需要填写商品名、品牌、类型和特性。');
      return;
    }

    await onCreateProducts([{
      name,
      brand,
      category,
      features,
      price: Number(productPrice) || 0,
      stock: Math.max(0, Math.floor(Number(productStock) || 0))
    }]);
    setProductName('');
    setProductBrand('');
    setProductCategory('');
    setProductPrice('0');
    setProductStock('0');
    setProductFeatures('');
    setLibraryNotice('已新增 1 个商品。');
    setCreateOpen(false);
  }

  async function submitProductBatch() {
    const items = productBatch
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [name = '', category = '', brand = '', features = '', stock = '0', price = '0'] = line
          .split('|')
          .map((part) => part.trim());
        return {
          name,
          category,
          brand,
          features,
          stock: Math.max(0, Math.floor(Number(stock) || 0)),
          price: Number(price) || 0
        };
      })
      .filter((item) => item.name && item.category && item.brand && item.features);

    if (!items.length) {
      setLibraryNotice('批量商品格式：商品名 | 商品类型 | 品牌 | 特性 | 库存 | 价格。');
      return;
    }

    await onCreateProducts(items);
    setProductBatch('');
    setLibraryNotice(`已批量新增 ${items.length} 个商品。`);
    setCreateOpen(false);
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
                    <span>{item.type}</span>
                    <strong>{item.question}</strong>
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
                  <span>{product.category}</span>
                  <strong>{product.name}</strong>
                </div>
                <div className="productFacts">
                  <span>品牌：{product.brand}</span>
                  <span>库存：{product.stock}</span>
                  <span>价格：¥{product.price}</span>
                </div>
                <p>{product.features}</p>
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
                      <input value={qaQuestion} onChange={(event) => setQaQuestion(event.target.value)} placeholder="例：宽脚怎么选竞速鞋？" />
                    </label>
                    <label>
                      <span>答案</span>
                      <textarea value={qaAnswer} onChange={(event) => setQaAnswer(event.target.value)} placeholder="填写标准客服回答" rows={4} />
                    </label>
                    <label>
                      <span>标签</span>
                      <input value={qaTags} onChange={(event) => setQaTags(event.target.value)} placeholder="尺码,宽脚,竞速鞋" />
                    </label>
                    <button className="primaryButton" onClick={submitQa} type="button">
                      <Check size={16} />
                      新增问答
                    </button>
                  </div>
                </section>

                <section className="modalSection">
                  <h3>批量导入</h3>
                  <p className="importHint">回车换条，一行一条；每行内部用 <strong>|</strong> 分隔字段。</p>
                  <textarea
                    value={qaBatch}
                    onChange={(event) => setQaBatch(event.target.value)}
                    placeholder={'问题 | 答案 | 标签1,标签2\n宽脚怎么选竞速鞋？ | 优先宽楦，没有宽楦建议大半码。 | 尺码,宽脚'}
                    rows={8}
                  />
                  <button className="smallButton" onClick={submitQaBatch} type="button">
                    批量新增
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
                      <input value={productName} onChange={(event) => setProductName(event.target.value)} placeholder="例：疾风 Pro 碳板竞速跑鞋" />
                    </label>
                    <div className="compactFields">
                      <label>
                        <span>商品类型</span>
                        <input value={productCategory} onChange={(event) => setProductCategory(event.target.value)} placeholder="竞速跑鞋" />
                      </label>
                      <label>
                        <span>品牌</span>
                        <input value={productBrand} onChange={(event) => setProductBrand(event.target.value)} placeholder="RunPeak" />
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
                    <button className="primaryButton" onClick={submitProduct} type="button">
                      <Check size={16} />
                      新增商品
                    </button>
                  </div>
                </section>

                <section className="modalSection">
                  <h3>批量导入</h3>
                  <p className="importHint">回车换条，一行一条；每行内部用 <strong>|</strong> 分隔字段。</p>
                  <textarea
                    value={productBatch}
                    onChange={(event) => setProductBatch(event.target.value)}
                    placeholder={'商品名 | 商品类型 | 品牌 | 特性 | 库存 | 价格\n疾风 Pro | 竞速跑鞋 | RunPeak | 全掌碳板，适合半马比赛 | 42 | 899'}
                    rows={8}
                  />
                  <button className="smallButton" onClick={submitProductBatch} type="button">
                    批量新增
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
  const [busyTarget, setBusyTarget] = useState<'llm' | 'embedding' | 'search' | ''>('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    Promise.all([loadLlmSettings(), loadEmbeddingSettings(), loadSearchSettings()])
      .then(([llm, embedding, search]) => {
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
      })
      .catch(() => setNotice('读取模型配置失败，请确认后端服务已启动。'));
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

  return (
    <section className="workspacePage">
      <PageHeader
        eyebrow="LLM Settings"
        title="模型设置"
        description="配置客服对话使用的 OpenAI 兼容 API。保存后智能客服会优先调用大模型，失败时仍保留本地兜底。"
        action={
          <Stat
            label="联网搜索"
            value={searchSettings?.enabled && searchSettings.apiKeySet ? '已启用' : '未启用'}
            tone={searchSettings?.enabled && searchSettings.apiKeySet ? 'good' : 'warn'}
          />
        }
      />

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
    icon: typeof Package;
    actions: string[];
  }> = {
    analysis: {
      eyebrow: 'Dialogue Analysis',
      title: '对话分析',
      description: '这里会承接 Agent 分析结果，展示高频问题、转人工原因、情绪分布和知识缺口。',
      icon: Gauge,
      actions: ['高频问题', '转人工原因', '情绪分类', '知识缺口']
    },
    reports: {
      eyebrow: 'Reports',
      title: '运营报表',
      description: '这里会输出每日咨询量、自动回复率、转人工率、商品咨询排行和优化动作。',
      icon: FileText,
      actions: ['日报生成', '自动回复率', '商品排行', '优化建议']
    }
  };

  const item = content[tab as Exclude<WorkspaceTab, 'agent' | 'customer' | 'knowledge' | 'settings' | 'channels'>];
  const Icon = item.icon;

  return (
    <section className="workspacePage">
      <PageHeader eyebrow={item.eyebrow} title={item.title} description={item.description} />
      <div className="placeholderPanel">
        <Icon size={28} />
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
  }>) {
    await createProducts(items);
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
                <Icon size={17} />
                <span>
                  <strong>{tab.label}</strong>
                  <small>{tab.description}</small>
                </span>
                {active && <ChevronRight size={16} />}
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
