// CMR-224 Slice 2 — Live.md IPC.
//
// What these tests are really guarding: the operator's own words. Every failure
// path must leave the existing file alone, an untrusted sender must learn
// nothing, and no handler may reach the network.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IpcMainInvokeEvent } from 'electron';

const electronMocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    electronMocks.handlers.set(channel, handler);
  }),
  showItemInFolder: vi.fn(),
  fromWebContents: vi.fn(),
  isPackaged: false,
}));

vi.mock('electron', () => ({
  ipcMain: { handle: electronMocks.handle },
  shell: { showItemInFolder: electronMocks.showItemInFolder },
  BrowserWindow: { fromWebContents: electronMocks.fromWebContents },
  app: {
    get isPackaged() { return electronMocks.isPackaged; },
  },
}));

import { registerLiveProfileIpc } from './live-profile-ipc';
import { LiveProfileStore } from './live-profile-store';
import {
  LIVE_PROFILE_FILE_NAME,
  parseLiveProfile,
} from '../../shared/memory-trace/live-profile';

function trustedEvent(url = 'http://localhost:5173/graph'): IpcMainInvokeEvent {
  const sender = { id: 11, getURL: () => url };
  electronMocks.fromWebContents.mockReturnValue({ webContents: { id: 11 } });
  return { sender, senderFrame: { url, parent: null } } as unknown as IpcMainInvokeEvent;
}

function untrustedEvent(): IpcMainInvokeEvent {
  const url = 'https://evil.example/graph';
  const sender = { id: 12, getURL: () => url };
  electronMocks.fromWebContents.mockReturnValue({ webContents: { id: 12 } });
  return { sender, senderFrame: { url, parent: null } } as unknown as IpcMainInvokeEvent;
}

let directory: string;
let store: LiveProfileStore;
let onProfileWritten: ReturnType<typeof vi.fn>;

function invoke(channel: string, ...args: unknown[]): unknown {
  const handler = electronMocks.handlers.get(channel);
  if (!handler) throw new Error(`channel not registered: ${channel}`);
  return handler(...args);
}

beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'live-profile-ipc-'));
  store = new LiveProfileStore({ directory });
  onProfileWritten = vi.fn();
  electronMocks.handlers.clear();
  electronMocks.showItemInFolder.mockClear();
  registerLiveProfileIpc(store, { onProfileWritten });
});

afterEach(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

describe('registerLiveProfileIpc', () => {
  it('registers exactly the three local channels', () => {
    expect([...electronMocks.handlers.keys()].sort()).toEqual([
      'liveProfile:read',
      'liveProfile:reveal',
      'liveProfile:write',
    ]);
  });

  it('creates Live.md from the template on first read', () => {
    const result = invoke('liveProfile:read', trustedEvent()) as {
      status: string;
      profile: { revision: number; body: string } | null;
      filePath: string;
    };

    expect(result.status).toBe('ok');
    expect(result.profile?.revision).toBe(1);
    expect(result.filePath).toBe(path.join(directory, LIVE_PROFILE_FILE_NAME));
    expect(fs.existsSync(result.filePath)).toBe(true);
  });

  it('bumps the revision on write and keeps the operator body verbatim', () => {
    invoke('liveProfile:read', trustedEvent());
    const body = '# Live\n\nTôi đang dựng phòng marketing.\n';

    const written = invoke('liveProfile:write', trustedEvent(), body) as {
      status: string;
      profile: { revision: number; body: string } | null;
    };

    expect(written.status).toBe('ok');
    expect(written.profile?.revision).toBe(2);
    expect(written.profile?.body).toBe(body);

    const onDisk = parseLiveProfile(
      fs.readFileSync(path.join(directory, LIVE_PROFILE_FILE_NAME), 'utf8'),
    );
    expect(onDisk?.body).toBe(body);
    expect(onDisk?.revision).toBe(2);
    expect(onProfileWritten).toHaveBeenCalledTimes(1);
    expect(onProfileWritten).toHaveBeenCalledWith(written.profile);
  });

  it('does not report a revision until its file write succeeds', () => {
    const filePath = path.join(directory, LIVE_PROFILE_FILE_NAME);
    fs.mkdirSync(filePath, { recursive: true });

    const result = invoke('liveProfile:write', trustedEvent(), 'anything') as {
      status: string;
    };

    expect(result.status).toBe('unreadable');
    expect(onProfileWritten).not.toHaveBeenCalled();
  });

  it('keeps a successful save successful when revision recording fails', () => {
    invoke('liveProfile:read', trustedEvent());
    onProfileWritten.mockImplementation(() => {
      throw new Error('simulated trace storage failure');
    });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const result = invoke('liveProfile:write', trustedEvent(), 'durable body') as {
      status: string;
      profile: { revision: number; body: string } | null;
    };

    expect(result.status).toBe('ok');
    expect(result.profile?.revision).toBe(2);
    expect(store.read().profile?.body).toBe('durable body');
    expect(warning).toHaveBeenCalledWith(
      '[memory-trace] Live.md was saved but its trace revision was not recorded',
    );
    warning.mockRestore();
  });

  it('refuses a non-string body instead of coercing it', () => {
    invoke('liveProfile:read', trustedEvent());
    const before = fs.readFileSync(path.join(directory, LIVE_PROFILE_FILE_NAME), 'utf8');

    for (const body of [undefined, null, 42, { body: 'x' }, ['x']]) {
      const result = invoke('liveProfile:write', trustedEvent(), body) as { status: string };
      expect(result.status).toBe('rejected');
    }

    expect(fs.readFileSync(path.join(directory, LIVE_PROFILE_FILE_NAME), 'utf8')).toBe(before);
  });

  it('leaves an unparseable file untouched rather than overwriting it', () => {
    const filePath = path.join(directory, LIVE_PROFILE_FILE_NAME);
    fs.writeFileSync(filePath, 'the operator wrote this without frontmatter', 'utf8');

    const read = invoke('liveProfile:read', trustedEvent()) as { status: string };
    const written = invoke('liveProfile:write', trustedEvent(), 'replacement') as {
      status: string;
    };

    expect(read.status).toBe('unreadable');
    expect(written.status).toBe('unreadable');
    expect(fs.readFileSync(filePath, 'utf8')).toBe(
      'the operator wrote this without frontmatter',
    );
  });

  it('tells an untrusted sender nothing and writes nothing', () => {
    const filePath = path.join(directory, LIVE_PROFILE_FILE_NAME);

    const read = invoke('liveProfile:read', untrustedEvent()) as {
      status: string;
      profile: unknown;
    };
    expect(read.status).toBe('unreadable');
    expect(read.profile).toBeNull();
    // Reading must not even create the file for an untrusted sender.
    expect(fs.existsSync(filePath)).toBe(false);

    const written = invoke('liveProfile:write', untrustedEvent(), 'hijack') as {
      status: string;
    };
    expect(written.status).toBe('rejected');
    expect(fs.existsSync(filePath)).toBe(false);

    const revealed = invoke('liveProfile:reveal', untrustedEvent()) as { ok: boolean };
    expect(revealed.ok).toBe(false);
    expect(electronMocks.showItemInFolder).not.toHaveBeenCalled();
  });

  it('reveals the real file so the operator can edit it in any editor', () => {
    const revealed = invoke('liveProfile:reveal', trustedEvent()) as {
      ok: boolean;
      filePath: string;
    };

    expect(revealed.ok).toBe(true);
    expect(revealed.filePath).toBe(path.join(directory, LIVE_PROFILE_FILE_NAME));
    expect(fs.existsSync(revealed.filePath)).toBe(true);
    expect(electronMocks.showItemInFolder).toHaveBeenCalledWith(revealed.filePath);
  });
});

describe('Live.md egress', () => {
  it('imports nothing that could reach the network', () => {
    // The rule is `egress: forbidden` for live_profile. A regression would most
    // likely arrive as an innocent-looking import, so pin the exact import set:
    // adding one fails here and forces a deliberate decision.
    const source = fs.readFileSync(path.join(__dirname, 'live-profile-ipc.ts'), 'utf8');
    const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((match) => match[1]);

    expect(specifiers.sort()).toEqual([
      '../../shared/memory-trace/live-profile',
      '../marketing/marketing-ipc',
      './live-profile-store',
      'electron',
    ]);
    expect(/\bfetch\s*\(/.test(source)).toBe(false);
  });
});
