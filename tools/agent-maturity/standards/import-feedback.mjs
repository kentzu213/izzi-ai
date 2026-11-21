// Imports Claude auto-memory notes of type feedback (~/.claude/projects/*/memory/*.md) into KnowledgeMemory as
// candidates for the owner to review. Never promotes (promote refuses these records), never edits a note. Safe to
// run on a schedule: the store dedupes by content, so an unchanged note maps to its existing record and an edited
// note becomes a new candidate. A locked or unreadable note is skipped and counted.
// Usage: node tools/agent-maturity/standards/import-feedback.mjs [--projects-dir d] [--store d] [--vault d]

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { IMPORT_AUTHOR, IMPORT_TOPIC, StoreCliError, capture } from './store-cli.mjs';

const MAX_NOTE_BYTES = 64 * 1024;
const MAX_TITLE = 160;
const MAX_SUMMARY = 1200;
const FATAL = new Set(['refuse_real_store', 'cli_unavailable']);

function unquote(raw) {
  const v = raw.trim();
  if (v.startsWith('"')) {
    try {
      return JSON.parse(v);
    } catch {
      return v.replace(/^"|"$/g, '');
    }
  }
  if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) return v.slice(1, -1).replace(/''/g, "'");
  return v;
}

// { name, description, type, body } or null. type may sit at the top level or under `metadata:`.
export function parseNote(text) {
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(String(text));
  if (!m) return null;
  const top = {};
  const meta = {};
  let parent = null;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([ \t]*)([A-Za-z_][\w-]*):[ \t]*(.*)$/.exec(line);
    if (!kv) continue;
    const [, indent, key, raw] = kv;
    if (indent === '') {
      top[key] = unquote(raw);
      parent = raw.trim() === '' ? key : null;
    } else if (parent === 'metadata') {
      meta[key] = unquote(raw);
    }
  }
  return { name: top.name ?? '', description: top.description ?? '', type: top.type || meta.type || '', body: m[2] };
}

const listDir = (dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
};

// One note, read only and at most MAX_NOTE_BYTES: { bytes } or { tooLarge: true }. The size is checked with fstat
// before any read; a note that grows meanwhile is still cut off. Throws when the note cannot be opened or read.
function readNote(file) {
  const fd = fs.openSync(file, 'r');
  try {
    if (fs.fstatSync(fd).size > MAX_NOTE_BYTES) return { tooLarge: true };
    const buf = Buffer.alloc(MAX_NOTE_BYTES + 1);
    let length = 0;
    for (;;) {
      const read = fs.readSync(fd, buf, length, buf.length - length, length);
      if (read === 0) return { bytes: buf.subarray(0, length) };
      length += read;
      if (length > MAX_NOTE_BYTES) return { tooLarge: true };
    }
  } finally {
    fs.closeSync(fd);
  }
}

// Feedback notes as { file, name, description, body, sha }, plus { file, name, tooLarge } and
// { file, name, unreadable: <error code> } for notes that were not parsed. Read only; never throws for one note.
export function findFeedbackNotes(projectsDir) {
  const notes = [];
  for (const project of listDir(projectsDir)) {
    if (!project.isDirectory()) continue;
    const memoryDir = path.join(projectsDir, project.name, 'memory');
    for (const entry of listDir(memoryDir)) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
      const file = path.join(memoryDir, entry.name);
      let read;
      try {
        read = readNote(file);
      } catch (error) {
        notes.push({ file, name: entry.name, unreadable: error.code ?? error.name });
        continue;
      }
      if (read.tooLarge) {
        notes.push({ file, name: entry.name, tooLarge: true });
        continue;
      }
      const { bytes } = read;
      const note = parseNote(bytes.toString('utf8'));
      if (!note || note.type.trim().toLowerCase() !== 'feedback') continue;
      notes.push({ file, name: note.name || entry.name.replace(/\.md$/i, ''), description: note.description, body: note.body, sha: crypto.createHash('sha256').update(bytes).digest('hex') });
    }
  }
  return notes;
}

const flatten = (text) => String(text ?? '').replace(/\s+/g, ' ').trim();
const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
// ASCII slug (diacritics dropped, đ -> d); a name with no ASCII letter or digit becomes "note".
const slug = (text) => String(text)
  .normalize('NFKD')
  .replace(/\p{M}+/gu, '')
  .replace(/[đĐ]/g, 'd')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 80)
  .replace(/-+$/, '') || 'note';
// Short hash of the note path, so two notes whose names slug the same never share a topic.
const pathTag = (file) => {
  const key = file.replace(/\\/g, '/');
  return crypto.createHash('sha256').update(process.platform === 'win32' ? key.toLowerCase() : key).digest('hex').slice(0, 8);
};

// User scope by default (owner decision 21/11). A note that is really about one codebase is re-captured with
// project scope by root at review time, and this candidate retracted.
export function noteCandidate(note) {
  return {
    scope: 'user',
    kind: 'lesson',
    topic: `${IMPORT_TOPIC}${slug(note.name)}-${pathTag(note.file)}`,
    title: clip(flatten(note.name), MAX_TITLE),
    summary: clip(flatten(`${note.description} ${note.body}`), MAX_SUMMARY),
    source: { type: 'artifact', uri: note.file.replace(/\\/g, '/'), sha256: note.sha },
    evidence: 'derived',
    confidence: 0.6,
    author: IMPORT_AUTHOR,
  };
}

// Returns { scanned, feedback, captured: [{ file, id, state }], failed: [{ file, error }],
//           unreadable: [{ file, error }], error? }; never throws.
export function importFeedbackNotes(opts = {}) {
  const projectsDir = path.resolve(opts.projectsDir ?? path.join(os.homedir(), '.claude', 'projects'));
  const result = { scanned: projectsDir.replace(/\\/g, '/'), feedback: 0, captured: [], failed: [], unreadable: [] };
  let notes;
  try {
    notes = findFeedbackNotes(projectsDir);
  } catch (error) {
    return { ...result, error: error.code ?? error.name };
  }
  result.feedback = notes.filter((note) => !note.unreadable).length;
  for (const note of notes) {
    const file = note.file.replace(/\\/g, '/');
    if (note.unreadable) {
      result.unreadable.push({ file, error: note.unreadable });
      continue;
    }
    if (note.tooLarge) {
      result.failed.push({ file, error: 'too_large' });
      continue;
    }
    try {
      const record = capture(noteCandidate(note), opts);
      result.captured.push({ file, id: record.id, state: record.state });
    } catch (error) {
      const code = error.code ?? error.name;
      if (FATAL.has(code)) return { ...result, error: code };
      // StoreCliError messages carry only the CLI exception type, never note text.
      result.failed.push({ file, error: code, detail: error instanceof StoreCliError ? error.message : undefined });
    }
  }
  return result;
}

function parseArgs(argv) {
  const names = { '--projects-dir': 'projectsDir', '--store': 'store', '--vault': 'vault' };
  const opts = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = names[argv[i]];
    const value = argv[i + 1];
    if (!key || value === undefined || value.startsWith('--')) throw new Error(`bad argument: ${argv[i]}`);
    opts[key] = value;
  }
  return opts;
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === import.meta.filename.toLowerCase();
if (invokedDirectly) {
  try {
    const result = importFeedbackNotes({ ...parseArgs(process.argv.slice(2)), env: process.env });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.error ? 1 : 0;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ error: error.message })}\n`);
    process.exitCode = 1;
  }
}
