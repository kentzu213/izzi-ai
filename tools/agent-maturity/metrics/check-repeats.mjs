// Runs the repeated-error checker over Claude Code transcripts, read in place. Prints ids and scores only: no
// prompt text is printed or stored. Checker v1 is not validated yet (part 2), so its counts are not a metric.
//   node tools/agent-maturity/metrics/check-repeats.mjs --standards <file> --transcript <file> [...] [--threshold n] [--json]

import path from 'node:path';
import { parseArgs } from 'node:util';

import { classifyPrompt, isWrapperPrompt } from '../lib/classify.mjs';
import { checkCorrection, DEFAULT_THRESHOLD, normalizeStandards } from './checker.mjs';
import { fail, isFile, isMain, parseThreshold, readJson, reason } from './cli.mjs';
import { CORRECTION_LABELS } from './compute.mjs';
import { num } from './format.mjs';
import { readOwnerPrompts } from './transcript-prompts.mjs';

const USAGE = 'usage: node tools/agent-maturity/metrics/check-repeats.mjs --standards <file> --transcript <file> [--transcript <file>...] [--threshold n] [--json]';

// Prompts are classified with the D1 classifier, so the corrections checked are the ones the hook logs. Prompts follow
// the D0 rules (readOwnerPrompts); wrapper prompts and checkpoint answers are not counted, as in the report.
export async function checkTranscripts({ standards, files, threshold = DEFAULT_THRESHOLD, warn }) {
  let prompts = 0;
  let checkpointAnswers = 0;
  const matches = [];
  for (const file of files) {
    for (const p of await readOwnerPrompts(file, warn ? { warn } : {})) {
      const cls = classifyPrompt(p.text);
      if (isWrapperPrompt(cls)) continue;
      if (p.checkpointAnswer) {
        checkpointAnswers += 1;
        continue;
      }
      prompts += 1;
      if (!CORRECTION_LABELS.has(cls.label)) continue;
      const result = checkCorrection({ text: p.text, project_root: p.cwd, at: p.at }, standards, { threshold });
      matches.push({ transcript: path.basename(file), uuid: p.uuid, at: p.at, label: cls.label, ...result });
    }
  }
  return {
    threshold,
    transcripts: files.length,
    prompts,
    checkpointAnswers,
    corrections: matches.length,
    repeats: matches.filter((m) => m.repeat).length,
    matches,
  };
}

function formatText(r) {
  const lines = [
    `Checker lỗi bị nhắc lại v1 (chưa chấm trên cặp thật), ngưỡng ${num(r.threshold, 2)}`,
    `Chuẩn: ${r.standards.usable} dùng được, ${r.standards.unusable} không còn hiệu lực, ${r.standards.skipped} bản ghi bỏ qua, `
      + `${r.standards.unmatchable} chuẩn dự án không khớp được thư mục nào (chỉ có project_id lạ)`,
    `Transcript: ${r.transcripts}, câu lệnh: ${r.prompts} (không tính ${r.checkpointAnswers} câu trả lời checkpoint), `
      + `lần sửa đã xét: ${r.corrections}, trùng chuẩn có trước: ${r.repeats}`,
    ...r.matches.map((m) => `${m.at ?? '-'} ${m.transcript} ${m.uuid ?? '-'} ${m.label} `
      + `${m.repeat ? `trùng ${m.standardId}` : 'không trùng'} ${num(m.confidence, 2)}`),
  ];
  return `${lines.join('\n')}\n`;
}

async function main(argv) {
  let args;
  try {
    args = parseArgs({
      args: argv,
      options: { standards: { type: 'string' }, transcript: { type: 'string', multiple: true }, threshold: { type: 'string' }, json: { type: 'boolean' } },
      strict: true,
    }).values;
  } catch (error) {
    return fail(`${error.message}\n${USAGE}`);
  }
  if (!args.standards || !args.transcript || args.transcript.length === 0) return fail(USAGE);
  const threshold = parseThreshold(args.threshold, DEFAULT_THRESHOLD);
  if (threshold === null) return fail('--threshold must be a number above 0 and at most 1');
  let loaded;
  try {
    loaded = normalizeStandards(readJson(args.standards));
  } catch (error) {
    return fail(`cannot read --standards: ${reason(error)}`);
  }
  const missing = args.transcript.find((f) => !isFile(f));
  if (missing) return fail(`cannot read --transcript ${missing}`);

  const result = await checkTranscripts({ standards: loaded.standards, files: args.transcript, threshold });
  const usable = loaded.standards.filter((s) => s.usable).length;
  const out = { ...result, standards: { usable, unusable: loaded.standards.length - usable, skipped: loaded.skipped, unmatchable: loaded.unmatchable } };
  process.stdout.write(args.json ? `${JSON.stringify(out, null, 2)}\n` : formatText(out));
  return 0;
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.exitCode = fail(`check-repeats failed: ${reason(error)}`);
    },
  );
}
