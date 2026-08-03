import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { db } from '../db/database.js';
import { getLlmSettings, getSystemPromptSettings } from './settingsService.js';
import type { AgentToolResult, AgentTraceStep } from '../types.js';

const execFileAsync = promisify(execFile);
const now = () => new Date().toISOString();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../..');
const maxToolOutputLength = 6000;
const agentModelTimeoutMs = Number(process.env.AGENT_MODEL_TIMEOUT_MS || 1800000);
const agentRecursionLimit = Number(process.env.AGENT_RECURSION_LIMIT || 100000);
const toolDefaultTimeoutMs = Number(process.env.AGENT_TOOL_TIMEOUT_MS || 300000);
const toolMaxTimeoutMs = Number(process.env.AGENT_TOOL_MAX_TIMEOUT_MS || 1800000);

type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

type AgentMessage = {
  role: ChatRole;
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ModelToolCall[];
};

type ModelToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

type PendingToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

type AgentTaskEvents = {
  onChunk?: (chunk: string) => void;
  onTrace?: (step: AgentTraceStep) => void;
  onToolResult?: (result: AgentToolResult) => void;
};

type AgentTaskOptions = {
  riskConfirmed?: boolean;
};

type OperationAnalysis = {
  total: number;
  manualCount: number;
  negativeCount: number;
  topIntents: Array<{ intent: string; count: number }>;
  candidateQuestions: string[];
};

type KnowledgeSuggestion = {
  id: string;
  title: string;
  content: string;
  reason: string;
  status: string;
  covered?: boolean;
};

const AgentState = Annotation.Root({
  input: Annotation<string>(),
  taskId: Annotation<string>(),
  iteration: Annotation<number>(),
  messages: Annotation<AgentMessage[]>({
    reducer: (left, right) => left.concat(right),
    default: () => []
  }),
  pendingToolCalls: Annotation<PendingToolCall[]>(),
  toolResults: Annotation<AgentToolResult[]>({
    reducer: (left, right) => left.concat(right),
    default: () => []
  }),
  trace: Annotation<AgentTraceStep[]>({
    reducer: (left, right) => left.concat(right),
    default: () => []
  }),
  finalAnswer: Annotation<string>(),
  error: Annotation<string>(),
  riskConfirmed: Annotation<boolean>(),
  abortSignal: Annotation<AbortSignal | undefined>(),
  events: Annotation<AgentTaskEvents | undefined>()
});

const commandSchema = z.object({
  command: z.string().min(1).max(2000),
  timeoutMs: z.number().int().min(1000).max(toolMaxTimeoutMs).optional()
});

const pythonSchema = z.object({
  code: z.string().min(1).max(8000),
  timeoutMs: z.number().int().min(1000).max(toolMaxTimeoutMs).optional()
});

const suggestionSchema = z.object({
  title: z.string().min(1).max(160),
  content: z.string().min(1).max(2000),
  reason: z.string().min(1).max(800)
});

const productCreateSchema = z.object({
  name: z.string().min(1).max(160),
  brand: z.string().min(1).max(120),
  category: z.string().min(1).max(120),
  price: z.number().nonnegative().default(0),
  stock: z.number().int().nonnegative().default(0),
  features: z.string().min(1).max(2000),
  sizeGuide: z.string().max(1000).default(''),
  targetUsers: z.string().max(1000).default(''),
  scene: z.string().max(1000).default(''),
  purchaseUrl: z.string().max(1000).default('')
});

const productDeleteSchema = z.object({
  query: z.string().min(1).max(160).optional(),
  ids: z.array(z.string().min(1)).max(100).optional(),
  brand: z.string().min(1).max(120).optional(),
  category: z.string().min(1).max(120).optional(),
  deleteAll: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional()
});

const knowledgeSearchSchema = z.object({
  query: z.string().min(2).max(120),
  limit: z.number().int().min(1).max(50).optional()
});

const knowledgeDeleteSchema = z.object({
  query: z.string().min(2).max(120),
  limit: z.number().int().min(1).max(50).optional(),
  dryRun: z.boolean().optional()
});

const rawToolSchemas = [
  {
    type: 'function',
    function: {
      name: 'run_shell_command',
      description: 'Run a short, read-mostly PowerShell command inside the project workspace. Use for inspecting files, npm scripts, or lightweight CLI checks.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'PowerShell command to run. Destructive commands are blocked.'
          },
          timeoutMs: {
            type: 'number',
            description: `Timeout in milliseconds, from 1000 to ${toolMaxTimeoutMs}.`
          }
        },
        required: ['command'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'run_python',
      description: 'Run a short Python script in the project workspace for data shaping, calculations, or JSON/text processing.',
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'Python code to execute. Keep it short and print the result.'
          },
          timeoutMs: {
            type: 'number',
            description: `Timeout in milliseconds, from 1000 to ${toolMaxTimeoutMs}.`
          }
        },
        required: ['code'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'query_operation_data',
      description: 'Read customer-service operation data only when the user explicitly asks to analyze conversations, service quality, manual-transfer reasons, daily reports, high-frequency issues, sentiment, or knowledge gaps.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_product',
      description: 'Create one formal product entry in the product library. Use this when the shop owner asks to add, supplement, or import a product. It skips duplicates by name + brand + category.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Product name, without brand if the brand is separately provided.'
          },
          brand: {
            type: 'string',
            description: 'Product brand.'
          },
          category: {
            type: 'string',
            description: 'Product category or product type.'
          },
          price: {
            type: 'number',
            description: 'Product price. Use 0 only if the user did not provide a price.'
          },
          stock: {
            type: 'number',
            description: 'Current stock count. Use 0 only if the user did not provide stock.'
          },
          features: {
            type: 'string',
            description: 'Key product features, selling points, suitable users, or usage notes.'
          },
          sizeGuide: {
            type: 'string',
            description: 'Optional size, specification, shade, or usage guidance.'
          },
          targetUsers: {
            type: 'string',
            description: 'Optional target users.'
          },
          scene: {
            type: 'string',
            description: 'Optional usage scene.'
          },
          purchaseUrl: {
            type: 'string',
            description: 'Optional purchase link.'
          }
        },
        required: ['name', 'brand', 'category', 'price', 'stock', 'features'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_products',
      description: 'Delete formal product-library entries by product id, keyword, brand/category filter, or deleteAll. This is a high-risk tool and only deletes when the UI has confirmed the operation.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Keyword matched against product name, brand, category, features, scene, target users, or purchase URL.'
          },
          ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Specific product ids to delete.'
          },
          brand: {
            type: 'string',
            description: 'Optional brand filter.'
          },
          category: {
            type: 'string',
            description: 'Optional category filter.'
          },
          deleteAll: {
            type: 'boolean',
            description: 'Set true only when the user explicitly asks to delete all products or clear the product library.'
          },
          limit: {
            type: 'number',
            description: 'Maximum matched products to delete, from 1 to 200. Ignored when deleteAll=true.'
          }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'create_knowledge_suggestion',
      description: 'Create a draft FAQ/knowledge-base suggestion only when the user explicitly asks to generate or save a knowledge-base draft, or after conversation analysis when the user asks for knowledge-gap recommendations.',
      parameters: {
        type: 'object',
        properties: {
          title: {
            type: 'string',
            description: 'Short FAQ title or customer question.'
          },
          content: {
            type: 'string',
            description: 'Draft answer/content to add to the knowledge base.'
          },
          reason: {
            type: 'string',
            description: 'Why this draft is useful.'
          }
        },
        required: ['title', 'content', 'reason'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_knowledge_entries',
      description: 'Search formal knowledge-base entries by keyword in title, content, tags, or source. Use before deleting or auditing knowledge.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Keyword to search for, at least 2 characters.'
          },
          limit: {
            type: 'number',
            description: 'Maximum entries to return, from 1 to 50.'
          }
        },
        required: ['query'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'delete_knowledge_entries',
      description: 'Delete formal knowledge-base entries matching a keyword after the user explicitly asks to delete them. Returns deleted entries. Set dryRun=true to preview without deleting.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Keyword that must match title, content, tags, or source.'
          },
          limit: {
            type: 'number',
            description: 'Maximum entries to delete or preview, from 1 to 50.'
          },
          dryRun: {
            type: 'boolean',
            description: 'If true, only preview matches and do not delete.'
          }
        },
        required: ['query'],
        additionalProperties: false
      }
    }
  }
];

const toolOrder = [
  'create_product',
  'delete_products',
  'search_knowledge_entries',
  'create_knowledge_suggestion',
  'delete_knowledge_entries',
  'query_operation_data',
  'run_shell_command',
  'run_python'
];

const toolSchemas = [...rawToolSchemas].sort((left, right) => {
  const leftIndex = toolOrder.indexOf(left.function.name);
  const rightIndex = toolOrder.indexOf(right.function.name);
  return (leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex) - (rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex);
});

function truncateOutput(value: string) {
  return value.length > maxToolOutputLength
    ? `${value.slice(0, maxToolOutputLength)}\n...[truncated ${value.length - maxToolOutputLength} chars]`
    : value;
}

function isAbortError(error: unknown) {
  return error instanceof Error && (error.name === 'AbortError' || error.message.toLowerCase().includes('abort'));
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw new DOMException('Agent task was stopped by user.', 'AbortError');
  }
}

function createRunSignal(parentSignal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new DOMException('Agent model request timed out.', 'AbortError')), timeoutMs);

  const abortFromParent = () => {
    controller.abort(parentSignal?.reason ?? new DOMException('Agent task was stopped by user.', 'AbortError'));
  };

  if (parentSignal?.aborted) {
    abortFromParent();
  } else {
    parentSignal?.addEventListener('abort', abortFromParent, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      parentSignal?.removeEventListener('abort', abortFromParent);
    }
  };
}

function isDangerousCommand(command: string) {
  const normalized = command.toLowerCase();
  return [
    'remove-item',
    'rm ',
    'del ',
    'erase ',
    'rmdir',
    'format-volume',
    'shutdown',
    'restart-computer',
    'stop-computer',
    'git reset',
    'git checkout',
    'set-executionpolicy',
    'invoke-expression',
    'iex ',
    'start-process'
  ].some((token) => normalized.includes(token));
}

function mutatesProductsTable(text: string) {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ');
  return [
    'insert into products',
    'update products',
    'delete from products',
    'drop table products',
    'alter table products',
    'replace into products'
  ].some((token) => normalized.includes(token));
}

function saveToolLog(taskId: string, result: AgentToolResult) {
  db.prepare(`
    INSERT INTO tool_call_logs (id, task_id, tool_name, input, output, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(result.id, taskId, result.toolName, JSON.stringify(result.input), JSON.stringify(result.output), result.status, now());
}

function getOperationSnapshot() {
  const conversations = db
    .prepare(`
      SELECT id, intent, emotion, manual_required, summary, created_at
      FROM conversations
      ORDER BY created_at DESC
      LIMIT 50
    `)
    .all() as Array<{
      id: string;
      intent: string;
      emotion: string;
      manual_required: number;
      summary: string;
      created_at: string;
    }>;

  const intentCount = new Map<string, number>();
  let manualCount = 0;
  let negativeCount = 0;

  for (const row of conversations) {
    intentCount.set(row.intent, (intentCount.get(row.intent) ?? 0) + 1);
    manualCount += row.manual_required ? 1 : 0;
    negativeCount += row.emotion === 'negative' ? 1 : 0;
  }

  const topIntents = [...intentCount.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([intent, count]) => ({ intent, count }));

  const knowledgeCount = (db.prepare('SELECT COUNT(*) AS count FROM knowledge_chunks').get() as { count: number }).count;
  const productCount = (db.prepare('SELECT COUNT(*) AS count FROM products').get() as { count: number }).count;
  const draftSuggestionCount = (
    db.prepare("SELECT COUNT(*) AS count FROM knowledge_suggestions WHERE status != 'approved'").get() as { count: number }
  ).count;

  return {
    conversations,
    analysis: {
      total: conversations.length,
      manualCount,
      negativeCount,
      topIntents,
      candidateQuestions: deriveCandidateQuestions(conversations)
    },
    counters: {
      knowledgeCount,
      productCount,
      draftSuggestionCount
    }
  };
}

function deriveCandidateQuestions(conversations: Array<{ intent: string; summary: string }>) {
  const candidates = new Set<string>();
  for (const item of conversations) {
    const text = `${item.intent} ${item.summary}`;
    if (text.includes('规格') || text.includes('尺码') || text.includes('尺寸') || text.includes('size_recommendation')) {
      candidates.add('商品规格或尺码不确定时应该如何选择？');
    }
    if (text.includes('退') || text.includes('售后') || text.includes('after_sale') || text.includes('complaint')) {
      candidates.add('商品签收或试用后是否支持退换货？');
    }
    if (text.includes('推荐') || text.includes('适合') || text.includes('product_recommendation')) {
      candidates.add('不同使用场景应该优先推荐哪些商品？');
    }
  }
  return [...candidates].slice(0, 5);
}

function listRecentSuggestions(): KnowledgeSuggestion[] {
  return db
    .prepare('SELECT id, title, content, reason, status, created_at FROM knowledge_suggestions ORDER BY created_at DESC LIMIT 20')
    .all() as KnowledgeSuggestion[];
}

function searchKnowledgeEntries(rawArgs: Record<string, unknown>) {
  const args = knowledgeSearchSchema.parse(rawArgs);
  const keyword = `%${args.query.trim()}%`;
  const limit = args.limit ?? 20;

  return db
    .prepare(`
      SELECT id, type, title, content, tags, source, created_at
      FROM knowledge_chunks
      WHERE title LIKE ?
         OR content LIKE ?
         OR tags LIKE ?
         OR source LIKE ?
      ORDER BY updated_at DESC, created_at DESC
      LIMIT ?
    `)
    .all(keyword, keyword, keyword, keyword, limit);
}

function deleteKnowledgeEntries(rawArgs: Record<string, unknown>, riskConfirmed: boolean) {
  const args = knowledgeDeleteSchema.parse(rawArgs);
  const matches = searchKnowledgeEntries({ query: args.query, limit: args.limit ?? 20 }) as Array<{
    id: string;
    type: string;
    title: string;
    content: string;
    tags: string;
    source: string;
    created_at: string;
  }>;

  if (args.dryRun) {
    return {
      dryRun: true,
      matchedCount: matches.length,
      matches
    };
  }

  if (!riskConfirmed) {
    return {
      action: 'confirmation_required',
      confirmationRequired: true,
      matchedCount: matches.length,
      preview: matches.slice(0, 20),
      message: matches.length
        ? `已找到 ${matches.length} 条待删除知识库条目，请在前端确认后再执行删除。`
        : '没有找到匹配的知识库条目，未执行删除。'
    };
  }

  const deleteById = db.prepare('DELETE FROM knowledge_chunks WHERE id = ?');
  const deleteEmbeddingsById = db.prepare('DELETE FROM knowledge_embeddings WHERE chunk_id = ?');

  db.transaction(() => {
    for (const item of matches) {
      deleteEmbeddingsById.run(item.id);
      deleteById.run(item.id);
    }
  })();

  return {
    action: 'deleted',
    dryRun: false,
    deletedCount: matches.length,
    deleted: matches
  };
}

function productKey(item: { name: string; brand: string; category: string }) {
  return [item.name, item.brand, item.category].map((part) => part.trim().toLowerCase()).join('|');
}

function createProduct(rawArgs: Record<string, unknown>) {
  const args = productCreateSchema.parse(rawArgs);
  const product = {
    id: nanoid(),
    name: args.name.trim(),
    brand: args.brand.trim(),
    category: args.category.trim(),
    price: args.price,
    stock: args.stock,
    features: args.features.trim(),
    size_guide: args.sizeGuide.trim(),
    target_users: args.targetUsers.trim(),
    scene: args.scene.trim(),
    purchase_url: args.purchaseUrl.trim()
  };

  const existingRows = db
    .prepare('SELECT id, name, brand, category, price, stock, features, size_guide, target_users, scene, purchase_url FROM products')
    .all() as Array<{
      id: string;
      name: string;
      brand: string;
      category: string;
      price: number;
      stock: number;
      features: string;
      size_guide: string;
      target_users: string;
      scene: string;
      purchase_url: string;
    }>;

  const existing = existingRows.find((item) => productKey(item) === productKey(product));
  if (existing) {
    return {
      action: 'skipped_duplicate',
      createdCount: 0,
      skippedCount: 1,
      product: {
        id: existing.id,
        name: existing.name,
        brand: existing.brand,
        category: existing.category,
        price: existing.price,
        stock: existing.stock,
        features: existing.features,
        sizeGuide: existing.size_guide,
        targetUsers: existing.target_users,
        scene: existing.scene,
        purchaseUrl: existing.purchase_url
      }
    };
  }

  const timestamp = now();
  db.prepare(`
    INSERT INTO products (id, name, brand, category, price, stock, features, size_guide, target_users, scene, purchase_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    product.id,
    product.name,
    product.brand,
    product.category,
    product.price,
    product.stock,
    product.features,
    product.size_guide,
    product.target_users,
    product.scene,
    product.purchase_url,
    timestamp,
    timestamp
  );

  return {
    action: 'created',
    createdCount: 1,
    skippedCount: 0,
    product: {
      id: product.id,
      name: product.name,
      brand: product.brand,
      category: product.category,
      price: product.price,
      stock: product.stock,
      features: product.features,
      sizeGuide: product.size_guide,
      targetUsers: product.target_users,
      scene: product.scene,
      purchaseUrl: product.purchase_url
    }
  };
}

type ProductRow = {
  id: string;
  name: string;
  brand: string;
  category: string;
  price: number;
  stock: number;
  features: string;
  size_guide: string;
  target_users: string;
  scene: string;
  purchase_url: string;
};

function mapProduct(row: ProductRow) {
  return {
    id: row.id,
    name: row.name,
    brand: row.brand,
    category: row.category,
    price: row.price,
    stock: row.stock,
    features: row.features,
    sizeGuide: row.size_guide,
    targetUsers: row.target_users,
    scene: row.scene,
    purchaseUrl: row.purchase_url
  };
}

function findProductsForDeletion(rawArgs: Record<string, unknown>) {
  const args = productDeleteSchema.parse(rawArgs);
  const limit = args.limit ?? 50;

  if (args.deleteAll) {
    return db
      .prepare('SELECT id, name, brand, category, price, stock, features, size_guide, target_users, scene, purchase_url FROM products ORDER BY name')
      .all() as ProductRow[];
  }

  if (args.ids?.length) {
    const rows = db
      .prepare('SELECT id, name, brand, category, price, stock, features, size_guide, target_users, scene, purchase_url FROM products WHERE id = ?')
      .all(args.ids[0]) as ProductRow[];
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const id of args.ids.slice(1)) {
      const row = db
        .prepare('SELECT id, name, brand, category, price, stock, features, size_guide, target_users, scene, purchase_url FROM products WHERE id = ?')
        .get(id) as ProductRow | undefined;
      if (row) {
        byId.set(row.id, row);
      }
    }
    return [...byId.values()].slice(0, limit);
  }

  const clauses: string[] = [];
  const values: Array<string | number> = [];

  if (args.query) {
    const keyword = `%${args.query.trim()}%`;
    clauses.push(`(
      name LIKE ?
      OR brand LIKE ?
      OR category LIKE ?
      OR features LIKE ?
      OR target_users LIKE ?
      OR scene LIKE ?
      OR purchase_url LIKE ?
    )`);
    values.push(keyword, keyword, keyword, keyword, keyword, keyword, keyword);
  }

  if (args.brand) {
    clauses.push('brand LIKE ?');
    values.push(`%${args.brand.trim()}%`);
  }

  if (args.category) {
    clauses.push('category LIKE ?');
    values.push(`%${args.category.trim()}%`);
  }

  if (!clauses.length) {
    throw new Error('delete_products requires ids, query, brand, category, or deleteAll=true.');
  }

  values.push(limit);
  return db
    .prepare(`
      SELECT id, name, brand, category, price, stock, features, size_guide, target_users, scene, purchase_url
      FROM products
      WHERE ${clauses.join(' AND ')}
      ORDER BY name
      LIMIT ?
    `)
    .all(...values) as ProductRow[];
}

function deleteProducts(rawArgs: Record<string, unknown>, riskConfirmed: boolean) {
  const args = productDeleteSchema.parse(rawArgs);
  const matches = findProductsForDeletion(args);
  const products = matches.map(mapProduct);

  if (!riskConfirmed) {
    return {
      action: 'confirmation_required',
      confirmationRequired: true,
      matchedCount: products.length,
      deleteAll: Boolean(args.deleteAll),
      preview: products.slice(0, 20),
      message: products.length
        ? `已找到 ${products.length} 个待删除商品，请在前端确认后再执行删除。`
        : '没有找到匹配的商品，未执行删除。'
    };
  }

  const deleteById = db.prepare('DELETE FROM products WHERE id = ?');
  db.transaction(() => {
    for (const product of matches) {
      deleteById.run(product.id);
    }
  })();

  return {
    action: 'deleted',
    confirmationRequired: false,
    deletedCount: products.length,
    deleteAll: Boolean(args.deleteAll),
    deleted: products
  };
}

async function runShellCommand(rawArgs: Record<string, unknown>, signal?: AbortSignal) {
  throwIfAborted(signal);
  const args = commandSchema.parse(rawArgs);
  if (isDangerousCommand(args.command)) {
    throw new Error('Command rejected by safety policy. Use read-only inspection commands or a narrower non-destructive command.');
  }
  if (mutatesProductsTable(args.command)) {
    throw new Error('Direct products table mutation is rejected. Use create_product for product-library changes.');
  }

  const result = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', args.command], {
    cwd: projectRoot,
    timeout: args.timeoutMs ?? toolDefaultTimeoutMs,
    signal,
    maxBuffer: 1024 * 1024
  });

  return {
    stdout: truncateOutput(result.stdout ?? ''),
    stderr: truncateOutput(result.stderr ?? '')
  };
}

async function runPython(rawArgs: Record<string, unknown>, signal?: AbortSignal) {
  throwIfAborted(signal);
  const args = pythonSchema.parse(rawArgs);
  if (mutatesProductsTable(args.code)) {
    throw new Error('Direct products table mutation is rejected. Use create_product for product-library changes.');
  }
  const result = await execFileAsync('python', ['-c', args.code], {
    cwd: projectRoot,
    timeout: args.timeoutMs ?? toolDefaultTimeoutMs,
    signal,
    maxBuffer: 1024 * 1024
  });

  return {
    stdout: truncateOutput(result.stdout ?? ''),
    stderr: truncateOutput(result.stderr ?? '')
  };
}

function createKnowledgeSuggestion(rawArgs: Record<string, unknown>) {
  const args = suggestionSchema.parse(rawArgs);
  const id = nanoid();
  const timestamp = now();

  db.prepare(`
    INSERT INTO knowledge_suggestions (id, title, content, reason, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, args.title, args.content, args.reason, 'draft', timestamp, timestamp);

  return {
    id,
    title: args.title,
    content: args.content,
    reason: args.reason,
    status: 'draft'
  };
}

async function executeTool(name: string, args: Record<string, unknown>, signal?: AbortSignal, riskConfirmed = false) {
  throwIfAborted(signal);
  if (name === 'run_shell_command') {
    return runShellCommand(args, signal);
  }

  if (name === 'run_python') {
    return runPython(args, signal);
  }

  if (name === 'query_operation_data') {
    return getOperationSnapshot();
  }

  if (name === 'create_product') {
    return createProduct(args);
  }

  if (name === 'delete_products') {
    return deleteProducts(args, riskConfirmed);
  }

  if (name === 'create_knowledge_suggestion') {
    return createKnowledgeSuggestion(args);
  }

  if (name === 'search_knowledge_entries') {
    return searchKnowledgeEntries(args);
  }

  if (name === 'delete_knowledge_entries') {
    return deleteKnowledgeEntries(args, riskConfirmed);
  }

  throw new Error(`Unknown tool: ${name}`);
}

function buildSystemPrompt() {
  const businessPrompt = getSystemPromptSettings().prompt;
  const toolProtocol = [
    '如果当前模型或供应商没有产出原生 tool_calls，你只能在确实需要工具时，用下面的 JSON action 协议表达下一步，且不要包 Markdown：',
    '{"action":"tool","tool":"create_product","args":{"name":"商品名","brand":"品牌","category":"商品类型","price":99,"stock":10,"features":"核心卖点","purchaseUrl":""}}',
    '{"action":"tool","tool":"delete_products","args":{"query":"关键词","limit":20}}',
    '{"action":"tool","tool":"query_operation_data","args":{}}',
    '{"action":"tool","tool":"search_knowledge_entries","args":{"query":"关键词","limit":20}}',
    '{"action":"tool","tool":"create_knowledge_suggestion","args":{"title":"...","content":"...","reason":"..."}}',
    '{"action":"tool","tool":"run_python","args":{"code":"print(2 + 2)"}}',
    '{"action":"tool","tool":"run_shell_command","args":{"command":"Get-ChildItem backend\\\\src"}}',
    '{"action":"final","answer":"最终中文答复"}'
  ].join('\n');

  return [
    '你是 ShopMate AI 的通用电商运营 Agent，负责按用户当前指令完成商品库维护、知识库维护、客服运营分析、日报草稿和轻量自动化。',
    '以下是店主配置的业务系统提示词。将其作为业务角色与服务范围的依据；固定的工具、安全和输出规则仍须遵守：',
    businessPrompt,
    '核心原则：按需调用工具。不要因为系统里有工具就默认读取客服对话、默认分析运营数据、默认生成知识库草稿。',
    '如果用户只是咨询能力、询问流程、要求解释概念、要求改写文案、或任务可直接回答，应直接 final，不要调用工具。',
    '只有用户明确要求分析客服对话、服务数据、转人工原因、日报、高频问题、情绪、知识缺口时，才调用 query_operation_data。',
    '只有用户明确要求生成、创建、保存、补充知识库草稿，或在“分析客服对话并给知识库补充建议”这类任务中明确要求知识库建议时，才调用 create_knowledge_suggestion。',
    '不要把普通对话总结、商品新增、商品删除、库存查询、数据检查自动转化为知识库候选项。',
    '你运行在一个 LangGraph 工具循环里，可以调用工具读取运营数据、维护商品库、检索/创建知识库草稿、运行短命令或 Python。',
    '根据用户目标自主决定是否调用工具；需要当前数据、文件状态、计算结果时，先选择最小必要工具，不要读取与任务无关的数据。',
    '执行策略：如果任务需要真实数据或外部状态，优先调用最匹配的正式工具；如果没有专门工具，但可以通过安全的 run_shell_command 或 run_python 在项目内读取、统计、检查、转换来完成，就使用 CLI/Python 兜底。',
    '不要轻易回答“做不到”。在不越权、不破坏数据、不触发高危操作的前提下，应先尝试现有正式工具、只读查询、CLI/Python 统计或文件检查。',
    '只有在缺少必要权限、缺少外部系统接入、用户目标本身超出当前环境、或安全规则禁止时，才说明无法直接完成，并给出需要补充的工具、权限或数据。',
    '当用户要求新增、补充、导入、录入商品时，必须优先调用 create_product；不要用 run_python 或 run_shell_command 直接操作 products 表。',
    '当用户要求删除商品、移除商品、清空商品库或删除所有商品时，必须调用 delete_products；不要用 run_python 或 run_shell_command 直接操作 products 表。',
    '删除商品属于高危操作。后端只有收到前端确认标记后才会真正删除；如果没有确认，delete_products 会返回 confirmation_required 和预览结果，你必须提示用户确认后再执行。',
    '可以在用户要求时创建知识库建议草稿，但不要直接改正式知识库，正式入库需要店主审核。',
    'create_knowledge_suggestion 只用于 FAQ、售后话术、标准问答等知识库草稿；不要用它新增商品。',
    '当用户明确要求删除正式知识库条目时，可以使用 search_knowledge_entries 检索，再用 delete_knowledge_entries 删除匹配项；删除知识库也属于高危操作，未收到前端确认标记时只返回预览，不会真实删除。',
    '命令和 Python 只用于读取、检查、统计、转换、轻量 CLI 操作；不要执行破坏性操作，也不要绕过正式工具修改受保护业务表。',
    '如果用户要求超出当前工具能力，应先说明已经评估过哪些可用工具不能覆盖，再给出下一步需要接入的工具。',
    '最终回答用中文，只说明本轮任务相关的结果；如果本轮没有创建知识库草稿，不要提“待入库建议”或“知识库候选”。',
    toolProtocol
  ].join('\n');
}

function parseToolCalls(toolCalls: ModelToolCall[] | undefined) {
  return (toolCalls ?? []).map((item) => {
    let args: Record<string, unknown> = {};
    try {
      args = item.function.arguments ? JSON.parse(item.function.arguments) as Record<string, unknown> : {};
    } catch {
      args = { _raw: item.function.arguments };
    }

    return {
      id: item.id || nanoid(),
      name: item.function.name,
      args
    };
  });
}

function parseJsonAction(content: string | null | undefined) {
  if (!content) {
    return null;
  }

  const trimmed = content.trim();
  const jsonText = trimmed.startsWith('```')
    ? trimmed.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
    : trimmed;

  try {
    const parsed = JSON.parse(jsonText) as {
      action?: string;
      tool?: string;
      args?: Record<string, unknown>;
      answer?: string;
    };

    if (parsed.action === 'tool' && parsed.tool) {
      return {
        kind: 'tool' as const,
        tool: parsed.tool,
        args: parsed.args ?? {}
      };
    }

    if (parsed.action === 'final') {
      return {
        kind: 'final' as const,
        answer: parsed.answer ?? ''
      };
    }
  } catch {
    return null;
  }

  return null;
}

function summarizeProductToolResult(result: AgentToolResult) {
  if (result.toolName !== 'create_product' || result.status !== 'success') {
    return null;
  }

  const output = result.output as {
    action?: string;
    createdCount?: number;
    skippedCount?: number;
    product?: {
      name?: string;
      brand?: string;
      category?: string;
      price?: number;
      stock?: number;
      features?: string;
      purchaseUrl?: string;
    };
  };
  const product = output.product;
  if (!product) {
    return null;
  }

  const facts = [
    product.brand ? `品牌：${product.brand}` : '',
    product.category ? `类型：${product.category}` : '',
    typeof product.stock === 'number' ? `库存：${product.stock}` : '',
    typeof product.price === 'number' ? `价格：¥${product.price}` : '',
    product.features ? `特点：${product.features}` : '',
    product.purchaseUrl ? `购买链接：${product.purchaseUrl}` : ''
  ].filter(Boolean).join('；');

  if (output.action === 'skipped_duplicate') {
    return `商品“${product.name ?? '未命名商品'}”已存在，已跳过重复新增。${facts ? `当前记录：${facts}` : ''}`;
  }

  return `已新增商品“${product.name ?? '未命名商品'}”。${facts}`;
}

function summarizeProductDeletionToolResult(result: AgentToolResult) {
  if (result.toolName !== 'delete_products' || result.status !== 'success') {
    return null;
  }

  const output = result.output as {
    action?: string;
    matchedCount?: number;
    deletedCount?: number;
    confirmationRequired?: boolean;
    deleteAll?: boolean;
    preview?: Array<{ name?: string; brand?: string; category?: string }>;
    deleted?: Array<{ name?: string; brand?: string; category?: string }>;
  };

  const list = output.deleted ?? output.preview ?? [];
  const names = list
    .slice(0, 8)
    .map((item) => [item.brand, item.name, item.category ? `(${item.category})` : ''].filter(Boolean).join(' '))
    .filter(Boolean);
  const suffix = names.length ? `：${names.join('、')}${list.length > names.length ? '等' : ''}` : '';

  if (output.action === 'confirmation_required') {
    return `删除商品需要确认。已匹配 ${output.matchedCount ?? list.length} 个商品${suffix}，确认后才会执行删除。`;
  }

  if (output.action === 'deleted') {
    return `已删除 ${output.deletedCount ?? list.length} 个商品${suffix}。`;
  }

  return null;
}

function summarizeKnowledgeDeletionToolResult(result: AgentToolResult) {
  if (result.toolName !== 'delete_knowledge_entries' || result.status !== 'success') {
    return null;
  }

  const output = result.output as {
    action?: string;
    matchedCount?: number;
    deletedCount?: number;
    confirmationRequired?: boolean;
    preview?: Array<{ title?: string; type?: string }>;
    deleted?: Array<{ title?: string; type?: string }>;
  };
  const list = output.deleted ?? output.preview ?? [];
  const titles = list
    .slice(0, 8)
    .map((item) => [item.title, item.type ? `(${item.type})` : ''].filter(Boolean).join(' '))
    .filter(Boolean);
  const suffix = titles.length ? `：${titles.join('、')}${list.length > titles.length ? '等' : ''}` : '';

  if (output.action === 'confirmation_required') {
    return `删除知识库条目需要确认。已匹配 ${output.matchedCount ?? list.length} 条${suffix}，确认后才会执行删除。`;
  }

  if (output.action === 'deleted') {
    return `已删除 ${output.deletedCount ?? list.length} 条知识库条目${suffix}。`;
  }

  return null;
}

function buildGenericToolSummary(results: AgentToolResult[]) {
  if (!results.length) {
    return '模型调用失败，且没有工具执行结果可总结。';
  }

  const productSummaries = results
    .map(summarizeProductToolResult)
    .filter((item): item is string => Boolean(item));
  const productDeletionSummaries = results
    .map(summarizeProductDeletionToolResult)
    .filter((item): item is string => Boolean(item));
  const knowledgeDeletionSummaries = results
    .map(summarizeKnowledgeDeletionToolResult)
    .filter((item): item is string => Boolean(item));
  if (productSummaries.length || productDeletionSummaries.length || knowledgeDeletionSummaries.length) {
    const hasDeletionSummary = productDeletionSummaries.length || knowledgeDeletionSummaries.length;
    return [
      hasDeletionSummary ? '模型总结失败，但高危工具已经执行完毕：' : '模型总结失败，但商品库工具已经执行完毕：',
      ...productSummaries.map((item) => `- ${item}`),
      ...productDeletionSummaries.map((item) => `- ${item}`),
      ...knowledgeDeletionSummaries.map((item) => `- ${item}`)
    ].join('\n');
  }

  const lines = results.slice(-5).map((item) => {
    const output = typeof item.output === 'string' ? item.output : JSON.stringify(item.output);
    return `- ${item.toolName} ${item.status}: ${truncateOutput(output).slice(0, 800)}`;
  });

  return [
    '模型总结失败，但工具已经执行完毕，先返回工具结果摘要：',
    ...lines
  ].join('\n');
}

async function callAgentModel(messages: AgentMessage[], signal?: AbortSignal, onChunk?: (chunk: string) => void) {
  throwIfAborted(signal);
  const { apiKey, baseUrl, model } = getLlmSettings();
  if (!apiKey) {
    throw new Error('未配置大模型 API Key，无法运行通用运营 Agent。请先在“模型设置”里保存对话模型 Key。');
  }

  const runSignal = createRunSignal(signal, agentModelTimeoutMs);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    signal: runSignal.signal,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      stream: true,
      messages,
      tools: toolSchemas,
      tool_choice: 'auto'
    })
  }).finally(runSignal.cleanup);

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Agent LLM request failed: ${response.status}${detail ? ` ${detail.slice(0, 300)}` : ''}`);
  }

  if (!response.body) {
    throw new Error('Agent LLM stream response did not contain a body.');
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const toolCalls = new Map<number, ModelToolCall>();

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line.startsWith('data:')) {
        continue;
      }

      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') {
        continue;
      }

      const payload = JSON.parse(data) as {
        choices?: Array<{
          delta?: {
            content?: string;
            tool_calls?: Array<{
              index: number;
              id?: string;
              type?: 'function';
              function?: {
                name?: string;
                arguments?: string;
              };
            }>;
          };
        }>;
      };
      const delta = payload.choices?.[0]?.delta;

      if (delta?.content) {
        content += delta.content;
        onChunk?.(delta.content);
      }

      for (const toolCallDelta of delta?.tool_calls ?? []) {
        const current = toolCalls.get(toolCallDelta.index) ?? {
          id: toolCallDelta.id ?? nanoid(),
          type: 'function' as const,
          function: {
            name: '',
            arguments: ''
          }
        };

        current.id = toolCallDelta.id ?? current.id;
        current.type = toolCallDelta.type ?? current.type;
        current.function.name += toolCallDelta.function?.name ?? '';
        current.function.arguments += toolCallDelta.function?.arguments ?? '';
        toolCalls.set(toolCallDelta.index, current);
      }
    }
  }

  const message: AgentMessage = {
    role: 'assistant',
    content: content || null,
    tool_calls: [...toolCalls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, item]) => item)
      .filter((item) => item.function.name)
  };

  return message;
}

async function agentNode(state: typeof AgentState.State) {
  throwIfAborted(state.abortSignal);

  const bootstrapMessages = state.messages.length
    ? []
    : [
        { role: 'system' as const, content: buildSystemPrompt() },
        { role: 'user' as const, content: state.input }
      ];

  let modelMessage: AgentMessage;
  try {
    modelMessage = await callAgentModel(
      [...state.messages, ...bootstrapMessages],
      state.abortSignal,
      state.events?.onChunk
    );
  } catch (error) {
    if (isAbortError(error) || state.abortSignal?.aborted) {
      throw error;
    }
    if (state.toolResults.length) {
      return {
        iteration: state.iteration + 1,
        pendingToolCalls: [],
        finalAnswer: buildGenericToolSummary(state.toolResults),
        trace: [{
          label: '本地兜底总结',
          detail: error instanceof Error ? `模型调用失败：${error.message}` : '模型调用失败，已返回工具摘要。',
          status: 'done'
        }]
      };
    }
    throw error;
  }
  let pendingToolCalls = parseToolCalls(modelMessage.tool_calls);
  let nextModelMessage = modelMessage;
  const jsonAction = pendingToolCalls.length ? null : parseJsonAction(modelMessage.content);

  if (jsonAction?.kind === 'tool') {
    const syntheticCall: ModelToolCall = {
      id: `json_${nanoid()}`,
      type: 'function',
      function: {
        name: jsonAction.tool,
        arguments: JSON.stringify(jsonAction.args)
      }
    };
    nextModelMessage = {
      role: 'assistant',
      content: modelMessage.content,
      tool_calls: [syntheticCall]
    };
    pendingToolCalls = parseToolCalls(nextModelMessage.tool_calls);
  }

  const finalAnswer = pendingToolCalls.length
    ? ''
    : jsonAction?.kind === 'final'
      ? jsonAction.answer.trim() || '任务已完成，但模型没有返回文字总结。'
      : modelMessage.content?.trim() || '任务已完成，但模型没有返回文字总结。';

  const traceStep = {
    label: pendingToolCalls.length ? 'Agent 规划' : '结果总结',
    detail: pendingToolCalls.length
      ? `模型请求调用 ${pendingToolCalls.map((item) => item.name).join('、')}。`
      : '模型已给出最终答复。',
    status: 'done' as const
  };
  state.events?.onTrace?.(traceStep);

  return {
    iteration: state.iteration + 1,
    messages: [...bootstrapMessages, nextModelMessage],
    pendingToolCalls,
    finalAnswer,
    trace: [traceStep]
  };
}

async function toolsNode(state: typeof AgentState.State) {
  throwIfAborted(state.abortSignal);
  const messages: AgentMessage[] = [];
  const results: AgentToolResult[] = [];
  const trace: AgentTraceStep[] = [];

  for (const call of state.pendingToolCalls) {
    let output: unknown;
    let status: 'success' | 'error' = 'success';

    try {
      output = await executeTool(call.name, call.args, state.abortSignal, state.riskConfirmed);
    } catch (error) {
      if (isAbortError(error) || state.abortSignal?.aborted) {
        throw error;
      }
      status = 'error';
      output = { error: error instanceof Error ? error.message : 'Tool execution failed.' };
    }

    const result: AgentToolResult = {
      id: nanoid(),
      toolName: call.name,
      input: call.args,
      output,
      status
    };
    saveToolLog(state.taskId, result);
    state.events?.onToolResult?.(result);
    results.push(result);
    messages.push({
      role: 'tool',
      tool_call_id: call.id,
      name: call.name,
      content: JSON.stringify(output).slice(0, maxToolOutputLength)
    });
    const traceStep = {
      label: '工具调用',
      detail: `${call.name}：${status === 'success' ? '执行成功' : '执行失败'}`,
      status: status === 'success' ? 'done' as const : 'blocked' as const
    };
    state.events?.onTrace?.(traceStep);
    trace.push(traceStep);
  }

  return {
    pendingToolCalls: [],
    messages,
    toolResults: results,
    trace
  };
}

function routeAfterAgent(state: typeof AgentState.State) {
  return state.pendingToolCalls.length ? 'tools' : END;
}

const agentGraph = new StateGraph(AgentState)
  .addNode('agent', agentNode)
  .addNode('tools', toolsNode)
  .addEdge(START, 'agent')
  .addConditionalEdges('agent', routeAfterAgent, ['tools', END])
  .addEdge('tools', 'agent')
  .compile();

function emptyAnalysis(): OperationAnalysis {
  return {
    total: 0,
    manualCount: 0,
    negativeCount: 0,
    topIntents: [],
    candidateQuestions: []
  };
}

function isKnowledgeSuggestionOutput(value: unknown): value is KnowledgeSuggestion {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const item = value as Partial<KnowledgeSuggestion>;
  return typeof item.id === 'string'
    && typeof item.title === 'string'
    && typeof item.content === 'string'
    && typeof item.reason === 'string'
    && typeof item.status === 'string';
}

function currentRunSuggestions(toolResults: AgentToolResult[]) {
  return toolResults
    .filter((item) => item.toolName === 'create_knowledge_suggestion' && item.status === 'success')
    .map((item) => item.output)
    .filter(isKnowledgeSuggestionOutput);
}

function buildResultFromState(state: typeof AgentState.State) {
  const analysisOutput = state.toolResults
    .map((item) => item.output)
    .find((item): item is { analysis: OperationAnalysis } => {
      return Boolean(item && typeof item === 'object' && 'analysis' in item);
    });

  return {
    summary: state.finalAnswer || state.error || '运营 Agent 已结束，但没有生成总结。',
    analysis: analysisOutput?.analysis ?? emptyAnalysis(),
    suggestions: currentRunSuggestions(state.toolResults),
    trace: state.trace,
    toolResults: state.toolResults,
    error: state.error
  };
}

export async function runAgentTask(input: string, signal?: AbortSignal, events?: AgentTaskEvents, options: AgentTaskOptions = {}) {
  const taskId = nanoid();
  const createdAt = now();
  const startTrace: AgentTraceStep = { label: 'LangGraph 启动', detail: '进入通用运营 Agent 工具循环。', status: 'done' };
  events?.onTrace?.(startTrace);

  db.prepare(`
    INSERT INTO agent_tasks (id, user_input, intent, skill, status, result, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(taskId, input, 'operation_task', 'langgraph_general_agent', 'running', '', createdAt, createdAt);

  try {
    const finalState = await agentGraph.invoke({
      input,
      taskId,
      iteration: 0,
      messages: [],
      pendingToolCalls: [],
      toolResults: [],
      trace: [startTrace],
      finalAnswer: '',
      error: '',
      riskConfirmed: Boolean(options.riskConfirmed),
      abortSignal: signal,
      events
    }, { recursionLimit: agentRecursionLimit });

    const result = buildResultFromState(finalState);
    db.prepare('UPDATE agent_tasks SET status = ?, result = ?, updated_at = ? WHERE id = ?')
      .run(result.error ? 'error' : 'success', JSON.stringify(result), now(), taskId);

    return {
      taskId,
      ...result
    };
  } catch (error) {
    const aborted = isAbortError(error) || signal?.aborted;
    const message = error instanceof Error ? error.message : '运营 Agent 执行失败。';
    const result = {
      summary: aborted ? '本次运营 Agent 任务已停止。' : message,
      analysis: emptyAnalysis(),
      suggestions: [],
      trace: [
        { label: 'LangGraph 启动', detail: '进入通用运营 Agent 工具循环。', status: 'done' as const },
        { label: aborted ? '用户停止' : '执行失败', detail: aborted ? '前端中断了当前请求，已停止继续调用模型和工具。' : message, status: 'blocked' as const }
      ],
      toolResults: [],
      error: aborted ? 'aborted' : message
    };
    events?.onTrace?.(result.trace[1]);

    db.prepare('UPDATE agent_tasks SET status = ?, result = ?, updated_at = ? WHERE id = ?')
      .run(aborted ? 'aborted' : 'error', JSON.stringify(result), now(), taskId);

    return {
      taskId,
      ...result
    };
  }
}

export function confirmHighRiskAgentTool(toolName: string, args: Record<string, unknown>) {
  if (toolName === 'delete_products') {
    return {
      toolName,
      output: deleteProducts(args, true)
    };
  }

  if (toolName === 'delete_knowledge_entries') {
    return {
      toolName,
      output: deleteKnowledgeEntries(args, true)
    };
  }

  throw new Error(`Tool does not support confirmation: ${toolName}`);
}

export function approveKnowledgeSuggestion(id: string) {
  const suggestion = db
    .prepare('SELECT id, title, content, reason, status FROM knowledge_suggestions WHERE id = ?')
    .get(id) as { id: string; title: string; content: string; reason: string; status: string } | undefined;

  if (!suggestion) {
    return null;
  }

  const timestamp = now();
  db.transaction(() => {
    db.prepare(`
      INSERT INTO knowledge_chunks (id, type, title, content, tags, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(nanoid(), 'faq', suggestion.title, suggestion.content, JSON.stringify(['FAQ', 'Agent建议']), `suggestion:${suggestion.id}`, timestamp, timestamp);
    db.prepare('UPDATE knowledge_suggestions SET status = ?, updated_at = ? WHERE id = ?')
      .run('approved', timestamp, id);
  })();

  return { ...suggestion, status: 'approved' };
}

export function deleteKnowledgeSuggestion(id: string) {
  const suggestion = db
    .prepare('SELECT id, title, content, reason, status FROM knowledge_suggestions WHERE id = ?')
    .get(id) as { id: string; title: string; content: string; reason: string; status: string } | undefined;

  if (!suggestion) {
    return null;
  }

  db.prepare('DELETE FROM knowledge_suggestions WHERE id = ?').run(id);
  return suggestion;
}

export function listSuggestions() {
  return listRecentSuggestions();
}
