import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { classifyPrompt } from '../lib/classify.mjs';

const HOLDOUT = JSON.parse(readFileSync(new URL('./fixtures/classify-holdout.json', import.meta.url), 'utf8'));
const APPROVAL_LABELS = new Set(['approve_decision', 'praise']);

test('held-out probes: negation, cancel, bare question, resignation and contrast are never approval', (t) => {
  const critical = [];
  const offLabel = [];
  for (const c of HOLDOUT.mustNot) {
    const got = classifyPrompt(c.text);
    if (APPROVAL_LABELS.has(got.label)) critical.push(`${c.text} -> ${got.ruleId}`);
    else if (!c.allowed.includes(got.label)) offLabel.push(`${c.text} -> ${got.ruleId}, want one of ${c.allowed.join('/')}`);
  }
  t.diagnostic(`held-out mustNot=${HOLDOUT.mustNot.length} critical=${critical.length}`);
  assert.deepEqual(critical, []);
  assert.deepEqual(offLabel, []);
});

test('held-out true positives keep their label', (t) => {
  const failures = HOLDOUT.keep
    .map((c) => ({ c, got: classifyPrompt(c.text) }))
    .filter(({ c, got }) => got.label !== c.label)
    .map(({ c, got }) => `${c.text} -> ${got.ruleId}, want ${c.label}`);
  t.diagnostic(`held-out keep=${HOLDOUT.keep.length} missed=${failures.length}`);
  assert.deepEqual(failures, []);
});
