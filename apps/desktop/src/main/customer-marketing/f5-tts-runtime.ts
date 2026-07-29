import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CustomerF5TtsStatus } from './customer-video-studio-service';

const VIVOICE_MODEL_ID = 'hynt/F5-TTS-Vietnamese-ViVoice@50228ccc563853f0ac628f49ed99a11f653d9ebe';
const VIVOICE_LICENSE = 'CC-BY-NC-SA-4.0';
const VIVOICE_LICENSE_SOURCE = 'https://huggingface.co/hynt/F5-TTS-Vietnamese-ViVoice';
const VIVOICE_VERSION = 'ViVoice 50228cc';
const MAX_DISCOVERY_ENTRIES = 128;

interface F5RuntimeCandidate {
  installRoot: string;
  pythonPath: string;
  modelPath: string;
  knownViVoice: boolean;
}

export interface F5RuntimeDiscovery {
  status: CustomerF5TtsStatus;
  endpoint?: string;
}

export interface F5RuntimeDiscoveryOptions {
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  platform?: NodeJS.Platform;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isFile(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isDirectory(directoryPath: string): boolean {
  try {
    return fs.statSync(directoryPath).isDirectory();
  } catch {
    return false;
  }
}

function isPathWithin(rootPath: string, candidatePath: string): boolean {
  const comparableRoot = process.platform === 'win32'
    ? rootPath.toLowerCase()
    : rootPath;
  const comparableCandidate = process.platform === 'win32'
    ? candidatePath.toLowerCase()
    : candidatePath;
  const relative = path.relative(comparableRoot, comparableCandidate);
  return relative === ''
    || (
      relative !== '..'
      && !relative.startsWith(`..${path.sep}`)
      && !path.isAbsolute(relative)
    );
}

function realDirectoryPath(
  directoryPath: string,
  boundaryRoot?: string,
): string | null {
  try {
    const resolved = fs.realpathSync.native(directoryPath);
    if (
      (boundaryRoot && !isPathWithin(boundaryRoot, resolved))
      || !fs.statSync(resolved).isDirectory()
    ) {
      return null;
    }
    return resolved;
  } catch {
    return null;
  }
}

function realFilePath(
  filePath: string,
  boundaryRoot?: string,
): string | null {
  try {
    const resolved = fs.realpathSync.native(filePath);
    if (
      (boundaryRoot && !isPathWithin(boundaryRoot, resolved))
      || !fs.statSync(resolved).isFile()
    ) {
      return null;
    }
    return resolved;
  } catch {
    return null;
  }
}

function isLocalAbsolutePath(candidate: string, platform: NodeJS.Platform): boolean {
  if (!path.isAbsolute(candidate)) return false;
  if (platform !== 'win32') return true;
  return /^[a-z]:\\/i.test(candidate.replaceAll('/', '\\'));
}

function uniquePaths(paths: string[], platform: NodeJS.Platform): string[] {
  const seen = new Set<string>();
  return paths.filter((candidate) => {
    const resolved = path.resolve(candidate);
    const normalized = platform === 'win32' ? resolved.toLowerCase() : resolved;
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function knownCandidateFromRoot(
  installRoot: string,
  platform: NodeJS.Platform,
  boundaryRoot?: string,
): F5RuntimeCandidate | null {
  const resolvedInstallRoot = realDirectoryPath(installRoot, boundaryRoot);
  if (!resolvedInstallRoot) return null;

  const pythonPath = platform === 'win32'
    ? path.join(installRoot, '.f5-venv', 'Scripts', 'python.exe')
    : path.join(installRoot, '.f5-venv', 'bin', 'python');
  const modelPath = path.join(
    installRoot,
    '.models',
    'f5-tts-vietnamese-vivoice',
    'model_last.pt',
  );
  const requiredFiles = [
    pythonPath,
    modelPath,
    path.join(installRoot, '.models', 'f5-tts-vietnamese-vivoice', 'config.json'),
    path.join(installRoot, '.models', 'vocos-mel-24khz', 'config.yaml'),
    path.join(installRoot, '.models', 'vocos-mel-24khz', 'pytorch_model.bin'),
  ];
  const sourceRoot = path.join(
    installRoot,
    '.tools',
    'F5-TTS-Vietnamese',
    'src',
    'f5_tts',
  );
  const resolvedRequiredFiles = requiredFiles.map((filePath) => (
    realFilePath(filePath, boundaryRoot)
  ));
  if (
    resolvedRequiredFiles.some((filePath) => !filePath)
    || !realDirectoryPath(sourceRoot, boundaryRoot)
  ) {
    return null;
  }

  return {
    installRoot: resolvedInstallRoot,
    pythonPath: resolvedRequiredFiles[0]!,
    modelPath: resolvedRequiredFiles[1]!,
    knownViVoice: true,
  };
}

function explicitCandidate(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): F5RuntimeCandidate | null | undefined {
  const installRoot = text(env.STARIZZI_F5_TTS_INSTALL_ROOT);
  const pythonPath = text(env.STARIZZI_F5_TTS_PYTHON);
  const modelPath = text(env.STARIZZI_F5_TTS_MODEL_PATH);
  const explicitlyConfigured = Boolean(installRoot || pythonPath || modelPath);
  if (!explicitlyConfigured) return undefined;

  if (installRoot && !pythonPath && !modelPath) {
    return knownCandidateFromRoot(installRoot, platform);
  }
  if (
    !installRoot
    || !pythonPath
    || !modelPath
    || !isDirectory(installRoot)
    || !isFile(pythonPath)
    || !isFile(modelPath)
  ) {
    return null;
  }

  const normalizedModelPath = path.resolve(modelPath).toLowerCase();
  return {
    installRoot: path.resolve(installRoot),
    pythonPath: path.resolve(pythonPath),
    modelPath: path.resolve(modelPath),
    knownViVoice: normalizedModelPath.includes(
      `${path.sep}f5-tts-vietnamese-vivoice${path.sep}model_last.pt`.toLowerCase(),
    ),
  };
}

function standardDocumentRoots(
  env: NodeJS.ProcessEnv,
  homeDir: string,
  platform: NodeJS.Platform,
): string[] {
  const cloudRoots = [
    text(env.OneDrive),
    text(env.OneDriveConsumer),
    text(env.OneDriveCommercial),
    ...(isLocalAbsolutePath(homeDir, platform) ? [path.join(homeDir, 'OneDrive')] : []),
  ].filter((root) => root && isLocalAbsolutePath(root, platform));

  const documentRoots = [
    ...(isLocalAbsolutePath(homeDir, platform) ? [path.join(homeDir, 'Documents')] : []),
    ...cloudRoots.map((root) => path.join(root, 'Documents')),
  ];
  return uniquePaths(documentRoots, platform);
}

function boundedChildDirectoryNames(rootPath: string): string[] {
  let directory: ReturnType<typeof fs.opendirSync> | null = null;
  const childNames: string[] = [];
  try {
    directory = fs.opendirSync(rootPath);
    for (let index = 0; index < MAX_DISCOVERY_ENTRIES; index += 1) {
      const entry = directory.readSync();
      if (!entry) break;
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        childNames.push(entry.name);
      }
    }
  } catch {
    return [];
  } finally {
    try {
      directory?.closeSync();
    } catch {
      // The discovery result is already fail-closed.
    }
  }
  return childNames.sort((left, right) => left.localeCompare(right));
}

function discoverKnownCandidate(
  env: NodeJS.ProcessEnv,
  homeDir: string,
  platform: NodeJS.Platform,
): F5RuntimeCandidate | null {
  for (const documentsRoot of standardDocumentRoots(env, homeDir, platform)) {
    const resolvedDocumentsRoot = realDirectoryPath(documentsRoot);
    if (!resolvedDocumentsRoot) continue;

    const videosRoot = path.join(documentsRoot, 'Content', 'HyperFrames', 'videos');
    const resolvedVideosRoot = realDirectoryPath(videosRoot, resolvedDocumentsRoot);
    if (!resolvedVideosRoot) continue;

    const directCandidate = knownCandidateFromRoot(
      resolvedVideosRoot,
      platform,
      resolvedVideosRoot,
    );
    if (directCandidate) return directCandidate;

    for (const childName of boundedChildDirectoryNames(resolvedVideosRoot)) {
      const candidate = knownCandidateFromRoot(
        path.join(resolvedVideosRoot, childName),
        platform,
        resolvedVideosRoot,
      );
      if (candidate) return candidate;
    }
  }
  return null;
}

function statusForCandidate(
  candidate: F5RuntimeCandidate,
  env: NodeJS.ProcessEnv,
): CustomerF5TtsStatus {
  if (candidate.knownViVoice) {
    return {
      installed: true,
      running: false,
      version: text(env.STARIZZI_F5_TTS_VERSION) || VIVOICE_VERSION,
      provider: 'F5-TTS',
      modelId: VIVOICE_MODEL_ID,
      modelHash: text(env.STARIZZI_F5_TTS_MODEL_SHA256) || undefined,
      license: VIVOICE_LICENSE,
      licenseSource: VIVOICE_LICENSE_SOURCE,
      commercialUseAllowed: false,
    };
  }

  return {
    installed: true,
    running: false,
    version: text(env.STARIZZI_F5_TTS_VERSION) || undefined,
    provider: text(env.STARIZZI_F5_TTS_PROVIDER) || 'F5-TTS',
    modelId: text(env.STARIZZI_F5_TTS_MODEL_ID) || undefined,
    modelHash: text(env.STARIZZI_F5_TTS_MODEL_SHA256) || undefined,
    license: text(env.STARIZZI_F5_TTS_MODEL_LICENSE) || undefined,
    licenseSource: text(env.STARIZZI_F5_TTS_LICENSE_SOURCE) || undefined,
    commercialUseAllowed: text(env.STARIZZI_F5_TTS_COMMERCIAL_USE_ALLOWED).toLowerCase() === 'true',
  };
}

export function discoverLocalF5TtsRuntime(
  options: F5RuntimeDiscoveryOptions = {},
): F5RuntimeDiscovery {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const homeDir = options.homeDir ?? os.homedir();
  const endpoint = text(env.STARIZZI_F5_TTS_URL) || undefined;
  const configured = explicitCandidate(env, platform);
  const candidate = configured === undefined
    ? discoverKnownCandidate(env, homeDir, platform)
    : configured;

  return {
    status: candidate
      ? statusForCandidate(candidate, env)
      : { installed: false, running: false },
    endpoint,
  };
}
