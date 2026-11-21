// Agent-maturity metrics from the D1 hook event log (slice D5 part 1). Read-only: never writes a file.
//   node tools/agent-maturity/report.mjs --since <YYYY-MM-DD> [--events <file>] [--baseline <file>] [--json]
// Default log: <AGENT_MATURITY_HOME or ~/.claude/agent-maturity>/log/events-YYYY-MM.jsonl. See metrics/README.md.

import { parseArgs } from 'node:util';

import { resolveHome } from './lib/store.mjs';
import { compareToBaseline, parseBaseline } from './metrics/baseline.mjs';
import { fail, readJson, reason } from './metrics/cli.mjs';
import { computeMetrics } from './metrics/compute.mjs';
import { loadEvents, logFiles } from './metrics/events.mjs';
import { formatReport } from './metrics/format.mjs';

const USAGE = 'usage: node tools/agent-maturity/report.mjs --since <YYYY-MM-DD> [--events <file>] [--baseline <file>] [--json]';
const SINCE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2}))?$/;

// A bare date is midnight UTC; a full timestamp must carry its offset.
function parseSince(value) {
  if (typeof value !== 'string' || !SINCE.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function main(argv) {
  let args;
  try {
    args = parseArgs({
      args: argv,
      options: { since: { type: 'string' }, events: { type: 'string' }, baseline: { type: 'string' }, json: { type: 'boolean' } },
      strict: true,
    }).values;
  } catch (error) {
    return fail(`${error.message}\n${USAGE}`);
  }
  const sinceMs = parseSince(args.since);
  if (sinceMs === null) return fail(`--since needs a date such as 2026-11-21 (UTC) or a timestamp with an offset\n${USAGE}`);

  let baseline = null;
  if (args.baseline) {
    try {
      baseline = parseBaseline(readJson(args.baseline));
    } catch (error) {
      return fail(`cannot use --baseline: ${reason(error)}`);
    }
  }
  let log;
  try {
    log = loadEvents(args.events ? [args.events] : logFiles(resolveHome(process.env)));
  } catch (error) {
    return fail(`cannot read the event log: ${reason(error)}`);
  }

  const metrics = computeMetrics(log.events, { sinceMs, nowMs: Date.now() });
  const result = {
    ...metrics,
    log: { files: log.files, events: log.events.length, skippedLines: log.skipped },
    baseline: baseline ? { source: baseline.source, comparisons: compareToBaseline(metrics, baseline) } : null,
  };
  process.stdout.write(args.json ? `${JSON.stringify(result, null, 2)}\n` : formatReport(result));
  return 0;
}

process.exitCode = main(process.argv.slice(2));
