import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type {
  CustomerMediaArtifactKind,
  CustomerMediaPreviewReceipt,
  CustomerMediaToolchain,
  CustomerMediaVoicePolicy,
} from '../../shared/customer-marketing-types';

const MAX_PROJECT_FILES = 2_500;
const MAX_PROJECT_BYTES = 250 * 1024 * 1024;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
const MAX_COMMAND_OUTPUT = 1024 * 1024;
const PREVIEW_TIMEOUT_MS = 120_000;
const WORKSPACE_ID = /^customer-[a-f0-9]{12}$/;
const RUNTIME_PROJECT_ID = /^[a-f0-9-]{36}$/;
const ALLOWED_ROOT_FILES = new Set([
  'video-workflow.json',
  'hyperframes.json',
  'index.html',
  'package.json',
  'meta.json',
  'metadata.json',
  'frame.md',
  'brief.md',
  'storyboard.md',
  'script.md',
]);
const ALLOWED_ROOT_DIRECTORIES = new Set(['assets', 'compositions', 'public', 'src']);
const BLOCKED_EXTENSIONS = new Set(['.bat', '.cmd', '.com', '.dll', '.exe', '.msi', '.ps1', '.sh']);
const SECRET_ENV_PATTERN = /(token|secret|password|credential|api[_-]?key|auth|supabase|openai|izzi)/i;

interface CommandResult {
  stdout: string;
  stderr: string;
}

interface RuntimeInspection {
  toolchain: CustomerMediaToolchain;
  nodePath?: string;
  hyperframesCliPath?: string;
  ffmpegDirectory?: string;
}

interface CopyBudget {
  files: number;
  bytes: number;
}

export interface CustomerVoiceStudioStatus {
  installed: boolean;
  running: boolean;
  version?: string;
  // CMR-007: Voice Studio may also carry a commercially usable license chain. The evidence
  // shape matches the F5 slot so the commercial gate stays provider-agnostic and fail-closed.
  provider?: string;
  modelId?: string;
  modelHash?: string;
  license?: string;
  licenseSource?: string;
  commercialUseAllowed?: boolean;
}

export interface CustomerF5TtsStatus {
  installed: boolean;
  running: boolean;
  version?: string;
  detail?: string;
  provider?: string;
  modelId?: string;
  modelHash?: string;
  license?: string;
  licenseSource?: string;
  commercialUseAllowed?: boolean;
}

export interface CustomerMediaArtifactDraft {
  kind: CustomerMediaArtifactKind;
  name: string;
  sha256?: string;
  sizeBytes?: number;
  createdAt: string;
}

export interface CustomerMediaImportedProject {
  runtimeProjectId: string;
  projectId: string;
  title: string;
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  sceneCount: number;
  voice: CustomerMediaVoicePolicy;
  evidenceDigest: string;
  importedAt: string;
  artifact: CustomerMediaArtifactDraft;
}

export interface CustomerMediaPreviewResult {
  receipt: CustomerMediaPreviewReceipt;
  artifacts: CustomerMediaArtifactDraft[];
}

export interface CustomerVideoStudioOptions {
  rootPath: string;
  appRoot: string;
  getVoiceStudioStatus?: () => CustomerVoiceStudioStatus | Promise<CustomerVoiceStudioStatus>;
  getF5TtsStatus?: () => CustomerF5TtsStatus | Promise<CustomerF5TtsStatus>;
  verifyCommercialVoiceLicense?: (evidence: {
    provider: string;
    modelId?: string;
    modelHash?: string;
    license?: string;
    licenseSource?: string;
  }) => boolean;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function textValue(value: unknown, max = 240): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function publicRuntimeVersion(value: unknown): string | undefined {
  const version = textValue(value, 40);
  return /^[a-z0-9][a-z0-9._+ -]{0,39}$/i.test(version) ? version : undefined;
}

function numberValue(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'video-project';
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function isNonCommercialLicense(license: string): boolean {
  return /(^|[-_ ])NC($|[-_ ])/i.test(license) || /noncommercial/i.test(license);
}

function isInside(base: string, candidate: string): boolean {
  const relative = path.relative(base, candidate);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function publicCommandError(error: unknown, operation: string): Error {
  const code = objectValue(error).code;
  if (code === 'ETIMEDOUT') return new Error(operation + ' quá thời gian cho phép.');
  return new Error(operation + ' thất bại. Project vẫn được giữ nguyên để kiểm tra lại.');
}

async function fileExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function readJson(candidate: string, maxBytes = 1024 * 1024): Promise<{ raw: string; data: Record<string, unknown> }> {
  const stat = await fs.stat(candidate);
  if (!stat.isFile() || stat.size > maxBytes) throw new Error('Manifest media không hợp lệ hoặc quá lớn.');
  const raw = await fs.readFile(candidate, 'utf8');
  try {
    return { raw, data: objectValue(JSON.parse(raw)) };
  } catch {
    throw new Error('Manifest media không phải JSON hợp lệ.');
  }
}

async function runCommand(
  executable: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number } = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(executable, args, {
      cwd: options.cwd,
      env: options.env,
      timeout: options.timeout ?? 10_000,
      maxBuffer: MAX_COMMAND_OUTPUT,
      windowsHide: true,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

export interface CustomerVideoStudioRuntime {
  getToolchain(): Promise<CustomerMediaToolchain>;
  importProject(workspaceId: string, candidate: string): Promise<CustomerMediaImportedProject>;
  runPreview(workspaceId: string, runtimeProjectId: string, expectedDigest: string): Promise<CustomerMediaPreviewResult>;
}
export class CustomerVideoStudioService implements CustomerVideoStudioRuntime {
  private readonly rootPath: string;
  private readonly appRoot: string;
  private runtimeCache: { expiresAt: number; value: RuntimeInspection } | null = null;
  private readonly activePreviews = new Set<string>();

  constructor(private readonly options: CustomerVideoStudioOptions) {
    this.rootPath = path.resolve(options.rootPath);
    this.appRoot = path.resolve(options.appRoot);
  }

  async getToolchain(): Promise<CustomerMediaToolchain> {
    return (await this.inspectRuntime()).toolchain;
  }

  async importProject(workspaceId: string, candidate: string): Promise<CustomerMediaImportedProject> {
    this.assertWorkspaceId(workspaceId);
    const sourceRoot = await fs.realpath(path.resolve(candidate));
    const sourceStat = await fs.stat(sourceRoot);
    if (!sourceStat.isDirectory()) throw new Error('Hãy chọn một thư mục HyperFrames hợp lệ.');

    const workflowPath = path.join(sourceRoot, 'video-workflow.json');
    const hyperframesPath = path.join(sourceRoot, 'hyperframes.json');
    if (!(await fileExists(workflowPath)) || !(await fileExists(hyperframesPath))) {
      throw new Error('Project cần có video-workflow.json và hyperframes.json.');
    }

    const workflow = await readJson(workflowPath);
    const project = objectValue(workflow.data.project);
    const voice = objectValue(workflow.data.voice);
    const authorization = objectValue(workflow.data.authorization);
    const scenes = Array.isArray(workflow.data.scenes) ? workflow.data.scenes : [];
    const runtimeProjectId = randomUUID();
    const projectId = slug(textValue(project.id, 100) || path.basename(sourceRoot));
    const importedAt = new Date().toISOString();
    const destinationRoot = this.projectRoot(workspaceId, runtimeProjectId);

    await fs.mkdir(destinationRoot, { recursive: true });
    try {
      const budget: CopyBudget = { files: 0, bytes: 0 };
      for (const entry of await fs.readdir(sourceRoot, { withFileTypes: true })) {
        const normalizedName = entry.name.toLowerCase();
        if (entry.isFile() && ALLOWED_ROOT_FILES.has(normalizedName)) {
          await this.copySafeEntry(path.join(sourceRoot, entry.name), path.join(destinationRoot, entry.name), budget);
        } else if (entry.isDirectory() && ALLOWED_ROOT_DIRECTORIES.has(normalizedName)) {
          await this.copySafeEntry(path.join(sourceRoot, entry.name), path.join(destinationRoot, entry.name), budget);
        } else if (entry.isSymbolicLink()) {
          throw new Error('Project chứa symbolic link và không thể import an toàn.');
        }
      }

      const copiedWorkflow = path.join(destinationRoot, 'video-workflow.json');
      if (!(await fileExists(copiedWorkflow))) throw new Error('Không copy được manifest media.');
      const evidenceDigest = await this.projectDigest(destinationRoot);
      await fs.writeFile(path.join(destinationRoot, 'starizzi-import.json'), JSON.stringify({
        version: 1,
        runtimeProjectId,
        projectId,
        evidenceDigest,
        importedAt,
      }, null, 2), 'utf8');

      const provider = textValue(voice.provider, 120) || 'unassigned';
      const modelId = textValue(voice.model_id, 160) || undefined;
      const modelHash = textValue(voice.model_sha256, 128) || undefined;
      const license = textValue(voice.model_license, 160) || undefined;
      const licenseSource = textValue(voice.license_source, 500) || undefined;
      const verifiedCommercial = this.options.verifyCommercialVoiceLicense?.({
        provider,
        modelId,
        modelHash,
        license,
        licenseSource,
      }) === true;

      return {
        runtimeProjectId,
        projectId,
        title: textValue(workflow.data.title, 160) || projectId,
        width: numberValue(project.width, 1080, 320, 7680),
        height: numberValue(project.height, 1920, 320, 7680),
        fps: numberValue(project.fps, 30, 1, 120),
        durationSeconds: numberValue(project.target_duration_s ?? workflow.data.duration_s, 0, 0, 3600),
        sceneCount: Math.min(scenes.length, 500),
        voice: {
          provider,
          modelId,
          modelHash,
          license,
          licenseSource,
          commercialUseAllowed: verifiedCommercial
            && Boolean(license)
            && !isNonCommercialLicense(license || '')
            && authorization.commercial_use_allowed === true,
          referenceVoiceConsent: authorization.voice_clone_authorized_by_user === true,
        },
        evidenceDigest,
        importedAt,
        artifact: {
          kind: 'project_manifest',
          name: 'video-workflow.json',
          sha256: evidenceDigest,
          sizeBytes: Buffer.byteLength(workflow.raw),
          createdAt: importedAt,
        },
      };
    } catch (error) {
      await fs.rm(destinationRoot, { recursive: true, force: true });
      throw error;
    }
  }

  async runPreview(workspaceId: string, runtimeProjectId: string, expectedDigest: string): Promise<CustomerMediaPreviewResult> {
    this.assertWorkspaceId(workspaceId);
    if (!RUNTIME_PROJECT_ID.test(runtimeProjectId)) throw new Error('Media project ID không hợp lệ.');
    const operationKey = workspaceId + ':' + runtimeProjectId;
    if (this.activePreviews.has(operationKey)) throw new Error('Project này đang được kiểm tra.');

    const projectRoot = this.projectRoot(workspaceId, runtimeProjectId);
    const realProjectRoot = await fs.realpath(projectRoot);
    const workspaceRoot = path.join(this.rootPath, workspaceId, 'projects');
    if (!isInside(workspaceRoot, realProjectRoot)) throw new Error('Media project nằm ngoài workspace hiện tại.');
    const currentDigest = await this.projectDigest(realProjectRoot);
    if (!/^[a-f0-9]{64}$/.test(expectedDigest) || currentDigest !== expectedDigest) {
      throw new Error('Project đã thay đổi sau approval; cần import và duyệt lại.');
    }

    const runtime = await this.inspectRuntime();
    if (!runtime.toolchain.previewAvailable || !runtime.nodePath || !runtime.hyperframesCliPath) {
      throw new Error('HyperFrames preview chưa sẵn sàng trên máy này.');
    }

    this.activePreviews.add(operationKey);
    try {
      const checkedAt = new Date().toISOString();
      const timestamp = checkedAt.replace(/[:.]/g, '-');
      const snapshotRoot = path.join(realProjectRoot, 'snapshots', 'starizzi-' + timestamp);
      const receiptRoot = path.join(realProjectRoot, 'receipts');
      await fs.mkdir(snapshotRoot, { recursive: true });
      await fs.mkdir(receiptRoot, { recursive: true });
      const env = this.previewEnvironment(runtime);

      try {
        await runCommand(runtime.nodePath, [
          runtime.hyperframesCliPath,
          'check',
          '--json',
          '--samples',
          '5',
          realProjectRoot,
        ], { cwd: realProjectRoot, env, timeout: PREVIEW_TIMEOUT_MS });
        await runCommand(runtime.nodePath, [
          runtime.hyperframesCliPath,
          'snapshot',
          '--frames',
          '3',
          '--output',
          snapshotRoot,
          '--describe',
          'false',
          realProjectRoot,
        ], { cwd: realProjectRoot, env, timeout: PREVIEW_TIMEOUT_MS });
      } catch (error) {
        throw publicCommandError(error, 'HyperFrames preview');
      }

      const snapshotFiles = (await fs.readdir(snapshotRoot, { withFileTypes: true }))
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.png'));
      const receipt: CustomerMediaPreviewReceipt = {
        checkedAt,
        passed: true,
        summary: 'HyperFrames check hoàn tất; preview cục bộ chưa tạo voice, render hoặc publish.',
        snapshotCount: snapshotFiles.length,
      };
      const receiptPath = path.join(receiptRoot, 'check-' + timestamp + '.json');
      const receiptRaw = JSON.stringify(receipt, null, 2);
      await fs.writeFile(receiptPath, receiptRaw, 'utf8');

      const artifacts: CustomerMediaArtifactDraft[] = [{
        kind: 'check_receipt',
        name: path.basename(receiptPath),
        sha256: sha256(receiptRaw),
        sizeBytes: Buffer.byteLength(receiptRaw),
        createdAt: checkedAt,
      }];
      for (const entry of snapshotFiles) {
        const snapshotPath = path.join(snapshotRoot, entry.name);
        if (!isInside(realProjectRoot, snapshotPath)) throw new Error('Snapshot output không hợp lệ.');
        const data = await fs.readFile(snapshotPath);
        artifacts.push({
          kind: 'snapshot',
          name: entry.name,
          sha256: sha256(data),
          sizeBytes: data.byteLength,
          createdAt: checkedAt,
        });
      }
      return { receipt, artifacts };
    } finally {
      this.activePreviews.delete(operationKey);
    }
  }

  private projectRoot(workspaceId: string, runtimeProjectId: string): string {
    const candidate = path.resolve(this.rootPath, workspaceId, 'projects', runtimeProjectId);
    if (!isInside(this.rootPath, candidate)) throw new Error('Media workspace path không hợp lệ.');
    return candidate;
  }

  private assertWorkspaceId(workspaceId: string): void {
    if (!WORKSPACE_ID.test(workspaceId)) throw new Error('Customer workspace ID không hợp lệ.');
  }

  private async projectDigest(projectRoot: string): Promise<string> {
    const digest = createHash('sha256');
    const budget: CopyBudget = { files: 0, bytes: 0 };
    const visit = async (current: string, relativeRoot: string): Promise<void> => {
      const entries = (await fs.readdir(current, { withFileTypes: true }))
        .sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        const normalizedName = entry.name.toLowerCase();
        if (!relativeRoot
          && !ALLOWED_ROOT_FILES.has(normalizedName)
          && !ALLOWED_ROOT_DIRECTORIES.has(normalizedName)) continue;
        const source = path.join(current, entry.name);
        const relative = path.posix.join(relativeRoot.replace(/\\/g, '/'), entry.name);
        const stat = await fs.lstat(source);
        if (stat.isSymbolicLink()) throw new Error('Project chứa symbolic link và không thể xác minh.');
        if (stat.isDirectory()) {
          await visit(source, relative);
          continue;
        }
        if (!stat.isFile()) throw new Error('Project chứa loại file không được hỗ trợ.');
        budget.files += 1;
        budget.bytes += stat.size;
        if (budget.files > MAX_PROJECT_FILES || budget.bytes > MAX_PROJECT_BYTES || stat.size > MAX_FILE_BYTES) {
          throw new Error('Project vượt giới hạn xác minh an toàn.');
        }
        digest.update(relative);
        digest.update('\0');
        digest.update(await fs.readFile(source));
        digest.update('\0');
      }
    };
    await visit(projectRoot, '');
    return digest.digest('hex');
  }
  private async copySafeEntry(source: string, destination: string, budget: CopyBudget): Promise<void> {
    const stat = await fs.lstat(source);
    if (stat.isSymbolicLink()) throw new Error('Project chứa symbolic link và không thể import an toàn.');
    if (stat.isDirectory()) {
      await fs.mkdir(destination, { recursive: true });
      for (const entry of await fs.readdir(source)) {
        await this.copySafeEntry(path.join(source, entry), path.join(destination, entry), budget);
      }
      return;
    }
    if (!stat.isFile()) throw new Error('Project chứa loại file không được hỗ trợ.');
    const lowerName = path.basename(source).toLowerCase();
    if (lowerName.startsWith('.env') || BLOCKED_EXTENSIONS.has(path.extname(lowerName))) {
      throw new Error('Project chứa file thực thi hoặc file môi trường không được phép import.');
    }
    budget.files += 1;
    budget.bytes += stat.size;
    if (budget.files > MAX_PROJECT_FILES || budget.bytes > MAX_PROJECT_BYTES || stat.size > MAX_FILE_BYTES) {
      throw new Error('Project vượt giới hạn import an toàn.');
    }
    await fs.copyFile(source, destination);
  }

  private async inspectRuntime(): Promise<RuntimeInspection> {
    if (this.runtimeCache && this.runtimeCache.expiresAt > Date.now()) return this.runtimeCache.value;
    const hyperframesPackagePath = path.join(this.appRoot, 'node_modules', 'hyperframes', 'package.json');
    let hyperframesVersion: string | undefined;
    let hyperframesCliPath: string | undefined;
    try {
      const packageJson = await readJson(hyperframesPackagePath);
      hyperframesVersion = textValue(packageJson.data.version, 40) || undefined;
      const configuredBin = objectValue(packageJson.data.bin).hyperframes;
      const relativeCli = textValue(configuredBin, 240) || 'dist/cli.js';
      const candidateCli = path.resolve(path.dirname(hyperframesPackagePath), relativeCli);
      if (await fileExists(candidateCli)) hyperframesCliPath = candidateCli;
    } catch {
      hyperframesVersion = undefined;
    }

    const nodePath = await this.findBinary('node', process.env.STARIZZI_HYPERFRAMES_NODE);
    let nodeVersion: string | undefined;
    let nodeReady = false;
    if (nodePath) {
      try {
        nodeVersion = (await runCommand(nodePath, ['--version'])).stdout.trim();
        nodeReady = Number(nodeVersion.replace(/^v/, '').split('.')[0]) >= 22;
      } catch {
        nodeReady = false;
      }
    }

    const ffmpegPath = await this.findBinary('ffmpeg', process.env.STARIZZI_FFMPEG_BIN);
    const ffprobePath = await this.findBinary('ffprobe', process.env.STARIZZI_FFPROBE_BIN);
    let ffmpegVersion: string | undefined;
    if (ffmpegPath && ffprobePath) {
      try {
        const firstLine = (await runCommand(ffmpegPath, ['-version'])).stdout.split(/\r?\n/)[0] || '';
        ffmpegVersion = firstLine.match(/ffmpeg version\s+([^\s]+)/i)?.[1];
      } catch {
        ffmpegVersion = undefined;
      }
    }

    const envConfigured = Boolean(process.env.STARIZZI_F5_TTS_URL && process.env.STARIZZI_F5_TTS_MODEL_ID);
    let f5Runtime: CustomerF5TtsStatus = { installed: envConfigured, running: envConfigured };
    if (this.options.getF5TtsStatus) {
      try {
        f5Runtime = await this.options.getF5TtsStatus();
      } catch {
        f5Runtime = { installed: false, running: false };
      }
    }
    let voiceStudio: CustomerVoiceStudioStatus = { installed: false, running: false };
    if (this.options.getVoiceStudioStatus) {
      try {
        voiceStudio = await this.options.getVoiceStudioStatus();
      } catch {
        voiceStudio = { installed: false, running: false };
      }
    }
    const f5Evidence = {
      provider: textValue(f5Runtime.provider, 120)
        || textValue(process.env.STARIZZI_F5_TTS_PROVIDER, 120)
        || 'F5-TTS',
      modelId: textValue(f5Runtime.modelId, 160)
        || textValue(process.env.STARIZZI_F5_TTS_MODEL_ID, 160)
        || undefined,
      modelHash: textValue(f5Runtime.modelHash, 128)
        || textValue(process.env.STARIZZI_F5_TTS_MODEL_SHA256, 128)
        || undefined,
      license: textValue(f5Runtime.license, 160)
        || textValue(process.env.STARIZZI_F5_TTS_MODEL_LICENSE, 160)
        || undefined,
      licenseSource: textValue(f5Runtime.licenseSource, 500)
        || textValue(process.env.STARIZZI_F5_TTS_LICENSE_SOURCE, 500)
        || undefined,
    };
    const f5Configured = Boolean(f5Evidence.modelId && (f5Runtime.running || process.env.STARIZZI_F5_TTS_URL));
    const f5CommercialDeclared = f5Runtime.commercialUseAllowed === true
      || process.env.STARIZZI_F5_TTS_COMMERCIAL_USE_ALLOWED === 'true';
    const f5Commercial = f5Configured
      && f5Runtime.installed
      && f5Runtime.running
      && f5CommercialDeclared
      && Boolean(f5Evidence.modelHash && f5Evidence.licenseSource && f5Evidence.license)
      && !isNonCommercialLicense(f5Evidence.license || '')
      && this.options.verifyCommercialVoiceLicense?.(f5Evidence) === true;

    // CMR-007: the commercial voice gate is provider-agnostic. Voice Studio (VieNeu-TTS,
    // Apache-2.0 chain) must clear the same bar as the F5 slot: the caller reports `running`
    // only after the TTS backend itself answers readiness (not merely the extension host),
    // plus declared commercial intent, full evidence, no non-commercial marker, and an audited
    // license chain confirmed by the injected verifier.
    const voiceStudioEvidence = {
      provider: textValue(voiceStudio.provider, 120) || 'voice-studio',
      modelId: textValue(voiceStudio.modelId, 160) || undefined,
      modelHash: textValue(voiceStudio.modelHash, 128) || undefined,
      license: textValue(voiceStudio.license, 160) || undefined,
      licenseSource: textValue(voiceStudio.licenseSource, 500) || undefined,
    };
    const voiceStudioCommercial = voiceStudio.installed
      && voiceStudio.running
      && voiceStudio.commercialUseAllowed === true
      && Boolean(voiceStudioEvidence.modelId && voiceStudioEvidence.modelHash && voiceStudioEvidence.licenseSource && voiceStudioEvidence.license)
      && !isNonCommercialLicense(voiceStudioEvidence.license || '')
      && this.options.verifyCommercialVoiceLicense?.(voiceStudioEvidence) === true;

    const f5Version = publicRuntimeVersion(f5Runtime.version);
    let f5Tts: CustomerMediaToolchain['f5Tts'];
    if (!f5Runtime.installed) {
      f5Tts = { status: 'needs_setup', detail: 'Chưa tìm thấy F5-TTS local đã xác minh.' };
    } else if (!f5Runtime.running) {
      f5Tts = {
        status: 'needs_setup',
        version: f5Version,
        detail: 'F5-TTS local đã cài nhưng service chưa chạy. Commercial render vẫn khóa.',
      };
    } else if (!f5Configured) {
      f5Tts = {
        status: 'needs_setup',
        version: f5Version,
        detail: 'F5-TTS local đã cài nhưng chưa có endpoint và model metadata.',
      };
    } else if (f5Commercial) {
      f5Tts = {
        status: 'ready',
        version: f5Version,
        detail: 'F5-TTS có bằng chứng license thương mại đã xác minh.',
      };
    } else if (isNonCommercialLicense(f5Evidence.license || '')) {
      f5Tts = {
        status: 'ready',
        version: f5Version,
        detail: 'F5-TTS local đang chạy với model phi thương mại; commercial render vẫn khóa.',
      };
    } else {
      f5Tts = {
        status: 'ready',
        version: f5Version,
        detail: 'F5-TTS local đang chạy nhưng chưa có đủ bằng chứng license thương mại đã xác minh.',
      };
    }

    const toolchain: CustomerMediaToolchain = {
      hyperframes: hyperframesCliPath
        ? { status: 'ready', version: hyperframesVersion, detail: 'HyperFrames được pin trong Izzi AI.' }
        : { status: 'needs_setup', detail: 'Chưa tìm thấy HyperFrames runtime trong Izzi AI.' },
      node: nodeReady
        ? { status: 'ready', version: nodeVersion, detail: 'Node đáp ứng yêu cầu HyperFrames.' }
        : { status: 'blocked', version: nodeVersion, detail: 'HyperFrames cần Node 22 trở lên.' },
      ffmpeg: ffmpegPath && ffprobePath
        ? { status: 'ready', version: ffmpegVersion, detail: 'FFmpeg và FFprobe đã được phát hiện.' }
        : { status: 'needs_setup', detail: 'Cần cấu hình FFmpeg và FFprobe trước khi render.' },
      f5Tts,
      voiceStudio: voiceStudio.running
        ? {
          status: 'ready',
          version: publicRuntimeVersion(voiceStudio.version),
          detail: voiceStudioCommercial
            ? 'Voice Studio local đang chạy với model có bằng chứng license thương mại đã xác minh.'
            : 'Voice Studio local đang chạy nhưng chưa có đủ bằng chứng license thương mại đã xác minh.',
        }
        : voiceStudio.installed
          ? { status: 'needs_setup', version: publicRuntimeVersion(voiceStudio.version), detail: 'Voice Studio đã cài nhưng chưa chạy.' }
          : { status: 'needs_setup', detail: 'Voice Studio chưa được cài.' },
      previewAvailable: Boolean(hyperframesCliPath && nodeReady),
      commercialRenderAvailable: Boolean(
        hyperframesCliPath && nodeReady && ffmpegPath && ffprobePath && (f5Commercial || voiceStudioCommercial),
      ),
    };
    const value: RuntimeInspection = {
      toolchain,
      nodePath: nodeReady ? nodePath : undefined,
      hyperframesCliPath,
      ffmpegDirectory: ffmpegPath ? path.dirname(ffmpegPath) : undefined,
    };
    this.runtimeCache = { expiresAt: Date.now() + 15_000, value };
    return value;
  }

  private async findBinary(name: string, configured?: string): Promise<string | undefined> {
    if (configured) {
      const resolved = path.resolve(configured);
      const candidate = path.extname(resolved) ? resolved : path.join(resolved, process.platform === 'win32' ? name + '.exe' : name);
      if (await fileExists(candidate)) return candidate;
    }
    try {
      const command = process.platform === 'win32' ? 'where.exe' : 'which';
      const output = (await runCommand(command, [name])).stdout;
      const candidate = output.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
      return candidate && await fileExists(candidate) ? candidate : undefined;
    } catch {
      return undefined;
    }
  }

  private previewEnvironment(runtime: RuntimeInspection): NodeJS.ProcessEnv {
    const allowed = new Set([
      'ALLUSERSPROFILE', 'APPDATA', 'CommonProgramFiles', 'CommonProgramFiles(x86)',
      'ComSpec', 'HOMEDRIVE', 'HOMEPATH', 'LOCALAPPDATA', 'NUMBER_OF_PROCESSORS',
      'OS', 'PATH', 'PATHEXT', 'PROCESSOR_ARCHITECTURE', 'ProgramData', 'ProgramFiles',
      'ProgramFiles(x86)', 'SystemDrive', 'SystemRoot', 'TEMP', 'TMP', 'USERPROFILE', 'WINDIR',
    ]);
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (allowed.has(key) && value && !SECRET_ENV_PATTERN.test(key)) env[key] = value;
    }
    const pathParts = [runtime.ffmpegDirectory, runtime.nodePath ? path.dirname(runtime.nodePath) : undefined, env.PATH]
      .filter((value): value is string => Boolean(value));
    env.PATH = pathParts.join(path.delimiter);
    env.NO_PROXY = '127.0.0.1,localhost,::1';
    env.HTTP_PROXY = 'http://127.0.0.1:9';
    env.HTTPS_PROXY = 'http://127.0.0.1:9';
    env.ALL_PROXY = 'http://127.0.0.1:9';
    return env;
  }
}
