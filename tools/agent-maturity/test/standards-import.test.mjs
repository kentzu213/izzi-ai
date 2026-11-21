import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { findFeedbackNotes, importFeedbackNotes, noteCandidate, parseNote } from '../standards/import-feedback.mjs';
import { cliAvailable, get, runCli } from '../standards/store-cli.mjs';

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
  assert.equal(c.topic, 'import/verify-before-done');
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

test('import refuses the real store under AGENT_MATURITY_TEST=1', () => {
  const r = importFeedbackNotes({ projectsDir: makeProjects(), env: ENV });
  assert.equal(r.error, 'refuse_real_store');
  assert.equal(r.captured.length, 0);
});
