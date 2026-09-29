import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOpenWebGuard, openMyGraphWebSafely, type OpenMyGraphWebIpc } from './open-my-graph-web';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('openMyGraphWebSafely (ledger #23)', () => {
  it('returns true when main reports ok', async () => {
    const open = vi.fn().mockResolvedValue({ ok: true, url: 'https://izziapi.com/aibase/my-graph' });

    await expect(openMyGraphWebSafely(open)).resolves.toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('returns false and warns on a non-ok or malformed result', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(openMyGraphWebSafely(vi.fn().mockResolvedValue({ ok: false }))).resolves.toBe(false);
    await expect(openMyGraphWebSafely(vi.fn().mockResolvedValue(undefined))).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('logs only the error name on an IPC rejection and resolves false instead of rejecting', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failure = new Error('openExternal failed C:\\Users\\secret https://x.example/?token=abc');

    await expect(openMyGraphWebSafely(vi.fn().mockRejectedValue(failure))).resolves.toBe(false);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('[MyGraph] openMyGraphWeb failed: Error');
    const logged = error.mock.calls.flat();
    expect(logged).not.toContain(failure);
    expect(logged.join(' ')).not.toMatch(/openExternal failed|secret|token=/);
  });

  it('logs a generic label for a non-Error rejection', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(openMyGraphWebSafely(vi.fn().mockRejectedValue('boom secret'))).resolves.toBe(false);
    expect(error).toHaveBeenCalledWith('[MyGraph] openMyGraphWeb failed: error');
    expect(error.mock.calls.flat().join(' ')).not.toContain('boom');
  });

  it('returns false and warns when the bridge is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(openMyGraphWebSafely(undefined)).resolves.toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it.each(['../pages/KnowledgeUniverse.tsx', '../pages/GraphWorkspace.tsx'])(
    '%s calls the bridge only through the helper',
    (file) => {
      const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');

      expect(source).not.toContain('openMyGraphWeb?.()');
      expect(source).toContain('openMyGraphWebSafely(window.electronAPI?.graph?.openMyGraphWeb)');
    },
  );
});

const OPEN_WEB_ERROR = 'open-web-error';

/** Mirrors the page flow in KnowledgeUniverse.tsx: begin → helper → apply only if still current. */
async function clickOpenWeb(
  guard: ReturnType<typeof createOpenWebGuard>,
  open: OpenMyGraphWebIpc | undefined,
  apply: (error: string | undefined) => void,
): Promise<void> {
  const isCurrent = guard.begin();
  const ok = await openMyGraphWebSafely(open);
  if (isCurrent()) apply(ok ? undefined : OPEN_WEB_ERROR);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('createOpenWebGuard (ledger #23)', () => {
  it('clears the error after a successful open', async () => {
    const apply = vi.fn();

    await clickOpenWeb(createOpenWebGuard(), vi.fn().mockResolvedValue({ ok: true }), apply);

    expect(apply).toHaveBeenCalledWith(undefined);
  });

  it('shows the error when the IPC rejects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const apply = vi.fn();

    await clickOpenWeb(createOpenWebGuard(), vi.fn().mockRejectedValue(new Error('boom')), apply);

    expect(apply).toHaveBeenCalledWith(OPEN_WEB_ERROR);
  });

  it('shows the error when the bridge is missing', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const apply = vi.fn();

    await clickOpenWeb(createOpenWebGuard(), undefined, apply);

    expect(apply).toHaveBeenCalledWith(OPEN_WEB_ERROR);
  });

  it('drops a result that arrives after unmount', async () => {
    const guard = createOpenWebGuard();
    const pending = deferred<{ ok: boolean }>();
    const apply = vi.fn();

    const click = clickOpenWeb(guard, () => pending.promise, apply);
    guard.setMounted(false);
    pending.resolve({ ok: true });
    await click;

    expect(apply).not.toHaveBeenCalled();
  });

  it('lets only the latest click update the state', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const guard = createOpenWebGuard();
    const slow = deferred<{ ok: boolean }>();
    const apply = vi.fn();

    const first = clickOpenWeb(guard, () => slow.promise, apply);
    await clickOpenWeb(guard, vi.fn().mockResolvedValue({ ok: true }), apply);
    slow.resolve({ ok: false });
    await first;

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith(undefined);
  });

  it('applies again after a StrictMode cleanup/remount', async () => {
    const guard = createOpenWebGuard();
    const apply = vi.fn();
    guard.setMounted(false);
    guard.setMounted(true);

    await clickOpenWeb(guard, vi.fn().mockResolvedValue({ ok: true }), apply);

    expect(apply).toHaveBeenCalledWith(undefined);
  });

  it.each(['../pages/KnowledgeUniverse.tsx', '../pages/GraphWorkspace.tsx'])(
    '%s wires the guard around setOpenWebError (source check, not runtime evidence)',
    (file) => {
      const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');

      expect(source).toContain('useState(createOpenWebGuard)');
      expect(source).toContain('return () => openWebGuard.setMounted(false);');
      expect(source).toContain('if (isCurrent()) setOpenWebError(');
      expect(source).toContain('() => void openMyGraphWeb()}');
    },
  );
});
