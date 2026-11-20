// Disk side of the upgrade-checkpoint hook: paths, atomic JSON writes, event log, old-file cleanup.
// Stores labels, counts, rule ids, timestamps and session ids only, never prompt or reply text.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DAY_MS = 86_400_000;
export const STATE_MAX_AGE_MS = 30 * DAY_MS;
export const LOG_MAX_AGE_MS = 180 * DAY_MS;

export function resolveHome(env = process.env) {
  const custom = env.AGENT_MATURITY_HOME;
  return custom ? path.resolve(custom) : path.join(os.homedir(), '.claude', 'agent-maturity');
}

// Safe ids are used as-is; anything else is replaced by a hash so it cannot shape a path or leak text.
export function sessionKey(id) {
  if (typeof id !== 'string' || id === '') return null;
  if (/^[A-Za-z0-9-]{1,128}$/.test(id)) return id;
  return crypto.createHash('sha256').update(id).digest('hex').slice(0, 40);
}

export const statePath = (home, key) => path.join(home, 'state', `${key}.json`);
export const globalPath = (home) => path.join(home, 'global.json');
export const configPath = (home) => path.join(home, 'config.json');
export const logPath = (home, date) => path.join(home, 'log', `events-${date.toISOString().slice(0, 7)}.jsonl`);

export function tmpPathFor(file) {
  return `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
}

export function writeFileAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = tmpPathFor(file);
  try {
    fs.writeFileSync(tmp, data);
    fs.renameSync(tmp, file);
  } catch (error) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // the temp file may not exist
    }
    throw error;
  }
}

export const writeJsonAtomic = (file, value) => writeFileAtomic(file, `${JSON.stringify(value)}\n`);

// { status: 'ok' | 'missing' | 'corrupt', value }
export function readJson(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    return { status: error && error.code === 'ENOENT' ? 'missing' : 'corrupt', value: null };
  }
  try {
    return { status: 'ok', value: JSON.parse(text) };
  } catch {
    return { status: 'corrupt', value: null };
  }
}

export function loadConfig(home) {
  const { value } = readJson(configPath(home));
  return { enabled: !(value && typeof value === 'object' && value.enabled === false) };
}

export function appendEvents(home, events, date) {
  if (events.length === 0) return;
  const file = logPath(home, date);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, events.map((e) => `${JSON.stringify(e)}\n`).join(''));
}

function removeOlderThan(dir, cutoffMs, pattern) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!pattern.test(name)) continue;
    const file = path.join(dir, name);
    try {
      if (fs.statSync(file).mtimeMs < cutoffMs) fs.unlinkSync(file);
    } catch {
      // best effort
    }
  }
}

// Removes state older than 30 days and logs older than 180 days, at most once a day.
export function cleanupIfDue(home, nowMs) {
  const marker = path.join(home, '.last-cleanup');
  try {
    if (nowMs - fs.statSync(marker).mtimeMs < DAY_MS) return false;
  } catch {
    // no marker yet
  }
  removeOlderThan(path.join(home, 'state'), nowMs - STATE_MAX_AGE_MS, /\.json$/);
  removeOlderThan(path.join(home, 'log'), nowMs - LOG_MAX_AGE_MS, /^events-\d{4}-\d{2}\.jsonl$/);
  fs.writeFileSync(marker, '');
  return true;
}
