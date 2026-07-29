import * as path from 'path';
import { isSecretRef, looksLikeRawSecret } from '../personal-office';
import {
  RUNTIME_CONTRACT_VERSION,
  type RuntimeAuthority,
  type RuntimeBudget,
  type RuntimeNetworkPolicy,
  type RuntimePaths,
  type RuntimeSpec,
} from './types';

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const ENV_NAME = /^[A-Z][A-Z0-9_]{0,127}$/;
const RUNTIME_ID = /^[a-z0-9][a-z0-9._-]{2,127}$/;
const SERVICE_PROJECT = /^izzi-svc-[a-z0-9][a-z0-9-]*$/;
const CREDENTIAL_FIELD =
  /(?:pass(?:word|code)?|mfa|otp|totp|recovery|secret|api[_-]?key|private[_-]?key)/i;

export class RuntimeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeValidationError';
  }
}

function requireNonEmpty(label: string, value: string): void {
  if (!value.trim()) throw new RuntimeValidationError(`${label} is required`);
}

function validateAuthority(authority: RuntimeAuthority): void {
  requireNonEmpty('tenantId', authority.tenantId);
  requireNonEmpty('userId', authority.userId);
  requireNonEmpty('workspaceId', authority.workspaceId);
  requireNonEmpty('packageId', authority.packageId);
  requireNonEmpty('integrationId', authority.integrationId);
  requireNonEmpty('grantId', authority.grantId);
}

export function requiredRuntimeScope(spec: RuntimeSpec): string {
  if (spec.kind === 'docker-compose') return 'runtime.local_service';
  if (spec.kind === 'node' || spec.kind === 'binary') return 'runtime.native_process';
  if (spec.kind === 'browser') return 'runtime.browser_test';
  return 'runtime.remote';
}

function validateBudget(budget: RuntimeBudget): void {
  if (!Number.isFinite(budget.cpuPercent) || budget.cpuPercent <= 0 || budget.cpuPercent > 100) {
    throw new RuntimeValidationError('cpuPercent must be between 0 and 100');
  }
  for (const [name, value] of Object.entries({
    memoryMb: budget.memoryMb,
    diskMb: budget.diskMb,
    timeoutMs: budget.timeoutMs,
  })) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new RuntimeValidationError(`${name} must be a positive integer`);
    }
  }
}

export function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[(.*)]$/, '$1');
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1';
}

export function normalizeAllowedOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RuntimeValidationError(`Invalid allowed origin: ${raw}`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new RuntimeValidationError(`Unsafe allowed origin: ${raw}`);
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new RuntimeValidationError(`Allowed origin must not contain path/query/hash: ${raw}`);
  }
  return url.origin;
}

export function assertAllowedUrl(raw: string, policy: RuntimeNetworkPolicy): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RuntimeValidationError(`Invalid URL: ${raw}`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new RuntimeValidationError(`Unsafe URL: ${raw}`);
  }
  if (policy.mode !== 'allowlist') {
    throw new RuntimeValidationError('Network egress is denied');
  }
  const origins = new Set(policy.allowedOrigins.map(normalizeAllowedOrigin));
  if (!origins.has(url.origin)) {
    throw new RuntimeValidationError(`Origin is not allowlisted: ${url.origin}`);
  }
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  if (!policy.allowedPorts.includes(port)) {
    throw new RuntimeValidationError(`Port is not allowlisted: ${port}`);
  }
  return url;
}

export function assertNoCredentialFields(value: unknown, trail = 'input'): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoCredentialFields(item, `${trail}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (CREDENTIAL_FIELD.test(key)) {
      throw new RuntimeValidationError(`Credential field is forbidden: ${trail}.${key}`);
    }
    assertNoCredentialFields(child, `${trail}.${key}`);
  }
}

function assertAbsoluteOwnedPath(label: string, candidate: string, roots: readonly string[]): void {
  if (!path.isAbsolute(candidate)) {
    throw new RuntimeValidationError(`${label} must be absolute`);
  }
  const resolved = path.resolve(candidate);
  const owned = roots.some((root) => {
    const resolvedRoot = path.resolve(root);
    return resolved === resolvedRoot || resolved.startsWith(resolvedRoot + path.sep);
  });
  if (!owned) throw new RuntimeValidationError(`${label} escapes allowed roots`);
}

function validatePaths(paths: RuntimePaths): void {
  if (!paths.allowedRoots.length) throw new RuntimeValidationError('allowedRoots is empty');
  for (const root of paths.allowedRoots) {
    if (!path.isAbsolute(root)) throw new RuntimeValidationError('allowedRoots must be absolute');
  }
  assertAbsoluteOwnedPath('workDir', paths.workDir, paths.allowedRoots);
  assertAbsoluteOwnedPath('tempDir', paths.tempDir, paths.allowedRoots);
  assertAbsoluteOwnedPath('uploadDir', paths.uploadDir, paths.allowedRoots);
  assertAbsoluteOwnedPath('downloadDir', paths.downloadDir, paths.allowedRoots);
}

export function validateRuntimeSpec(spec: RuntimeSpec): RuntimeSpec {
  if (spec.schemaVersion !== RUNTIME_CONTRACT_VERSION) {
    throw new RuntimeValidationError('Unsupported runtime contract version');
  }
  if (!RUNTIME_ID.test(spec.id)) throw new RuntimeValidationError('Invalid runtime id');
  validateAuthority(spec.authority);
  validateBudget(spec.budget);
  validatePaths(spec.paths);
  for (const binding of spec.env) {
    if (!ENV_NAME.test(binding.name)) throw new RuntimeValidationError('Invalid env binding name');
    if (!isSecretRef(binding.secret)) throw new RuntimeValidationError('Raw env value is forbidden');
    if (looksLikeRawSecret(binding.secret.ref)) {
      throw new RuntimeValidationError('SecretRef locator resembles raw secret material');
    }
  }
  for (const origin of spec.network.allowedOrigins) normalizeAllowedOrigin(origin);
  if (!isLoopbackHost(spec.network.bindHost)) {
    throw new RuntimeValidationError('Runtime ports must bind to loopback');
  }
  for (const port of spec.network.allowedPorts) {
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new RuntimeValidationError(`Invalid network port: ${port}`);
    }
  }

  if (spec.kind === 'node' || spec.kind === 'binary') {
    if (!path.isAbsolute(spec.executable)) {
      throw new RuntimeValidationError('Native executable must be absolute');
    }
    if (!SHA256.test(spec.executableSha256)) {
      throw new RuntimeValidationError('Native executable digest is required');
    }
    if (spec.args.some((arg) => arg.includes('\0') || /[\r\n]/.test(arg))) {
      throw new RuntimeValidationError('Native argument contains control characters');
    }
  } else if (spec.kind === 'docker-compose') {
    if (!SERVICE_PROJECT.test(spec.serviceProject)) {
      throw new RuntimeValidationError('Invalid docker compose project');
    }
    if (!Object.values(spec.attestation).every(Boolean)) {
      throw new RuntimeValidationError('Docker isolation attestation is incomplete');
    }
  } else if (spec.kind === 'browser') {
    if (!spec.authority.runId?.trim()) {
      throw new RuntimeValidationError('Browser runtime requires an exact runId');
    }
    if (!isSecretRef(spec.storageStateRef)) {
      throw new RuntimeValidationError('Browser storageState must be a SecretRef');
    }
    if (spec.network.mode !== 'allowlist' || !spec.network.allowedOrigins.length) {
      throw new RuntimeValidationError('Browser requires an explicit origin allowlist');
    }
  } else if (spec.kind === 'remote' && !spec.adapterId.trim()) {
    throw new RuntimeValidationError('Remote adapter id is required');
  }
  return spec;
}
