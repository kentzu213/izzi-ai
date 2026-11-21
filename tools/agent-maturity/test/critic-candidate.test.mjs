import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateCandidate } from '../critic/candidate.mjs';

const GOOD = {
  schema: 'agent-maturity/candidate@1',
  id: 'plain-language-decisions',
  statement: 'Khi xin anh quyết định, nói bằng lời thường.',
  kind: 'procedure',
  scope: { agent: 'orchestrator/root', taskType: 'câu hỏi xin quyết định', projects: 'all' },
  check: 'Mỗi câu hỏi có đủ 4 ý.',
  evidence: [
    { id: 'plan-2.3-v1', type: 'correction', at: '2026-11-20', source: 'docs/izzi-v2/PLAN.md §2.3', note: 'chưa hiểu' },
  ],
  flags: { changesWorkflow: false },
  existingStandards: [{ id: 'skill-plain-codes', statement: 'Explain internal codes in plain words.' }],
  research: { refs: [] },
};

const codes = (r) => r.errors.map((e) => e.code);

test('a complete candidate is valid and normalized without the managed revision', () => {
  const r = validateCandidate({ ...GOOD, revision: 7, unknown: 'x' });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.equal('revision' in r.value, false);
  assert.equal('unknown' in r.value, false);
  assert.equal(r.value.evidence[0].note, 'chưa hiểu');
  assert.deepEqual(r.value.flags, { changesWorkflow: false });
});

test('optional parts default to empty values', () => {
  const { flags, existingStandards, research, ...minimal } = GOOD;
  const r = validateCandidate(minimal);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.value.flags, {});
  assert.deepEqual(r.value.existingStandards, []);
  assert.deepEqual(r.value.research, { refs: [] });
});

test('ids must be safe slugs so they cannot shape a path', () => {
  for (const id of ['../x', 'A-Upper', 'ab', 'has space', `x${'a'.repeat(64)}`]) {
    assert.ok(codes(validateCandidate({ ...GOOD, id })).includes('id_invalid'), id);
  }
});

test('field limits and enums are enforced', () => {
  assert.ok(codes(validateCandidate({ ...GOOD, statement: 'x'.repeat(201) })).includes('statement_invalid'));
  assert.ok(codes(validateCandidate({ ...GOOD, statement: '  ' })).includes('statement_invalid'));
  assert.ok(codes(validateCandidate({ ...GOOD, kind: 'rule' })).includes('kind_invalid'));
  assert.ok(codes(validateCandidate({ ...GOOD, check: '' })).includes('check_invalid'));
  assert.ok(codes(validateCandidate({ ...GOOD, scope: { ...GOOD.scope, projects: 'some' } })).includes('scope_invalid'));
  assert.ok(codes(validateCandidate({ ...GOOD, evidence: [] })).includes('evidence_invalid'));
  assert.ok(
    codes(validateCandidate({ ...GOOD, evidence: [{ ...GOOD.evidence[0], type: 'praise' }] })).includes('evidence_invalid'),
  );
  assert.ok(codes(validateCandidate({ ...GOOD, evidence: [{ ...GOOD.evidence[0], at: 'yesterday' }] })).includes('evidence_invalid'));
  assert.ok(codes(validateCandidate({ ...GOOD, flags: { ownerPrivate: 'yes' } })).includes('flags_invalid'));
  assert.ok(codes(validateCandidate({ ...GOOD, flags: { madeUp: true } })).includes('flags_invalid'));
  assert.ok(codes(validateCandidate({ ...GOOD, schema: 'other@1' })).includes('schema_invalid'));
  assert.ok(codes(validateCandidate('not an object')).includes('not_object'));
});

test('secrets, phone numbers and emails anywhere in the candidate are refused', () => {
  const leak = { ...GOOD, evidence: [{ ...GOOD.evidence[0], note: 'khách 0987654321' }] };
  assert.ok(codes(validateCandidate(leak)).includes('pii_or_secret'));
  assert.ok(codes(validateCandidate({ ...GOOD, check: 'dùng ghp_abcdefghijklmnopqrstuvwxyz0123' })).includes('pii_or_secret'));
  assert.ok(codes(validateCandidate({ ...GOOD, statement: 'Gửi cho x@y.vn' })).includes('pii_or_secret'));
});
