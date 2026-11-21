import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildContext } from '../standards/inject.mjs';
import { checkoutInfo, samePath } from '../standards/project-root.mjs';
import {
  DEFAULT_CLI,
  DEFAULT_PYTHON,
  DEFAULT_STORE,
  DEFAULT_VAULT,
  StoreCliError,
  buildExport,
  capture,
  cliAvailable,
  exportActive,
  get,
  listProjects,
  promote,
  pythonEnv,
  retract,
  supersede,
  userSource,
} from '../standards/store-cli.mjs';
import { doorCandidateId, doorEntry, doorSource, doorStandard, doorTopic, rawCli } from './fixtures/door-standard.mjs';
import { realHomeLeaks, realHomeSnapshot } from './real-home-guard.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const STARIZZI_ROOT = 'F:\\Ai Tools\\Tool Starizzi - B2C - Openclaw';
const STARIZZI_ID = '2a906db6-a103-5375-b672-ad090f686c7e';
const REAL_BEFORE = realHomeSnapshot();
const ENV = { ...process.env, AGENT_MATURITY_TEST: '1' };
delete ENV.AGENT_MATURITY_HOME;
const skip = !cliAvailable() && 'KnowledgeMemory CLI or bundled Python not found';

const sha = (buf) => createHash('sha256').update(buf).digest('hex');

// Every record these tests write has a source "claude-session://sess-…" (real Claude session ids are UUIDs) or
// one of two fixed topic keys. These strings in the real store or vault can only come from a test that escaped
// its temp store; another session writing the real store mid-run changes its bytes but never adds them.
const TEST_TRACES = ['claude-session://sess-', 'some-other-memory', 'cli-other-memory'];
function readIfPresent(p) {
  try {
    return statSync(p).isFile() ? readFileSync(p) : null;
  } catch {
    return null; // removed or rewritten by another writer between listing and reading
  }
}
function testTraces(store = DEFAULT_STORE, vault = DEFAULT_VAULT) {
  const files = ['memory.sqlite3', 'memory.sqlite3-wal'].map((f) => join(store, f));
  if (existsSync(vault)) files.push(...readdirSync(vault, { recursive: true }).map((rel) => join(vault, String(rel))));
  const hits = [];
  for (const p of files) {
    const bytes = readIfPresent(p);
    if (!bytes) continue;
    for (const needle of TEST_TRACES) if (bytes.includes(needle)) hits.push(`${p}: ${needle}`);
  }
  return hits;
}

// Diagnostic only (see the last test): another session may change these bytes while the tests run.
function realStoreDigest() {
  const files = {};
  for (const f of ['memory.sqlite3', 'memory.sqlite3-wal', 'memory.sqlite3-shm']) {
    const p = join(DEFAULT_STORE, f);
    files[f] = existsSync(p) ? sha(readFileSync(p)) : null;
  }
  const h = createHash('sha256');
  if (existsSync(DEFAULT_VAULT)) {
    for (const rel of readdirSync(DEFAULT_VAULT, { recursive: true }).map(String).sort()) {
      const bytes = readIfPresent(join(DEFAULT_VAULT, rel));
      if (!bytes) continue;
      h.update(`${rel.split(sep).join('/')}\0`);
      h.update(bytes);
    }
  }
  return { files, vault: h.digest('hex') };
}
const realAtStart = realStoreDigest();

const scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'am-store-')));
after(() => {
  rmSync(scratch, { recursive: true, force: true });
  assert.deepEqual(realHomeLeaks(REAL_BEFORE), [], 'a test wrote into the real ~/.claude/agent-maturity');
});

let n = 0;
function newStore() {
  n += 1;
  const dir = join(scratch, `s${n}`);
  mkdirSync(join(dir, 'store'), { recursive: true });
  mkdirSync(join(dir, 'vault'), { recursive: true });
  return { store: join(dir, 'store'), vault: join(dir, 'vault'), out: join(dir, 'home', 'standards.json'), criticStore: join(dir, 'critic'), env: ENV };
}

const candidate = (topic, summary, session, extra = {}) => ({
  topic,
  title: `Chuẩn ${topic}`,
  summary,
  source: userSource(session, '2026-11-21T01:00:00Z'),
  ...extra,
});
const ids = (list) => list.map((s) => s.id);

test('capture → promote → export → supersede → export on a temp store', { skip }, (t) => {
  const s = newStore();
  const first = capture(doorEntry('verify-before-done', 'Báo xong phải kèm lệnh test và mã thoát.', 'sess-1'), s);
  assert.equal(first.state, 'candidate');
  assert.equal(first.scope, 'user');
  assert.equal(first.topic_key, `dev-standard/${doorTopic('verify-before-done')}`);
  assert.equal(exportActive(s).standards.length, 0, 'a candidate is not exported');

  assert.equal(doorStandard('verify-before-done', 'Báo xong phải kèm lệnh test và mã thoát.', 'sess-1', s).id, first.id);
  const e1 = exportActive(s);
  assert.deepEqual(ids(e1.standards), [first.id]);
  assert.equal(e1.standards[0].topic, doorTopic('verify-before-done'));
  assert.deepEqual(JSON.parse(readFileSync(s.out, 'utf8')), e1, 'the file holds what was returned');

  const second = doorStandard('verify-before-done', 'Báo xong phải kèm lệnh test, mã thoát và log.', 'sess-2', s);
  const clash = exportActive(s);
  assert.deepEqual(ids(clash.standards), [], 'two active standards on one topic are both held back');
  assert.deepEqual(clash.skipped.map((k) => k.reason), ['conflict', 'conflict']);

  const old = supersede(first.id, second.id, 'owner replaced the wording', s);
  assert.equal(old.state, 'superseded');
  assert.equal(old.superseded_by, second.id);
  const e2 = exportActive(s);
  assert.deepEqual(ids(e2.standards), [second.id]);
  assert.match(e2.standards[0].summary, /log/);
  assert.equal(get(first.id, s).state, 'superseded', 'history is kept');

  retract(second.id, 'owner dropped it', s);
  assert.deepEqual(exportActive(s).standards, []);
  t.diagnostic(`export1=[${ids(e1.standards)}] conflict-skipped=${clash.skipped.length} export2=[${ids(e2.standards)}] old=${first.id} superseded_by=${old.superseded_by}`);
});

test('project scope from a worktree path lands on the main checkout project', { skip }, (t) => {
  const s = newStore();
  const info = checkoutInfo(REPO_ROOT);
  assert.ok(info.root, 'the repo is a git checkout');
  const rec = capture(doorEntry('repo-only', 'Chạy test agent-maturity trước khi mở PR.', 'sess-3', { scope: 'project', projectPath: join(REPO_ROOT, 'tools') }), s);
  const projects = listProjects(s);
  assert.equal(projects.length, 1);
  assert.ok(samePath(projects[0].root, info.root), `${projects[0].root} vs ${info.root}`);
  assert.equal(rec.project_id, projects[0].id);
  if (samePath(info.root, STARIZZI_ROOT)) assert.equal(rec.project_id, STARIZZI_ID);

  const again = capture(candidate('repo-only-2', 'Ghi bằng chứng vào mô tả PR.', 'sess-3', { scope: 'project', projectPath: REPO_ROOT }), s);
  assert.equal(again.project_id, rec.project_id);
  assert.equal(listProjects(s).length, 1, 'the main checkout is registered once');

  assert.equal(doorStandard('repo-only', 'Chạy test agent-maturity trước khi mở PR.', 'sess-3', s, { scope: 'project', projectPath: join(REPO_ROOT, 'tools') }).id, rec.id);
  doorStandard('all-projects', 'Áp cho mọi dự án.', 'sess-3', s);
  const e = exportActive(s);
  assert.deepEqual(e.projects.map((p) => p.id), [rec.project_id]);
  assert.equal(buildContext(e, scratch).includes('Chuẩn repo-only'), false, 'another folder does not see the project standard');

  // End to end: the real hook reads this export and injects it for a session opened in the worktree.
  const env = { ...ENV, AGENT_MATURITY_HOME: join(s.out, '..') };
  delete env.AGENT_MATURITY;
  const hook = spawnSync(process.execPath, [join(ROOT, 'hooks', 'session-start.mjs')], {
    input: JSON.stringify({ session_id: 'e2e', hook_event_name: 'SessionStart', source: 'startup', cwd: REPO_ROOT }), encoding: 'utf8', env, timeout: 15_000,
  });
  assert.equal(hook.status, 0);
  const block = JSON.parse(hook.stdout).hookSpecificOutput.additionalContext;
  assert.ok(block.includes('Chuẩn repo-only'));
  assert.ok(block.includes('Chuẩn all-projects'));
  assert.ok(block.length <= 1200);
  t.diagnostic(`worktree ${REPO_ROOT} -> project ${rec.project_id} root ${projects[0].root}; injected block ${block.length} chars`);
});

test('user is the default scope; project scope needs a project; other scopes are refused', { skip }, () => {
  const s = newStore();
  assert.equal(capture(candidate('default-scope', 'Mặc định áp cho mọi dự án.', 'sess-4'), s).scope, 'user');
  assert.throws(() => capture(candidate('no-project', 'x', 'sess-4', { scope: 'project' }), s), (e) => e instanceof StoreCliError && e.code === 'bad_input');
  assert.throws(() => capture(candidate('role', 'x', 'sess-4', { scope: 'role' }), s), (e) => e.code === 'bad_input');
  assert.throws(() => capture(candidate('', 'x', 'sess-4'), s), (e) => e.code === 'bad_input');
});

test('records outside the dev-standard topic are never exported', { skip }, () => {
  const s = newStore();
  const file = join(scratch, `other-${n}.json`);
  writeFileSync(file, JSON.stringify({
    scope: 'user', kind: 'fact', topic_key: 'some-other-memory', title: 'Not a standard', summary: 'Other knowledge.',
    source: { type: 'user', uri: 'claude-session://x/2026-11-21' }, author: 'root', evidence: 'direct', confidence: 0.9,
  }));
  const other = rawCli(['capture', '--file', file], s);
  rawCli(['promote', other.id, '--basis', 'user_instruction', '--reviewer', 'root'], s);
  assert.deepEqual(exportActive(s).standards, []);
});

// A door-made record as the store lists it, and the door's standard_promoted event for it.
const doorRec = (id, extra = {}) => ({
  id, state: 'active', scope: 'user', project_id: null, topic_key: `dev-standard/${doorTopic(id)}`, kind: 'procedure', title: id, summary: id,
  basis: 'user_instruction', source: doorSource('sess-x', doorCandidateId(id)),
  review_after: '2099-01-01T00:00:00Z', source_current: true, expired: false, conflicts: [], ...extra,
});
const promotedFor = (names) => names.map((id) => ({ type: 'standard_promoted', candidateId: doorCandidateId(id), recordId: id }));

test('buildExport holds back expired, changed-source, conflicting and other-scope records with a reason', () => {
  const rec = doorRec;
  const out = buildExport({
    projects: [{ id: 'p1', root: 'C:/p1', title: 'P1' }, { id: 'p2', root: 'C:/p2', title: 'P2' }],
    records: [
      rec('ok'),
      rec('proj', { scope: 'project', project_id: 'p1' }),
      rec('cand', { state: 'candidate' }),
      rec('old', { expired: true }),
      rec('changed', { source_current: false }),
      rec('clash', { conflicts: ['x'] }),
      rec('role', { scope: 'role' }),
      rec('foreign', { topic_key: 'other' }),
    ],
  }, new Date('2026-11-21T00:00:00Z'), promotedFor(['ok', 'proj', 'cand', 'old', 'changed', 'clash', 'role', 'foreign']));
  assert.deepEqual(ids(out.standards), ['ok', 'proj']);
  assert.deepEqual(out.projects, [{ id: 'p1', root: 'C:/p1' }]);
  assert.deepEqual(out.skipped, [
    { id: 'old', topic: doorTopic('old'), reason: 'review_due' },
    { id: 'changed', topic: doorTopic('changed'), reason: 'source_changed' },
    { id: 'clash', topic: doorTopic('clash'), reason: 'conflict' },
    { id: 'role', topic: doorTopic('role'), reason: 'unsupported_scope' },
  ]);
  assert.equal(out.schema, 'agent-maturity/standards@1');
  assert.equal(out.exported_at, '2026-11-21T00:00:00.000Z');
});

test('buildExport passes on only what the door made: door topic, user_instruction, door source and its standard_promoted event', () => {
  // Arrange
  const rec = doorRec;
  const plainSource = userSource('sess-x', '2026-11-21T01:00:00Z');
  const records = [
    rec('door'),
    rec('no-event'),
    rec('other-record-event'),
    rec('other-candidate-event'),
    rec('named-topic', { topic_key: 'dev-standard/named-topic' }),
    rec('import', { topic_key: `dev-standard/import/${doorTopic('import')}` }),
    rec('artifact-basis', { basis: 'verified_artifact' }),
    rec('artifact-source', { source: { ...doorSource('sess-x', doorCandidateId('artifact-source')), type: 'artifact' } }),
    rec('plain-source', { source: plainSource }),
    rec('extra-query', { source: { ...plainSource, uri: `${doorSource('sess-x', doorCandidateId('extra-query')).uri}&x=1` } }),
  ];
  const promoted = [
    ...promotedFor(['door', 'named-topic', 'import', 'artifact-basis', 'artifact-source', 'plain-source', 'extra-query']),
    { type: 'standard_promoted', candidateId: doorCandidateId('other-record-event'), recordId: 'door' },
    { type: 'standard_promoted', candidateId: doorCandidateId('door'), recordId: 'other-candidate-event' },
  ];

  // Act
  const out = buildExport({ projects: [], records }, new Date('2026-11-21T00:00:00Z'), promoted);

  // Assert
  assert.deepEqual(ids(out.standards), ['door']);
  assert.deepEqual(out.skipped.map((k) => [k.id, k.reason]), records.slice(1).map((r) => [r.id, 'not_via_door']));
  assert.deepEqual(ids(buildExport({ projects: [], records }, new Date('2026-11-21T00:00:00Z')).standards), [], 'no log, nothing passes');
});

test('AGENT_MATURITY_TEST=1 refuses the real store, vault and ~/.claude export', () => {
  const tmp = newStore();
  const refused = (e) => e instanceof StoreCliError && e.code === 'refuse_real_store';
  assert.throws(() => capture(candidate('x', 'y', 'z'), { env: ENV }), refused);
  assert.throws(() => promote('00000000-0000-0000-0000-000000000000', 'user_instruction', { store: DEFAULT_STORE, vault: tmp.vault, env: ENV }), refused);
  assert.throws(() => retract('00000000-0000-0000-0000-000000000000', 'r', { store: tmp.store, vault: DEFAULT_VAULT, env: ENV }), refused);
  assert.throws(() => exportActive({ store: tmp.store, vault: tmp.vault, env: ENV }), refused, 'default export target is the real ~/.claude');
});

test('CLI rejections surface as StoreCliError without payload text', { skip }, () => {
  const s = newStore();
  const secret = 'owner.private@example.com';
  let caught = null;
  try {
    capture(candidate('leaky', `Gửi báo cáo cho ${secret}`, 'sess-5'), s);
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof StoreCliError);
  assert.equal(caught.code, 'cli_failed');
  assert.ok(!caught.message.includes(secret));
  assert.throws(() => promote('11111111-1111-1111-1111-111111111111', 'user_instruction', s), (e) => e.code === 'cli_failed');
});

test('the command line refuses to promote a dev standard and re-exports after other promotes', { skip }, () => {
  const s = newStore();
  const rec = capture(doorEntry('cli-flow', 'Dùng đường dẫn tuyệt đối trong worktree.', 'sess-6'), s);
  const cli = (...args) => spawnSync(process.execPath, [join(ROOT, 'standards', 'store-cli.mjs'), ...args, '--store', s.store, '--vault', s.vault, '--out', s.out, '--critic-store', s.criticStore], {
    encoding: 'utf8', env: ENV, timeout: 60_000,
  });
  const refused = cli('promote', rec.id, '--basis', 'user_instruction');
  assert.equal(refused.status, 1, refused.stdout + refused.stderr);
  assert.equal(JSON.parse(refused.stdout).error, 'promote_requires_gate');
  assert.equal(get(rec.id, s).state, 'candidate');
  const file = join(scratch, `cli-other-${n}.json`);
  writeFileSync(file, JSON.stringify({
    scope: 'user', kind: 'fact', topic_key: 'cli-other-memory', title: 'Not a standard', summary: 'Other knowledge.',
    source: { type: 'user', uri: 'claude-session://x/2026-11-21' }, author: 'root', evidence: 'direct', confidence: 0.9,
  }));
  const other = rawCli(['capture', '--file', file], s);
  const r = cli('promote', other.id, '--basis', 'user_instruction');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const printed = JSON.parse(r.stdout);
  assert.equal(printed.result.state, 'active');
  assert.equal(printed.export.standards, 0);
  assert.ok(existsSync(s.out), 'the command line re-exported');
  const bad = spawnSync(process.execPath, [join(ROOT, 'standards', 'store-cli.mjs'), 'promote', rec.id, '--store', s.store, '--vault', s.vault, '--out', s.out], { encoding: 'utf8', env: ENV, timeout: 60_000 });
  assert.equal(bad.status, 1);
});

test('buildExport holds back a record whose review_after has passed, even when the store did not flag it', () => {
  const rec = (id, reviewAfter) => doorRec(id, { review_after: reviewAfter });
  const out = buildExport({ projects: [], records: [rec('ok', '2026-12-01T00:00:00Z'), rec('due', '2026-11-20T00:00:00Z'), rec('none', null)] }, new Date('2026-11-21T00:00:00Z'), promotedFor(['ok', 'due', 'none']));
  assert.deepEqual(ids(out.standards), ['ok']);
  assert.deepEqual(out.skipped, [{ id: 'due', topic: doorTopic('due'), reason: 'review_due' }, { id: 'none', topic: doorTopic('none'), reason: 'review_due' }]);
});

test('pythonEnv drops PYTHONPATH, PYTHONHOME and PYTHONSTARTUP in any letter case and keeps UTF-8 output', () => {
  const env = pythonEnv({ PATH: 'p', PYTHONPATH: 'a', PythonHome: 'b', pythonstartup: 'c', PYTHONIOENCODING: 'latin-1', OTHER: 'o' });
  assert.deepEqual(env, { PATH: 'p', OTHER: 'o', PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' });
});

test('the CLI runs isolated: planted modules on PYTHONPATH or in the caller folder never load', { skip }, () => {
  const s = newStore();
  const planted = join(scratch, `planted-${n}`);
  mkdirSync(planted);
  const marker = join(scratch, `planted-ran-${n}.txt`);
  const code = `open(${JSON.stringify(marker)}, "w").write("ran")\nraise SystemExit(97)\n`;
  for (const m of ['argparse.py', 'json.py', 'memory_store.py', 'runpy.py']) writeFileSync(join(planted, m), code);
  const env = { ...ENV, PYTHONPATH: planted, PYTHONHOME: join(planted, 'no-such-home'), PYTHONSTARTUP: join(planted, 'json.py') };
  const previous = process.cwd();
  process.chdir(planted);
  try {
    const rec = capture(candidate('isolated-python', 'Chạy CLI ở chế độ cô lập.', 'sess-7'), { ...s, env });
    assert.equal(rec.state, 'candidate');
    assert.equal(exportActive({ ...s, env }).standards.length, 0);
  } finally {
    process.chdir(previous);
  }
  assert.equal(existsSync(marker), false, 'no planted module ran');
});

test('the real-store guard sees through junctions and 8.3 names, also for paths not created yet', { skip: !existsSync(DEFAULT_STORE) && 'no real store on this machine' }, () => {
  const tmp = newStore();
  // A missing Python makes any call that slips past the guard fail before it can touch a store.
  const noPython = join(scratch, 'no-python.exe');
  const refused = (e) => e instanceof StoreCliError && e.code === 'refuse_real_store';
  const codexLink = join(scratch, `codex-link-${n}`);
  const storeLink = join(scratch, `store-link-${n}`);
  symlinkSync(dirname(DEFAULT_STORE), codexLink, 'junction');
  symlinkSync(DEFAULT_STORE, storeLink, 'junction');
  try {
    assert.throws(() => capture(candidate('x', 'y', 'z'), { store: storeLink, vault: tmp.vault, python: noPython, env: ENV }), refused);
    assert.throws(() => exportActive({ store: join(codexLink, 'KnowledgeMemory'), vault: tmp.vault, out: tmp.out, python: noPython, env: ENV }), refused);
    assert.throws(() => exportActive({ store: tmp.store, vault: join(codexLink, 'KnowledgeVault'), out: tmp.out, python: noPython, env: ENV }), refused);
    assert.throws(() => listProjects({ store: join(codexLink, 'KnowledgeMemory', 'not-created-yet'), vault: tmp.vault, python: noPython, env: ENV }), refused);
  } finally {
    unlinkSync(codexLink);
    unlinkSync(storeLink);
  }
  const homeLink = join(scratch, `home-link-${n}`);
  symlinkSync(join(homedir(), '.claude'), homeLink, 'junction');
  try {
    assert.throws(() => exportActive({ store: tmp.store, vault: tmp.vault, out: join(homeLink, 'agent-maturity-guard-test', 'standards.json'), python: noPython, env: ENV }), refused);
  } finally {
    unlinkSync(homeLink);
  }
  // os.tmpdir() may be an 8.3 path (C:\Users\ABCDEF~1\...); its home part then names the real home another way.
  const shortHome = join(tmpdir(), '..', '..', '..');
  if (!samePath(shortHome, homedir()) && samePath(realpathSync.native(shortHome), homedir())) {
    assert.throws(() => exportActive({ store: tmp.store, vault: tmp.vault, out: join(shortHome, '.claude', 'agent-maturity-guard-test', 'standards.json'), python: noPython, env: ENV }), refused);
  }
});

// exportActive in a child process WITHOUT AGENT_MATURITY_TEST, with a fake home (os.homedir()) and explicit temp
// store, vault, out, Python and CLI: prints { standards, skipped } or { error }.
const EXPORT_CHILD = [
  'const [mod, opts] = [await import(process.argv[1]), JSON.parse(process.argv[2])];',
  'try { const r = mod.exportActive({ ...opts, env: process.env }); console.log(JSON.stringify({ standards: r.standards.map((x) => x.id), skipped: r.skipped.map((x) => [x.id, x.reason]) })); }',
  'catch (e) { console.log(JSON.stringify({ error: e.code ?? e.name })); }',
].join('\n');

test('without AGENT_MATURITY_TEST the export trusts only the critic store under the home folder', { skip }, () => {
  // Arrange: a door-shaped standard whose standard_promoted event sits in a critic store outside the home folder
  const s = newStore();
  const std = doorStandard('home-critic', 'Ghi mã thoát của lệnh test.', 'sess-home', s);
  const dir = dirname(s.store);
  const fakeUser = join(dir, 'user');
  const homeCritic = join(fakeUser, '.claude', 'agent-maturity', 'critic');
  const customHome = join(dir, 'custom-home');
  mkdirSync(join(customHome, 'critic'), { recursive: true });
  writeFileSync(join(customHome, 'critic', 'log.jsonl'), readFileSync(join(s.criticStore, 'log.jsonl')));
  const env = { ...process.env, HOME: fakeUser, USERPROFILE: fakeUser, AGENT_MATURITY_HOME: customHome };
  delete env.AGENT_MATURITY_TEST;
  const storeCli = new URL('../standards/store-cli.mjs', import.meta.url).href;
  const base = { store: s.store, vault: s.vault, out: s.out, python: DEFAULT_PYTHON, cli: DEFAULT_CLI };
  const run = (opts) => {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', EXPORT_CHILD, storeCli, JSON.stringify(opts)], { encoding: 'utf8', env, timeout: 60_000 });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  const cliExport = spawnSync(process.execPath, [join(ROOT, 'standards', 'store-cli.mjs'), 'export', '--store', s.store, '--vault', s.vault, '--out', s.out, '--critic-store', s.criticStore], { encoding: 'utf8', env, timeout: 60_000 });
  const refreshed = spawnSync(process.execPath, [join(ROOT, 'standards', 'refresh.mjs'), '--store', s.store, '--vault', s.vault, '--out', s.out, '--projects-dir', join(dir, 'no-projects'), '--critic-store', s.criticStore], { encoding: 'utf8', env, timeout: 60_000 });

  // Act + Assert: --critic-store is refused before anything is read or written, AGENT_MATURITY_HOME/critic is ignored
  assert.deepEqual(run({ ...base, criticStore: s.criticStore }), { error: 'critic_store_test_only' });
  assert.equal(cliExport.status, 1, cliExport.stdout + cliExport.stderr);
  assert.equal(JSON.parse(cliExport.stdout).error, 'critic_store_test_only');
  assert.equal(JSON.parse(refreshed.stdout).export.error, 'critic_store_test_only');
  assert.equal(existsSync(s.out), false, 'nothing exported');
  assert.deepEqual(run(base), { standards: [], skipped: [[std.id, 'not_via_door']] });

  // Act + Assert: the same event under <home>/.claude/agent-maturity/critic is the one the export reads
  mkdirSync(homeCritic, { recursive: true });
  writeFileSync(join(homeCritic, 'log.jsonl'), readFileSync(join(s.criticStore, 'log.jsonl')));
  assert.deepEqual(run(base), { standards: [std.id], skipped: [] });
  assert.deepEqual(run({ ...base, criticStore: homeCritic }), { standards: [std.id], skipped: [] }, 'naming the home store is allowed');
});

test('the trace scan finds a test string that reached a store or a vault', () => {
  // Arrange: a store and a vault that each hold one trace, and a clean pair
  const dir = join(scratch, 'traces');
  mkdirSync(join(dir, 'store'), { recursive: true });
  mkdirSync(join(dir, 'vault', 'notes'), { recursive: true });
  writeFileSync(join(dir, 'store', 'memory.sqlite3'), Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from('claude-session://sess-1/x')]));
  writeFileSync(join(dir, 'vault', 'notes', 'a.md'), 'topic: cli-other-memory');
  mkdirSync(join(dir, 'clean-store'), { recursive: true });
  mkdirSync(join(dir, 'clean-vault'), { recursive: true });
  writeFileSync(join(dir, 'clean-store', 'memory.sqlite3'), 'claude-session://0f2c9a1e-real-session/x');

  // Act
  const dirty = testTraces(join(dir, 'store'), join(dir, 'vault'));
  const clean = testTraces(join(dir, 'clean-store'), join(dir, 'clean-vault'));

  // Assert
  assert.equal(dirty.length, 2, dirty.join('\n'));
  assert.deepEqual(clean, []);
});

test('nothing these tests write reaches the real KnowledgeMemory store or vault', (t) => {
  // Another session may write the real store while this file runs, so its bytes are not compared;
  // only strings that these tests alone write are looked for.
  assert.deepEqual(testTraces(), []);
  const changed = JSON.stringify(realStoreDigest()) !== JSON.stringify(realAtStart);
  t.diagnostic(changed ? 'real store or vault changed during the run (another writer); no test traces in it' : 'real store and vault byte-identical');
});
