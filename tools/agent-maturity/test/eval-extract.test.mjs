import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { extractPrompts, maskSecrets, splitOf } from '../eval/extract-prompts.mjs';

// Synthetic transcripts only: no line here comes from a real session.
const SCRIPT = fileURLToPath(new URL('../eval/extract-prompts.mjs', import.meta.url));
const REPO = fileURLToPath(new URL('../../..', import.meta.url));
const scratch = mkdtempSync(join(tmpdir(), 'am-extract-'));
after(() => rmSync(scratch, { recursive: true, force: true }));

const sha12 = (s) => createHash('sha256').update(s).digest('hex').slice(0, 12);
const user = (o) => JSON.stringify({ type: 'user', ...o });
const assistant = (content, extra = {}) => JSON.stringify({ type: 'assistant', message: { content }, ...extra });

let rootCount = 0;
function makeRoot(projects) {
  rootCount += 1;
  const root = join(scratch, `projects-${rootCount}`);
  for (const [project, files] of Object.entries(projects)) {
    mkdirSync(join(root, project), { recursive: true });
    for (const [name, lines] of Object.entries(files)) writeFileSync(join(root, project, name), lines.join('\n'));
  }
  return root;
}

test('splitOf puts an even first byte in dev and an odd one in test', () => {
  assert.equal(splitOf('00aaaaaaaaaa'), 'dev');
  assert.equal(splitOf('01aaaaaaaaaa'), 'test');
  assert.equal(splitOf('feaaaaaaaaaa'), 'dev');
  assert.equal(splitOf('ffaaaaaaaaaa'), 'test');
});

test('keeps typed prompts with the D0 id, split, context and length', () => {
  const root = makeRoot({
    'proj-a': {
      's1.jsonl': [
        user({ sessionId: 's1', uuid: 'u1', timestamp: '2026-01-01T00:00:01Z', message: { content: '  sửa lại nút lưu  ' } }),
        assistant([{ type: 'text', text: 'Đã sửa.' }, { type: 'tool_use', name: 'x' }]),
        user({ sessionId: 's1', uuid: 'u2', timestamp: '2026-01-01T00:00:02Z', message: { content: [{ type: 'text', text: 'merge đi' }, { type: 'image' }] } }),
      ],
    },
  });
  const records = extractPrompts(root);
  assert.equal(records.length, 2);
  const [first, second] = records;
  assert.equal(first.id, sha12('s1:u1'));
  assert.equal(first.split, splitOf(first.id));
  assert.deepEqual(
    { sessionId: first.sessionId, project: first.project, ts: first.ts, len: first.len, text: first.text, context: first.context },
    { sessionId: 's1', project: 'proj-a', ts: '2026-01-01T00:00:01Z', len: 'sửa lại nút lưu'.length, text: 'sửa lại nút lưu', context: '' },
  );
  assert.equal(second.text, 'merge đi');
  assert.equal(second.context, 'Đã sửa.');
});

test('drops sidechain, meta, wrapper, interrupted, empty and over-long prompts', () => {
  const root = makeRoot({
    p: {
      's.jsonl': [
        user({ sessionId: 's', uuid: 'a', isSidechain: true, message: { content: 'từ subagent' } }),
        user({ sessionId: 's', uuid: 'b', isMeta: true, message: { content: 'meta' } }),
        user({ sessionId: 's', uuid: 'c', message: { content: '<command-name>/x</command-name>' } }),
        user({ sessionId: 's', uuid: 'd', message: { content: '[Request interrupted by user]' } }),
        user({ sessionId: 's', uuid: 'e', message: { content: '   ' } }),
        user({ sessionId: 's', uuid: 'f', message: { content: 'x'.repeat(4001) } }),
        user({ sessionId: 's', uuid: 'g', message: { content: [{ type: 'tool_result', content: 'kết quả' }] } }),
        user({ sessionId: 's', uuid: 'h', message: { content: 'y'.repeat(4000) } }),
        'not json',
      ],
    },
  });
  const records = extractPrompts(root);
  assert.deepEqual(records.map((r) => r.id), [sha12('s:h')]);
});

test('dedupes by uuid and by timestamp plus text, first seen wins', () => {
  const root = makeRoot({
    p: {
      'a.jsonl': [
        user({ sessionId: 'sa', uuid: 'u1', timestamp: 't1', message: { content: 'tiếp đi' } }),
        user({ sessionId: 'sa', uuid: 'u1', timestamp: 't9', message: { content: 'bản sao cùng uuid' } }),
      ],
      'b.jsonl': [user({ sessionId: 'sb', uuid: 'u7', timestamp: 't1', message: { content: 'tiếp đi' } })],
    },
  });
  const records = extractPrompts(root);
  assert.deepEqual(records.map((r) => r.id), [sha12('sa:u1')]);
});

test('without uuid the id uses timestamp|text and the session falls back to the file name', () => {
  const root = makeRoot({ p: { 'file-session.jsonl': [user({ timestamp: 't5', message: { content: 'ok' } })] } });
  const [record] = extractPrompts(root);
  assert.equal(record.sessionId, 'file-session');
  assert.equal(record.id, sha12('file-session:t5|ok'));
  assert.equal(record.ts, 't5');
});

test('context keeps the last 300 characters of the latest non-empty assistant text', () => {
  const long = `${'a'.repeat(50)}${'b'.repeat(300)}`;
  const root = makeRoot({
    p: {
      's.jsonl': [
        assistant(long),
        assistant([{ type: 'tool_use', name: 'Bash' }]),
        user({ sessionId: 's', uuid: 'u', timestamp: 't', message: { content: 'được rồi' } }),
      ],
    },
  });
  assert.equal(extractPrompts(root)[0].context, 'b'.repeat(300));
});

test('records are ordered by session, then timestamp; root files and non-jsonl files are ignored', () => {
  const root = makeRoot({
    p1: { 'z.jsonl': [user({ sessionId: 'zz', uuid: '1', timestamp: 't2', message: { content: 'hai' } })], 'notes.txt': ['x'] },
    p2: {
      'a.jsonl': [
        user({ sessionId: 'aa', uuid: '2', timestamp: 't3', message: { content: 'ba' } }),
        user({ sessionId: 'aa', uuid: '3', timestamp: 't1', message: { content: 'một' } }),
      ],
    },
  });
  writeFileSync(join(root, 'stray.jsonl'), user({ sessionId: 'q', uuid: 'q', message: { content: 'lạc' } }));
  assert.deepEqual(extractPrompts(root).map((r) => r.text), ['một', 'ba', 'hai']);
});

test('CLI writes prompts.jsonl and prints counts only', () => {
  const root = makeRoot({ p: { 's.jsonl': [user({ sessionId: 's', uuid: 'u', timestamp: 't', message: { content: 'câu bí mật' } })] } });
  const out = join(scratch, 'cli-out');
  const run = spawnSync(process.execPath, [SCRIPT, root, out], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.doesNotMatch(run.stdout, /câu bí mật/);
  assert.deepEqual(JSON.parse(run.stdout), { prompts: 1, sessions: 1, bySplit: { [splitOf(sha12('s:u'))]: 1 } });
  const lines = readFileSync(join(out, 'prompts.jsonl'), 'utf8').trim().split('\n');
  assert.equal(JSON.parse(lines[0]).text, 'câu bí mật');
});

test('CLI refuses an output folder inside the repo', () => {
  const root = makeRoot({ p: { 's.jsonl': [] } });
  const run = spawnSync(process.execPath, [SCRIPT, root, join(REPO, 'tmp-d0-out')], { encoding: 'utf8' });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /inside the repo/);
});

// Fake secrets are built at runtime so no key-shaped literal sits in the repo.
const FAKE_SK = `sk-proj-${'x'.repeat(24)}`;
const FAKE_IZZI = `izzi-${'A1'.repeat(12)}`;
const FAKE_JWT = `eyJ${'a'.repeat(10)}.${'b'.repeat(10)}.${'c'.repeat(10)}`;

test('maskSecrets hides keys, bearer tokens, JWTs and Vietnamese phone numbers', () => {
  assert.equal(maskSecrets(`nhập key ${FAKE_SK} rồi chạy`), 'nhập key [REDACTED_KEY] rồi chạy');
  assert.equal(maskSecrets(`key ${FAKE_IZZI}`), 'key [REDACTED_KEY]');
  assert.equal(maskSecrets('Authorization: Bearer abc.def-ghi_123456'), 'Authorization: Bearer [REDACTED_TOKEN]');
  assert.equal(maskSecrets(`token=${FAKE_JWT}`), 'token=[REDACTED_JWT]');
  for (const phone of ['0912345678', '+84 912 345 678', '84912345678', '090.123.4567', '028 3823 4567']) {
    assert.equal(maskSecrets(`gọi ${phone} nhé`), 'gọi [REDACTED_PHONE] nhé', phone);
  }
});

test('maskSecrets leaves ordinary words, versions, dates and ids alone', () => {
  for (const text of ['izzi-agent-maturity-epic', 'pip install sk-learn', 'v1.14.0-beta.90', 'PR #75 ngày 20261121', 'số 1234567890', 'không có gì']) {
    assert.equal(maskSecrets(text), text);
  }
});

test('extraction masks text and context but keeps the id from the raw text', () => {
  const raw = 'gọi 0912345678 nhé';
  const root = makeRoot({
    p: {
      'file-session.jsonl': [
        assistant('dùng Bearer abcdefgh12345678 để gọi'),
        user({ timestamp: 't5', message: { content: raw } }),
      ],
    },
  });
  const [record] = extractPrompts(root);
  assert.equal(record.id, sha12(`file-session:t5|${raw}`));
  assert.equal(record.text, 'gọi [REDACTED_PHONE] nhé');
  assert.equal(record.len, record.text.length);
  assert.equal(record.context, 'dùng Bearer [REDACTED_TOKEN] để gọi');
});
