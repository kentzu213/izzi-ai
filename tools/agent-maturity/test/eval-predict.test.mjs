import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { classifyPrompt } from '../lib/classify.mjs';
import { predictRecords } from '../eval/predict.mjs';

const SCRIPT = fileURLToPath(new URL('../eval/predict.mjs', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'am-predict-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

// Synthetic prompts, not from transcripts.
const PROMPTS = [
  { id: 'aa0000000001', split: 'dev', sessionId: 's', ts: 't1', text: 'merge đi', context: 'ngữ cảnh riêng' },
  { id: 'aa0000000002', split: 'test', sessionId: 's', ts: 't2', text: 'thôi được rồi', context: '' },
  { id: 'aa0000000003', split: 'test', sessionId: 's', ts: 't3', text: 'sao lại merge?', context: '' },
];

test('predictRecords runs classifyPrompt and keeps only id, label and ruleId', () => {
  const rows = predictRecords(PROMPTS);
  assert.equal(rows.length, PROMPTS.length);
  rows.forEach((row, i) => {
    assert.deepEqual(Object.keys(row), ['id', 'label', 'ruleId']);
    const want = classifyPrompt(PROMPTS[i].text);
    assert.deepEqual(row, { id: PROMPTS[i].id, label: want.label, ruleId: want.ruleId });
  });
  assert.equal(rows[0].label, 'approve_decision');
  assert.equal(rows[1].label, 'resignation');
  assert.equal(rows[2].label, 'abstain');
});

test('CLI writes predictions with no prompt text and prints label counts only', () => {
  const input = join(scratch, 'prompts.jsonl');
  const output = join(scratch, 'out', 'predictions.jsonl');
  writeFileSync(input, PROMPTS.map((p) => JSON.stringify(p)).join('\n') + '\n');
  const run = spawnSync(process.execPath, [SCRIPT, input, output], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const written = readFileSync(output, 'utf8');
  for (const p of PROMPTS) assert.equal(written.includes(p.text), false);
  assert.doesNotMatch(written, /ngữ cảnh/);
  assert.equal(written.trim().split('\n').length, PROMPTS.length);
  assert.deepEqual(JSON.parse(run.stdout), { predictions: 3, byLabel: { approve_decision: 1, resignation: 1, abstain: 1 } });
});

test('CLI fails with usage when arguments are missing', () => {
  const run = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /usage: predict\.mjs/);
});
