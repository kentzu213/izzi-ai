// Installs the upgrade-checkpoint hook, the SessionStart standards hook, the skill and the commands root runs after a
// checkpoint (critic/*.mjs, standards/promote-standard.mjs and its store wrapper, the daily refresh and its
// SessionStart launcher) into a Claude Code home (default ~/.claude).
// Usage: node tools/agent-maturity/install.mjs [--claude-home <dir>] [--settings <file>] [--dry-run]
// See docs/izzi-v2/PLAN.md §4.6 and §4.9 item 5. Also exports the helpers uninstall.mjs uses.

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { tmpPathFor, writeFileAtomic } from './lib/store.mjs';

export const HOOK_MARKER = 'agent-maturity/bin/hooks/prompt-signal.mjs';
export const SESSION_HOOK_MARKER = 'agent-maturity/bin/hooks/session-start.mjs';
export const REFRESH_HOOK_MARKER = 'agent-maturity/bin/standards/refresh-if-due.mjs';
// One group per hook: the D1 prompt hook, the D3 standards hook and the D2 daily refresh launcher (no matcher, so the
// SessionStart ones also run on resume/compact).
const HOOK_EVENTS = [
  { event: 'UserPromptSubmit', marker: HOOK_MARKER },
  { event: 'SessionStart', marker: SESSION_HOOK_MARKER },
  { event: 'SessionStart', marker: REFRESH_HOOK_MARKER },
];
const HOOK_EVENT_NAMES = [...new Set(HOOK_EVENTS.map(({ event }) => event))];
export const HOOK_TIMEOUT_SECONDS = 5;
export const SKILL_NAME = 'upgrade-checkpoint';
export const SKILL_MARKER = '.agent-maturity';
const SOURCE_DIR = import.meta.dirname;
// The D4 critic modules (critic/*.mjs; not test-corpus/ or dry-runs/), for the checkpoint flow root runs.
const CRITIC_FILES = fs
  .readdirSync(path.join(SOURCE_DIR, 'critic'), { withFileTypes: true })
  .filter((d) => d.isFile() && d.name.endsWith('.mjs'))
  .map((d) => `critic/${d.name}`)
  .sort();
export const RUNTIME_FILES = [
  'lib/classify.mjs',
  'lib/decide.mjs',
  'lib/store.mjs',
  'lib/transcript-tail.mjs',
  'hooks/prompt-signal.mjs',
  'hooks/session-start.mjs',
  'standards/inject.mjs',
  'standards/project-root.mjs',
  // The single door for a dev standard, the store wrapper it uses, and the daily refresh (with the importer it runs)
  // plus the SessionStart launcher that starts it.
  'standards/promote-standard.mjs',
  'standards/store-cli.mjs',
  'standards/refresh.mjs',
  'standards/refresh-if-due.mjs',
  'standards/import-feedback.mjs',
  ...CRITIC_FILES,
];

export class InstallError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'InstallError';
    this.code = code;
  }
}

export const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
export const toSlash = (p) => p.replace(/\\/g, '/');

export function isInside(child, parent) {
  const rel = path.relative(path.resolve(parent).toLowerCase(), path.resolve(child).toLowerCase());
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function parseArgs(argv, { allowPurge = false } = {}) {
  const opts = { claudeHome: undefined, settingsPath: undefined, dryRun: false, purge: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const v = argv[i + 1];
      if (!v || v.startsWith('--')) throw new InstallError('bad_args', `${arg} needs a value`);
      i += 1;
      return v;
    };
    if (arg === '--claude-home') opts.claudeHome = value();
    else if (arg === '--settings') opts.settingsPath = value();
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--purge' && allowPurge) opts.purge = true;
    else throw new InstallError('bad_args', `unknown argument: ${arg}`);
  }
  return opts;
}

export function resolveTargets({ claudeHome, settingsPath }) {
  const home = path.resolve(claudeHome ?? path.join(os.homedir(), '.claude'));
  return {
    home,
    settings: path.resolve(settingsPath ?? path.join(home, 'settings.json')),
    maturity: path.join(home, 'agent-maturity'),
    skillDir: path.join(home, 'skills', SKILL_NAME),
  };
}

// Tests set AGENT_MATURITY_TEST=1; then the real ~/.claude is never a target, even for a dry run.
export function refuseRealHome(targets, env) {
  if (env.AGENT_MATURITY_TEST !== '1') return;
  const real = path.join(os.homedir(), '.claude');
  if (isInside(targets.home, real) || isInside(targets.settings, real)) {
    throw new InstallError('refuse_real_home', 'AGENT_MATURITY_TEST=1: refusing to touch the real ~/.claude');
  }
}

export function readSettings(file) {
  let bytes;
  try {
    bytes = fs.readFileSync(file);
  } catch (error) {
    throw new InstallError('settings_unreadable', `cannot read ${toSlash(file)} (${error.code})`);
  }
  const text = bytes.toString('utf8');
  let value;
  try {
    value = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    throw new InstallError('settings_invalid', `${toSlash(file)} is not valid JSON; nothing was written`);
  }
  const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  const hooks = isObject(value) ? value.hooks : undefined;
  const badList = isObject(hooks) && HOOK_EVENT_NAMES.some((event) => hooks[event] !== undefined && !Array.isArray(hooks[event]));
  if (!isObject(value) || (hooks !== undefined && !isObject(hooks)) || badList) {
    throw new InstallError('settings_invalid', `${toSlash(file)} has an unexpected shape; nothing was written`);
  }
  return { bytes, text, value, sha: sha256(bytes) };
}

const commandFor = (home, marker) => `node "${toSlash(home)}/${marker}"`;
export const hookCommand = (home) => commandFor(home, HOOK_MARKER);
export const sessionHookCommand = (home) => commandFor(home, SESSION_HOOK_MARKER);
export const refreshHookCommand = (home) => commandFor(home, REFRESH_HOOK_MARKER);
const hasMarker = (h, marker) => Boolean(h) && typeof h.command === 'string' && toSlash(h.command).includes(marker);
export const isOurHook = (h) => HOOK_EVENTS.some(({ marker }) => hasMarker(h, marker));
const groupHas = (g, marker) => Boolean(g) && Array.isArray(g.hooks) && g.hooks.some((h) => hasMarker(h, marker));

// Adds each missing agent-maturity group; returns the { event, marker } pairs it added (none when all are registered).
export function withHookGroups(settings, home) {
  let hooks = settings.hooks ?? {};
  const added = [];
  for (const { event, marker } of HOOK_EVENTS) {
    const list = hooks[event] ?? [];
    if (list.some((g) => groupHas(g, marker))) continue;
    const group = { hooks: [{ type: 'command', command: commandFor(home, marker), timeout: HOOK_TIMEOUT_SECONDS }] };
    hooks = { ...hooks, [event]: [...list, group] };
    added.push({ event, marker });
  }
  return added.length > 0 ? { settings: { ...settings, hooks }, added } : { settings, added };
}

function withoutOurs(list) {
  let removed = 0;
  const kept = [];
  for (const group of list) {
    if (!group || !Array.isArray(group.hooks) || !group.hooks.some(isOurHook)) {
      kept.push(group);
      continue;
    }
    const rest = group.hooks.filter((h) => !isOurHook(h));
    removed += group.hooks.length - rest.length;
    if (rest.length > 0) kept.push({ ...group, hooks: rest });
  }
  return { kept, removed };
}

export function withoutHookGroup(settings) {
  const hooks = settings.hooks;
  if (!hooks) return { settings, removed: 0 };
  let removed = 0;
  const nextHooks = { ...hooks };
  for (const event of HOOK_EVENT_NAMES) {
    if (!Array.isArray(hooks[event])) continue;
    const r = withoutOurs(hooks[event]);
    if (r.removed === 0) continue;
    removed += r.removed;
    if (r.kept.length === 0) delete nextHooks[event];
    else nextHooks[event] = r.kept;
  }
  if (removed === 0) return { settings, removed };
  const next = { ...settings, hooks: nextHooks };
  if (Object.keys(nextHooks).length === 0) delete next.hooks;
  return { settings: next, removed };
}

// Keeps the file's indent, line endings, BOM and trailing newline.
export function serializeLike(value, originalText) {
  const eol = originalText.includes('\r\n') ? '\r\n' : '\n';
  const indent = originalText.match(/^[\t ]+(?=")/m)?.[0] ?? 2;
  const bom = originalText.startsWith('\uFEFF') ? '\uFEFF' : '';
  const trailing = /\n$/.test(originalText) ? eol : '';
  return bom + JSON.stringify(value, null, indent).replace(/\n/g, eol) + trailing;
}

// Atomic write that re-reads the target right before the rename and aborts if anyone changed it.
export function writeChecked(file, data, expectedSha, beforeRename) {
  const tmp = tmpPathFor(file);
  fs.writeFileSync(tmp, data);
  try {
    if (beforeRename) beforeRename(tmp);
    let current = null;
    try {
      current = sha256(fs.readFileSync(file));
    } catch {
      current = null;
    }
    if (current !== expectedSha) {
      throw new InstallError('settings_changed', `${toSlash(file)} changed while this ran (Claude Code or a plugin toggle may have written it); nothing was written. Run again.`);
    }
    fs.renameSync(tmp, file);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
}

export function plannedFiles(targets) {
  const skillSource = path.join(SOURCE_DIR, 'skill', SKILL_NAME, 'SKILL.md');
  return [
    ...RUNTIME_FILES.map((rel) => ({ from: path.join(SOURCE_DIR, rel), to: path.join(targets.maturity, 'bin', rel) })),
    { from: skillSource, to: path.join(targets.skillDir, 'SKILL.md') },
    { content: 'Installed by tools/agent-maturity/install.mjs. Remove with uninstall.mjs.\n', to: path.join(targets.skillDir, SKILL_MARKER) },
  ];
}

export const manifestPath = (targets) => path.join(targets.maturity, 'install-manifest.json');

export function readManifest(targets) {
  try {
    const m = JSON.parse(fs.readFileSync(manifestPath(targets), 'utf8'));
    return m && m.v === 1 && Array.isArray(m.files) ? m : null;
  } catch {
    return null;
  }
}

function stampOf(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

function writeBackup(settingsFile, bytes, stamp) {
  for (let i = 0; i < 100; i += 1) {
    const file = `${settingsFile}.bak-${stamp}${i === 0 ? '' : `-${i}`}-agent-maturity`;
    try {
      fs.writeFileSync(file, bytes, { flag: 'wx' });
      return file;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw new InstallError('backup_failed', 'could not pick a free backup file name');
}

function applyInstall(t, current, next, files, previous, opts) {
  for (const f of files) writeFileAtomic(f.to, f.content ?? fs.readFileSync(f.from));
  let backup = previous ? previous.backup : null;
  let shaBefore = previous ? previous.settingsShaBefore : current.sha;
  let shaAfter = previous ? previous.settingsShaAfter : current.sha;
  if (next) {
    // Settings untouched since the previous install (a D1 -> D3 upgrade): its backup still holds the state before
    // any agent-maturity hook, so it is kept. Otherwise the current bytes are backed up and their sha recorded.
    const keep = Boolean(previous && previous.backup && current.sha === previous.settingsShaAfter && fs.existsSync(previous.backup));
    const fresh = keep ? null : writeBackup(t.settings, current.bytes, stampOf(opts.now ?? new Date()));
    if (fresh) {
      backup = fresh;
      shaBefore = current.sha;
    }
    const text = serializeLike(next, current.text);
    try {
      writeChecked(t.settings, text, current.sha, opts.beforeRename);
    } catch (error) {
      if (fresh) fs.rmSync(fresh, { force: true });
      throw error;
    }
    shaAfter = sha256(Buffer.from(text, 'utf8'));
  }
  const manifest = {
    v: 1,
    installedAt: (opts.now ?? new Date()).toISOString(),
    claudeHome: toSlash(t.home),
    settingsPath: toSlash(t.settings),
    backup: backup ? toSlash(backup) : null,
    settingsShaBefore: shaBefore,
    settingsShaAfter: shaAfter,
    hookCommand: hookCommand(t.home),
    sessionHookCommand: sessionHookCommand(t.home),
    refreshHookCommand: refreshHookCommand(t.home),
    files: files.map((f) => toSlash(f.to)),
  };
  writeFileAtomic(manifestPath(t), `${JSON.stringify(manifest, null, 2)}\n`);
}

// Returns { code, lines, error? }; never throws.
export function install(opts = {}) {
  const lines = [];
  try {
    const t = resolveTargets(opts);
    refuseRealHome(t, opts.env ?? process.env);
    const current = readSettings(t.settings);
    if (fs.existsSync(t.skillDir) && !fs.existsSync(path.join(t.skillDir, SKILL_MARKER))) {
      throw new InstallError('skill_conflict', `${toSlash(t.skillDir)} exists and was not installed by agent-maturity; not overwriting`);
    }
    const { settings: next, added } = withHookGroups(current.value, t.home);
    const files = plannedFiles(t);
    for (const { event, marker } of added) lines.push(`add ${event} hook: ${commandFor(t.home, marker)}`);
    if (added.length === 0) lines.push('hooks already registered; settings.json unchanged');
    else lines.push(`back up ${toSlash(t.settings)} byte-for-byte first`);
    for (const f of files) lines.push(`write ${toSlash(f.to)}`);
    if (opts.dryRun) return { code: 0, lines: ['dry run: nothing written', ...lines] };
    applyInstall(t, current, added.length > 0 ? next : null, files, readManifest(t), opts);
    lines.push('installed; new and running Claude Code sessions pick up the hook from settings.json');
    return { code: 0, lines };
  } catch (error) {
    return { code: 1, error: error.code ?? error.name, lines: [...lines, `error: ${error.message}`] };
  }
}

export function runCli(fn, argv, { allowPurge }) {
  let result;
  try {
    result = fn({ ...parseArgs(argv, { allowPurge }), env: process.env });
  } catch (error) {
    result = { code: 1, lines: [`error: ${error.message}`] };
  }
  process.stdout.write(`${result.lines.join('\n')}\n`);
  process.exitCode = result.code;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === import.meta.filename.toLowerCase();
if (invokedDirectly) runCli(install, process.argv.slice(2), { allowPurge: false });
