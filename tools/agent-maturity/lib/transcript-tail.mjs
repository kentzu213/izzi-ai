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

// Returns { text, id } for the last assistant turn, or null.
export function lastAssistantTurn(file, maxBytes = DEFAULT_TAIL_BYTES) {
  try {
    if (typeof file !== 'string' || file === '') return null;
    const lines = readTail(file, maxBytes).split('\n');
    const texts = [];
    let id = null;
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const o = lines[i].trim() ? parse(lines[i]) : null;
      if (!o || typeof o !== 'object') continue;
      if (o.type === 'assistant' && !o.isSidechain) {
        if (id === null) id = [o.uuid, o.message && o.message.id].find((v) => typeof v === 'string') ?? `line-${i}`;
        texts.unshift(...textBlocks(o.message));
      } else if (isPromptLine(o) && id !== null) {
        break;
      }
    }
    return id === null ? null : { text: texts.join('\n'), id };
  } catch {
    return null;
  }
}

export function lastAssistantText(file, maxBytes = DEFAULT_TAIL_BYTES) {
  const turn = lastAssistantTurn(file, maxBytes);
  return turn ? turn.text : null;
}
