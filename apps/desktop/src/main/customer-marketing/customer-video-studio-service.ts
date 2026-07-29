import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
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
const MAX_ATTESTED_FILE_BYTES = 32 * 1024 * 1024;
const MAX_PREVIEW_OUTPUT_FILES = 16;
const MAX_PREVIEW_OUTPUT_FILE_BYTES = 25 * 1024 * 1024;
const MAX_PREVIEW_OUTPUT_BYTES = 100 * 1024 * 1024;
const PREVIEW_TIMEOUT_MS = 120_000;
const PREVIEW_SNAPSHOT_COUNT = 3;
const PREVIEW_FALLBACK_FRACTIONS = [0.17, 0.53, 0.83] as const;
const HYPERFRAMES_MIN_NODE_MAJOR = 22;
const MANAGED_HYPERFRAMES_VERSION = '0.7.57';
const MANAGED_ELECTRON_ATTESTATION = '0.7.57|20.19.1|34.5.8';
const MANAGED_HYPERFRAMES_ATTESTATION = Object.freeze({
  packageSha256: 'd884bf29732ed60b4e1922f5b88c42ce9887752bc327d6792ed7db8dfc77b2df',
  cliSha256: '8deaf15d5a36e1508a3bd87a4b7d86a7b33eddd13ff08e36f272095f61abb0b2',
});
const PACKAGED_HYPERFRAMES_PACKAGE_SHA256 = 'f435187f26697eccb852288835313ca63286552c016fbfe000c0bc9df8b48fe0';
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
const SERVICE_OWNED_ROOT_FILES = new Set(['starizzi-import.json']);
const SERVICE_OWNED_ROOT_DIRECTORIES = new Set(['snapshots', 'receipts']);
const BLOCKED_EXTENSIONS = new Set(['.bat', '.cmd', '.com', '.dll', '.exe', '.msi', '.ps1', '.sh']);
const SECRET_ENV_PATTERN = /(token|secret|password|credential|api[_-]?key|auth|supabase|openai|izzi)/i;
const MAX_LEGACY_PROJECT_IDS = 20;
const APPROVED_LEGACY_PROJECT_IDS = new Map<string, ReadonlySet<string>>([
  ['izziapi-izzi-ai-howto', new Set(['izziapi-starizzi-howto'])],
]);

interface CommandResult {
  stdout: string;
  stderr: string;
}

interface HyperframesCheckResult {
  passed: boolean;
  errorCount: number;
  warningCount: number;
  reportRaw: string;
}

type HyperframesRuntimeSource = 'system_node' | 'managed_electron';

interface HyperframesCommandRuntime {
  executablePath: string;
  cliPath: string;
  source: HyperframesRuntimeSource;
  nodeVersion: string;
  electronVersion?: string;
  browserPath?: string;
  commercialEligible: boolean;
}

interface RuntimeInspection {
  toolchain: CustomerMediaToolchain;
  hyperframesRuntime?: HyperframesCommandRuntime;
  ffmpegDirectory?: string;
}

interface HyperframesPackageInspection {
  version: string;
  cliPath: string;
}

interface HyperframesRuntimeCandidate {
  runtime?: HyperframesCommandRuntime;
  nodeVersion?: string;
}

interface TrustedDirectory {
  trustedBase: string;
  path: string;
}

interface HyperframesRuntimeProfile extends TrustedDirectory {
  cwd: string;
  home: string;
  appData: string;
  localAppData: string;
  temp: string;
  snapshotRoot: string;
}

interface PreviewRunPaths extends TrustedDirectory {
  snapshotRoot: string;
  checkReportPath: string;
  receiptPath: string;
}

interface CopyBudget {
  files: number;
  bytes: number;
}

export interface CustomerVoiceStudioStatus {
  installed: boolean;
  running: boolean;
  version?: string;
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

export interface CustomerManagedElectronRuntime {
  executablePath: string;
  electronVersion: string;
  nodeVersion: string;
}

export interface CustomerHyperframesAttestation {
  packageSha256: string;
  cliSha256: string;
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
  legacyProjectIds?: string[];
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
  runtimeScratchParent?: string;
  managedElectronRuntime?: CustomerManagedElectronRuntime | null;
  managedBrowserPath?: string | null;
  hyperframesAttestation?: CustomerHyperframesAttestation | null;
  previewTimeoutMs?: number;
  previewMaxOutputBytes?: number;
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

function normalizedVersion(value: unknown): string {
  return textValue(value, 40).replace(/^v/i, '');
}

function nodeMajor(value: unknown): number {
  const major = Number(normalizedVersion(value).split('.')[0]);
  return Number.isInteger(major) && major > 0 ? major : 0;
}

export function supportsManagedHyperframesPreview(
  hyperframesVersion: unknown,
  nodeVersion: unknown,
  electronVersion: unknown,
): boolean {
  const normalizedHyperframes = normalizedVersion(hyperframesVersion);
  const normalizedNode = normalizedVersion(nodeVersion);
  const normalizedElectron = normalizedVersion(electronVersion);
  if (normalizedHyperframes !== MANAGED_HYPERFRAMES_VERSION) return false;
  if (nodeMajor(normalizedNode) >= HYPERFRAMES_MIN_NODE_MAJOR) return true;
  return [normalizedHyperframes, normalizedNode, normalizedElectron].join('|') === MANAGED_ELECTRON_ATTESTATION;
}

function numberValue(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? Math.min(max, Math.max(min, numeric)) : fallback;
}

function previewSnapshotTimestamps(workflow: Record<string, unknown>): number[] {
  const project = objectValue(workflow.project);
  const targetDuration = numberValue(
    project.target_duration_s ?? workflow.duration_s,
    0,
    0,
    3_600,
  );
  const scenes = Array.isArray(workflow.scenes)
    ? workflow.scenes.map((scene) => objectValue(scene))
    : [];
  const sceneDurations = scenes.map((scene) => {
    const duration = Number(scene.minimum_duration_s ?? scene.duration_s);
    return Number.isFinite(duration) && duration > 0 && duration <= 3_600
      ? duration
      : 0;
  });
  const totalSceneDuration = sceneDurations.reduce((sum, duration) => sum + duration, 0);
  const round = (value: number): number => Math.round(value * 1_000) / 1_000;

  if (
    scenes.length >= PREVIEW_SNAPSHOT_COUNT
    && sceneDurations.every((duration) => duration > 0)
    && totalSceneDuration <= 3_600
  ) {
    const midpoints: number[] = [];
    let cursor = 0;
    for (const duration of sceneDurations) {
      midpoints.push(round(cursor + duration / 2));
      cursor += duration;
    }
    const selected = Array.from({ length: PREVIEW_SNAPSHOT_COUNT }, (_, index) => (
      midpoints[Math.floor(index * (midpoints.length - 1) / (PREVIEW_SNAPSHOT_COUNT - 1))]
    ));
    if (
      selected.every((timestamp) => timestamp !== undefined)
      && (targetDuration <= 0 || selected.every((timestamp) => timestamp < targetDuration))
    ) {
      return selected as number[];
    }
  }

  const duration = targetDuration || totalSceneDuration;
  if (duration <= 0) return [];
  const tail = Math.max(0, duration - Math.max(0.05, duration * 0.03));
  return PREVIEW_FALLBACK_FRACTIONS
    .map((fraction) => round(Math.min(tail, duration * fraction)))
    .filter((timestamp, index, values) => timestamp >= 0 && values.indexOf(timestamp) === index);
}

function previewRunId(checkedAt: string): string {
  const compactTimestamp = checkedAt
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
  const entropy = randomUUID().replace(/-/g, '').slice(0, 16);
  return compactTimestamp + '-' + entropy;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64) || 'video-project';
}

function approvedLegacyProjectIds(projectId: string, value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_LEGACY_PROJECT_IDS) {
    throw new Error('Danh sách legacy project ID không hợp lệ.');
  }
  const normalized = Array.from(new Set(value.map((entry) => {
    const declared = textValue(entry, 100);
    if (!declared) throw new Error('Danh sách legacy project ID không hợp lệ.');
    return slug(declared);
  }))).filter((candidate) => candidate !== projectId);
  const approved = APPROVED_LEGACY_PROJECT_IDS.get(projectId);
  if (normalized.some((candidate) => !approved?.has(candidate))) {
    throw new Error('Project khai báo legacy project ID chưa được Izzi AI cho phép.');
  }
  return normalized;
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
  if (code === 'EOUTPUTLIMIT') return new Error(operation + ' tạo quá nhiều log và đã bị dừng.');
  return new Error(operation + ' thất bại. Project vẫn được giữ nguyên để kiểm tra lại.');
}

function countValue(value: unknown): number | undefined {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : undefined;
}

function redactProjectPath(value: unknown, projectRoot: string): unknown {
  if (typeof value === 'string') {
    return value
      .split(projectRoot).join('<project>')
      .split(projectRoot.replace(/\\/g, '/')).join('<project>');
  }
  if (Array.isArray(value)) return value.map((entry) => redactProjectPath(entry, projectRoot));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
      key,
      redactProjectPath(entry, projectRoot),
    ]));
  }
  return value;
}

function parseHyperframesCheckReport(
  stdout: string,
  exitCode: 0 | 1,
  projectRoot: string,
): HyperframesCheckResult {
  let report: Record<string, unknown>;
  try {
    report = objectValue(JSON.parse(stdout));
  } catch {
    throw commandFailure('ECHECKREPORT', 'HyperFrames check did not return valid JSON.');
  }
  const passed = report.ok;
  const strict = report.strict;
  const version = normalizedVersion(objectValue(report._meta).version);
  if (
    typeof passed !== 'boolean'
    || strict !== false
    || version !== MANAGED_HYPERFRAMES_VERSION
    || (exitCode === 0 && !passed)
    || (exitCode === 1 && passed)
  ) {
    throw commandFailure('ECHECKREPORT', 'HyperFrames check report did not match the attested contract.');
  }

  let errorCount = 0;
  let warningCount = 0;
  for (const sectionName of ['lint', 'runtime', 'layout', 'motion', 'contrast'] as const) {
    const section = objectValue(report[sectionName]);
    const sectionErrors = countValue(section.errorCount);
    const sectionWarnings = countValue(section.warningCount);
    if (sectionErrors === undefined || sectionWarnings === undefined) {
      throw commandFailure('ECHECKREPORT', 'HyperFrames check report counters were invalid.');
    }
    errorCount += sectionErrors;
    warningCount += sectionWarnings;
  }
  if (passed !== (errorCount === 0)) {
    throw commandFailure('ECHECKREPORT', 'HyperFrames check report result was inconsistent.');
  }

  return {
    passed,
    errorCount,
    warningCount,
    reportRaw: JSON.stringify(redactProjectPath(report, projectRoot), null, 2),
  };
}

async function fileExists(candidate: string): Promise<boolean> {
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

export async function resolveConfiguredBinaryPath(
  name: string,
  configured: string,
  platform: NodeJS.Platform = process.platform,
): Promise<string | undefined> {
  const resolved = path.resolve(configured);
  try {
    const stat = await fs.stat(resolved);
    if (stat.isFile()) return resolved;
    if (!stat.isDirectory()) return undefined;
  } catch {
    return undefined;
  }

  const candidate = path.join(resolved, platform === 'win32' ? name + '.exe' : name);
  try {
    return (await fs.stat(candidate)).isFile() ? candidate : undefined;
  } catch {
    return undefined;
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

function commandFailure(
  code: string,
  message: string,
  result: Partial<CommandResult> & { exitCode?: number | null; signal?: NodeJS.Signals | null } = {},
): Error {
  return Object.assign(new Error(message), { code, ...result });
}

async function terminateProcessTree(pid: number): Promise<void> {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot || process.env.WINDIR;
    const taskkill = systemRoot ? path.join(systemRoot, 'System32', 'taskkill.exe') : 'taskkill.exe';
    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        resolve();
      };
      let killer;
      try {
        killer = spawn(taskkill, ['/PID', String(pid), '/T', '/F'], {
          windowsHide: true,
          stdio: 'ignore',
        });
      } catch {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // The process already exited.
        }
        finish();
        return;
      }
      killer.once('error', () => {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // The process already exited.
        }
        finish();
      });
      killer.once('close', finish);
      setTimeout(finish, 5_000).unref();
    });
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // The process already exited.
    }
  }
}

function terminateProcessTreeDetached(pid: number): void {
  if (!Number.isInteger(pid) || pid <= 0) return;
  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot || process.env.WINDIR;
    const taskkill = systemRoot ? path.join(systemRoot, 'System32', 'taskkill.exe') : 'taskkill.exe';
    try {
      const killer = spawn(taskkill, ['/PID', String(pid), '/T', '/F'], {
        detached: true,
        windowsHide: true,
        stdio: 'ignore',
      });
      killer.unref();
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // The process already exited.
      }
    }
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // The process already exited.
    }
  }
}

async function runCommand(
  executable: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeout?: number;
    maxOutputBytes?: number;
    killTree?: boolean;
    onSpawn?: (pid: number) => void;
    onExit?: (pid: number) => void;
  } = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const maxOutputBytes = options.maxOutputBytes ?? MAX_COMMAND_OUTPUT;
    const killTree = options.killTree === true;
    let child;
    try {
      child = spawn(executable, args, {
        cwd: options.cwd,
        env: options.env,
        windowsHide: true,
        detached: killTree && process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      reject(error);
      return;
    }

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let ending = false;
    let settled = false;
    const childPid = child.pid;
    if (childPid) options.onSpawn?.(childPid);

    const finish = (action: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (childPid) options.onExit?.(childPid);
      action();
    };
    const stop = async (error: Error): Promise<void> => {
      if (ending || settled) return;
      ending = true;
      if (killTree && child.pid) {
        await terminateProcessTree(child.pid);
      } else {
        try {
          child.kill('SIGKILL');
        } catch {
          // The process already exited.
        }
      }
      finish(() => reject(error));
    };
    const collect = (target: Buffer[], stream: 'stdout' | 'stderr', chunk: Buffer | string): void => {
      if (ending || settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (stream === 'stdout') stdoutBytes += buffer.byteLength;
      else stderrBytes += buffer.byteLength;
      const totalBytes = stdoutBytes + stderrBytes;
      if (
        stdoutBytes > maxOutputBytes
        || stderrBytes > maxOutputBytes
        || totalBytes > maxOutputBytes
      ) {
        void stop(commandFailure('EOUTPUTLIMIT', 'Command output exceeded its configured limit.'));
        return;
      }
      target.push(buffer);
    };

    child.stdout.on('data', (chunk) => collect(stdout, 'stdout', chunk));
    child.stderr.on('data', (chunk) => collect(stderr, 'stderr', chunk));
    child.once('error', (error) => {
      if (ending || settled) return;
      finish(() => reject(error));
    });
    child.once('close', (exitCode, signal) => {
      if (ending || settled) return;
      const result = {
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      };
      if (exitCode !== 0) {
        finish(() => reject(commandFailure(
          'ECOMMAND',
          'Command exited unsuccessfully.',
          { ...result, exitCode, signal },
        )));
        return;
      }
      finish(() => resolve(result));
    });

    const timeout = setTimeout(() => {
      void stop(commandFailure('ETIMEDOUT', 'Command timed out.'));
    }, options.timeout ?? 10_000);
    timeout.unref();
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
  private readonly runtimeScratchParent: string;
  private readonly managedElectronRuntime?: CustomerManagedElectronRuntime;
  private readonly configuredBrowserPath?: string;
  private readonly hyperframesAttestation: CustomerHyperframesAttestation;
  private readonly acceptedHyperframesPackageSha256s: ReadonlySet<string>;
  private readonly previewTimeoutMs: number;
  private readonly previewMaxOutputBytes: number;
  private runtimeCache: { expiresAt: number; value: RuntimeInspection } | null = null;
  private readonly activePreviews = new Set<string>();
  private readonly activeCommandPids = new Set<number>();

  constructor(private readonly options: CustomerVideoStudioOptions) {
    this.rootPath = path.resolve(options.rootPath);
    this.appRoot = path.resolve(options.appRoot);
    this.runtimeScratchParent = path.resolve(
      textValue(options.runtimeScratchParent, 2_000) || os.tmpdir(),
    );
    const processVersions = process.versions as NodeJS.ProcessVersions & { electron?: string };
    const managedRuntime = options.managedElectronRuntime === undefined
      ? processVersions.electron
        ? {
          executablePath: process.execPath,
          electronVersion: processVersions.electron,
          nodeVersion: processVersions.node,
        }
        : undefined
      : options.managedElectronRuntime || undefined;
    this.managedElectronRuntime = managedRuntime
      ? {
        executablePath: path.resolve(managedRuntime.executablePath),
        electronVersion: normalizedVersion(managedRuntime.electronVersion),
        nodeVersion: normalizedVersion(managedRuntime.nodeVersion),
      }
      : undefined;
    const configuredBrowser = options.managedBrowserPath === undefined
      ? textValue(process.env.STARIZZI_HYPERFRAMES_BROWSER, 2_000)
      : textValue(options.managedBrowserPath, 2_000);
    this.configuredBrowserPath = configuredBrowser || undefined;
    const customAttestation = options.hyperframesAttestation || undefined;
    const attestation = customAttestation || MANAGED_HYPERFRAMES_ATTESTATION;
    this.hyperframesAttestation = {
      packageSha256: textValue(attestation.packageSha256, 64).toLowerCase(),
      cliSha256: textValue(attestation.cliSha256, 64).toLowerCase(),
    };
    this.acceptedHyperframesPackageSha256s = new Set(customAttestation
      ? [this.hyperframesAttestation.packageSha256]
      : [this.hyperframesAttestation.packageSha256, PACKAGED_HYPERFRAMES_PACKAGE_SHA256]);
    this.previewTimeoutMs = numberValue(options.previewTimeoutMs, PREVIEW_TIMEOUT_MS, 100, PREVIEW_TIMEOUT_MS);
    this.previewMaxOutputBytes = numberValue(
      options.previewMaxOutputBytes,
      MAX_COMMAND_OUTPUT,
      1_024,
      MAX_COMMAND_OUTPUT,
    );
  }

  async getToolchain(): Promise<CustomerMediaToolchain> {
    return (await this.inspectRuntime()).toolchain;
  }

  killAll(): void {
    for (const pid of this.activeCommandPids) terminateProcessTreeDetached(pid);
    this.activeCommandPids.clear();
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
    const legacyProjectIds = approvedLegacyProjectIds(projectId, project.legacy_ids);
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
        legacyProjectIds,
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
        legacyProjectIds,
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

    const realProjectRoot = await this.trustedProjectRoot(workspaceId, runtimeProjectId);
    const currentDigest = await this.projectDigest(realProjectRoot);
    if (!/^[a-f0-9]{64}$/.test(expectedDigest) || currentDigest !== expectedDigest) {
      throw new Error('Project đã thay đổi sau approval; cần import và duyệt lại.');
    }

    const runtime = await this.inspectRuntime();
    if (!runtime.toolchain.previewAvailable || !runtime.hyperframesRuntime) {
      throw new Error('HyperFrames preview chưa sẵn sàng trên máy này.');
    }

    this.activePreviews.add(operationKey);
    let runtimeProfile: HyperframesRuntimeProfile | undefined;
    let previewRun: PreviewRunPaths | undefined;
    try {
      const checkedAt = new Date().toISOString();
      const runId = previewRunId(checkedAt);
      previewRun = await this.createPreviewRun(workspaceId, runtimeProjectId, runId);
      runtimeProfile = await this.createRuntimeProfile();
      const env = this.commandEnvironment(
        runtime.hyperframesRuntime,
        runtimeProfile,
        runtime.ffmpegDirectory,
      );

      let checkResult: HyperframesCheckResult;
      try {
        checkResult = await this.runHyperframesCheck(
          runtime.hyperframesRuntime,
          realProjectRoot,
          runtimeProfile.cwd,
          env,
        );
        await this.runHyperframesSnapshot(
          runtime.hyperframesRuntime,
          realProjectRoot,
          runtimeProfile.snapshotRoot,
          runtimeProfile.cwd,
          env,
        );
      } catch (error) {
        await this.removeTrustedDirectory(previewRun.trustedBase, previewRun.path);
        throw publicCommandError(error, 'HyperFrames preview');
      }

      let snapshotFiles: Array<{ name: string; data: Buffer }>;
      try {
        snapshotFiles = await this.readValidatedSnapshotOutputs(runtimeProfile.snapshotRoot);
        for (const entry of snapshotFiles) {
          await fs.writeFile(
            path.join(previewRun.snapshotRoot, entry.name),
            entry.data,
            { flag: 'wx' },
          );
        }
        const persistedSnapshots = await this.readValidatedSnapshotOutputs(previewRun.snapshotRoot);
        if (
          persistedSnapshots.length !== snapshotFiles.length
          || persistedSnapshots.some((entry, index) => (
            entry.name !== snapshotFiles[index]?.name
            || !entry.data.equals(snapshotFiles[index]?.data)
          ))
        ) {
          throw new Error('Snapshot output không khớp dữ liệu staging đã xác minh.');
        }
        snapshotFiles = persistedSnapshots;
      } catch (error) {
        await this.removeTrustedDirectory(previewRun.trustedBase, previewRun.path);
        throw error;
      }
      try {
        const frameCount = snapshotFiles.filter((entry) => entry.name.toLowerCase().endsWith('.png')).length;
        const receipt: CustomerMediaPreviewReceipt = {
          checkedAt,
          passed: checkResult.passed,
          summary: checkResult.passed
            ? 'HyperFrames check đạt với '
              + checkResult.warningCount
              + ' cảnh báo; preview cục bộ chưa tạo voice, render hoặc publish.'
            : 'HyperFrames check chưa đạt: '
              + checkResult.errorCount
              + ' lỗi và '
              + checkResult.warningCount
              + ' cảnh báo. Snapshot cục bộ đã được giữ để review; render và publish vẫn khóa.',
          snapshotCount: frameCount,
        };
        const receiptRaw = JSON.stringify(receipt, null, 2);
        await fs.writeFile(
          previewRun.checkReportPath,
          checkResult.reportRaw,
          { encoding: 'utf8', flag: 'wx' },
        );
        await fs.writeFile(previewRun.receiptPath, receiptRaw, { encoding: 'utf8', flag: 'wx' });

        const artifacts: CustomerMediaArtifactDraft[] = [
          {
            kind: 'check_report',
            name: path.basename(previewRun.checkReportPath),
            sha256: sha256(checkResult.reportRaw),
            sizeBytes: Buffer.byteLength(checkResult.reportRaw),
            createdAt: checkedAt,
          },
          {
            kind: 'check_receipt',
            name: path.basename(previewRun.receiptPath),
            sha256: sha256(receiptRaw),
            sizeBytes: Buffer.byteLength(receiptRaw),
            createdAt: checkedAt,
          },
        ];
        for (const entry of snapshotFiles) {
          artifacts.push({
            kind: 'snapshot',
            name: entry.name,
            sha256: sha256(entry.data),
            sizeBytes: entry.data.byteLength,
            createdAt: checkedAt,
          });
        }
        return { receipt, artifacts };
      } catch (error) {
        await this.removeTrustedDirectory(previewRun.trustedBase, previewRun.path);
        throw error;
      }
    } finally {
      if (runtimeProfile) {
        await this.removeTrustedDirectory(runtimeProfile.trustedBase, runtimeProfile.path);
      }
      this.activePreviews.delete(operationKey);
    }
  }

  private projectRoot(workspaceId: string, runtimeProjectId: string): string {
    const candidate = path.resolve(this.rootPath, workspaceId, 'projects', runtimeProjectId);
    if (!isInside(this.rootPath, candidate)) throw new Error('Media workspace path không hợp lệ.');
    return candidate;
  }

  private async trustedProjectRoot(workspaceId: string, runtimeProjectId: string): Promise<string> {
    const projectsRoot = await this.ensureTrustedDirectory(
      [workspaceId, 'projects'],
      'Media workspace',
    );
    const candidate = path.join(projectsRoot.path, runtimeProjectId);
    const stat = await fs.lstat(candidate);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('Media project không phải thư mục tin cậy.');
    }
    const realProjectRoot = await fs.realpath(candidate);
    if (!isInside(projectsRoot.path, realProjectRoot)) {
      throw new Error('Media project nằm ngoài workspace hiện tại.');
    }
    return realProjectRoot;
  }

  private async ensureTrustedDirectoryFromRoot(
    rootPath: string,
    segments: string[],
    label: string,
  ): Promise<TrustedDirectory> {
    await fs.mkdir(rootPath, { recursive: true });
    const rootStat = await fs.lstat(rootPath);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
      throw new Error(label + ' root không phải thư mục tin cậy.');
    }
    const trustedBase = await fs.realpath(rootPath);
    let current = trustedBase;
    for (const segment of segments) {
      if (
        !segment
        || segment === '.'
        || segment === '..'
        || path.basename(segment) !== segment
      ) {
        throw new Error(label + ' path không hợp lệ.');
      }
      const candidate = path.join(current, segment);
      try {
        await fs.mkdir(candidate);
      } catch (error) {
        if (objectValue(error).code !== 'EEXIST') throw error;
      }
      const stat = await fs.lstat(candidate);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error(label + ' chứa junction hoặc symbolic link.');
      }
      const realCandidate = await fs.realpath(candidate);
      if (!isInside(trustedBase, realCandidate) || !isInside(current, realCandidate)) {
        throw new Error(label + ' chuyển hướng ra ngoài thư mục tin cậy.');
      }
      current = realCandidate;
    }
    return { trustedBase, path: current };
  }

  private async ensureTrustedDirectory(segments: string[], label: string): Promise<TrustedDirectory> {
    return this.ensureTrustedDirectoryFromRoot(this.rootPath, segments, label);
  }

  private async createPreviewRun(
    workspaceId: string,
    runtimeProjectId: string,
    runId: string,
  ): Promise<PreviewRunPaths> {
    const outputBase = await this.ensureTrustedDirectory(
      [workspaceId, 'preview-runs', runtimeProjectId],
      'Media preview output',
    );
    const run = await this.ensureTrustedDirectory(
      [workspaceId, 'preview-runs', runtimeProjectId, runId],
      'Media preview output',
    );
    const snapshots = await this.ensureTrustedDirectory(
      [workspaceId, 'preview-runs', runtimeProjectId, runId, 'snapshots'],
      'Media preview output',
    );
    if (!isInside(outputBase.path, run.path) || !isInside(run.path, snapshots.path)) {
      throw new Error('Media preview output không nằm trong run đã xác minh.');
    }
    return {
      trustedBase: outputBase.path,
      path: run.path,
      snapshotRoot: snapshots.path,
      checkReportPath: path.join(run.path, 'hyperframes-check.json'),
      receiptPath: path.join(run.path, 'receipt.json'),
    };
  }

  private async createRuntimeProfile(): Promise<HyperframesRuntimeProfile> {
    const scratchParent = await this.ensureTrustedDirectoryFromRoot(
      this.runtimeScratchParent,
      [],
      'HyperFrames runtime',
    );
    const candidate = await fs.mkdtemp(path.join(scratchParent.path, 'izzi-ai-hf-'));
    let runtimeRoot: string | undefined;
    try {
      const rootStat = await fs.lstat(candidate);
      if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
        throw new Error('HyperFrames runtime không phải thư mục tạm tin cậy.');
      }
      runtimeRoot = await fs.realpath(candidate);
      if (
        runtimeRoot === scratchParent.path
        || !isInside(scratchParent.path, runtimeRoot)
      ) {
        throw new Error('HyperFrames runtime chuyển hướng ra ngoài thư mục tạm tin cậy.');
      }
      const directory = (name: string): Promise<TrustedDirectory> => (
        this.ensureTrustedDirectoryFromRoot(runtimeRoot as string, [name], 'HyperFrames runtime')
      );
      const cwd = await directory('cwd');
      const home = await directory('home');
      const appData = await directory('appdata');
      const localAppData = await directory('localappdata');
      const temp = await directory('temp');
      const snapshotRoot = await directory('snapshots');
      return {
        trustedBase: scratchParent.path,
        path: runtimeRoot,
        cwd: cwd.path,
        home: home.path,
        appData: appData.path,
        localAppData: localAppData.path,
        temp: temp.path,
        snapshotRoot: snapshotRoot.path,
      };
    } catch (error) {
      if (runtimeRoot) {
        await this.removeTrustedDirectory(scratchParent.path, runtimeRoot);
      }
      throw error;
    }
  }

  private async removeTrustedDirectory(trustedBase: string, candidate: string): Promise<void> {
    let stat;
    try {
      stat = await fs.lstat(candidate);
    } catch (error) {
      if (objectValue(error).code === 'ENOENT') return;
      throw error;
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error('Không thể dọn thư mục đã bị chuyển hướng.');
    }
    const realBase = await fs.realpath(trustedBase);
    const realCandidate = await fs.realpath(candidate);
    if (realCandidate === realBase || !isInside(realBase, realCandidate)) {
      throw new Error('Không thể dọn thư mục nằm ngoài runtime tin cậy.');
    }
    await fs.rm(realCandidate, { recursive: true, force: true });
  }

  private async readValidatedSnapshotOutputs(
    snapshotRoot: string,
  ): Promise<Array<{ name: string; data: Buffer }>> {
    const rootStat = await fs.lstat(snapshotRoot);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
      throw new Error('Snapshot output không phải thư mục tin cậy.');
    }
    const realSnapshotRoot = await fs.realpath(snapshotRoot);
    const entries = (await fs.readdir(realSnapshotRoot, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name));
    if (entries.length === 0 || entries.length > MAX_PREVIEW_OUTPUT_FILES) {
      throw new Error('Snapshot output có số lượng file không hợp lệ.');
    }

    let totalBytes = 0;
    const outputs: Array<{ name: string; data: Buffer }> = [];
    for (const entry of entries) {
      const lowerName = entry.name.toLowerCase();
      const allowedName = lowerName.endsWith('.png') || lowerName === 'contact-sheet.jpg';
      if (!entry.isFile() || !allowedName) {
        throw new Error('Snapshot output chứa file không được phép: ' + entry.name);
      }
      const candidate = path.join(realSnapshotRoot, entry.name);
      const stat = await fs.lstat(candidate);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error('Snapshot output chứa link hoặc loại file không hợp lệ.');
      }
      const realCandidate = await fs.realpath(candidate);
      if (!isInside(realSnapshotRoot, realCandidate)) {
        throw new Error('Snapshot output chuyển hướng ra ngoài run hiện tại.');
      }
      totalBytes += stat.size;
      if (
        stat.size <= 0
        || stat.size > MAX_PREVIEW_OUTPUT_FILE_BYTES
        || totalBytes > MAX_PREVIEW_OUTPUT_BYTES
      ) {
        throw new Error('Snapshot output vượt giới hạn dung lượng an toàn.');
      }
      const data = await fs.readFile(realCandidate);
      const isPng = lowerName.endsWith('.png')
        && data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
      const isJpeg = lowerName === 'contact-sheet.jpg'
        && data.byteLength >= 3
        && data[0] === 0xff
        && data[1] === 0xd8
        && data[2] === 0xff;
      if (!isPng && !isJpeg) {
        throw new Error('Snapshot output không khớp định dạng ảnh đã cho phép.');
      }
      outputs.push({ name: entry.name, data });
    }
    if (!outputs.some((entry) => entry.name.toLowerCase().endsWith('.png'))) {
      throw new Error('Snapshot output không có frame PNG.');
    }
    return outputs;
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
        const source = path.join(current, entry.name);
        const relative = path.posix.join(relativeRoot.replace(/\\/g, '/'), entry.name);
        const stat = await fs.lstat(source);
        if (stat.isSymbolicLink()) throw new Error('Project chứa symbolic link và không thể xác minh.');
        if (!relativeRoot) {
          if (SERVICE_OWNED_ROOT_FILES.has(normalizedName)) {
            if (!stat.isFile()) throw new Error('Project chứa metadata service không hợp lệ.');
            continue;
          }
          if (SERVICE_OWNED_ROOT_DIRECTORIES.has(normalizedName)) {
            if (!stat.isDirectory()) throw new Error('Project chứa thư mục service không hợp lệ.');
            const realServiceDirectory = await fs.realpath(source);
            if (!isInside(projectRoot, realServiceDirectory)) {
              throw new Error('Project chứa thư mục service chuyển hướng ra ngoài.');
            }
            continue;
          }
          if (!ALLOWED_ROOT_FILES.has(normalizedName) && !ALLOWED_ROOT_DIRECTORIES.has(normalizedName)) {
            throw new Error('Project chứa entry root không được phép: ' + entry.name);
          }
          if (ALLOWED_ROOT_FILES.has(normalizedName) && !stat.isFile()) {
            throw new Error('Project chứa file root không hợp lệ: ' + entry.name);
          }
          if (ALLOWED_ROOT_DIRECTORIES.has(normalizedName) && !stat.isDirectory()) {
            throw new Error('Project chứa thư mục root không hợp lệ: ' + entry.name);
          }
        }
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

  private async inspectHyperframesPackage(): Promise<HyperframesPackageInspection | undefined> {
    const packagePath = path.join(this.appRoot, 'node_modules', 'hyperframes', 'package.json');
    const hyperframesRoot = path.dirname(packagePath);
    if (
      ![...this.acceptedHyperframesPackageSha256s].every((digest) => /^[a-f0-9]{64}$/.test(digest))
      || !/^[a-f0-9]{64}$/.test(this.hyperframesAttestation.cliSha256)
    ) {
      return undefined;
    }
    try {
      const packageStat = await fs.lstat(packagePath);
      if (
        packageStat.isSymbolicLink()
        || !packageStat.isFile()
        || packageStat.size > 1024 * 1024
      ) {
        return undefined;
      }
      const packageBytes = await fs.readFile(packagePath);
      if (!this.acceptedHyperframesPackageSha256s.has(sha256(packageBytes))) return undefined;
      const packageJson = objectValue(JSON.parse(packageBytes.toString('utf8')));
      const packageName = textValue(packageJson.name, 80);
      const packageVersion = normalizedVersion(packageJson.version);
      const configuredBin = textValue(objectValue(packageJson.bin).hyperframes, 240);
      const license = textValue(packageJson.license, 80);
      const nodeEngine = textValue(objectValue(packageJson.engines).node, 80);
      if (
        packageName !== 'hyperframes'
        || packageVersion !== MANAGED_HYPERFRAMES_VERSION
        || configuredBin !== './dist/cli.js'
        || license !== 'Apache-2.0'
        || nodeEngine !== '>=22'
      ) {
        return undefined;
      }

      const candidateCli = path.resolve(hyperframesRoot, configuredBin);
      const expectedCli = path.resolve(hyperframesRoot, 'dist', 'cli.js');
      if (candidateCli !== expectedCli) return undefined;
      const cliStat = await fs.lstat(candidateCli);
      if (
        cliStat.isSymbolicLink()
        || !cliStat.isFile()
        || cliStat.size > MAX_ATTESTED_FILE_BYTES
      ) {
        return undefined;
      }
      const realHyperframesRoot = await fs.realpath(hyperframesRoot);
      const realCli = await fs.realpath(candidateCli);
      if (!isInside(realHyperframesRoot, realCli)) return undefined;
      const cliBytes = await fs.readFile(realCli);
      if (sha256(cliBytes) !== this.hyperframesAttestation.cliSha256) return undefined;
      return { version: packageVersion, cliPath: realCli };
    } catch {
      return undefined;
    }
  }

  private async resolveTrustedExecutable(configured: string): Promise<string | undefined> {
    const resolved = path.resolve(configured);
    try {
      const stat = await fs.lstat(resolved);
      if (stat.isSymbolicLink() || !stat.isFile()) return undefined;
      return await fs.realpath(resolved);
    } catch {
      return undefined;
    }
  }

  private async resolveManagedBrowser(): Promise<string | undefined> {
    if (!this.configuredBrowserPath) return undefined;
    return this.resolveTrustedExecutable(this.configuredBrowserPath);
  }

  private browserDiscoveryEnvironment(runtime: HyperframesCommandRuntime): NodeJS.ProcessEnv {
    const allowed = new Set([
      'ALLUSERSPROFILE', 'APPDATA', 'CommonProgramFiles', 'CommonProgramFiles(x86)',
      'ComSpec', 'HOME', 'HOMEDRIVE', 'HOMEPATH', 'LANG', 'LC_ALL', 'LOCALAPPDATA',
      'NUMBER_OF_PROCESSORS', 'OS', 'PATHEXT', 'PROCESSOR_ARCHITECTURE', 'ProgramData',
      'ProgramFiles', 'ProgramFiles(x86)', 'SystemDrive', 'SystemRoot', 'TEMP', 'TMP',
      'USERPROFILE', 'WINDIR', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME',
    ]);
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (allowed.has(key) && value && !SECRET_ENV_PATTERN.test(key)) env[key] = value;
    }
    const systemDirectory = env.SystemRoot ? path.join(env.SystemRoot, 'System32') : undefined;
    env.PATH = [path.dirname(runtime.executablePath), systemDirectory]
      .filter((value): value is string => Boolean(value))
      .map((value) => path.resolve(value))
      .join(path.delimiter);
    if (runtime.source === 'managed_electron') env.ELECTRON_RUN_AS_NODE = '1';
    env.HYPERFRAMES_NO_TELEMETRY = '1';
    env.DO_NOT_TRACK = '1';
    env.HYPERFRAMES_NO_UPDATE_CHECK = '1';
    env.HYPERFRAMES_NO_AUTO_INSTALL = '1';
    env.CI = '1';
    env.NO_COLOR = '1';
    env.NO_PROXY = '127.0.0.1,localhost,::1';
    env.HTTP_PROXY = 'http://127.0.0.1:9';
    env.HTTPS_PROXY = 'http://127.0.0.1:9';
    env.ALL_PROXY = 'http://127.0.0.1:9';
    return env;
  }

  private async discoverManagedBrowser(
    runtime: HyperframesCommandRuntime,
  ): Promise<string | undefined> {
    try {
      const result = await runCommand(runtime.executablePath, [
        runtime.cliPath,
        'browser',
        'path',
      ], {
        cwd: path.dirname(runtime.executablePath),
        env: this.browserDiscoveryEnvironment(runtime),
        timeout: 10_000,
        maxOutputBytes: 64 * 1024,
        killTree: true,
        onSpawn: (pid) => this.activeCommandPids.add(pid),
        onExit: (pid) => this.activeCommandPids.delete(pid),
      });
      const candidate = result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
      return candidate ? this.resolveTrustedExecutable(candidate) : undefined;
    } catch {
      return undefined;
    }
  }

  private async inspectRuntime(): Promise<RuntimeInspection> {
    if (this.runtimeCache && this.runtimeCache.expiresAt > Date.now()) return this.runtimeCache.value;
    const hyperframesPackage = await this.inspectHyperframesPackage();
    const configuredBrowserPath = await this.resolveManagedBrowser();
    const configuredNode = textValue(process.env.STARIZZI_HYPERFRAMES_NODE, 2_000);
    let nodeVersion: string | undefined;
    let hyperframesRuntime: HyperframesCommandRuntime | undefined;
    if (hyperframesPackage) {
      if (configuredNode) {
        const candidate = await this.inspectConfiguredNodeRuntime(
          hyperframesPackage,
          configuredBrowserPath,
          configuredNode,
        );
        hyperframesRuntime = candidate.runtime;
        nodeVersion = candidate.nodeVersion;
      }
      if (!hyperframesRuntime) {
        hyperframesRuntime = await this.inspectManagedElectronRuntime(
          hyperframesPackage,
          configuredBrowserPath,
        );
        if (hyperframesRuntime) nodeVersion = hyperframesRuntime.nodeVersion;
      }
      if (hyperframesRuntime && !hyperframesRuntime.browserPath) {
        const discoveredBrowserPath = await this.discoverManagedBrowser(hyperframesRuntime);
        if (discoveredBrowserPath) {
          hyperframesRuntime = { ...hyperframesRuntime, browserPath: discoveredBrowserPath };
        }
      }
    }
    const nodeReady = hyperframesRuntime?.source === 'system_node';
    const browserPath = hyperframesRuntime?.browserPath;

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
      && Boolean(
        voiceStudioEvidence.modelId
        && voiceStudioEvidence.modelHash
        && voiceStudioEvidence.licenseSource
        && voiceStudioEvidence.license
      )
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
      hyperframes: !hyperframesPackage
        ? {
          status: 'needs_setup',
          detail: 'HyperFrames trong Izzi AI không khớp package và CLI attestation đã pin.',
        }
        : !hyperframesRuntime
          ? {
            status: 'needs_setup',
            version: hyperframesPackage.version,
            detail: 'Không tìm thấy runtime HyperFrames tương thích đã xác minh.',
          }
          : !browserPath
          ? {
            status: 'needs_setup',
            version: hyperframesPackage.version,
            detail: 'Cần cài Chrome Headless Shell bằng HyperFrames trước khi preview; Izzi AI không tự tải browser.',
          }
          : {
            status: 'ready',
            version: hyperframesPackage.version,
            detail: 'HyperFrames package, CLI và browser đã được xác minh cho local preview.',
          },
      node: hyperframesRuntime?.source === 'managed_electron'
        ? {
          status: 'ready',
          version: hyperframesRuntime.nodeVersion,
          detail: 'Runtime preview do Izzi AI quản lý chỉ được attested cho check/snapshot; render thương mại vẫn khóa.',
        }
        : nodeReady
          ? { status: 'ready', version: nodeVersion, detail: 'Node đáp ứng yêu cầu HyperFrames.' }
          : {
            status: 'blocked',
            version: nodeVersion,
            detail: configuredNode
              ? 'Node đã cấu hình không đáp ứng HyperFrames; hãy dùng Node 22 trở lên.'
              : 'Không tìm thấy Node 22 trở lên hoặc runtime preview Izzi AI tương thích.',
          },
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
      previewAvailable: Boolean(hyperframesRuntime?.browserPath),
      commercialRenderAvailable: Boolean(
        hyperframesRuntime?.browserPath
          && hyperframesRuntime.commercialEligible
          && ffmpegPath
          && ffprobePath
          && (f5Commercial || voiceStudioCommercial),
      ),
    };
    const value: RuntimeInspection = {
      toolchain,
      hyperframesRuntime,
      ffmpegDirectory: ffmpegPath ? path.dirname(ffmpegPath) : undefined,
    };
    this.runtimeCache = { expiresAt: Date.now() + 15_000, value };
    return value;
  }

  private async findBinary(name: string, configured?: string): Promise<string | undefined> {
    if (configured) {
      const candidate = await resolveConfiguredBinaryPath(name, configured);
      if (candidate) return candidate;
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

  private async inspectManagedElectronRuntime(
    hyperframesPackage: HyperframesPackageInspection,
    browserPath?: string,
  ): Promise<HyperframesCommandRuntime | undefined> {
    const managed = this.managedElectronRuntime;
    const executablePath = managed
      ? await this.resolveTrustedExecutable(managed.executablePath)
      : undefined;
    if (
      !managed
      || !executablePath
      || !supportsManagedHyperframesPreview(
        hyperframesPackage.version,
        managed.nodeVersion,
        managed.electronVersion,
      )
    ) {
      return undefined;
    }
    const runtime: HyperframesCommandRuntime = {
      executablePath,
      cliPath: hyperframesPackage.cliPath,
      source: 'managed_electron',
      nodeVersion: 'v' + normalizedVersion(managed.nodeVersion),
      electronVersion: normalizedVersion(managed.electronVersion),
      browserPath,
      commercialEligible: false,
    };
    const profile = await this.createRuntimeProfile();
    try {
      const probe = await runCommand(runtime.executablePath, [runtime.cliPath, '--version'], {
        cwd: profile.cwd,
        env: this.commandEnvironment(runtime, profile),
        timeout: 10_000,
        maxOutputBytes: 64 * 1024,
        killTree: true,
        onSpawn: (pid) => this.activeCommandPids.add(pid),
        onExit: (pid) => this.activeCommandPids.delete(pid),
      });
      return normalizedVersion(probe.stdout) === hyperframesPackage.version ? runtime : undefined;
    } catch {
      return undefined;
    } finally {
      await this.removeTrustedDirectory(profile.trustedBase, profile.path);
    }
  }

  private async inspectConfiguredNodeRuntime(
    hyperframesPackage: HyperframesPackageInspection,
    browserPath: string | undefined,
    configuredNode: string,
  ): Promise<HyperframesRuntimeCandidate> {
    const configuredPath = await resolveConfiguredBinaryPath('node', configuredNode);
    const executablePath = configuredPath
      ? await this.resolveTrustedExecutable(configuredPath)
      : undefined;
    if (!executablePath) return {};

    const profile = await this.createRuntimeProfile();
    const runtime: HyperframesCommandRuntime = {
      executablePath,
      cliPath: hyperframesPackage.cliPath,
      source: 'system_node',
      nodeVersion: '',
      browserPath,
      commercialEligible: true,
    };
    try {
      const env = this.commandEnvironment(runtime, profile);
      const nodeProbe = await runCommand(executablePath, ['--version'], {
        cwd: profile.cwd,
        env,
        timeout: 10_000,
        maxOutputBytes: 64 * 1024,
        killTree: true,
        onSpawn: (pid) => this.activeCommandPids.add(pid),
        onExit: (pid) => this.activeCommandPids.delete(pid),
      });
      const nodeVersion = nodeProbe.stdout.trim();
      if (nodeMajor(nodeVersion) < HYPERFRAMES_MIN_NODE_MAJOR) return { nodeVersion };
      runtime.nodeVersion = nodeVersion;
      const cliProbe = await runCommand(executablePath, [runtime.cliPath, '--version'], {
        cwd: profile.cwd,
        env,
        timeout: 10_000,
        maxOutputBytes: 64 * 1024,
        killTree: true,
        onSpawn: (pid) => this.activeCommandPids.add(pid),
        onExit: (pid) => this.activeCommandPids.delete(pid),
      });
      if (normalizedVersion(cliProbe.stdout) !== hyperframesPackage.version) {
        return { nodeVersion };
      }
      return { runtime, nodeVersion };
    } catch {
      return {};
    } finally {
      await this.removeTrustedDirectory(profile.trustedBase, profile.path);
    }
  }

  private async runHyperframesCheck(
    runtime: HyperframesCommandRuntime,
    projectRoot: string,
    cwd: string,
    env: NodeJS.ProcessEnv,
  ): Promise<HyperframesCheckResult> {
    try {
      const result = await runCommand(runtime.executablePath, [
        runtime.cliPath,
        'check',
        '--json',
        '--samples',
        '5',
        projectRoot,
      ], {
        cwd,
        env,
        timeout: this.previewTimeoutMs,
        maxOutputBytes: this.previewMaxOutputBytes,
        killTree: true,
        onSpawn: (pid) => this.activeCommandPids.add(pid),
        onExit: (pid) => this.activeCommandPids.delete(pid),
      });
      return parseHyperframesCheckReport(result.stdout, 0, projectRoot);
    } catch (error) {
      const failure = objectValue(error);
      if (
        failure.code === 'ECOMMAND'
        && failure.exitCode === 1
        && typeof failure.stdout === 'string'
      ) {
        return parseHyperframesCheckReport(failure.stdout, 1, projectRoot);
      }
      throw error;
    }
  }

  private async runHyperframesSnapshot(
    runtime: HyperframesCommandRuntime,
    projectRoot: string,
    outputRoot: string,
    cwd: string,
    env: NodeJS.ProcessEnv,
  ): Promise<CommandResult> {
    const workflow = await readJson(path.join(projectRoot, 'video-workflow.json'));
    const timestamps = previewSnapshotTimestamps(workflow.data);
    const sampleArgs = timestamps.length > 0
      ? [
        '--at',
        timestamps.map((timestamp) => String(timestamp)).join(','),
        '--no-end',
      ]
      : ['--frames', String(PREVIEW_SNAPSHOT_COUNT)];
    return runCommand(runtime.executablePath, [
      runtime.cliPath,
      'snapshot',
      ...sampleArgs,
      '--output',
      outputRoot,
      '--describe',
      'false',
      projectRoot,
    ], {
      cwd,
      env,
      timeout: this.previewTimeoutMs,
      maxOutputBytes: this.previewMaxOutputBytes,
      killTree: true,
      onSpawn: (pid) => this.activeCommandPids.add(pid),
      onExit: (pid) => this.activeCommandPids.delete(pid),
    });
  }

  private commandEnvironment(
    runtime: HyperframesCommandRuntime,
    profile: HyperframesRuntimeProfile,
    ffmpegDirectory?: string,
  ): NodeJS.ProcessEnv {
    const allowed = new Set([
      'ALLUSERSPROFILE', 'CommonProgramFiles', 'CommonProgramFiles(x86)', 'ComSpec',
      'LANG', 'LC_ALL', 'NUMBER_OF_PROCESSORS', 'OS', 'PATHEXT',
      'PROCESSOR_ARCHITECTURE', 'ProgramData', 'ProgramFiles', 'ProgramFiles(x86)',
      'SystemDrive', 'SystemRoot', 'WINDIR',
    ]);
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (
        allowed.has(key)
        && value
        && !SECRET_ENV_PATTERN.test(key)
      ) {
        env[key] = value;
      }
    }
    const systemDirectory = env.SystemRoot ? path.join(env.SystemRoot, 'System32') : undefined;
    const pathParts = [
      ffmpegDirectory,
      runtime.browserPath ? path.dirname(runtime.browserPath) : undefined,
      path.dirname(runtime.executablePath),
      systemDirectory,
    ]
      .filter((value): value is string => Boolean(value));
    env.PATH = [...new Set(pathParts.map((value) => path.resolve(value)))].join(path.delimiter);
    if (runtime.source === 'managed_electron') env.ELECTRON_RUN_AS_NODE = '1';
    env.HOME = profile.home;
    env.USERPROFILE = profile.home;
    env.APPDATA = profile.appData;
    env.LOCALAPPDATA = profile.localAppData;
    env.TEMP = profile.temp;
    env.TMP = profile.temp;
    env.XDG_CONFIG_HOME = path.join(profile.home, '.config');
    env.XDG_CACHE_HOME = path.join(profile.home, '.cache');
    env.HYPERFRAMES_NO_TELEMETRY = '1';
    env.DO_NOT_TRACK = '1';
    env.HYPERFRAMES_NO_UPDATE_CHECK = '1';
    env.HYPERFRAMES_NO_AUTO_INSTALL = '1';
    if (runtime.browserPath) {
      env.HYPERFRAMES_BROWSER_PATH = runtime.browserPath;
      env.PRODUCER_HEADLESS_SHELL_PATH = runtime.browserPath;
    }
    env.CI = '1';
    env.NO_COLOR = '1';
    env.NO_PROXY = '127.0.0.1,localhost,::1';
    env.HTTP_PROXY = 'http://127.0.0.1:9';
    env.HTTPS_PROXY = 'http://127.0.0.1:9';
    env.ALL_PROXY = 'http://127.0.0.1:9';
    return env;
  }
}
