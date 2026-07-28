import { EventEmitter } from 'events';
import { app } from 'electron';
import { autoUpdater } from 'electron-updater';
import type { DesktopUpdaterState } from './types';

interface UpdaterLike extends EventEmitter {
  autoDownload: boolean;
  currentVersion?: { version: string };
  checkForUpdates(): Promise<unknown>;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

function isTruthy(value: string | undefined): boolean {
  return value === '1' || value === 'true';
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
  private state: DesktopUpdaterState;

  constructor(options?: { adapter?: UpdaterLike; appVersion?: string; packaged?: boolean; mockMode?: boolean }) {
    super();

    this.appVersion = options?.appVersion ?? app.getVersion();
    this.packaged = options?.packaged ?? app.isPackaged;
    this.mockMode = options?.mockMode ?? isTruthy(process.env.OPENCLAW_MOCK_UPDATER);
    this.adapter = this.mockMode ? options?.adapter : options?.adapter ?? (autoUpdater as unknown as UpdaterLike);
    this.state = {
      state: 'idle',
      version: this.appVersion,
    };

    if (!this.mockMode) {
      this.bindAdapter();
    }
  }

  getState(): DesktopUpdaterState {
    return cloneState(this.state);
  }

  async check(): Promise<void> {
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

    if (!this.adapter) {
      return;
    }

    this.adapter.autoDownload = false;
    try {
      await this.adapter.checkForUpdates();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.setState({
        state: 'error',
        version: this.appVersion,
        error: message,
        checkedAt: new Date().toISOString(),
      });
    }
  }

  async download(): Promise<void> {
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

    this.adapter.autoDownload = false;

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
      this.setState({
        state: 'error',
        version: this.appVersion,
        availableVersion: this.state.availableVersion,
        progress: this.state.progress,
        error: error.message,
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
