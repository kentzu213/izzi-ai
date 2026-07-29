import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  CustomerVideoStudioService,
  deriveImportedSourceIdentity,
  resolveConfiguredBinaryPath,
  supportsManagedHyperframesPreview,
} from './customer-video-studio-service';

const temporaryRoots: string[] = [];
const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');
const DEFAULT_HYPERFRAMES_CLI = `
if (process.argv[2] === '--version') process.stdout.write('0.7.57\\n');
`;

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
  it('does not collapse distinct canonical paths that differ only by case', () => {
    const upper = deriveImportedSourceIdentity(
      'customer-abcdef123456',
      'C:\\workspace\\Project',
    );
    const lower = deriveImportedSourceIdentity(
      'customer-abcdef123456',
      'C:\\workspace\\project',
    );

    expect(upper).not.toBe(lower);
  });

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
      sourceIdentity: expect.stringMatching(/^[a-f0-9]{64}$/),
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
    const otherWorkspace = await service.importProject('customer-fedcba654321', source);

    expect(first.evidenceDigest).not.toBe(second.evidenceDigest);
    expect(first.sourceIdentity).toBe(second.sourceIdentity);
    expect(otherWorkspace.sourceIdentity).not.toBe(first.sourceIdentity);
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

describe('CustomerVideoStudioService managed HyperFrames runtime', () => {
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
    expect(toolchain.node.status).toBe('ready');
    expect(toolchain.commercialRenderAvailable).toBe(false);
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
