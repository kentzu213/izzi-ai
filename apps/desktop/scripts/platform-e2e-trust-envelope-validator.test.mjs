import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { validatePlatformE2EEvidence } from './platform-e2e-evidence-validator.mjs';
import {
  buildSignaturePayload,
  canonicalSha256,
  parseArguments,
  publicKeyFingerprint,
  readPublicKey,
  validateTrustEnvelope,
  verifyEd25519Detached,
  writeTrustVerification,
} from './platform-e2e-trust-envelope-validator.mjs';

const VERSION = '1.14.0-rc.1';
const SOURCE_COMMIT = 'a'.repeat(40);
const ARTIFACT_SHA = 'b'.repeat(64);
const ATTESTATION_SHA = 'c'.repeat(64);
const EVIDENCE_SHA = 'd'.repeat(64);
const R7_WINDOWS_SCRIPT = [
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

const RFC_PUBLIC_KEY_1 =
  'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a';
const RFC_PUBLIC_KEY_2 =
  '3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c';
const RFC_MESSAGE_2 = Buffer.from('72', 'hex');
const RFC_SIGNATURE_2 = Buffer.from(
  '92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da'
  + '085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00',
  'hex',
);

const SHARED_CHECKS = [
  'extensions_render',
  'login_boundary',
  'marketplace_render',
  'memory_render',
  'overview_render',
  'settings_render',
  'status_render',
  'tasks_render',
];
const WINDOWS_CHECKS = [
  'app_data_retention',
  'first_launch',
  'fresh_install',
  'post_upgrade_launch',
  'uninstall',
  'upgrade_from_supported',
];

function publicKeyPem(rawHex) {
  const spki = Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'),
    Buffer.from(rawHex, 'hex'),
  ]);
  const body = spki.toString('base64').match(/.{1,64}/g).join('\n');
  return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----\n`;
}

function x25519PublicKeyPem(rawHex) {
  const spki = Buffer.concat([
    Buffer.from('302a300506032b656e032100', 'hex'),
    Buffer.from(rawHex, 'hex'),
  ]);
  const body = spki.toString('base64').match(/.{1,64}/g).join('\n');
  return `-----BEGIN PUBLIC KEY-----\n${body}\n-----END PUBLIC KEY-----\n`;
}

const PLATFORM_PUBLIC_KEY = publicKeyPem(RFC_PUBLIC_KEY_1);
const OPERATOR_PUBLIC_KEY = publicKeyPem(RFC_PUBLIC_KEY_2);
const PLATFORM_FINGERPRINT = publicKeyFingerprint(PLATFORM_PUBLIC_KEY);
const OPERATOR_FINGERPRINT = publicKeyFingerprint(OPERATOR_PUBLIC_KEY);

function artifact() {
  return {
    relativePath: `Izzi AI-${VERSION}-win-x64.exe`,
    bytes: 123456,
    sha256: ARTIFACT_SHA,
  };
}

function platformEvidence() {
  return {
    schemaVersion: 1,
    artifactKind: 'desktop-platform-validation-evidence',
    decision: 'SIGNED_PLATFORM_EVIDENCE_PASS',
    stableReleaseAccepted: false,
    platform: 'windows',
    arch: 'x64',
    version: VERSION,
    sourceCommit: SOURCE_COMMIT,
    artifacts: [artifact()],
    verificationTarget: artifact().relativePath,
    signerIdentity: {
      kind: 'windows-certificate-thumbprint-sha1',
      expected: 'E'.repeat(40),
      observed: 'E'.repeat(40),
    },
    probes: [{
      name: 'authenticode',
      status: 'PASS',
      command: 'powershell.exe',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        R7_WINDOWS_SCRIPT,
      ],
      stdoutSha256: '1'.repeat(64),
      stderrSha256: '2'.repeat(64),
    }],
    prohibitions: [
      'installer_or_application_execution',
      'release_publish',
      'stable_promotion',
    ],
  };
}

function e2eEvidence() {
  const checks = [...SHARED_CHECKS, ...WINDOWS_CHECKS].sort();
  return {
    schemaVersion: 1,
    artifactKind: 'desktop-platform-e2e-evidence',
    platform: 'windows',
    arch: 'x64',
    version: VERSION,
    sourceCommit: SOURCE_COMMIT,
    artifact: artifact(),
    run: {
      startedAt: '2026-07-29T10:00:00.000Z',
      completedAt: '2026-07-29T10:30:00.000Z',
      cleanProfile: true,
      host: {
        osVersion: 'Windows 11 24H2',
        locale: 'en-US',
      },
      operator: {
        role: 'release-validator',
        method: 'manual',
        attestationSha256: ATTESTATION_SHA,
      },
      upgradeFromVersion: '1.13.2',
      checks: checks.map((id, index) => ({
        id,
        status: 'PASS',
        result: id === 'app_data_retention' ? 'retained' : 'passed',
        observedAt: `2026-07-29T10:${String(index + 1).padStart(2, '0')}:00.000Z`,
        evidenceSha256: EVIDENCE_SHA,
      })),
    },
  };
}

function fakeSignature(payload) {
  return createHash('sha512').update(payload).digest('base64');
}

function fakeVerifier(_key, payload, signature) {
  return signature.equals(Buffer.from(fakeSignature(payload), 'base64'));
}

function fixture() {
  const platform = platformEvidence();
  const e2e = e2eEvidence();
  const structure = validatePlatformE2EEvidence(platform, e2e);
  const envelope = {
    schemaVersion: 1,
    artifactKind: 'desktop-platform-e2e-trust-envelope',
    platform: 'windows',
    arch: 'x64',
    version: VERSION,
    sourceCommit: SOURCE_COMMIT,
    evidence: {
      platformEvidenceSha256: canonicalSha256(platform),
      e2eEvidenceSha256: canonicalSha256(e2e),
      structureValidationSha256: canonicalSha256(structure),
    },
    signatures: [
      {
        role: 'platform-evidence-attestor',
        algorithm: 'Ed25519',
        keyId: 'release-platform-attestor-2026',
        keyFingerprint: PLATFORM_FINGERPRINT,
        signedAt: '2026-07-29T10:31:00.000Z',
        signatureBase64: '',
      },
      {
        role: 'operator-evidence-attestor',
        algorithm: 'Ed25519',
        keyId: 'release-operator-attestor-2026',
        keyFingerprint: OPERATOR_FINGERPRINT,
        signedAt: '2026-07-29T10:32:00.000Z',
        signatureBase64: '',
      },
    ],
  };
  for (const signature of envelope.signatures) {
    const evidence = signature.role === 'platform-evidence-attestor'
      ? platform
      : e2e;
    signature.signatureBase64 = fakeSignature(buildSignaturePayload(
      signature,
      envelope,
      evidence,
    ));
  }
  return { platform, e2e, structure, envelope };
}

function validate(values = fixture()) {
  return validateTrustEnvelope(
    values.platform,
    values.e2e,
    values.structure,
    values.envelope,
    {
      platformPublicKeyPem: PLATFORM_PUBLIC_KEY,
      operatorPublicKeyPem: OPERATOR_PUBLIC_KEY,
      expectedPlatformFingerprint: PLATFORM_FINGERPRINT,
      expectedOperatorFingerprint: OPERATOR_FINGERPRINT,
      verifySignature: fakeVerifier,
    },
  );
}

test('parses exact CLI arguments', () => {
  const parsed = parseArguments([
    '--input-root', 'C:\\evidence',
    '--platform-evidence', 'platform.json',
    '--e2e-evidence', 'e2e.json',
    '--structure-validation', 'structure.json',
    '--envelope', 'envelope.json',
    '--platform-public-key', 'platform.pem',
    '--operator-public-key', 'operator.pem',
    '--platform-key-fingerprint', PLATFORM_FINGERPRINT,
    '--operator-key-fingerprint', OPERATOR_FINGERPRINT,
    '--output-root', 'C:\\output',
    '--output', 'trust.json',
  ]);
  assert.equal(parsed.operatorPublicKey, 'operator.pem');
  assert.throws(
    () => parseArguments(['--input-root', 'C:\\evidence']),
    /Missing required argument/,
  );
  assert.throws(
    () => parseArguments([
      '--input-root', 'a',
      '--input-root', 'b',
    ]),
    /Duplicate argument/,
  );
});

test('verifies the RFC 8032 Ed25519 public test vector', () => {
  assert.equal(
    verifyEd25519Detached(
      OPERATOR_PUBLIC_KEY,
      RFC_MESSAGE_2,
      RFC_SIGNATURE_2,
    ),
    true,
  );
  assert.equal(
    verifyEd25519Detached(
      OPERATOR_PUBLIC_KEY,
      Buffer.from('73', 'hex'),
      RFC_SIGNATURE_2,
    ),
    false,
  );
});

test('verifies two distinct pinned signatures without accepting trust anchors', () => {
  const first = validate();
  const replay = validate();
  assert.deepEqual(first, replay);
  assert.equal(first.decision, 'PINNED_PUBLIC_KEY_SIGNATURES_VERIFIED');
  assert.equal(first.signatureVerificationSucceeded, true);
  assert.equal(first.trustAnchorAccepted, false);
  assert.equal(first.evidenceAuthenticated, false);
  assert.equal(first.releaseGateAdvanceAllowed, false);
  assert.equal(first.stableReleaseAccepted, false);
  assert.deepEqual(first.keyFingerprints, {
    operatorEvidence: OPERATOR_FINGERPRINT,
    platformEvidence: PLATFORM_FINGERPRINT,
  });
});

test('rejects tampered evidence and R8 replay mismatch', () => {
  const tamperedEvidence = fixture();
  tamperedEvidence.e2e.run.host.locale = 'vi-VN';
  assert.throws(
    () => validate(tamperedEvidence),
    /digest mismatch|signature verification failed|structure replay mismatch/,
  );

  const tamperedStructure = fixture();
  tamperedStructure.structure = {
    ...tamperedStructure.structure,
    evidenceAuthenticated: true,
  };
  assert.throws(
    () => validate(tamperedStructure),
    /structure replay mismatch/,
  );
});

test('rejects bad signatures, fingerprint drift and same-key role reuse', () => {
  const badSignature = fixture();
  badSignature.envelope.signatures[0].signatureBase64 =
    Buffer.alloc(64, 7).toString('base64');
  assert.throws(
    () => validate(badSignature),
    /signature verification failed/,
  );

  const badFingerprint = fixture();
  badFingerprint.envelope.signatures[0].keyFingerprint =
    `sha256:${'f'.repeat(64)}`;
  assert.throws(
    () => validate(badFingerprint),
    /fingerprint mismatch/,
  );

  const reusedKey = fixture();
  reusedKey.envelope.signatures[1].keyId =
    reusedKey.envelope.signatures[0].keyId;
  assert.throws(
    () => validate(reusedKey),
    /distinct signer keys/,
  );
});

test('rejects private-key material and non-exact public-key pins', () => {
  const values = fixture();
  assert.throws(
    () => validateTrustEnvelope(
      values.platform,
      values.e2e,
      values.structure,
      values.envelope,
      {
        platformPublicKeyPem:
          `-----BEGIN ${'PRIVATE'} KEY-----\nAAAA\n`
          + `-----END ${'PRIVATE'} KEY-----\n`,
        operatorPublicKeyPem: OPERATOR_PUBLIC_KEY,
        expectedPlatformFingerprint: PLATFORM_FINGERPRINT,
        expectedOperatorFingerprint: OPERATOR_FINGERPRINT,
        verifySignature: fakeVerifier,
      },
    ),
    /Private-key material is not allowed/,
  );
  assert.throws(
    () => validateTrustEnvelope(
      values.platform,
      values.e2e,
      values.structure,
      values.envelope,
      {
        platformPublicKeyPem: PLATFORM_PUBLIC_KEY,
        operatorPublicKeyPem: OPERATOR_PUBLIC_KEY,
        expectedPlatformFingerprint: PLATFORM_FINGERPRINT.toUpperCase(),
        expectedOperatorFingerprint: OPERATOR_FINGERPRINT,
        verifySignature: fakeVerifier,
      },
    ),
    /fingerprint is invalid/,
  );
});

test('rejects role, timestamp and envelope schema drift', () => {
  const wrongRole = fixture();
  wrongRole.envelope.signatures[0].role = 'operator-evidence-attestor';
  assert.throws(
    () => validate(wrongRole),
    /signature catalog|distinct signer keys/,
  );

  const lateSignature = fixture();
  lateSignature.envelope.signatures[0].signedAt =
    '2026-07-31T10:31:00.000Z';
  assert.throws(
    () => validate(lateSignature),
    /signedAt is outside/,
  );

  const unknownField = fixture();
  unknownField.envelope.releaseAccepted = true;
  assert.throws(
    () => validate(unknownField),
    /exact keys/,
  );
});

test('rejects malformed key and envelope boundaries', () => {
  assert.throws(
    () => publicKeyFingerprint('not a public key'),
    /exact SPKI PEM/,
  );
  assert.throws(
    () => publicKeyFingerprint(x25519PublicKeyPem(RFC_PUBLIC_KEY_1)),
    /must be Ed25519/,
  );
  assert.throws(
    () => publicKeyFingerprint('x'.repeat((64 * 1024) + 1)),
    /Public key is invalid/,
  );

  const sameExpectedKey = fixture();
  assert.throws(
    () => validateTrustEnvelope(
      sameExpectedKey.platform,
      sameExpectedKey.e2e,
      sameExpectedKey.structure,
      sameExpectedKey.envelope,
      {
        platformPublicKeyPem: PLATFORM_PUBLIC_KEY,
        operatorPublicKeyPem: OPERATOR_PUBLIC_KEY,
        expectedPlatformFingerprint: PLATFORM_FINGERPRINT,
        expectedOperatorFingerprint: PLATFORM_FINGERPRINT,
        verifySignature: fakeVerifier,
      },
    ),
    /distinct signer keys/,
  );

  const wrongIdentity = fixture();
  wrongIdentity.envelope.arch = 'arm64';
  assert.throws(
    () => validate(wrongIdentity),
    /arch mismatch/,
  );

  const invalidDigest = fixture();
  invalidDigest.envelope.evidence.e2eEvidenceSha256 = 'sha256:invalid';
  assert.throws(
    () => validate(invalidDigest),
    /evidence digest is invalid/,
  );

  const missingSignature = fixture();
  missingSignature.envelope.signatures.pop();
  assert.throws(
    () => validate(missingSignature),
    /signature catalog is invalid/,
  );

  const invalidAlgorithm = fixture();
  invalidAlgorithm.envelope.signatures[0].algorithm = 'RSA';
  assert.throws(
    () => validate(invalidAlgorithm),
    /algorithm is invalid/,
  );

  const invalidKeyId = fixture();
  invalidKeyId.envelope.signatures[0].keyId = 'Invalid key id';
  assert.throws(
    () => validate(invalidKeyId),
    /key id is invalid/,
  );

  const invalidSignatureFingerprint = fixture();
  invalidSignatureFingerprint.envelope.signatures[0].keyFingerprint = 'bad';
  assert.throws(
    () => validate(invalidSignatureFingerprint),
    /key fingerprint is invalid/,
  );

  const invalidBase64 = fixture();
  invalidBase64.envelope.signatures[0].signatureBase64 = 'not-base64';
  assert.throws(
    () => validate(invalidBase64),
    /Detached signature is invalid/,
  );

  const invalidTimestamp = fixture();
  invalidTimestamp.envelope.signatures[0].signedAt = 'not-a-time';
  assert.throws(
    () => validate(invalidTimestamp),
    /signedAt timestamp is invalid/,
  );

  const defaultCrypto = fixture();
  assert.throws(
    () => validateTrustEnvelope(
      defaultCrypto.platform,
      defaultCrypto.e2e,
      defaultCrypto.structure,
      defaultCrypto.envelope,
      {
        platformPublicKeyPem: PLATFORM_PUBLIC_KEY,
        operatorPublicKeyPem: OPERATOR_PUBLIC_KEY,
        expectedPlatformFingerprint: PLATFORM_FINGERPRINT,
        expectedOperatorFingerprint: OPERATOR_FINGERPRINT,
      },
    ),
    /signature verification failed/,
  );
});

test('reads public keys canonically and writes create-only contained output', async (t) => {
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), 'izzi-platform-trust-'),
  );
  const root = await realpath(temporary);
  t.after(() => rm(root, { force: true, recursive: true }));
  await mkdir(path.join(root, 'input'));
  await mkdir(path.join(root, 'output'));
  await writeFile(path.join(root, 'input', 'platform.pem'), PLATFORM_PUBLIC_KEY);
  assert.equal(
    await readPublicKey(root, 'input/platform.pem'),
    PLATFORM_PUBLIC_KEY,
  );
  const verification = validate();
  const output = await writeTrustVerification(
    root,
    'output/verified.json',
    verification,
  );
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), verification);
  await assert.rejects(
    writeTrustVerification(root, 'output/verified.json', verification),
    /EEXIST/,
  );
  await assert.rejects(
    readPublicKey(root, '../escape.pem'),
    /traversal/,
  );
  await assert.rejects(
    readPublicKey('relative-root', 'platform.pem'),
    /must be absolute/,
  );

  const outsideTemporary = await mkdtemp(
    path.join(os.tmpdir(), 'izzi-platform-trust-outside-'),
  );
  const outside = await realpath(outsideTemporary);
  t.after(() => rm(outside, { force: true, recursive: true }));
  const redirect = path.join(root, 'redirect');
  try {
    await symlink(
      outside,
      redirect,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  } catch (error) {
    if (error?.code === 'EPERM') return;
    throw error;
  }
  await writeFile(path.join(outside, 'outside.pem'), PLATFORM_PUBLIC_KEY);
  await assert.rejects(
    readPublicKey(root, 'redirect/outside.pem'),
    /Symlinked|canonical/,
  );
  await assert.rejects(
    writeTrustVerification(root, 'redirect/escaped.json', verification),
    /Symlinked|canonical/,
  );
});
