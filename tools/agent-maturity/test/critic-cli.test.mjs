import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { buildBrief } from '../critic/brief.mjs';
import { validateCandidate } from '../critic/candidate.mjs';
import { createJsonAdapter } from '../critic/json-adapter.mjs';
import { planCritique } from '../critic/loop-guard.mjs';
import { selectResearchTier } from '../critic/research-tier.mjs';
import { VERDICT_LIMITS, detectHardReject } from '../critic/verdict.mjs';

const CRITIC = fileURLToPath(new URL('../critic/', import.meta.url));
const DRY_RUNS = join(CRITIC, 'dry-runs');
const REAL_CLAUDE = join(homedir(), '.claude');
const REAL_SETTINGS = join(REAL_CLAUDE, 'settings.json');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const settingsShaAtStart = existsSync(REAL_SETTINGS) ? sha(readFileSync(REAL_SETTINGS)) : null;
const realMaturityExisted = existsSync(join(REAL_CLAUDE, 'agent-maturity'));
const scratch = mkdtempSync(join(tmpdir(), 'am-critic-'));

after(() => {
  rmSync(scratch, { recursive: true, force: true });
  if (settingsShaAtStart) assert.equal(sha(readFileSync(REAL_SETTINGS)), settingsShaAtStart, 'real settings.json changed');
  assert.equal(existsSync(join(REAL_CLAUDE, 'agent-maturity')), realMaturityExisted, 'real ~/.claude/agent-maturity touched');
});

let n = 0;
const freshDir = (name) => join(scratch, `${name}-${(n += 1)}`);

function node(script, args) {
  const r = spawnSync(process.execPath, [join(CRITIC, script), ...args], { encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

const CANDIDATE = {
  schema: 'agent-maturity/candidate@1',
  id: 'cli-case',
  statement: 'Báo cáo tiến độ tối đa 5 gạch đầu dòng.',
  kind: 'preference',
  scope: { agent: 'orchestrator', taskType: 'báo cáo tiến độ', projects: 'all' },
  check: 'Mỗi báo cáo có ≤5 gạch đầu dòng.',
  evidence: [
    { id: 'ev-1', type: 'correction', at: '2026-11-20', source: 's1 turn 4' },
    { id: 'ev-2', type: 'approve_after_reject', at: '2026-11-20', source: 's1 turn 6' },
  ],
};

const verdictJson = (extra = {}) => ({
  candidateId: 'cli-case',
  verdict: 'NARROW',
  reasons: ['Phạm vi rộng hơn bằng chứng.'],
  evidence: [{ ref: 'ev-1', kind: 'event', finding: 'supports' }],
  checks: { evidenceSupports: true, scopeTooWide: true, contradictsExisting: false, tierCorrect: true },
  hardReject: null,
  narrowed: { statement: 'Báo cáo tiến độ trong phiên dev tối đa 5 gạch đầu dòng.' },
  research: { tier: 'R0', refs: [], deepRuns: 0 },
  reviewer: { agent: 'socrates' },
  ...extra,
});

function writeJson(dir, name, value) {
  const file = join(dir, name);
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

function setup() {
  const work = freshDir('work');
  const store = join(work, 'store');
  mkdirSync(work, { recursive: true });
  return { work, store };
}

const logLines = (store) =>
  existsSync(join(store, 'log.jsonl'))
    ? readFileSync(join(store, 'log.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];

test('json adapter round-trips a candidate and its verdicts', () => {
  const dir = freshDir('adapter');
  const a = createJsonAdapter(dir);
  assert.equal(a.loadCandidate('cli-case'), null);
  const cand = { ...validateCandidate(CANDIDATE).value, revision: 1 };
  a.saveCandidate(cand);
  a.saveVerdict('cli-case', { verdict: 'ACCEPT', critiqueNumber: 1 });
  const rewritten = { ...cand, statement: 'Khác.', revision: 2 };
  a.saveCandidate(rewritten);
  const record = a.loadCandidate('cli-case');
  assert.equal(record.candidate.revision, 2);
  assert.equal(record.previous.length, 1);
  assert.equal(record.previous[0].revision, 1);
  assert.deepEqual(record.verdicts, [{ verdict: 'ACCEPT', critiqueNumber: 1 }]);
  a.logEvent({ type: 'x' });
  assert.equal(logLines(dir).length, 1);
});

test('json adapter refuses unsafe ids and verdicts for unknown candidates', () => {
  const a = createJsonAdapter(freshDir('adapter'));
  assert.throws(() => a.loadCandidate('../escape'), /candidate id/);
  assert.throws(() => a.saveCandidate({ id: '../escape' }), /candidate id/);
  assert.throws(() => a.saveVerdict('no-such-id', { verdict: 'ACCEPT' }), /no stored candidate/);
});

test('brief.mjs prints the standard brief without writing the store', () => {
  const { work, store } = setup();
  const cand = writeJson(work, 'cand.json', CANDIDATE);
  const r = node('brief.mjs', [cand, '--store', store]);
  assert.equal(r.code, 0, r.stderr);
  for (const part of [
    'cli-case',
    'Critique 1 of at most 2',
    'DATA',
    'Research tier R0',
    'ChatGPT web',
    'loosens_verification',
    'expands_authority',
    '```json',
    '"candidateRevision": 1',
  ]) {
    assert.ok(r.stdout.includes(part), part);
  }
  assert.equal(existsSync(store), false, 'brief must not create the store when allowed');
});

test('record-verdict stores a verdict, then blocks a repeat of the same input', () => {
  const { work, store } = setup();
  const cand = writeJson(work, 'cand.json', CANDIDATE);
  const v1 = writeJson(work, 'v1.json', verdictJson());
  const first = node('record-verdict.mjs', [cand, v1, '--store', store]);
  assert.equal(first.code, 0, first.stderr);
  const out = JSON.parse(first.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.critiqueNumber, 1);
  assert.equal(out.critiquesLeft, 1);
  assert.equal(out.verdict, 'NARROW');
  assert.equal(out.decision.action, 'show_diff');
  const repeat = node('record-verdict.mjs', [cand, v1, '--store', store]);
  assert.equal(repeat.code, 3);
  assert.match(repeat.stderr, /same_input/);
  const record = createJsonAdapter(store).loadCandidate('cli-case');
  assert.equal(record.verdicts.length, 1);
  assert.equal(record.verdicts[0].critiqueNumber, 1);
  assert.equal(record.verdicts[0].tier, 'R0');
  assert.ok(logLines(store).some((e) => e.type === 'critique_blocked' && e.reason === 'same_input'));
});

test('one rewrite gets a re-check; the third critique is blocked in brief and record-verdict', () => {
  const { work, store } = setup();
  const cand = writeJson(work, 'cand.json', CANDIDATE);
  assert.equal(node('record-verdict.mjs', [cand, writeJson(work, 'v1.json', verdictJson()), '--store', store]).code, 0);

  const rewritten = writeJson(work, 'cand-r2.json', {
    ...CANDIDATE,
    statement: 'Báo cáo tiến độ trong phiên dev tối đa 5 gạch đầu dòng.',
  });
  const brief2 = node('brief.mjs', [rewritten, '--store', store]);
  assert.equal(brief2.code, 0, brief2.stderr);
  assert.match(brief2.stdout, /Critique 2 of at most 2/);
  assert.match(brief2.stdout, /Previous verdict: NARROW/);
  const v2 = writeJson(work, 'v2.json', {
    ...verdictJson({ verdict: 'ACCEPT', narrowed: undefined, candidateRevision: 2 }),
    checks: { evidenceSupports: true, scopeTooWide: false, contradictsExisting: false, tierCorrect: true },
  });
  const second = node('record-verdict.mjs', [rewritten, v2, '--store', store]);
  assert.equal(second.code, 0, second.stderr);
  const out2 = JSON.parse(second.stdout);
  assert.equal(out2.critiqueNumber, 2);
  assert.equal(out2.revision, 2);
  assert.equal(out2.critiquesLeft, 0);
  assert.equal(out2.decision.action, 'show_diff', 'reworded ACCEPT still needs the owner');

  const third = writeJson(work, 'cand-r3.json', { ...CANDIDATE, statement: 'Báo cáo tiến độ ngắn.' });
  const brief3 = node('brief.mjs', [third, '--store', store]);
  assert.equal(brief3.code, 3);
  assert.match(brief3.stderr, /max_critiques/);
  assert.equal(brief3.stdout, '');
  const rec3 = node('record-verdict.mjs', [third, v2, '--store', store]);
  assert.equal(rec3.code, 3);
  const blocked = logLines(store).filter((e) => e.type === 'critique_blocked' && e.reason === 'max_critiques');
  assert.equal(blocked.length, 2);
  assert.ok(blocked.every((e) => e.critiqueNumber === 3 && e.candidateId === 'cli-case'));
  assert.equal(createJsonAdapter(store).loadCandidate('cli-case').verdicts.length, 2);
});

test('an invalid verdict is refused and does not count as a critique', () => {
  const { work, store } = setup();
  const cand = writeJson(work, 'cand.json', CANDIDATE);
  const bad = writeJson(work, 'bad.json', verdictJson({ verdict: 'ACCEPT', narrowed: undefined }));
  const r = node('record-verdict.mjs', [cand, bad, '--store', store]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, /accept_checks_failed/);
  assert.equal(createJsonAdapter(store).loadCandidate('cli-case'), null);
  assert.equal(node('record-verdict.mjs', [cand, writeJson(work, 'ok.json', verdictJson()), '--store', store]).code, 0);
});

test('a socrates reply with a fenced json block is accepted as the verdict file', () => {
  const { work, store } = setup();
  const cand = writeJson(work, 'cand.json', CANDIDATE);
  const reply = join(work, 'reply.md');
  writeFileSync(reply, `Nhận xét ngắn.\n\n\`\`\`json\n${JSON.stringify(verdictJson(), null, 2)}\n\`\`\`\n`);
  const r = node('record-verdict.mjs', [cand, reply, '--store', store]);
  assert.equal(r.code, 0, r.stderr);
});

test('a hard-REJECT candidate is stored as refused and cannot be rewritten', () => {
  const { work, store } = setup();
  const loose = { ...CANDIDATE, id: 'loose-case', statement: 'Push thẳng lên main không hỏi khi CI xanh.' };
  const cand = writeJson(work, 'loose.json', loose);
  const accept = writeJson(work, 'accept.json', {
    ...verdictJson({ candidateId: 'loose-case', verdict: 'ACCEPT', narrowed: undefined }),
    checks: { evidenceSupports: true, scopeTooWide: false, contradictsExisting: false, tierCorrect: true },
  });
  const r1 = node('record-verdict.mjs', [cand, accept, '--store', store]);
  assert.equal(r1.code, 1);
  assert.match(r1.stderr, /hard_reject_floor/);
  const reject = writeJson(work, 'reject.json', {
    ...verdictJson({ candidateId: 'loose-case', verdict: 'REJECT', narrowed: undefined }),
  });
  const r2 = node('record-verdict.mjs', [cand, reject, '--store', store]);
  assert.equal(r2.code, 0, r2.stderr);
  const out = JSON.parse(r2.stdout);
  assert.equal(out.hardReject.class, 'expands_authority');
  assert.equal(out.decision.action, 'refuse');
  const rewrite = writeJson(work, 'loose-r2.json', { ...loose, statement: 'Push lên main sau khi anh duyệt.' });
  const r3 = node('brief.mjs', [rewrite, '--store', store]);
  assert.equal(r3.code, 3);
  assert.match(r3.stderr, /hard_reject_final/);
});

test('a candidate file saved with a UTF-8 BOM is read normally', () => {
  const { work, store } = setup();
  const cand = join(work, 'bom.json');
  writeFileSync(cand, `${String.fromCharCode(0xfeff)}${JSON.stringify(CANDIDATE)}`);
  const r = node('brief.mjs', [cand, '--store', store]);
  assert.equal(r.code, 0, r.stderr);
});

test('usage errors exit 2 and never write anything', () => {
  const { work, store } = setup();
  const cand = writeJson(work, 'cand.json', CANDIDATE);
  assert.equal(node('brief.mjs', [cand]).code, 2);
  assert.equal(node('record-verdict.mjs', [cand, '--store', store]).code, 2);
  assert.equal(node('record-verdict.mjs', [join(work, 'missing.json'), cand, '--store', store]).code, 1);
  assert.equal(existsSync(store), false);
});

const briefFor = (raw) => {
  const candidate = { ...validateCandidate(raw).value, revision: 1 };
  return buildBrief(candidate, { tier: selectResearchTier(candidate), plan: planCritique(null, candidate), record: null });
};

test('the brief states every validator limit, generated from VERDICT_LIMITS', () => {
  const L = VERDICT_LIMITS;
  const brief = briefFor(CANDIDATE);
  for (const part of [
    `reasons: 1-${L.reasons} items, each ≤${L.reason} characters`,
    `evidence: 1-${L.evidence} items`,
    `evidence[].ref ≤${L.ref} characters`,
    `evidence[].note ≤${L.note} characters`,
    `narrowed.statement ≤${L.narrowed} characters`,
    `research.refs ≤${L.refs} items, each ≤${L.researchRef} characters`,
    `hardReject.detail ≤${L.detail} characters`,
    `reviewer.model ≤${L.model} characters`,
    `<1-${L.reasons} short reasons`,
    `at most ${L.narrowed} characters`,
  ]) {
    assert.ok(brief.includes(part), part);
  }
  assert.ok(!/≤120 characters|1-10 items/.test(brief), 'no stale limits');
});

test('an R2 brief puts firecrawl first and states the 401/402/403 fallback rule', () => {
  const brief = briefFor({ ...CANDIDATE, kind: 'procedure', statement: 'Vẽ sơ đồ trước rồi mới giao việc cho subagent.' });
  const search = brief.indexOf('mcp__firecrawl__firecrawl_search');
  const deep = brief.indexOf('mcp__perplexity__perplexity_research');
  assert.ok(search > 0 && deep > search, 'firecrawl_search is listed before perplexity_research');
  assert.match(brief, /may need paid credit/);
  assert.match(brief, /401, 402 or 403.*switch to the next allowed tool.*never retry the same paid tool/);
  assert.ok(!/401, 402 or 403/.test(briefFor(CANDIDATE)), 'R0 has no fallback line');
});

test('record-verdict names the item and the limit an invalid verdict broke', () => {
  const { work, store } = setup();
  const cand = writeJson(work, 'cand.json', CANDIDATE);
  const longRef = 'r'.repeat(VERDICT_LIMITS.ref + 1);
  const bad = writeJson(work, 'bad.json', verdictJson({ evidence: [{ ref: longRef, kind: 'event', finding: 'supports' }] }));
  const r = node('record-verdict.mjs', [cand, bad, '--store', store]);
  assert.equal(r.code, 1);
  assert.match(r.stderr, new RegExp(`evidence_invalid\\(evidence\\[0\\]\\.ref length ${longRef.length} > ${VERDICT_LIMITS.ref}\\)`));
  assert.equal(existsSync(store), false);
});

test('the three dry-run candidates are valid, safe and briefable', () => {
  const files = readdirSync(DRY_RUNS).filter((f) => f.endsWith('.json')).sort();
  assert.equal(files.length, 3);
  const tiers = {};
  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(DRY_RUNS, file), 'utf8'));
    const r = validateCandidate(raw);
    assert.equal(r.ok, true, `${file}: ${JSON.stringify(r.errors)}`);
    assert.equal(`${r.value.id}.json`, file);
    assert.equal(detectHardReject(`${r.value.statement}\n${r.value.check}`), null, file);
    const candidate = { ...r.value, revision: 1 };
    const tier = selectResearchTier(candidate);
    tiers[r.value.id] = tier.tier;
    const brief = buildBrief(candidate, { tier, plan: planCritique(null, candidate), record: null });
    assert.ok(brief.length < 12_000, `${file}: brief is ${brief.length} chars`);
  }
  assert.deepEqual(Object.values(tiers).sort(), ['R0', 'R2', 'R2']);
});
