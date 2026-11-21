// Runs the floor corpus through the current three-way floor and, with --before <git-ref>, through the floor of that
// commit (binary: hard-REJECT or pass), and prints counts per class, the before -> after table and every sentence
// that misses its expectation. Every sentence is read as kind 'preference' (row.kind overrides), the only kind the
// pass allowlist admits, so the expectations test the vocabulary, not the kind.
//   node tools/agent-maturity/critic/test-corpus/compare-floor.mjs [--before d0edfc8]
// Exit 0 = every sentence meets its expectation, 1 = a miss, 2 = usage. Reads git; writes only a temp folder that it
// removes again.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { classifyFloor } from '../floor.mjs';

const HERE = import.meta.dirname;
const REPO = path.resolve(HERE, '..', '..', '..', '..');
const CRITIC_IN_GIT = 'tools/agent-maturity/critic';

export function loadCorpus(file = path.join(HERE, 'floor-corpus.json')) {
  const corpus = JSON.parse(fs.readFileSync(file, 'utf8'));
  return Object.entries(corpus.groups).flatMap(([group, { expect, texts }]) => texts.map((text) => ({ group, expect, text })));
}

export const meets = (expect, floor) => (expect === 'not_pass' ? floor !== 'pass' : floor === expect);

// The old floor's detectHardReject, materialized from git into a temp folder.
async function loadBefore(ref) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'am-floor-before-'));
  try {
    for (const name of ['verdict.mjs', 'candidate.mjs', 'loop-guard.mjs', 'floor.mjs', 'floor-topics.mjs']) {
      let source;
      try {
        source = execFileSync('git', ['show', `${ref}:${CRITIC_IN_GIT}/${name}`], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      } catch {
        continue; // floor.mjs does not exist before round 3, floor-topics.mjs before round 4
      }
      fs.writeFileSync(path.join(dir, name), source);
    }
    const mod = await import(pathToFileURL(path.join(dir, 'verdict.mjs')).href);
    return { detect: mod.detectHardReject, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}

const count = (rows, key) => rows.reduce((acc, r) => ({ ...acc, [r[key]]: (acc[r[key]] ?? 0) + 1 }), {});

async function main(argv) {
  const at = argv.indexOf('--before');
  if ((at !== -1 && !argv[at + 1]) || argv.some((a, i) => a.startsWith('--') && a !== '--before' && i !== at + 1)) {
    process.stderr.write('usage: compare-floor.mjs [--before <git-ref>]\n');
    return 2;
  }
  const before = at === -1 ? null : await loadBefore(argv[at + 1]);
  try {
    const rows = loadCorpus().map((row) => {
      const after = classifyFloor(row.text, { kind: row.kind ?? 'preference' });
      const old = before ? before.detect(row.text) : undefined;
      return { ...row, after: after.floor, afterClass: after.class ?? '', before: old === undefined ? '' : old ? 'hard_reject' : 'pass' };
    });
    process.stdout.write(`corpus: ${rows.length} synthetic sentences\n`);
    process.stdout.write(`after (three-way): ${JSON.stringify(count(rows, 'after'))}\n`);
    const procedurePass = rows.filter((r) => classifyFloor(r.text, { kind: 'procedure' }).floor === 'pass').length;
    process.stdout.write(`allowlist: read as kind procedure, pass ${procedurePass}\n`);
    if (before) {
      process.stdout.write(`before ${argv[at + 1]} (binary): ${JSON.stringify(count(rows, 'before'))}\n`);
      const table = count(rows.map((r) => ({ t: `${r.before} -> ${r.after}` })), 't');
      for (const [k, v] of Object.entries(table).sort()) process.stdout.write(`  ${k}: ${v}\n`);
      const groups = [...new Set(rows.map((r) => r.group))];
      for (const g of groups) {
        const sub = rows.filter((r) => r.group === g);
        process.stdout.write(`  ${g}: before ${JSON.stringify(count(sub, 'before'))} after ${JSON.stringify(count(sub, 'after'))}\n`);
      }
    }
    const misses = rows.filter((r) => !meets(r.expect, r.after));
    for (const m of misses) process.stdout.write(`MISS [${m.group}] expected ${m.expect}, got ${m.after}: ${JSON.stringify(m.text)}\n`);
    process.stdout.write(`misses: ${misses.length}\n`);
    return misses.length === 0 ? 0 : 1;
  } finally {
    before?.cleanup();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === import.meta.filename.toLowerCase()) {
  process.exitCode = await main(process.argv.slice(2));
}
