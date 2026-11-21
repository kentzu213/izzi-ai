// Reads the end of a Claude Code transcript (JSONL) and returns the last assistant turn.
// Only the last maxBytes are read; a line cut by that window is dropped. Any error returns null.

import fs from 'node:fs';

export const DEFAULT_TAIL_BYTES = 256 * 1024;

function readTail(file, maxBytes) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const length = Math.min(size, maxBytes);
    const position = size - length;
    const buf = Buffer.alloc(length);
    fs.readSync(fd, buf, 0, length, position);
    const text = buf.toString('utf8');
    if (position === 0) return text;
    const cut = text.indexOf('\n');
    return cut < 0 ? '' : text.slice(cut + 1);
  } finally {
    fs.closeSync(fd);
  }
}

function parse(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function textBlocks(message) {
  const content = message && message.content;
  if (typeof content === 'string') return [content];
  if (!Array.isArray(content)) return [];
  return content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text);
}

// A prompt typed or sent into the session (not a tool result, not injected meta text).
function isPromptLine(o) {
  if (o.type !== 'user' || o.isMeta || o.isSidechain) return false;
  const content = o.message && o.message.content;
  if (typeof content === 'string') return true;
  return Array.isArray(content) && content.some((b) => b && b.type === 'text') && !content.some((b) => b && b.type === 'tool_result');
}

const parseLines = (text) => text.split('\n').map((l) => (l.trim() ? parse(l) : null));

// The assistant turn that ends before objs[end]: { text, id } or null. A prompt line ends the turn; one met before any
// assistant line is passed over when skipPrompts, otherwise there is no turn right before objs[end].
function turnBefore(objs, end, skipPrompts) {
  const texts = [];
  let id = null;
  for (let i = end - 1; i >= 0; i -= 1) {
    const o = objs[i];
    if (!o || typeof o !== 'object') continue;
    if (o.type === 'assistant' && !o.isSidechain) {
      if (id === null) id = [o.uuid, o.message && o.message.id].find((v) => typeof v === 'string') ?? `line-${i}`;
      texts.unshift(...textBlocks(o.message));
    } else if (isPromptLine(o) && (id !== null || !skipPrompts)) {
      break;
    }
  }
  return id === null ? null : { text: texts.join('\n'), id };
}

// Returns { text, id } for the last assistant turn, or null.
export function lastAssistantTurn(file, maxBytes = DEFAULT_TAIL_BYTES) {
  try {
    if (typeof file !== 'string' || file === '') return null;
    const objs = parseLines(readTail(file, maxBytes));
    return turnBefore(objs, objs.length, true);
  } catch {
    return null;
  }
}

// For promote-standard, from the whole file: the one owner prompt whose transcript timestamp is within windowMs of
// atMs and the assistant turn right before it (no other prompt between): { prompt, turn: { text, id } }. null when
// not exactly one prompt matches, no turn comes right before it, or the file cannot be read.
export function answeredTurn(file, atMs, windowMs) {
  try {
    const objs = parseLines(fs.readFileSync(file, 'utf8'));
    const hits = objs.flatMap((o, i) => (o && isPromptLine(o) && Math.abs(Date.parse(o.timestamp) - atMs) <= windowMs ? [i] : []));
    const turn = hits.length === 1 ? turnBefore(objs, hits[0], false) : null;
    return turn ? { prompt: textBlocks(objs[hits[0]].message).join('\n'), turn } : null;
  } catch {
    return null;
  }
}

export function lastAssistantText(file, maxBytes = DEFAULT_TAIL_BYTES) {
  const turn = lastAssistantTurn(file, maxBytes);
  return turn ? turn.text : null;
}
