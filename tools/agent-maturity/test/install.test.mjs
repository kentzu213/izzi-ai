import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { install } from '../install.mjs';
import { uninstall } from '../uninstall.mjs';
import { realHomeLeaks, realHomeSnapshot } from './real-home-guard.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REAL_CLAUDE = join(homedir(), '.claude');
const REAL_SETTINGS = join(REAL_CLAUDE, 'settings.json');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
// Since D2 the real home holds an install and live sessions (or Claude Code itself) may rewrite settings.json
// while these tests run, so the checks look for traces of these tests, not for unchanged bytes.
const REAL_SKILL = join(REAL_CLAUDE, 'skills', 'upgrade-checkpoint');
const skillSnapshot = () => (existsSync(REAL_SKILL) ? readdirSync(REAL_SKILL).sort().map((f) => [f, sha(readFileSync(join(REAL_SKILL, f)))]) : null);
const REAL_SKILL_BEFORE = skillSnapshot();
const REAL_BEFORE = realHomeSnapshot();
const scratch = mkdtempSync(join(tmpdir(), 'am-install-'));
const ENV = { AGENT_MATURITY_TEST: '1' };

after(() => {
  rmSync(scratch, { recursive: true, force: true });
  assert.deepEqual(realHomeLeaks(REAL_BEFORE), [], 'a test wrote into the real ~/.claude/agent-maturity');
  assert.deepEqual(skillSnapshot(), REAL_SKILL_BEFORE, 'a test changed the real upgrade-checkpoint skill');
  if (existsSync(REAL_SETTINGS)) assert.ok(!readFileSync(REAL_SETTINGS, 'utf8').includes('am-install-'), 'a test hook reached the real settings.json');
});

const ORIGINAL = {
  model: 'opus',
  hooks: {
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'npx some-guard' }] }],
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node "C:/x/agent-mention.js"', timeout: 10 }] }],
  },
  permissions: { allow: ['Bash(git status)'] },
};

let n = 0;
function makeHome({ settingsText } = {}) {
  n += 1;
  const home = join(scratch, `claude-${n}`);
  mkdirSync(home, { recursive: true });
  const text = settingsText ?? `${JSON.stringify(ORIGINAL, null, 2)}\n`;
  writeFileSync(join(home, 'settings.json'), text);
  return { home, settings: join(home, 'settings.json'), bytes: readFileSync(join(home, 'settings.json')) };
}

function snapshot(dir) {
  const out = {};
  for (const rel of readdirSync(dir, { recursive: true })) {
    const p = join(dir, String(rel));
    if (statSync(p).isFile()) out[String(rel).replace(/\\/g, '/')] = sha(readFileSync(p));
  }
  return out;
}

const ourCommand = (home) => `node "${home.replace(/\\/g, '/')}/agent-maturity/bin/hooks/prompt-signal.mjs"`;
const isOurs = (group) => group.hooks.some((h) => h.command.includes('agent-maturity/bin/hooks/prompt-signal.mjs'));
const ourSessionCommand = (home) => `node "${home.replace(/\\/g, '/')}/agent-maturity/bin/hooks/session-start.mjs"`;
const isOurSession = (group) => group.hooks.some((h) => h.command.includes('agent-maturity/bin/hooks/session-start.mjs'));
const ourRefreshCommand = (home) => `node "${home.replace(/\\/g, '/')}/agent-maturity/bin/standards/refresh-if-due.mjs"`;
const isOurRefresh = (group) => group.hooks.some((h) => h.command.includes('agent-maturity/bin/standards/refresh-if-due.mjs'));
const readSettings = (file) => JSON.parse(readFileSync(file, 'utf8'));
// Settings with every agent-maturity group taken out; an event list left empty is dropped.
function stripOurs(settings) {
  const hooks = { ...settings.hooks };
  for (const [event, mine] of [['UserPromptSubmit', isOurs], ['SessionStart', isOurSession]]) {
    if (!hooks[event]) continue;
    hooks[event] = hooks[event].filter((g) => !mine(g) && !isOurRefresh(g));
    if (hooks[event].length === 0) delete hooks[event];
  }
  return { ...settings, hooks };
}
const backupsIn = (home) => readdirSync(home).filter((f) => /^settings\.json\.bak-\d{8}-\d{6}(-\d+)?-agent-maturity$/.test(f));

test('install backs up settings byte-for-byte and keeps every other hook', () => {
  const { home, settings, bytes } = makeHome();
  const r = install({ claudeHome: home, env: ENV });
  assert.equal(r.code, 0, r.lines.join('\n'));
  const backups = backupsIn(home);
  assert.equal(backups.length, 1);
  assert.deepEqual(readFileSync(join(home, backups[0])), bytes);
  const next = readSettings(settings);
  const ours = next.hooks.UserPromptSubmit.filter(isOurs);
  assert.equal(ours.length, 1);
  assert.equal(next.hooks.SessionStart.filter(isOurSession).length, 1);
  assert.equal(next.hooks.SessionStart.filter(isOurRefresh).length, 1);
  assert.deepEqual(stripOurs(next), ORIGINAL);
});

test('the installed refresh launcher is its own SessionStart group: / paths, timeout 5, no matcher, no onFailure', () => {
  const { home, settings } = makeHome();
  install({ claudeHome: home, env: ENV });
  const group = readSettings(settings).hooks.SessionStart.find(isOurRefresh);
  assert.deepEqual(group, { hooks: [{ type: 'command', command: ourRefreshCommand(home), timeout: 5 }] });
  assert.ok(existsSync(join(home, 'agent-maturity', 'bin', 'standards', 'refresh-if-due.mjs')));
});

test('the installed SessionStart entry uses / paths, timeout 5, no matcher and no onFailure', () => {
  const { home, settings } = makeHome();
  install({ claudeHome: home, env: ENV });
  const group = readSettings(settings).hooks.SessionStart.find(isOurSession);
  assert.deepEqual(group, { hooks: [{ type: 'command', command: ourSessionCommand(home), timeout: 5 }] });
  assert.ok(!group.hooks[0].command.includes('\\'));
});

test('an install from before D3 gets only the missing SessionStart group', () => {
  const d1Only = { ...ORIGINAL, hooks: { ...ORIGINAL.hooks, UserPromptSubmit: [...ORIGINAL.hooks.UserPromptSubmit, { hooks: [{ type: 'command', command: 'node "C:/old/agent-maturity/bin/hooks/prompt-signal.mjs"', timeout: 5 }] }] } };
  const { home, settings } = makeHome({ settingsText: `${JSON.stringify(d1Only, null, 2)}\n` });
  const r = install({ claudeHome: home, env: ENV });
  assert.equal(r.code, 0, r.lines.join('\n'));
  assert.ok(r.lines.some((l) => l.startsWith('add SessionStart hook')));
  assert.ok(!r.lines.some((l) => l.startsWith('add UserPromptSubmit hook')));
  const next = readSettings(settings);
  assert.equal(next.hooks.UserPromptSubmit.filter(isOurs).length, 1);
  assert.equal(next.hooks.SessionStart.filter(isOurSession).length, 1);
});

test('foreign SessionStart hooks are kept on install and on a remove-group uninstall', () => {
  const theirs = { matcher: 'startup|clear', hooks: [{ type: 'command', command: 'node "C:/x/agent-routing/session-start.js"', timeout: 10 }] };
  const withSession = { ...ORIGINAL, hooks: { ...ORIGINAL.hooks, SessionStart: [theirs] } };
  const { home, settings } = makeHome({ settingsText: `${JSON.stringify(withSession, null, 2)}\n` });
  install({ claudeHome: home, env: ENV });
  assert.deepEqual(readSettings(settings).hooks.SessionStart[0], theirs);
  assert.deepEqual(stripOurs(readSettings(settings)), withSession);
  const edited = readSettings(settings);
  edited.theme = 'dark';
  writeFileSync(settings, `${JSON.stringify(edited, null, 2)}\n`);
  const u = uninstall({ claudeHome: home, env: ENV });
  assert.equal(u.mode, 'remove-group');
  assert.deepEqual(readSettings(settings), { ...withSession, theme: 'dark' });
});

test('a SessionStart value that is not a list stops install with nothing written', () => {
  const odd = { ...ORIGINAL, hooks: { ...ORIGINAL.hooks, SessionStart: { hooks: [] } } };
  const { home } = makeHome({ settingsText: `${JSON.stringify(odd, null, 2)}\n` });
  const before = snapshot(home);
  const r = install({ claudeHome: home, env: ENV });
  assert.equal(r.code, 1);
  assert.equal(r.error, 'settings_invalid');
  assert.deepEqual(snapshot(home), before);
});

test('the installed hook entry uses / paths, timeout 5 and no onFailure', () => {
  const { home, settings } = makeHome();
  install({ claudeHome: home, env: ENV });
  const group = readSettings(settings).hooks.UserPromptSubmit.find(isOurs);
  assert.deepEqual(group, { hooks: [{ type: 'command', command: ourCommand(home), timeout: 5 }] });
  assert.ok(!group.hooks[0].command.includes('\\'));
  assert.equal('onFailure' in group.hooks[0], false);
});

test('install copies runtime files and the marked skill, and the copied hook runs', () => {
  const { home } = makeHome();
  install({ claudeHome: home, env: ENV });
  for (const rel of ['lib/classify.mjs', 'lib/decide.mjs', 'lib/store.mjs', 'lib/transcript-tail.mjs', 'hooks/prompt-signal.mjs', 'hooks/session-start.mjs', 'standards/inject.mjs', 'standards/project-root.mjs']) {
    assert.ok(existsSync(join(home, 'agent-maturity', 'bin', rel)), rel);
  }
  assert.ok(existsSync(join(home, 'skills', 'upgrade-checkpoint', 'SKILL.md')));
  assert.ok(existsSync(join(home, 'skills', 'upgrade-checkpoint', '.agent-maturity')));
  const manifest = JSON.parse(readFileSync(join(home, 'agent-maturity', 'install-manifest.json'), 'utf8'));
  assert.equal(manifest.settingsShaAfter, sha(readFileSync(join(home, 'settings.json'))));
  assert.ok(manifest.backup.endsWith('-agent-maturity'));
  assert.ok(manifest.files.length >= 7);

  const fakeUser = join(scratch, `user-${n}`);
  mkdirSync(fakeUser);
  const env = { ...process.env, ...ENV, HOME: fakeUser, USERPROFILE: fakeUser, AGENT_MATURITY_HOME: join(home, 'agent-maturity'), CLAUDE_CODE_ENTRYPOINT: 'cli' };
  delete env.AGENT_MATURITY;
  const run = (prompt) => spawnSync(process.execPath, [join(home, 'agent-maturity', 'bin', 'hooks', 'prompt-signal.mjs')], {
    input: JSON.stringify({ prompt, session_id: 'inst-run' }), encoding: 'utf8', env, timeout: 15_000,
  });
  assert.equal(run('làm lại').status, 0);
  const r = run('merge');
  assert.equal(r.status, 0);
  assert.equal(r.stderr, '');
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.hookEventName, 'UserPromptSubmit');

  writeFileSync(join(home, 'agent-maturity', 'standards.json'), JSON.stringify({
    schema: 'agent-maturity/standards@1',
    exported_at: new Date().toISOString(),
    standards: [{ id: 'u1', scope: 'user', project_id: null, topic: 'tests', title: 'Chạy test thật', summary: 'Kèm mã thoát.', review_after: '2099-01-01T00:00:00Z' }],
    projects: [],
  }));
  const s = spawnSync(process.execPath, [join(home, 'agent-maturity', 'bin', 'hooks', 'session-start.mjs')], {
    input: JSON.stringify({ session_id: 'inst-run', hook_event_name: 'SessionStart', cwd: scratch }), encoding: 'utf8', env, timeout: 15_000,
  });
  assert.equal(s.status, 0);
  assert.equal(s.stderr, '');
  const out = JSON.parse(s.stdout).hookSpecificOutput;
  assert.equal(out.hookEventName, 'SessionStart');
  assert.ok(out.additionalContext.includes('Chạy test thật: Kèm mã thoát.'));
});

test('install copies the critic and the standards commands (not test-corpus or dry-runs) and they run from bin', () => {
  // Arrange
  const { home } = makeHome();
  const bin = join(home, 'agent-maturity', 'bin');
  const critic = readdirSync(join(ROOT, 'critic')).filter((f) => f.endsWith('.mjs'));

  // Act
  const r = install({ claudeHome: home, env: ENV });

  // Assert
  assert.equal(r.code, 0, r.lines.join('\n'));
  assert.ok(critic.includes('promote-gate.mjs') && critic.length >= 10, critic.join(','));
  for (const f of critic) assert.ok(existsSync(join(bin, 'critic', f)), f);
  assert.deepEqual(readdirSync(join(bin, 'critic')).sort(), [...critic].sort(), 'only the top-level critic modules');
  for (const f of ['promote-standard.mjs', 'store-cli.mjs', 'refresh.mjs', 'import-feedback.mjs']) assert.ok(existsSync(join(bin, 'standards', f)), f);
  const env = { ...process.env, ...ENV, AGENT_MATURITY_HOME: join(home, 'agent-maturity') };
  delete env.AGENT_MATURITY;
  const label = spawnSync(process.execPath, [join(bin, 'critic', 'label.mjs'), join(ROOT, 'critic', 'dry-runs', readdirSync(join(ROOT, 'critic', 'dry-runs')).find((f) => f.endsWith('.json')))], { encoding: 'utf8', env, timeout: 15_000 });
  assert.equal(label.status, 0, label.stdout + label.stderr);
  assert.ok(['pass', 'owner_review_required', 'hard_reject'].includes(JSON.parse(label.stdout).floor));
  const door = spawnSync(process.execPath, [join(bin, 'standards', 'promote-standard.mjs'), '--candidate', 'some-case', '--owner-message', '0b7c3f52-6a1e-4f0e-9d2a-3c5b8e1f7a90:2026-11-21T10:00:00.000Z'], { encoding: 'utf8', env, timeout: 15_000 });
  assert.equal(door.status, 1, door.stdout + door.stderr);
  assert.equal(JSON.parse(door.stdout).error, 'owner_message_unverified', 'the installed door loads and fails closed without a hook log');
  const u = uninstall({ claudeHome: home, env: ENV });
  assert.equal(u.code, 0, u.lines.join('\n'));
  assert.equal(existsSync(bin), false, 'uninstall removes bin/critic and bin/standards');
});

test('installing twice keeps a single hook group and the first backup', () => {
  const { home, settings } = makeHome();
  install({ claudeHome: home, env: ENV });
  const firstManifest = readFileSync(join(home, 'agent-maturity', 'install-manifest.json'), 'utf8');
  const r = install({ claudeHome: home, env: ENV });
  assert.equal(r.code, 0);
  assert.equal(readSettings(settings).hooks.UserPromptSubmit.filter(isOurs).length, 1);
  assert.equal(readSettings(settings).hooks.SessionStart.filter(isOurSession).length, 1);
  assert.equal(readSettings(settings).hooks.SessionStart.filter(isOurRefresh).length, 1);
  assert.equal(backupsIn(home).length, 1);
  assert.equal(JSON.parse(readFileSync(join(home, 'agent-maturity', 'install-manifest.json'), 'utf8')).backup, JSON.parse(firstManifest).backup);
});

test('install then uninstall restores settings byte-for-byte and removes installed files', () => {
  const crlf = `${JSON.stringify(ORIGINAL, null, 4).replace(/\n/g, '\r\n')}\r\n`;
  const { home, settings, bytes } = makeHome({ settingsText: crlf });
  install({ claudeHome: home, env: ENV });
  assert.ok(readFileSync(settings, 'utf8').includes('\r\n'), 'install keeps CRLF line endings');
  const r = uninstall({ claudeHome: home, env: ENV });
  assert.equal(r.code, 0, r.lines.join('\n'));
  assert.equal(r.mode, 'restore');
  assert.deepEqual(readFileSync(settings), bytes);
  assert.equal(existsSync(join(home, 'agent-maturity', 'bin')), false);
  assert.equal(existsSync(join(home, 'agent-maturity', 'install-manifest.json')), false);
  assert.equal(existsSync(join(home, 'skills', 'upgrade-checkpoint')), false);
});

test('uninstall after a third-party settings edit removes only our group and keeps the backup', () => {
  const { home, settings } = makeHome();
  install({ claudeHome: home, env: ENV });
  const edited = readSettings(settings);
  edited.theme = 'dark';
  edited.hooks.Stop = [{ hooks: [{ type: 'command', command: 'node stop.js' }] }];
  writeFileSync(settings, `${JSON.stringify(edited, null, 2)}\n`);
  const r = uninstall({ claudeHome: home, env: ENV });
  assert.equal(r.code, 0);
  assert.equal(r.mode, 'remove-group');
  assert.ok(r.lines.some((l) => /backup kept/i.test(l)));
  const expected = { ...ORIGINAL, theme: 'dark', hooks: { ...ORIGINAL.hooks, Stop: edited.hooks.Stop } };
  assert.deepEqual(readSettings(settings), expected);
  assert.equal(backupsIn(home).length, 1);
});

test('uninstall drops an emptied UserPromptSubmit list it created', () => {
  const bare = { model: 'opus', hooks: { PreToolUse: ORIGINAL.hooks.PreToolUse } };
  const { home, settings } = makeHome({ settingsText: `${JSON.stringify(bare, null, 2)}\n` });
  install({ claudeHome: home, env: ENV });
  const edited = readSettings(settings);
  edited.theme = 'light';
  writeFileSync(settings, JSON.stringify(edited, null, 2));
  uninstall({ claudeHome: home, env: ENV });
  assert.deepEqual(readSettings(settings), { ...bare, theme: 'light' });
});

test('--dry-run writes nothing for install or uninstall', () => {
  const { home } = makeHome();
  const before = snapshot(home);
  const r = install({ claudeHome: home, dryRun: true, env: ENV });
  assert.equal(r.code, 0);
  assert.ok(r.lines.length > 0);
  assert.deepEqual(snapshot(home), before);
  install({ claudeHome: home, env: ENV });
  const installed = snapshot(home);
  assert.equal(uninstall({ claudeHome: home, dryRun: true, env: ENV }).code, 0);
  assert.deepEqual(snapshot(home), installed);
});

test('broken settings JSON exits 1 and writes nothing (CLI)', () => {
  const { home } = makeHome({ settingsText: '{ "hooks": ' });
  const before = snapshot(home);
  const r = spawnSync(process.execPath, [join(ROOT, 'install.mjs'), '--claude-home', home], {
    encoding: 'utf8', env: { ...process.env, ...ENV }, timeout: 15_000,
  });
  assert.equal(r.status, 1);
  assert.deepEqual(snapshot(home), before);
});

test('AGENT_MATURITY_TEST=1 refuses the real ~/.claude', () => {
  const r1 = install({ claudeHome: REAL_CLAUDE, dryRun: true, env: ENV });
  assert.equal(r1.code, 1);
  assert.equal(r1.error, 'refuse_real_home');
  const { home } = makeHome();
  const r2 = install({ claudeHome: home, settingsPath: REAL_SETTINGS, dryRun: true, env: ENV });
  assert.equal(r2.error, 'refuse_real_home');
  const r3 = uninstall({ claudeHome: REAL_CLAUDE, dryRun: true, env: ENV });
  assert.equal(r3.error, 'refuse_real_home');
});

test('a foreign upgrade-checkpoint skill directory is never overwritten', () => {
  const { home } = makeHome();
  mkdirSync(join(home, 'skills', 'upgrade-checkpoint'), { recursive: true });
  writeFileSync(join(home, 'skills', 'upgrade-checkpoint', 'SKILL.md'), 'someone else');
  const before = snapshot(home);
  const r = install({ claudeHome: home, env: ENV });
  assert.equal(r.code, 1);
  assert.deepEqual(snapshot(home), before);
});

test('settings changed between read and rename aborts with temp file cleaned up', () => {
  const { home, settings } = makeHome();
  const thirdParty = `${JSON.stringify({ ...ORIGINAL, theme: 'race' }, null, 2)}\n`;
  let tmpSeen = [];
  const r = install({
    claudeHome: home,
    env: ENV,
    beforeRename: () => {
      tmpSeen = readdirSync(home).filter((f) => f.endsWith('.tmp'));
      writeFileSync(settings, thirdParty);
    },
  });
  assert.equal(r.code, 1);
  assert.equal(r.error, 'settings_changed');
  assert.equal(tmpSeen.length, 1);
  assert.match(tmpSeen[0], /^settings\.json\.\d+\.[a-f0-9]+\.tmp$/);
  assert.equal(readFileSync(settings, 'utf8'), thirdParty);
  assert.deepEqual(readdirSync(home).filter((f) => f.endsWith('.tmp')), []);
  assert.equal(existsSync(join(home, 'agent-maturity', 'install-manifest.json')), false);
});

test('uninstall keeps state and log unless --purge', () => {
  const { home } = makeHome();
  install({ claudeHome: home, env: ENV });
  const am = join(home, 'agent-maturity');
  mkdirSync(join(am, 'state'), { recursive: true });
  mkdirSync(join(am, 'log'), { recursive: true });
  writeFileSync(join(am, 'state', 's.json'), '{}');
  writeFileSync(join(am, 'log', 'events-2026-11.jsonl'), '{}\n');
  writeFileSync(join(am, 'standards.json'), '{}\n');
  uninstall({ claudeHome: home, env: ENV });
  assert.ok(existsSync(join(am, 'state', 's.json')));
  assert.ok(existsSync(join(am, 'log', 'events-2026-11.jsonl')));
  assert.ok(existsSync(join(am, 'standards.json')), 'the standards export stays without --purge');
  install({ claudeHome: home, env: ENV });
  uninstall({ claudeHome: home, purge: true, env: ENV });
  assert.equal(existsSync(am), false);
});

test('uninstall never deletes a manifest path outside its own folders', () => {
  const { home } = makeHome();
  install({ claudeHome: home, env: ENV });
  const victim = join(scratch, `victim-${n}.txt`);
  writeFileSync(victim, 'keep me');
  const manifestPath = join(home, 'agent-maturity', 'install-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.files.push(victim.replace(/\\/g, '/'), join(home, 'settings.json').replace(/\\/g, '/'));
  writeFileSync(manifestPath, JSON.stringify(manifest));
  uninstall({ claudeHome: home, env: ENV });
  assert.equal(readFileSync(victim, 'utf8'), 'keep me');
  assert.ok(existsSync(join(home, 'settings.json')));
});

test('uninstall never restores from a backup whose sha differs from the one recorded at install', () => {
  const { home, settings } = makeHome();
  install({ claudeHome: home, env: ENV });
  const manifest = JSON.parse(readFileSync(join(home, 'agent-maturity', 'install-manifest.json'), 'utf8'));
  writeFileSync(manifest.backup, `${JSON.stringify({ model: 'tampered', hooks: {} }, null, 2)}\n`);
  const r = uninstall({ claudeHome: home, env: ENV });
  assert.equal(r.code, 0, r.lines.join('\n'));
  assert.equal(r.mode, 'remove-group');
  assert.ok(r.lines.some((l) => /does not match/i.test(l)), r.lines.join('\n'));
  assert.deepEqual(readSettings(settings), ORIGINAL);
});

test('re-adding the hooks after they were removed records the new backup sha, so uninstall restores that state', () => {
  const { home, settings } = makeHome();
  install({ claudeHome: home, env: ENV });
  const withoutOurs = stripOurs(readSettings(settings));
  withoutOurs.theme = 'between-installs';
  writeFileSync(settings, `${JSON.stringify(withoutOurs, null, 2)}\n`);
  const beforeSecond = readFileSync(settings);
  const r = install({ claudeHome: home, env: ENV, now: new Date(Date.now() + 5_000) });
  assert.equal(r.code, 0, r.lines.join('\n'));
  const manifest = JSON.parse(readFileSync(join(home, 'agent-maturity', 'install-manifest.json'), 'utf8'));
  assert.deepEqual(readFileSync(manifest.backup), beforeSecond);
  assert.equal(manifest.settingsShaBefore, sha(beforeSecond));
  const u = uninstall({ claudeHome: home, env: ENV });
  assert.equal(u.mode, 'restore', u.lines.join('\n'));
  assert.deepEqual(readFileSync(settings), beforeSecond);
});

// What the D1 installer (before D3) left behind: only the UserPromptSubmit group, a byte-for-byte backup of the
// original settings and a v1 manifest without sessionHookCommand.
function d1Install(home, settings, originalBytes) {
  const slash = (p) => p.replace(/\\/g, '/');
  const d1 = readSettings(settings);
  d1.hooks.UserPromptSubmit = [...d1.hooks.UserPromptSubmit, { hooks: [{ type: 'command', command: ourCommand(home), timeout: 5 }] }];
  const text = `${JSON.stringify(d1, null, 2)}\n`;
  const backup = join(home, 'settings.json.bak-20261119-100000-agent-maturity');
  writeFileSync(backup, originalBytes);
  writeFileSync(settings, text);
  const bin = join(home, 'agent-maturity', 'bin');
  const files = ['lib/classify.mjs', 'lib/decide.mjs', 'lib/store.mjs', 'lib/transcript-tail.mjs', 'hooks/prompt-signal.mjs'].map((rel) => join(bin, rel));
  for (const f of files) {
    mkdirSync(join(f, '..'), { recursive: true });
    writeFileSync(f, '// d1\n');
  }
  writeFileSync(join(home, 'agent-maturity', 'install-manifest.json'), `${JSON.stringify({
    v: 1,
    installedAt: '2026-11-19T10:00:00.000Z',
    claudeHome: slash(home),
    settingsPath: slash(settings),
    backup: slash(backup),
    settingsShaBefore: sha(originalBytes),
    settingsShaAfter: sha(Buffer.from(text, 'utf8')),
    hookCommand: ourCommand(home),
    files: files.map(slash),
  }, null, 2)}\n`);
}
const hasAgentMaturityHook = (settings) => JSON.stringify(settings).includes('agent-maturity/bin/hooks/');

test('upgrade D1 -> D3 then uninstall leaves no agent-maturity hook and keeps every other hook', () => {
  const { home, settings, bytes } = makeHome();
  d1Install(home, settings, bytes);
  const r = install({ claudeHome: home, env: ENV, now: new Date(Date.now() + 5_000) });
  assert.equal(r.code, 0, r.lines.join('\n'));
  assert.equal(readSettings(settings).hooks.SessionStart.filter(isOurSession).length, 1);
  assert.equal(backupsIn(home).length, 1, 'settings unchanged since D1: the original backup is reused, no new one');
  const u = uninstall({ claudeHome: home, env: ENV });
  assert.equal(u.code, 0, u.lines.join('\n'));
  assert.equal(u.mode, 'restore', u.lines.join('\n'));
  assert.equal(hasAgentMaturityHook(readSettings(settings)), false, 'no dangling prompt-signal.mjs entry');
  assert.deepEqual(readSettings(settings), ORIGINAL);
  assert.deepEqual(readFileSync(settings), bytes);
});

test('upgrade after settings changed since D1: a backup that holds our hook is never restored', () => {
  const { home, settings, bytes } = makeHome();
  d1Install(home, settings, bytes);
  const edited = readSettings(settings);
  edited.theme = 'dark';
  writeFileSync(settings, `${JSON.stringify(edited, null, 2)}\n`);
  const r = install({ claudeHome: home, env: ENV, now: new Date(Date.now() + 5_000) });
  assert.equal(r.code, 0, r.lines.join('\n'));
  const manifest = JSON.parse(readFileSync(join(home, 'agent-maturity', 'install-manifest.json'), 'utf8'));
  assert.ok(readFileSync(manifest.backup, 'utf8').includes('prompt-signal.mjs'), 'the new backup holds the D1 hook');
  const u = uninstall({ claudeHome: home, env: ENV });
  assert.equal(u.code, 0, u.lines.join('\n'));
  assert.equal(u.mode, 'remove-group', u.lines.join('\n'));
  assert.ok(u.lines.some((l) => /backup .* holds an agent-maturity hook/i.test(l)), u.lines.join('\n'));
  const after = readSettings(settings);
  assert.equal(hasAgentMaturityHook(after), false);
  assert.deepEqual(after, { ...ORIGINAL, theme: 'dark' });
});
