// Reads the D1 hook event log (<home>/log/events-YYYY-MM.jsonl). Read-only: never creates or changes a file.
// Field reference: hooks/prompt-signal.mjs (stamp: ts, session, ep) and lib/decide.mjs (event bodies).

import fs from 'node:fs';
import path from 'node:path';

const LOG_FILE = /^events-\d{4}-\d{2}\.jsonl$/;

// Lines that do not parse, or lack a string type and a valid ts, are counted as skipped.
export function parseEventLines(text) {
  const events = [];
  let skipped = 0;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let value = null;
    try {
      value = JSON.parse(line);
    } catch {
      value = null;
    }
    const valid = value && typeof value === 'object' && !Array.isArray(value)
      && typeof value.type === 'string' && typeof value.ts === 'string' && Number.isFinite(Date.parse(value.ts));
    if (valid) events.push(value);
    else skipped += 1;
  }
  return { events, skipped };
}

// Monthly log files of a hook home, oldest first; [] when the folder does not exist.
export function logFiles(home) {
  const dir = path.join(home, 'log');
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((n) => LOG_FILE.test(n)).sort().map((n) => path.join(dir, n));
}

// Throws when a file cannot be read; the caller decides how to report it.
export function loadEvents(files) {
  const events = [];
  let skipped = 0;
  for (const file of files) {
    const parsed = parseEventLines(fs.readFileSync(file, 'utf8'));
    events.push(...parsed.events);
    skipped += parsed.skipped;
  }
  return { events, skipped, files: files.length };
}
