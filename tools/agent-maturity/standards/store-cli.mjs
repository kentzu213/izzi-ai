// Node wrapper over the Codex KnowledgeMemory CLI (~/.codex/bin/project-memory.py), the single store for dev
// standards (docs/izzi-v2/PLAN.md §2.4-2.5). Only root calls it, after the owner answers a checkpoint; hooks never do.
// Every call passes --store and --vault explicitly; with AGENT_MATURITY_TEST=1 the real store, vault and
// ~/.claude are refused. Usage and the JS API: standards/README.md.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveHome, writeFileAtomic } from '../lib/store.mjs';
import { EXPORT_SCHEMA } from './inject.mjs';
import { checkoutInfo, findProject, isInside } from './project-root.mjs';

export const TOPIC_PREFIX = 'dev-standard/';
export const DEFAULT_STORE = 'F:/Ai Tools/Codex/KnowledgeMemory';
export const DEFAULT_VAULT = 'F:/Ai Tools/Codex/KnowledgeVault';
export const DEFAULT_PYTHON = path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe');
export const DEFAULT_CLI = path.join(os.homedir(), '.codex', 'bin', 'project-memory.py');
const CLI_TIMEOUT_MS = 60_000;
const SCOPES = new Set(['user', 'project']);
const BASES = new Set(['user_instruction', 'verified_artifact']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The CLI has no list command, so the export reads records through its own core module, read-only.
const EXPORT_SCRIPT = [
  'import json, sys',
  'sys.path.insert(0, sys.argv[1])',
  'from memory_store import MemoryStore',
  'store = MemoryStore(sys.argv[2], readonly=True)',
  'records = [r for r in store.records() if r["topic_key"].startswith(sys.argv[3])]',
  'print(json.dumps({"projects": store.projects(), "records": records}, ensure_ascii=False))',
].join('\n');

export class StoreCliError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StoreCliError';
    this.code = code;
  }
}

const badInput = (message) => new StoreCliError('bad_input', message);

function targets(opts = {}) {
  const env = opts.env ?? process.env;
  const t = {
    store: path.resolve(opts.store ?? DEFAULT_STORE),
    vault: path.resolve(opts.vault ?? DEFAULT_VAULT),
    python: opts.python ?? DEFAULT_PYTHON,
    cli: opts.cli ?? DEFAULT_CLI,
    env,
  };
  if (env.AGENT_MATURITY_TEST === '1' && (isInside(t.store, DEFAULT_STORE) || isInside(t.vault, DEFAULT_VAULT))) {
    throw new StoreCliError('refuse_real_store', 'AGENT_MATURITY_TEST=1: refusing the real KnowledgeMemory store or vault');
  }
  return t;
}

export const cliAvailable = (opts = {}) => fs.existsSync(opts.python ?? DEFAULT_PYTHON) && fs.existsSync(opts.cli ?? DEFAULT_CLI);

// The CLI prints a fixed, content-free error JSON on stderr; only its exception type is passed on.
function errorType(stderr) {
  try {
    const type = JSON.parse(String(stderr).trim().split('\n').pop()).type;
    return /^\w{1,64}$/.test(type) ? type : 'error';
  } catch {
    return 'error';
  }
}

function spawnPython(t, args) {
  if (!fs.existsSync(t.python) || !fs.existsSync(t.cli)) throw new StoreCliError('cli_unavailable', 'KnowledgeMemory CLI or bundled Python not found');
  const r = spawnSync(t.python, args, {
    encoding: 'utf8',
    timeout: CLI_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...t.env, PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' },
  });
  if (r.error) throw new StoreCliError('cli_failed', `could not run the KnowledgeMemory CLI (${r.error.code ?? r.error.name})`);
  if (r.status !== 0) throw new StoreCliError('cli_failed', `KnowledgeMemory rejected the call (${errorType(r.stderr)})`);
  try {
    return JSON.parse(r.stdout);
  } catch {
    throw new StoreCliError('bad_output', 'KnowledgeMemory printed something that is not JSON');
  }
}

// Runs one project-memory.py subcommand against the given store and vault; returns its parsed JSON.
export function runCli(args, opts) {
  const t = targets(opts);
  return spawnPython(t, [t.cli, '--store', t.store, '--vault', t.vault, ...args]);
}

const withoutSync = ({ projection_sync: _sync, ...record }) => record;

function needId(id, name = 'id') {
  if (typeof id !== 'string' || !UUID.test(id)) throw badInput(`${name} must be a record UUID`);
  return id;
}

function needReason(reason) {
  if (typeof reason !== 'string' || reason.trim() === '') throw badInput('reason is required');
  return reason;
}

// Source of an owner decision: the session and the time of the owner's message, never the message text.
export function userSource(sessionId, at = new Date().toISOString()) {
  if (typeof sessionId !== 'string' || !/^[A-Za-z0-9-]{1,128}$/.test(sessionId)) throw badInput('sessionId must be a Claude session id');
  if (typeof at !== 'string' || Number.isNaN(Date.parse(at))) throw badInput('at must be an ISO time');
  return { type: 'user', uri: `claude-session://${sessionId}/${at}` };
}

export function listProjects(opts) {
  const t = targets(opts);
  if (!fs.existsSync(path.join(t.store, 'memory.sqlite3'))) return [];
  return runCli(['projects'], opts);
}

// A folder (a worktree counts as its main checkout) -> { id, root } of its registered project. An unregistered
// checkout is registered by its main root, never by the worktree.
export function resolveProject(projectPath, opts) {
  if (typeof projectPath !== 'string' || projectPath.trim() === '') throw badInput('projectPath is required');
  const info = checkoutInfo(projectPath);
  const hit = findProject(listProjects(opts), info.path, info.root);
  if (hit) return { id: hit.id, root: hit.root };
  const made = runCli(['project', info.root ?? info.path], opts);
  return { id: made.id, root: made.root };
}

// candidate: { topic, title, summary, source, scope='user', projectPath | projectId (project scope),
//              kind='procedure', evidence, confidence=0.9, author='root' }. Returns the stored record.
// The store dedupes by content: the same candidate again returns the existing record in whatever state it has.
export function capture(candidate, opts) {
  const c = candidate && typeof candidate === 'object' ? candidate : {};
  const scope = c.scope ?? 'user';
  if (!SCOPES.has(scope)) throw badInput('scope must be user or project');
  const topic = typeof c.topic === 'string' ? c.topic.trim() : '';
  if (!topic) throw badInput('topic is required');
  targets(opts);
  let projectId = null;
  if (scope === 'project') {
    if (c.projectId) projectId = needId(c.projectId, 'projectId');
    else if (c.projectPath) projectId = resolveProject(c.projectPath, opts).id;
    else throw badInput('project scope needs projectPath or projectId');
  }
  const payload = {
    scope,
    ...(projectId ? { project_id: projectId } : {}),
    kind: c.kind ?? 'procedure',
    topic_key: topic.startsWith(TOPIC_PREFIX) ? topic : `${TOPIC_PREFIX}${topic}`,
    title: c.title,
    summary: c.summary,
    source: c.source,
    author: c.author ?? 'root',
    evidence: c.evidence ?? (c.source && c.source.type === 'user' ? 'direct' : 'derived'),
    confidence: c.confidence ?? 0.9,
    sensitivity: 'local',
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-capture-'));
  try {
    const file = path.join(dir, 'candidate.json');
    fs.writeFileSync(file, JSON.stringify(payload));
    return withoutSync(runCli(['capture', `--file=${file}`], opts));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// basis: 'user_instruction' (owner approved this exact text, user source) or 'verified_artifact' (file sha matches).
export function promote(id, basis, opts) {
  needId(id);
  if (!BASES.has(basis)) throw badInput('basis must be user_instruction or verified_artifact');
  return withoutSync(runCli(['promote', id, `--basis=${basis}`, '--reviewer=root'], opts));
}

// Both records must be active and on the same scope, project and topic. The old one keeps its history.
export function supersede(oldId, newId, reason, opts) {
  needId(oldId, 'oldId');
  needId(newId, 'newId');
  return withoutSync(runCli(['supersede', oldId, newId, `--reason=${needReason(reason)}`], opts));
}

export function retract(id, reason, opts) {
  needId(id);
  return withoutSync(runCli(['retract', id, `--reason=${needReason(reason)}`], opts));
}

export function get(id, opts) {
  needId(id);
  return runCli(['get', id], opts);
}

// Pure: active dev standards in user or project scope. Records that recall would not use are held back with a reason.
export function buildExport(raw, now = new Date()) {
  const standards = [];
  const skipped = [];
  for (const r of Array.isArray(raw && raw.records) ? raw.records : []) {
    if (!r || r.state !== 'active' || typeof r.topic_key !== 'string' || !r.topic_key.startsWith(TOPIC_PREFIX)) continue;
    const topic = r.topic_key.slice(TOPIC_PREFIX.length);
    let reason = null;
    if (!SCOPES.has(r.scope)) reason = 'unsupported_scope';
    else if (r.source_current === false) reason = 'source_changed';
    else if (r.expired) reason = 'review_due';
    else if (Array.isArray(r.conflicts) && r.conflicts.length > 0) reason = 'conflict';
    if (reason) {
      skipped.push({ id: r.id, topic, reason });
      continue;
    }
    standards.push({ id: r.id, scope: r.scope, project_id: r.project_id ?? null, topic, kind: r.kind, title: r.title, summary: r.summary, review_after: r.review_after });
  }
  const used = new Set(standards.filter((s) => s.scope === 'project').map((s) => s.project_id));
  const projects = (Array.isArray(raw && raw.projects) ? raw.projects : []).filter((p) => p && used.has(p.id)).map((p) => ({ id: p.id, root: p.root }));
  return { schema: EXPORT_SCHEMA, exported_at: now.toISOString(), standards, projects, skipped };
}

export function exportPath(opts = {}) {
  return path.resolve(opts.out ?? path.join(resolveHome(opts.env ?? process.env), 'standards.json'));
}

// Writes the active standards to opts.out (default <AGENT_MATURITY_HOME or ~/.claude/agent-maturity>/standards.json).
// Run it after every promote, supersede or retract (the command line does this itself).
export function exportActive(opts = {}) {
  const t = targets(opts);
  const out = exportPath(opts);
  if (t.env.AGENT_MATURITY_TEST === '1' && isInside(out, path.join(os.homedir(), '.claude'))) {
    throw new StoreCliError('refuse_real_store', 'AGENT_MATURITY_TEST=1: refusing to write the export into the real ~/.claude');
  }
  const result = buildExport(spawnPython(t, ['-c', EXPORT_SCRIPT, path.dirname(t.cli), t.store, TOPIC_PREFIX]), opts.now ?? new Date());
  writeFileAtomic(out, `${JSON.stringify(result, null, 2)}\n`);
  return result;
}

const COMMANDS = {
  capture: (a, o) => capture(JSON.parse(fs.readFileSync(a.file ?? '', 'utf8')), o),
  promote: (a, o) => promote(a._[0], a.basis, o),
  supersede: (a, o) => supersede(a._[0], a._[1], a.reason, o),
  retract: (a, o) => retract(a._[0], a.reason, o),
  get: (a, o) => get(a._[0], o),
  export: () => null,
};
const REEXPORT = new Set(['promote', 'supersede', 'retract', 'export']);
const FLAGS = new Set(['store', 'vault', 'out', 'file', 'basis', 'reason']);
const USAGE = 'usage: node store-cli.mjs <capture --file f | promote <id> --basis b | supersede <old> <new> --reason r | retract <id> --reason r | get <id> | export> [--store d] [--vault d] [--out f]';

function parseCliArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      out._.push(arg);
      continue;
    }
    const name = arg.slice(2);
    const value = argv[i + 1];
    if (!FLAGS.has(name)) throw badInput(`unknown option: ${arg}`);
    if (value === undefined || value.startsWith('--')) throw badInput(`${arg} needs a value`);
    out[name] = value;
    i += 1;
  }
  return out;
}

// Returns the exit code; prints one JSON object.
export function main(argv, env = process.env) {
  try {
    const [command, ...rest] = argv;
    if (!Object.hasOwn(COMMANDS, command ?? '')) throw badInput(USAGE);
    const a = parseCliArgs(rest);
    const opts = { store: a.store, vault: a.vault, out: a.out, env };
    const result = COMMANDS[command](a, opts);
    const exported = REEXPORT.has(command) ? exportActive(opts) : null;
    const summary = exported ? { file: exportPath(opts).replace(/\\/g, '/'), standards: exported.standards.length, skipped: exported.skipped.length } : null;
    process.stdout.write(`${JSON.stringify({ result, export: summary }, null, 2)}\n`);
    return 0;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ error: error.code ?? error.name, message: error.message })}\n`);
    return 1;
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === import.meta.filename.toLowerCase();
if (invokedDirectly) process.exitCode = main(process.argv.slice(2));
