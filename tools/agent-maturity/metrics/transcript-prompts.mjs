// Reads the owner's prompts from a Claude Code transcript (JSONL) in place. The text stays in memory for the
// caller and is never written anywhere. A transcript that cannot be read, or is too large, gives [] and a warning
// that names the file only.

import fs from 'node:fs';
import path from 'node:path';

import { classifyCheckpointReply, hasCheckpointAsk } from '../lib/classify.mjs';

// Same rule as D0 eval/extract-prompts.mjs: longer prompts are pasted material, not typed.
export const MAX_PROMPT_CHARS = 4000;
// Larger files are skipped with a warning instead of being read into memory (the largest seen is under 100 MB).
export const MAX_TRANSCRIPT_BYTES = 256 * 1024 * 1024;

const stderrWarn = (message) => process.stderr.write(`${message}\n`);

// A prompt typed or sent into the session: not a tool result, not injected meta text, not a subagent line.
function promptText(o) {
  if (!o || typeof o !== 'object' || o.type !== 'user' || o.isMeta || o.isSidechain) return null;
  const content = o.message && o.message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content) || content.some((b) => b && b.type === 'tool_result')) return null;
  const texts = content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text);
  return texts.length > 0 ? texts.join('\n') : null;
}

function assistantTexts(o) {
  const content = o.message && o.message.content;
  if (typeof content === 'string') return [content];
  return Array.isArray(content) ? content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text) : [];
}

// D0 extract-prompts.mjs isTyped(): not empty, not a command or hook wrapper, not an interrupt marker, <= 4000 chars.
const isTyped = (t) => t !== '' && !t.startsWith('<') && !t.startsWith('[Request interrupted') && t.length <= MAX_PROMPT_CHARS;

const strOrNull = (v) => (typeof v === 'string' ? v : null);

function readText(file, warn, maxBytes) {
  const name = path.basename(String(file));
  try {
    const size = fs.statSync(file).size;
    if (size > maxBytes) {
      warn(`transcript skipped: ${name} is too large (${size} bytes, limit ${maxBytes})`);
      return null;
    }
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    warn(`transcript skipped: ${name} cannot be read (${(error && error.code) || 'error'})`);
    return null;
  }
}

// Returns [{ uuid, at, cwd, text, checkpointAnswer }] in file order. checkpointAnswer: the assistant turn before it
// asked an upgrade checkpoint and the prompt picks Nâng cấp / Chỉnh / Bỏ qua, as the D1 hook decides.
export async function readOwnerPrompts(file, { warn = stderrWarn, maxBytes = MAX_TRANSCRIPT_BYTES } = {}) {
  const text = readText(file, warn, maxBytes);
  if (text === null) return [];
  const prompts = [];
  let turn = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let o = null;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o && o.type === 'assistant' && !o.isSidechain) {
      turn.push(...assistantTexts(o));
      continue;
    }
    const body = promptText(o);
    if (body === null) continue;
    const asked = hasCheckpointAsk(turn.join('\n'));
    turn = [];
    if (!isTyped(body.trim())) continue;
    prompts.push({
      uuid: strOrNull(o.uuid),
      at: strOrNull(o.timestamp),
      cwd: strOrNull(o.cwd),
      text: body,
      checkpointAnswer: asked && classifyCheckpointReply(body) !== 'ignored',
    });
  }
  return prompts;
}
