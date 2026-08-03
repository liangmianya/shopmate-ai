import { db } from '../db/database.js';

const now = () => new Date().toISOString();

export type SkillToolPolicy = {
  preferred: string[];
  required: string[];
  forbidden: string[];
};

export type SkillResource = {
  id: string;
  title: string;
  type: 'reference' | 'template' | 'checklist' | 'example';
  description: string;
  content: string;
};

export type SkillOutputContract = {
  format: 'markdown' | 'table' | 'json' | 'mixed';
  requiredSections: string[];
  rules: string[];
};

export type SkillScript = {
  id: string;
  name: string;
  description: string;
  command: string;
  enabled: boolean;
  risk: 'low' | 'medium' | 'high';
};

export type AgentSkill = {
  id: string;
  name: string;
  description: string;
  version: string;
  instructions: string;
  whenToUse: string;
  inputPlaceholder: string;
  toolPolicy: SkillToolPolicy;
  resources: SkillResource[];
  outputContract: SkillOutputContract;
  scripts: SkillScript[];
  tags: string[];
  source: 'builtin' | 'imported';
  enabled: boolean;
};

export type AgentSkillPackageInput = {
  id: string;
  name: string;
  description: string;
  version?: string;
  instructions: string;
  whenToUse?: string;
  inputPlaceholder?: string;
  toolPolicy?: SkillToolPolicy;
  resources?: SkillResource[];
  outputContract?: SkillOutputContract;
  scripts?: SkillScript[];
  tags?: string[];
  enabled?: boolean;
};

type AgentSkillRow = {
  id: string;
  name: string;
  description: string;
  package_version?: string | null;
  instructions: string;
  when_to_use: string | null;
  input_placeholder: string | null;
  tools?: string | null;
  tool_policy?: string | null;
  resources?: string | null;
  output_contract?: string | null;
  scripts?: string | null;
  tags: string | null;
  source: string;
  enabled: number;
};

const emptyToolPolicy: SkillToolPolicy = {
  preferred: [],
  required: [],
  forbidden: []
};

const defaultOutputContract: SkillOutputContract = {
  format: 'markdown',
  requiredSections: [],
  rules: ['使用中文回答。', '只输出与本轮任务相关的内容。']
};

const builtinSkills: AgentSkill[] = [
  {
    id: 'builtin_information_organizer',
    name: '信息整理',
    description: '把零散内容整理成结构化结果',
    version: '1.0.0',
    whenToUse: '用户需要整理文本、提取字段、制作表格、归纳重点或把混乱信息变成可执行清单时使用。',
    inputPlaceholder: '粘贴需要整理的内容',
    toolPolicy: {
      preferred: [],
      required: [],
      forbidden: []
    },
    resources: [
      {
        id: 'info_table_template',
        title: '信息整理表格模板',
        type: 'template',
        description: '用于把非结构化文字转成字段表。',
        content: [
          '| 项目 | 内容 | 状态 |',
          '| --- | --- | --- |',
          '| 主题 | 从用户材料中提取 | 已确认 / 待补充 |',
          '| 关键事实 | 逐条列出，不合并不确定信息 | 已确认 / 待补充 |',
          '| 下一步 | 可执行动作 | 已确认 / 待补充 |'
        ].join('\n')
      },
      {
        id: 'info_quality_checklist',
        title: '整理质量检查清单',
        type: 'checklist',
        description: '输出前用于检查是否有编造或遗漏。',
        content: [
          '- 没有把用户没说的信息当成事实。',
          '- 不确定字段标记为“待补充”。',
          '- 输出结构能直接复制使用。',
          '- 没有主动扩展到客服数据、知识库草稿或商品库操作。'
        ].join('\n')
      }
    ],
    outputContract: {
      format: 'mixed',
      requiredSections: ['整理结果', '待补充信息'],
      rules: [
        '优先使用表格、清单和短标题。',
        '如无待补充信息，可以写“暂无”。',
        '不要编造用户没有提供的信息。'
      ]
    },
    scripts: [],
    tags: ['整理', '结构化'],
    source: 'builtin',
    enabled: true,
    instructions: [
      '你正在使用「信息整理」Skill Package。',
      '目标：把用户提供的零散信息整理成清晰、结构化、可复制的结果。',
      '规则：',
      '1. 优先使用表格、清单、分组标题来降低阅读成本。',
      '2. 不要编造用户没有提供的信息；不确定的字段标记为“待补充”。',
      '3. 如果用户明确要求某种格式，优先遵守用户格式。',
      '4. 输出要简洁，避免把整理任务扩展成无关分析。'
    ].join('\n')
  },
  {
    id: 'builtin_data_analysis',
    name: '数据分析',
    description: '分析数据、发现趋势和异常',
    version: '1.0.0',
    whenToUse: '用户需要分析表格、运营数据、客服数据、指标变化、异常原因、复盘或趋势时使用。',
    inputPlaceholder: '描述要分析的数据或时间范围',
    toolPolicy: {
      preferred: ['query_operation_data', 'run_python'],
      required: [],
      forbidden: []
    },
    resources: [
      {
        id: 'analysis_frame',
        title: '运营分析框架',
        type: 'reference',
        description: '用于把分析结果落到运营动作。',
        content: [
          '分析时按这个顺序组织：',
          '1. 先确认分析对象、口径和时间范围。',
          '2. 再给关键发现，必须说明证据来源或计算口径。',
          '3. 对异常给出可能原因，并区分事实与推测。',
          '4. 最后给出下一步动作，尽量具体到“查什么、改什么、观察什么”。'
        ].join('\n')
      },
      {
        id: 'analysis_output_template',
        title: '分析输出模板',
        type: 'template',
        description: '默认分析报告结构。',
        content: [
          '## 关键发现',
          '## 证据',
          '## 可能原因',
          '## 建议动作',
          '## 数据不足或假设'
        ].join('\n')
      }
    ],
    outputContract: {
      format: 'mixed',
      requiredSections: ['关键发现', '证据', '可能原因', '建议动作'],
      rules: [
        '数据不足时必须说明不足，不要编造指标或趋势。',
        '涉及计算、聚合或清洗时，优先使用正式工具；没有专门工具时再用安全的 Python/CLI 兜底。',
        '只有用户明确要求分析客服对话、运营数据、转人工原因、高频问题、情绪或知识缺口时，才读取运营数据。'
      ]
    },
    scripts: [
      {
        id: 'local_analysis_helper',
        name: '本地数据分析脚本位',
        description: '为未来 Skill 包脚本预留：用于安全聚合用户提供的数据文件。',
        command: 'python scripts/analyze.py',
        enabled: false,
        risk: 'medium'
      }
    ],
    tags: ['分析', '趋势'],
    source: 'builtin',
    enabled: true,
    instructions: [
      '你正在使用「数据分析」Skill Package。',
      '目标：围绕用户指定的数据回答“发生了什么、为什么、下一步怎么做”。',
      '规则：',
      '1. 先确认分析对象和时间范围；如果用户没有给出范围，使用最小必要范围并说明假设。',
      '2. 只有用户明确要求分析客服对话、运营数据、转人工原因、高频问题、情绪或知识缺口时，才读取运营数据。',
      '3. 输出必须包含：关键发现、证据、可能原因、建议动作。',
      '4. 数据不足时明确说明不足，不要编造指标或趋势。',
      '5. 需要计算、聚合或清洗时，可以优先使用正式查询工具；没有专门工具时再用安全的 Python/CLI 兜底。'
    ].join('\n')
  },
  {
    id: 'builtin_copywriting',
    name: '文案生成',
    description: '生成面向用户的中文文案',
    version: '1.0.0',
    whenToUse: '用户需要生成、润色、改写营销文案、客服话术、通知公告、活动说明或对外表达时使用。',
    inputPlaceholder: '告诉我要写什么文案、给谁看、语气如何',
    toolPolicy: {
      preferred: [],
      required: [],
      forbidden: []
    },
    resources: [
      {
        id: 'copy_style_guide',
        title: '中文电商文案风格',
        type: 'reference',
        description: '默认文案语气约束。',
        content: [
          '- 口吻自然，像店铺运营而不是技术系统。',
          '- 少用夸张承诺，避免“绝对、永久、最强”等不可证实表达。',
          '- 卖点要和用户场景绑定，不堆形容词。',
          '- 面向客户的文字不要出现内部工具、数据库、RAG 等技术表达。'
        ].join('\n')
      },
      {
        id: 'copy_variant_template',
        title: '文案多版本模板',
        type: 'template',
        description: '默认生成两个可选版本。',
        content: [
          '## 自然版',
          '适合私域、客服回复或详情页轻介绍。',
          '',
          '## 精简版',
          '适合按钮、短信、标题或卡片。'
        ].join('\n')
      }
    ],
    outputContract: {
      format: 'markdown',
      requiredSections: ['自然版', '精简版'],
      rules: [
        '默认至少输出两个版本。',
        '不要编造价格、活动力度、承诺或规则。',
        '如果信息不足，先给通用版本，并列出可补充信息。'
      ]
    },
    scripts: [],
    tags: ['文案', '改写'],
    source: 'builtin',
    enabled: true,
    instructions: [
      '你正在使用「文案生成」Skill Package。',
      '目标：生成清晰、自然、可直接使用的中文文案。',
      '规则：',
      '1. 先识别目标用户、使用渠道、语气、核心卖点或主要信息。',
      '2. 信息不足时，可以先给一个通用版本，并列出可补充的信息。',
      '3. 默认输出至少两个版本：自然版和精简版。',
      '4. 不要编造价格、活动力度、承诺或规则；没有依据的内容要标注为待确认。',
      '5. 面向客户的文字要自然，不要出现内部工具、RAG、数据库等技术表达。'
    ].join('\n')
  }
];

function writeSkillPackage(skill: AgentSkill) {
  const timestamp = now();
  db.prepare(`
    INSERT INTO agent_skills (
      id, name, description, package_version, instructions, when_to_use, input_placeholder,
      tools, tool_policy, resources, output_contract, scripts, tags, source, enabled, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      package_version = excluded.package_version,
      instructions = excluded.instructions,
      when_to_use = excluded.when_to_use,
      input_placeholder = excluded.input_placeholder,
      tools = excluded.tools,
      tool_policy = excluded.tool_policy,
      resources = excluded.resources,
      output_contract = excluded.output_contract,
      scripts = excluded.scripts,
      tags = excluded.tags,
      source = excluded.source,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `).run(
    skill.id,
    skill.name,
    skill.description,
    skill.version,
    skill.instructions,
    skill.whenToUse,
    skill.inputPlaceholder,
    JSON.stringify(skill.toolPolicy.preferred),
    JSON.stringify(skill.toolPolicy),
    JSON.stringify(skill.resources),
    JSON.stringify(skill.outputContract),
    JSON.stringify(skill.scripts),
    JSON.stringify(skill.tags),
    skill.source,
    skill.enabled ? 1 : 0,
    timestamp,
    timestamp
  );
}

function parseJsonList(value: string | null | undefined) {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function parseJsonObject<T>(value: string | null | undefined, fallback: T, guard: (item: unknown) => item is T) {
  if (!value) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return guard(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isToolPolicy(value: unknown): value is SkillToolPolicy {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const item = value as Partial<SkillToolPolicy>;
  return isStringList(item.preferred) && isStringList(item.required) && isStringList(item.forbidden);
}

function isSkillResource(value: unknown): value is SkillResource {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const item = value as Partial<SkillResource>;
  return typeof item.id === 'string'
    && typeof item.title === 'string'
    && ['reference', 'template', 'checklist', 'example'].includes(item.type ?? '')
    && typeof item.description === 'string'
    && typeof item.content === 'string';
}

function isSkillOutputContract(value: unknown): value is SkillOutputContract {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const item = value as Partial<SkillOutputContract>;
  return ['markdown', 'table', 'json', 'mixed'].includes(item.format ?? '')
    && isStringList(item.requiredSections)
    && isStringList(item.rules);
}

function isSkillScript(value: unknown): value is SkillScript {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const item = value as Partial<SkillScript>;
  return typeof item.id === 'string'
    && typeof item.name === 'string'
    && typeof item.description === 'string'
    && typeof item.command === 'string'
    && typeof item.enabled === 'boolean'
    && ['low', 'medium', 'high'].includes(item.risk ?? '');
}

function parseResourceList(value: string | null | undefined) {
  return parseJsonObject(value, [] as SkillResource[], (item): item is SkillResource[] => Array.isArray(item) && item.every(isSkillResource));
}

function parseScriptList(value: string | null | undefined) {
  return parseJsonObject(value, [] as SkillScript[], (item): item is SkillScript[] => Array.isArray(item) && item.every(isSkillScript));
}

function normalizeToolPolicy(row: AgentSkillRow) {
  const fromPackage = parseJsonObject(row.tool_policy, undefined as SkillToolPolicy | undefined, isToolPolicy);
  if (fromPackage) {
    return fromPackage;
  }

  const legacyTools = parseJsonList(row.tools);
  return legacyTools.length
    ? { preferred: legacyTools, required: [], forbidden: [] }
    : emptyToolPolicy;
}

function mapRow(row: AgentSkillRow): AgentSkill {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    version: row.package_version ?? '1.0.0',
    instructions: row.instructions,
    whenToUse: row.when_to_use ?? '',
    inputPlaceholder: row.input_placeholder ?? '',
    toolPolicy: normalizeToolPolicy(row),
    resources: parseResourceList(row.resources),
    outputContract: parseJsonObject(row.output_contract, defaultOutputContract, isSkillOutputContract),
    scripts: parseScriptList(row.scripts),
    tags: parseJsonList(row.tags),
    source: row.source === 'imported' ? 'imported' : 'builtin',
    enabled: Boolean(row.enabled)
  };
}

export function ensureBuiltinAgentSkills() {
  const transaction = db.transaction(() => {
    for (const skill of builtinSkills) {
      writeSkillPackage(skill);
    }
  });
  transaction();
}

export function saveImportedAgentSkill(input: AgentSkillPackageInput) {
  ensureBuiltinAgentSkills();
  const skill: AgentSkill = {
    id: input.id,
    name: input.name,
    description: input.description,
    version: input.version ?? '1.0.0',
    instructions: input.instructions,
    whenToUse: input.whenToUse ?? '',
    inputPlaceholder: input.inputPlaceholder ?? '',
    toolPolicy: input.toolPolicy ?? emptyToolPolicy,
    resources: input.resources ?? [],
    outputContract: input.outputContract ?? defaultOutputContract,
    scripts: input.scripts ?? [],
    tags: input.tags ?? [],
    source: 'imported',
    enabled: input.enabled ?? true
  };

  writeSkillPackage(skill);
  return skill;
}

export function listAgentSkills() {
  ensureBuiltinAgentSkills();
  const rows = db.prepare(`
    SELECT
      id, name, description, package_version, instructions, when_to_use, input_placeholder,
      tools, tool_policy, resources, output_contract, scripts, tags, source, enabled
    FROM agent_skills
    WHERE enabled = 1
    ORDER BY source ASC, created_at ASC
  `).all() as AgentSkillRow[];

  return rows.map(mapRow);
}

export function getAgentSkill(id: string | undefined) {
  if (!id) {
    return undefined;
  }

  ensureBuiltinAgentSkills();
  const row = db.prepare(`
    SELECT
      id, name, description, package_version, instructions, when_to_use, input_placeholder,
      tools, tool_policy, resources, output_contract, scripts, tags, source, enabled
    FROM agent_skills
    WHERE id = ? AND enabled = 1
  `).get(id) as AgentSkillRow | undefined;

  return row ? mapRow(row) : undefined;
}
