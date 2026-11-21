// D0: pick the gold labels the owner must check (owner decision 21/11: 30-50 risky items) into a private review.md.
// review.md quotes prompt text, so it must be written outside the repo. stdout prints counts only.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { MILESTONE_LABELS } from '../lib/classify.mjs';
import { criticalReasons, joinRows } from './eval-gold.mjs';
import { assertOutsideRepo, invokedDirectly, readJsonl, runMain } from './io.mjs';

const TEXT_LIMIT = 200;
const CAP = { hits: 15, unsureCorrection: 8 };
const TITLES = {
  hits: 'máy đoán là mốc hoàn tất (duyệt/khen) trên tập test: anh xác nhận để đo precision',
  resignation: 'nhãn vàng là cam chịu',
  unsureCorrection: 'nhãn vàng là sửa nhưng người gắn nhãn không chắc',
  missed: 'nhãn vàng là duyệt/khen nhưng máy không bắt',
};

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const testFirst = (a, b) => (a.split === b.split ? byId(a, b) : a.split === 'test' ? -1 : 1);
const criticalFirst = (a, b) => (criticalReasons(b).length > 0) - (criticalReasons(a).length > 0) || byId(a, b);

// Buckets in fill order (Socrates D0 fix 5): each item lands in the first bucket that takes it.
const BUCKETS = [
  { name: 'hits', match: (r) => r.split === 'test' && MILESTONE_LABELS.has(r.label), order: criticalFirst, cap: CAP.hits },
  { name: 'resignation', match: (r) => r.gold === 'resignation', order: testFirst, cap: Infinity },
  { name: 'unsureCorrection', match: (r) => r.gold === 'correction' && r.unsure, order: testFirst, cap: CAP.unsureCorrection },
  { name: 'missed', match: (r) => MILESTONE_LABELS.has(r.gold) && !MILESTONE_LABELS.has(r.label), order: testFirst, cap: Infinity },
];

function trimText(text) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > TEXT_LIMIT ? `${flat.slice(0, TEXT_LIMIT)}…` : flat;
}

export function selectReview({ prompts, labels, predictions, max = 50 }) {
  if (!Number.isInteger(max) || max < 1) throw new Error('--max must be a positive integer');
  const { rows } = joinRows(prompts, labels, predictions);
  const textById = new Map(prompts.map((p) => [p.id, p.text]));
  const noteById = new Map(labels.map((l) => [l.id, typeof l.note === 'string' ? l.note : '']));
  const taken = new Set();
  const picked = [];
  const pools = {};
  for (const { name, match, order, cap } of BUCKETS) {
    const pool = rows.filter((r) => !taken.has(r.id) && match(r)).sort(order);
    const chosen = pool.slice(0, Math.max(0, Math.min(cap, max - picked.length)));
    for (const row of chosen) {
      taken.add(row.id);
      picked.push({ row, bucket: name });
    }
    pools[name] = pool;
  }
  const candidates = Object.fromEntries(BUCKETS.map(({ name }) => [name, pools[name].length]));
  const omitted = Object.fromEntries(BUCKETS.map(({ name }) => [name, pools[name].filter((r) => !taken.has(r.id)).length]));
  const items = picked.map(({ row, bucket }, i) => ({
    n: i + 1,
    id: row.id,
    bucket,
    text: trimText(textById.get(row.id)),
    gold: row.gold,
    tags: row.tags,
    unsure: row.unsure,
    label: row.label,
    ruleId: row.ruleId,
    note: noteById.get(row.id) ?? '',
  }));
  return { items, candidates, omitted, max };
}

function formatItem(item) {
  const gold = [`\`${item.gold}\``, item.tags.length ? `thẻ: ${item.tags.join(', ')}` : '', item.unsure ? 'không chắc' : '']
    .filter(Boolean)
    .join(' · ');
  const predicted = item.label === null ? 'chưa có' : `\`${item.label}\` (\`${item.ruleId}\`)`;
  return [
    `### ${item.n}. \`${item.id}\``,
    '',
    `> ${item.text}`,
    '',
    `- Nhãn vàng: ${gold}`,
    `- Máy đoán: ${predicted}`,
    `- Ghi chú: ${trimText(item.note) || '—'}`,
    `- Trả lời: \`${item.n} đúng\` hoặc \`${item.n} sai: <nhãn đúng>\``,
    '',
  ].join('\n');
}

export function formatReview(selection, { generatedAt = new Date().toISOString() } = {}) {
  const { items, candidates, omitted, max } = selection;
  const counts = (m) => BUCKETS.map(({ name }, i) => `nhóm ${i + 1}: ${m[name]}`).join(', ');
  const out = [
    '# D0: các câu anh cần xem lại',
    '',
    `Tệp riêng tư, không đưa vào repo. Tạo lúc ${generatedAt}.`,
    `Chọn ${items.length} câu (giới hạn ${max}). Ứng viên: ${counts(candidates)}. Chưa đưa vào: ${counts(omitted)}.`,
    '',
    '## Cách trả lời',
    '',
    'Mỗi dòng một câu, ghi theo số thứ tự, ví dụ:',
    '',
    '- `12 đúng` khi nhãn vàng đúng',
    '- `12 sai: <nhãn đúng>` khi nhãn vàng sai',
    '',
    'Nhãn hợp lệ: `approve_decision` (duyệt, quyết định), `praise` (khen), `confirm` (xác nhận), `flow` (tiếp tục),',
    '`resignation` (cam chịu), `correction` (sửa), `clarify` (hỏi lại cho rõ), `none` (khác). Có thể ghi thêm lý do sau dấu `--`.',
    '',
  ];
  BUCKETS.forEach(({ name }, i) => {
    const inBucket = items.filter((item) => item.bucket === name);
    if (inBucket.length > 0) out.push(`## Nhóm ${i + 1}: ${TITLES[name]}`, '', ...inBucket.map(formatItem));
  });
  return out.join('\n');
}

function main(argv) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { max: { type: 'string', default: '50' } } });
  if (positionals.length !== 4) throw new Error('usage: select-review.mjs <prompts.jsonl> <labels.jsonl> <predictions.jsonl> <out review.md> [--max 50]');
  const out = positionals[3];
  assertOutsideRepo(out);
  const [prompts, labels, predictions] = positionals.slice(0, 3).map(readJsonl);
  const max = /^\d+$/.test(values.max) ? Number(values.max) : NaN;
  const selection = selectReview({ prompts, labels, predictions, max });
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, formatReview(selection));
  console.log(JSON.stringify({ selected: selection.items.length, candidates: selection.candidates, omitted: selection.omitted }));
}

if (invokedDirectly(import.meta.filename)) runMain(main);
