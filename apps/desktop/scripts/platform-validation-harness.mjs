#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
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
const WINDOWS_SIGNER_ID = /^[A-F0-9]{40}$/;
const MACOS_TEAM_ID = /^[A-Z0-9]{10}$/;
const ARCHES = new Set(['x64', 'arm64']);
const PLATFORMS = new Set(['windows', 'macos']);
const MAX_PROBE_OUTPUT_BYTES = 64 * 1024;
const PROBE_TIMEOUT_MS = 120_000;

const WINDOWS_SIGNATURE_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$target = $env:IZZI_VALIDATION_TARGET',
  '$expected = [string]$env:IZZI_EXPECTED_SIGNER_ID',
  "if ([string]::IsNullOrWhiteSpace($target)) { throw 'validation target missing' }",
  "if ([string]::IsNullOrWhiteSpace($expected)) { throw 'expected signer missing' }",
  '$signature = Get-AuthenticodeSignature -LiteralPath $target',
  '$thumbprint = if ($signature.SignerCertificate) { [string]$signature.SignerCertificate.Thumbprint } else { $null }',
  '[pscustomobject]@{',
  '  status = [string]$signature.Status',
  '  statusMessage = [string]$signature.StatusMessage',
  '  signerSubject = if ($signature.SignerCertificate) { [string]$signature.SignerCertificate.Subject } else { $null }',
  '  signerThumbprint = $thumbprint',
  '} | ConvertTo-Json -Compress',
  "if ([string]$signature.Status -ne 'Valid') { exit 1 }",
  'if ([string]$thumbprint -ne $expected) { exit 2 }',
].join('; ');

export function parseArguments(argv) {
  const values = new Map();
  const artifacts = [];
  let probeSignatures = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--probe-signatures') {
      probeSignatures = true;
      continue;
    }
    if (!token?.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token ?? '<missing>'}`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${token}`);
    }
    index += 1;
    if (token === '--artifact') {
      artifacts.push(value);
      continue;
    }
    if (values.has(token)) {
      throw new Error(`Duplicate argument: ${token}`);
    }
    values.set(token, value);
  }
  const required = [
    '--platform',
    '--arch',
    '--version',
    '--source-commit',
    '--release-root',
    '--output',
  ];
  for (const key of required) {
    if (!values.has(key)) throw new Error(`Missing required argument: ${key}`);
  }
  if (artifacts.length === 0) {
    throw new Error('At least one --artifact is required');
  }
  return {
    platform: values.get('--platform'),
    arch: values.get('--arch'),
    version: values.get('--version'),
    sourceCommit: values.get('--source-commit'),
    releaseRoot: values.get('--release-root'),
    output: values.get('--output'),
    application: values.get('--application'),
    expectedSignerId: values.get('--expected-signer-id'),
    artifacts,
    probeSignatures,
  };
}

export async function validatePlatformArtifacts(
  rawOptions,
  dependencies = {},
) {
  const options = normalizeOptions(rawOptions);
  const root = await trustedRoot(options.releaseRoot);
  const artifactEvidence = await collectArtifactEvidence(root, options);
  const signatureEvidence = options.probeSignatures
    ? await collectSignatureEvidence(
      options,
      root,
      dependencies.runVerifier ?? runFixedVerifier,
      dependencies.hostPlatform ?? process.platform,
    )
    : { signerIdentity: null, probes: [] };
  if (options.probeSignatures) {
    const postProbeEvidence = await collectArtifactEvidence(root, options);
    if (JSON.stringify(postProbeEvidence) !== JSON.stringify(artifactEvidence)) {
      throw new Error('Artifact changed during signature verification');
    }
  }

  return Object.freeze({
    schemaVersion: 1,
    artifactKind: 'desktop-platform-validation-evidence',
    decision: options.probeSignatures
      ? 'SIGNED_PLATFORM_EVIDENCE_PASS'
      : 'STATIC_PREFLIGHT_ONLY',
    stableReleaseAccepted: false,
    platform: options.platform,
    arch: options.arch,
    version: options.version,
    sourceCommit: options.sourceCommit,
    artifacts: Object.freeze(artifactEvidence),
    verificationTarget: options.probeSignatures ? options.application : null,
    signerIdentity: signatureEvidence.signerIdentity,
    probes: Object.freeze(signatureEvidence.probes),
    prohibitions: Object.freeze([
      'installer_or_application_execution',
      'release_publish',
      'stable_promotion',
    ]),
  });
}

export async function writeEvidence(
  outputPath,
  evidence,
  outputRoot = process.cwd(),
) {
  const exact = exactPathInput(outputPath, 'Evidence output path');
  const resolved = path.resolve(exact);
  const root = await trustedRoot(outputRoot);
  if (!isContained(root, resolved)) {
    throw new Error('Evidence output escapes the allowed root');
  }
  const parent = path.dirname(resolved);
  await assertNoSymlinkSegments(root, parent);
  const parentStat = await lstat(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new Error('Evidence output parent must be a real directory');
  }
  const canonicalParent = await realpath(parent);
  if (!samePath(canonicalParent, parent)) {
    throw new Error('Evidence output parent must already be canonical');
  }
  const body = `${JSON.stringify(evidence, null, 2)}\n`;
  await writeFile(resolved, body, { encoding: 'utf8', flag: 'wx' });
  return resolved;
}

function normalizeOptions(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Options are required');
  const platform = String(raw.platform ?? '');
  const arch = String(raw.arch ?? '');
  const version = String(raw.version ?? '');
  const sourceCommit = String(raw.sourceCommit ?? '').toLowerCase();
  const expectedSignerId = raw.expectedSignerId
    ? exactPathInput(raw.expectedSignerId, 'Expected signer identity').toUpperCase()
    : undefined;
  if (!PLATFORMS.has(platform)) throw new Error('Unsupported platform');
  if (!ARCHES.has(arch)) throw new Error('Unsupported architecture');
  if (!VERSION.test(version)) throw new Error('Invalid release version');
  if (!COMMIT.test(sourceCommit)) throw new Error('Invalid source commit');
  if (!Array.isArray(raw.artifacts) || raw.artifacts.length === 0) {
    throw new Error('At least one artifact is required');
  }
  const artifacts = raw.artifacts.map((value) => exactRelativePath(value));
  if (new Set(artifacts).size !== artifacts.length) {
    throw new Error('Duplicate artifact path');
  }
  if (raw.probeSignatures === true && !expectedSignerId) {
    throw new Error('Expected signer identity is required with signature probes');
  }
  if (
    expectedSignerId
    && (
      (platform === 'windows' && !WINDOWS_SIGNER_ID.test(expectedSignerId))
      || (platform === 'macos' && !MACOS_TEAM_ID.test(expectedSignerId))
    )
  ) {
    throw new Error('Invalid expected signer identity');
  }
  return Object.freeze({
    platform,
    arch,
    version,
    sourceCommit,
    releaseRoot: exactPathInput(raw.releaseRoot, 'Release root'),
    output: raw.output
      ? exactPathInput(raw.output, 'Evidence output path')
      : undefined,
    application: raw.application
      ? exactRelativePath(raw.application)
      : undefined,
    expectedSignerId,
    artifacts: Object.freeze(artifacts),
    probeSignatures: raw.probeSignatures === true,
  });
}

async function collectArtifactEvidence(root, options) {
  const evidence = [];
  for (const relativePath of [...options.artifacts].sort()) {
    const artifact = await trustedArtifact(root, relativePath);
    validateArtifactIdentity(relativePath, options);
    const bytes = await readFile(artifact.absolutePath);
    evidence.push(Object.freeze({
      relativePath: artifact.relativePath,
      bytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }));
  }
  return evidence;
}

async function trustedRoot(rootInput) {
  if (!path.isAbsolute(rootInput)) {
    throw new Error('Release root must be absolute');
  }
  const resolved = path.resolve(rootInput);
  const stat = await lstat(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Release root must be a real directory');
  }
  const canonical = await realpath(resolved);
  if (!samePath(canonical, resolved)) {
    throw new Error('Release root must already be canonical');
  }
  return canonical;
}

async function trustedArtifact(root, relativeInput) {
  const relativePath = exactRelativePath(relativeInput);
  const absolutePath = path.resolve(root, relativePath);
  if (!isContained(root, absolutePath)) {
    throw new Error('Artifact escapes the release root');
  }
  await assertNoSymlinkSegments(root, absolutePath);
  const stat = await lstat(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('Artifact must be a regular file');
  }
  const canonical = await realpath(absolutePath);
  if (!isContained(root, canonical) || !samePath(canonical, absolutePath)) {
    throw new Error('Artifact path is not canonical');
  }
  return {
    absolutePath,
    relativePath: relativePath.replaceAll('\\', '/'),
  };
}

async function trustedVerificationTarget(root, relativeInput) {
  const relativePath = exactRelativePath(relativeInput);
  const absolutePath = path.resolve(root, relativePath);
  if (!isContained(root, absolutePath)) {
    throw new Error('Application escapes the release root');
  }
  await assertNoSymlinkSegments(root, absolutePath);
  const stat = await lstat(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('Signature target has an invalid kind');
  }
  const canonical = await realpath(absolutePath);
  if (!isContained(root, canonical) || !samePath(canonical, absolutePath)) {
    throw new Error('Application path is not canonical');
  }
  return canonical;
}

async function assertNoSymlinkSegments(root, target) {
  const relative = path.relative(root, target);
  let current = root;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) {
      throw new Error('Symlinked artifact paths are not allowed');
    }
  }
}

function validateArtifactIdentity(relativePath, options) {
  const name = path.basename(relativePath).toLowerCase();
  const platformToken = options.platform === 'windows' ? 'win' : 'mac';
  if (
    !name.includes(options.version.toLowerCase())
    || !name.includes(`-${platformToken}-`)
    || !name.includes(`-${options.arch}.`)
  ) {
    throw new Error('Artifact identity does not match version/platform/arch');
  }
}

async function collectSignatureEvidence(
  options,
  root,
  runVerifier,
  hostPlatform,
) {
  if (!options.application) {
    throw new Error('--application is required with --probe-signatures');
  }
  if (!options.artifacts.includes(options.application)) {
    throw new Error('Signature target must be one of the validated artifacts');
  }
  const expectedHost = options.platform === 'windows' ? 'win32' : 'darwin';
  if (hostPlatform !== expectedHost) {
    throw new Error('Signature probes must run on the target platform');
  }
  const application = await trustedVerificationTarget(
    root,
    options.application,
  );
  if (options.platform === 'windows') {
    const request = {
      name: 'authenticode',
      command: 'powershell.exe',
      args: ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_SIGNATURE_SCRIPT],
      env: {
        IZZI_VALIDATION_TARGET: application,
        IZZI_EXPECTED_SIGNER_ID: options.expectedSignerId,
      },
    };
    const result = await executeVerifier(request, runVerifier);
    let parsed;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      throw new Error('Authenticode verifier returned invalid evidence');
    }
    const observed = String(parsed.signerThumbprint ?? '').toUpperCase();
    if (observed !== options.expectedSignerId) {
      throw new Error('Authenticode signer identity mismatch');
    }
    return {
      signerIdentity: Object.freeze({
        kind: 'windows-certificate-thumbprint-sha1',
        expected: options.expectedSignerId,
        observed,
      }),
      probes: [createProbeEvidence(request, result, application)],
    };
  }

  const identityRequest = {
    name: 'codesign-identity',
    command: 'codesign',
    args: ['-dv', '--verbose=4', application],
  };
  const identityResult = await executeVerifier(identityRequest, runVerifier);
  const identityOutput = `${identityResult.stdout}\n${identityResult.stderr}`;
  const observedTeamId = identityOutput.match(/TeamIdentifier=([A-Z0-9]{10})/)?.[1];
  if (observedTeamId !== options.expectedSignerId) {
    throw new Error('macOS signer identity mismatch');
  }
  const requests = [
    {
      name: 'codesign',
      command: 'codesign',
      args: ['--verify', '--strict', '--verbose=2', application],
    },
      {
        name: 'stapler',
        command: 'xcrun',
        args: ['stapler', 'validate', application],
      },
      {
        name: 'gatekeeper',
        command: 'spctl',
        args: [
          '--assess',
          '--type',
          'open',
          '--context',
          'context:primary-signature',
          '--verbose=4',
          application,
        ],
      },
  ];
  const evidence = [
    createProbeEvidence(identityRequest, identityResult, application),
  ];
  for (const request of requests) {
    const result = await executeVerifier(request, runVerifier);
    evidence.push(createProbeEvidence(request, result, application));
  }
  return {
    signerIdentity: Object.freeze({
      kind: 'apple-developer-team-id',
      expected: options.expectedSignerId,
      observed: observedTeamId,
    }),
    probes: evidence,
  };
}

async function executeVerifier(request, runVerifier) {
  const result = await runVerifier(request);
  if (!result || result.exitCode !== 0) {
    throw new Error(`${request.name} verification failed`);
  }
  return result;
}

function createProbeEvidence(request, result, application) {
  return Object.freeze({
    name: request.name,
    status: 'PASS',
    command: request.command,
    args: Object.freeze(request.args.map((value) => (
      value === application ? '<application>' : value
    ))),
    stdoutSha256: digestText(result.stdout ?? ''),
    stderrSha256: digestText(result.stderr ?? ''),
  });
}

export function runFixedVerifier(request) {
  const allowed = new Set(['powershell.exe', 'codesign', 'xcrun', 'spctl']);
  if (!allowed.has(request.command)) {
    return Promise.reject(new Error('Unsupported verifier command'));
  }
  return new Promise((resolve, reject) => {
    const child = spawn(request.command, request.args, {
      shell: false,
      windowsHide: true,
      env: request.env
        ? { ...process.env, ...request.env }
        : process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    const collect = (kind, chunk) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > MAX_PROBE_OUTPUT_BYTES) {
        child.kill();
        reject(new Error('Verifier output exceeded the evidence budget'));
        return;
      }
      if (kind === 'stdout') stdout += chunk.toString('utf8');
      else stderr += chunk.toString('utf8');
    };
    child.stdout.on('data', (chunk) => collect('stdout', chunk));
    child.stderr.on('data', (chunk) => collect('stderr', chunk));
    child.once('error', reject);
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('Verifier timed out'));
    }, PROBE_TIMEOUT_MS);
    child.once('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr });
    });
  });
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
  const exact = exactPathInput(value, 'Artifact path');
  if (path.isAbsolute(exact)) {
    throw new Error('Artifact paths must be relative');
  }
  const normalized = path.normalize(exact);
  if (
    normalized === '..'
    || normalized.startsWith(`..${path.sep}`)
    || normalized === '.'
  ) {
    throw new Error('Artifact path traversal is not allowed');
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

function digestText(value) {
  return createHash('sha256')
    .update(String(value).replaceAll('\r\n', '\n'))
    .digest('hex');
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const evidence = await validatePlatformArtifacts(options);
  await writeEvidence(options.output, evidence);
  process.stdout.write(`${JSON.stringify(evidence)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`platform validation failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
