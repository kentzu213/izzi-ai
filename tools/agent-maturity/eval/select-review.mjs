// D0: pick the gold labels the owner must check (owner decision 21/11: 30-50 risky items) into a private review.md.
// review.md quotes prompt text, so it must be written outside the repo. stdout prints counts only.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { MILESTONE_LABELS } from '../lib/classify.mjs';
import { criticalReasons, joinRows } from './eval-gold.mjs';
import { assertOutsideRepo, invokedDirectly, readJsonl, runMain } from './io.mjs';

const TEXT_LIMIT = 200;
const KEY_GOLD = new Set(['approve_decision', 'praise', 'resignation']);
const GROUPS = {
  A: 'lỗi nghiêm trọng (máy tính là duyệt/khen nhưng nhãn vàng là cam chịu, câu hỏi, phủ định hoặc hoãn)',
  B: 'máy và nhãn vàng lệch nhau ở trục mốc hoàn tất (duyệt/khen)',
  C: 'nhãn vàng là duyệt, khen hoặc cam chịu',
  D: 'người gắn nhãn không chắc',
};
const zeroCounts = () => Object.fromEntries(Object.keys(GROUPS).map((g) => [g, 0]));

function priorityOf(row) {
  if (criticalReasons(row).length > 0) return 'A';
  if (row.label !== null && MILESTONE_LABELS.has(row.gold) !== MILESTONE_LABELS.has(row.label)) return 'B';
  if (KEY_GOLD.has(row.gold)) return 'C';
  return row.unsure ? 'D' : null;
}

function trimText(text) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > TEXT_LIMIT ? `${flat.slice(0, TEXT_LIMIT)}…` : flat;
}

export function selectReview({ prompts, labels, predictions, max = 50 }) {
  if (!Number.isInteger(max) || max < 1) throw new Error('--max must be a positive integer');
  const { rows } = joinRows(prompts, labels, predictions);
  const textById = new Map(prompts.map((p) => [p.id, p.text]));
  const noteById = new Map(labels.map((l) => [l.id, typeof l.note === 'string' ? l.note : '']));
  const ranked = rows
    .map((r) => ({ row: r, priority: priorityOf(r) }))
    .filter((x) => x.priority !== null)
    .sort((a, b) => (a.priority === b.priority ? (a.row.id < b.row.id ? -1 : a.row.id > b.row.id ? 1 : 0) : a.priority < b.priority ? -1 : 1));
  const candidates = zeroCounts();
  const omitted = zeroCounts();
  ranked.forEach((x, i) => {
    candidates[x.priority] += 1;
    if (i >= max) omitted[x.priority] += 1;
  });
  const items = ranked.slice(0, max).map(({ row, priority }, i) => ({
    n: i + 1,
    id: row.id,
    priority,
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
  const total = Object.values(candidates).reduce((a, b) => a + b, 0);
  const left = Object.entries(omitted).filter(([, v]) => v > 0).map(([g, v]) => `nhóm ${g}: ${v}`);
  const out = [
    '# D0: các câu anh cần xem lại',
    '',
    `Tệp riêng tư, không đưa vào repo. Tạo lúc ${generatedAt}.`,
    `Chọn ${items.length} / ${total} câu ứng viên (giới hạn ${max}).${left.length ? ` Chưa đưa vào: ${left.join(', ')}.` : ''}`,
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
  for (const [group, title] of Object.entries(GROUPS)) {
    const inGroup = items.filter((i) => i.priority === group);
    if (inGroup.length === 0) continue;
    out.push(`## Nhóm ${group}: ${title}`, '', ...inGroup.map(formatItem));
  }
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
