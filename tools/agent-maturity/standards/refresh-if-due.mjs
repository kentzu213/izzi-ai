// SessionStart launcher for the daily refresh (slice D2). When the standards export is missing or older than
// REFRESH_AFTER_MS, it starts standards/refresh.mjs as a detached background process and exits at once, so no session
// waits for KnowledgeMemory. Chosen over an OS scheduler: nothing to install or remove outside ~/.claude, no console
// window, and the export only matters when a session starts (it goes stale after MAX_EXPORT_AGE_DAYS in inject.mjs).
// At most one refresh starts per RETRY_AFTER_MS slot: the launcher claims `.refresh-started-<slot>` with an exclusive
// create, so sessions that start together launch one refresh, and a failing refresh (the export keeps its old mtime)
// is retried at most once per slot. The refresh logs its result (counts and error codes only) as `refresh_done`.
// Prints nothing: SessionStart stdout would become session context. Fails open: any error exits 0.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const REFRESH_AFTER_MS = 20 * 3_600_000;
export const RETRY_AFTER_MS = 6 * 3_600_000;
export const START_MARKER = '.refresh-started';
const REFRESH_SCRIPT = path.join(import.meta.dirname, 'refresh.mjs');

function mtimeOf(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

export const slotMarker = (home, nowMs) => path.join(home, `${START_MARKER}-${Math.floor(nowMs / RETRY_AFTER_MS)}`);

// True when a refresh should start: the export is missing or at least REFRESH_AFTER_MS old, and none started in the
// current slot.
export function refreshDue(home, nowMs) {
  if (fs.existsSync(slotMarker(home, nowMs))) return false;
  const exported = mtimeOf(path.join(home, 'standards.json'));
  return exported === null || nowMs - exported >= REFRESH_AFTER_MS;
}

// Exclusive create of this slot's marker: false when another session already claimed it. Then removes older markers.
function claimSlot(home, now) {
  const marker = slotMarker(home, now.getTime());
  try {
    fs.writeFileSync(marker, `${now.toISOString()}\n`, { flag: 'wx' });
  } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
  for (const name of fs.readdirSync(home)) {
    const file = path.join(home, name);
    if ((name === START_MARKER || name.startsWith(`${START_MARKER}-`)) && file !== marker) fs.rmSync(file, { force: true });
  }
  return true;
}

// Tests swap in a stub; anywhere else the installed refresh.mjs next to this file runs.
export function refreshScript(env) {
  return env.AGENT_MATURITY_TEST === '1' && env.AGENT_MATURITY_REFRESH_SCRIPT ? env.AGENT_MATURITY_REFRESH_SCRIPT : REFRESH_SCRIPT;
}

// Returns 'off', 'not_due' or 'started'. Throws only on a filesystem or import error (the caller exits 0).
export async function launchRefresh(env = process.env, now = new Date()) {
  if (String(env.AGENT_MATURITY ?? '').trim().toLowerCase() === 'off') return 'off';
  const store = await import('../lib/store.mjs');
  const home = store.resolveHome(env);
  if (!store.loadConfig(home).enabled) return 'off';
  if (!refreshDue(home, now.getTime())) return 'not_due';
  fs.mkdirSync(home, { recursive: true });
  if (!claimSlot(home, now)) return 'not_due';
  // cwd is the temp folder so the background process never holds a project or the agent-maturity folder open.
  const child = spawn(process.execPath, [refreshScript(env), '--log-home', home], {
    cwd: os.tmpdir(), env, detached: true, stdio: 'ignore', windowsHide: true,
  });
  child.on('error', () => {}); // a missing node or script must not crash the launcher
  child.unref();
  try {
    store.appendEvents(home, [{ ts: now.toISOString(), type: 'refresh_started' }], now);
  } catch {
    // logging is best effort
  }
  return 'started';
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === import.meta.filename.toLowerCase();
if (invokedDirectly) {
  process.on('uncaughtException', () => process.exit(0));
  process.on('unhandledRejection', () => process.exit(0));
  launchRefresh().catch(() => {});
}
