import { EventEmitter } from 'events';
import { describe, expect, it } from 'vitest';
import { UpdaterService } from './updater-service';

class FakeUpdaterAdapter extends EventEmitter {
  autoDownload = false;
  currentVersion = { version: '0.1.0' };
  quitAndInstallCalls: Array<[boolean | undefined, boolean | undefined]> = [];

  async checkForUpdates(): Promise<void> {
    this.emit('checking-for-update');
    this.emit('update-available', { version: '0.1.1' });
  }

  async downloadUpdate(): Promise<void> {
    this.emit('download-progress', { percent: 40 });
    this.emit('update-downloaded', { version: '0.1.1' });
  }

  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void {
    this.quitAndInstallCalls.push([isSilent, isForceRunAfter]);
    this.emit('quit-and-install');
  }
}

describe('UpdaterService', () => {
  it('tracks updater adapter state transitions', async () => {
    const adapter = new FakeUpdaterAdapter();
    const service = new UpdaterService({
      adapter,
      appVersion: '0.1.0',
      packaged: true,
      mockMode: false,
    });

    await service.check();
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
