#!/usr/bin/env node

import {
  createHash,
  createPublicKey,
  verify as cryptoVerify,
} from 'node:crypto';
import {
  lstat,
  readFile,
  realpath,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readJsonEvidence,
  validatePlatformE2EEvidence,
  writeValidationEvidence,
} from './platform-e2e-evidence-validator.mjs';

const FINGERPRINT = /^sha256:[a-f0-9]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const KEY_ID = /^[a-z0-9][a-z0-9._:-]{2,80}$/;
const MAX_PUBLIC_KEY_BYTES = 64 * 1024;
const MAX_SIGNING_DELAY_MS = 24 * 60 * 60 * 1000;
const SIGNER_ROLES = Object.freeze([
  'platform-evidence-attestor',
  'operator-evidence-attestor',
]);

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
    '--structure-validation',
    '--envelope',
    '--platform-public-key',
    '--operator-public-key',
    '--platform-key-fingerprint',
    '--operator-key-fingerprint',
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
    structureValidation: values.get('--structure-validation'),
    envelope: values.get('--envelope'),
    platformPublicKey: values.get('--platform-public-key'),
    operatorPublicKey: values.get('--operator-public-key'),
    platformKeyFingerprint: values.get('--platform-key-fingerprint'),
    operatorKeyFingerprint: values.get('--operator-key-fingerprint'),
    outputRoot: values.get('--output-root'),
    output: values.get('--output'),
  };
}

export function canonicalSha256(value) {
  return `sha256:${createHash('sha256')
    .update(canonicalJson(value))
    .digest('hex')}`;
}

export function publicKeyFingerprint(publicKeyPem) {
  return parseEd25519PublicKey(publicKeyPem, 'Public key').fingerprint;
}

export function verifyEd25519Detached(
  publicKeyPem,
  payload,
  signature,
) {
  const parsed = parseEd25519PublicKey(publicKeyPem, 'Public key');
  if (!Buffer.isBuffer(payload) || !Buffer.isBuffer(signature)) {
    throw new Error('Signature payload and signature must be buffers');
  }
  return cryptoVerify(null, payload, parsed.key, signature);
}

export function buildSignaturePayload(signature, envelope, evidence) {
  const domain = signature.role === 'platform-evidence-attestor'
    ? 'izzi.desktop.platform-evidence.v1'
    : 'izzi.desktop.operator-e2e-evidence.v1';
  return Buffer.from(canonicalJson({
    schemaVersion: 1,
    domain,
    signer: {
      role: signature.role,
      algorithm: signature.algorithm,
      keyId: signature.keyId,
      keyFingerprint: signature.keyFingerprint,
      signedAt: signature.signedAt,
    },
    identity: {
      platform: envelope.platform,
      arch: envelope.arch,
      version: envelope.version,
      sourceCommit: envelope.sourceCommit,
    },
    evidence,
    evidenceSha256: canonicalSha256(evidence),
    structureValidationSha256:
      envelope.evidence.structureValidationSha256,
  }), 'utf8');
}

export function validateTrustEnvelope(
  rawPlatformEvidence,
  rawE2EEvidence,
  rawStructureValidation,
  rawEnvelope,
  options,
) {
  const expectedPlatformFingerprint = validateExpectedFingerprint(
    options?.expectedPlatformFingerprint,
    'Platform key fingerprint',
  );
  const expectedOperatorFingerprint = validateExpectedFingerprint(
    options?.expectedOperatorFingerprint,
    'Operator key fingerprint',
  );
  if (expectedPlatformFingerprint === expectedOperatorFingerprint) {
    throw new Error('Signer roles require distinct signer keys');
  }
  const platformKey = parseEd25519PublicKey(
    options?.platformPublicKeyPem,
    'Platform public key',
  );
  const operatorKey = parseEd25519PublicKey(
    options?.operatorPublicKeyPem,
    'Operator public key',
  );
  if (platformKey.fingerprint !== expectedPlatformFingerprint) {
    throw new Error('Platform public-key fingerprint mismatch');
  }
  if (operatorKey.fingerprint !== expectedOperatorFingerprint) {
    throw new Error('Operator public-key fingerprint mismatch');
  }

  const replay = validatePlatformE2EEvidence(
    rawPlatformEvidence,
    rawE2EEvidence,
  );
  if (
    canonicalJson(replay)
    !== canonicalJson(rawStructureValidation)
  ) {
    throw new Error('R8 structure replay mismatch');
  }

  const envelope = validateEnvelope(rawEnvelope, replay);
  const platformDigest = canonicalSha256(rawPlatformEvidence);
  const e2eDigest = canonicalSha256(rawE2EEvidence);
  const structureDigest = canonicalSha256(rawStructureValidation);
  if (
    envelope.evidence.platformEvidenceSha256 !== platformDigest
    || envelope.evidence.e2eEvidenceSha256 !== e2eDigest
    || envelope.evidence.structureValidationSha256 !== structureDigest
  ) {
    throw new Error('Trust-envelope evidence digest mismatch');
  }

  const platformSignature = envelope.signatures[0];
  const operatorSignature = envelope.signatures[1];
  if (
    platformSignature.keyFingerprint !== expectedPlatformFingerprint
    || operatorSignature.keyFingerprint !== expectedOperatorFingerprint
  ) {
    throw new Error('Trust-envelope key fingerprint mismatch');
  }
  if (
    platformSignature.keyId === operatorSignature.keyId
    || platformSignature.keyFingerprint === operatorSignature.keyFingerprint
  ) {
    throw new Error('Signer roles require distinct signer keys');
  }

  const verifySignature = options?.verifySignature
    ?? ((key, payload, signature) => (
      cryptoVerify(null, payload, key, signature)
    ));
  const signatures = [
    {
      record: platformSignature,
      evidence: rawPlatformEvidence,
      key: platformKey.key,
    },
    {
      record: operatorSignature,
      evidence: rawE2EEvidence,
      key: operatorKey.key,
    },
  ];
  for (const entry of signatures) {
    const signature = decodeSignature(entry.record.signatureBase64);
    const payload = buildSignaturePayload(
      entry.record,
      envelope,
      entry.evidence,
    );
    if (verifySignature(entry.key, payload, signature) !== true) {
      throw new Error(`${entry.record.role} signature verification failed`);
    }
  }

  return Object.freeze({
    schemaVersion: 1,
    artifactKind: 'desktop-platform-e2e-trust-verification',
    decision: 'PINNED_PUBLIC_KEY_SIGNATURES_VERIFIED',
    signatureVerificationSucceeded: true,
    trustAnchorAccepted: false,
    evidenceAuthenticated: false,
    releaseGateAdvanceAllowed: false,
    stableReleaseAccepted: false,
    platform: envelope.platform,
    arch: envelope.arch,
    version: envelope.version,
    sourceCommit: envelope.sourceCommit,
    inputDigests: Object.freeze({
      platformEvidenceSha256: platformDigest,
      e2eEvidenceSha256: e2eDigest,
      structureValidationSha256: structureDigest,
      trustEnvelopeSha256: canonicalSha256(rawEnvelope),
    }),
    keyFingerprints: Object.freeze({
      operatorEvidence: expectedOperatorFingerprint,
      platformEvidence: expectedPlatformFingerprint,
    }),
    signerRecords: Object.freeze({
      operatorEvidence: Object.freeze({
        keyId: operatorSignature.keyId,
        signedAt: operatorSignature.signedAt,
      }),
      platformEvidence: Object.freeze({
        keyId: platformSignature.keyId,
        signedAt: platformSignature.signedAt,
      }),
    }),
    prohibitions: Object.freeze([
      'trust_anchor_assumption',
      'evidence_authentication_claim',
      'release_gate_advancement',
      'stable_promotion',
      'publish',
      'deployment',
    ]),
  });
}

export async function readPublicKey(rootInput, relativeInput) {
  const root = await trustedRoot(rootInput);
  const target = await trustedFile(root, relativeInput, 'Public-key input');
  const stat = await lstat(target.absolutePath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_PUBLIC_KEY_BYTES) {
    throw new Error('Public-key input size is invalid');
  }
  const body = await readFile(target.absolutePath, 'utf8');
  parseEd25519PublicKey(body, 'Public-key input');
  return body;
}

export async function writeTrustVerification(
  rootInput,
  relativeInput,
  verification,
) {
  return writeValidationEvidence(rootInput, relativeInput, verification);
}

function validateEnvelope(raw, replay) {
  assertRecord(raw, 'Trust envelope');
  assertExactKeys(raw, [
    'arch',
    'artifactKind',
    'evidence',
    'platform',
    'schemaVersion',
    'signatures',
    'sourceCommit',
    'version',
  ], 'Trust envelope');
  if (raw.schemaVersion !== 1) throw new Error('Unsupported trust schema');
  if (raw.artifactKind !== 'desktop-platform-e2e-trust-envelope') {
    throw new Error('Unexpected trust-envelope kind');
  }
  for (const key of ['platform', 'arch', 'version', 'sourceCommit']) {
    if (raw[key] !== replay[key]) {
      throw new Error(`Trust-envelope ${key} mismatch`);
    }
  }
  assertRecord(raw.evidence, 'Trust-envelope evidence');
  assertExactKeys(raw.evidence, [
    'e2eEvidenceSha256',
    'platformEvidenceSha256',
    'structureValidationSha256',
  ], 'Trust-envelope evidence');
  for (const value of Object.values(raw.evidence)) {
    if (typeof value !== 'string' || !FINGERPRINT.test(value)) {
      throw new Error('Trust-envelope evidence digest is invalid');
    }
  }
  if (!Array.isArray(raw.signatures) || raw.signatures.length !== 2) {
    throw new Error('Trust-envelope signature catalog is invalid');
  }
  const signatures = raw.signatures.map((entry, index) => (
    validateSignatureRecord(
      entry,
      SIGNER_ROLES[index],
      replay.run.completedAt,
    )
  ));
  if (
    signatures.map((entry) => entry.role).join('|')
    !== SIGNER_ROLES.join('|')
  ) {
    throw new Error('Trust-envelope signature catalog is invalid');
  }
  return Object.freeze({
    ...raw,
    evidence: Object.freeze({ ...raw.evidence }),
    signatures: Object.freeze(signatures),
  });
}

function validateSignatureRecord(raw, expectedRole, completedAt) {
  assertRecord(raw, 'Trust-envelope signature');
  assertExactKeys(raw, [
    'algorithm',
    'keyFingerprint',
    'keyId',
    'role',
    'signatureBase64',
    'signedAt',
  ], 'Trust-envelope signature');
  if (raw.role !== expectedRole) {
    throw new Error('Trust-envelope signature catalog is invalid');
  }
  if (raw.algorithm !== 'Ed25519') {
    throw new Error('Trust-envelope signature algorithm is invalid');
  }
  if (typeof raw.keyId !== 'string' || !KEY_ID.test(raw.keyId)) {
    throw new Error('Trust-envelope key id is invalid');
  }
  if (
    typeof raw.keyFingerprint !== 'string'
    || !FINGERPRINT.test(raw.keyFingerprint)
  ) {
    throw new Error('Trust-envelope key fingerprint is invalid');
  }
  decodeSignature(raw.signatureBase64);
  const signedAt = parseTimestamp(raw.signedAt, 'Signature signedAt');
  const completed = parseTimestamp(completedAt, 'R8 completion');
  if (
    signedAt < completed
    || signedAt - completed > MAX_SIGNING_DELAY_MS
  ) {
    throw new Error('Signature signedAt is outside the allowed window');
  }
  return Object.freeze({ ...raw });
}

function validateExpectedFingerprint(value, label) {
  if (typeof value !== 'string' || !FINGERPRINT.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function parseEd25519PublicKey(value, label) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > MAX_PUBLIC_KEY_BYTES) {
    throw new Error(`${label} is invalid`);
  }
  if (/PRIVATE KEY/.test(value)) {
    throw new Error('Private-key material is not allowed');
  }
  if (
    !/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END PUBLIC KEY-----\r?\n?$/.test(value)
  ) {
    throw new Error(`${label} must be exact SPKI PEM`);
  }
  let key;
  try {
    key = createPublicKey(value);
  } catch {
    throw new Error(`${label} is invalid`);
  }
  if (key.type !== 'public' || key.asymmetricKeyType !== 'ed25519') {
    throw new Error(`${label} must be Ed25519`);
  }
  const spki = key.export({ type: 'spki', format: 'der' });
  return Object.freeze({
    key,
    fingerprint: `sha256:${createHash('sha256').update(spki).digest('hex')}`,
  });
}

function decodeSignature(value) {
  if (
    typeof value !== 'string'
    || value.length !== 88
    || !/^[A-Za-z0-9+/]{86}==$/.test(value)
  ) {
    throw new Error('Detached signature is invalid');
  }
  const decoded = Buffer.from(value, 'base64');
  if (
    decoded.length !== 64
    || decoded.toString('base64') !== value
  ) {
    throw new Error('Detached signature is invalid');
  }
  return decoded;
}

function parseTimestamp(value, label) {
  if (typeof value !== 'string' || !ISO_UTC.test(value)) {
    throw new Error(`${label} timestamp is invalid`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${label} timestamp is invalid`);
  return parsed;
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
    throw new Error(`${label} must contain exact keys`);
  }
}

async function trustedRoot(rootInput) {
  const exact = exactPathInput(rootInput, 'Evidence root');
  if (!path.isAbsolute(exact)) throw new Error('Evidence root must be absolute');
  const resolved = path.resolve(exact);
  const canonical = await realpath(resolved);
  if (!samePath(canonical, resolved)) {
    throw new Error('Evidence root must already be canonical');
  }
  const stat = await lstat(canonical);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Evidence root must be a real directory');
  }
  return canonical;
}

async function trustedFile(root, relativeInput, label) {
  const relativePath = exactRelativePath(relativeInput);
  const absolutePath = path.resolve(root, relativePath);
  if (!isContained(root, absolutePath)) {
    throw new Error(`${label} escapes the allowed root`);
  }
  await assertNoSymlinkSegments(root, absolutePath);
  const stat = await lstat(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} must be a real file`);
  }
  const canonical = await realpath(absolutePath);
  if (!samePath(canonical, absolutePath)) {
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
  const [
    platformEvidence,
    e2eEvidence,
    structureValidation,
    envelope,
    platformPublicKeyPem,
    operatorPublicKeyPem,
  ] = await Promise.all([
    readJsonEvidence(options.inputRoot, options.platformEvidence),
    readJsonEvidence(options.inputRoot, options.e2eEvidence),
    readJsonEvidence(options.inputRoot, options.structureValidation),
    readJsonEvidence(options.inputRoot, options.envelope),
    readPublicKey(options.inputRoot, options.platformPublicKey),
    readPublicKey(options.inputRoot, options.operatorPublicKey),
  ]);
  const verification = validateTrustEnvelope(
    platformEvidence,
    e2eEvidence,
    structureValidation,
    envelope,
    {
      platformPublicKeyPem,
      operatorPublicKeyPem,
      expectedPlatformFingerprint: options.platformKeyFingerprint,
      expectedOperatorFingerprint: options.operatorKeyFingerprint,
    },
  );
  await writeTrustVerification(
    options.outputRoot,
    options.output,
    verification,
  );
  process.stdout.write(`${JSON.stringify(verification)}\n`);
}

if (
  process.argv[1]
  && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  main().catch((error) => {
    process.stderr.write(
      `platform E2E trust-envelope validation failed: ${error.message}\n`,
    );
    process.exitCode = 1;
  });
}
