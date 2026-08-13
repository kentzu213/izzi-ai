import { EventEmitter } from 'events';
import { describe, expect, it } from 'vitest';
import { isElectronBuilderDirectoryPackage, UpdaterService } from './updater-service';

class FakeUpdaterAdapter extends EventEmitter {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  currentVersion = { version: '0.1.0' };
  checkForUpdatesCalls = 0;
  downloadUpdateCalls = 0;
  quitAndInstallCalls: Array<[boolean | undefined, boolean | undefined]> = [];

  async checkForUpdates(): Promise<void> {
    this.checkForUpdatesCalls += 1;
    this.emit('checking-for-update');
    this.emit('update-available', { version: '0.1.1' });
    if (this.autoDownload) {
      await this.downloadUpdate();
    }
  }

  async downloadUpdate(): Promise<void> {
    this.downloadUpdateCalls += 1;
    this.emit('download-progress', { percent: 40 });
    this.emit('update-downloaded', { version: '0.1.1' });
  }

  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
    this.quitAndInstallCalls.push([isSilent, isForceRunAfter]);
    this.emit('quit-and-install');
  }
}

class MissingConfigUpdaterAdapter extends FakeUpdaterAdapter {
  async checkForUpdates(): Promise<void> {
    this.checkForUpdatesCalls += 1;
    const error = new Error(
      "ENOENT: no such file or directory, open 'F:\\release\\win-unpacked\\resources\\app-update.yml'",
    );
    this.emit('error', error);
    throw error;
  }
}

describe('UpdaterService', () => {
  it('does not bind, check, download or install when the runtime profile disables updates', async () => {
    const adapter = new FakeUpdaterAdapter();
    const service = new UpdaterService({
      adapter,
      appVersion: '0.1.0',
      packaged: true,
      mockMode: false,
      enabled: false,
    });

    await service.check();
    await service.download();
    service.quitAndInstall();

    expect(adapter.autoDownload).toBe(false);
    expect(adapter.autoInstallOnAppQuit).toBe(false);
    expect(adapter.checkForUpdatesCalls).toBe(0);
    expect(adapter.downloadUpdateCalls).toBe(0);
    expect(adapter.quitAndInstallCalls).toEqual([]);
    expect(service.getState()).toMatchObject({ state: 'idle', version: '0.1.0' });
  });

  it('downloads installed-package updates in the background and installs them on normal quit', async () => {
    const adapter = new FakeUpdaterAdapter();
    const service = new UpdaterService({
      adapter,
      appVersion: '0.1.0',
      packaged: true,
      mockMode: false,
    });

    expect(adapter.autoDownload).toBe(true);
    expect(adapter.autoInstallOnAppQuit).toBe(true);

    await service.check();

    expect(adapter.autoDownload).toBe(true);
    expect(adapter.autoInstallOnAppQuit).toBe(true);
    expect(adapter.downloadUpdateCalls).toBe(1);
    expect(service.getState()).toMatchObject({
      state: 'downloaded',
      availableVersion: '0.1.1',
      progress: 100,
    });
  });

  it('detects electron-builder directory packages without matching installed app paths', () => {
    expect(isElectronBuilderDirectoryPackage(
      'F:\\repo\\apps\\desktop\\release\\win-unpacked\\Izzi AI.exe',
      'F:\\repo\\apps\\desktop\\release\\win-unpacked\\resources',
    )).toBe(true);
    expect(isElectronBuilderDirectoryPackage(
      '/repo/apps/desktop/release/linux-unpacked/izzi-ai',
      '/repo/apps/desktop/release/linux-unpacked/resources',
    )).toBe(true);
    expect(isElectronBuilderDirectoryPackage(
      '/repo/apps/desktop/release/mac-arm64/Izzi AI.app/Contents/MacOS/Izzi AI',
      '/repo/apps/desktop/release/mac-arm64/Izzi AI.app/Contents/Resources',
    )).toBe(true);
    expect(isElectronBuilderDirectoryPackage(
      'C:\\Program Files\\Izzi AI\\Izzi AI.exe',
      'C:\\Program Files\\Izzi AI\\resources',
    )).toBe(false);
    expect(isElectronBuilderDirectoryPackage(
      '/Applications/Izzi AI.app/Contents/MacOS/Izzi AI',
      '/Applications/Izzi AI.app/Contents/Resources',
    )).toBe(false);
    expect(isElectronBuilderDirectoryPackage(
      '/Users/demo/Desktop/Izzi AI.app/Contents/MacOS/Izzi AI',
      '/Users/demo/Desktop/Izzi AI.app/Contents/Resources',
    )).toBe(false);
  });

  it('skips update checks for a directory package that has no update config', async () => {
    const adapter = new MissingConfigUpdaterAdapter();
    const service = new UpdaterService({
      adapter,
      appVersion: '0.1.0',
      packaged: true,
      mockMode: false,
      directoryPackage: true,
      updateConfigAvailable: false,
    });

    await service.check();

    expect(adapter.checkForUpdatesCalls).toBe(0);
    expect(service.getState()).toMatchObject({
      state: 'idle',
      version: '0.1.0',
    });
    expect(service.getState().error).toBeUndefined();
  });

  it('keeps an installed-package config failure actionable without exposing its local path', async () => {
    const adapter = new MissingConfigUpdaterAdapter();
    const service = new UpdaterService({
      adapter,
      appVersion: '0.1.0',
      packaged: true,
      mockMode: false,
      directoryPackage: false,
      updateConfigAvailable: false,
    });

    await service.check();

    expect(adapter.checkForUpdatesCalls).toBe(1);
    expect(service.getState()).toMatchObject({
      state: 'error',
      version: '0.1.0',
      error: 'Desktop update configuration is unavailable.',
    });
    expect(service.getState().error).not.toContain('F:\\');
  });

  it('tracks updater adapter state transitions', async () => {
    const adapter = new FakeUpdaterAdapter();
    const service = new UpdaterService({
      adapter,
      appVersion: '0.1.0',
      packaged: true,
      mockMode: false,
    });

    adapter.emit('checking-for-update');
    adapter.emit('update-available', { version: '0.1.1' });
    expect(service.getState()).toMatchObject({
      state: 'available',
      version: '0.1.0',
      availableVersion: '0.1.1',
    });

    await service.download();
    expect(service.getState()).toMatchObject({
      state: 'downloaded',
      availableVersion: '0.1.1',
      progress: 100,
    });
  });

  it('simulates deterministic update flow in mock mode', async () => {
    const service = new UpdaterService({
      appVersion: '0.4.0',
      packaged: false,
      mockMode: true,
    });

    await service.check();
    expect(service.getState()).toMatchObject({
      state: 'available',
      version: '0.4.0',
      availableVersion: '0.4.1',
    });

    await service.download();
    expect(service.getState()).toMatchObject({
      state: 'downloaded',
      availableVersion: '0.4.1',
      progress: 100,
    });
  });

  it('installs a downloaded update silently and relaunches the app', async () => {
    const adapter = new FakeUpdaterAdapter();
    const service = new UpdaterService({
      adapter,
      appVersion: '0.1.0',
      packaged: true,
      mockMode: false,
    });

    await service.check();
    await service.download();
    service.quitAndInstall();

    expect(adapter.quitAndInstallCalls).toEqual([[true, true]]);
  });
});
