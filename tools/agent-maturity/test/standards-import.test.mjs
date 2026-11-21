import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs, { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { findFeedbackNotes, importFeedbackNotes, noteCandidate, parseNote } from '../standards/import-feedback.mjs';
import { IMPORT_AUTHOR, StoreCliError, capture, claimPromoteGate, cliAvailable, exportActive, get, promote, retract, runCli, userSource } from '../standards/store-cli.mjs';

// These tests exercise the store, not the door: they hold the gate token promote-standard.mjs normally holds.
const gate = claimPromoteGate();

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const REAL_MATURITY_HOME = join(homedir(), '.claude', 'agent-maturity');
const ENV = { ...process.env, AGENT_MATURITY_TEST: '1' };
const skip = !cliAvailable() && 'KnowledgeMemory CLI or bundled Python not found';
const scratch = realpathSync.native(mkdtempSync(join(tmpdir(), 'am-import-')));
after(() => {
  rmSync(scratch, { recursive: true, force: true });
  assert.equal(existsSync(REAL_MATURITY_HOME), false, 'real ~/.claude/agent-maturity must not exist');
});

const NESTED = [
  '---',
  'name: verify-before-done',
  'description: "Always run the real test before saying done — include the exit code"',
  'metadata: ',
  '  node_type: memory',
  '  type: feedback',
  '  originSessionId: 0d52eaca-18c7-4138-8910-4cb82f211580',
  '---',
  '',
  'The owner asked twice for test output.',
  '',
  '**How to apply:** paste the command and its exit code.',
  '',
].join('\n');
const TOP = '---\r\nname: deploy-base-check\r\ndescription: Check the live sha before deploying\r\ntype: feedback\r\n---\r\n\r\nParallel sessions deploy.\r\n';
const PROJECT_NOTE = '---\nname: release-state\ndescription: beta shipped\nmetadata:\n  type: project\n---\n\nState only.\n';
const LEAKY = '---\nname: leaky\ndescription: mail the report\nmetadata:\n  type: feedback\n---\n\nSend it to owner.private@example.com every week.\n';

function makeProjects() {
  // No long digit runs in the path: the store rejects a source URI holding a 13-19 digit Luhn-valid number as a card.
  const dir = mkdtempSync(join(scratch, 'projects-'));
  const put = (rel, text) => {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), text);
  };
  put('F--repo-a/memory/verify-before-done.md', NESTED);
  put('F--repo-a/memory/release-state.md', PROJECT_NOTE);
  put('F--repo-a/memory/MEMORY.md', '- [verify](verify-before-done.md) — index line\n');
  put('F--repo-b/memory/deploy-base-check.md', TOP);
  put('F--repo-c/memory/leaky.md', LEAKY);
  put('F--repo-d/elsewhere/not-memory.md', NESTED);
  return dir;
}

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const notesDigest = (dir) => Object.fromEntries(readdirSync(dir, { recursive: true })
  .map((rel) => join(dir, String(rel)))
  .filter((p) => statSync(p).isFile())
  .map((p) => [p, `${sha(p)} ${statSync(p).mtimeMs}`]));

function newStore() {
  const dir = mkdtempSync(join(scratch, 'store-'));
  mkdirSync(join(dir, 'store'));
  mkdirSync(join(dir, 'vault'));
  return { store: join(dir, 'store'), vault: join(dir, 'vault'), env: ENV };
}
const events = (s, type) => runCli(['audit'], s).filter((e) => e.type === type);

test('parseNote reads nested metadata and top-level type, quoted or not', () => {
  const nested = parseNote(NESTED);
  assert.equal(nested.type, 'feedback');
  assert.equal(nested.name, 'verify-before-done');
  assert.equal(nested.description, 'Always run the real test before saying done — include the exit code');
  assert.match(nested.body, /How to apply/);
  const top = parseNote(TOP);
  assert.equal(top.type, 'feedback');
  assert.equal(top.description, 'Check the live sha before deploying');
  assert.equal(parseNote(PROJECT_NOTE).type, 'project');
  assert.equal(parseNote(`\uFEFF${TOP}`).type, 'feedback', 'a UTF-8 BOM is allowed');
  assert.equal(parseNote('no frontmatter here'), null);
  assert.equal(parseNote('---\nname: x\n'), null);
});

test('findFeedbackNotes returns only type feedback notes inside <project>/memory', () => {
  const dir = makeProjects();
  const found = findFeedbackNotes(dir).map((n) => n.name).sort();
  assert.deepEqual(found, ['deploy-base-check', 'leaky', 'verify-before-done']);
  assert.deepEqual(findFeedbackNotes(join(scratch, 'missing-dir')), []);
});

test('noteCandidate makes a user-scope candidate with an artifact source and bounded text', () => {
  const [note] = findFeedbackNotes(makeProjects()).filter((n) => n.name === 'verify-before-done');
  const c = noteCandidate({ ...note, body: 'x '.repeat(2000) });
  assert.equal(c.scope, 'user');
  assert.match(c.topic, /^import\/verify-before-done-[0-9a-f]{8}$/);
  assert.equal(c.author, IMPORT_AUTHOR);
  assert.equal(c.source.type, 'artifact');
  assert.equal(c.source.sha256, sha(note.file));
  assert.ok(!c.source.uri.includes('\\'));
  assert.equal(c.evidence, 'derived');
  assert.ok(c.summary.length <= 1200);
  assert.ok(c.title.length <= 160);
});

test('import captures candidates only, is safe to repeat, and never edits the notes', { skip }, () => {
  const dir = makeProjects();
  const s = newStore();
  const before = notesDigest(dir);

  const first = importFeedbackNotes({ projectsDir: dir, ...s });
  assert.equal(first.feedback, 3);
  assert.equal(first.captured.length, 2, JSON.stringify(first));
  assert.ok(first.captured.every((c) => c.state === 'candidate'));
  assert.deepEqual(first.failed.map((f) => f.error), ['cli_failed']);
  assert.match(first.failed[0].detail, /MemoryValidationError/);
  assert.ok(!JSON.stringify(first).includes('owner.private@example.com'));

  const second = importFeedbackNotes({ projectsDir: dir, ...s });
  assert.deepEqual(second.captured.map((c) => c.id).sort(), first.captured.map((c) => c.id).sort());
  assert.equal(events(s, 'captured').length, 2, 'a repeated import adds no duplicate candidate');
  assert.equal(events(s, 'promoted').length, 0, 'import never promotes');
  assert.deepEqual(notesDigest(dir), before, 'notes are read only');

  const edited = join(dir, 'F--repo-b', 'memory', 'deploy-base-check.md');
  const oldId = first.captured.find((c) => c.file === edited.replace(/\\/g, '/')).id;
  writeFileSync(edited, TOP.replace('Parallel sessions deploy.', 'Parallel sessions deploy hotfixes.'));
  const third = importFeedbackNotes({ projectsDir: dir, ...s });
  assert.equal(events(s, 'captured').length, 3, 'an edited note becomes a new candidate');
  assert.ok(!third.captured.some((c) => c.id === oldId));
  assert.equal(get(oldId, s).source_current, false, 'the old candidate is marked as having a changed source');
});

test('the command line prints a summary', { skip }, () => {
  const dir = makeProjects();
  const s = newStore();
  const r = spawnSync(process.execPath, [join(ROOT, 'standards', 'import-feedback.mjs'), '--projects-dir', dir, '--store', s.store, '--vault', s.vault], {
    encoding: 'utf8', env: ENV, timeout: 60_000,
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.feedback, 3);
  assert.equal(out.captured.length, 2);
});

test('topics are an ASCII slug plus a short hash of the note path, so non-ASCII names never collide', () => {
  const base = { description: 'd', body: 'b', sha: 'a'.repeat(64) };
  const vi = noteCandidate({ ...base, file: 'C:/p/memory/quy-tac.md', name: 'Quy tắc kiểm thử đầy đủ' });
  const ja1 = noteCandidate({ ...base, file: 'C:/p/memory/kensho.md', name: '検証ルール' });
  const ja2 = noteCandidate({ ...base, file: 'C:/p/memory/haibi.md', name: '配備ルール' });
  assert.match(vi.topic, /^import\/quy-tac-kiem-thu-day-du-[0-9a-f]{8}$/);
  assert.match(ja1.topic, /^import\/note-[0-9a-f]{8}$/);
  assert.match(ja2.topic, /^import\/note-[0-9a-f]{8}$/);
  assert.notEqual(ja1.topic, ja2.topic);
  for (const c of [vi, ja1, ja2]) assert.ok(/^[\x21-\x7e]+$/.test(c.topic) && c.topic.length <= 120 - 'dev-standard/'.length, c.topic);
  assert.equal(noteCandidate({ ...base, file: 'C:/p/memory/kensho.md', name: '検証ルール' }).topic, ja1.topic, 'stable for one note');
});

test('a locked or unreadable note is skipped and counted, never fatal', (t) => {
  const dir = makeProjects();
  const locked = join(dir, 'F--repo-a', 'memory', 'locked.md');
  writeFileSync(locked, TOP);
  const realOpen = fs.openSync;
  t.mock.method(fs, 'openSync', (file, ...rest) => {
    if (String(file) === locked) throw Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' });
    return realOpen(file, ...rest);
  });
  const notes = findFeedbackNotes(dir);
  assert.deepEqual(notes.filter((x) => x.unreadable).map((x) => [x.file, x.unreadable]), [[locked, 'EBUSY']]);
  assert.deepEqual(notes.filter((x) => !x.unreadable).map((x) => x.name).sort(), ['deploy-base-check', 'leaky', 'verify-before-done']);
});

test('note size is checked with stat before any read', (t) => {
  const dir = mkdtempSync(join(scratch, 'big-'));
  mkdirSync(join(dir, 'F--repo', 'memory'), { recursive: true });
  writeFileSync(join(dir, 'F--repo', 'memory', 'huge.md'), `${TOP}${'x'.repeat(70 * 1024)}`);
  const readSync = t.mock.method(fs, 'readSync');
  const readFile = t.mock.method(fs, 'readFileSync');
  const notes = findFeedbackNotes(dir);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].tooLarge, true);
  assert.equal(readSync.mock.callCount() + readFile.mock.callCount(), 0, 'the oversized note was never read');
});

test('import counts an unreadable note and still captures the others', { skip }, (t) => {
  const dir = makeProjects();
  const locked = join(dir, 'F--repo-b', 'memory', 'locked.md');
  writeFileSync(locked, TOP.replace('deploy-base-check', 'locked-note'));
  const realOpen = fs.openSync;
  t.mock.method(fs, 'openSync', (file, ...rest) => {
    if (String(file) === locked) throw Object.assign(new Error('operation not permitted'), { code: 'EPERM' });
    return realOpen(file, ...rest);
  });
  const r = importFeedbackNotes({ projectsDir: dir, ...newStore() });
  assert.equal(r.error, undefined);
  assert.deepEqual(r.unreadable, [{ file: locked.replace(/\\/g, '/'), error: 'EPERM' }]);
  assert.equal(r.feedback, 3);
  assert.equal(r.captured.length, 2);
});

test('an imported candidate is never promoted, whatever the basis', { skip }, () => {
  const s = newStore();
  const first = importFeedbackNotes({ projectsDir: makeProjects(), ...s });
  const imported = first.captured[0];
  const refused = (e) => e instanceof StoreCliError && e.code === 'import_not_promotable';
  // verified_artifact would pass the store itself: the note file still matches its sha.
  assert.throws(() => promote(imported.id, 'verified_artifact', { ...s, gate }), refused);
  assert.throws(() => promote(imported.id, 'user_instruction', { ...s, gate }), refused);
  assert.equal(get(imported.id, s).state, 'candidate');
  assert.equal(events(s, 'promoted').length, 0);
});

test('a record by the importer author is refused under any topic', { skip }, () => {
  const s = newStore();
  const rec = capture({ topic: 'not-under-import', title: 'Chuẩn x', summary: 'Nội dung x.', source: userSource('sess-imp', '2026-11-21T01:00:00Z'), author: IMPORT_AUTHOR }, s);
  assert.throws(() => promote(rec.id, 'user_instruction', { ...s, gate }), (e) => e.code === 'import_not_promotable');
  assert.equal(get(rec.id, s).state, 'candidate');
});

test('documented path: root re-captures the owner-approved text with a user source, promotes it, retracts the import', { skip }, () => {
  const s = newStore();
  const out = join(s.store, '..', 'home', 'standards.json');
  const first = importFeedbackNotes({ projectsDir: makeProjects(), ...s });
  const imported = get(first.captured[0].id, s);
  const approved = capture({ topic: 'from-feedback-note', title: imported.title, summary: imported.summary, source: userSource('sess-owner', '2026-11-21T02:00:00Z') }, s);
  assert.equal(promote(approved.id, 'user_instruction', { ...s, gate }).state, 'active');
  assert.equal(retract(imported.id, `owner approved it as ${approved.id}`, s).state, 'retracted');
  const e = exportActive({ ...s, out });
  assert.deepEqual(e.standards.map((x) => x.id), [approved.id]);
  assert.equal(e.standards[0].topic, 'from-feedback-note');
});

test('import refuses the real store under AGENT_MATURITY_TEST=1', () => {
  const r = importFeedbackNotes({ projectsDir: makeProjects(), env: ENV });
  assert.equal(r.error, 'refuse_real_store');
  assert.equal(r.captured.length, 0);
});
