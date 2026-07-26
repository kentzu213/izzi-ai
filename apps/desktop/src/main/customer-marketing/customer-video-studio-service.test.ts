import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { CustomerVideoStudioService } from './customer-video-studio-service';

const temporaryRoots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'starizzi-video-test-'));
  temporaryRoots.push(root);
  return root;
}

async function createProject(root: string): Promise<string> {
  const projectRoot = path.join(root, 'source-project');
  await fs.mkdir(path.join(projectRoot, 'assets'), { recursive: true });
  await fs.mkdir(path.join(projectRoot, 'compositions', 'frames'), { recursive: true });
  await fs.writeFile(path.join(projectRoot, 'video-workflow.json'), JSON.stringify({
    version: 1,
    title: 'IzziAPI local walkthrough',
    project: { id: 'izziapi-walkthrough', width: 1080, height: 1920, fps: 30, target_duration_s: 45 },
    scenes: [{ id: 'scene-1' }, { id: 'scene-2' }],
    voice: {
      provider: 'f5-tts',
      model_id: 'local-model',
      model_sha256: 'a'.repeat(64),
      model_license: 'CC-BY-NC-SA-4.0',
      license_source: 'https://example.invalid/model-card',
    },
    authorization: {
      commercial_use_allowed: true,
      voice_clone_authorized_by_user: true,
    },
  }, null, 2), 'utf8');
  await fs.writeFile(path.join(projectRoot, 'hyperframes.json'), JSON.stringify({ version: 1 }), 'utf8');
  await fs.writeFile(path.join(projectRoot, 'index.html'), '<main>IzziAPI</main>', 'utf8');
  await fs.writeFile(path.join(projectRoot, 'assets', 'logo.txt'), 'izziapi', 'utf8');
  await fs.writeFile(path.join(projectRoot, 'compositions', 'frames', '01.html'), '<section>Frame 1</section>', 'utf8');
  return projectRoot;
}

async function createReadyAppRuntime(root: string): Promise<string> {
  const appRoot = path.join(root, 'app');
  const hyperframesRoot = path.join(appRoot, 'node_modules', 'hyperframes');
  await fs.mkdir(path.join(hyperframesRoot, 'dist'), { recursive: true });
  await fs.writeFile(path.join(hyperframesRoot, 'package.json'), JSON.stringify({
    version: '0.7.57',
    bin: { hyperframes: 'dist/cli.js' },
  }), 'utf8');
  await fs.writeFile(path.join(hyperframesRoot, 'dist', 'cli.js'), '', 'utf8');
  return appRoot;
}

function stubF5Config(license: string, modelId: string): void {
  vi.stubEnv('STARIZZI_F5_TTS_URL', 'http://127.0.0.1:8765');
  vi.stubEnv('STARIZZI_F5_TTS_PROVIDER', 'F5-TTS');
  vi.stubEnv('STARIZZI_F5_TTS_MODEL_ID', modelId);
  vi.stubEnv('STARIZZI_F5_TTS_MODEL_SHA256', 'c'.repeat(64));
  vi.stubEnv('STARIZZI_F5_TTS_MODEL_LICENSE', license);
  vi.stubEnv('STARIZZI_F5_TTS_LICENSE_SOURCE', 'https://example.invalid/verified-model-card');
  vi.stubEnv('STARIZZI_F5_TTS_COMMERCIAL_USE_ALLOWED', 'true');
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

describe('CustomerVideoStudioService F5-TTS capability boundary', () => {
  it('reports an installed offline runtime without exposing its local path or enabling commercial render', async () => {
    const root = await makeRoot();
    const privatePath = 'C:\\Users\\customer\\private-f5-runtime';
    const service = new CustomerVideoStudioService({
      rootPath: path.join(root, 'runtime'),
      appRoot: path.join(root, 'app'),
      getF5TtsStatus: () => ({
        installed: true,
        running: false,
        version: '1.0.0',
        detail: `Installed at ${privatePath}`,
      }),
    });

    const toolchain = await service.getToolchain();

    expect(toolchain.f5Tts).toEqual(expect.objectContaining({
      status: 'needs_setup',
      version: '1.0.0',
    }));
    expect(toolchain.f5Tts.detail).toContain('chưa chạy');
    expect(JSON.stringify(toolchain)).not.toContain(privatePath);
    expect(toolchain.commercialRenderAvailable).toBe(false);
  });

  it('keeps the running ViVoice noncommercial model available locally but blocked for commercial render', async () => {
    const root = await makeRoot();
    const verifier = vi.fn(() => true);
    stubF5Config('CC-BY-NC-SA-4.0', 'hynt/F5-TTS-Vietnamese-ViVoice');
    const service = new CustomerVideoStudioService({
      rootPath: path.join(root, 'runtime'),
      appRoot: path.join(root, 'app'),
      getF5TtsStatus: () => ({
        installed: true,
        running: true,
        version: '1.0.0',
      }),
      verifyCommercialVoiceLicense: verifier,
    });

    const toolchain = await service.getToolchain();

    expect(toolchain.f5Tts.status).toBe('ready');
    expect(toolchain.f5Tts.detail).toContain('phi thương mại');
    expect(toolchain.commercialRenderAvailable).toBe(false);
    expect(verifier).not.toHaveBeenCalled();
  });

  it('requires complete permissive evidence and a positive verifier before enabling commercial render', async () => {
    const root = await makeRoot();
    const appRoot = await createReadyAppRuntime(root);
    const runtimeStatus = {
      installed: true,
      running: true,
      version: '1.0.0',
    } as const;
    stubF5Config('Apache-2.0', 'verified-commercial-model');
    vi.stubEnv('STARIZZI_HYPERFRAMES_NODE', process.execPath);
    vi.stubEnv('STARIZZI_FFMPEG_BIN', process.execPath);
    vi.stubEnv('STARIZZI_FFPROBE_BIN', process.execPath);

    const unverified = new CustomerVideoStudioService({
      rootPath: path.join(root, 'runtime-unverified'),
      appRoot,
      getF5TtsStatus: () => runtimeStatus,
    });
    expect((await unverified.getToolchain()).commercialRenderAvailable).toBe(false);

    const verifier = vi.fn(() => true);
    const verified = new CustomerVideoStudioService({
      rootPath: path.join(root, 'runtime-verified'),
      appRoot,
      getF5TtsStatus: () => runtimeStatus,
      verifyCommercialVoiceLicense: verifier,
    });
    const toolchain = await verified.getToolchain();

    expect(toolchain.f5Tts.status).toBe('ready');
    expect(toolchain.commercialRenderAvailable).toBe(true);
    expect(verifier).toHaveBeenCalledWith({
      provider: 'F5-TTS',
      modelId: 'verified-commercial-model',
      modelHash: 'c'.repeat(64),
      license: 'Apache-2.0',
      licenseSource: 'https://example.invalid/verified-model-card',
    });
  });
});

describe('CustomerVideoStudioService import boundary', () => {
  it('copies only the project surface into a tenant root and returns no source path', async () => {
    const root = await makeRoot();
    const source = await createProject(root);
    const runtimeRoot = path.join(root, 'runtime');
    const service = new CustomerVideoStudioService({
      rootPath: runtimeRoot,
      appRoot: path.join(root, 'app'),
      verifyCommercialVoiceLicense: () => false,
    });

    const imported = await service.importProject('customer-abcdef123456', source);
    const storedRoot = path.join(runtimeRoot, 'customer-abcdef123456', 'projects', imported.runtimeProjectId);

    expect(imported).toEqual(expect.objectContaining({
      projectId: 'izziapi-walkthrough',
      width: 1080,
      height: 1920,
      sceneCount: 2,
    }));
    expect(imported.evidenceDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(imported.voice.commercialUseAllowed).toBe(false);
    expect(imported.voice.referenceVoiceConsent).toBe(true);
    expect(JSON.stringify(imported)).not.toContain(source);
    await expect(fs.stat(path.join(storedRoot, 'video-workflow.json'))).resolves.toEqual(expect.objectContaining({ size: expect.any(Number) }));
    await expect(fs.stat(path.join(storedRoot, 'compositions', 'frames', '01.html'))).resolves.toEqual(expect.objectContaining({ size: expect.any(Number) }));
  });

  it('binds evidence to every copied project file', async () => {
    const root = await makeRoot();
    const source = await createProject(root);
    const service = new CustomerVideoStudioService({
      rootPath: path.join(root, 'runtime'),
      appRoot: path.join(root, 'app'),
    });

    const first = await service.importProject('customer-abcdef123456', source);
    await fs.writeFile(path.join(source, 'assets', 'logo.txt'), 'changed', 'utf8');
    const second = await service.importProject('customer-abcdef123456', source);

    expect(first.evidenceDigest).not.toBe(second.evidenceDigest);
  });

  it('rejects secret files nested in copied project directories', async () => {
    const root = await makeRoot();
    const source = await createProject(root);
    await fs.writeFile(path.join(source, 'assets', '.env'), 'API_KEY=secret', 'utf8');
    const service = new CustomerVideoStudioService({
      rootPath: path.join(root, 'runtime'),
      appRoot: path.join(root, 'app'),
    });

    await expect(service.importProject('customer-abcdef123456', source)).rejects.toThrow('file môi trường');
  });

  it('rejects renderer-controlled workspace identifiers', async () => {
    const root = await makeRoot();
    const source = await createProject(root);
    const service = new CustomerVideoStudioService({
      rootPath: path.join(root, 'runtime'),
      appRoot: path.join(root, 'app'),
    });

    await expect(service.importProject('../other-tenant', source)).rejects.toThrow('workspace ID');
  });
});
