import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  parseArguments,
  validatePlatformArtifacts,
  writeEvidence,
} from './platform-validation-harness.mjs';

const SOURCE_COMMIT = 'a'.repeat(40);
const WINDOWS_SIGNER_ID = 'B'.repeat(40);
const MACOS_TEAM_ID = 'ABCDE12345';

async function fixture(t) {
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), 'izzi-platform-validation-'),
  );
  const root = await realpath(temporary);
  t.after(() => rm(root, { force: true, recursive: true }));
  const artifact = 'Izzi AI-1.14.0-rc.1-win-x64.exe';
  await writeFile(path.join(root, artifact), 'installer bytes');
  return { artifact, root };
}

test('parses repeated artifacts and rejects missing or duplicate options', () => {
  const parsed = parseArguments([
    '--platform', 'windows',
    '--arch', 'x64',
    '--version', '1.14.0-rc.1',
    '--source-commit', SOURCE_COMMIT,
    '--release-root', 'C:\\release',
    '--artifact', 'a.exe',
    '--artifact', 'b.exe',
    '--output', 'evidence.json',
    '--probe-signatures',
    '--application', 'Izzi AI.exe',
    '--expected-signer-id', WINDOWS_SIGNER_ID,
  ]);
  assert.deepEqual(parsed.artifacts, ['a.exe', 'b.exe']);
  assert.equal(parsed.probeSignatures, true);
  assert.throws(
    () => parseArguments(['--platform', 'windows']),
    /Missing required argument/,
  );
  assert.throws(
    () => parseArguments([
      '--platform', 'windows',
      '--platform', 'macos',
    ]),
    /Duplicate argument/,
  );
});

test('produces sorted deterministic static evidence with exact hashes', async (t) => {
  const { artifact, root } = await fixture(t);
  const second = 'Izzi AI-1.14.0-rc.1-win-x64.exe.blockmap';
  await writeFile(path.join(root, second), 'blockmap bytes');
  const input = {
    platform: 'windows',
    arch: 'x64',
    version: '1.14.0-rc.1',
    sourceCommit: SOURCE_COMMIT,
    releaseRoot: root,
    artifacts: [second, artifact],
  };
  const first = await validatePlatformArtifacts(input);
  const replay = await validatePlatformArtifacts(input);
  assert.deepEqual(first, replay);
  assert.equal(first.decision, 'STATIC_PREFLIGHT_ONLY');
  assert.deepEqual(
    first.artifacts.map((entry) => entry.relativePath),
    [artifact, second],
  );
  assert.equal(first.artifacts[0].bytes, Buffer.byteLength('installer bytes'));
  assert.match(first.artifacts[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(first.verificationTarget, null);
  assert.equal(first.stableReleaseAccepted, false);
});

test('fails closed on traversal, metadata mismatch and non-file targets', async (t) => {
  const { artifact, root } = await fixture(t);
  const base = {
    platform: 'windows',
    arch: 'x64',
    version: '1.14.0-rc.1',
    sourceCommit: SOURCE_COMMIT,
    releaseRoot: root,
  };
  await assert.rejects(
    validatePlatformArtifacts({ ...base, artifacts: ['../escape.exe'] }),
    /traversal/,
  );
  await assert.rejects(
    validatePlatformArtifacts({
      ...base,
      artifacts: [artifact],
      arch: 'arm64',
    }),
    /identity/,
  );
  await mkdir(path.join(root, 'Izzi AI-1.14.0-rc.1-win-x64.dir'));
  await assert.rejects(
    validatePlatformArtifacts({
      ...base,
      artifacts: ['Izzi AI-1.14.0-rc.1-win-x64.dir'],
    }),
    /regular file/,
  );
});

test('rejects a junction or symlink escape before reading bytes', async (t) => {
  const { root } = await fixture(t);
  const outsideTemporary = await mkdtemp(
    path.join(os.tmpdir(), 'izzi-platform-outside-'),
  );
  const outside = await realpath(outsideTemporary);
  t.after(() => rm(outside, { force: true, recursive: true }));
  const artifact = 'Izzi AI-1.14.0-rc.1-win-x64.exe';
  await writeFile(path.join(outside, artifact), 'outside bytes');
  const link = path.join(root, 'linked');
  try {
    await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error?.code === 'EPERM') {
      t.skip('Host does not permit symlink/junction creation');
      return;
    }
    throw error;
  }
  await assert.rejects(
    validatePlatformArtifacts({
      platform: 'windows',
      arch: 'x64',
      version: '1.14.0-rc.1',
      sourceCommit: SOURCE_COMMIT,
      releaseRoot: root,
      artifacts: [path.join('linked', artifact)],
    }),
    /Symlinked|canonical|escapes/,
  );
});

test('signature probes use fixed argv and fail on false signed evidence', async (t) => {
  const { artifact, root } = await fixture(t);
  const requests = [];
  const input = {
    platform: 'windows',
    arch: 'x64',
    version: '1.14.0-rc.1',
    sourceCommit: SOURCE_COMMIT,
    releaseRoot: root,
    artifacts: [artifact],
    application: artifact,
    expectedSignerId: WINDOWS_SIGNER_ID,
    probeSignatures: true,
  };
  const evidence = await validatePlatformArtifacts(input, {
    hostPlatform: 'win32',
    runVerifier: async (request) => {
      requests.push(request);
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          status: 'Valid',
          signerThumbprint: WINDOWS_SIGNER_ID,
        }),
        stderr: '',
      };
    },
  });
  assert.equal(evidence.decision, 'SIGNED_PLATFORM_EVIDENCE_PASS');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].command, 'powershell.exe');
  assert.equal(requests[0].args.includes(artifact), false);
  assert.equal(requests[0].env.IZZI_VALIDATION_TARGET, path.join(root, artifact));
  assert.equal(requests[0].env.IZZI_EXPECTED_SIGNER_ID, WINDOWS_SIGNER_ID);
  assert.equal(evidence.signerIdentity.observed, WINDOWS_SIGNER_ID);

  await assert.rejects(
    validatePlatformArtifacts(input, {
      hostPlatform: 'win32',
      runVerifier: async () => ({ exitCode: 1, stdout: '', stderr: 'NotSigned' }),
    }),
    /authenticode verification failed/,
  );
  await assert.rejects(
    validatePlatformArtifacts({
      ...input,
      application: 'unrelated-signed.exe',
    }, {
      hostPlatform: 'win32',
      runVerifier: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    }),
    /must be one of the validated artifacts/,
  );
  await assert.rejects(
    validatePlatformArtifacts(input, {
      hostPlatform: 'win32',
      runVerifier: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          status: 'Valid',
          signerThumbprint: 'C'.repeat(40),
        }),
        stderr: '',
      }),
    }),
    /signer identity mismatch/,
  );
  await assert.rejects(
    validatePlatformArtifacts(input, {
      hostPlatform: 'win32',
      runVerifier: async () => {
        await writeFile(path.join(root, artifact), 'swapped bytes');
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            status: 'Valid',
            signerThumbprint: WINDOWS_SIGNER_ID,
          }),
          stderr: '',
        };
      },
    }),
    /changed during signature verification/,
  );
});

test('macOS signed evidence requires signer identity and all platform probes', async (t) => {
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), 'izzi-platform-macos-'),
  );
  const root = await realpath(temporary);
  t.after(() => rm(root, { force: true, recursive: true }));
  const artifact = 'Izzi AI-1.14.0-rc.1-mac-arm64.dmg';
  await writeFile(path.join(root, artifact), 'dmg bytes');
  const requests = [];
  const evidence = await validatePlatformArtifacts({
    platform: 'macos',
    arch: 'arm64',
    version: '1.14.0-rc.1',
    sourceCommit: SOURCE_COMMIT,
    releaseRoot: root,
    artifacts: [artifact],
    application: artifact,
    expectedSignerId: MACOS_TEAM_ID,
    probeSignatures: true,
  }, {
    hostPlatform: 'darwin',
    runVerifier: async (request) => {
      requests.push(request);
      if (request.name === 'codesign-identity') {
        return {
          exitCode: 0,
          stdout: '',
          stderr: `TeamIdentifier=${MACOS_TEAM_ID}`,
        };
      }
      return { exitCode: 0, stdout: 'accepted', stderr: '' };
    },
  });
  assert.deepEqual(
    requests.map((request) => request.command),
    ['codesign', 'codesign', 'xcrun', 'spctl'],
  );
  assert.deepEqual(
    evidence.probes.map((probe) => probe.name),
    ['codesign-identity', 'codesign', 'stapler', 'gatekeeper'],
  );
  assert.equal(evidence.verificationTarget, artifact);
  assert.equal(evidence.signerIdentity.observed, MACOS_TEAM_ID);
  assert.deepEqual(
    requests.find((request) => request.name === 'gatekeeper').args.slice(0, 5),
    ['--assess', '--type', 'open', '--context', 'context:primary-signature'],
  );
});

test('writes evidence once and refuses overwrite', async (t) => {
  const { artifact, root } = await fixture(t);
  const evidence = await validatePlatformArtifacts({
    platform: 'windows',
    arch: 'x64',
    version: '1.14.0-rc.1',
    sourceCommit: SOURCE_COMMIT,
    releaseRoot: root,
    artifacts: [artifact],
  });
  const output = path.join(root, 'evidence', 'windows.json');
  await mkdir(path.dirname(output));
  await writeEvidence(output, evidence, root);
  assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), evidence);
  await assert.rejects(writeEvidence(output, evidence, root), /EEXIST/);

  const outsideTemporary = await mkdtemp(
    path.join(os.tmpdir(), 'izzi-platform-evidence-outside-'),
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
    writeEvidence(path.join(redirect, 'escaped.json'), evidence, root),
    /Symlinked|canonical|escapes/,
  );
});

test('workflow is manual, read-only and contains no release publishing', async () => {
  const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    '..',
  );
  const workflow = await readFile(
    path.join(repositoryRoot, '.github', 'workflows', 'desktop-platform-validation.yml'),
    'utf8',
  );
  assert.match(workflow, /\n {2}workflow_dispatch:\s*\n/);
  assert.doesNotMatch(workflow, /\n {2}push:/);
  assert.doesNotMatch(workflow, /\n {2}pull_request:/);
  assert.match(workflow, /permissions:\s*\n\s+contents: read\s*\n\s+packages: read/);
  assert.doesNotMatch(workflow, /contents: write/);
  assert.doesNotMatch(workflow, /--publish always/);
  const checkoutSteps = workflow.match(
    /uses: actions\/checkout@v4[\s\S]*?(?=\n {6}- name:|\n\S|$)/g,
  ) ?? [];
  assert.equal(checkoutSteps.length, 3);
  for (const step of checkoutSteps) {
    assert.match(step, /persist-credentials: false/);
    assert.doesNotMatch(step, /\n\s+token:/);
  }
  const builderCommands = workflow.match(
    /pnpm exec electron-builder[\s\S]*?(?=\n {6}- name:|\n\S|$)/g,
  ) ?? [];
  assert.equal(builderCommands.length, 2);
  for (const command of builderCommands) {
    assert.match(command, /--publish never/);
  }
  assert.doesNotMatch(
    workflow,
    /softprops\/action-gh-release|gh release|GH_TOKEN|GITHUB_TOKEN|NODE_AUTH_TOKEN|secrets\./,
  );
});
