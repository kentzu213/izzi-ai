/**
 * Documentary workspace (Phase 1 — read-only, internal).
 *
 * When the agent's working directory is inside a registered documentary channel
 * (e.g. "I Don't Like Trump" at F:\…\Trump-Was-Right-Documentary), the agent gets:
 *   - a channel profile appended to its system prompt (authority docs + outlines),
 *   - three read-only, root-contained tools: doc_list / doc_read / doc_search,
 *   - a guard that enforces read-only on the host tools: write_file and run_command
 *     are refused, read_file / list_dir are refused for secret files (.env, keys…).
 *
 * The Python pipelines stay where they are; this module never writes to the
 * project. Every executor returns a string ('error: …' on failure) and never throws.
 *
 * @module main/documentary/documentary-workspace
 */
import fs from 'fs';
import path from 'path';
import type { OpenAiTool, ToolRisk } from '../agent/agent-tools';

export interface DocumentaryProject {
  id: string;
  name: string;
  root: string;
  /** Files (relative to root) that override everything else, in priority order. */
  authorityDocs: string[];
  /** Files known to be out of date — the agent must not treat them as rules. */
  staleDocs: string[];
}

/** Hard-coded registry — internal use first (no settings UI yet). */
export const DOCUMENTARY_PROJECTS: DocumentaryProject[] = [
  {
    id: 'trump',
    name: "I Don't Like Trump",
    root: 'F:\\1 Video Creater\\Historical Freedom Chronicles\\Trump-Was-Right-Documentary',
    authorityDocs: ['CANONICAL_VIDEO_PRODUCTION_STANDARD.md', 'CHANNEL_BIBLE.md'],
    staleDocs: ['AGENTS.md'],
  },
];

const OUTPUT_CAP = 12000;
const LIST_CAP = 300;
const READ_DEFAULT_LINES = 400;
const READ_MAX_BYTES = 5 * 1024 * 1024;
const SEARCH_MAX_FILES = 3000;
const SEARCH_MAX_ENTRIES = 20000;
const SEARCH_MAX_FILE_BYTES = 2 * 1024 * 1024;
const SEARCH_MAX_MATCHES = 100;
const OUTLINE_MAX_HEADINGS = 80;

const SEARCH_TEXT_EXTS = new Set(['.md', '.txt', '.json', '.py', '.mjs', '.js', '.ts', '.ps1', '.yaml', '.yml', '.csv', '.srt']);
const SEARCH_SKIP_DIRS = new Set(['.git', 'node_modules', '__pycache__', '.venv', 'venv']);
const SECRET_EXTS = new Set(['.pem', '.key', '.p12', '.pfx']);
const SECRET_NAMES = new Set(['.npmrc', '.netrc', '.pypirc', 'credentials']);
const SECRET_JSON_RE = /^(client_secret.*|.*credentials?|.*service[-_]account.*|token|secrets?)\.(json|ya?ml|txt)$/;

const isWin = process.platform === 'win32';
const norm = (p: string): string => (isWin ? p.toLowerCase() : p);

function realOrResolved(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(norm(root), norm(target));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** True for .env files, private keys, credential/token files and anything under .git. */
export function isSecretPath(p: string): boolean {
  const segments = p.split(/[\\/]+/).filter(Boolean).map((s) => s.toLowerCase());
  if (segments.includes('.git')) return true;
  const base = segments[segments.length - 1] ?? '';
  if (base.startsWith('.env') || base.endsWith('.env')) return true; // .env, .env.local, .envrc, prod.env
  if (SECRET_NAMES.has(base) || SECRET_EXTS.has(path.extname(base))) return true;
  if (/^id_(rsa|dsa|ecdsa|ed25519)/.test(base)) return true;
  return SECRET_JSON_RE.test(base);
}

/** The registered project whose root contains `workingDir`, or null. */
export function findDocumentaryProject(
  workingDir: string | undefined,
  registry: DocumentaryProject[] = DOCUMENTARY_PROJECTS,
): DocumentaryProject | null {
  if (!workingDir || !workingDir.trim()) return null;
  const wd = realOrResolved(workingDir);
  return registry.find((p) => isInside(realOrResolved(p.root), wd)) ?? null;
}

/**
 * Resolve a root-relative path to its real path, refusing absolute paths,
 * `..` escapes, junction/symlink escapes and secret files. Throws on refusal.
 */
export async function resolveInsideRoot(root: string, rel: string): Promise<string> {
  if (path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) throw new Error('path must be relative to the project root');
  const lexical = path.resolve(root, rel || '.');
  if (!isInside(path.resolve(root), lexical)) throw new Error('path is outside the project root');
  if (isSecretPath(path.relative(root, lexical))) throw new Error('refusing to access a secret file');
  let real: string;
  try {
    real = await fs.promises.realpath(lexical);
  } catch {
    throw new Error(`not found: ${rel}`);
  }
  const realRoot = await fs.promises.realpath(root);
  if (!isInside(realRoot, real)) throw new Error('path is outside the project root');
  if (isSecretPath(path.relative(realRoot, real))) throw new Error('refusing to access a secret file');
  return real;
}

export const DOCUMENTARY_TOOL_NAMES = ['doc_list', 'doc_read', 'doc_search'] as const;

export const DOCUMENTARY_TOOLS: OpenAiTool[] = [
  {
    type: 'function',
    function: {
      name: 'doc_list',
      description:
        'List a folder inside the current documentary channel project (read-only). Path is relative to the project root; omit it for the root.',
      parameters: { type: 'object', properties: { path: { type: 'string', description: 'Folder relative to the project root.' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'doc_read',
      description:
        'Read a text file inside the documentary channel project (read-only), with 1-based line numbers. Use offset/limit to page through long files such as the authority docs.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File relative to the project root.' },
          offset: { type: 'number', description: 'First line to return (1-based). Default 1.' },
          limit: { type: 'number', description: `Number of lines. Default ${READ_DEFAULT_LINES}.` },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'doc_search',
      description:
        'Case-insensitive text search across the documentary channel project (docs, scripts, JSON, subtitles). Returns file:line: text matches. Secret files are never searched.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Text to find.' },
          path: { type: 'string', description: 'Optional folder (relative to the project root) to limit the search.' },
        },
        required: ['query'],
      },
    },
  },
];

export function isDocumentaryTool(name: string): boolean {
  return (DOCUMENTARY_TOOL_NAMES as readonly string[]).includes(name);
}

/** All documentary tools are read-only; undefined for tools this module does not own. */
export function classifyDocumentaryRisk(name: string): ToolRisk | undefined {
  return isDocumentaryTool(name) ? 'safe' : undefined;
}

function cap(text: string): string {
  return text.length > OUTPUT_CAP ? text.slice(0, OUTPUT_CAP) + '\n…(truncated)' : text;
}

function looksBinary(buf: Buffer): boolean {
  return buf.subarray(0, 8192).includes(0);
}

async function docList(project: DocumentaryProject, rel: string): Promise<string> {
  const dir = await resolveInsideRoot(project.root, rel);
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const lines = entries
    .filter((e) => !isSecretPath(e.name))
    .slice(0, LIST_CAP)
    .map((e) => (e.isDirectory() ? '[DIR]  ' : '[FILE] ') + e.name);
  return lines.join('\n') || '(empty directory)';
}

async function docRead(project: DocumentaryProject, rel: string, offset: number, limit: number): Promise<string> {
  const file = await resolveInsideRoot(project.root, rel);
  const stat = await fs.promises.stat(file);
  if (!stat.isFile()) return `error: not a file: ${rel}`;
  if (stat.size > READ_MAX_BYTES) return `error: file too large to read (${stat.size} bytes)`;
  const buf = await fs.promises.readFile(file);
  if (looksBinary(buf)) return `error: binary file, not readable as text: ${rel}`;
  const all = buf.toString('utf8').split(/\r?\n/);
  const start = Math.max(1, Math.floor(offset));
  const end = Math.min(all.length, start + Math.max(1, Math.floor(limit)) - 1);
  const body = all.slice(start - 1, end).map((l, i) => `${start + i}: ${l}`).join('\n');
  return cap(`${rel} (lines ${start}-${end} of ${all.length})\n${body}`);
}

async function docSearch(project: DocumentaryProject, query: string, rel: string): Promise<string> {
  const base = await resolveInsideRoot(project.root, rel);
  const realRoot = await fs.promises.realpath(project.root);
  const needle = query.toLowerCase();
  const matches: string[] = [];
  let files = 0;
  let entries = 0;
  const stack = [base];
  while (stack.length && matches.length < SEARCH_MAX_MATCHES && files < SEARCH_MAX_FILES && entries < SEARCH_MAX_ENTRIES) {
    const dir = stack.pop()!;
    let items: fs.Dirent[];
    try {
      items = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const item of items) {
      entries++;
      if (isSecretPath(item.name)) continue;
      const full = path.join(dir, item.name);
      // Symlinks/junctions are skipped so the walk can never leave the root.
      if (item.isDirectory()) {
        if (!SEARCH_SKIP_DIRS.has(item.name.toLowerCase())) stack.push(full);
        continue;
      }
      if (!item.isFile() || !SEARCH_TEXT_EXTS.has(path.extname(item.name).toLowerCase())) continue;
      if (files >= SEARCH_MAX_FILES || matches.length >= SEARCH_MAX_MATCHES) break;
      files++;
      try {
        const stat = await fs.promises.stat(full);
        if (stat.size > SEARCH_MAX_FILE_BYTES) continue;
        const text = await fs.promises.readFile(full, 'utf8');
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length && matches.length < SEARCH_MAX_MATCHES; i++) {
          if (lines[i].toLowerCase().includes(needle)) {
            matches.push(`${path.relative(realRoot, full)}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
          }
        }
      } catch {
        /* unreadable file — skip */
      }
    }
  }
  if (!matches.length) return `no matches (${files} files scanned)`;
  const limited = matches.length >= SEARCH_MAX_MATCHES ? `\n…(stopped at ${SEARCH_MAX_MATCHES} matches)` : '';
  return cap(matches.join('\n') + limited);
}

/** Execute a documentary tool. Never throws. */
export async function executeDocumentaryTool(
  project: DocumentaryProject,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const a = args ?? {};
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  try {
    if (name === 'doc_list') return await docList(project, str(a.path));
    if (name === 'doc_read') {
      if (!str(a.path)) return 'error: missing path';
      return await docRead(project, str(a.path), num(a.offset, 1), num(a.limit, READ_DEFAULT_LINES));
    }
    if (name === 'doc_search') {
      if (!str(a.query).trim()) return 'error: missing query';
      return await docSearch(project, str(a.query), str(a.path));
    }
    return `error: unknown documentary tool "${name}"`;
  } catch (err) {
    return `error: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/**
 * Enforce Phase 1 read-only on the host tools while documentary mode is active.
 * write_file and run_command are always refused (a shell can reach any file, so
 * pattern-matching commands is not a safe boundary); read_file / list_dir are
 * refused for secret paths. Returns an 'error: …' string to short-circuit the
 * call, or undefined to let the host tool run normally.
 */
export function guardDocumentaryHostTool(name: string, args: Record<string, unknown>): string | undefined {
  if (name === 'write_file' || name === 'run_command') {
    return `error: documentary mode is read-only (Phase 1) — ${name} is disabled; use doc_list / doc_read / doc_search`;
  }
  if (name === 'read_file' || name === 'list_dir') {
    const p = typeof args?.path === 'string' ? args.path : '';
    return p && isSecretPath(p) ? 'error: refusing to access a secret file in documentary mode' : undefined;
  }
  return undefined;
}

function headingOutline(markdown: string): string[] {
  const out: string[] = [];
  let inFence = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    else if (!inFence && /^#{1,3}\s+\S/.test(line)) out.push(line.trim());
    if (out.length >= OUTLINE_MAX_HEADINGS) break;
  }
  return out;
}

/** System-prompt addendum describing the active channel. Never throws. */
export async function buildDocumentaryProfilePrompt(project: DocumentaryProject): Promise<string> {
  const docs: string[] = [];
  for (const [i, doc] of project.authorityDocs.entries()) {
    let outline: string;
    try {
      const file = await resolveInsideRoot(project.root, doc);
      outline = headingOutline(await fs.promises.readFile(file, 'utf8')).map((h) => `    ${h}`).join('\n') || '    (no headings)';
    } catch {
      outline = '    (not found — tell the user before relying on it)';
    }
    docs.push(`${i + 1}. ${doc}\n${outline}`);
  }
  const stale = project.staleDocs.length
    ? `\nOut-of-date files (never treat as rules): ${project.staleDocs.join(', ')}.`
    : '';
  return [
    `## Documentary channel mode: ${project.name}`,
    `Project root: ${project.root}`,
    'Phase 1 is READ-ONLY: use doc_list, doc_read and doc_search to study the project. Do not create, edit, move or delete project files, and do not run the render/publish pipelines.',
    'Authority documents, highest priority first. Outlines only — read the relevant section in full with doc_read before any production, script, visual or release decision:',
    docs.join('\n'),
    stale,
    'A passing machine validator is not an approval: gates are approved only by the owner, as the authority documents define.',
    'Never read, print or quote .env files, keys or credentials.',
  ].join('\n');
}
