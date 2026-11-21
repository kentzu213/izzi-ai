// Prints the code floor's label of a candidate, for the checkpoint question (before the owner answers).
//   node tools/agent-maturity/critic/label.mjs <candidate.json>
// Prints { floor, topics, reviewReasons, class? } as JSON: only labels from the floor's fixed vocabularies, never
// candidate text. Reads nothing but the candidate file and writes nothing. Exit 1 = invalid candidate, 2 = usage.

import { CliError, EXIT, invokedDirectly, readCandidateFile, runMain } from './cli.mjs';
import { classifyCandidateFloor } from './floor.mjs';

export function floorLabel(candidate) {
  const r = classifyCandidateFloor(candidate);
  return { floor: r.floor, topics: r.topics, reviewReasons: r.reviewReasons, ...(r.class ? { class: r.class } : {}) };
}

function main(argv) {
  if (argv.length !== 1 || argv[0].startsWith('--')) throw new CliError(EXIT.usage, 'usage: <candidate.json>');
  process.stdout.write(`${JSON.stringify(floorLabel(readCandidateFile(argv[0])), null, 2)}\n`);
  return EXIT.ok;
}

if (invokedDirectly(import.meta.filename)) runMain(main, process.argv.slice(2));
