// Node wrapper over the Codex KnowledgeMemory CLI (~/.codex/bin/project-memory.py), the single store for dev
// standards (docs/izzi-v2/PLAN.md §2.4-2.5). Only root calls it, after the owner answers a checkpoint; hooks never do.
// Every call passes --store and --vault explicitly; with AGENT_MATURITY_TEST=1 the real store, vault and
// ~/.claude are refused. A dev-standard/ record is stored only through standards/promote-standard.mjs (the D4 gate
// plus the verified owner answer). The boundary is the export, not this module: exportActive passes a dev-standard/
// record on to sessions only when the door made it (doorMade), so a record promoted any other way (the raw
// KnowledgeMemory CLI, promoteApproved called outside the door, a fresh import of this module) is held back as
// not_via_door. promote() and the command line still refuse dev-standard/ records (promote_requires_gate). Usage and
// the JS API: standards/README.md.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ID_RE } from '../critic/candidate.mjs';
import { createJsonAdapter } from '../critic/json-adapter.mjs';
import { resolveHome, writeFileAtomic } from '../lib/store.mjs';
import { EXPORT_SCHEMA, isReviewDue } from './inject.mjs';
import { checkoutInfo, findProject, isInside } from './project-root.mjs';

export const TOPIC_PREFIX = 'dev-standard/';
// Records the auto-memory importer captures (topic dev-standard/import/..., this author) are never promoted.
export const IMPORT_TOPIC = 'import/';
export const IMPORT_AUTHOR = 'agent-maturity-import';
export const DEFAULT_STORE = 'F:/Ai Tools/Codex/KnowledgeMemory';
export const DEFAULT_VAULT = 'F:/Ai Tools/Codex/KnowledgeVault';
export const DEFAULT_PYTHON = path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe');
export const DEFAULT_CLI = path.join(os.homedir(), '.codex', 'bin', 'project-memory.py');
const CLI_TIMEOUT_MS = 60_000;
const SCOPES = new Set(['user', 'project']);
const BASES = new Set(['user_instruction', 'verified_artifact']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// What promote-standard.mjs stores: topic dev-standard/<12 hex>, and a user source naming the owner answer, the
// candidate and the verdict: claude-session://<session>/<time>?candidate=<id>&verdict=c<n>.<12 hex>.
const DOOR_TOPIC_RE = /^dev-standard\/[0-9a-f]{12}$/;
const DOOR_URI_RE = /^claude-session:\/\/[A-Za-z0-9-]{1,128}\/[^?/]+\?candidate=([a-z0-9-]+)&verdict=c\d+\.[0-9a-f]{12}$/;

// The CLI has no list command, so the export reads records through its own core module, read-only.
const EXPORT_SCRIPT = [
  'import json, sys',
  'sys.path.insert(0, sys.argv[1])',
  'from memory_store import MemoryStore',
  'store = MemoryStore(sys.argv[2], readonly=True)',
  'records = [r for r in store.records() if r["topic_key"].startswith(sys.argv[3])]',
  'print(json.dumps({"projects": store.projects(), "records": records}, ensure_ascii=False))',
].join('\n');
// Python runs isolated (-I: no PYTHON* variables, no user site, no script or current folder on sys.path), without
// bytecode files (-B) and with UTF-8 stdio (-X utf8). -I drops the CLI's own folder, which it needs for its
// memory_store import, so the CLI is started through this bootstrap that adds exactly that folder.
const PYTHON_FLAGS = ['-I', '-B', '-X', 'utf8'];
const RUN_CLI_SCRIPT = [
  'import runpy, sys',
  'sys.path.insert(0, sys.argv[1])',
  'sys.argv = sys.argv[2:]',
  'runpy.run_path(sys.argv[0], run_name="__main__")',
].join('\n');
const DROPPED_ENV = new Set(['PYTHONPATH', 'PYTHONHOME', 'PYTHONSTARTUP']);

export class StoreCliError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StoreCliError';
    this.code = code;
  }
}

const badInput = (message) => new StoreCliError('bad_input', message);

// The real location of p (junctions, symlinks, 8.3 names and subst drives resolved), also when p does not exist
// yet: the nearest existing parent is resolved and the rest appended.
function realPath(p) {
  let current = path.resolve(p);
  const rest = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(current), ...rest);
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(p);
      rest.unshift(path.basename(current));
      current = parent;
    }
  }
}

// Inside `parent` as written or once both are resolved to their real location.
const lands = (p, parent) => isInside(p, parent) || isInside(realPath(p), realPath(parent));

function targets(opts = {}) {
  const env = opts.env ?? process.env;
  const t = {
    store: path.resolve(opts.store ?? DEFAULT_STORE),
    vault: path.resolve(opts.vault ?? DEFAULT_VAULT),
    python: opts.python ?? DEFAULT_PYTHON,
    cli: opts.cli ?? DEFAULT_CLI,
    env,
  };
  if (env.AGENT_MATURITY_TEST === '1' && (lands(t.store, DEFAULT_STORE) || lands(t.vault, DEFAULT_VAULT))) {
    throw new StoreCliError('refuse_real_store', 'AGENT_MATURITY_TEST=1: refusing the real KnowledgeMemory store or vault');
  }
  return t;
}

// The child environment: PYTHONPATH, PYTHONHOME and PYTHONSTARTUP (any letter case) are never passed on.
export function pythonEnv(env) {
  const kept = Object.entries(env ?? {}).filter(([key]) => !DROPPED_ENV.has(key.toUpperCase()) && key.toUpperCase() !== 'PYTHONIOENCODING');
  return { ...Object.fromEntries(kept), PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' };
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
  const r = spawnSync(t.python, [...PYTHON_FLAGS, ...args], {
    cwd: path.dirname(t.cli),
    encoding: 'utf8',
    timeout: CLI_TIMEOUT_MS,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    env: pythonEnv(t.env),
  });
  if (r.error) throw new StoreCliError('cli_failed', `could not run the KnowledgeMemory CLI (${r.error.code ?? r.error.name})`);
  if (r.status !== 0) throw new StoreCliError('cli_failed', `KnowledgeMemory rejected the call (${errorType(r.stderr)})`);
  try {
    return JSON.parse(r.stdout);
  } catch {
    throw new StoreCliError('bad_output', 'KnowledgeMemory printed something that is not JSON');
  }
}

// Runs one project-memory.py subcommand against the given store and vault; returns its parsed JSON. Internal: callers
// use the named functions below.
function runCli(args, opts) {
  const t = targets(opts);
  return spawnPython(t, ['-c', RUN_CLI_SCRIPT, path.dirname(t.cli), t.cli, '--store', t.store, '--vault', t.vault, ...args]);
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

// Read-only: a folder (a worktree counts as its main checkout) -> { id, root } of its registered project, or null.
export function lookupProject(projectPath, opts) {
  if (typeof projectPath !== 'string' || projectPath.trim() === '') throw badInput('projectPath is required');
  const info = checkoutInfo(projectPath);
  const hit = findProject(listProjects(opts), info.path, info.root);
  return hit ? { id: hit.id, root: hit.root } : null;
}

// A folder -> { id, root } of its registered project. An unregistered checkout is registered by its main root,
// never by the worktree.
export function resolveProject(projectPath, opts) {
  const hit = lookupProject(projectPath, opts);
  if (hit) return hit;
  const info = checkoutInfo(projectPath);
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

export const isImported = (record) => Boolean(record) && (record.author === IMPORT_AUTHOR
  || (typeof record.topic_key === 'string' && record.topic_key.startsWith(`${TOPIC_PREFIX}${IMPORT_TOPIC}`)));

const isDevStandard = (record) => Boolean(record) && typeof record.topic_key === 'string' && record.topic_key.startsWith(TOPIC_PREFIX);

// An imported auto-memory note is refused with import_not_promotable even though its file sha would pass the
// store: the owner-approved text goes through promote-standard as its own candidate, then root retracts the import
// (standards/README.md).
function promotable(id, opts) {
  needId(id);
  const record = get(id, opts);
  if (isImported(record)) {
    throw new StoreCliError('import_not_promotable', 'an imported auto-memory note is never promoted: run the owner-approved text through promote-standard as its own candidate, then retract the import');
  }
  return record;
}

// basis: 'user_instruction' (owner approved this exact text, user source) or 'verified_artifact' (file sha matches).
// A dev-standard/ record is refused (promote_requires_gate): standards/promote-standard.mjs stores dev standards.
// Records outside dev-standard/ are unchanged.
export function promote(id, basis, opts) {
  if (!BASES.has(basis)) throw badInput('basis must be user_instruction or verified_artifact');
  if (isDevStandard(promotable(id, opts))) {
    throw new StoreCliError('promote_requires_gate', 'a dev standard is promoted only through standards/promote-standard.mjs (D4 gate + the owner answer in the hook log)');
  }
  return withoutSync(runCli(['promote', id, `--basis=${basis}`, '--reviewer=root'], opts));
}

// The door's promote step (basis user_instruction), for dev-standard/ records only. Only promote-standard.mjs calls
// it, after the gate; anything else it promotes stays out of the export (not_via_door), like a raw CLI promote.
export function promoteApproved(id, opts) {
  if (!isDevStandard(promotable(id, opts))) throw badInput(`promoteApproved is for ${TOPIC_PREFIX} records only`);
  return withoutSync(runCli(['promote', id, '--basis=user_instruction', '--reviewer=root'], opts));
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

// The candidate id in a door-made source uri, or null.
export function doorCandidate(r) {
  const m = r && r.source && r.source.type === 'user' && typeof r.source.uri === 'string' ? DOOR_URI_RE.exec(r.source.uri) : null;
  return m && ID_RE.test(m[1]) ? m[1] : null;
}

// True when promote-standard.mjs made this record: a door topic, basis user_instruction, a user source in the door's
// format, and a standard_promoted event (`promoted`: those of the critic log) naming this record and that candidate.
export function doorMade(r, promoted) {
  const candidateId = doorCandidate(r);
  return DOOR_TOPIC_RE.test(r.topic_key) && r.basis === 'user_instruction' && candidateId !== null
    && promoted.some((e) => e && e.recordId === r.id && e.candidateId === candidateId);
}

// Pure: active dev standards in user or project scope that the door made (`promoted`: the critic log's
// standard_promoted events). Records that recall would not use, or that the door did not make, are held back with a
// reason.
export function buildExport(raw, now = new Date(), promoted = []) {
  const standards = [];
  const skipped = [];
  for (const r of Array.isArray(raw && raw.records) ? raw.records : []) {
    if (!r || r.state !== 'active' || typeof r.topic_key !== 'string' || !r.topic_key.startsWith(TOPIC_PREFIX)) continue;
    const topic = r.topic_key.slice(TOPIC_PREFIX.length);
    let reason = null;
    if (!doorMade(r, promoted)) reason = 'not_via_door';
    else if (!SCOPES.has(r.scope)) reason = 'unsupported_scope';
    else if (r.source_current === false) reason = 'source_changed';
    else if (r.expired || isReviewDue(r.review_after, now)) reason = 'review_due';
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

// The critic store the door logs to: opts.criticStore, default <AGENT_MATURITY_HOME or ~/.claude/agent-maturity>/critic.
export function criticPath(opts = {}) {
  return path.resolve(opts.criticStore ?? path.join(resolveHome(opts.env ?? process.env), 'critic'));
}

// The door's standard_promoted events for the candidates these records name, read-only (no log: none).
function doorPromotions(records, opts) {
  const candidates = new Set(records.map(doorCandidate).filter(Boolean));
  if (candidates.size === 0) return [];
  const critic = createJsonAdapter(criticPath(opts));
  return [...candidates].flatMap((id) => critic.listEvents(id)).filter((e) => e && e.type === 'standard_promoted');
}

// doorMade checked against the critic log in opts.criticStore (criticPath), whatever the record's state.
export const isDoorMade = (record, opts) => Boolean(record) && doorMade(record, doorPromotions([record], opts));

// Candidate and active records whose topic_key starts with `prefix`, read-only. A store not created yet (no
// memory.sqlite3) has none; the read-only reader cannot open it.
function readRecords(t, prefix) {
  return fs.existsSync(path.join(t.store, 'memory.sqlite3'))
    ? spawnPython(t, ['-c', EXPORT_SCRIPT, path.dirname(t.cli), t.store, prefix])
    : { projects: [], records: [] };
}

// Active records on exactly this topic_key, any scope (promote-standard supersedes the old one on its topic).
export function listActive(topicKey, opts) {
  if (typeof topicKey !== 'string' || !topicKey.startsWith(TOPIC_PREFIX)) throw badInput(`topicKey must start with ${TOPIC_PREFIX}`);
  const raw = readRecords(targets(opts), topicKey);
  return (Array.isArray(raw.records) ? raw.records : []).filter((r) => r && r.state === 'active' && r.topic_key === topicKey).map(withoutSync);
}

// Writes the active standards to opts.out (default <AGENT_MATURITY_HOME or ~/.claude/agent-maturity>/standards.json),
// checked against the door's log in the critic store (criticPath). Run it after every promote, supersede or retract
// (the command line does this itself).
export function exportActive(opts = {}) {
  const t = targets(opts);
  const out = exportPath(opts);
  if (t.env.AGENT_MATURITY_TEST === '1' && lands(out, path.join(os.homedir(), '.claude'))) {
    throw new StoreCliError('refuse_real_store', 'AGENT_MATURITY_TEST=1: refusing to write the export into the real ~/.claude');
  }
  const raw = readRecords(t, TOPIC_PREFIX);
  const active = (Array.isArray(raw.records) ? raw.records : []).filter((r) => r && r.state === 'active');
  const result = buildExport(raw, opts.now ?? new Date(), doorPromotions(active, opts));
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
const FLAGS = new Set(['store', 'vault', 'out', 'file', 'basis', 'reason', 'critic-store']);
const USAGE = 'usage: node store-cli.mjs <capture --file f | promote <id> --basis b | supersede <old> <new> --reason r | retract <id> --reason r | get <id> | export> [--store d] [--vault d] [--out f] [--critic-store d]';

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
    const opts = { store: a.store, vault: a.vault, out: a.out, criticStore: a['critic-store'], env };
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
