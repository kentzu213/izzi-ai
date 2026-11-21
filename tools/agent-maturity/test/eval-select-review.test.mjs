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

// Synthetic items: [id, gold, predicted label or null, extra label fields]
const ITEMS = [
  ['n1', 'none', 'none'],
  ['u1', 'none', 'none', { unsure: true }],
  ['g2', 'resignation', 'resignation'],
  ['c2', 'none', 'praise', { tags: ['negation'] }],
  ['b2', 'confirm', 'praise'],
  ['x1', 'approve_decision', null],
  ['g1', 'praise', 'praise', { note: 'khen thật' }],
  ['c1', 'resignation', 'approve_decision', { unsure: true }],
  ['m1', 'flow', null],
  ['b1', 'approve_decision', 'none'],
];
const PROMPTS = ITEMS.map(([id], i) => ({ id, split: i % 2 ? 'dev' : 'test', sessionId: 's', ts: `t${i}`, text: `câu tổng hợp ${id}`, context: 'NGU-CANH' }));
const LABELS = ITEMS.map(([id, gold, , extra]) => ({ id, gold, tags: [], unsure: false, note: '', ...extra }));
const PREDICTIONS = ITEMS.filter(([, , p]) => p).map(([id, , p]) => ({ id, label: p, ruleId: `${p}:x` }));
const select = (opts = {}) => selectReview({ prompts: PROMPTS, labels: LABELS, predictions: PREDICTIONS, ...opts });

test('priority: critical, milestone disagreement, gold approve/praise/resignation, unsure; each item once', () => {
  const { items, candidates } = select();
  assert.deepEqual(items.map((i) => [i.n, i.id, i.priority]), [
    [1, 'c1', 'A'], [2, 'c2', 'A'], [3, 'b1', 'B'], [4, 'b2', 'B'], [5, 'g1', 'C'], [6, 'g2', 'C'], [7, 'x1', 'C'], [8, 'u1', 'D'],
  ]);
  assert.deepEqual(candidates, { A: 2, B: 2, C: 3, D: 1 });
});

test('--max caps the list, counts what was left out, and the order is stable under shuffling', () => {
  const capped = select({ max: 3 });
  assert.deepEqual(capped.items.map((i) => i.id), ['c1', 'c2', 'b1']);
  assert.deepEqual(capped.omitted, { A: 0, B: 1, C: 3, D: 1 });
  const shuffled = selectReview({ prompts: [...PROMPTS].reverse(), labels: [...LABELS].reverse(), predictions: [...PREDICTIONS].reverse(), max: 3 });
  assert.deepEqual(shuffled.items.map((i) => i.id), ['c1', 'c2', 'b1']);
  assert.throws(() => select({ max: 0 }), /--max/);
});

test('item text is whitespace-collapsed and trimmed to 200 characters', () => {
  const long = `dòng một\n\ndòng   hai ${'x'.repeat(300)}`;
  const prompts = PROMPTS.map((p) => (p.id === 'c1' ? { ...p, text: long } : p));
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
  assert.match(md, /## Nhóm A: lỗi nghiêm trọng/);
  assert.match(md, /### 1\. `c1`/);
  assert.match(md, /> câu tổng hợp c1/);
  assert.match(md, /Nhãn vàng: `resignation`.*không chắc/);
  assert.match(md, /Máy đoán: `approve_decision` \(`approve_decision:x`\)/);
  assert.match(md, /Ghi chú: khen thật/);
  assert.match(md, /Máy đoán: chưa có/);
  assert.match(md, /Trả lời: `1 đúng` hoặc `1 sai: <nhãn đúng>`/);
  assert.doesNotMatch(md, /NGU-CANH/);
  assert.doesNotMatch(md, /câu tổng hợp n1/);
});

test('CLI writes review.md outside the repo and prints counts only', () => {
  const files = { prompts: PROMPTS, labels: LABELS, predictions: PREDICTIONS };
  for (const [name, rows] of Object.entries(files)) writeFileSync(join(scratch, `${name}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const args = ['prompts', 'labels', 'predictions'].map((n) => join(scratch, `${n}.jsonl`));
  const out = join(scratch, 'review.md');
  const run = spawnSync(process.execPath, [SCRIPT, ...args, out, '--max', '5'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.doesNotMatch(run.stdout, /câu tổng hợp/);
  assert.deepEqual(JSON.parse(run.stdout), { selected: 5, candidates: { A: 2, B: 2, C: 3, D: 1 }, omitted: { A: 0, B: 0, C: 2, D: 1 } });
  assert.match(readFileSync(out, 'utf8'), /### 5\. `g1`/);
  const refused = spawnSync(process.execPath, [SCRIPT, ...args, join(REPO, 'review.md')], { encoding: 'utf8' });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /inside the repo/);
});
