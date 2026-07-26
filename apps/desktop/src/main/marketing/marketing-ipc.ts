import { promises as fs } from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'node:url';
import {
  BrowserWindow,
  app,
  dialog,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
} from 'electron';
import type { MarketingPathSelectionResult } from '../../shared/marketing-types';
import { MarketingWorkspaceService } from './marketing-workspace';

const SAFE_OPEN_EXTENSIONS = new Set([
  '.csv',
  '.html',
  '.jpeg',
  '.jpg',
  '.json',
  '.md',
  '.mov',
  '.mp3',
  '.mp4',
  '.pdf',
  '.png',
  '.wav',
  '.webp',
]);

export function isTrustedMarketingSender(event: IpcMainInvokeEvent): boolean {
  const owner = BrowserWindow.fromWebContents(event.sender);
  if (!owner || owner.webContents.id !== event.sender.id) return false;
  if (event.senderFrame?.parent) return false;
  const senderUrl = event.senderFrame?.url || event.sender.getURL();
  try {
    const parsed = new URL(senderUrl);
    if (parsed.protocol === 'file:') {
      const expected = new URL(pathToFileURL(path.resolve(__dirname, '../../renderer/index.html')).href);
      return parsed.pathname === expected.pathname;
    }
    const devRendererEnabled = !app.isPackaged
      && process.env.OPENCLAW_FORCE_PROD_RENDERER !== '1';
    return devRendererEnabled && (
      parsed.origin === 'http://localhost:5173'
      || parsed.origin === 'http://127.0.0.1:5173'
    );
  } catch {
    return false;
  }
}

export function registerMarketingIpc(service: MarketingWorkspaceService): void {
  ipcMain.handle('marketing:getSnapshot', (event) => {
    if (!isTrustedMarketingSender(event)) throw new Error('Marketing IPC sender không hợp lệ.');
    return service.getSnapshot();
  });

  ipcMain.handle('marketing:selectWorkspace', async (event): Promise<MarketingPathSelectionResult> => {
    if (!isTrustedMarketingSender(event)) return { canceled: false, error: 'Marketing IPC sender không hợp lệ.' };
    const parent = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: 'Chọn izziAi Marketing workspace',
      properties: ['openDirectory'] as Array<'openDirectory'>,
    };
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    try {
      return { canceled: false, snapshot: await service.setWorkspacePath(result.filePaths[0]) };
    } catch (error) {
      return { canceled: false, error: error instanceof Error ? error.message : 'Không thể kết nối workspace.' };
    }
  });

  ipcMain.handle('marketing:selectVideoTemplate', async (event): Promise<MarketingPathSelectionResult> => {
    if (!isTrustedMarketingSender(event)) return { canceled: false, error: 'Marketing IPC sender không hợp lệ.' };
    const parent = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: 'Chọn HyperFrames + F5 template',
      properties: ['openDirectory'] as Array<'openDirectory'>,
    };
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    try {
      return { canceled: false, snapshot: await service.setVideoTemplatePath(result.filePaths[0]) };
    } catch (error) {
      return { canceled: false, error: error instanceof Error ? error.message : 'Không thể kết nối video template.' };
    }
  });

  ipcMain.handle('marketing:openPath', async (event, relativePath: string) => {
    if (!isTrustedMarketingSender(event)) return { ok: false, error: 'Marketing IPC sender không hợp lệ.' };
    if (typeof relativePath !== 'string' || !relativePath.trim()) {
      return { ok: false, error: 'Đường dẫn không hợp lệ.' };
    }
    try {
      const target = await service.resolveWorkspaceItem(relativePath);
      const stat = await fs.stat(target);
      if (!stat.isDirectory() && !SAFE_OPEN_EXTENSIONS.has(path.extname(target).toLowerCase())) {
        return { ok: false, error: 'Loại tệp này không được phép mở từ Marketing Room.' };
      }
      const error = await shell.openPath(target);
      return error ? { ok: false, error } : { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : 'Không thể mở đường dẫn.' };
    }
  });
}
