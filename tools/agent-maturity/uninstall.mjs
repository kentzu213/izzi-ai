// Removes the upgrade-checkpoint hook and skill from a Claude Code home (default ~/.claude).
// Usage: node tools/agent-maturity/uninstall.mjs [--claude-home <dir>] [--settings <file>] [--dry-run] [--purge]
// If settings.json is unchanged since install it is restored byte-for-byte from the backup; otherwise only
// the agent-maturity hook group is removed and every other change is kept. State and log stay unless --purge.

import fs from 'node:fs';
import path from 'node:path';

import {
  SKILL_MARKER,
  isInside,
  manifestPath,
  plannedFiles,
  readManifest,
  readSettings,
  refuseRealHome,
  resolveTargets,
  runCli,
  serializeLike,
  toSlash,
  withoutHookGroup,
  writeChecked,
} from './install.mjs';

function planSettings(t, manifest) {
  if (!fs.existsSync(t.settings)) return { mode: 'none', current: null, data: null, lines: ['no settings.json found'] };
  const current = readSettings(t.settings);
  const backup = manifest && manifest.backup ? path.resolve(manifest.backup) : null;
  if (backup && manifest.settingsShaAfter === current.sha && fs.existsSync(backup)) {
    return { mode: 'restore', current, data: fs.readFileSync(backup), lines: [`restore ${toSlash(t.settings)} byte-for-byte from ${toSlash(backup)}`] };
  }
  const { settings: next, removed } = withoutHookGroup(current.value);
  if (removed === 0) return { mode: 'none', current, data: null, lines: ['no agent-maturity hook in settings.json'] };
  const lines = ['settings.json changed after install: removing only the agent-maturity hook group, keeping every other change'];
  if (backup) lines.push(`backup kept at ${toSlash(backup)}`);
  return { mode: 'remove-group', current, data: serializeLike(next, current.text), lines };
}

// Only files under <home>/agent-maturity/bin or a skill folder we marked are ever deleted.
function filesToRemove(t, manifest) {
  const bin = path.join(t.maturity, 'bin');
  const skillIsOurs = fs.existsSync(path.join(t.skillDir, SKILL_MARKER));
  const listed = manifest ? manifest.files.filter((f) => typeof f === 'string').map((f) => path.resolve(f)) : plannedFiles(t).map((f) => f.to);
  return listed.filter((f) => {
    if (isInside(f, bin)) return path.resolve(f) !== path.resolve(bin);
    return skillIsOurs && isInside(f, t.skillDir) && path.resolve(f) !== path.resolve(t.skillDir);
  });
}

function removeEmptyDir(dir) {
  try {
    fs.rmdirSync(dir);
  } catch {
    // not empty or already gone
  }
}

// Returns { code, mode, lines, error? }; never throws.
export function uninstall(opts = {}) {
  const lines = [];
  try {
    const t = resolveTargets(opts);
    refuseRealHome(t, opts.env ?? process.env);
    const manifest = readManifest(t);
    const settingsPlan = planSettings(t, manifest);
    lines.push(...settingsPlan.lines);
    const files = filesToRemove(t, manifest);
    for (const f of files) lines.push(`remove ${toSlash(f)}`);
    if (opts.purge) lines.push(`purge state, log and config under ${toSlash(t.maturity)}`);
    if (opts.dryRun) return { code: 0, mode: settingsPlan.mode, lines: ['dry run: nothing written', ...lines] };

    if (settingsPlan.data !== null) writeChecked(t.settings, settingsPlan.data, settingsPlan.current.sha, opts.beforeRename);
    for (const f of files) fs.rmSync(f, { force: true });
    for (const dir of [path.join(t.maturity, 'bin', 'lib'), path.join(t.maturity, 'bin', 'hooks'), path.join(t.maturity, 'bin'), t.skillDir]) removeEmptyDir(dir);
    fs.rmSync(manifestPath(t), { force: true });
    if (opts.purge) {
      for (const dir of ['state', 'log']) fs.rmSync(path.join(t.maturity, dir), { recursive: true, force: true });
      for (const file of ['global.json', 'config.json', '.last-cleanup']) fs.rmSync(path.join(t.maturity, file), { force: true });
    }
    removeEmptyDir(t.maturity);
    lines.push('uninstalled');
    return { code: 0, mode: settingsPlan.mode, lines };
  } catch (error) {
    return { code: 1, mode: 'error', error: error.code ?? error.name, lines: [...lines, `error: ${error.message}`] };
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === import.meta.filename.toLowerCase();
if (invokedDirectly) runCli(uninstall, process.argv.slice(2), { allowPurge: true });
