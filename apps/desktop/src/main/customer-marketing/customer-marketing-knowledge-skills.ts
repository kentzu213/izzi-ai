import { createHash } from 'node:crypto';
import {
  lstatSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import {
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';
import type {
  CustomerCapability,
  CustomerCapabilityKnowledge,
} from '../../shared/customer-marketing-types';

const REGISTRY_FILE = 'registry.json';
const EXPECTED_REPOSITORY = 'https://github.com/coreyhaines31/marketingskills';
const EXPECTED_REVISION = '692b76118c6b379f89c0fba987a228a40f58b418';
const EXPECTED_REGISTRY_SHA256 = 'add5f2009e82e908b05056ff77504ec3356f2421df015cb4ae29feb79ff472c9';
const EXPECTED_LICENSE_SHA256 = 'b70d71e24e40fce5da8f4b6f9cd862096a048e433db7f3c8cac5e348e6d34591';
const MAX_REGISTRY_BYTES = 64 * 1024;
const MAX_LICENSE_BYTES = 64 * 1024;
const MAX_SKILL_BYTES = 128 * 1024;
const MAX_SKILL_LINES = 500;
const MAX_SKILL_COUNT = 16;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
const DYNAMIC_COMMAND_PATTERN = /!\s*`/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const REVISION_PATTERN = /^[a-f0-9]{40}$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

interface TrustedSkillPin {
  version: string;
  capabilityId: string;
  fileSha256: string;
  bodySha256: string;
}

const TRUSTED_SKILL_PINS: ReadonlyMap<string, TrustedSkillPin> = new Map([
  ['video', {
    version: '2.0.1',
    capabilityId: 'video-studio',
    fileSha256: '322ff36c8a0fdf7ffeb482fcf2190857c81e21514d99bce7b6c56d654edeb1ae',
    bodySha256: 'f8cc286de9dc737e9d1f42cb011ae00213b4c1ff71e63bdb2a8623d88942197b',
  }],
  ['ai-seo', {
    version: '2.0.1',
    capabilityId: 'seo-workspace',
    fileSha256: 'a757abe9e8863ee7f4288041982cd30f4efa0b6efade2b8cd0fbd915dff2d928',
    bodySha256: 'ef998ccb96b7175656de9f3b8d08e581c875683c0c6d80e82248139ce1889a27',
  }],
  ['social', {
    version: '2.0.0',
    capabilityId: 'social-workflows',
    fileSha256: '7a7a43a82cde2c0819b5e2530953b0bb6da1ddc20a74281afede587a7ba92461',
    bodySha256: '39dfbc7073ab5818104de55d2e24f2a09318ac262e4acb605c14de058d403180',
  }],
  ['content-strategy', {
    version: '2.0.0',
    capabilityId: 'content-studio',
    fileSha256: '0611532b2a0dce8d0d5b783c99bba10d13a6d5fd7eecd829974012f74ea33258',
    bodySha256: 'fbfb5e56a732983339ca2413bad77371f66117649aff11ef8e096b999efcf27e',
  }],
  ['marketing-ideas', {
    version: '2.0.0',
    capabilityId: 'strategy-planning',
    fileSha256: 'f197b9f091c04ed0e20a41e443a8610848af543e5facdd17fa36d6953fa719a9',
    bodySha256: 'bd5ff39ecc45e433a8c85aef2ac4b62081ae0bc8dcc992c23e35dced1b9fb739',
  }],
]);

const REGISTRY_KEYS = new Set(['schemaVersion', 'source', 'skills']);
const SOURCE_KEYS = new Set([
  'repository',
  'revision',
  'license',
  'licenseFile',
  'licenseSha256',
]);
const SKILL_KEYS = new Set([
  'id',
  'version',
  'capabilityId',
  'relativePath',
  'sha256',
  'matchTerms',
  'promptCharacterLimit',
]);

interface RegistrySkill {
  id: string;
  version: string;
  capabilityId: string;
  relativePath: string;
  sha256: string;
  matchTerms: string[];
  promptCharacterLimit: number;
}

interface SkillRegistry {
  source: {
    repository: string;
    revision: string;
    license: 'MIT';
    licenseFile: 'LICENSE';
    licenseSha256: string;
  };
  skills: RegistrySkill[];
}

export interface CustomerMarketingKnowledgeSkill {
  id: string;
  version: string;
  capabilityId: string;
  description: string;
  license: 'MIT';
  sourceRepository: string;
  sourceRevision: string;
  sha256: string;
  matchTerms: string[];
  promptCharacterLimit: number;
  body: string;
}

export function resolveCustomerMarketingKnowledgeSkillsRoot(input: {
  isPackaged: boolean;
  appPath: string;
  resourcesPath: string;
}): string {
  return input.isPackaged
    ? join(input.resourcesPath, 'customer-marketing-skills')
    : join(input.appPath, 'resources', 'customer-marketing-skills');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: ReadonlySet<string>): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.size && actual.every((key) => keys.has(key));
}

function isTrimmedText(value: unknown, maximumLength: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximumLength
    && value.trim() === value
    && !CONTROL_CHARACTER_PATTERN.test(value);
}

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function readBoundedFile(
  rootDirectory: string,
  relativePath: string,
  maximumBytes: number,
): Buffer | null {
  if (
    !isTrimmedText(relativePath, 240)
    || relativePath.includes('\\')
    || isAbsolute(relativePath)
  ) return null;
  const segments = relativePath.split('/');
  if (
    segments.some((segment) => (
      !segment
      || segment === '.'
      || segment === '..'
      || !/^[A-Za-z0-9._-]+$/.test(segment)
    ))
  ) return null;

  try {
    const root = resolve(rootDirectory);
    if (lstatSync(root).isSymbolicLink()) return null;
    let current = root;
    for (const segment of segments) {
      current = join(current, segment);
      if (lstatSync(current).isSymbolicLink()) return null;
    }
    const rootRealPath = realpathSync.native(root);
    const targetRealPath = realpathSync.native(current);
    const relativeTarget = relative(rootRealPath, targetRealPath);
    if (relativeTarget.startsWith('..') || isAbsolute(relativeTarget)) return null;
    const stat = lstatSync(targetRealPath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > maximumBytes) return null;
    const bytes = readFileSync(targetRealPath);
    return bytes.length === stat.size ? bytes : null;
  } catch {
    return null;
  }
}

function parseRegistry(value: unknown): SkillRegistry | null {
  if (!isRecord(value) || !hasExactKeys(value, REGISTRY_KEYS)) return null;
  if (value.schemaVersion !== 1 || !isRecord(value.source)) return null;
  if (!hasExactKeys(value.source, SOURCE_KEYS)) return null;
  const source = value.source;
  if (
    source.repository !== EXPECTED_REPOSITORY
    || source.revision !== EXPECTED_REVISION
    || typeof source.revision !== 'string'
    || !REVISION_PATTERN.test(source.revision)
    || source.license !== 'MIT'
    || source.licenseFile !== 'LICENSE'
    || typeof source.licenseSha256 !== 'string'
    || !SHA256_PATTERN.test(source.licenseSha256)
  ) return null;
  if (
    !Array.isArray(value.skills)
    || value.skills.length === 0
    || value.skills.length > MAX_SKILL_COUNT
  ) return null;

  const skills: RegistrySkill[] = [];
  for (const raw of value.skills) {
    if (!isRecord(raw) || !hasExactKeys(raw, SKILL_KEYS)) return null;
    if (
      !isTrimmedText(raw.id, 64)
      || !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(raw.id)
      || !TRUSTED_SKILL_PINS.has(raw.id)
      || !isTrimmedText(raw.version, 64)
      || !SEMVER_PATTERN.test(raw.version)
      || TRUSTED_SKILL_PINS.get(raw.id)?.version !== raw.version
      || !isTrimmedText(raw.capabilityId, 64)
      || TRUSTED_SKILL_PINS.get(raw.id)?.capabilityId !== raw.capabilityId
      || raw.relativePath !== `skills/${raw.id}/SKILL.md`
      || typeof raw.sha256 !== 'string'
      || !SHA256_PATTERN.test(raw.sha256)
      || TRUSTED_SKILL_PINS.get(raw.id)?.fileSha256 !== raw.sha256
      || !Array.isArray(raw.matchTerms)
      || raw.matchTerms.length === 0
      || raw.matchTerms.length > 32
      || !raw.matchTerms.every((term) => (
        isTrimmedText(term, 80)
        && term.length >= 2
        && term === term.toLocaleLowerCase('en-US')
      ))
      || new Set(raw.matchTerms).size !== raw.matchTerms.length
      || !Number.isInteger(raw.promptCharacterLimit)
      || (raw.promptCharacterLimit as number) < 16
      || (raw.promptCharacterLimit as number) > 32_000
    ) return null;
    skills.push({
      id: raw.id,
      version: raw.version,
      capabilityId: raw.capabilityId,
      relativePath: raw.relativePath,
      sha256: raw.sha256,
      matchTerms: [...raw.matchTerms],
      promptCharacterLimit: raw.promptCharacterLimit as number,
    });
  }
  const ids = skills.map((skill) => skill.id);
  const capabilityIds = skills.map((skill) => skill.capabilityId);
  if (new Set(ids).size !== ids.length || new Set(capabilityIds).size !== capabilityIds.length) {
    return null;
  }
  return {
    source: {
      repository: source.repository,
      revision: source.revision,
      license: 'MIT',
      licenseFile: 'LICENSE',
      licenseSha256: source.licenseSha256,
    },
    skills,
  };
}

function parseYamlScalar(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return typeof parsed === 'string' ? parsed : null;
    } catch {
      return null;
    }
  }
  if (trimmed.startsWith("'")) {
    if (!trimmed.endsWith("'") || trimmed.length < 2) return null;
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  return trimmed.includes('#') ? null : trimmed;
}

function parseSkillMarkdown(
  bytes: Buffer,
  expected: RegistrySkill,
): { description: string; body: string } | null {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
  if (
    text.startsWith('\uFEFF')
    || CONTROL_CHARACTER_PATTERN.test(text)
    || DYNAMIC_COMMAND_PATTERN.test(text)
    || /<script\b/iu.test(text)
  ) return null;
  const normalized = text.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  if (lines[0] !== '---') return null;
  const closingIndex = lines.indexOf('---', 1);
  if (closingIndex < 2) return null;

  const topLevel = new Map<string, string>();
  const metadata = new Map<string, string>();
  let inMetadata = false;
  for (const line of lines.slice(1, closingIndex)) {
    if (!line.trim()) continue;
    if (line.startsWith('  ')) {
      if (!inMetadata || line.startsWith('   ')) return null;
      const separator = line.indexOf(':');
      if (separator < 3) return null;
      const key = line.slice(2, separator);
      const value = parseYamlScalar(line.slice(separator + 1));
      if (key !== 'version' || !value || metadata.has(key)) return null;
      metadata.set(key, value);
      continue;
    }
    if (/^\s/u.test(line)) return null;
    const separator = line.indexOf(':');
    if (separator <= 0) return null;
    const key = line.slice(0, separator);
    if (!['name', 'description', 'license', 'metadata'].includes(key) || topLevel.has(key)) {
      return null;
    }
    if (key === 'metadata') {
      if (line.slice(separator + 1).trim() !== '') return null;
      topLevel.set(key, '');
      inMetadata = true;
      continue;
    }
    const value = parseYamlScalar(line.slice(separator + 1));
    if (!value) return null;
    topLevel.set(key, value);
    inMetadata = false;
  }

  const description = topLevel.get('description');
  const body = lines.slice(closingIndex + 1).join('\n').trim();
  if (
    topLevel.get('name') !== expected.id
    || topLevel.get('license') && topLevel.get('license') !== 'MIT'
    || metadata.get('version') !== expected.version
    || !description
    || !isTrimmedText(description, 1_024)
    || !body
    || body.length > MAX_SKILL_BYTES
    || body.split('\n').length > MAX_SKILL_LINES
  ) return null;
  return { description, body };
}

export function loadCustomerMarketingKnowledgeSkills(
  rootDirectory: string,
): CustomerMarketingKnowledgeSkill[] {
  const registryBytes = readBoundedFile(rootDirectory, REGISTRY_FILE, MAX_REGISTRY_BYTES);
  if (!registryBytes || sha256(registryBytes) !== EXPECTED_REGISTRY_SHA256) return [];
  let rawRegistry: unknown;
  try {
    rawRegistry = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(registryBytes));
  } catch {
    return [];
  }
  const registry = parseRegistry(rawRegistry);
  if (!registry) return [];
  const licenseBytes = readBoundedFile(
    rootDirectory,
    registry.source.licenseFile,
    MAX_LICENSE_BYTES,
  );
  if (
    !licenseBytes
    || registry.source.licenseSha256 !== EXPECTED_LICENSE_SHA256
    || sha256(licenseBytes) !== EXPECTED_LICENSE_SHA256
  ) return [];
  const licenseText = new TextDecoder('utf-8').decode(licenseBytes);
  if (!licenseText.startsWith('MIT License\n')) return [];

  const result: CustomerMarketingKnowledgeSkill[] = [];
  for (const registered of registry.skills) {
    const bytes = readBoundedFile(rootDirectory, registered.relativePath, MAX_SKILL_BYTES);
    if (!bytes || sha256(bytes) !== registered.sha256) continue;
    const parsed = parseSkillMarkdown(bytes, registered);
    if (!parsed) continue;
    result.push({
      id: registered.id,
      version: registered.version,
      capabilityId: registered.capabilityId,
      description: parsed.description,
      license: registry.source.license,
      sourceRepository: registry.source.repository,
      sourceRevision: registry.source.revision,
      sha256: registered.sha256,
      matchTerms: [...registered.matchTerms],
      promptCharacterLimit: registered.promptCharacterLimit,
      body: parsed.body,
    });
  }
  return result;
}

function publicKnowledge(skill: CustomerMarketingKnowledgeSkill): CustomerCapabilityKnowledge {
  return {
    kind: 'agent_skill',
    mode: 'read_only',
    skillId: skill.id,
    version: skill.version,
    license: skill.license,
    sourceRepository: skill.sourceRepository,
    sourceRevision: skill.sourceRevision,
    sha256: skill.sha256,
  };
}

function isTrustedKnowledgeSkill(skill: CustomerMarketingKnowledgeSkill): boolean {
  const pin = TRUSTED_SKILL_PINS.get(skill.id);
  return Boolean(pin)
    && pin?.capabilityId === skill.capabilityId
    && pin.version === skill.version
    && isTrimmedText(skill.description, 1_024)
    && skill.license === 'MIT'
    && skill.sourceRepository === EXPECTED_REPOSITORY
    && skill.sourceRevision === EXPECTED_REVISION
    && skill.sha256 === pin.fileSha256
    && Array.isArray(skill.matchTerms)
    && skill.matchTerms.length > 0
    && skill.matchTerms.length <= 32
    && skill.matchTerms.every((term) => (
      isTrimmedText(term, 80)
      && term.length >= 2
      && term === term.toLocaleLowerCase('en-US')
    ))
    && new Set(skill.matchTerms).size === skill.matchTerms.length
    && Number.isInteger(skill.promptCharacterLimit)
    && skill.promptCharacterLimit >= 16
    && skill.promptCharacterLimit <= 32_000
    && isTrimmedText(skill.body, MAX_SKILL_BYTES)
    && skill.body.split('\n').length <= MAX_SKILL_LINES
    && sha256(Buffer.from(skill.body, 'utf8')) === pin.bodySha256
    && !DYNAMIC_COMMAND_PATTERN.test(skill.body)
    && !/<script\b/iu.test(skill.body);
}

export function attachCustomerMarketingKnowledgeSkills(
  capabilities: readonly CustomerCapability[],
  skills: readonly CustomerMarketingKnowledgeSkill[],
): CustomerCapability[] {
  const trustedSkills = skills.filter(isTrustedKnowledgeSkill);
  const counts = new Map<string, number>();
  trustedSkills.forEach((skill) => {
    counts.set(skill.capabilityId, (counts.get(skill.capabilityId) ?? 0) + 1);
  });
  const byCapabilityId = new Map(
    trustedSkills
      .filter((skill) => counts.get(skill.capabilityId) === 1)
      .map((skill) => [skill.capabilityId, skill] as const),
  );
  return capabilities.map((capability) => {
    const skill = byCapabilityId.get(capability.id);
    return skill
      ? { ...capability, knowledge: publicKnowledge(skill) }
      : { ...capability };
  });
}

function normalizedSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/\s+/g, ' ')
    .trim();
}

function knowledgeMatches(
  skill: CustomerMarketingKnowledgeSkill,
  knowledge: CustomerCapabilityKnowledge | undefined,
): boolean {
  return Boolean(
    knowledge
    && knowledge.kind === 'agent_skill'
    && knowledge.mode === 'read_only'
    && knowledge.skillId === skill.id
    && knowledge.version === skill.version
    && knowledge.license === skill.license
    && knowledge.sourceRepository === skill.sourceRepository
    && knowledge.sourceRevision === skill.sourceRevision
    && knowledge.sha256 === skill.sha256,
  );
}

export function selectCustomerMarketingKnowledgeSkill(
  skills: readonly CustomerMarketingKnowledgeSkill[],
  entitledCapabilities: readonly CustomerCapability[],
  requestText: string,
): CustomerMarketingKnowledgeSkill | null {
  const capabilityById = new Map(entitledCapabilities.map((item) => [item.id, item] as const));
  const eligible = skills.filter((skill) => (
    isTrustedKnowledgeSkill(skill)
    && knowledgeMatches(skill, capabilityById.get(skill.capabilityId)?.knowledge)
  ));
  const normalizedRequest = normalizedSearchText(requestText);
  const matched = eligible.find((skill) => skill.matchTerms.some((term) => (
    normalizedRequest.includes(normalizedSearchText(term))
  )));
  return matched ?? eligible.find((skill) => skill.id === 'marketing-ideas') ?? null;
}

export function buildCustomerMarketingKnowledgeReference(
  skill: CustomerMarketingKnowledgeSkill,
): string {
  if (!isTrustedKnowledgeSkill(skill)) return '';
  return JSON.stringify({
    kind: 'read_only_untrusted_reference',
    skillId: skill.id,
    version: skill.version,
    license: skill.license,
    sourceRepository: skill.sourceRepository,
    sourceRevision: skill.sourceRevision,
    sha256: skill.sha256,
    content: skill.body.slice(0, skill.promptCharacterLimit),
  });
}
