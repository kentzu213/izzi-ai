// Reads the owner's prompts from a Claude Code transcript (JSONL) in place. The text stays in memory for the
// caller and is never written anywhere. Any read error returns [].

import fs from 'node:fs';

// A prompt typed or sent into the session: not a tool result, not injected meta text, not a subagent line.
function promptText(o) {
  if (!o || typeof o !== 'object' || o.type !== 'user' || o.isMeta || o.isSidechain) return null;
  const content = o.message && o.message.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content) || content.some((b) => b && b.type === 'tool_result')) return null;
  const texts = content.filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text);
  return texts.length > 0 ? texts.join('\n') : null;
}

const strOrNull = (v) => (typeof v === 'string' ? v : null);

// Returns [{ uuid, at, cwd, text }] in file order.
export async function readOwnerPrompts(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const prompts = [];
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let o = null;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    const body = promptText(o);
    if (body !== null) prompts.push({ uuid: strOrNull(o.uuid), at: strOrNull(o.timestamp), cwd: strOrNull(o.cwd), text: body });
  }
  return prompts;
}
