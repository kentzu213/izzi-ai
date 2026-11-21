// The one entry point for the scheduled job (root registers it, daily): re-export the active standards, so the
// SessionStart hook never sees an export older than MAX_EXPORT_AGE_DAYS (inject.mjs) and review-due standards drop
// out, then import new auto-memory feedback notes as candidates. Never promotes.
// Usage: node tools/agent-maturity/standards/refresh.mjs [--store d] [--vault d] [--out f] [--projects-dir d] [--critic-store d]
// --critic-store is honoured only with AGENT_MATURITY_TEST=1 (store-cli criticPath): the export reads ~/.claude/agent-maturity/critic.

import path from 'node:path';

import { importFeedbackNotes } from './import-feedback.mjs';
import { exportActive, exportPath } from './store-cli.mjs';

// Returns { code, export: { file, standards, skipped } | { error }, import: <importFeedbackNotes result> }; never
// throws. The export runs first: a failing import must not leave the hook with stale data.
export function refresh(opts = {}) {
  let exported;
  try {
    const e = exportActive(opts);
    exported = { file: exportPath(opts).replace(/\\/g, '/'), standards: e.standards.length, skipped: e.skipped.length };
  } catch (error) {
    exported = { error: error.code ?? error.name };
  }
  const imported = importFeedbackNotes(opts);
  return { code: exported.error || imported.error ? 1 : 0, export: exported, import: imported };
}

function parseArgs(argv) {
  const names = { '--store': 'store', '--vault': 'vault', '--out': 'out', '--projects-dir': 'projectsDir', '--critic-store': 'criticStore' };
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
    const result = refresh({ ...parseArgs(process.argv.slice(2)), env: process.env });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.code;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ error: error.message })}\n`);
    process.exitCode = 1;
  }
}
