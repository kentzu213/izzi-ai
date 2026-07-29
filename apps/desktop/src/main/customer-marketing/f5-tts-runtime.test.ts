import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { discoverLocalF5TtsRuntime } from './f5-tts-runtime';

const temporaryRoots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'izzi-f5-runtime-'));
  temporaryRoots.push(root);
  return root;
}

async function writeFile(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, 'test');
}

async function createKnownRuntime(
  installRoot: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  const pythonPath = platform === 'win32'
    ? path.join(installRoot, '.f5-venv', 'Scripts', 'python.exe')
    : path.join(installRoot, '.f5-venv', 'bin', 'python');
  await writeFile(pythonPath);
  await writeFile(path.join(
    installRoot,
    '.models',
    'f5-tts-vietnamese-vivoice',
    'model_last.pt',
  ));
  await writeFile(path.join(
    installRoot,
    '.models',
    'f5-tts-vietnamese-vivoice',
    'config.json',
  ));
  await writeFile(path.join(
    installRoot,
    '.models',
    'vocos-mel-24khz',
    'config.yaml',
  ));
  await writeFile(path.join(
    installRoot,
    '.models',
    'vocos-mel-24khz',
    'pytorch_model.bin',
  ));
  await fs.mkdir(path.join(
    installRoot,
    '.tools',
    'F5-TTS-Vietnamese',
    'src',
    'f5_tts',
  ), { recursive: true });
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => (
    fs.rm(root, { recursive: true, force: true })
  )));
});

describe('discoverLocalF5TtsRuntime', () => {
  it('discovers the verified HyperFrames project layout without environment wiring', async () => {
    const homeDir = await makeRoot();
    const installRoot = path.join(
      homeDir,
      'OneDrive',
      'Documents',
      'Content',
      'HyperFrames',
      'videos',
      'mineru-explainer',
    );
    await createKnownRuntime(installRoot);

    const discovery = discoverLocalF5TtsRuntime({
      env: {},
      homeDir,
      platform: process.platform,
    });

    expect(discovery).toEqual({
      status: {
        installed: true,
        running: false,
        version: 'ViVoice 50228cc',
        provider: 'F5-TTS',
        modelId: 'hynt/F5-TTS-Vietnamese-ViVoice@50228ccc563853f0ac628f49ed99a11f653d9ebe',
        modelHash: undefined,
        license: 'CC-BY-NC-SA-4.0',
        licenseSource: 'https://huggingface.co/hynt/F5-TTS-Vietnamese-ViVoice',
        commercialUseAllowed: false,
      },
      endpoint: undefined,
    });
    expect(JSON.stringify(discovery)).not.toContain(installRoot);
  });

  it('does not recognize an incomplete local runtime', async () => {
    const homeDir = await makeRoot();
    const installRoot = path.join(
      homeDir,
      'OneDrive',
      'Documents',
      'Content',
      'HyperFrames',
      'videos',
      'partial-runtime',
    );
    await writeFile(path.join(installRoot, '.f5-venv', 'Scripts', 'python.exe'));
    await writeFile(path.join(
      installRoot,
      '.models',
      'f5-tts-vietnamese-vivoice',
      'model_last.pt',
    ));

    expect(discoverLocalF5TtsRuntime({
      env: {},
      homeDir,
      platform: process.platform,
    }).status).toEqual({ installed: false, running: false });
  });

  it('does not follow a linked videos root outside the trusted Documents boundary', async () => {
    const homeDir = await makeRoot();
    const documentsRoot = path.join(homeDir, 'OneDrive', 'Documents');
    const videosRoot = path.join(documentsRoot, 'Content', 'HyperFrames', 'videos');
    const outsideRuntime = path.join(homeDir, 'outside-runtime');
    await createKnownRuntime(outsideRuntime);
    await fs.mkdir(path.dirname(videosRoot), { recursive: true });
    await fs.symlink(
      outsideRuntime,
      videosRoot,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    expect(discoverLocalF5TtsRuntime({
      env: {},
      homeDir,
      platform: process.platform,
    }).status).toEqual({ installed: false, running: false });
  });

  it('keeps an explicit invalid configuration fail-closed instead of masking it with discovery', async () => {
    const homeDir = await makeRoot();
    const installRoot = path.join(
      homeDir,
      'OneDrive',
      'Documents',
      'Content',
      'HyperFrames',
      'videos',
      'valid-runtime',
    );
    await createKnownRuntime(installRoot);

    const discovery = discoverLocalF5TtsRuntime({
      env: {
        STARIZZI_F5_TTS_INSTALL_ROOT: path.join(homeDir, 'missing-runtime'),
      },
      homeDir,
      platform: process.platform,
    });

    expect(discovery.status).toEqual({ installed: false, running: false });
  });

  it('preserves the legacy explicit three-path contract and endpoint metadata', async () => {
    const root = await makeRoot();
    const installRoot = path.join(root, 'custom-runtime');
    const pythonPath = path.join(installRoot, 'python.exe');
    const modelPath = path.join(installRoot, 'models', 'custom-model.pt');
    await writeFile(pythonPath);
    await writeFile(modelPath);

    const discovery = discoverLocalF5TtsRuntime({
      env: {
        STARIZZI_F5_TTS_INSTALL_ROOT: installRoot,
        STARIZZI_F5_TTS_PYTHON: pythonPath,
        STARIZZI_F5_TTS_MODEL_PATH: modelPath,
        STARIZZI_F5_TTS_URL: 'http://127.0.0.1:7860',
        STARIZZI_F5_TTS_VERSION: '1.2.3',
        STARIZZI_F5_TTS_PROVIDER: 'custom-f5',
        STARIZZI_F5_TTS_MODEL_ID: 'operator/custom-model',
        STARIZZI_F5_TTS_MODEL_LICENSE: 'Apache-2.0',
        STARIZZI_F5_TTS_LICENSE_SOURCE: 'https://example.invalid/model-card',
        STARIZZI_F5_TTS_COMMERCIAL_USE_ALLOWED: 'true',
      },
      homeDir: root,
      platform: process.platform,
    });

    expect(discovery).toEqual({
      status: {
        installed: true,
        running: false,
        version: '1.2.3',
        provider: 'custom-f5',
        modelId: 'operator/custom-model',
        modelHash: undefined,
        license: 'Apache-2.0',
        licenseSource: 'https://example.invalid/model-card',
        commercialUseAllowed: true,
      },
      endpoint: 'http://127.0.0.1:7860',
    });
    expect(JSON.stringify(discovery)).not.toContain(installRoot);
  });
});
