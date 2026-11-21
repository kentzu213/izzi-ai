// SessionStart hook: injects the owner-approved dev standards that apply to this session (user scope plus the
// current project; a git worktree counts as its main checkout), read from the export standards.json.
// Read-only: never calls the KnowledgeMemory CLI, never writes. Fails open: any error exits 0 with no output;
// never exits 2, never writes to stderr. See docs/izzi-v2/PLAN.md §2.5 and sessions/D3.md.

import fs from 'node:fs';
import path from 'node:path';

const BUDGET_MS = 4000;
const MAX_EXPORT_BYTES = 256 * 1024;
process.on('uncaughtException', () => process.exit(0));
process.on('unhandledRejection', () => process.exit(0));
setTimeout(() => process.exit(0), BUDGET_MS).unref();

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function readExport(file) {
  if (fs.statSync(file).size > MAX_EXPORT_BYTES) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function main() {
  if (String(process.env.AGENT_MATURITY ?? '').trim().toLowerCase() === 'off') return;
  const [store, inject] = await Promise.all([import('../lib/store.mjs'), import('../standards/inject.mjs')]);
  const home = store.resolveHome(process.env);
  if (!store.loadConfig(home).enabled) return;
  const input = JSON.parse((await readStdin()) || '{}');
  if (!input || typeof input !== 'object' || Array.isArray(input)) return;
  const cwd = [input.cwd, process.env.CLAUDE_PROJECT_DIR].find((v) => typeof v === 'string' && v.trim() !== '') ?? process.cwd();
  const context = inject.buildContext(readExport(path.join(home, 'standards.json')), cwd);
  if (context) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: context } }));
  }
}

main().then(
  () => {
    process.exitCode = 0;
  },
  () => {
    process.exitCode = 0;
  },
);
