import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db/database.js';

const now = () => new Date().toISOString();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '../../..');

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
  path?: string;
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
  path?: string;
};

export type AgentSkillSource = 'github' | 'filesystem' | 'imported' | 'builtin';
export type AgentSkillPackageKind = 'filesystem' | 'database';

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
  source: AgentSkillSource;
  sourceUrl: string;
  packageKind: AgentSkillPackageKind;
  entryFile: string;
  packageDir: string;
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
  package_kind?: string | null;
  entry_file?: string | null;
  package_dir?: string | null;
  source_url?: string | null;
  tags: string | null;
  source: string;
  enabled: number;
};

type MountedSkillDefinition = {
  id: string;
  fallbackName: string;
  fallbackDescription: string;
  packageDir: string;
  entryFile: string;
  source: AgentSkillSource;
  sourceUrl: string;
  version: string;
  tags: string[];
  inputPlaceholder: string;
  whenToUse: string;
  toolPolicy: SkillToolPolicy;
  outputContract: SkillOutputContract;
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

const legacyBuiltinSkillIds = [
  'builtin_information_organizer',
  'builtin_data_analysis',
  'builtin_copywriting'
];

const mountedSkillPackages: MountedSkillDefinition[] = [
  {
    id: 'khazix_writer',
    fallbackName: '卡兹克写文章',
    fallbackDescription: '数字生命卡兹克的公众号长文写作 Skill，适合写稿、扩写、续写、根据素材产出公众号长文。',
    packageDir: 'backend/agent-skills/khazix-writer',
    entryFile: 'backend/agent-skills/khazix-writer/SKILL.md',
    source: 'github',
    sourceUrl: 'https://github.com/KKKKhazix/khazix-skills/tree/main/khazix-writer',
    version: 'github-main',
    tags: ['写作', '公众号', '长文', '卡兹克'],
    inputPlaceholder: '输入选题、素材、要点或已有草稿，让卡兹克写成公众号长文',
    whenToUse: '当用户需要撰写公众号文章、写稿子、续写文章、扩写长文、根据素材产出长文时使用；不用于短内容、小红书、推特、朋友圈或纯标题摘要。',
    toolPolicy: {
      preferred: [],
      required: [],
      forbidden: []
    },
    outputContract: {
      format: 'markdown',
      requiredSections: [],
      rules: [
        '遵循原始 SKILL.md 的写作流程、风格边界和自检体系。',
        '如果素材不足，应先向用户追问关键素材，不要硬编第一手经历。',
        '不要把外部 Skill 降级成普通提示词；必须尊重包内 references 的写作方法论和风格示例。'
      ]
    }
  }
];

function toAbsoluteProjectPath(projectRelativePath: string) {
  const resolved = path.resolve(projectRoot, projectRelativePath);
  if (!resolved.startsWith(projectRoot)) {
    throw new Error(`Skill package path is outside project root: ${projectRelativePath}`);
  }
  return resolved;
}

function toProjectRelative(absolutePath: string) {
  return path.relative(projectRoot, absolutePath).replace(/\\/g, '/');
}

function readTextFileInside(rootDir: string, filePath: string) {
  const resolvedRoot = path.resolve(rootDir);
  const resolvedFile = path.resolve(filePath);
  if (!resolvedFile.startsWith(resolvedRoot)) {
    throw new Error(`Skill package tried to read outside its directory: ${filePath}`);
  }
  return fs.readFileSync(resolvedFile, 'utf8');
}

function parseFrontMatter(markdown: string) {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) {
    return {};
  }

  const raw = match[1];
  const result: Record<string, string> = {};
  const lines = raw.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fieldMatch = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!fieldMatch) {
      continue;
    }

    const key = fieldMatch[1];
    const value = fieldMatch[2] ?? '';
    if (value === '|') {
      const block: string[] = [];
      index += 1;
      while (index < lines.length && /^\s+/.test(lines[index])) {
        block.push(lines[index].replace(/^\s{2}/, ''));
        index += 1;
      }
      index -= 1;
      result[key] = block.join('\n').trim();
    } else {
      result[key] = value.replace(/^['"]|['"]$/g, '').trim();
    }
  }

  return result;
}

function discoverReferenceResources(packageDir: string) {
  const referencesDir = path.join(packageDir, 'references');
  if (!fs.existsSync(referencesDir)) {
    return [];
  }

  return fs.readdirSync(referencesDir, { withFileTypes: true })
    .filter((item) => item.isFile() && item.name.toLowerCase().endsWith('.md'))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((item): SkillResource => {
      const absolutePath = path.join(referencesDir, item.name);
      const content = readTextFileInside(packageDir, absolutePath);
      const title = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? item.name;
      return {
        id: item.name.replace(/\.md$/i, ''),
        title,
        type: 'reference',
        description: `原始 Skill 包参考文件：references/${item.name}`,
        content,
        path: toProjectRelative(absolutePath)
      };
    });
}

function discoverScriptDeclarations(packageDir: string) {
  const scriptsDir = path.join(packageDir, 'scripts');
  if (!fs.existsSync(scriptsDir)) {
    return [];
  }

  return fs.readdirSync(scriptsDir, { withFileTypes: true })
    .filter((item) => item.isFile())
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((item): SkillScript => {
      const relativePath = `scripts/${item.name}`;
      return {
        id: item.name.replace(/\.[^.]+$/, ''),
        name: item.name,
        description: `原始 Skill 包脚本声明：${relativePath}`,
        command: relativePath,
        enabled: false,
        risk: 'medium',
        path: toProjectRelative(path.join(scriptsDir, item.name))
      };
    });
}

function loadMountedSkill(definition: MountedSkillDefinition): AgentSkill {
  const packageDir = toAbsoluteProjectPath(definition.packageDir);
  const entryFile = toAbsoluteProjectPath(definition.entryFile);
  const instructions = readTextFileInside(packageDir, entryFile);
  const frontMatter = parseFrontMatter(instructions);
  const frontMatterName = frontMatter.name && frontMatter.name !== definition.id.replace(/_/g, '-')
    ? frontMatter.name
    : '';

  return {
    id: definition.id,
    name: frontMatterName || definition.fallbackName,
    description: frontMatter.description || definition.fallbackDescription,
    version: definition.version,
    instructions,
    whenToUse: definition.whenToUse,
    inputPlaceholder: definition.inputPlaceholder,
    toolPolicy: definition.toolPolicy,
    resources: discoverReferenceResources(packageDir),
    outputContract: definition.outputContract,
    scripts: discoverScriptDeclarations(packageDir),
    tags: definition.tags,
    source: definition.source,
    sourceUrl: definition.sourceUrl,
    packageKind: 'filesystem',
    entryFile: toProjectRelative(entryFile),
    packageDir: toProjectRelative(packageDir),
    enabled: true
  };
}

function writeSkillPackage(skill: AgentSkill) {
  const timestamp = now();
  db.prepare(`
    INSERT INTO agent_skills (
      id, name, description, package_version, instructions, when_to_use, input_placeholder,
      tools, tool_policy, resources, output_contract, scripts, package_kind, entry_file, package_dir,
      source_url, tags, source, enabled, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      package_kind = excluded.package_kind,
      entry_file = excluded.entry_file,
      package_dir = excluded.package_dir,
      source_url = excluded.source_url,
      tags = excluded.tags,
      source = excluded.source,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `).run(
    skill.id,
    skill.name,
    skill.description,
    skill.version,
    skill.packageKind === 'filesystem' ? `Mounted Skill Package. Entry: ${skill.entryFile}` : skill.instructions,
    skill.whenToUse,
    skill.inputPlaceholder,
    JSON.stringify(skill.toolPolicy.preferred),
    JSON.stringify(skill.toolPolicy),
    skill.packageKind === 'filesystem' ? JSON.stringify([]) : JSON.stringify(skill.resources),
    JSON.stringify(skill.outputContract),
    skill.packageKind === 'filesystem' ? JSON.stringify([]) : JSON.stringify(skill.scripts),
    skill.packageKind,
    skill.entryFile,
    skill.packageDir,
    skill.sourceUrl,
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

function normalizeSource(value: string): AgentSkillSource {
  if (value === 'github' || value === 'filesystem' || value === 'imported' || value === 'builtin') {
    return value;
  }
  return 'imported';
}

function normalizePackageKind(value: string | null | undefined): AgentSkillPackageKind {
  return value === 'filesystem' ? 'filesystem' : 'database';
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

function hydrateFilesystemSkill(row: AgentSkillRow) {
  const definition = mountedSkillPackages.find((item) => item.id === row.id);
  if (definition) {
    return loadMountedSkill(definition);
  }

  const entryFile = row.entry_file;
  const packageDir = row.package_dir;
  if (!entryFile || !packageDir) {
    return undefined;
  }

  const absolutePackageDir = toAbsoluteProjectPath(packageDir);
  const absoluteEntryFile = toAbsoluteProjectPath(entryFile);
  if (!fs.existsSync(absoluteEntryFile)) {
    return undefined;
  }

  const instructions = readTextFileInside(absolutePackageDir, absoluteEntryFile);
  const frontMatter = parseFrontMatter(instructions);
  return {
    id: row.id,
    name: frontMatter.name || row.name,
    description: frontMatter.description || row.description,
    version: row.package_version ?? '1.0.0',
    instructions,
    whenToUse: row.when_to_use ?? '',
    inputPlaceholder: row.input_placeholder ?? '',
    toolPolicy: normalizeToolPolicy(row),
    resources: discoverReferenceResources(absolutePackageDir),
    outputContract: parseJsonObject(row.output_contract, defaultOutputContract, isSkillOutputContract),
    scripts: discoverScriptDeclarations(absolutePackageDir),
    tags: parseJsonList(row.tags),
    source: normalizeSource(row.source),
    sourceUrl: row.source_url ?? '',
    packageKind: 'filesystem',
    entryFile,
    packageDir,
    enabled: Boolean(row.enabled)
  } satisfies AgentSkill;
}

function mapRow(row: AgentSkillRow): AgentSkill {
  const packageKind = normalizePackageKind(row.package_kind);
  if (packageKind === 'filesystem') {
    const mounted = hydrateFilesystemSkill(row);
    if (mounted) {
      return mounted;
    }
  }

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
    source: normalizeSource(row.source),
    sourceUrl: row.source_url ?? '',
    packageKind,
    entryFile: row.entry_file ?? '',
    packageDir: row.package_dir ?? '',
    enabled: Boolean(row.enabled)
  };
}

export function ensureRegisteredAgentSkills() {
  const transaction = db.transaction(() => {
    const placeholders = legacyBuiltinSkillIds.map(() => '?').join(', ');
    db.prepare(`DELETE FROM agent_skills WHERE id IN (${placeholders})`).run(...legacyBuiltinSkillIds);

    for (const definition of mountedSkillPackages) {
      writeSkillPackage(loadMountedSkill(definition));
    }
  });
  transaction();
}

export function saveImportedAgentSkill(input: AgentSkillPackageInput) {
  ensureRegisteredAgentSkills();
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
    sourceUrl: '',
    packageKind: 'database',
    entryFile: '',
    packageDir: '',
    enabled: input.enabled ?? true
  };

  writeSkillPackage(skill);
  return skill;
}

export function listAgentSkills() {
  ensureRegisteredAgentSkills();
  const rows = db.prepare(`
    SELECT
      id, name, description, package_version, instructions, when_to_use, input_placeholder,
      tools, tool_policy, resources, output_contract, scripts, package_kind, entry_file,
      package_dir, source_url, tags, source, enabled
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

  ensureRegisteredAgentSkills();
  const row = db.prepare(`
    SELECT
      id, name, description, package_version, instructions, when_to_use, input_placeholder,
      tools, tool_policy, resources, output_contract, scripts, package_kind, entry_file,
      package_dir, source_url, tags, source, enabled
    FROM agent_skills
    WHERE id = ? AND enabled = 1
  `).get(id) as AgentSkillRow | undefined;

  return row ? mapRow(row) : undefined;
}
