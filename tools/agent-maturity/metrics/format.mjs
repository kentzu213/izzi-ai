// Plain-text form of the report (Vietnamese, decimal comma), for the owner. The JSON form is the full result.

export const num = (x, digits) => (x === null ? 'n/a' : x.toFixed(digits).replace('.', ','));
const pct = (x) => (x === null ? 'n/a' : `${num(x * 100, 1)}%`);
const signed = (x, digits) => (x === null ? 'n/a' : `${x < 0 ? '−' : '+'}${num(Math.abs(x), digits)}`);
const day = (iso) => iso.slice(0, 16).replace('T', ' ');

function strictLine(s) {
  if (s.on) return `Chế độ chặt: bật từ ${day(s.since)}, tự tắt lúc ${day(s.expiresAt)}`;
  if (s.since) return `Chế độ chặt: tắt (hết hạn lúc ${day(s.expiresAt)}, hook ghi strict_off ở lần gõ sau)`;
  return 'Chế độ chặt: tắt';
}

function baselineLines(baseline) {
  if (!baseline) return ['So với baseline D0: chưa có, thêm --baseline <file>'];
  const lines = [`So với baseline D0${baseline.source ? ` (${baseline.source})` : ''}:`];
  for (const c of baseline.comparisons) {
    const label = c.likeForLike ? `${c.instrument} (cùng thước đo)` : `${c.instrument} (khác thước đo, chỉ tham khảo)`;
    const f = c.firstPassRate;
    const k = c.correctionsPer100;
    lines.push(`  ${label}: duyệt ngay lần đầu ${num(f.current, 3)} so với ${num(f.baseline, 3)} (${signed(f.delta, 3)}); `
      + `sửa trên 100 câu ${num(k.current, 1)} so với ${num(k.baseline, 1)} (${signed(k.delta, 1)})`);
  }
  return lines;
}

export function formatReport(r) {
  const c = r.checkpoints;
  const x = r.excluded;
  const lines = [
    `Số đo agent-maturity từ ${day(r.window.since)} đến ${day(r.window.now)} (UTC)`,
    `Log: ${r.log.files} file, ${r.log.events} sự kiện, ${r.log.skippedLines} dòng hỏng đã bỏ qua`,
    `Câu lệnh: ${r.prompts} (không tính: ${x.wrapperPrompts} lệnh wrapper, ${x.nonInteractivePrompts} câu ở phiên không tương tác, ${x.noSession} câu không có phiên)`,
    `Checkpoint: nhắc ${c.nudged.total} (mạnh ${c.nudged.strong}, yếu ${c.nudged.weak}); agent hỏi ${c.asked.total} `
      + `(sau nhắc ${c.asked.afterNudge}, tự hỏi ${c.asked.agentInitiated}); được nhắc mà không hỏi ${c.abstained}`,
    `  Trả lời trên ${c.asked.total} lần hỏi: Nâng cấp ${pct(c.rates.accept)} · Chỉnh ${pct(c.rates.edit)} · `
      + `Bỏ qua ${pct(c.rates.skip)} · Không trả lời ${pct(c.rates.ignored)}`,
    strictLine(r.strict),
    `Báo động mỏi: ${r.fatigue.alarm ? 'CÓ' : 'không'} (${r.fatigue.skippedOrIgnored}/${r.fatigue.window} lần hỏi gần nhất bị bỏ qua `
      + `hoặc không trả lời; báo khi từ ${r.fatigue.trigger} trong ${r.fatigue.size} lần gần nhất)`,
    `Mốc hoàn tất: ${r.milestones}`,
    `Lần sửa: ${r.corrections.total} (sửa ${r.corrections.correction}, xin giải thích lại ${r.corrections.clarify}) = ${num(r.corrections.per100Prompts, 1)} trên 100 câu`,
    `Duyệt ngay lần đầu: ${r.firstPass.passed}/${r.firstPass.milestones} = ${num(r.firstPass.rate, 3)}`,
    `Mở lại sau khi duyệt (ước lượng): ${r.reopened.reopened}/${r.reopened.milestones} = ${num(r.reopened.rate, 3)} `
      + `(có lần sửa trong ${r.reopened.windowPrompts} câu kế tiếp, trước mốc sau; log không có nội dung nên không biết chắc cùng việc)`,
    ...baselineLines(r.baseline),
  ];
  return `${lines.join('\n')}\n`;
}
