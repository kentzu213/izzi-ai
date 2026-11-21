// SessionStart hook: injects the owner-approved dev standards that apply to this session (user scope plus the
// current project; a git worktree counts as its main checkout), read from the export standards.json.
// Runs for every entrypoint (cli, claude-desktop, sdk, -p): owner decision 21/11.
// Never calls the KnowledgeMemory CLI. Writes nothing except one log line when the export is older than
// MAX_EXPORT_AGE_DAYS (then nothing is injected). Fails open: any error exits 0 with no output; never exits 2,
// never writes to stderr. See docs/izzi-v2/PLAN.md §2.5 and sessions/D3.md.

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

function logQuietly(store, home, events, now) {
  try {
    store.appendEvents(home, events, now);
  } catch {
    // logging is best effort
  }
}

async function main() {
  if (String(process.env.AGENT_MATURITY ?? '').trim().toLowerCase() === 'off') return;
  const [store, inject] = await Promise.all([import('../lib/store.mjs'), import('../standards/inject.mjs')]);
  const home = store.resolveHome(process.env);
  if (!store.loadConfig(home).enabled) return;
  const input = JSON.parse((await readStdin()) || '{}');
  if (!input || typeof input !== 'object' || Array.isArray(input)) return;
  const now = new Date();
  const value = readExport(path.join(home, 'standards.json'));
  if (inject.validExport(value, now) && inject.isStaleExport(value, now)) {
    // The scheduled refresh has not run: stale standards are not injected. Only timestamps are logged.
    const exportedAt = typeof value.exported_at === 'string' ? value.exported_at.slice(0, 40) : null;
    const stamp = { ts: now.toISOString(), session: store.sessionKey(input.session_id), ep: process.env.CLAUDE_CODE_ENTRYPOINT ?? '' };
    logQuietly(store, home, [{ ...stamp, type: 'standards_export_stale', exported_at: exportedAt, max_age_days: inject.MAX_EXPORT_AGE_DAYS }], now);
    return;
  }
  const cwd = [input.cwd, process.env.CLAUDE_PROJECT_DIR].find((v) => typeof v === 'string' && v.trim() !== '') ?? process.cwd();
  const context = inject.buildContext(value, cwd, now);
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
