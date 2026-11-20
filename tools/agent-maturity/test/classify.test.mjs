import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import {
  classifyCheckpointReply,
  classifyPrompt,
  hasCheckpointAsk,
  isWrapperPrompt,
  lengthBucket,
} from '../lib/classify.mjs';

const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/classify-cases.json', import.meta.url), 'utf8'));
const APPROVAL_LABELS = new Set(['approve_decision', 'praise']);
const CRITICAL_GROUPS = new Set(['resignation', 'negation', 'question']);

const RESIGNATIONS = [
  'thôi được rồi', 'thôi được', 'thôi kệ', 'thôi bỏ', 'cũng được', 'tạm được', 'tạm ổn', 'được thôi', 'kệ đi',
  'thoi duoc roi', 'thoi duoc', 'thoi ke', 'thoi bo', 'cung duoc', 'tam duoc', 'tam on', 'duoc thoi', 'ke di',
  'Thôi được rồi', 'CŨNG ĐƯỢC',
];
const SUFFIXES = [
  '', ' nhé', ', để vậy đi', ', merge đi', ' rồi phát hành', '!', '...', ', tuyệt', ' ok', ', đồng ý',
  ' rồi, ổn rồi', ', chốt', ' nha em', '. Merge PR đi', ', duyet theo', ' perfect', ', được rồi',
];
const PREFIXES = ['', 'ừ ', 'ok ', 'vậy ', 'ờ thì '];
const NEGATORS = ['đừng', 'chưa', 'không', 'ko', 'khoan'];
const APPROVAL_TERMS = ['merge', 'phát hành', 'đồng ý', 'duyệt theo', 'chốt', 'sửa ở đây', 'ưng', 'ổn rồi', 'tuyệt'];
const QUESTION_ENDINGS = ['?', ' chưa', ' không', ' ko', ' hả', ' à', ' nhỉ', ' chứ', ' chưa?', ' được không', ' chưa em', ' được không anh', ' rồi à em', ' chưa ạ', ' không nhé'];
const QUESTION_OPENERS = ['sao ', 'tại sao ', 'vì sao ', 'sao lại '];

test('fixture has at least 60 cases and 12 resignation cases', () => {
  assert.ok(FIXTURE.cases.length >= 60, `cases: ${FIXTURE.cases.length}`);
  assert.ok(FIXTURE.cases.filter((c) => c.group === 'resignation').length >= 12);
});

test('every fixture case gets its expected label and rule', () => {
  const failures = [];
  for (const c of FIXTURE.cases) {
    const got = classifyPrompt(c.text);
    if (got.label !== c.label || (c.rule && got.ruleId !== c.rule)) {
      failures.push(`${JSON.stringify(c.text)} -> ${got.label}/${got.ruleId}, want ${c.label}${c.rule ? `/${c.rule}` : ''}`);
    }
  }
  assert.deepEqual(failures, []);
});

test('critical errors on fixtures = 0 (resignation, negation, question never approval)', (t) => {
  const critical = FIXTURE.cases.filter(
    (c) => CRITICAL_GROUPS.has(c.group) && APPROVAL_LABELS.has(classifyPrompt(c.text).label),
  );
  t.diagnostic(`fixture cases=${FIXTURE.cases.length} critical=${critical.length}`);
  assert.equal(critical.length, 0, critical.map((c) => c.text).join(' | '));
});

test('every resignation phrase x prefix x suffix is never approve_decision or praise', (t) => {
  let checked = 0;
  const bad = [];
  for (const phrase of RESIGNATIONS) {
    for (const prefix of PREFIXES) {
      for (const suffix of SUFFIXES) {
        const text = `${prefix}${phrase}${suffix}`;
        checked += 1;
        if (APPROVAL_LABELS.has(classifyPrompt(text).label)) bad.push(text);
      }
    }
  }
  t.diagnostic(`resignation combinations=${checked} critical=${bad.length}`);
  assert.deepEqual(bad, []);
});

test('every negator before an approval or praise term is never approval', () => {
  const bad = [];
  for (const neg of NEGATORS) {
    for (const term of APPROVAL_TERMS) {
      for (const filler of ['', ' vội', ' cần']) {
        const text = `${neg}${filler} ${term}`;
        if (APPROVAL_LABELS.has(classifyPrompt(text).label)) bad.push(text);
      }
    }
  }
  assert.deepEqual(bad, []);
});

test('every approval or praise term asked as a question is never approval', () => {
  const bad = [];
  for (const term of APPROVAL_TERMS) {
    for (const ending of QUESTION_ENDINGS) {
      const text = `${term}${ending}`;
      if (APPROVAL_LABELS.has(classifyPrompt(text).label)) bad.push(text);
    }
    for (const opener of QUESTION_OPENERS) {
      const text = `${opener}${term} rồi`;
      if (APPROVAL_LABELS.has(classifyPrompt(text).label)) bad.push(text);
    }
  }
  assert.deepEqual(bad, []);
});

test('a negation after the approval term ("merge ... không được") is never approval', () => {
  const bad = [];
  for (const term of APPROVAL_TERMS) {
    for (const tail of [' không được', ' vào main không được', ' ko được', ' vẫn chưa được']) {
      const text = `${term}${tail}`;
      if (APPROVAL_LABELS.has(classifyPrompt(text).label)) bad.push(text);
    }
  }
  assert.deepEqual(bad, []);
});

test('a prompt longer than 400 characters is abstain even with approval words', () => {
  const text = `đừng merge khi CI đỏ, rồi phát hành sau. ${'chi tiết quy trình '.repeat(25)}`;
  assert.ok(text.length > 400);
  assert.deepEqual(classifyPrompt(text), { label: 'abstain', ruleId: 'abstain:too-long' });
});

test('ambiguous unaccented "dung" is never a positive or correction pattern, and blocks approval', () => {
  assert.equal(classifyPrompt('dung roi').label, 'none');
  assert.equal(classifyPrompt('dung lam vay nua').label, 'none');
  // "dung merge" may be "đừng merge": never approval.
  assert.deepEqual(classifyPrompt('dung merge'), { label: 'abstain', ruleId: 'abstain:ambiguous-negation' });
  assert.equal(classifyPrompt('đúng rồi, merge đi').label, 'approve_decision');
});

test('accented prompts match only accented patterns for positive labels', () => {
  assert.equal(classifyPrompt('duoc roi nhé').label, 'none');
  assert.equal(classifyPrompt('phat hanh nhé').label, 'none');
});

test('result never carries prompt text', () => {
  const result = classifyPrompt('merge đi sk-test-secret 0912345678');
  assert.deepEqual(Object.keys(result).sort(), ['label', 'ruleId']);
  assert.ok(!JSON.stringify(result).includes('sk-test'));
});

test('non-string input is abstain:empty', () => {
  assert.deepEqual(classifyPrompt(undefined), { label: 'abstain', ruleId: 'abstain:empty' });
  assert.deepEqual(classifyPrompt(42), { label: 'abstain', ruleId: 'abstain:empty' });
});

test('isWrapperPrompt is true only for wrapper, slash command and interruption turns', () => {
  assert.equal(isWrapperPrompt(classifyPrompt('<task-notification>done</task-notification>')), true);
  assert.equal(isWrapperPrompt(classifyPrompt('/loop 5m check')), true);
  assert.equal(isWrapperPrompt(classifyPrompt('[Request interrupted by user]')), true);
  assert.equal(isWrapperPrompt(classifyPrompt('')), false);
  assert.equal(isWrapperPrompt(classifyPrompt('merge')), false);
  assert.equal(isWrapperPrompt(classifyPrompt('x\n```\ny\n```')), false);
});

test('lengthBucket groups prompt length without keeping text', () => {
  assert.equal(lengthBucket('a'.repeat(40)), '<=40');
  assert.equal(lengthBucket('a'.repeat(41)), '<=60');
  assert.equal(lengthBucket('a'.repeat(60)), '<=60');
  assert.equal(lengthBucket('a'.repeat(200)), '<=200');
  assert.equal(lengthBucket('a'.repeat(201)), '>200');
  assert.equal(lengthBucket(undefined), '<=40');
});

test('checkpoint reply: option words are accepted at any length', () => {
  assert.equal(classifyCheckpointReply('Nâng cấp'), 'accept');
  assert.equal(classifyCheckpointReply('nâng cấp đi em'), 'accept');
  assert.equal(classifyCheckpointReply('nang cap'), 'accept');
  assert.equal(classifyCheckpointReply('Chỉnh: phạm vi chỉ dự án này thôi, và cách kiểm phải là chạy test thật trên máy'), 'edit');
  assert.equal(classifyCheckpointReply('chinh lai pham vi'), 'edit');
  assert.equal(classifyCheckpointReply('Bỏ qua'), 'skip');
  assert.equal(classifyCheckpointReply('bo qua'), 'skip');
  assert.equal(classifyCheckpointReply('- Bỏ qua.'), 'skip');
});

test('checkpoint reply: short aliases count only when they stand alone and the reply is <=40 chars', () => {
  for (const reply of ['có', 'Có nhé', '1', 'đồng ý', 'có, nâng cấp đi']) assert.equal(classifyCheckpointReply(reply), 'accept', reply);
  for (const reply of ['2', '2.']) assert.equal(classifyCheckpointReply(reply), 'edit', reply);
  for (const reply of ['không', 'ko', 'thôi', 'skip', '3', 'không cần đâu']) assert.equal(classifyCheckpointReply(reply), 'skip', reply);
  for (const reply of ['có lỗi rồi', '1 cái nữa là xong', 'làm tiếp phần B', 'ok', 'có, nhưng trước hết em kiểm lại toàn bộ log build hôm qua đã']) {
    assert.equal(classifyCheckpointReply(reply), 'ignored', reply);
  }
});

test('reassurance ("không sao", "đừng lo", "không vấn đề gì") does not veto an approval', () => {
  for (const text of ['không sao, merge đi', 'đừng lo, phát hành đi', 'không vấn đề gì, merge đi', 'ko sao, đồng ý']) {
    assert.equal(classifyPrompt(text).label, 'approve_decision', text);
  }
});

test('checkpoint reply: a long reply never counts as a bare alias, even when its tail is cut', () => {
  assert.equal(classifyCheckpointReply(`có ${'x'.repeat(300)}`), 'ignored');
  assert.equal(classifyCheckpointReply(`Nâng cấp ${'x'.repeat(300)}`), 'accept');
});

// 200k-character adversarial inputs: long punctuation runs followed by a letter, repeated words, accents.
const ADVERSARIAL = {
  dotsThenLetter: `${'.'.repeat(200_000)}x`,
  bangsThenLetter: `${'!'.repeat(200_000)}a`,
  ellipsisThenLetter: `${'…'.repeat(200_000)}a`,
  optionThenDots: `Nâng cấp${'.'.repeat(200_000)}x`,
  aliasThenDots: `có${'.'.repeat(200_000)}x`,
  spacedDots: `${' .'.repeat(100_000)}x`,
  repeatedWords: 'merge đi '.repeat(22_300),
  accents: 'ệ'.repeat(200_000),
  combining: 'e\u0302\u0323'.repeat(70_000),
};

test('classifyPrompt and classifyCheckpointReply stay fast on 200k-character adversarial input', (t) => {
  const slow = [];
  for (const [name, text] of Object.entries(ADVERSARIAL)) {
    for (const [fn, f] of [['classifyPrompt', classifyPrompt], ['classifyCheckpointReply', classifyCheckpointReply]]) {
      const started = performance.now();
      f(text);
      const ms = performance.now() - started;
      t.diagnostic(`${fn} ${name} ${ms.toFixed(1)} ms`);
      if (ms > 50) slow.push(`${fn} ${name} ${ms.toFixed(0)} ms`);
    }
  }
  assert.deepEqual(slow, []);
});

const ASK_BLOCK = [
  '[Checkpoint nâng cấp] Anh có muốn em nâng cấp cách làm không?',
  '- Đề xuất: Chạy test thật trước khi báo xong.',
  '- Áp dụng cho: builder · sửa lỗi · dự án này',
  '- Cách kiểm: báo cáo có lệnh test và mã thoát',
  '- Bằng chứng: anh bắt chạy lại test → anh duyệt bản có log',
  '- Loại: cổng chất lượng · Tra cứu: R0',
  'Trả lời: Nâng cấp / Chỉnh (gõ chỗ cần đổi) / Bỏ qua',
].join('\n');

test('a checkpoint ask counts only as the skill block: header at a line start and a Trả lời line after it', () => {
  assert.equal(hasCheckpointAsk(`Đã merge.\n\n${ASK_BLOCK}`), true);
  assert.equal(hasCheckpointAsk(`Đã merge.\n\n${ASK_BLOCK.replace(/\n/g, '\r\n')}`), true);
  assert.equal(hasCheckpointAsk(ASK_BLOCK.split('\n').map((l) => `    ${l}`).join('\n')), true);
  // quoted inline, or a header without the answer line, is not an ask
  assert.equal(hasCheckpointAsk('The hook counts every `[Checkpoint nâng cấp]` header, so I will not add one.'), false);
  assert.equal(hasCheckpointAsk('Lần sau em sẽ dùng [Checkpoint nâng cấp] khi có bằng chứng.'), false);
  assert.equal(hasCheckpointAsk('> [Checkpoint nâng cấp] Anh có muốn em nâng cấp cách làm không?\n> Trả lời: Nâng cấp / Chỉnh / Bỏ qua'), false);
  assert.equal(hasCheckpointAsk('[Checkpoint nâng cấp] Anh có muốn em nâng cấp cách làm không?'), false);
  assert.equal(hasCheckpointAsk(undefined), false);
});
