import assert from 'node:assert/strict';
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
import {
  parseArguments,
  readJsonEvidence,
  validatePlatformE2EEvidence,
  writeValidationEvidence,
} from './platform-e2e-evidence-validator.mjs';
import { validatePlatformArtifacts } from './platform-validation-harness.mjs';

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
const R7_MACOS_PROBE_ARGS = Object.freeze({
  'codesign-identity': ['-dv', '--verbose=4', '<application>'],
  codesign: ['--verify', '--strict', '--verbose=2', '<application>'],
  stapler: ['stapler', 'validate', '<application>'],
  gatekeeper: [
    '--assess',
    '--type',
    'open',
    '--context',
    'context:primary-signature',
    '--verbose=4',
    '<application>',
  ],
});

const SHARED = [
  'extensions_render',
  'login_boundary',
  'marketplace_render',
  'memory_render',
  'overview_render',
  'settings_render',
  'status_render',
  'tasks_render',
];

const WINDOWS = [
  'app_data_retention',
  'first_launch',
  'fresh_install',
  'post_upgrade_launch',
  'uninstall',
  'upgrade_from_supported',
];

const MACOS = [
  'copy_to_applications',
  'dmg_open',
  'first_launch',
  'gatekeeper_acceptance',
  'remove_application',
];

function artifactFor(platform, arch) {
  return {
    relativePath: `Izzi AI-${VERSION}-${platform === 'windows' ? 'win' : 'mac'}-${arch}.${platform === 'windows' ? 'exe' : 'dmg'}`,
    bytes: 123456,
    sha256: ARTIFACT_SHA,
  };
}

function platformEvidence(platform = 'windows', arch = 'x64') {
  const artifact = artifactFor(platform, arch);
  const probe = (name, command) => ({
    name,
    status: 'PASS',
    command,
    args: name === 'authenticode'
      ? [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        R7_WINDOWS_SCRIPT,
      ]
      : [...R7_MACOS_PROBE_ARGS[name]],
    stdoutSha256: '1'.repeat(64),
    stderrSha256: '2'.repeat(64),
  });
  return {
    schemaVersion: 1,
    artifactKind: 'desktop-platform-validation-evidence',
    decision: 'SIGNED_PLATFORM_EVIDENCE_PASS',
    stableReleaseAccepted: false,
    platform,
    arch,
    version: VERSION,
    sourceCommit: SOURCE_COMMIT,
    artifacts: [artifact],
    verificationTarget: artifact.relativePath,
    signerIdentity: {
      kind: platform === 'windows'
        ? 'windows-certificate-thumbprint-sha1'
        : 'apple-developer-team-id',
      expected: platform === 'windows' ? 'E'.repeat(40) : 'ABCDE12345',
      observed: platform === 'windows' ? 'E'.repeat(40) : 'ABCDE12345',
    },
    probes: platform === 'windows'
      ? [probe('authenticode', 'powershell.exe')]
      : [
        probe('codesign-identity', 'codesign'),
        probe('codesign', 'codesign'),
        probe('stapler', 'xcrun'),
        probe('gatekeeper', 'spctl'),
      ],
    prohibitions: [
      'installer_or_application_execution',
      'release_publish',
      'stable_promotion',
    ],
  };
}

function e2eEvidence(platform = 'windows', arch = 'x64') {
  const ids = [...SHARED, ...(platform === 'windows' ? WINDOWS : MACOS)].sort();
  return {
    schemaVersion: 1,
    artifactKind: 'desktop-platform-e2e-evidence',
    platform,
    arch,
    version: VERSION,
    sourceCommit: SOURCE_COMMIT,
    artifact: artifactFor(platform, arch),
    run: {
      startedAt: '2026-07-29T10:00:00.000Z',
      completedAt: '2026-07-29T10:30:00.000Z',
      cleanProfile: true,
      host: {
        osVersion: platform === 'windows' ? 'Windows 11 24H2' : 'macOS 15.5',
        locale: 'en-US',
      },
      operator: {
        role: 'release-validator',
        method: 'manual',
        attestationSha256: ATTESTATION_SHA,
      },
      upgradeFromVersion: platform === 'windows' ? '1.13.2' : null,
      checks: ids.map((id, index) => ({
        id,
        status: 'PASS',
        result: id === 'app_data_retention' ? 'retained' : 'passed',
        observedAt: `2026-07-29T10:${String(index + 1).padStart(2, '0')}:00.000Z`,
        evidenceSha256: EVIDENCE_SHA,
      })),
    },
  };
}

test('parses exact CLI arguments', () => {
  const parsed = parseArguments([
    '--input-root', 'C:\\evidence',
    '--platform-evidence', 'platform.json',
    '--e2e-evidence', 'e2e.json',
    '--output-root', 'C:\\output',
    '--output', 'validated.json',
  ]);
  assert.equal(parsed.e2eEvidence, 'e2e.json');
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

test('validates deterministic Windows evidence without granting stable', () => {
  const platform = platformEvidence();
  const e2e = e2eEvidence();
  const first = validatePlatformE2EEvidence(platform, e2e);
  const replay = validatePlatformE2EEvidence(
    structuredClone(platform),
    structuredClone(e2e),
  );
  assert.deepEqual(first, replay);
  assert.equal(
    first.decision,
    'UNAUTHENTICATED_E2E_EVIDENCE_STRUCTURE_PASS',
  );
  assert.equal(first.evidenceAuthenticated, false);
  assert.equal(first.releaseGateAdvanceAllowed, false);
  assert.equal(first.stableReleaseAccepted, false);
  assert.equal(first.run.checkCount, SHARED.length + WINDOWS.length);
  assert.equal(first.artifact.sha256, ARTIFACT_SHA);

  const changedProbe = structuredClone(platform);
  changedProbe.probes[0].stdoutSha256 = '3'.repeat(64);
  const changed = validatePlatformE2EEvidence(changedProbe, e2e);
  assert.notEqual(
    first.inputDigests.platformEvidenceSha256,
    changed.inputDigests.platformEvidenceSha256,
  );

  const changedScript = structuredClone(platform);
  changedScript.probes[0].args[3] += '; Write-Output tampered';
  assert.throws(
    () => validatePlatformE2EEvidence(changedScript, e2e),
    /Platform probe is invalid/,
  );
});

test('accepts the exact R7 Windows signed-evidence shape', async (t) => {
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), 'izzi-platform-r7-r8-'),
  );
  const root = await realpath(temporary);
  t.after(() => rm(root, { force: true, recursive: true }));
  const artifact = artifactFor('windows', 'x64').relativePath;
  await writeFile(path.join(root, artifact), 'signed installer bytes');
  const signed = await validatePlatformArtifacts({
    platform: 'windows',
    arch: 'x64',
    version: VERSION,
    sourceCommit: SOURCE_COMMIT,
    releaseRoot: root,
    artifacts: [artifact],
    application: artifact,
    expectedSignerId: 'E'.repeat(40),
    probeSignatures: true,
  }, {
    hostPlatform: 'win32',
    runVerifier: async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        status: 'Valid',
        signerThumbprint: 'E'.repeat(40),
      }),
      stderr: '',
    }),
  });
  const e2e = e2eEvidence();
  e2e.artifact = { ...signed.artifacts[0] };
  const validation = validatePlatformE2EEvidence(signed, e2e);
  assert.equal(
    validation.decision,
    'UNAUTHENTICATED_E2E_EVIDENCE_STRUCTURE_PASS',
  );
});

test('validates macOS evidence with DMG and Gatekeeper checks', () => {
  const result = validatePlatformE2EEvidence(
    platformEvidence('macos', 'arm64'),
    e2eEvidence('macos', 'arm64'),
  );
  assert.equal(result.platform, 'macos');
  assert.equal(result.arch, 'arm64');
  assert.equal(result.run.checkCount, SHARED.length + MACOS.length);
  assert.ok(result.requiredChecks.includes('gatekeeper_acceptance'));

  const changedArgv = platformEvidence('macos', 'arm64');
  changedArgv.probes.find((probe) => probe.name === 'gatekeeper').args.pop();
  assert.throws(
    () => validatePlatformE2EEvidence(
      changedArgv,
      e2eEvidence('macos', 'arm64'),
    ),
    /Platform probe is invalid/,
  );
});

test('rejects unsigned, mismatched or unrelated artifact evidence', () => {
  const unsigned = platformEvidence();
  unsigned.decision = 'STATIC_PREFLIGHT_ONLY';
  assert.throws(
    () => validatePlatformE2EEvidence(unsigned, e2eEvidence()),
    /Signed platform evidence is required/,
  );

  const mismatched = e2eEvidence();
  mismatched.sourceCommit = 'f'.repeat(40);
  assert.throws(
    () => validatePlatformE2EEvidence(platformEvidence(), mismatched),
    /sourceCommit mismatch/,
  );

  const unrelated = e2eEvidence();
  unrelated.artifact.relativePath = 'Izzi AI-unrelated-win-x64.exe';
  assert.throws(
    () => validatePlatformE2EEvidence(platformEvidence(), unrelated),
    /not the signed verification target/,
  );

  const wrongSigner = platformEvidence();
  wrongSigner.signerIdentity.observed = 'F'.repeat(40);
  assert.throws(
    () => validatePlatformE2EEvidence(wrongSigner, e2eEvidence()),
    /Signer identity is not bound/,
  );
});

test('rejects missing, duplicate, unknown and failed checks', () => {
  const missing = e2eEvidence();
  missing.run.checks.pop();
  assert.throws(
    () => validatePlatformE2EEvidence(platformEvidence(), missing),
    /Missing E2E check/,
  );

  const duplicate = e2eEvidence();
  duplicate.run.checks.push({ ...duplicate.run.checks[0] });
  assert.throws(
    () => validatePlatformE2EEvidence(platformEvidence(), duplicate),
    /Duplicate E2E check/,
  );

  const unknown = e2eEvidence();
  unknown.run.checks[0].id = 'unexpected_check';
  assert.throws(
    () => validatePlatformE2EEvidence(platformEvidence(), unknown),
    /Unknown E2E check|Missing E2E check/,
  );

  const failed = e2eEvidence();
  failed.run.checks[0].status = 'FAIL';
  assert.throws(
    () => validatePlatformE2EEvidence(platformEvidence(), failed),
    /E2E check failed/,
  );
});

test('rejects retention, timestamps, upgrade source and sensitive fields', () => {
  const retention = e2eEvidence();
  retention.run.checks.find(
    (check) => check.id === 'app_data_retention',
  ).result = 'passed';
  assert.throws(
    () => validatePlatformE2EEvidence(platformEvidence(), retention),
    /app-data retention|result is invalid/,
  );

  const timestamp = e2eEvidence();
  timestamp.run.completedAt = '2026-07-31T10:30:00.000Z';
  assert.throws(
    () => validatePlatformE2EEvidence(platformEvidence(), timestamp),
    /duration is invalid/,
  );

  const upgrade = e2eEvidence();
  upgrade.run.upgradeFromVersion = VERSION;
  assert.throws(
    () => validatePlatformE2EEvidence(platformEvidence(), upgrade),
    /upgrade source version is invalid/,
  );

  const sensitive = e2eEvidence();
  sensitive.run.operator.apiToken = 'not-allowed';
  assert.throws(
    () => validatePlatformE2EEvidence(platformEvidence(), sensitive),
    /Sensitive field is not allowed/,
  );
});

test('reads canonical JSON inputs and writes create-only contained output', async (t) => {
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), 'izzi-platform-e2e-'),
  );
  const root = await realpath(temporary);
  t.after(() => rm(root, { force: true, recursive: true }));
  await mkdir(path.join(root, 'input'));
  await mkdir(path.join(root, 'output'));
  await writeFile(
    path.join(root, 'input', 'platform.json'),
    JSON.stringify(platformEvidence()),
  );
  await writeFile(
    path.join(root, 'input', 'e2e.json'),
    JSON.stringify(e2eEvidence()),
  );
  const platform = await readJsonEvidence(root, 'input/platform.json');
  const e2e = await readJsonEvidence(root, 'input/e2e.json');
  const validation = validatePlatformE2EEvidence(platform, e2e);
  const output = await writeValidationEvidence(
    root,
    'output/validated.json',
    validation,
  );
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), validation);
  await assert.rejects(
    writeValidationEvidence(root, 'output/validated.json', validation),
    /EEXIST/,
  );
  await assert.rejects(
    readJsonEvidence(root, '../escape.json'),
    /traversal/,
  );

  const outsideTemporary = await mkdtemp(
    path.join(os.tmpdir(), 'izzi-platform-e2e-outside-'),
  );
  const outside = await realpath(outsideTemporary);
  t.after(() => rm(outside, { force: true, recursive: true }));
  const redirect = path.join(root, 'redirect');
  try {
    await symlink(outside, redirect, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error?.code === 'EPERM') return;
    throw error;
  }
  await assert.rejects(
    writeValidationEvidence(root, 'redirect/escaped.json', validation),
    /Symlinked|canonical/,
  );
  await writeFile(path.join(outside, 'outside.json'), JSON.stringify(e2eEvidence()));
  await assert.rejects(
    readJsonEvidence(root, 'redirect/outside.json'),
    /Symlinked|canonical/,
  );
});
