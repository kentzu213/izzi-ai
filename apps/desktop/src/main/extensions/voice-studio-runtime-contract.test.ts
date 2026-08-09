import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateManifest } from './ocx-manifest';
import { buildManagedComposeProcessEnv } from './local-service-manager';

const root = fileURLToPath(new URL('../../../../../extensions/voice-studio/', import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const clientPath = path.join(root, 'dist/index.js');
const client = readFileSync(clientPath, 'utf8');
const requireClient = createRequire(import.meta.url);
const backend = readFileSync(path.join(root, 'service/backend/app.py'), 'utf8');
const audioValidation = readFileSync(path.join(root, 'service/backend/audio_validation.py'), 'utf8');
const modelRuntime = readFileSync(path.join(root, 'service/backend/model_runtime.py'), 'utf8');
const dependencyCompat = readFileSync(path.join(root, 'service/backend/vieneu_dependency_compat.py'), 'utf8');
const dockerfile = readFileSync(path.join(root, 'service/backend/Dockerfile'), 'utf8');
const requirements = readFileSync(path.join(root, 'service/backend/requirements.txt'), 'utf8');
const requirementsLock = readFileSync(path.join(root, 'service/backend/requirements.lock'), 'utf8');
const dockerignore = readFileSync(path.join(root, 'service/backend/.dockerignore'), 'utf8');
const composePath = path.join(root, 'service/docker-compose.izzi.yml');
const compose = readFileSync(composePath, 'utf8');
const publishWorkflow = readFileSync(path.resolve(root, '../../.github/workflows/publish-voice-image.yml'), 'utf8');
const beforePack = readFileSync(path.resolve(root, '../../apps/desktop/scripts/before-pack.cjs'), 'utf8');
const desktopMain = readFileSync(path.resolve(root, '../../apps/desktop/src/main/index.ts'), 'utf8');
const pinnedImage = 'ghcr.io/kentzu213/izzi-voice-tts@sha256:b3201f4e98a920d21e86e6c674335acb677c1b91c7b858b706fab632ab180441';

function loadVoiceClient(): any {
  const resolved = requireClient.resolve(clientPath);
  delete requireClient.cache[resolved];
  return requireClient(resolved);
}

function pcmWavBase64(): string {
  const wav = Buffer.alloc(46);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(38, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(48_000, 24);
  wav.writeUInt32LE(96_000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(2, 40);
  return wav.toString('base64');
}

const dockerComposeAvailable = spawnSync(
  'docker',
  ['compose', 'version'],
  { encoding: 'utf8', windowsHide: true },
).status === 0;

describe('Voice Studio local runtime contract', () => {
  it('stays local-only, explicit, Customer Marketing capable, and clone-free', () => {
    expect(validateManifest(manifest)).toMatchObject({ valid: true, errors: [] });
    expect(manifest.version).toBe('0.2.0');
    expect(manifest.customerMarketing).toBe(true);
    expect(manifest.customerMarketingCapability.id).toBe('voice-studio-local-preview');
    expect(manifest.activationEvents).not.toContain('onStartup');
    expect(manifest.service).not.toHaveProperty('fallback');
    expect(manifest.service.readyContract).toMatchObject({
      sdk_version: '3.2.3',
      model_revision: '75ff82a72f54d55ed389e1eeb12041d3c4bac7d4',
      codec_revision: 'ceff0d0749bfb3fa2d61149794ec6feef0d1e1ae',
    });
    expect(manifest.description).toMatch(/không hỗ trợ clone giọng/i);
    expect(manifest.tags).not.toContain('voice-clone');
    expect(manifest.contributes.settings).toEqual([]);
  });

  it('requires an injected loopback URL and a strict request/response payload', () => {
    expect(client).not.toContain('refAudioB64');
    expect(client).not.toContain('ref_audio_b64');
    expect(client).not.toContain('DEFAULT_BACKEND');
    expect(client).not.toContain('http://127.0.0.1:5111');
    expect(client).toContain('LOOPBACK_BACKEND_PATTERN');
    expect(client).toContain('MAX_TEXT_LENGTH = 500');
    expect(client).toContain('managed-backend-not-injected');
    expect(client).toContain("keys[0] !== 'text' || keys[1] !== 'voice'");
    expect(client).toContain('validVoiceList');
    expect(client).toContain('validPcmWavBase64');
  });

  it('fails closed without host injection and rejects malformed loopback WAV data', async () => {
    const noInjection = loadVoiceClient();
    let fetchCalls = 0;
    noInjection.activate({
      storage: { get: async () => null },
      net: { fetch: async () => { fetchCalls += 1; throw new Error('unexpected'); } },
      log: {},
    });
    expect(await noInjection.commands['voice-studio.tts']({ text: 'Xin chao', voice: 'truc-ly' }))
      .toEqual({ ok: false, error: 'managed-backend-not-injected' });
    expect(fetchCalls).toBe(0);
    noInjection.deactivate();

    const malformed = Buffer.alloc(44);
    malformed.write('RIFF', 0, 'ascii');
    malformed.writeUInt32LE(36, 4);
    malformed.write('WAVE', 8, 'ascii');
    const badResponse = loadVoiceClient();
    badResponse.activate({
      storage: { get: async () => 'http://127.0.0.1:55111' },
      net: {
        fetch: async () => ({
          status: 200,
          body: JSON.stringify({ ok: true, format: 'wav', audio_b64: malformed.toString('base64') }),
        }),
      },
      log: {},
    });
    expect(await badResponse.commands['voice-studio.tts']({ text: 'Xin chao', voice: 'truc-ly' }))
      .toEqual({ ok: false, error: 'tts failed' });
    badResponse.deactivate();
  });

  it('rejects malformed, oversized, duplicate, and field-expanded voice lists', async () => {
    const invalidPayloads = [
      null,
      { voices: 'truc-ly' },
      { voices: [] },
      { voices: Array.from({ length: 17 }, (_value, index) => `voice-${index}`) },
      { voices: ['truc-ly', 'truc-ly'] },
      { voices: ['truc-ly'], extra: true },
    ];
    for (const payload of invalidPayloads) {
      const extension = loadVoiceClient();
      extension.activate({
        storage: { get: async () => 'http://127.0.0.1:55111' },
        net: { fetch: async () => ({ status: 200, body: JSON.stringify(payload) }) },
        log: {},
      });
      expect(await extension.commands['voice-studio.listVoices']())
        .toEqual({ ok: false, error: 'invalid-voice-list' });
      extension.deactivate();
    }
  });

  it('accepts a bounded unique voice list', async () => {
    const extension = loadVoiceClient();
    extension.activate({
      storage: { get: async () => 'http://127.0.0.1:55111' },
      net: {
        fetch: async () => ({
          status: 200,
          body: JSON.stringify({ voices: ['pham-tuyen', 'truc-ly'] }),
        }),
      },
      log: {},
    });
    expect(await extension.commands['voice-studio.listVoices']())
      .toEqual({ ok: true, voices: ['pham-tuyen', 'truc-ly'] });
    extension.deactivate();
  });

  it('accepts a canonical bounded PCM16 mono 48 kHz WAV response', async () => {
    const extension = loadVoiceClient();
    const audioB64 = pcmWavBase64();
    extension.activate({
      storage: { get: async () => 'http://127.0.0.1:55111' },
      net: {
        fetch: async () => ({
          status: 200,
          body: JSON.stringify({ ok: true, format: 'wav', audio_b64: audioB64 }),
        }),
      },
      log: {},
    });
    expect(await extension.commands['voice-studio.tts']({ text: 'Xin chao', voice: 'truc-ly' }))
      .toEqual({ ok: true, format: 'wav', audioB64 });
    extension.deactivate();
  });

  it('pins provenance and bounds dependencies, input, output, retries, and concurrency', () => {
    expect(dockerfile).toMatch(/^FROM python:3\.11-slim@sha256:[a-f0-9]{64} AS runtime$/m);
    expect(dockerfile).toContain('--only-binary=:all: --require-hashes --no-deps -r requirements.lock');
    expect(dockerfile).toContain('python vieneu_dependency_compat.py');
    expect(dockerfile).toContain('python -m pip check');
    expect(dockerfile).toContain('python -m pip uninstall --yes pip setuptools');
    expect(dockerfile).toContain('io.izzi.voice.watermark="disabled"');
    expect(dockerfile).toContain('COPY app.py audio_validation.py model_runtime.py ./');
    expect(dockerfile).toContain('touch /tmp/izzi-voice-tests-passed');
    expect(dockerignore).toContain('__pycache__/');
    expect(publishWorkflow).toContain('Checkout source without submodules');
    expect(publishWorkflow).not.toContain('actions/checkout@');
    expect(publishWorkflow).toContain('BACKEND_TREE_SHA256=${{ steps.image_metadata.outputs.backend_tree_sha256 }}');
    expect(publishWorkflow).toContain('provenance: mode=max');
    expect(publishWorkflow).toContain('sbom: true');
    expect(publishWorkflow).toContain('actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8');
    expect(requirements).toContain('vieneu==3.2.3');
    expect(requirements).toContain('fastapi==0.139.0');
    expect(requirements).toContain('uvicorn[standard]==0.51.0');
    expect(requirementsLock).toContain('vieneu==3.2.3');
    expect(requirementsLock).not.toMatch(/^perth==/m);
    expect(dependencyCompat).toContain('Requires-Dist: perth>=0.2.0');
    expect(dependencyCompat).toContain('unexpected_perth_module');
    expect((requirementsLock.match(/--hash=sha256:/g) || []).length).toBeGreaterThan(50);
    const lockedRequirementLines = requirementsLock
      .split(/\r?\n/)
      .filter((line) => /^[a-zA-Z0-9_.-]+/.test(line));
    expect(lockedRequirementLines.length).toBeGreaterThan(30);
    expect(lockedRequirementLines.every((line) => line.charCodeAt(line.length - 1) === 92)).toBe(true);
    expect(backend).not.toContain('ref_audio_b64');
    expect(backend).not.toContain('tempfile.mktemp');
    expect(backend).toContain('MAX_TEXT_LENGTH = 500');
    expect(backend).toContain('MODEL_LOAD_RETRY_DELAYS = (0, 5, 20, 40) + (60,) * 8');
    expect(backend).toContain('threading.BoundedSemaphore(1)');
    expect(backend).toContain('apply_watermark=False');
    expect(audioValidation).toContain('MAX_AUDIO_BYTES = 8 * 1024 * 1024');
    expect(modelRuntime).toContain('PINNED_SDK_VERSION = "3.2.3"');
    expect(modelRuntime).toContain('kwargs["revision"] = revision');
  });

  it('fails the desktop package when the required current OCX cannot be generated', () => {
    expect(desktopMain).toContain("'ext-voice-studio': 'voice-studio-0.2.0.ocx'");
    expect(beforePack).toContain("REQUIRED_BUNDLED_EXTENSIONS = new Set(['voice-studio'])");
    expect(beforePack).toContain('Failed to pack required extension');
    expect(beforePack).toContain("'--exclude=__pycache__'");
    expect(beforePack).not.toContain('could not pack bundled extensions (falling back');
  });

  it('pins the hardened image and literal loopback bind', () => {
    expect(compose).toContain(`image: ${pinnedImage}`);
    expect(compose).toContain("'127.0.0.1:${IZZI_PORT_API:-5111}:5111'");
    expect(compose).not.toContain('VOICE_TTS_IMAGE');
    expect(compose).not.toContain('IZZI_BIND');
  });

  it.runIf(dockerComposeAvailable)(
    'ignores adversarial inherited image, bind, port, and Compose overrides',
    () => {
      const temp = mkdtempSync(path.join(tmpdir(), 'izzi-voice-compose-'));
      const envFile = path.join(temp, '.env');
      writeFileSync(envFile, 'IZZI_PORT_API=55111\n', 'utf8');
      try {
        const composeEnv = buildManagedComposeProcessEnv(
          {
            ...process.env,
            VOICE_TTS_IMAGE: 'example.invalid/adversarial/voice:latest',
            IZZI_BIND: '0.0.0.0',
            IZZI_PORT_API: '59999',
            COMPOSE_FILE: 'attacker.yml',
            COMPOSE_PROJECT_NAME: 'attacker',
          },
          ['IZZI_BIND', 'IZZI_PORT_API'],
        );
        const result = spawnSync(
          'docker',
          ['compose', '-f', composePath, '--env-file', envFile, 'config', '--format', 'json'],
          { encoding: 'utf8', env: composeEnv, windowsHide: true },
        );
        expect(result.status, result.stderr).toBe(0);
        const resolved = JSON.parse(result.stdout);
        expect(resolved.services.tts.image).toBe(pinnedImage);
        expect(resolved.services.tts.ports).toContainEqual(expect.objectContaining({
          host_ip: '127.0.0.1',
          published: '55111',
          target: 5111,
        }));
      } finally {
        rmSync(temp, { force: true, recursive: true });
      }
    },
  );
});
