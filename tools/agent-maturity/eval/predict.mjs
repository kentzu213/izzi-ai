// D0: run the D1 classifier over prompts.jsonl. Output rows are {id, label, ruleId}: never the text.
import { classifyPrompt } from '../lib/classify.mjs';
import { invokedDirectly, readJsonl, runMain, writeJsonl } from './io.mjs';

export function predictRecords(records) {
  return records.map((r) => {
    const { label, ruleId } = classifyPrompt(r.text);
    return { id: r.id, label, ruleId };
  });
}

function main(argv) {
  const [input, output] = argv;
  if (!input || !output) throw new Error('usage: predict.mjs <prompts.jsonl> <out predictions.jsonl>');
  const rows = predictRecords(readJsonl(input));
  writeJsonl(output, rows);
  const byLabel = rows.reduce((m, r) => ({ ...m, [r.label]: (m[r.label] || 0) + 1 }), {});
  console.log(JSON.stringify({ predictions: rows.length, byLabel }));
}

if (invokedDirectly(import.meta.filename)) runMain(main);
