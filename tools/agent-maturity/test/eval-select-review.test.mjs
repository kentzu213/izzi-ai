import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { formatReview, selectReview } from '../eval/select-review.mjs';

const SCRIPT = fileURLToPath(new URL('../eval/select-review.mjs', import.meta.url));
const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'am-review-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

// Synthetic items: [id, split, gold, predicted label or null, extra label fields]
const n2 = (i) => String(i).padStart(2, '0');
const ITEMS = [
  ...Array.from({ length: 16 }, (_, i) => [`h${n2(i + 1)}`, 'test', 'approve_decision', 'approve_decision']),
  ['h17', 'test', 'resignation', 'approve_decision'], // critical: sorted first among the hits
  ['dh1', 'dev', 'approve_decision', 'approve_decision'], // dev hit: not reviewed
  ['r1', 'dev', 'resignation', 'none'],
  ['r2', 'test', 'resignation', 'resignation'],
  ...Array.from({ length: 6 }, (_, i) => [`c${n2(i + 1)}`, 'dev', 'correction', 'none', { unsure: true }]),
  ...Array.from({ length: 4 }, (_, i) => [`c${n2(i + 7)}`, 'test', 'correction', 'none', { unsure: true }]),
  ['c11', 'test', 'correction', 'none'],
  ['m1', 'dev', 'approve_decision', 'none', { note: 'duyệt thật' }],
  ['m2', 'test', 'praise', 'flow'],
  ['m3', 'test', 'approve_decision', null],
  ['n1', 'test', 'none', 'none'],
];
const PROMPTS = ITEMS.map(([id, split], i) => ({ id, split, sessionId: 's', ts: `t${n2(i)}`, text: `câu tổng hợp ${id}`, context: 'NGU-CANH' }));
const LABELS = ITEMS.map(([id, , gold, , extra]) => ({ id, gold, tags: [], unsure: false, note: '', ...extra }));
const PREDICTIONS = ITEMS.filter(([, , , p]) => p).map(([id, , , p]) => ({ id, label: p, ruleId: `${p}:x` }));
const select = (opts = {}) => selectReview({ prompts: PROMPTS, labels: LABELS, predictions: PREDICTIONS, ...opts });
const idsOf = (items, bucket) => items.filter((i) => i.bucket === bucket).map((i) => i.id);
const HITS = ['h17', ...Array.from({ length: 14 }, (_, i) => `h${n2(i + 1)}`)];

test('default mix: test milestone hits (cap 15), every resignation, 8 unsure corrections, then misses; test first', () => {
  const { items, candidates, omitted } = select();
  assert.equal(items.length, 28);
  assert.deepEqual(idsOf(items, 'hits'), HITS);
  assert.deepEqual(idsOf(items, 'resignation'), ['r2', 'r1']);
  assert.deepEqual(idsOf(items, 'unsureCorrection'), ['c07', 'c08', 'c09', 'c10', 'c01', 'c02', 'c03', 'c04']);
  assert.deepEqual(idsOf(items, 'missed'), ['m2', 'm3', 'm1']);
  assert.deepEqual(items.map((i) => i.n), Array.from({ length: 28 }, (_, i) => i + 1));
  assert.deepEqual(candidates, { hits: 17, resignation: 2, unsureCorrection: 10, missed: 3 });
  assert.deepEqual(omitted, { hits: 2, resignation: 0, unsureCorrection: 2, missed: 0 });
  assert.equal(new Set(items.map((i) => i.id)).size, items.length);
});

test('--max caps the list in bucket order, counts what was left out, and the order is stable under shuffling', () => {
  const capped = select({ max: 20 });
  assert.deepEqual(capped.items.map((i) => i.id), [...HITS, 'r2', 'r1', 'c07', 'c08', 'c09']);
  assert.deepEqual(capped.omitted, { hits: 2, resignation: 0, unsureCorrection: 7, missed: 3 });
  const shuffled = selectReview({ prompts: [...PROMPTS].reverse(), labels: [...LABELS].reverse(), predictions: [...PREDICTIONS].reverse(), max: 20 });
  assert.deepEqual(shuffled.items.map((i) => i.id), capped.items.map((i) => i.id));
  assert.throws(() => select({ max: 0 }), /--max/);
});

test('item text is whitespace-collapsed and trimmed to 200 characters', () => {
  const long = `dòng một\n\ndòng   hai ${'x'.repeat(300)}`;
  const prompts = PROMPTS.map((p) => (p.id === 'h17' ? { ...p, text: long } : p));
  const [first] = selectReview({ prompts, labels: LABELS, predictions: PREDICTIONS }).items;
  assert.equal(first.text.length, 201);
  assert.ok(first.text.startsWith('dòng một dòng hai x'));
  assert.ok(first.text.endsWith('…'));
});

test('review.md has Vietnamese headings, item fields and the reply format', () => {
  const md = formatReview(select(), { generatedAt: '2026-11-21T00:00:00Z' });
  assert.match(md, /^# D0: các câu anh cần xem lại/m);
  assert.match(md, /## Cách trả lời/);
  assert.match(md, /`12 đúng`/);
  assert.match(md, /`12 sai: <nhãn đúng>`/);
  assert.match(md, /## Nhóm 1: máy đoán là mốc hoàn tất/);
  assert.match(md, /## Nhóm 4: nhãn vàng là duyệt\/khen nhưng máy không bắt/);
  assert.match(md, /### 1\. `h17`/);
  assert.match(md, /> câu tổng hợp h17/);
  assert.match(md, /Nhãn vàng: `correction`.*không chắc/);
  assert.match(md, /Máy đoán: `approve_decision` \(`approve_decision:x`\)/);
  assert.match(md, /Ghi chú: duyệt thật/);
  assert.match(md, /Máy đoán: chưa có/);
  assert.match(md, /Trả lời: `1 đúng` hoặc `1 sai: <nhãn đúng>`/);
  assert.doesNotMatch(md, /NGU-CANH/);
  assert.doesNotMatch(md, /câu tổng hợp n1/);
  assert.doesNotMatch(md, /câu tổng hợp dh1/);
});

test('CLI writes review.md outside the repo and prints counts only', () => {
  const files = { prompts: PROMPTS, labels: LABELS, predictions: PREDICTIONS };
  for (const [name, rows] of Object.entries(files)) writeFileSync(join(scratch, `${name}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const args = ['prompts', 'labels', 'predictions'].map((n) => join(scratch, `${n}.jsonl`));
  const out = join(scratch, 'review.md');
  const run = spawnSync(process.execPath, [SCRIPT, ...args, out, '--max', '5'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.doesNotMatch(run.stdout, /câu tổng hợp/);
  assert.deepEqual(JSON.parse(run.stdout), {
    selected: 5,
    candidates: { hits: 17, resignation: 2, unsureCorrection: 10, missed: 3 },
    omitted: { hits: 12, resignation: 2, unsureCorrection: 10, missed: 3 },
  });
  assert.match(readFileSync(out, 'utf8'), /### 5\. `h04`/);
  const refused = spawnSync(process.execPath, [SCRIPT, ...args, join(REPO, 'review.md')], { encoding: 'utf8' });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /inside the repo/);
});
