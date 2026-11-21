import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';

import { answeredTurn, lastAssistantText, lastAssistantTurn } from '../lib/transcript-tail.mjs';

const dir = mkdtempSync(join(tmpdir(), 'am-tail-'));
after(() => rmSync(dir, { recursive: true, force: true }));

const line = (o) => JSON.stringify(o);
const userPrompt = (text, extra = {}) => line({ type: 'user', uuid: `u-${text.length}`, message: { role: 'user', content: text }, ...extra });
const userBlocks = (blocks, extra = {}) => line({ type: 'user', message: { role: 'user', content: blocks }, ...extra });
const assistant = (uuid, blocks, extra = {}) => line({ type: 'assistant', uuid, isSidechain: false, message: { role: 'assistant', content: blocks }, ...extra });
const text = (t) => ({ type: 'text', text: t });

function write(name, lines) {
  const file = join(dir, name);
  writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

const SAMPLE = [
  line({ type: 'custom-title', title: 'x' }),
  userPrompt('first prompt'),
  assistant('a-old', [text('old answer [Checkpoint nâng cấp] from an earlier turn')]),
  userPrompt('second prompt'),
  line({ type: 'attachment', attachment: { type: 'x' } }),
  assistant('a-1', [{ type: 'thinking', thinking: 'hmm' }]),
  assistant('a-2', [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }]),
  userBlocks([{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }]),
  userPrompt('<system-reminder>meta</system-reminder>', { isMeta: true }),
  assistant('side', [text('subagent text')], { isSidechain: true }),
  assistant('a-3', [text('Part one.')]),
  assistant('a-4', [text('Done.\n\n[Checkpoint nâng cấp] Anh có muốn em nâng cấp cách làm không?')]),
  line({ type: 'last-prompt', x: 1 }),
  '{ broken json',
  line({ type: 'system', subtype: 'x' }),
];

test('returns the text blocks of the last assistant turn, in order, with the last line id', () => {
  const file = write('sample.jsonl', SAMPLE);
  const turn = lastAssistantTurn(file);
  assert.equal(turn.text, 'Part one.\nDone.\n\n[Checkpoint nâng cấp] Anh có muốn em nâng cấp cách làm không?');
  assert.equal(turn.id, 'a-4');
  assert.equal(lastAssistantText(file), turn.text);
});

test('a prompt already written after the assistant turn is skipped', () => {
  const file = write('trailing.jsonl', [...SAMPLE, userPrompt('the new prompt'), line({ type: 'queue-operation' })]);
  assert.equal(lastAssistantTurn(file).id, 'a-4');
});

test('does not reach back past the previous owner prompt', () => {
  const file = write('no-text.jsonl', [
    userPrompt('p1'),
    assistant('old', [text('old [Checkpoint nâng cấp]')]),
    userPrompt('p2'),
    assistant('new', [{ type: 'tool_use', id: 't', name: 'Read', input: {} }]),
  ]);
  const turn = lastAssistantTurn(file);
  assert.equal(turn.text, '');
  assert.equal(turn.id, 'new');
});

test('drops the first, cut line when only the tail is read', () => {
  const big = assistant('cut', [text(`${'x'.repeat(500)} [Checkpoint nâng cấp]`)]);
  const file = write('cut.jsonl', [big, userPrompt('p'), assistant('tail', [text('short reply')])]);
  const turn = lastAssistantTurn(file, 200);
  assert.equal(turn.text, 'short reply');
  assert.equal(turn.id, 'tail');
});

test('a tail with no complete assistant line returns null', () => {
  const file = write('only-cut.jsonl', [assistant('cut', [text('y'.repeat(800))])]);
  assert.equal(lastAssistantTurn(file, 300), null);
});

test('string message content is read as text', () => {
  const file = write('string.jsonl', [userPrompt('p'), line({ type: 'assistant', uuid: 's1', message: { role: 'assistant', content: 'plain text' } })]);
  assert.equal(lastAssistantText(file), 'plain text');
});

test('answeredTurn: the one owner prompt at that time (whole file) and the assistant turn right before it', () => {
  // Arrange
  const at = (s) => `2026-11-21T10:00:${String(s).padStart(2, '0')}.000Z`;
  const ms = (s) => Date.parse(at(s));
  const big = assistant('early', [text('z'.repeat(300_000))]);
  const file = write('answered.jsonl', [
    big,
    userPrompt('merge', { timestamp: at(1) }),
    assistant('ask-1', [text('Part one.')], { timestamp: at(2) }),
    line({ type: 'attachment', timestamp: at(3) }),
    assistant('ask-2', [text('[Checkpoint nâng cấp] ...')], { timestamp: at(4) }),
    userPrompt('Nâng cấp', { timestamp: at(20) }),
    userPrompt('<system-reminder>meta</system-reminder>', { isMeta: true, timestamp: at(20) }),
    assistant('after', [text('Đã lưu.')], { timestamp: at(21) }),
    userPrompt('one', { timestamp: at(40) }),
    userPrompt('two', { timestamp: at(42) }),
    userPrompt('lone', { timestamp: at(55) }),
  ]);

  // Act + Assert: found 1.5 s off, through the meta line, past the 256 KB tail window
  assert.deepEqual(answeredTurn(file, ms(20) + 1500, 5000), { prompt: 'Nâng cấp', turn: { text: 'Part one.\n[Checkpoint nâng cấp] ...', id: 'ask-2' } });
  assert.equal(answeredTurn(file, ms(20) + 5001, 5000), null, 'outside the window');
  assert.equal(answeredTurn(file, ms(41), 5000), null, 'two prompts in the window');
  assert.equal(answeredTurn(file, ms(42) + 4000, 1000), null, 'a prompt right after another prompt has no turn before it');
  assert.equal(answeredTurn(join(dir, 'missing.jsonl'), ms(20), 5000), null);
  assert.equal(answeredTurn(dir, ms(20), 5000), null);
});

test('missing file, directory or empty file returns null', () => {
  assert.equal(lastAssistantTurn(join(dir, 'missing.jsonl')), null);
  assert.equal(lastAssistantText(join(dir, 'missing.jsonl')), null);
  assert.equal(lastAssistantTurn(dir), null);
  assert.equal(lastAssistantTurn(write('empty.jsonl', [])), null);
  assert.equal(lastAssistantTurn(undefined), null);
});
