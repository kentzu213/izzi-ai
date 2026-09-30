import { EventEmitter } from 'events';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { DesktopUpdaterState } from './types';

interface UpdaterLike extends EventEmitter {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  currentVersion?: { version: string };
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

interface UpdaterServiceOptions {
  adapter?: UpdaterLike;
  appVersion?: string;
  packaged?: boolean;
  mockMode?: boolean;
  directoryPackage?: boolean;
  updateConfigAvailable?: boolean;
  enabled?: boolean;
}

function isTruthy(value: string | undefined): boolean {
  return value === '1' || value === 'true';
}

function pathSegments(value: string): string[] {
  return value
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.toLowerCase());
}

export function isElectronBuilderDirectoryPackage(execPath: string, resourcesPath: string): boolean {
  const resourceSegments = pathSegments(resourcesPath);
  if (resourceSegments.some((segment) => /^(?:win|linux)-unpacked$/.test(segment))) {
    return true;
  }

  const executableSegments = pathSegments(execPath);
  const appBundleIndex = executableSegments.findIndex((segment) => segment.endsWith('.app'));
  if (appBundleIndex < 2) {
    return false;
  }

  return executableSegments[appBundleIndex - 2] === 'release'
    && /^mac(?:-[a-z0-9_-]+)?$/.test(executableSegments[appBundleIndex - 1]);
}

function updaterErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/\bENOENT\b/i.test(message) && /(?:dev-)?app-update\.yml/i.test(message)) {
    return 'Desktop update configuration is unavailable.';
  }
  return message;
}

const NO_PUBLISHED_UPDATE_CODES = new Set([
  'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND',
  'ERR_UPDATER_NO_PUBLISHED_VERSIONS',
  'ERR_UPDATER_LATEST_VERSION_NOT_FOUND',
]);

// The newest release tag has no update manifest yet (a release still being published, or a tag
// without assets). Nothing newer is installable, so this is "up to date", not a failure.
export function isNoPublishedUpdateError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && NO_PUBLISHED_UPDATE_CODES.has(code)) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /Cannot find (?:latest|beta|alpha)[\w-]*\.yml/i.test(message) || /No published versions/i.test(message);
}

function bumpPatch(version: string): string {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return `${version}-next`;
  }

  const [, major, minor, patch] = match;
  return `${major}.${minor}.${Number(patch) + 1}`;
}

function cloneState(state: DesktopUpdaterState): DesktopUpdaterState {
  return { ...state };
}

export class UpdaterService extends EventEmitter {
  private readonly adapter?: UpdaterLike;
  private readonly appVersion: string;
  private readonly mockMode: boolean;
  private readonly packaged: boolean;
  private readonly updateChecksEnabled: boolean;
  private readonly enabled: boolean;
  private state: DesktopUpdaterState;

  constructor(options?: UpdaterServiceOptions) {
    super();

    this.appVersion = options?.appVersion ?? app.getVersion();
    this.packaged = options?.packaged ?? app.isPackaged;
    this.mockMode = options?.mockMode ?? isTruthy(process.env.OPENCLAW_MOCK_UPDATER);
    this.enabled = options?.enabled ?? true;
    const resourcesPath = typeof process.resourcesPath === 'string' ? process.resourcesPath : '';
    const directoryPackage = options?.directoryPackage
      ?? isElectronBuilderDirectoryPackage(process.execPath, resourcesPath);
    const updateConfigAvailable = options?.updateConfigAvailable
      ?? (resourcesPath.length > 0 && existsSync(join(resourcesPath, 'app-update.yml')));
    this.updateChecksEnabled = this.enabled && (!directoryPackage || updateConfigAvailable);
    this.adapter = this.mockMode ? options?.adapter : options?.adapter ?? (autoUpdater as unknown as UpdaterLike);
    this.state = {
      state: 'idle',
      version: this.appVersion,
    };

    if (!this.mockMode && this.updateChecksEnabled) {
      this.bindAdapter();
    }
  }

  getState(): DesktopUpdaterState {
    return cloneState(this.state);
  }

  async check(): Promise<void> {
    if (!this.enabled) return;
    if (!this.packaged && !this.mockMode) {
      this.setState({
        state: 'idle',
        version: this.appVersion,
        checkedAt: new Date().toISOString(),
      });
      return;
    }

    if (this.mockMode) {
      this.setState({
        state: 'checking',
        version: this.appVersion,
        checkedAt: new Date().toISOString(),
      });
      await this.delay(120);
      this.setState({
        state: 'available',
        version: this.appVersion,
        availableVersion: bumpPatch(this.appVersion),
        checkedAt: new Date().toISOString(),
      });
      return;
    }

    if (!this.updateChecksEnabled) {
      this.setState({
        state: 'idle',
        version: this.appVersion,
        checkedAt: new Date().toISOString(),
      });
      return;
    }

    if (!this.adapter) {
      return;
    }

    this.adapter.autoDownload = true;
    this.adapter.autoInstallOnAppQuit = true;
    try {
      await this.adapter.checkForUpdates();
    } catch (err: unknown) {
      if (isNoPublishedUpdateError(err)) {
        this.setState({ state: 'idle', version: this.appVersion, checkedAt: new Date().toISOString() });
        return;
      }
      this.setState({
        state: 'error',
        version: this.appVersion,
        error: updaterErrorMessage(err),
        checkedAt: new Date().toISOString(),
      });
    }
  }

  async download(): Promise<void> {
    if (!this.enabled) return;
    if (this.state.state !== 'available' && this.state.state !== 'error') {
      return;
    }

    if (this.mockMode) {
      for (const progress of [12, 38, 67, 100]) {
        this.setState({
          state: progress === 100 ? 'downloaded' : 'downloading',
          version: this.appVersion,
          availableVersion: this.state.availableVersion ?? bumpPatch(this.appVersion),
          progress,
          checkedAt: new Date().toISOString(),
        });
        await this.delay(90);
      }
      return;
    }

    await this.adapter?.downloadUpdate();
  }

  quitAndInstall(): void {
    if (!this.enabled) return;
    if (this.mockMode) {
      this.setState({
        state: 'idle',
        version: this.state.availableVersion ?? this.appVersion,
        checkedAt: new Date().toISOString(),
      });
      return;
    }

    if (this.state.state === 'downloaded') {
      this.adapter?.quitAndInstall(true, true);
    }
  }

  private bindAdapter(): void {
    if (!this.adapter) {
      return;
    }

    this.adapter.autoDownload = true;
    this.adapter.autoInstallOnAppQuit = true;

    this.adapter.on('checking-for-update', () => {
      this.setState({
        state: 'checking',
        version: this.appVersion,
        checkedAt: new Date().toISOString(),
      });
    });

    this.adapter.on('update-available', (info: { version?: string }) => {
      this.setState({
        state: 'available',
        version: this.appVersion,
        availableVersion: info?.version,
        checkedAt: new Date().toISOString(),
      });
    });

    this.adapter.on('update-not-available', () => {
      this.setState({
        state: 'idle',
        version: this.appVersion,
        checkedAt: new Date().toISOString(),
      });
    });

    this.adapter.on('download-progress', (progress: { percent?: number }) => {
      this.setState({
        state: 'downloading',
        version: this.appVersion,
        availableVersion: this.state.availableVersion,
        progress: typeof progress?.percent === 'number' ? Math.round(progress.percent) : this.state.progress,
        checkedAt: new Date().toISOString(),
      });
    });

    this.adapter.on('update-downloaded', (info: { version?: string }) => {
      this.setState({
        state: 'downloaded',
        version: this.appVersion,
        availableVersion: info?.version ?? this.state.availableVersion,
        progress: 100,
        checkedAt: new Date().toISOString(),
      });
    });

    this.adapter.on('error', (error: Error) => {
      if (isNoPublishedUpdateError(error)) {
        this.setState({ state: 'idle', version: this.appVersion, checkedAt: new Date().toISOString() });
        return;
      }
      this.setState({
        state: 'error',
        version: this.appVersion,
        availableVersion: this.state.availableVersion,
        progress: this.state.progress,
        error: updaterErrorMessage(error),
        checkedAt: new Date().toISOString(),
      });
    });
  }

  private setState(state: DesktopUpdaterState): void {
    this.state = state;
    this.emit('state-changed', cloneState(this.state));
  }

  private async delay(ms: number): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
