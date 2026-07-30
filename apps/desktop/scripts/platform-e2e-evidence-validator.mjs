#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  lstat,
  readFile,
  realpath,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const COMMIT = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const WINDOWS_SIGNER_ID = /^[A-F0-9]{40}$/;
const MACOS_TEAM_ID = /^[A-Z0-9]{10}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const LOCALE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const SAFE_TEXT = /^[A-Za-z0-9 ._()+:/-]{1,80}$/;
const PLATFORMS = new Set(['windows', 'macos']);
const ARCHES = new Set(['x64', 'arm64']);
const METHODS = new Set(['manual', 'automation']);
const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_RUN_DURATION_MS = 24 * 60 * 60 * 1000;

const SHARED_CHECKS = Object.freeze([
  'extensions_render',
  'login_boundary',
  'marketplace_render',
  'memory_render',
  'overview_render',
  'settings_render',
  'status_render',
  'tasks_render',
]);

const PLATFORM_CHECKS = Object.freeze({
  windows: Object.freeze([
    'app_data_retention',
    'first_launch',
    'fresh_install',
    'post_upgrade_launch',
    'uninstall',
    'upgrade_from_supported',
  ]),
  macos: Object.freeze([
    'copy_to_applications',
    'dmg_open',
    'first_launch',
    'gatekeeper_acceptance',
    'remove_application',
  ]),
});

export function parseArguments(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const token = argv[index];
    const value = argv[index + 1];
    if (!token?.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token ?? '<missing>'}`);
    }
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${token}`);
    }
    if (values.has(token)) throw new Error(`Duplicate argument: ${token}`);
    values.set(token, value);
  }
  const required = [
    '--input-root',
    '--platform-evidence',
    '--e2e-evidence',
    '--output-root',
    '--output',
  ];
  for (const key of required) {
    if (!values.has(key)) throw new Error(`Missing required argument: ${key}`);
  }
  return {
    inputRoot: values.get('--input-root'),
    platformEvidence: values.get('--platform-evidence'),
    e2eEvidence: values.get('--e2e-evidence'),
    outputRoot: values.get('--output-root'),
    output: values.get('--output'),
  };
}

export async function readJsonEvidence(rootInput, relativeInput) {
  const root = await trustedRoot(rootInput);
  const target = await trustedFile(root, relativeInput, 'Evidence input');
  const stat = await lstat(target.absolutePath);
  if (stat.size > MAX_INPUT_BYTES) {
    throw new Error('Evidence input exceeds the size budget');
  }
  const body = await readFile(target.absolutePath, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error('Evidence input is not valid JSON');
  }
  rejectSensitiveContent(parsed);
  return parsed;
}

export function validatePlatformE2EEvidence(
  rawPlatformEvidence,
  rawE2EEvidence,
) {
  rejectSensitiveContent(rawPlatformEvidence);
  rejectSensitiveContent(rawE2EEvidence);
  const platformEvidence = validatePlatformEvidence(rawPlatformEvidence);
  const e2eEvidence = validateE2EEvidence(rawE2EEvidence);

  for (const key of ['platform', 'arch', 'version', 'sourceCommit']) {
    if (platformEvidence[key] !== e2eEvidence[key]) {
      throw new Error(`Evidence ${key} mismatch`);
    }
  }

  if (platformEvidence.verificationTarget !== e2eEvidence.artifact.relativePath) {
    throw new Error('E2E artifact is not the signed verification target');
  }
  const platformArtifact = platformEvidence.artifacts.find(
    (entry) => entry.relativePath === e2eEvidence.artifact.relativePath,
  );
  if (!platformArtifact) {
    throw new Error('E2E artifact is absent from platform evidence');
  }
  for (const key of ['bytes', 'sha256']) {
    if (platformArtifact[key] !== e2eEvidence.artifact[key]) {
      throw new Error(`E2E artifact ${key} mismatch`);
    }
  }

  const requiredChecks = requiredChecksFor(e2eEvidence.platform);
  validateChecks(e2eEvidence.run, requiredChecks, e2eEvidence.platform);

  return Object.freeze({
    schemaVersion: 1,
    artifactKind: 'desktop-platform-e2e-validation',
    decision: 'PLATFORM_E2E_EVIDENCE_VALIDATED',
    stableReleaseAccepted: false,
    platform: e2eEvidence.platform,
    arch: e2eEvidence.arch,
    version: e2eEvidence.version,
    sourceCommit: e2eEvidence.sourceCommit,
    artifact: Object.freeze({ ...e2eEvidence.artifact }),
    signerIdentity: Object.freeze({ ...platformEvidence.signerIdentity }),
    inputDigests: Object.freeze({
      platformEvidenceSha256: digestCanonical(rawPlatformEvidence),
      e2eEvidenceSha256: digestCanonical(rawE2EEvidence),
    }),
    run: Object.freeze({
      startedAt: e2eEvidence.run.startedAt,
      completedAt: e2eEvidence.run.completedAt,
      method: e2eEvidence.run.operator.method,
      checkCount: e2eEvidence.run.checks.length,
      cleanProfile: true,
    }),
    requiredChecks: Object.freeze(requiredChecks),
    prohibitions: Object.freeze([
      'stable_promotion',
      'publish',
      'deployment',
    ]),
  });
}

export async function writeValidationEvidence(
  rootInput,
  relativeInput,
  evidence,
) {
  const root = await trustedRoot(rootInput);
  const relativePath = exactRelativePath(relativeInput);
  const absolutePath = path.resolve(root, relativePath);
  if (!isContained(root, absolutePath)) {
    throw new Error('Validation output escapes the allowed root');
  }
  const parent = path.dirname(absolutePath);
  await assertNoSymlinkSegments(root, parent);
  const parentStat = await lstat(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new Error('Validation output parent must be a real directory');
  }
  const canonicalParent = await realpath(parent);
  if (!samePath(canonicalParent, parent)) {
    throw new Error('Validation output parent must already be canonical');
  }
  const body = `${JSON.stringify(evidence, null, 2)}\n`;
  await writeFile(absolutePath, body, { encoding: 'utf8', flag: 'wx' });
  return absolutePath;
}

function validatePlatformEvidence(raw) {
  assertRecord(raw, 'Platform evidence');
  assertExactKeys(raw, [
    'arch',
    'artifactKind',
    'artifacts',
    'decision',
    'platform',
    'probes',
    'prohibitions',
    'schemaVersion',
    'signerIdentity',
    'sourceCommit',
    'stableReleaseAccepted',
    'verificationTarget',
    'version',
  ], 'Platform evidence');
  if (raw.schemaVersion !== 1) throw new Error('Unsupported platform schema');
  if (raw.artifactKind !== 'desktop-platform-validation-evidence') {
    throw new Error('Unexpected platform evidence kind');
  }
  if (raw.decision !== 'SIGNED_PLATFORM_EVIDENCE_PASS') {
    throw new Error('Signed platform evidence is required');
  }
  if (raw.stableReleaseAccepted !== false) {
    throw new Error('Platform evidence must not grant stable acceptance');
  }
  validateIdentity(raw);
  if (!Array.isArray(raw.artifacts) || raw.artifacts.length === 0) {
    throw new Error('Platform artifacts are required');
  }
  const artifacts = raw.artifacts.map((entry) => validateArtifact(entry));
  if (new Set(artifacts.map((entry) => entry.relativePath)).size !== artifacts.length) {
    throw new Error('Duplicate platform artifact');
  }
  if (typeof raw.verificationTarget !== 'string') {
    throw new Error('Platform verification target is required');
  }
  const verificationTarget = exactRelativePath(raw.verificationTarget)
    .replaceAll('\\', '/');
  for (const artifact of artifacts) {
    validateArtifactIdentity(artifact.relativePath, raw);
  }
  assertRecord(raw.signerIdentity, 'Signer identity');
  assertExactKeys(
    raw.signerIdentity,
    ['expected', 'kind', 'observed'],
    'Signer identity',
  );
  const expectedSignerKind = raw.platform === 'windows'
    ? 'windows-certificate-thumbprint-sha1'
    : 'apple-developer-team-id';
  const signerPattern = raw.platform === 'windows'
    ? WINDOWS_SIGNER_ID
    : MACOS_TEAM_ID;
  if (
    raw.signerIdentity.kind !== expectedSignerKind
    || typeof raw.signerIdentity.expected !== 'string'
    || !signerPattern.test(raw.signerIdentity.expected)
    || raw.signerIdentity.expected !== raw.signerIdentity.observed
  ) {
    throw new Error('Signer identity is not bound');
  }
  if (!Array.isArray(raw.probes) || raw.probes.length === 0) {
    throw new Error('Platform probes are required');
  }
  validateProbeCatalog(raw.probes, raw.platform);
  if (!Array.isArray(raw.prohibitions)) {
    throw new Error('Platform prohibitions are required');
  }
  for (const prohibition of [
    'installer_or_application_execution',
    'release_publish',
    'stable_promotion',
  ]) {
    if (!raw.prohibitions.includes(prohibition)) {
      throw new Error('Platform prohibitions are incomplete');
    }
  }
  return Object.freeze({
    platform: raw.platform,
    arch: raw.arch,
    version: raw.version,
    sourceCommit: raw.sourceCommit,
    artifacts: Object.freeze(artifacts),
    verificationTarget,
    signerIdentity: Object.freeze({ ...raw.signerIdentity }),
  });
}

function validateE2EEvidence(raw) {
  assertRecord(raw, 'E2E evidence');
  assertExactKeys(raw, [
    'arch',
    'artifact',
    'artifactKind',
    'platform',
    'run',
    'schemaVersion',
    'sourceCommit',
    'version',
  ], 'E2E evidence');
  if (raw.schemaVersion !== 1) throw new Error('Unsupported E2E schema');
  if (raw.artifactKind !== 'desktop-platform-e2e-evidence') {
    throw new Error('Unexpected E2E evidence kind');
  }
  validateIdentity(raw);
  const artifact = validateArtifact(raw.artifact);
  assertRecord(raw.run, 'E2E run');
  assertExactKeys(raw.run, [
    'checks',
    'cleanProfile',
    'completedAt',
    'host',
    'operator',
    'startedAt',
    'upgradeFromVersion',
  ], 'E2E run');
  const started = parseTimestamp(raw.run.startedAt, 'Run start');
  const completed = parseTimestamp(raw.run.completedAt, 'Run completion');
  if (completed <= started || completed - started > MAX_RUN_DURATION_MS) {
    throw new Error('E2E run duration is invalid');
  }
  if (raw.run.cleanProfile !== true) {
    throw new Error('E2E run must use a clean profile');
  }
  validateHost(raw.run.host);
  validateOperator(raw.run.operator);
  if (!Array.isArray(raw.run.checks)) throw new Error('E2E checks are required');
  const requiredChecks = requiredChecksFor(raw.platform);
  validateCheckCatalog(raw.run.checks, requiredChecks);
  const checks = raw.run.checks.map((check) => validateCheck(
    check,
    started,
    completed,
  ));
  if (raw.platform === 'windows') {
    if (
      typeof raw.run.upgradeFromVersion !== 'string'
      || !VERSION.test(raw.run.upgradeFromVersion)
      || raw.run.upgradeFromVersion === raw.version
    ) {
      throw new Error('Windows upgrade source version is invalid');
    }
  } else if (raw.run.upgradeFromVersion !== null) {
    throw new Error('macOS upgrade source must be null');
  }
  return Object.freeze({
    platform: raw.platform,
    arch: raw.arch,
    version: raw.version,
    sourceCommit: raw.sourceCommit,
    artifact,
    run: Object.freeze({
      ...raw.run,
      host: Object.freeze({ ...raw.run.host }),
      operator: Object.freeze({ ...raw.run.operator }),
      checks: Object.freeze(checks),
    }),
  });
}

function validateIdentity(raw) {
  if (!PLATFORMS.has(raw.platform)) throw new Error('Unsupported platform');
  if (!ARCHES.has(raw.arch)) throw new Error('Unsupported architecture');
  if (typeof raw.version !== 'string' || !VERSION.test(raw.version)) {
    throw new Error('Invalid version');
  }
  if (
    typeof raw.sourceCommit !== 'string'
    || !COMMIT.test(raw.sourceCommit)
  ) {
    throw new Error('Invalid source commit');
  }
}

function validateArtifact(raw) {
  assertRecord(raw, 'Artifact');
  assertExactKeys(raw, ['bytes', 'relativePath', 'sha256'], 'Artifact');
  const relativePath = exactRelativePath(raw.relativePath).replaceAll('\\', '/');
  if (!Number.isSafeInteger(raw.bytes) || raw.bytes <= 0) {
    throw new Error('Artifact byte size is invalid');
  }
  if (typeof raw.sha256 !== 'string' || !SHA256.test(raw.sha256)) {
    throw new Error('Artifact SHA-256 is invalid');
  }
  return Object.freeze({
    relativePath,
    bytes: raw.bytes,
    sha256: raw.sha256,
  });
}

function validateArtifactIdentity(relativePath, identity) {
  const name = path.basename(relativePath).toLowerCase();
  const platformToken = identity.platform === 'windows' ? 'win' : 'mac';
  if (
    !name.includes(identity.version.toLowerCase())
    || !name.includes(`-${platformToken}-`)
    || !name.includes(`-${identity.arch}.`)
  ) {
    throw new Error('Artifact identity does not match platform metadata');
  }
}

function validateProbeCatalog(probes, platform) {
  const expected = platform === 'windows'
    ? new Map([['authenticode', 'powershell.exe']])
    : new Map([
      ['codesign-identity', 'codesign'],
      ['codesign', 'codesign'],
      ['stapler', 'xcrun'],
      ['gatekeeper', 'spctl'],
    ]);
  const names = probes.map((probe) => {
    assertRecord(probe, 'Platform probe');
    assertExactKeys(probe, [
      'args',
      'command',
      'name',
      'status',
      'stderrSha256',
      'stdoutSha256',
    ], 'Platform probe');
    const argsAreArray = Array.isArray(probe.args);
    const targetBindingValid = argsAreArray && (
      platform === 'windows'
        ? (
        probe.name === 'authenticode'
        && probe.args[0] === '-NoProfile'
        && probe.args[1] === '-NonInteractive'
        && probe.args[2] === '-Command'
        && typeof probe.args[3] === 'string'
        && probe.args[3].includes('Get-AuthenticodeSignature')
        && probe.args[3].includes('IZZI_EXPECTED_SIGNER_ID')
        )
        : probe.args.includes('<application>')
    );
    if (
      typeof probe.name !== 'string'
      || probe.status !== 'PASS'
      || probe.command !== expected.get(probe.name)
      || !argsAreArray
      || !targetBindingValid
      || typeof probe.stdoutSha256 !== 'string'
      || !SHA256.test(probe.stdoutSha256)
      || typeof probe.stderrSha256 !== 'string'
      || !SHA256.test(probe.stderrSha256)
    ) {
      throw new Error('Platform probe is invalid');
    }
    return probe.name;
  });
  if (
    names.length !== expected.size
    || new Set(names).size !== names.length
    || [...expected.keys()].some((name) => !names.includes(name))
  ) {
    throw new Error('Platform probe catalog is incomplete');
  }
}

function validateHost(raw) {
  assertRecord(raw, 'E2E host');
  assertExactKeys(raw, ['locale', 'osVersion'], 'E2E host');
  if (typeof raw.osVersion !== 'string' || !SAFE_TEXT.test(raw.osVersion)) {
    throw new Error('Host OS version is invalid');
  }
  if (typeof raw.locale !== 'string' || !LOCALE.test(raw.locale)) {
    throw new Error('Host locale is invalid');
  }
}

function validateOperator(raw) {
  assertRecord(raw, 'Operator attestation');
  assertExactKeys(
    raw,
    ['attestationSha256', 'method', 'role'],
    'Operator attestation',
  );
  if (raw.role !== 'release-validator') {
    throw new Error('Operator role is invalid');
  }
  if (!METHODS.has(raw.method)) throw new Error('Operator method is invalid');
  if (
    typeof raw.attestationSha256 !== 'string'
    || !SHA256.test(raw.attestationSha256)
  ) {
    throw new Error('Operator attestation digest is invalid');
  }
}

function validateCheck(raw, started, completed) {
  assertRecord(raw, 'E2E check');
  assertExactKeys(
    raw,
    ['evidenceSha256', 'id', 'observedAt', 'result', 'status'],
    'E2E check',
  );
  if (typeof raw.id !== 'string' || !/^[a-z][a-z0-9_]{2,48}$/.test(raw.id)) {
    throw new Error('E2E check id is invalid');
  }
  if (raw.status !== 'PASS') throw new Error(`E2E check failed: ${raw.id}`);
  if (
    raw.result !== 'passed'
    && !(raw.id === 'app_data_retention' && raw.result === 'retained')
  ) {
    throw new Error(`E2E check result is invalid: ${raw.id}`);
  }
  if (
    typeof raw.evidenceSha256 !== 'string'
    || !SHA256.test(raw.evidenceSha256)
  ) {
    throw new Error(`E2E check digest is invalid: ${raw.id}`);
  }
  const observed = parseTimestamp(raw.observedAt, 'Check observation');
  if (observed < started || observed > completed) {
    throw new Error(`E2E check timestamp is outside the run: ${raw.id}`);
  }
  return Object.freeze({ ...raw });
}

function validateCheckCatalog(checks, requiredChecks) {
  const ids = checks.map((check) => {
    assertRecord(check, 'E2E check');
    return check.id;
  });
  if (new Set(ids).size !== ids.length) throw new Error('Duplicate E2E check');
  const required = new Set(requiredChecks);
  for (const id of ids) {
    if (!required.has(id)) throw new Error(`Unknown E2E check: ${id}`);
  }
  for (const id of requiredChecks) {
    if (!ids.includes(id)) throw new Error(`Missing E2E check: ${id}`);
  }
}

function validateChecks(run, requiredChecks, platform) {
  validateCheckCatalog(run.checks, requiredChecks);
  if (platform === 'windows') {
    const retention = run.checks.find(
      (check) => check.id === 'app_data_retention',
    );
    if (retention?.result !== 'retained') {
      throw new Error('Windows app-data retention evidence is invalid');
    }
  }
}

function requiredChecksFor(platform) {
  return Object.freeze(
    [...SHARED_CHECKS, ...PLATFORM_CHECKS[platform]].sort(),
  );
}

function parseTimestamp(value, label) {
  if (typeof value !== 'string' || !ISO_UTC.test(value)) {
    throw new Error(`${label} timestamp is invalid`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} timestamp is invalid`);
  return parsed;
}

function rejectSensitiveContent(value, trail = 'evidence') {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => rejectSensitiveContent(
      entry,
      `${trail}[${index}]`,
    ));
    return;
  }
  if (!value || typeof value !== 'object') {
    if (
      typeof value === 'string'
      && (
        /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value)
        || /(?:^|\W)sk-[A-Za-z0-9_-]{20,}/.test(value)
        || /(?:^|\W)gh[pousr]_[A-Za-z0-9]{20,}/.test(value)
        || /(?:^|\W)AKIA[0-9A-Z]{16}/.test(value)
      )
    ) {
      throw new Error(`Sensitive value is not allowed at ${trail}`);
    }
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (/(?:secret|token|password|privatekey|credential)/i.test(key)) {
      throw new Error(`Sensitive field is not allowed: ${trail}.${key}`);
    }
    rejectSensitiveContent(entry, `${trail}.${key}`);
  }
}

function assertRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertExactKeys(value, allowed, label) {
  const expected = [...allowed].sort();
  const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} fields are invalid`);
  }
}

async function trustedRoot(rootInput) {
  const exact = exactPathInput(rootInput, 'Evidence root');
  if (!path.isAbsolute(exact)) throw new Error('Evidence root must be absolute');
  const resolved = path.resolve(exact);
  const stat = await lstat(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Evidence root must be a real directory');
  }
  const canonical = await realpath(resolved);
  if (!samePath(canonical, resolved)) {
    throw new Error('Evidence root must already be canonical');
  }
  return canonical;
}

async function trustedFile(root, relativeInput, label) {
  const relativePath = exactRelativePath(relativeInput);
  const absolutePath = path.resolve(root, relativePath);
  if (!isContained(root, absolutePath)) {
    throw new Error(`${label} escapes the evidence root`);
  }
  await assertNoSymlinkSegments(root, absolutePath);
  const stat = await lstat(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file`);
  }
  const canonical = await realpath(absolutePath);
  if (!isContained(root, canonical) || !samePath(canonical, absolutePath)) {
    throw new Error(`${label} path is not canonical`);
  }
  return { absolutePath, relativePath };
}

async function assertNoSymlinkSegments(root, target) {
  const relative = path.relative(root, target);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) {
      throw new Error('Symlinked evidence paths are not allowed');
    }
  }
}

function exactPathInput(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} is required`);
  }
  if (value !== value.trim() || /[\0\r\n]/.test(value)) {
    throw new Error(`${label} must be exact`);
  }
  return value;
}

function exactRelativePath(value) {
  const exact = exactPathInput(value, 'Evidence path');
  if (path.isAbsolute(exact)) throw new Error('Evidence paths must be relative');
  const normalized = path.normalize(exact);
  if (
    normalized === '..'
    || normalized.startsWith(`..${path.sep}`)
    || normalized === '.'
  ) {
    throw new Error('Evidence path traversal is not allowed');
  }
  return normalized;
}

function isContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative !== ''
    && relative !== '..'
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function samePath(left, right) {
  return comparablePath(left) === comparablePath(right);
}

function comparablePath(value) {
  let normalized = path.resolve(value);
  if (process.platform === 'win32') {
    if (normalized.startsWith('\\\\?\\UNC\\')) {
      normalized = `\\\\${normalized.slice('\\\\?\\UNC\\'.length)}`;
    } else if (normalized.startsWith('\\\\?\\')) {
      normalized = normalized.slice('\\\\?\\'.length);
    }
    normalized = normalized.toLowerCase();
  }
  return normalized.replace(/[\\/]+$/, '');
}

function digestCanonical(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const entries = Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    );
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const platformEvidence = await readJsonEvidence(
    options.inputRoot,
    options.platformEvidence,
  );
  const e2eEvidence = await readJsonEvidence(
    options.inputRoot,
    options.e2eEvidence,
  );
  const validation = validatePlatformE2EEvidence(
    platformEvidence,
    e2eEvidence,
  );
  await writeValidationEvidence(
    options.outputRoot,
    options.output,
    validation,
  );
  process.stdout.write(`${JSON.stringify(validation)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`platform E2E evidence validation failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
