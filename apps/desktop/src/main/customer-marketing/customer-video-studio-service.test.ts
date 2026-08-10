import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  CustomerVideoStudioService,
  resolveConfiguredBinaryPath,
  supportsManagedHyperframesPreview,
} from './customer-video-studio-service';

const temporaryRoots: string[] = [];
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const DEFAULT_HYPERFRAMES_CLI = `
if (process.argv[2] === '--version') process.stdout.write('0.7.57\\n');
`;

function pcm16Mono48KhzWav(samples = [0, 1_000, -1_000, 0]): Buffer {
  const dataSize = samples.length * 2;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(wav.length - 8, 4);
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
  wav.writeUInt32LE(dataSize, 40);
  samples.forEach((sample, index) => wav.writeInt16LE(sample, 44 + (index * 2)));
  return wav;
}

function minimalMp4(): Buffer {
  return Buffer.from('000000186674797069736f6d0000020069736f6d69736f32', 'hex');
}

function sha256Hex(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function hyperframesCheckReport(
  passed: boolean,
  errorCount = 0,
  warningCount = 0,
): string {
  return JSON.stringify({
    ok: passed,
    strict: false,
    lint: { ok: errorCount === 0, errorCount, warningCount, infoCount: 0, findings: [] },
    runtime: { ok: true, errorCount: 0, warningCount: 0, infoCount: 0, findings: [] },
    layout: { ok: true, errorCount: 0, warningCount: 0, infoCount: 0, findings: [] },
    motion: { ok: true, errorCount: 0, warningCount: 0, infoCount: 0, findings: [] },
    contrast: { ok: true, errorCount: 0, warningCount: 0, infoCount: 0, findings: [] },
    _meta: { version: '0.7.57' },
  });
}

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
    scenes: [
      { id: 'scene-1', caption_text: 'IzziAPI giúp kết nối API nhanh hơn.' },
      { id: 'scene-2', caption_text: 'Bắt đầu với tài khoản Izzi AI của bạn.' },
    ],
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

async function createReadyAppRuntime(root: string, cliSource = DEFAULT_HYPERFRAMES_CLI): Promise<string> {
  const appRoot = path.join(root, 'app');
  const hyperframesRoot = path.join(appRoot, 'node_modules', 'hyperframes');
  await fs.mkdir(path.join(hyperframesRoot, 'dist'), { recursive: true });
  await fs.writeFile(path.join(hyperframesRoot, 'package.json'), JSON.stringify({
    name: 'hyperframes',
    version: '0.7.57',
    bin: { hyperframes: './dist/cli.js' },
    engines: { node: '>=22' },
    license: 'Apache-2.0',
    type: 'module',
  }), 'utf8');
  await fs.writeFile(path.join(hyperframesRoot, 'dist', 'cli.js'), cliSource, 'utf8');
  const browserPath = path.join(appRoot, 'chrome-headless-shell.exe');
  await fs.writeFile(browserPath, 'browser');
  vi.stubEnv('STARIZZI_HYPERFRAMES_BROWSER', browserPath);
  return appRoot;
}

async function createPackagedAppRuntime(
  root: string,
  cliSource = DEFAULT_HYPERFRAMES_CLI,
): Promise<string> {
  const appRoot = path.join(root, 'app.asar');
  const packageSource = JSON.stringify({
    name: 'hyperframes',
    version: '0.7.57',
    bin: { hyperframes: './dist/cli.js' },
    engines: { node: '>=22' },
    license: 'Apache-2.0',
    type: 'module',
  });
  for (const runtimeRoot of [appRoot, `${appRoot}.unpacked`]) {
    const hyperframesRoot = path.join(runtimeRoot, 'node_modules', 'hyperframes');
    await fs.mkdir(path.join(hyperframesRoot, 'dist'), { recursive: true });
    await fs.writeFile(path.join(hyperframesRoot, 'package.json'), packageSource, 'utf8');
    await fs.writeFile(path.join(hyperframesRoot, 'dist', 'cli.js'), cliSource, 'utf8');
  }
  const browserPath = path.join(root, 'chrome-headless-shell.exe');
  await fs.writeFile(browserPath, 'browser');
  vi.stubEnv('STARIZZI_HYPERFRAMES_BROWSER', browserPath);
  return appRoot;
}

async function createHyperframesAttestation(appRoot: string): Promise<{
  packageSha256: string;
  cliSha256: string;
}> {
  const digest = async (candidate: string): Promise<string> => createHash('sha256')
    .update(await fs.readFile(candidate))
    .digest('hex');
  const hyperframesRoot = path.join(appRoot, 'node_modules', 'hyperframes');
  return {
    packageSha256: await digest(path.join(hyperframesRoot, 'package.json')),
    cliSha256: await digest(path.join(hyperframesRoot, 'dist', 'cli.js')),
  };
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForProcessExit(pid: number): Promise<boolean> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (!processExists(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !processExists(pid);
}

async function waitForFileText(candidate: string): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return await fs.readFile(candidate, 'utf8');
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error('Timed out waiting for test process evidence.');
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

describe('resolveConfiguredBinaryPath', () => {
  it('accepts extensionless executable files and resolves binaries inside dotted directories', async () => {
    const root = await makeRoot();
    const extensionlessFile = path.join(root, 'node-runtime');
    await fs.writeFile(extensionlessFile, '');

    expect(await resolveConfiguredBinaryPath('node', extensionlessFile, 'darwin')).toBe(
      path.resolve(extensionlessFile),
    );

    const dottedDirectory = path.join(root, 'runtime.dir');
    const windowsBinary = path.join(dottedDirectory, 'node.exe');
    await fs.mkdir(dottedDirectory);
    await fs.writeFile(windowsBinary, '');

    expect(await resolveConfiguredBinaryPath('node', dottedDirectory, 'win32')).toBe(
      path.resolve(windowsBinary),
    );
  });
});

describe('CustomerVideoStudioService F5-TTS capability boundary', { timeout: 15_000 }, () => {
  it('refreshes dynamic voice status only when the caller explicitly bypasses the runtime cache', async () => {
    const root = await makeRoot();
    let running = false;
    const getVoiceStudioStatus = vi.fn(async () => ({
      installed: true,
      running,
      version: '0.1.0',
    }));
    const service = new CustomerVideoStudioService({
      rootPath: path.join(root, 'runtime'),
      appRoot: path.join(root, 'app'),
      getVoiceStudioStatus,
    });

    const stopped = await service.getToolchain();
    running = true;
    const cached = await service.getToolchain();
    const refreshed = await service.getToolchain({ refresh: true });

    expect(stopped.voiceStudio.status).toBe('needs_setup');
    expect(cached.voiceStudio.status).toBe('needs_setup');
    expect(refreshed.voiceStudio.status).toBe('ready');
    expect(getVoiceStudioStatus).toHaveBeenCalledTimes(2);
  });

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
      hyperframesAttestation: await createHyperframesAttestation(appRoot),
      getF5TtsStatus: () => runtimeStatus,
    });
    expect((await unverified.getToolchain()).commercialRenderAvailable).toBe(false);

    const verifier = vi.fn(() => true);
    const verified = new CustomerVideoStudioService({
      rootPath: path.join(root, 'runtime-verified'),
      appRoot,
      hyperframesAttestation: await createHyperframesAttestation(appRoot),
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

  it('normalizes declared legacy project ids for an explicit re-import migration', async () => {
    const root = await makeRoot();
    const source = await createProject(root);
    const workflowPath = path.join(source, 'video-workflow.json');
    const workflow = JSON.parse(await fs.readFile(workflowPath, 'utf8'));
    workflow.project.id = 'izziapi-izzi-ai-howto';
    workflow.project.legacy_ids = [
      'izziapi-starizzi-howto',
      'IZZIAPI STARIZZI HOWTO',
      'izziapi-izzi-ai-howto',
    ];
    await fs.writeFile(workflowPath, JSON.stringify(workflow, null, 2), 'utf8');
    const service = new CustomerVideoStudioService({
      rootPath: path.join(root, 'runtime'),
      appRoot: path.join(root, 'app'),
    });

    const imported = await service.importProject('customer-abcdef123456', source);

    expect(imported.legacyProjectIds).toEqual(['izziapi-starizzi-howto']);
  });

  it('rejects legacy project ids that are not approved for the canonical project', async () => {
    const root = await makeRoot();
    const source = await createProject(root);
    const workflowPath = path.join(source, 'video-workflow.json');
    const workflow = JSON.parse(await fs.readFile(workflowPath, 'utf8'));
    workflow.project.id = 'izziapi-izzi-ai-howto';
    workflow.project.legacy_ids = ['unrelated-project'];
    await fs.writeFile(workflowPath, JSON.stringify(workflow, null, 2), 'utf8');
    const runtimeRoot = path.join(root, 'runtime');
    const service = new CustomerVideoStudioService({
      rootPath: runtimeRoot,
      appRoot: path.join(root, 'app'),
    });

    await expect(service.importProject('customer-abcdef123456', source))
      .rejects.toThrow('legacy project ID chưa được Izzi AI cho phép');
    await expect(fs.stat(runtimeRoot)).rejects.toMatchObject({ code: 'ENOENT' });
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

// CMR-007 remains provider-agnostic for an explicitly configured system Node
// runtime. Managed Electron stays preview-only.
describe('CustomerVideoStudioService commercial voice provider boundary', () => {
  const voiceStudioEvidence = {
    installed: true,
    running: true,
    version: '1.0.0',
    provider: 'VieNeu-TTS',
    modelId: 'pnnbao-ump/VieNeu-TTS-v3-Turbo@9f2c1ab7d4e35608',
    modelHash: 'd'.repeat(64),
    license: 'Apache-2.0',
    licenseSource: 'https://huggingface.co/pnnbao-ump/VieNeu-TTS-v3-Turbo',
    commercialUseAllowed: true,
  } as const;

  async function readyRuntime(): Promise<{
    root: string;
    appRoot: string;
    attestation: { packageSha256: string; cliSha256: string };
  }> {
    const root = await makeRoot();
    const appRoot = await createReadyAppRuntime(root);
    vi.stubEnv('STARIZZI_HYPERFRAMES_NODE', process.execPath);
    vi.stubEnv('STARIZZI_FFMPEG_BIN', process.execPath);
    vi.stubEnv('STARIZZI_FFPROBE_BIN', process.execPath);
    return { root, appRoot, attestation: await createHyperframesAttestation(appRoot) };
  }

  it('enables commercial render from Voice Studio evidence alone when the verifier approves', async () => {
    const { root, appRoot, attestation } = await readyRuntime();
    const verifier = vi.fn(() => true);
    const service = new CustomerVideoStudioService({
      rootPath: path.join(root, 'runtime'),
      appRoot,
      hyperframesAttestation: attestation,
      getVoiceStudioStatus: () => voiceStudioEvidence,
      getF5TtsStatus: () => ({ installed: false, running: false }),
      verifyCommercialVoiceLicense: verifier,
    });

    const toolchain = await service.getToolchain();

    expect(toolchain.commercialRenderAvailable).toBe(true);
    expect(toolchain.voiceStudio.status).toBe('ready');
    expect(toolchain.voiceStudio.detail).toContain('đã xác minh');
    expect(toolchain.f5Tts.status).toBe('needs_setup');
    expect(verifier).toHaveBeenCalledWith({
      provider: 'VieNeu-TTS',
      modelId: 'pnnbao-ump/VieNeu-TTS-v3-Turbo@9f2c1ab7d4e35608',
      modelHash: 'd'.repeat(64),
      license: 'Apache-2.0',
      licenseSource: 'https://huggingface.co/pnnbao-ump/VieNeu-TTS-v3-Turbo',
    });
  });

  it('keeps the gate closed when Voice Studio serves a non-commercial model', async () => {
    const { root, appRoot, attestation } = await readyRuntime();
    const verifier = vi.fn(() => true);
    const service = new CustomerVideoStudioService({
      rootPath: path.join(root, 'runtime'),
      appRoot,
      hyperframesAttestation: attestation,
      getVoiceStudioStatus: () => ({ ...voiceStudioEvidence, license: 'CC-BY-NC-SA-4.0' }),
      getF5TtsStatus: () => ({ installed: false, running: false }),
      verifyCommercialVoiceLicense: verifier,
    });

    const toolchain = await service.getToolchain();

    expect(toolchain.commercialRenderAvailable).toBe(false);
    expect(toolchain.voiceStudio.status).toBe('ready');
    expect(verifier).not.toHaveBeenCalled();
  });

  it('keeps the gate closed without declared intent, complete evidence, or a verifier', async () => {
    const { root, appRoot, attestation } = await readyRuntime();

    const undeclared = new CustomerVideoStudioService({
      rootPath: path.join(root, 'runtime-undeclared'),
      appRoot,
      hyperframesAttestation: attestation,
      getVoiceStudioStatus: () => ({ ...voiceStudioEvidence, commercialUseAllowed: false }),
      getF5TtsStatus: () => ({ installed: false, running: false }),
      verifyCommercialVoiceLicense: () => true,
    });
    expect((await undeclared.getToolchain()).commercialRenderAvailable).toBe(false);

    const incomplete = new CustomerVideoStudioService({
      rootPath: path.join(root, 'runtime-incomplete'),
      appRoot,
      hyperframesAttestation: attestation,
      getVoiceStudioStatus: () => ({ ...voiceStudioEvidence, modelHash: undefined }),
      getF5TtsStatus: () => ({ installed: false, running: false }),
      verifyCommercialVoiceLicense: () => true,
    });
    expect((await incomplete.getToolchain()).commercialRenderAvailable).toBe(false);

    const unverified = new CustomerVideoStudioService({
      rootPath: path.join(root, 'runtime-unverified'),
      appRoot,
      hyperframesAttestation: attestation,
      getVoiceStudioStatus: () => voiceStudioEvidence,
      getF5TtsStatus: () => ({ installed: false, running: false }),
    });
    expect((await unverified.getToolchain()).commercialRenderAvailable).toBe(false);
  });

  it('fails closed when the asynchronous readiness lookup rejects', async () => {
    const { root, appRoot, attestation } = await readyRuntime();
    const service = new CustomerVideoStudioService({
      rootPath: path.join(root, 'runtime'),
      appRoot,
      getVoiceStudioStatus: async () => {
        throw new Error('backend unreachable');
      },
      getF5TtsStatus: () => ({ installed: false, running: false }),
    });

    const toolchain = await service.getToolchain();
    expect(toolchain.commercialRenderAvailable).toBe(false);
    expect(toolchain.voiceStudio.status).toBe('needs_setup');
  });

  it('accepts an asynchronous readiness lookup that resolves ready', async () => {
    const { root, appRoot, attestation } = await readyRuntime();
    const service = new CustomerVideoStudioService({
      rootPath: path.join(root, 'runtime'),
      appRoot,
      hyperframesAttestation: attestation,
      getVoiceStudioStatus: async () => voiceStudioEvidence,
      getF5TtsStatus: () => ({ installed: false, running: false }),
      verifyCommercialVoiceLicense: () => true,
    });

    expect((await service.getToolchain()).commercialRenderAvailable).toBe(true);
  });

  it('keeps the gate closed while Voice Studio is installed but not running', async () => {
    const { root, appRoot, attestation } = await readyRuntime();
    const service = new CustomerVideoStudioService({
      rootPath: path.join(root, 'runtime'),
      appRoot,
      hyperframesAttestation: attestation,
      getVoiceStudioStatus: () => ({ ...voiceStudioEvidence, running: false }),
      getF5TtsStatus: () => ({ installed: false, running: false }),
      verifyCommercialVoiceLicense: () => true,
    });

    const toolchain = await service.getToolchain();
    expect(toolchain.commercialRenderAvailable).toBe(false);
    expect(toolchain.voiceStudio.status).toBe('needs_setup');
  });
});

describe('CustomerVideoStudioService Voice Studio preview boundary', () => {
  it('creates one tenant-owned PCM WAV artifact for every approved scene caption', async () => {
    const root = await makeRoot();
    const source = await createProject(root);
    const wav = pcm16Mono48KhzWav();
    const synthesizeVoiceStudio = vi.fn(async () => ({
      ok: true,
      format: 'wav',
      audioB64: wav.toString('base64'),
    }));
    const runtimeRoot = path.join(root, 'runtime');
    const service = new CustomerVideoStudioService({
      rootPath: runtimeRoot,
      appRoot: path.join(root, 'app'),
      synthesizeVoiceStudio,
      getVoiceStudioStatus: async () => ({
        installed: true,
        running: true,
        version: '0.2.0',
      }),
    });
    const imported = await service.importProject('customer-abcdef123456', source);

    const result = await service.createVoicePreview(
      'customer-abcdef123456',
      imported.runtimeProjectId,
      imported.evidenceDigest,
    );

    expect(synthesizeVoiceStudio).toHaveBeenNthCalledWith(1, {
      text: 'IzziAPI giúp kết nối API nhanh hơn.',
      voice: 'pham-tuyen',
    });
    expect(synthesizeVoiceStudio).toHaveBeenNthCalledWith(2, {
      text: 'Bắt đầu với tài khoản Izzi AI của bạn.',
      voice: 'pham-tuyen',
    });
    expect(result.receipt).toEqual(expect.objectContaining({
      runId: expect.stringMatching(/^\d{8}T\d{6}Z-[a-f0-9]{16}$/),
      provider: 'voice-studio',
      voiceId: 'pham-tuyen',
      clipCount: 2,
      totalBytes: wav.byteLength * 2,
      commercialUseAllowed: false,
    }));
    expect(result.artifacts).toEqual([
      expect.objectContaining({ kind: 'voice_preview', name: 'voice-preview/voice-01.wav' }),
      expect.objectContaining({ kind: 'voice_preview', name: 'voice-preview/voice-02.wav' }),
    ]);

    const projectRunsRoot = path.join(
      runtimeRoot,
      'customer-abcdef123456',
      'preview-runs',
      imported.runtimeProjectId,
    );
    const runIds = await fs.readdir(projectRunsRoot);
    expect(runIds).toHaveLength(1);
    const voiceRoot = path.join(projectRunsRoot, runIds[0], 'voice-preview');
    expect(await fs.readdir(voiceRoot)).toEqual(['voice-01.wav', 'voice-02.wav']);
    expect(await fs.readFile(path.join(voiceRoot, 'voice-01.wav'))).toEqual(wav);
  });

  it('rejects malformed audio and removes every partial clip from the failed run', async () => {
    const root = await makeRoot();
    const source = await createProject(root);
    const wav = pcm16Mono48KhzWav();
    const synthesizeVoiceStudio = vi.fn()
      .mockResolvedValueOnce({ ok: true, format: 'wav', audioB64: wav.toString('base64') })
      .mockResolvedValueOnce({ ok: true, format: 'wav', audioB64: Buffer.alloc(44).toString('base64') });
    const runtimeRoot = path.join(root, 'runtime');
    const service = new CustomerVideoStudioService({
      rootPath: runtimeRoot,
      appRoot: path.join(root, 'app'),
      synthesizeVoiceStudio,
    });
    const imported = await service.importProject('customer-abcdef123456', source);

    await expect(service.createVoicePreview(
      'customer-abcdef123456',
      imported.runtimeProjectId,
      imported.evidenceDigest,
    )).rejects.toThrow('WAV không hợp lệ');

    expect(synthesizeVoiceStudio).toHaveBeenCalledTimes(2);
    expect(await fs.readdir(path.join(
      runtimeRoot,
      'customer-abcdef123456',
      'preview-runs',
      imported.runtimeProjectId,
    ))).toEqual([]);
  });

  it('rejects oversized base64 before decoding it into the Electron main process', async () => {
    const root = await makeRoot();
    const source = await createProject(root);
    const encodedLimit = 4 * Math.ceil((8 * 1_024 * 1_024) / 3);
    const synthesizeVoiceStudio = vi.fn(async () => ({
      ok: true,
      format: 'wav',
      audioB64: 'A'.repeat(encodedLimit + 4),
    }));
    const service = new CustomerVideoStudioService({
      rootPath: path.join(root, 'runtime'),
      appRoot: path.join(root, 'app'),
      synthesizeVoiceStudio,
    });
    const imported = await service.importProject('customer-abcdef123456', source);

    await expect(service.createVoicePreview(
      'customer-abcdef123456',
      imported.runtimeProjectId,
      imported.evidenceDigest,
    )).rejects.toThrow('payload audio không hợp lệ');
  });

  it('rejects stale project evidence before sending any caption to Voice Studio', async () => {
    const root = await makeRoot();
    const source = await createProject(root);
    const synthesizeVoiceStudio = vi.fn();
    const service = new CustomerVideoStudioService({
      rootPath: path.join(root, 'runtime'),
      appRoot: path.join(root, 'app'),
      synthesizeVoiceStudio,
    });
    const imported = await service.importProject('customer-abcdef123456', source);

    await expect(service.createVoicePreview(
      'customer-abcdef123456',
      imported.runtimeProjectId,
      'f'.repeat(64),
    )).rejects.toThrow('đã thay đổi sau approval');
    expect(synthesizeVoiceStudio).not.toHaveBeenCalled();
  });
});

describe('CustomerVideoStudioService local video preview boundary', () => {
  interface VideoPreviewInternals {
    inspectRuntime: () => Promise<unknown>;
    runHyperframesRender: (...args: unknown[]) => Promise<unknown>;
    runFfmpegMux: (...args: unknown[]) => Promise<unknown>;
    probeVideoPreview: (...args: unknown[]) => Promise<unknown>;
  }

  async function videoPreviewHarness() {
    const root = await makeRoot();
    const source = await createProject(root);
    const runtimeRoot = path.join(root, 'runtime');
    const scratchRoot = path.join(root, 'scratch');
    await fs.mkdir(scratchRoot, { recursive: true });
    const wav = pcm16Mono48KhzWav();
    const openLocalFile = vi.fn(async () => '');
    const service = new CustomerVideoStudioService({
      rootPath: runtimeRoot,
      runtimeScratchParent: scratchRoot,
      appRoot: path.join(root, 'app'),
      synthesizeVoiceStudio: async () => ({
        ok: true,
        format: 'wav',
        audioB64: wav.toString('base64'),
      }),
      openLocalFile,
    });
    const imported = await service.importProject('customer-abcdef123456', source);
    const voice = await service.createVoicePreview(
      'customer-abcdef123456',
      imported.runtimeProjectId,
      imported.evidenceDigest,
    );
    const voiceArtifacts = voice.artifacts.map((artifact) => ({
      name: artifact.name,
      sha256: artifact.sha256 || '',
    }));
    const internals = service as unknown as VideoPreviewInternals;
    const inspectRuntime = vi.spyOn(internals, 'inspectRuntime').mockResolvedValue({
      toolchain: {},
      hyperframesRuntime: {
        executablePath: process.execPath,
        cliPath: path.join(root, 'hyperframes-cli.js'),
        source: 'system_node',
        nodeVersion: process.version,
        browserPath: process.execPath,
        commercialEligible: false,
      },
      videoRenderRuntime: {
        executablePath: process.execPath,
        cliPath: path.join(root, 'hyperframes-cli.js'),
        source: 'system_node',
        nodeVersion: process.version,
        browserPath: process.execPath,
        commercialEligible: false,
      },
      ffmpegPath: process.execPath,
      ffprobePath: process.execPath,
      ffmpegDirectory: path.dirname(process.execPath),
    });
    const render = vi.spyOn(internals, 'runHyperframesRender').mockImplementation(async (...args) => {
      await fs.writeFile(String(args[2]), minimalMp4());
      return { stdout: '', stderr: '' };
    });
    const mux = vi.spyOn(internals, 'runFfmpegMux').mockImplementation(async (...args) => {
      await fs.writeFile(String(args[3]), minimalMp4());
      return { stdout: '', stderr: '' };
    });
    const probe = vi.spyOn(internals, 'probeVideoPreview').mockResolvedValue({
      width: 1080,
      height: 1920,
      fps: 30,
      durationSeconds: 45,
      audioSampleRate: 48_000,
      audioChannels: 1,
    });
    const runsRoot = path.join(
      runtimeRoot,
      'customer-abcdef123456',
      'preview-runs',
      imported.runtimeProjectId,
    );
    return {
      root,
      runtimeRoot,
      scratchRoot,
      service,
      imported,
      voiceRunId: voice.receipt.runId,
      voiceGeneratedAt: voice.receipt.generatedAt,
      voiceArtifacts,
      runsRoot,
      inspectRuntime,
      render,
      mux,
      probe,
      openLocalFile,
    };
  }

  it('resolves a legacy voice receipt past 25 newer runs and retains one verified local MP4', async () => {
    const harness = await videoPreviewHarness();
    for (let index = 0; index < 25; index += 1) {
      await fs.mkdir(path.join(
        harness.runsRoot,
        `99991231T2359${String(index).padStart(2, '0')}Z-${index.toString(16).padStart(16, '0')}`,
      ));
    }

    const result = await harness.service.createVideoPreview(
      'customer-abcdef123456',
      harness.imported.runtimeProjectId,
      harness.imported.evidenceDigest,
      undefined,
      harness.voiceGeneratedAt,
      harness.voiceArtifacts,
    );

    expect(result.receipt).toEqual(expect.objectContaining({
      runId: expect.stringMatching(/^\d{8}T\d{6}Z-[a-f0-9]{16}$/),
      provider: 'hyperframes+voice-studio',
      voiceId: 'pham-tuyen',
      clipCount: 2,
      fileName: 'video-preview/video-preview.mp4',
      width: 1080,
      height: 1920,
      fps: 30,
      durationSeconds: 45,
      audioSampleRate: 48_000,
      audioChannels: 1,
      totalBytes: minimalMp4().byteLength,
      commercialUseAllowed: false,
    }));
    expect(result.artifacts).toEqual([
      expect.objectContaining({
        kind: 'video_preview',
        name: 'video-preview/video-preview.mp4',
        sha256: sha256Hex(minimalMp4()),
        sizeBytes: minimalMp4().byteLength,
      }),
    ]);
    expect(harness.render).toHaveBeenCalledTimes(1);
    expect(harness.mux).toHaveBeenCalledTimes(1);
    expect(harness.probe).toHaveBeenCalledTimes(1);
    const renderOutput = String(harness.render.mock.calls[0][2]);
    expect(renderOutput).toContain(`${path.sep}izzi-ai-hf-`);
    expect(renderOutput).not.toContain(`${path.sep}preview-runs${path.sep}`);
    const muxCall = harness.mux.mock.calls[0];
    const muxOutput = String(muxCall[3]);
    expect(muxOutput).toContain(`${path.sep}izzi-ai-hf-`);
    expect(muxOutput).not.toContain(`${path.sep}preview-runs${path.sep}`);
    expect(muxCall[2]).toEqual([
      expect.stringMatching(/voice-01\.wav$/),
      expect.stringMatching(/voice-02\.wav$/),
    ]);
    expect(muxCall[4]).toBe(45);
    expect(JSON.stringify(harness.render.mock.calls)).not.toContain('publish');

    const runIds = await fs.readdir(harness.runsRoot);
    const videoFiles = await Promise.all(runIds.map(async (runId) => {
      const candidate = path.join(harness.runsRoot, runId, 'video-preview', 'video-preview.mp4');
      try {
        return await fs.readFile(candidate);
      } catch {
        return null;
      }
    }));
    expect(videoFiles.filter(Boolean)).toEqual([minimalMp4()]);
    expect(await fs.readdir(harness.scratchRoot)).toEqual([]);

    await harness.service.openVideoPreview(
      'customer-abcdef123456',
      harness.imported.runtimeProjectId,
      harness.imported.evidenceDigest,
      result.receipt.runId,
      result.receipt.generatedAt,
      result.artifacts[0],
    );
    expect(harness.openLocalFile).toHaveBeenCalledWith(expect.stringMatching(/video-preview\.mp4$/));
  });

  it('refuses to open a video whose bytes no longer match the stored artifact', async () => {
    const harness = await videoPreviewHarness();
    const result = await harness.service.createVideoPreview(
      'customer-abcdef123456',
      harness.imported.runtimeProjectId,
      harness.imported.evidenceDigest,
      harness.voiceRunId,
      harness.voiceGeneratedAt,
      harness.voiceArtifacts,
    );
    const runIds = await fs.readdir(harness.runsRoot);
    for (const runId of runIds) {
      const candidate = path.join(harness.runsRoot, runId, 'video-preview', 'video-preview.mp4');
      try {
        await fs.writeFile(candidate, Buffer.from('tampered-video'));
      } catch {
        // Voice-only runs do not contain a video output.
      }
    }

    await expect(harness.service.openVideoPreview(
      'customer-abcdef123456',
      harness.imported.runtimeProjectId,
      harness.imported.evidenceDigest,
      result.receipt.runId,
      result.receipt.generatedAt,
      result.artifacts[0],
    )).rejects.toThrow('Không tìm thấy local video preview');
    expect(harness.openLocalFile).not.toHaveBeenCalled();
  });

  it('does not expose OS path details when the default video application cannot open', async () => {
    const harness = await videoPreviewHarness();
    const result = await harness.service.createVideoPreview(
      'customer-abcdef123456',
      harness.imported.runtimeProjectId,
      harness.imported.evidenceDigest,
      harness.voiceRunId,
      harness.voiceGeneratedAt,
      harness.voiceArtifacts,
    );
    harness.openLocalFile.mockResolvedValueOnce('C:\\private\\video.mp4 access denied');

    await expect(harness.service.openVideoPreview(
      'customer-abcdef123456',
      harness.imported.runtimeProjectId,
      harness.imported.evidenceDigest,
      result.receipt.runId,
      result.receipt.generatedAt,
      result.artifacts[0],
    )).rejects.toThrow('Không thể mở local video preview bằng ứng dụng mặc định.');
  });

  it('rejects mismatched hashes and malformed WAV evidence before runtime execution', async () => {
    const mismatched = await videoPreviewHarness();
    await expect(mismatched.service.createVideoPreview(
      'customer-abcdef123456',
      mismatched.imported.runtimeProjectId,
      mismatched.imported.evidenceDigest,
      mismatched.voiceRunId,
      mismatched.voiceGeneratedAt,
      mismatched.voiceArtifacts.map((artifact, index) => (
        index === 0 ? { ...artifact, sha256: 'f'.repeat(64) } : artifact
      )),
    )).rejects.toThrow('Không tìm thấy bộ voice preview');
    expect(mismatched.inspectRuntime).not.toHaveBeenCalled();

    const malformed = await videoPreviewHarness();
    const [voiceRun] = await fs.readdir(malformed.runsRoot);
    const firstVoice = path.join(malformed.runsRoot, voiceRun, 'voice-preview', 'voice-01.wav');
    const invalidWav = Buffer.from('not-a-pcm-wav');
    await fs.writeFile(firstVoice, invalidWav);
    const malformedArtifacts = malformed.voiceArtifacts.map((artifact, index) => (
      index === 0 ? { ...artifact, sha256: sha256Hex(invalidWav) } : artifact
    ));

    await expect(malformed.service.createVideoPreview(
      'customer-abcdef123456',
      malformed.imported.runtimeProjectId,
      malformed.imported.evidenceDigest,
      malformed.voiceRunId,
      malformed.voiceGeneratedAt,
      malformedArtifacts,
    )).rejects.toThrow('WAV không hợp lệ');
    expect(malformed.inspectRuntime).not.toHaveBeenCalled();
  });

  it.each([
    ['HyperFrames browser', { ffmpegPath: process.execPath, ffprobePath: process.execPath }],
    ['FFmpeg', {
      videoRenderRuntime: {
        executablePath: process.execPath,
        cliPath: process.execPath,
        source: 'system_node',
        nodeVersion: process.version,
        browserPath: process.execPath,
        commercialEligible: false,
      },
    }],
  ])('fails closed when %s is unavailable without creating another run', async (_label, runtime) => {
    const harness = await videoPreviewHarness();
    const before = await fs.readdir(harness.runsRoot);
    harness.inspectRuntime.mockResolvedValueOnce({ toolchain: {}, ...runtime });

    await expect(harness.service.createVideoPreview(
      'customer-abcdef123456',
      harness.imported.runtimeProjectId,
      harness.imported.evidenceDigest,
      harness.voiceRunId,
      harness.voiceGeneratedAt,
      harness.voiceArtifacts,
    )).rejects.toThrow('HyperFrames browser, FFmpeg và FFprobe');

    expect(harness.render).not.toHaveBeenCalled();
    expect(await fs.readdir(harness.runsRoot)).toEqual(before);
    expect(await fs.readdir(harness.scratchRoot)).toEqual([]);
  });

  it.each([
    ['malformed', async (candidate: string) => fs.writeFile(candidate, Buffer.from('not-an-mp4'))],
    ['oversized', async (candidate: string) => {
      await fs.writeFile(candidate, minimalMp4());
      await fs.truncate(candidate, (100 * 1_024 * 1_024) + 1);
    }],
  ])('removes the entire failed run for a %s MP4 output', async (_label, writeOutput) => {
    const harness = await videoPreviewHarness();
    const before = await fs.readdir(harness.runsRoot);
    harness.mux.mockImplementationOnce(async (...args) => {
      await writeOutput(String(args[3]));
      return { stdout: '', stderr: '' };
    });

    await expect(harness.service.createVideoPreview(
      'customer-abcdef123456',
      harness.imported.runtimeProjectId,
      harness.imported.evidenceDigest,
      harness.voiceRunId,
      harness.voiceGeneratedAt,
      harness.voiceArtifacts,
    )).rejects.toThrow(/MP4 hợp lệ|vượt giới hạn dung lượng/);

    expect(await fs.readdir(harness.runsRoot)).toEqual(before);
    expect(await fs.readdir(harness.scratchRoot)).toEqual([]);
  });

  it('cleans staging and output when render or mux execution fails', async () => {
    const harness = await videoPreviewHarness();
    const before = await fs.readdir(harness.runsRoot);
    harness.mux.mockRejectedValueOnce(new Error('synthetic mux failure'));

    await expect(harness.service.createVideoPreview(
      'customer-abcdef123456',
      harness.imported.runtimeProjectId,
      harness.imported.evidenceDigest,
      harness.voiceRunId,
      harness.voiceGeneratedAt,
      harness.voiceArtifacts,
    )).rejects.toThrow('Local video preview');

    expect(await fs.readdir(harness.runsRoot)).toEqual(before);
    expect(await fs.readdir(harness.scratchRoot)).toEqual([]);
  });
});

describe('CustomerVideoStudioService managed HyperFrames runtime', { timeout: 15_000 }, () => {
  it('allows only the behaviorally attested Electron 34 / Node 20 pair below the upstream Node floor', () => {
    expect(supportsManagedHyperframesPreview('0.7.57', 'v20.19.1', '34.5.8')).toBe(true);
    expect(supportsManagedHyperframesPreview('0.7.58', 'v20.19.1', '34.5.8')).toBe(false);
    expect(supportsManagedHyperframesPreview('0.7.57', 'v20.19.0', '34.5.8')).toBe(false);
    expect(supportsManagedHyperframesPreview('0.7.57', 'v20.19.1', '34.5.7')).toBe(false);
    expect(supportsManagedHyperframesPreview('0.7.57', 'v22.0.0', '35.0.0')).toBe(true);
  });

  it('discovers an existing HyperFrames browser cache without downloading or leaking host secrets', async () => {
    const root = await makeRoot();
    const browserPath = path.join(root, 'app', 'chrome-headless-shell.exe');
    const discoveryLog = path.join(root, 'browser-discovery.json');
    const cliSource = `
import fs from 'node:fs';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--version') {
  process.stdout.write('0.7.57\\n');
  process.exit(0);
}
if (args[0] === 'browser' && args[1] === 'path') {
  fs.writeFileSync(${JSON.stringify(discoveryLog)}, JSON.stringify({
    autoInstall: process.env.HYPERFRAMES_NO_AUTO_INSTALL,
    browser: process.env.HYPERFRAMES_BROWSER_PATH,
    producerBrowser: process.env.PRODUCER_HEADLESS_SHELL_PATH,
    secret: process.env.IZZI_API_KEY,
  }));
  process.stdout.write(${JSON.stringify(browserPath)} + '\\n');
  process.exit(0);
}
process.exit(2);
`;
    const appRoot = await createReadyAppRuntime(root, cliSource);
    vi.stubEnv('STARIZZI_HYPERFRAMES_BROWSER', '');
    vi.stubEnv('IZZI_API_KEY', 'synthetic-secret');
    const service = new CustomerVideoStudioService({
      rootPath: path.join(root, 'runtime'),
      appRoot,
      managedElectronRuntime: {
        executablePath: process.execPath,
        electronVersion: '34.5.8',
        nodeVersion: '20.19.1',
      },
      hyperframesAttestation: await createHyperframesAttestation(appRoot),
    });

    const toolchain = await service.getToolchain();
    const discovery = JSON.parse(await fs.readFile(discoveryLog, 'utf8')) as {
      autoInstall?: string;
      browser?: string;
      producerBrowser?: string;
      secret?: string;
    };

    expect(toolchain.hyperframes.status).toBe('ready');
    expect(toolchain.node.status).toBe('ready');
    expect(toolchain.previewAvailable).toBe(true);
    expect(toolchain.commercialRenderAvailable).toBe(false);
    expect(discovery).toEqual({
      autoInstall: '1',
    });
  });

  it('keeps commercial render closed on managed Electron even with verified Voice Studio evidence', async () => {
    const root = await makeRoot();
    const appRoot = await createReadyAppRuntime(root);
    vi.stubEnv('STARIZZI_FFMPEG_BIN', process.execPath);
    vi.stubEnv('STARIZZI_FFPROBE_BIN', process.execPath);
    const service = new CustomerVideoStudioService({
      rootPath: path.join(root, 'runtime'),
      appRoot,
      managedElectronRuntime: {
        executablePath: process.execPath,
        electronVersion: '34.5.8',
        nodeVersion: '20.19.1',
      },
      hyperframesAttestation: await createHyperframesAttestation(appRoot),
      getVoiceStudioStatus: () => ({
        installed: true,
        running: true,
        version: '1.0.0',
        provider: 'VieNeu-TTS',
        modelId: 'verified-model',
        modelHash: 'd'.repeat(64),
        license: 'Apache-2.0',
        licenseSource: 'https://example.invalid/model-card',
        commercialUseAllowed: true,
      }),
      getF5TtsStatus: () => ({ installed: false, running: false }),
      verifyCommercialVoiceLicense: () => true,
    });

    const toolchain = await service.getToolchain();

    expect(toolchain.previewAvailable).toBe(true);
    expect(toolchain.videoPreviewAvailable).toBe(false);
    expect(toolchain.node.status).toBe('ready');
    expect(toolchain.commercialRenderAvailable).toBe(false);
  });

  it('uses an attested system Node for local video while keeping the managed commercial gate closed', async () => {
    const root = await makeRoot();
    const appRoot = await createReadyAppRuntime(root);
    vi.stubEnv('STARIZZI_FFMPEG_BIN', process.execPath);
    vi.stubEnv('STARIZZI_FFPROBE_BIN', process.execPath);
    const service = new CustomerVideoStudioService({
      rootPath: path.join(root, 'runtime'),
      appRoot,
      videoRenderNodePath: process.execPath,
      managedElectronRuntime: {
        executablePath: process.execPath,
        electronVersion: '34.5.8',
        nodeVersion: '20.19.1',
      },
      hyperframesAttestation: await createHyperframesAttestation(appRoot),
    });

    const toolchain = await service.getToolchain();

    expect(toolchain.previewAvailable).toBe(true);
    expect(toolchain.videoPreviewAvailable).toBe(true);
    expect(toolchain.node.version).toBe('v20.19.1');
    expect(toolchain.node.detail).toContain(process.version);
    expect(toolchain.commercialRenderAvailable).toBe(false);
  });

  it('runs packaged HyperFrames through the attested ASAR-unpacked CLI', async () => {
    const root = await makeRoot();
    const commandLog = path.join(root, 'packaged-cli-paths.jsonl');
    const cliSource = `
import { appendFileSync } from 'node:fs';
appendFileSync(${JSON.stringify(commandLog)}, JSON.stringify(process.argv[1]) + '\\n');
if (process.argv[2] === '--version') process.stdout.write('0.7.57\\n');
`;
    const appRoot = await createPackagedAppRuntime(root, cliSource);
    vi.stubEnv('STARIZZI_FFMPEG_BIN', process.execPath);
    vi.stubEnv('STARIZZI_FFPROBE_BIN', process.execPath);
    const service = new CustomerVideoStudioService({
      rootPath: path.join(root, 'runtime'),
      appRoot,
      videoRenderNodePath: process.execPath,
      managedElectronRuntime: {
        executablePath: process.execPath,
        electronVersion: '34.5.8',
        nodeVersion: '20.19.1',
      },
      hyperframesAttestation: await createHyperframesAttestation(appRoot),
    });

    const toolchain = await service.getToolchain();
    const cliPaths = (await fs.readFile(commandLog, 'utf8'))
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line) as string);
    const unpackedRoot = (await fs.realpath(`${appRoot}.unpacked`)).toLowerCase();
    const resolvedCliPaths = await Promise.all(cliPaths.map((candidate) => fs.realpath(candidate)));

    expect(toolchain.previewAvailable).toBe(true);
    expect(toolchain.videoPreviewAvailable).toBe(true);
    expect(cliPaths.length).toBeGreaterThanOrEqual(2);
    expect(
      resolvedCliPaths.every((candidate) => candidate.toLowerCase().startsWith(`${unpackedRoot}${path.sep}`)),
      JSON.stringify({ unpackedRoot, cliPaths: resolvedCliPaths }),
    ).toBe(true);
    expect(toolchain.commercialRenderAvailable).toBe(false);
  });

  it('rejects a modified HyperFrames CLI in the packaged ASAR-unpacked runtime', async () => {
    const root = await makeRoot();
    const appRoot = await createPackagedAppRuntime(root);
    const attestation = await createHyperframesAttestation(appRoot);
    await fs.appendFile(
      path.join(`${appRoot}.unpacked`, 'node_modules', 'hyperframes', 'dist', 'cli.js'),
      '\n// modified after packaging',
      'utf8',
    );
    const service = new CustomerVideoStudioService({
      rootPath: path.join(root, 'runtime'),
      appRoot,
      managedElectronRuntime: {
        executablePath: process.execPath,
        electronVersion: '34.5.8',
        nodeVersion: '20.19.1',
      },
      hyperframesAttestation: attestation,
    });

    const toolchain = await service.getToolchain();

    expect(toolchain.hyperframes.status).toBe('needs_setup');
    expect(toolchain.previewAvailable).toBe(false);
    expect(toolchain.videoPreviewAvailable).toBe(false);
  });

  it('rejects a HyperFrames bin path that escapes the pinned package root', async () => {
    const root = await makeRoot();
    const appRoot = path.join(root, 'app');
    const hyperframesRoot = path.join(appRoot, 'node_modules', 'hyperframes');
    await fs.mkdir(hyperframesRoot, { recursive: true });
    await fs.writeFile(path.join(hyperframesRoot, 'package.json'), JSON.stringify({
      name: 'hyperframes',
      version: '0.7.57',
      bin: { hyperframes: '../../outside.js' },
    }), 'utf8');
    await fs.writeFile(path.join(appRoot, 'outside.js'), 'console.log("outside")', 'utf8');

    const service = new CustomerVideoStudioService({
      rootPath: path.join(root, 'runtime'),
      appRoot,
      managedElectronRuntime: {
        executablePath: process.execPath,
        electronVersion: '34.5.8',
        nodeVersion: '20.19.1',
      },
    });

    const toolchain = await service.getToolchain();
    expect(toolchain.hyperframes.status).toBe('needs_setup');
    expect(toolchain.previewAvailable).toBe(false);
  });

  it('runs only check and snapshot through the managed Electron runtime with scrubbed, short-lived staging', async () => {
    const root = await makeRoot();
    const source = await createProject(root);
    const runtimePrefix = path.join(root, 'runtime-đường-dẫn-có-dấu-');
    const runtimeRoot = runtimePrefix + 'x'.repeat(Math.max(0, 130 - runtimePrefix.length));
    const workflowPath = path.join(source, 'video-workflow.json');
    const workflow = JSON.parse(await fs.readFile(workflowPath, 'utf8')) as Record<string, unknown>;
    workflow.project = {
      ...workflow.project as Record<string, unknown>,
      target_duration_s: 60,
    };
    workflow.scenes = [6, 8, 8, 8, 8, 8, 7, 7].map((minimumDuration, index) => ({
      id: `scene-${index + 1}`,
      minimum_duration_s: minimumDuration,
    }));
    await fs.writeFile(workflowPath, JSON.stringify(workflow, null, 2), 'utf8');
    const commandLog = path.join(root, 'managed-runtime-commands.jsonl');
    const browserPath = path.join(root, 'chrome-headless-shell.exe');
    await fs.writeFile(browserPath, 'browser');
    const cliSource = `
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--version') {
  process.stdout.write('0.7.57\\n');
  process.exit(0);
}
if (process.env.ELECTRON_RUN_AS_NODE !== '1') process.exit(71);
if (process.env.IZZI_API_KEY) process.exit(72);
fs.appendFileSync(${JSON.stringify(commandLog)}, JSON.stringify({
  args,
  cwd: process.cwd(),
  path: process.env.PATH || '',
  runAsNode: process.env.ELECTRON_RUN_AS_NODE,
  home: process.env.HOME,
  userProfile: process.env.USERPROFILE,
  appData: process.env.APPDATA,
  localAppData: process.env.LOCALAPPDATA,
  temp: process.env.TEMP,
  telemetry: process.env.HYPERFRAMES_NO_TELEMETRY,
  doNotTrack: process.env.DO_NOT_TRACK,
  updateCheck: process.env.HYPERFRAMES_NO_UPDATE_CHECK,
  autoInstall: process.env.HYPERFRAMES_NO_AUTO_INSTALL,
  ci: process.env.CI,
  browser: process.env.HYPERFRAMES_BROWSER_PATH,
  producerBrowser: process.env.PRODUCER_HEADLESS_SHELL_PATH,
}) + '\\n');
if (args[0] === 'check') {
  const fontconfigCache = path.join(
    process.env.HOME || '',
    '.cache',
    'fontconfig',
    '12345678901234567890123456789012-le64.cache-11',
  );
  if (fontconfigCache.length >= 260) {
    process.stderr.write('legacy runtime profile path is too long');
    process.exit(74);
  }
  process.stdout.write(${JSON.stringify(hyperframesCheckReport(true))});
}
if (args[0] === 'snapshot') {
  const outputIndex = args.indexOf('--output');
  const outputRoot = args[outputIndex + 1];
  if (path.join(outputRoot, 'frame-02-at-56.5s.png').length >= 260) {
    process.stderr.write('legacy snapshot path is too long');
    process.exit(73);
  }
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.writeFileSync(path.join(outputRoot, 'frame-00.png'), Buffer.from(${JSON.stringify(PNG_SIGNATURE.toString('base64'))}, 'base64'));
  fs.writeFileSync(path.join(outputRoot, 'contact-sheet.jpg'), Buffer.from('/9j/4AAQ', 'base64'));
}
`;
    const appRoot = await createReadyAppRuntime(root, cliSource);
    const realBrowserPath = await fs.realpath(browserPath);
    const untrustedPath = path.join(root, 'host-path-must-not-leak');
    await fs.mkdir(untrustedPath);
    vi.stubEnv('PATH', untrustedPath);
    vi.stubEnv('IZZI_API_KEY', 'synthetic-secret');

    const service = new CustomerVideoStudioService({
      rootPath: runtimeRoot,
      appRoot,
      managedElectronRuntime: {
        executablePath: process.execPath,
        electronVersion: '34.5.8',
        nodeVersion: '20.19.1',
      },
      managedBrowserPath: browserPath,
      hyperframesAttestation: await createHyperframesAttestation(appRoot),
    });
    const imported = await service.importProject('customer-abcdef123456', source);
    const toolchain = await service.getToolchain();
    const preview = await service.runPreview(
      'customer-abcdef123456',
      imported.runtimeProjectId,
      imported.evidenceDigest,
    );

    expect(toolchain.previewAvailable).toBe(true);
    expect(toolchain.commercialRenderAvailable).toBe(false);
    expect(toolchain.node).toEqual(expect.objectContaining({
      status: 'ready',
      version: 'v20.19.1',
    }));
    expect(toolchain.node.detail).toContain('Izzi AI quản lý');
    expect(toolchain.node.detail).toContain('render thương mại vẫn khóa');
    expect(preview.receipt.passed).toBe(true);
    expect(preview.receipt.snapshotCount).toBe(1);
    expect(preview.artifacts.some((artifact) => artifact.kind === 'snapshot')).toBe(true);
    expect(preview.artifacts.some((artifact) => artifact.name === 'contact-sheet.jpg')).toBe(true);
    expect(preview.artifacts).toContainEqual(expect.objectContaining({
      kind: 'check_report',
      name: 'hyperframes-check.json',
    }));

    const commands = (await fs.readFile(commandLog, 'utf8'))
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line) as {
        args: string[];
        cwd: string;
        path: string;
        runAsNode: string;
        home: string;
        userProfile: string;
        appData: string;
        localAppData: string;
        temp: string;
        telemetry: string;
        doNotTrack: string;
        updateCheck: string;
        autoInstall: string;
        ci: string;
        browser: string;
        producerBrowser: string;
      });
    expect(commands.map((entry) => entry.args[0])).toEqual(['check', 'snapshot']);
    expect(commands.every((entry) => entry.runAsNode === '1')).toBe(true);
    expect(commands.every((entry) => !entry.path.includes(untrustedPath))).toBe(true);
    expect(commands.every((entry) => !entry.args.includes('publish') && !entry.args.includes('render'))).toBe(true);
    const scratchRoot = path.dirname(commands[0].cwd);
    expect(path.basename(scratchRoot)).toMatch(/^izzi-ai-hf-[A-Za-z0-9]{6}$/);
    expect(commands.every((entry) => entry.cwd.startsWith(scratchRoot + path.sep))).toBe(true);
    expect(commands.every((entry) => !entry.cwd.includes(runtimeRoot))).toBe(true);
    expect(commands.every((entry) => !entry.cwd.includes(imported.runtimeProjectId))).toBe(true);
    expect(commands.every((entry) => entry.home === entry.userProfile)).toBe(true);
    expect(commands.every((entry) => entry.appData.startsWith(scratchRoot + path.sep))).toBe(true);
    expect(commands.every((entry) => entry.localAppData.startsWith(scratchRoot + path.sep))).toBe(true);
    expect(commands.every((entry) => entry.temp.startsWith(scratchRoot + path.sep))).toBe(true);
    expect(commands.every((entry) => entry.telemetry === '1' && entry.doNotTrack === '1')).toBe(true);
    expect(commands.every((entry) => entry.updateCheck === '1' && entry.autoInstall === '1')).toBe(true);
    expect(commands.every((entry) => entry.ci === '1')).toBe(true);
    expect(commands.every((entry) => (
      entry.browser === realBrowserPath && entry.producerBrowser === realBrowserPath
    ))).toBe(true);
    const snapshotCommand = commands.find((entry) => entry.args[0] === 'snapshot');
    const atIndex = snapshotCommand?.args.indexOf('--at') ?? -1;
    expect(snapshotCommand?.args[atIndex + 1]).toBe('3,26,56.5');
    expect(snapshotCommand?.args).toContain('--no-end');
    expect(snapshotCommand?.args).not.toContain('--frames');
    const outputIndex = snapshotCommand?.args.indexOf('--output') ?? -1;
    const outputRoot = snapshotCommand?.args[outputIndex + 1] || '';
    expect(outputRoot.startsWith(scratchRoot + path.sep)).toBe(true);
    expect(path.dirname(outputRoot)).toBe(scratchRoot);
    expect(outputRoot).not.toContain(`${path.sep}preview-runs${path.sep}`);
    expect(outputRoot).not.toContain(`${path.sep}projects${path.sep}`);
    expect(path.join(outputRoot, 'frame-02-at-56.5s.png').length).toBeLessThan(260);

    const previewRunBase = path.join(
      runtimeRoot,
      'customer-abcdef123456',
      'preview-runs',
      imported.runtimeProjectId,
    );
    const [previewRunId] = await fs.readdir(previewRunBase);
    expect(path.join(
      previewRunBase,
      previewRunId,
      'snapshots',
      'frame-02-at-56.5s.png',
    ).length).toBeGreaterThanOrEqual(260);
    await expect(fs.stat(
      path.join(previewRunBase, previewRunId, 'snapshots', 'frame-00.png'),
    )).resolves.toEqual(expect.objectContaining({ size: PNG_SIGNATURE.length }));
    await expect(fs.stat(scratchRoot)).rejects.toThrow();
  });

  it('preserves a valid failed quality report and snapshots without treating it as a launcher error', async () => {
    const root = await makeRoot();
    const source = await createProject(root);
    const browserPath = path.join(root, 'chrome-headless-shell.exe');
    await fs.writeFile(browserPath, 'browser');
    const cliSource = `
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--version') {
  process.stdout.write('0.7.57\\n');
  process.exit(0);
}
if (args[0] === 'check') {
  const projectRoot = args[args.length - 1];
  process.stdout.write(JSON.stringify({
    ok: false,
    strict: false,
    lint: {
      ok: false,
      errorCount: 1,
      warningCount: 2,
      infoCount: 0,
      findings: [{ code: 'missing_local_asset', sourceFile: path.join(projectRoot, 'index.html') }],
    },
    runtime: { ok: true, errorCount: 0, warningCount: 0, infoCount: 0, findings: [] },
    layout: { ok: true, errorCount: 0, warningCount: 0, infoCount: 0, findings: [] },
    motion: { ok: true, errorCount: 0, warningCount: 0, infoCount: 0, findings: [] },
    contrast: { ok: true, errorCount: 0, warningCount: 0, infoCount: 0, findings: [] },
    _meta: { version: '0.7.57' },
  }));
  process.exitCode = 1;
} else if (args[0] === 'snapshot') {
  const outputRoot = args[args.indexOf('--output') + 1];
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.writeFileSync(path.join(outputRoot, 'frame-00.png'), Buffer.from(${JSON.stringify(PNG_SIGNATURE.toString('base64'))}, 'base64'));
  fs.writeFileSync(path.join(outputRoot, 'contact-sheet.jpg'), Buffer.from('/9j/4AAQ', 'base64'));
}
`;
    const appRoot = await createReadyAppRuntime(root, cliSource);
    const runtimeRoot = path.join(root, 'runtime');
    const service = new CustomerVideoStudioService({
      rootPath: runtimeRoot,
      appRoot,
      managedElectronRuntime: {
        executablePath: process.execPath,
        electronVersion: '34.5.8',
        nodeVersion: '20.19.1',
      },
      managedBrowserPath: browserPath,
      hyperframesAttestation: await createHyperframesAttestation(appRoot),
    });
    const imported = await service.importProject('customer-abcdef123456', source);
    const preview = await service.runPreview(
      'customer-abcdef123456',
      imported.runtimeProjectId,
      imported.evidenceDigest,
    );

    expect(preview.receipt).toEqual(expect.objectContaining({
      passed: false,
      snapshotCount: 1,
    }));
    expect(preview.receipt.summary).toContain('1 lỗi');
    expect(preview.receipt.summary).toContain('2 cảnh báo');
    expect(preview.artifacts).toContainEqual(expect.objectContaining({
      kind: 'check_report',
      name: 'hyperframes-check.json',
    }));
    expect(preview.artifacts.some((artifact) => artifact.kind === 'snapshot')).toBe(true);

    const runBase = path.join(
      runtimeRoot,
      'customer-abcdef123456',
      'preview-runs',
      imported.runtimeProjectId,
    );
    const [runId] = await fs.readdir(runBase);
    const reportRaw = await fs.readFile(
      path.join(runBase, runId, 'hyperframes-check.json'),
      'utf8',
    );
    expect(reportRaw).toContain('<project>');
    expect(reportRaw).not.toContain(path.join(
      runtimeRoot,
      'customer-abcdef123456',
      'projects',
      imported.runtimeProjectId,
    ));
    expect(preview.artifacts).toContainEqual(expect.objectContaining({
      kind: 'snapshot',
      name: 'contact-sheet.jpg',
    }));
  });

  it.each([
    {
      label: 'missing required report sections',
      exitCode: 1,
      report: JSON.stringify({ ok: false, strict: false, _meta: { version: '0.7.57' } }),
    },
    {
      label: 'unsupported exit code',
      exitCode: 2,
      report: hyperframesCheckReport(false, 1),
    },
    {
      label: 'failed report with zero exit code',
      exitCode: 0,
      report: hyperframesCheckReport(false, 1),
    },
    {
      label: 'passing report with failed exit code',
      exitCode: 1,
      report: hyperframesCheckReport(true),
    },
  ])('rejects $label before snapshot execution', async ({ exitCode, report }) => {
    const root = await makeRoot();
    const source = await createProject(root);
    const snapshotLog = path.join(root, 'snapshot-command.log');
    const cliSource = `
import fs from 'node:fs';
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--version') {
  process.stdout.write('0.7.57\\n');
  process.exit(0);
}
if (args[0] === 'check') {
  process.stdout.write(${JSON.stringify(report)});
  process.exitCode = ${exitCode};
} else if (args[0] === 'snapshot') {
  fs.writeFileSync(${JSON.stringify(snapshotLog)}, 'unexpected');
}
`;
    const appRoot = await createReadyAppRuntime(root, cliSource);
    const runtimeRoot = path.join(root, 'runtime');
    const service = new CustomerVideoStudioService({
      rootPath: runtimeRoot,
      appRoot,
      managedElectronRuntime: {
        executablePath: process.execPath,
        electronVersion: '34.5.8',
        nodeVersion: '20.19.1',
      },
      managedBrowserPath: process.execPath,
      hyperframesAttestation: await createHyperframesAttestation(appRoot),
    });
    const imported = await service.importProject('customer-abcdef123456', source);

    await expect(service.runPreview(
      'customer-abcdef123456',
      imported.runtimeProjectId,
      imported.evidenceDigest,
    )).rejects.toThrow('thất bại');
    await expect(fs.stat(snapshotLog)).rejects.toThrow();
    expect(await fs.readdir(path.join(
      runtimeRoot,
      'customer-abcdef123456',
      'preview-runs',
      imported.runtimeProjectId,
    ))).toEqual([]);
  });

  it('rejects an unexpected root environment file added after approval before spawning HyperFrames', async () => {
    const root = await makeRoot();
    const source = await createProject(root);
    const commandLog = path.join(root, 'unexpected-root-command.log');
    const browserPath = path.join(root, 'chrome-headless-shell.exe');
    await fs.writeFile(browserPath, 'browser');
    const appRoot = await createReadyAppRuntime(root, `
import fs from 'node:fs';
if (process.argv[2] === '--version') {
  process.stdout.write('0.7.57\\n');
} else {
  fs.appendFileSync(${JSON.stringify(commandLog)}, 'spawned');
}
`);
    const runtimeRoot = path.join(root, 'runtime');
    vi.stubEnv('PATH', '');
    const service = new CustomerVideoStudioService({
      rootPath: runtimeRoot,
      appRoot,
      managedElectronRuntime: {
        executablePath: process.execPath,
        electronVersion: '34.5.8',
        nodeVersion: '20.19.1',
      },
      managedBrowserPath: browserPath,
      hyperframesAttestation: await createHyperframesAttestation(appRoot),
    });
    const imported = await service.importProject('customer-abcdef123456', source);
    const storedRoot = path.join(runtimeRoot, 'customer-abcdef123456', 'projects', imported.runtimeProjectId);
    await fs.writeFile(path.join(storedRoot, '.env'), 'GEMINI_API_KEY=must-not-load', 'utf8');

    await expect(service.runPreview(
      'customer-abcdef123456',
      imported.runtimeProjectId,
      imported.evidenceDigest,
    )).rejects.toThrow('root không được phép');
    await expect(fs.stat(commandLog)).rejects.toThrow();
  });

  it('rejects a preview-runs junction that escapes the customer workspace', async () => {
    const root = await makeRoot();
    const source = await createProject(root);
    const browserPath = path.join(root, 'chrome-headless-shell.exe');
    await fs.writeFile(browserPath, 'browser');
    const appRoot = await createReadyAppRuntime(root, `
if (process.argv[2] === '--version') process.stdout.write('0.7.57\\n');
`);
    const runtimeRoot = path.join(root, 'runtime');
    vi.stubEnv('PATH', '');
    const service = new CustomerVideoStudioService({
      rootPath: runtimeRoot,
      appRoot,
      managedElectronRuntime: {
        executablePath: process.execPath,
        electronVersion: '34.5.8',
        nodeVersion: '20.19.1',
      },
      managedBrowserPath: browserPath,
      hyperframesAttestation: await createHyperframesAttestation(appRoot),
    });
    const imported = await service.importProject('customer-abcdef123456', source);
    const outside = path.join(root, 'outside-preview-output');
    await fs.mkdir(outside);
    await fs.symlink(
      outside,
      path.join(runtimeRoot, 'customer-abcdef123456', 'preview-runs'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    await expect(service.runPreview(
      'customer-abcdef123456',
      imported.runtimeProjectId,
      imported.evidenceDigest,
    )).rejects.toThrow('output');
  });

  it('rejects tampered HyperFrames bytes before probing the CLI', async () => {
    const root = await makeRoot();
    const probeLog = path.join(root, 'probe.log');
    const appRoot = await createReadyAppRuntime(root, `
import fs from 'node:fs';
fs.appendFileSync(${JSON.stringify(probeLog)}, process.argv.slice(2).join(' ') + '\\n');
if (process.argv[2] === '--version') process.stdout.write('0.7.57\\n');
`);
    const attestation = await createHyperframesAttestation(appRoot);
    await fs.appendFile(
      path.join(appRoot, 'node_modules', 'hyperframes', 'dist', 'cli.js'),
      '\n// tampered after attestation\n',
      'utf8',
    );

    const service = new CustomerVideoStudioService({
      rootPath: path.join(root, 'runtime'),
      appRoot,
      managedElectronRuntime: {
        executablePath: process.execPath,
        electronVersion: '34.5.8',
        nodeVersion: '20.19.1',
      },
      managedBrowserPath: process.execPath,
      hyperframesAttestation: attestation,
    });

    const toolchain = await service.getToolchain();
    expect(toolchain.hyperframes.status).toBe('needs_setup');
    expect(toolchain.previewAvailable).toBe(false);
    await expect(fs.stat(probeLog)).rejects.toThrow();
  });

  it('does not discover Node from host PATH and probes the CLI for an explicit Node runtime', async () => {
    const root = await makeRoot();
    const appRoot = await createReadyAppRuntime(root, `
if (process.argv[2] === '--version') process.stdout.write('9.9.9\\n');
`);
    const browserPath = path.join(root, 'chrome-headless-shell.exe');
    await fs.writeFile(browserPath, 'browser');
    const attestation = await createHyperframesAttestation(appRoot);
    vi.stubEnv('PATH', path.dirname(process.execPath));
    vi.stubEnv('STARIZZI_HYPERFRAMES_NODE', '');

    const pathOnly = new CustomerVideoStudioService({
      rootPath: path.join(root, 'runtime-path-only'),
      appRoot,
      managedElectronRuntime: null,
      managedBrowserPath: browserPath,
      hyperframesAttestation: attestation,
    });
    expect((await pathOnly.getToolchain()).previewAvailable).toBe(false);

    vi.stubEnv('STARIZZI_HYPERFRAMES_NODE', process.execPath);
    const explicitButMismatched = new CustomerVideoStudioService({
      rootPath: path.join(root, 'runtime-explicit'),
      appRoot,
      managedElectronRuntime: null,
      managedBrowserPath: browserPath,
      hyperframesAttestation: attestation,
    });
    expect((await explicitButMismatched.getToolchain()).previewAvailable).toBe(false);
  });

  it('keeps commercial render blocked for managed Electron even when its declared Node is 22+', async () => {
    const root = await makeRoot();
    const appRoot = await createReadyAppRuntime(root);
    const browserPath = path.join(root, 'chrome-headless-shell.exe');
    await fs.writeFile(browserPath, 'browser');
    vi.stubEnv('STARIZZI_FFMPEG_BIN', process.execPath);
    vi.stubEnv('STARIZZI_FFPROBE_BIN', process.execPath);
    stubF5Config('Apache-2.0', 'verified-commercial-model');

    const service = new CustomerVideoStudioService({
      rootPath: path.join(root, 'runtime'),
      appRoot,
      managedElectronRuntime: {
        executablePath: process.execPath,
        electronVersion: '35.0.0',
        nodeVersion: '22.0.0',
      },
      managedBrowserPath: browserPath,
      hyperframesAttestation: await createHyperframesAttestation(appRoot),
      getF5TtsStatus: () => ({ installed: true, running: true, version: '1.0.0' }),
      verifyCommercialVoiceLicense: () => true,
    });

    const toolchain = await service.getToolchain();
    expect(toolchain.previewAvailable).toBe(true);
    expect(toolchain.commercialRenderAvailable).toBe(false);
  });

  it('kills the HyperFrames process tree on timeout and removes partial preview output', async () => {
    const root = await makeRoot();
    const source = await createProject(root);
    const descendantPidPath = path.join(root, 'descendant.pid');
    const appRoot = await createReadyAppRuntime(root, `
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--version') {
  process.stdout.write('0.7.57\\n');
  process.exit(0);
}
if (args[0] === 'check') {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  });
  fs.writeFileSync(${JSON.stringify(descendantPidPath)}, String(child.pid));
  setInterval(() => {}, 1000);
}
`);
    const runtimeRoot = path.join(root, 'runtime');
    const service = new CustomerVideoStudioService({
      rootPath: runtimeRoot,
      appRoot,
      managedElectronRuntime: {
        executablePath: process.execPath,
        electronVersion: '34.5.8',
        nodeVersion: '20.19.1',
      },
      managedBrowserPath: process.execPath,
      hyperframesAttestation: await createHyperframesAttestation(appRoot),
      previewTimeoutMs: 300,
    });
    const imported = await service.importProject('customer-abcdef123456', source);
    let descendantPid = 0;
    try {
      await expect(service.runPreview(
        'customer-abcdef123456',
        imported.runtimeProjectId,
        imported.evidenceDigest,
      )).rejects.toThrow('quá thời gian');
      descendantPid = Number(await fs.readFile(descendantPidPath, 'utf8'));
      expect(descendantPid).toBeGreaterThan(0);
      expect(await waitForProcessExit(descendantPid)).toBe(true);
      const projectRuns = path.join(
        runtimeRoot,
        'customer-abcdef123456',
        'preview-runs',
        imported.runtimeProjectId,
      );
      expect(await fs.readdir(projectRuns)).toEqual([]);
    } finally {
      if (descendantPid && processExists(descendantPid)) {
        try {
          process.kill(descendantPid, 'SIGKILL');
        } catch {
          // The descendant already exited.
        }
      }
    }
  });

  it('kills active HyperFrames descendants when the desktop shutdown hook fires', async () => {
    const root = await makeRoot();
    const source = await createProject(root);
    const descendantPidPath = path.join(root, 'shutdown-descendant.pid');
    const appRoot = await createReadyAppRuntime(root, `
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--version') {
  process.stdout.write('0.7.57\\n');
  process.exit(0);
}
if (args[0] === 'check') {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    stdio: 'ignore',
  });
  fs.writeFileSync(${JSON.stringify(descendantPidPath)}, String(child.pid));
  setInterval(() => {}, 1000);
}
`);
    const service = new CustomerVideoStudioService({
      rootPath: path.join(root, 'runtime'),
      appRoot,
      managedElectronRuntime: {
        executablePath: process.execPath,
        electronVersion: '34.5.8',
        nodeVersion: '20.19.1',
      },
      managedBrowserPath: process.execPath,
      hyperframesAttestation: await createHyperframesAttestation(appRoot),
      previewTimeoutMs: 10_000,
    });
    const imported = await service.importProject('customer-abcdef123456', source);
    const preview = service.runPreview(
      'customer-abcdef123456',
      imported.runtimeProjectId,
      imported.evidenceDigest,
    ).then(
      () => ({ ok: true as const, error: null }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    let descendantPid = 0;
    try {
      descendantPid = Number(await waitForFileText(descendantPidPath));
      service.killAll();
      const result = await preview;
      expect(result.ok).toBe(false);
      expect(result.error).toBeInstanceOf(Error);
      expect((result.error as Error).message).toContain('thất bại');
      expect(await waitForProcessExit(descendantPid)).toBe(true);
    } finally {
      service.killAll();
      if (descendantPid && processExists(descendantPid)) {
        try {
          process.kill(descendantPid, 'SIGKILL');
        } catch {
          // The descendant already exited.
        }
      }
    }
  });

  it('stops excessive command output and rejects unexpected snapshot files', async () => {
    const root = await makeRoot();
    const source = await createProject(root);
    const noisyAppRoot = await createReadyAppRuntime(root, `
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--version') {
  process.stdout.write('0.7.57\\n');
} else {
  process.stdout.write('x'.repeat(2048));
}
`);
    const noisy = new CustomerVideoStudioService({
      rootPath: path.join(root, 'runtime-noisy'),
      appRoot: noisyAppRoot,
      managedElectronRuntime: {
        executablePath: process.execPath,
        electronVersion: '34.5.8',
        nodeVersion: '20.19.1',
      },
      managedBrowserPath: process.execPath,
      hyperframesAttestation: await createHyperframesAttestation(noisyAppRoot),
      previewMaxOutputBytes: 1_024,
    });
    const noisyImported = await noisy.importProject('customer-abcdef123456', source);
    await expect(noisy.runPreview(
      'customer-abcdef123456',
      noisyImported.runtimeProjectId,
      noisyImported.evidenceDigest,
    )).rejects.toThrow('quá nhiều log');

    const invalidRoot = await makeRoot();
    const invalidSource = await createProject(invalidRoot);
    const invalidAppRoot = await createReadyAppRuntime(invalidRoot, `
import fs from 'node:fs';
import path from 'node:path';
const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--version') {
  process.stdout.write('0.7.57\\n');
} else if (args[0] === 'check') {
  process.stdout.write(${JSON.stringify(hyperframesCheckReport(true))});
} else if (args[0] === 'snapshot') {
  const outputRoot = args[args.indexOf('--output') + 1];
  fs.writeFileSync(path.join(outputRoot, 'unexpected.txt'), 'not an image');
}
`);
    const invalidRuntimeRoot = path.join(invalidRoot, 'runtime');
    const invalid = new CustomerVideoStudioService({
      rootPath: invalidRuntimeRoot,
      appRoot: invalidAppRoot,
      managedElectronRuntime: {
        executablePath: process.execPath,
        electronVersion: '34.5.8',
        nodeVersion: '20.19.1',
      },
      managedBrowserPath: process.execPath,
      hyperframesAttestation: await createHyperframesAttestation(invalidAppRoot),
    });
    const invalidImported = await invalid.importProject('customer-abcdef123456', invalidSource);
    await expect(invalid.runPreview(
      'customer-abcdef123456',
      invalidImported.runtimeProjectId,
      invalidImported.evidenceDigest,
    )).rejects.toThrow('không được phép');
    expect(await fs.readdir(path.join(
      invalidRuntimeRoot,
      'customer-abcdef123456',
      'preview-runs',
      invalidImported.runtimeProjectId,
    ))).toEqual([]);
  });
});
