// D0: extract the owner's typed Claude Code prompts (all projects) into a private prompts.jsonl.
// Version-controlled port of root's extract-d0.mjs: same filters, dedupe, ids and splits.
// id = first 12 hex of sha256(sessionId + ':' + (uuid || timestamp|text)); split = dev/test by the id's first byte.
// The output holds real prompt text, so it must be written outside the repo. Obvious keys, tokens and
// Vietnamese phone numbers are masked in text and context (PLAN §3.2); ids and dedupe use the raw text.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { assertOutsideRepo, invokedDirectly, runMain, writeJsonl } from './io.mjs';

const MAX_TEXT = 4000;
const CONTEXT_CHARS = 300;

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

export const splitOf = (id) => (parseInt(id.slice(0, 2), 16) % 2 === 0 ? 'dev' : 'test');

// Order matters: whole tokens first, phone numbers last.
const MASKS = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, 'Bearer [REDACTED_TOKEN]'],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g, '[REDACTED_JWT]'],
  [/(?<![\w-])sk-[A-Za-z0-9_-]{16,}/g, '[REDACTED_KEY]'],
  [/(?<![\w-])izzi-[A-Za-z0-9]{20,}/g, '[REDACTED_KEY]'],
  // 0 / 84 / +84, then a mobile (3,5,7,8,9 + 8 digits) or landline (2 + 9 digits), single . - or space between digits.
  [/(?<![\w+])(?:\+84|84|0)[ .-]?(?:[35789](?:[ .-]?\d){8}|2(?:[ .-]?\d){9})(?!\w)/g, '[REDACTED_PHONE]'],
];

export const maskSecrets = (text) => MASKS.reduce((s, [re, to]) => s.replace(re, to), text);

function userTexts(message) {
  const c = message && message.content;
  if (typeof c === 'string') return [c];
  if (Array.isArray(c)) return c.filter((p) => p && p.type === 'text' && typeof p.text === 'string').map((p) => p.text);
  return [];
}

function assistantText(message) {
  const c = message && message.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.filter((p) => p && p.type === 'text').map((p) => p.text).join('\n');
  return '';
}

const isTyped = (text) => text && !text.startsWith('<') && !text.startsWith('[Request interrupted') && text.length <= MAX_TEXT;

// `seen` is shared across files on purpose: a resumed session repeats earlier lines, and the first copy
// read wins. Directory order is the platform's readdir order, as in the original extractor.
function readSession(file, project, sessionFile, seen, records) {
  let lastAssistant = '';
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.isSidechain) continue;
    if (o.type === 'assistant') {
      const t = assistantText(o.message).trim();
      if (t) lastAssistant = t;
      continue;
    }
    if (o.type !== 'user' || o.isMeta) continue;
    for (const raw of userTexts(o.message)) {
      const text = raw.trim();
      if (!isTyped(text)) continue;
      const sessionId = o.sessionId || sessionFile;
      const dedupe = `${o.timestamp || ''}|${text}`;
      if (seen.has(dedupe) || (o.uuid && seen.has(o.uuid))) continue;
      seen.add(dedupe);
      if (o.uuid) seen.add(o.uuid);
      const id = sha(`${sessionId}:${o.uuid || dedupe}`).slice(0, 12);
      const masked = maskSecrets(text);
      records.push({
        id,
        split: splitOf(id),
        sessionId,
        project,
        ts: o.timestamp || null,
        len: masked.length,
        text: masked,
        context: maskSecrets(lastAssistant).slice(-CONTEXT_CHARS),
      });
    }
  }
}

export function extractPrompts(projectsRoot) {
  const seen = new Set();
  const records = [];
  for (const project of fs.readdirSync(projectsRoot)) {
    const dir = path.join(projectsRoot, project);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.jsonl')) continue;
      readSession(path.join(dir, f), project, f.replace(/\.jsonl$/, ''), seen, records);
    }
  }
  return records.sort((a, b) =>
    a.sessionId === b.sessionId ? String(a.ts).localeCompare(String(b.ts)) : a.sessionId.localeCompare(b.sessionId),
  );
}

function main(argv) {
  const [root, outDir] = argv;
  if (!root || !outDir) throw new Error('usage: extract-prompts.mjs <projectsRoot> <outDir>');
  assertOutsideRepo(outDir);
  const records = extractPrompts(root);
  writeJsonl(path.join(outDir, 'prompts.jsonl'), records);
  const bySplit = records.reduce((m, r) => ({ ...m, [r.split]: (m[r.split] || 0) + 1 }), {});
  console.log(JSON.stringify({ prompts: records.length, sessions: new Set(records.map((r) => r.sessionId)).size, bySplit }));
}

if (invokedDirectly(import.meta.filename)) runMain(main);
