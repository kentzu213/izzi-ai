/**
 * QuickCaptureMiniController — lightweight PC/Mac "mini-app" popup + System Tray
 * + global shortcut (`CommandOrControl+Shift+I`) hosted INSIDE the single Izzi AI
 * App binary (same auth, same SQLite WAL, same VaultSyncEngine, no 2nd installer).
 *
 * Security: uses identical hardened `webPreferences` (`contextIsolation: true`,
 * `nodeIntegration: false`, shared preload). Cleans up globalShortcut & Tray on quit.
 *
 * @module main/quick-capture-window
 */

import * as path from 'node:path';
import {
  BrowserWindow,
  Menu,
  Tray,
  globalShortcut,
  ipcMain,
  type NativeImage,
} from 'electron';
import { isTrustedMarketingSender as isTrustedRendererSender } from './marketing/marketing-ipc';

export interface QuickCaptureOptions {
  isDev: boolean;
  forceProdRenderer: boolean;
  preloadPath: string;
  rendererHtmlPath: string;
  appIcon: NativeImage | null;
  /** Set false when the host app already owns a single System Tray icon (beta.133+). */
  registerTray?: boolean;
  onShowMainWindow: () => void;
  onSyncNow: () => void;
  onQuit: () => void;
}

export const QUICK_CAPTURE_SHORTCUT = 'CommandOrControl+Shift+I';

export class QuickCaptureMiniController {
  private win: BrowserWindow | null = null;
  private tray: Tray | null = null;
  private shortcutRegistered = false;

  constructor(private readonly opts: QuickCaptureOptions) {}

  init(): void {
    // 1. Register global shortcut (best-effort — another app may already hold it).
    try {
      this.shortcutRegistered = globalShortcut.register(QUICK_CAPTURE_SHORTCUT, () => {
        this.toggle();
      });
    } catch {
      this.shortcutRegistered = false;
    }

    // 2. Register System Tray icon only when host app does not already own one.
    if (this.opts.registerTray !== false && this.opts.appIcon && !this.opts.appIcon.isEmpty()) {
      try {
        const trayIcon = this.opts.appIcon.resize({ width: 16, height: 16 });
        this.tray = new Tray(trayIcon);
        this.tray.setToolTip('Izzi AI — Local-First MyGraph & Quick Capture');
        const menu = Menu.buildFromTemplate([
          { label: 'Ghi nhanh MyGraph (Ctrl/Cmd+Shift+I)', click: () => this.show() },
          { label: 'Đồng bộ Vault ↔ Cloud ngay', click: () => this.opts.onSyncNow() },
          { type: 'separator' },
          { label: 'Mở Izzi AI App', click: () => this.opts.onShowMainWindow() },
          { type: 'separator' },
          { label: 'Thoát Izzi AI', click: () => this.opts.onQuit() },
        ]);
        this.tray.setContextMenu(menu);
        this.tray.on('click', () => this.toggle());
      } catch {
        this.tray = null;
      }
    }

    // 3. IPC controls so renderer buttons or Escape key can open/hide the mini window.
    ipcMain.handle('quickCapture:open', (e) => {
      if (!isTrustedRendererSender(e)) return { ok: false };
      this.show();
      return { ok: true, shortcut: QUICK_CAPTURE_SHORTCUT, registered: this.shortcutRegistered };
    });
    ipcMain.handle('quickCapture:hide', (e) => {
      if (!isTrustedRendererSender(e)) return { ok: false };
      this.hide();
      return { ok: true };
    });
    ipcMain.handle('quickCapture:openMain', (e) => {
      if (!isTrustedRendererSender(e)) return { ok: false };
      this.hide();
      this.opts.onShowMainWindow();
      return { ok: true };
    });
  }

  toggle(): void {
    if (this.win && !this.win.isDestroyed() && this.win.isVisible()) {
      this.hide();
    } else {
      this.show();
    }
  }

  show(): void {
    if (!this.win || this.win.isDestroyed()) {
      this.win = new BrowserWindow({
        width: 580,
        height: 480,
        minWidth: 420,
        minHeight: 360,
        frame: false,
        titleBarStyle: 'hidden',
        title: 'Izzi AI · Quick Capture',
        backgroundColor: '#11141a',
        resizable: true,
        skipTaskbar: false,
        show: false,
        webPreferences: {
          preload: path.resolve(this.opts.preloadPath),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
        },
        ...(this.opts.appIcon ? { icon: this.opts.appIcon } : {}),
      });

      this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      this.win.webContents.on('will-navigate', (event, targetUrl) => {
        const allowedDev =
          this.opts.isDev && !this.opts.forceProdRenderer && targetUrl.startsWith('http://localhost:5173/');
        if (!allowedDev && !targetUrl.startsWith('file://')) {
          event.preventDefault();
        }
      });

      if (this.opts.isDev && !this.opts.forceProdRenderer) {
        void this.win.loadURL('http://localhost:5173/#quick-capture');
      } else {
        void this.win.loadFile(this.opts.rendererHtmlPath, { hash: 'quick-capture' });
      }

      this.win.once('ready-to-show', () => {
        this.win?.show();
        this.win?.focus();
      });

      this.win.on('closed', () => {
        this.win = null;
      });
      return;
    }

    if (this.win.isMinimized()) this.win.restore();
    this.win.show();
    this.win.focus();
  }

  hide(): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.hide();
    }
  }

  closeWindow(): void {
    if (this.win && !this.win.isDestroyed()) {
      this.win.destroy();
    }
    this.win = null;
  }

  dispose(): void {
    try {
      if (this.shortcutRegistered) {
        globalShortcut.unregister(QUICK_CAPTURE_SHORTCUT);
        this.shortcutRegistered = false;
      }
    } catch {
      // ignore
    }
    try {
      this.tray?.destroy();
      this.tray = null;
    } catch {
      // ignore
    }
    try {
      if (this.win && !this.win.isDestroyed()) this.win.destroy();
      this.win = null;
    } catch {
      // ignore
    }
  }
}
