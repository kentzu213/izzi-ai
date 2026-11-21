// Shared helpers for the critic CLIs (brief.mjs, record-verdict.mjs).
// Exit codes: 0 ok · 1 invalid input · 2 usage · 3 blocked by the loop guard (do not run socrates).

import fs from 'node:fs';
import path from 'node:path';

import { validateCandidate } from './candidate.mjs';
import { statementKey } from './loop-guard.mjs';

export const EXIT = Object.freeze({ ok: 0, invalid: 1, usage: 2, blocked: 3 });

export class CliError extends Error {
  constructor(code, message) {
    super(message);
    this.exitCode = code;
  }
}

// A hard-REJECT is final across the store: any candidate (any id) whose normalized statement matches a
// hard-REJECTed one is refused before a critique. Logs the block and throws exit 3.
export function refuseHardRejectedStatement(adapter, candidate, now, step) {
  const hit = adapter.findHardReject(statementKey(candidate.statement));
  if (!hit) return;
  adapter.logEvent({
    type: 'critique_blocked',
    candidateId: candidate.id,
    reason: 'hard_reject_statement',
    matchedCandidateId: hit.candidateId,
    step,
    at: now.toISOString(),
  });
  throw new CliError(
    EXIT.blocked,
    `hard_reject_statement: ${candidate.id} has the statement of hard-REJECTed candidate ${hit.candidateId} (${hit.class}); not critiqued`,
  );
}

export function blockedError(plan, candidateId) {
  return new CliError(EXIT.blocked, `critique ${plan.critiqueNumber} blocked for ${candidateId}: ${plan.reason}`);
}

// <positional...> --store <dir> [<option> <dir> for each name in optionNames]; --store is required so nothing ever
// lands in a default location. Returns { positional, store, options: { '<option>': value } }.
export function parseCliArgs(argv, positionalNames, optionNames = []) {
  const usage = () =>
    new CliError(EXIT.usage, `usage: ${[...positionalNames.map((n) => `<${n}>`), '--store <dir>', ...optionNames.map((o) => `[${o} <dir>]`)].join(' ')}`);
  const positional = [];
  const options = {};
  let store = null;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--store') {
      store = argv[i + 1];
      i += 1;
    } else if (optionNames.includes(argv[i])) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw usage();
      options[argv[i]] = value;
      i += 1;
    } else if (argv[i].startsWith('--')) {
      throw new CliError(EXIT.usage, `unknown option ${argv[i]}`);
    } else {
      positional.push(argv[i]);
    }
  }
  if (positional.length !== positionalNames.length || !store) throw usage();
  return { positional, store: path.resolve(store), options };
}

// Files saved by Windows editors may start with a UTF-8 BOM; drop it.
export function readTextFile(file, label) {
  try {
    const content = fs.readFileSync(file, 'utf8');
    return content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  } catch (error) {
    throw new CliError(EXIT.invalid, `cannot read ${label} ${file}: ${error.code ?? error.message}`);
  }
}

export function readCandidateFile(file) {
  let raw;
  try {
    raw = JSON.parse(readTextFile(file, 'candidate'));
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError(EXIT.invalid, `candidate ${file} is not valid JSON`);
  }
  const r = validateCandidate(raw);
  if (!r.ok) throw new CliError(EXIT.invalid, `invalid candidate: ${r.errors.map((e) => e.code).join(', ')}`);
  return r.value;
}

export function runMain(main, argv) {
  try {
    process.exitCode = main(argv) ?? EXIT.ok;
  } catch (error) {
    if (error instanceof CliError) {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = error.exitCode;
      return;
    }
    process.stderr.write(`unexpected error: ${error && error.message}\n`);
    process.exitCode = EXIT.invalid;
  }
}

export const invokedDirectly = (filename) =>
  Boolean(process.argv[1]) && path.resolve(process.argv[1]).toLowerCase() === filename.toLowerCase();
