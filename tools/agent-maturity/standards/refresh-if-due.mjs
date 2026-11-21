// SessionStart launcher for the daily refresh (slice D2). When the standards export is missing or older than
// REFRESH_AFTER_MS, it starts standards/refresh.mjs as a detached background process and exits at once, so no session
// waits for KnowledgeMemory. Chosen over an OS scheduler: nothing to install or remove outside ~/.claude, no console
// window, and the export only matters when a session starts (it goes stale after MAX_EXPORT_AGE_DAYS in inject.mjs).
// A start marker keeps sessions that start together from launching two refreshes, and spaces out retries when a
// refresh fails (the export then keeps its old mtime). Prints nothing: SessionStart stdout would become session
// context. Fails open: any error exits 0.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { appendEvents, loadConfig, resolveHome } from '../lib/store.mjs';

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

// True when a refresh should start: the export is missing or at least REFRESH_AFTER_MS old, and no refresh started in
// the last RETRY_AFTER_MS (a marker dated in the future does not count).
export function refreshDue(home, nowMs) {
  const started = mtimeOf(path.join(home, START_MARKER));
  if (started !== null && started <= nowMs && nowMs - started < RETRY_AFTER_MS) return false;
  const exported = mtimeOf(path.join(home, 'standards.json'));
  return exported === null || nowMs - exported >= REFRESH_AFTER_MS;
}

// Tests swap in a stub; anywhere else the installed refresh.mjs next to this file runs.
export function refreshScript(env) {
  return env.AGENT_MATURITY_TEST === '1' && env.AGENT_MATURITY_REFRESH_SCRIPT ? env.AGENT_MATURITY_REFRESH_SCRIPT : REFRESH_SCRIPT;
}

// Returns 'off', 'not_due' or 'started'. Throws only on a filesystem error (the caller exits 0).
export function launchRefresh(env = process.env, now = new Date()) {
  if (String(env.AGENT_MATURITY ?? '').trim().toLowerCase() === 'off') return 'off';
  const home = resolveHome(env);
  if (!loadConfig(home).enabled) return 'off';
  if (!refreshDue(home, now.getTime())) return 'not_due';
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, START_MARKER), `${now.toISOString()}\n`);
  const child = spawn(process.execPath, [refreshScript(env)], { cwd: home, env, detached: true, stdio: 'ignore', windowsHide: true });
  child.on('error', () => {}); // a missing node or script must not crash the launcher
  child.unref();
  try {
    appendEvents(home, [{ ts: now.toISOString(), type: 'refresh_started' }], now);
  } catch {
    // logging is best effort
  }
  return 'started';
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === import.meta.filename.toLowerCase();
if (invokedDirectly) {
  process.on('uncaughtException', () => process.exit(0));
  try {
    launchRefresh();
  } catch {
    // fail open
  }
}
