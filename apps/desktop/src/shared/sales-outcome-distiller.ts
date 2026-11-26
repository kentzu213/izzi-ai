/**
 * Anonymized Closed-Loop Sales Outcome Distiller (`sales-outcome-distiller`).
 * Pure TypeScript, runtime-agnostic — extracts 0%-PII recurring sales patterns
 * (`n >= minSampleCount`) from CRM cohort outcomes to feed `KnowledgeStore` (`Hộp duyệt`)
 * → Local Vault → Cloud MyGraph L4–L5.
 *
 * Security Invariants:
 *  - NEVER reads or emits customer names, phones, PSIDs, or raw chat messages.
 *  - Operates strictly on aggregate enum cohorts (`stage`, `lostReason`, `occasion`,
 *    `careStep`, `persona` when consented) + final `containsSensitiveMaterial()` gate.
 *
 * @module shared/sales-outcome-distiller
 */

import type { CustomerCareCrmOccasion, CustomerCareCrmRow } from './customer-care-types';
import {
  buildCustomerPortrait,
  crmProfileLayerAllowed,
  isCrmRowAdsSuppressed,
  type CrmEnterpriseProduct,
} from './customer-crm-enterprise';
import { CRM_STALE_UNCALLED_MS, resolveEffectiveCareStep } from './customer-crm-saler-routing';
import { containsSensitiveMaterial } from './secret-pii-gate';

export interface DistilledSalesLessonCandidate {
  title: string;
  summary: string;
  topicKey: string;
  kind: 'lesson' | 'pitfall' | 'procedure';
  confidence: number;
  sampleCount: number;
}

export interface DistillSalesOptions {
  products?: readonly CrmEnterpriseProduct[];
  identityEnabled?: boolean;
  nowMs?: number;
  minSampleCount?: number;
}

const OCCASION_VN: Readonly<Record<CustomerCareCrmOccasion, string>> = {
  new_home: 'Nhà mới / Nhập trạch',
  tet: 'Dịp Tết',
  anniversary: 'Giỗ / Kỷ niệm',
  gift: 'Quà biếu / Tri ân',
  replacement: 'Thay mới đồ cũ',
  other: 'Dịp khác',
};

const HOUR_MS = 60 * 60 * 1000;
const STALL_CONSULTING_MS = 48 * HOUR_MS;

/**
 * Distill anonymized, recurring operational & sales patterns from a CRM snapshot.
 * Every emitted candidate is strictly 0% PII and backed by an explicit cohort count `n`.
 */
export function distillAnonymizedSalesLessons(
  rows: readonly CustomerCareCrmRow[],
  options: DistillSalesOptions = {},
): DistilledSalesLessonCandidate[] {
  const nowMs = options.nowMs ?? Date.now();
  const minSample = Math.max(2, options.minSampleCount ?? 3);
  const products = options.products ?? [];
  const identityEnabled = Boolean(options.identityEnabled);

  let uncalledOver2h = 0;
  let consultingStale48h = 0;
  let lostPrice = 0;
  let lostNoReply = 0;
  let lostBoughtElsewhere = 0;
  const wonByOccasion = new Map<CustomerCareCrmOccasion, number>();
  const wonByPersona = new Map<string, number>();

  for (const row of rows) {
    if (row.profile.detailsUnreadable === true) continue;
    const { stage, lostReason } = row.profile;
    const step = resolveEffectiveCareStep(row);
    const capturedMs = Date.parse(row.phoneCapturedAt);
    const lastMsgMs = Date.parse(row.lastMessageAt);

    if (
      !isCrmRowAdsSuppressed(row) &&
      stage === 'has_phone' &&
      step === 'step1_uncalled' &&
      Number.isFinite(capturedMs) &&
      nowMs - capturedMs >= CRM_STALE_UNCALLED_MS
    ) {
      uncalledOver2h += 1;
    }

    if (
      !isCrmRowAdsSuppressed(row) &&
      stage === 'consulting' &&
      Number.isFinite(lastMsgMs) &&
      nowMs - lastMsgMs >= STALL_CONSULTING_MS
    ) {
      consultingStale48h += 1;
    }

    if (stage === 'lost') {
      if (lostReason === 'price') lostPrice += 1;
      else if (lostReason === 'no_reply') lostNoReply += 1;
      else if (lostReason === 'bought_elsewhere') lostBoughtElsewhere += 1;
    }

    if (stage === 'deposit' || stage === 'delivered') {
      const portrait = buildCustomerPortrait(row, products, nowMs, { identityEnabled });
      const occ = portrait.layer_4_interests.occasion;
      if (occ) wonByOccasion.set(occ, (wonByOccasion.get(occ) ?? 0) + 1);
      if (crmProfileLayerAllowed(row) && portrait.layer_5_persona.persona) {
        const p = portrait.layer_5_persona.persona;
        wonByPersona.set(p, (wonByPersona.get(p) ?? 0) + 1);
      }
    }
  }

  const rawCandidates: DistilledSalesLessonCandidate[] = [];

  if (uncalledOver2h >= minSample) {
    rawCandidates.push({
      title: `Quy trình SLA gọi lại trong 2 giờ đầu (${uncalledOver2h} khách đang trễ)`,
      summary: `Đo được ${uncalledOver2h} khách đã để lại SĐT quá 2 giờ chưa được gọi ở bước B1. Ưu tiên chia Saler gọi ngay trong 15–30 phút đầu và kết bạn Zalo kèm ảnh thực tế tại xưởng để tránh nguội nhu cầu.`,
      topicKey: 'sales-playbook:sla-first-call-2h',
      kind: 'procedure',
      confidence: 0.92,
      sampleCount: uncalledOver2h,
    });
  }

  if (lostPrice >= minSample) {
    rawCandidates.push({
      title: `Xử lý rào cản giá (${lostPrice} khách chưa chốt vì giá)`,
      summary: `Có ${lostPrice} hồ sơ CRM ghi nhận rớt đơn do lý do giá. Không tự ý giảm giá gây nghi ngờ chất lượng: luôn đặt 2 quy cách cạnh nhau (độ dày chất liệu, hoàn thiện thủ công, bảo hành theo Shop Facts) và gửi video quay thực tế trước khi chốt phương án vừa ngân sách.`,
      topicKey: 'sales-objection:lost-price',
      kind: 'pitfall',
      confidence: 0.9,
      sampleCount: lostPrice,
    });
  }

  if (lostNoReply >= minSample || consultingStale48h >= minSample) {
    const n = lostNoReply + consultingStale48h;
    rawCandidates.push({
      title: `Kịch bản bám đuổi sau 48h không phản hồi (${n} hồ sơ)`,
      summary: `Ghi nhận ${consultingStale48h} khách đang tư vấn im lặng quá 48h và ${lostNoReply} khách rớt do không phản hồi. Chuyển sang nhắn Zalo ngắn gọn gửi 1 video cận cảnh sản phẩm + 1 câu hỏi đóng dễ trả lời (chọn mẫu A hay B), không spam quá 2 lần khi khách chưa hồi âm.`,
      topicKey: 'sales-playbook:followup-48h-no-reply',
      kind: 'procedure',
      confidence: 0.88,
      sampleCount: n,
    });
  }

  if (lostBoughtElsewhere >= minSample) {
    rawCandidates.push({
      title: `Rút kinh nghiệm mất đơn sang đối thủ (${lostBoughtElsewhere} hồ sơ)`,
      summary: `Có ${lostBoughtElsewhere} khách mua nơi khác. Cần rút ngắn thời gian gửi ảnh/video thật tại xưởng và làm rõ điểm khác biệt về chất liệu, tiến độ giao lắp đúng ngày đẹp so với hàng phổ thông.`,
      topicKey: 'sales-objection:lost-competitor',
      kind: 'pitfall',
      confidence: 0.86,
      sampleCount: lostBoughtElsewhere,
    });
  }

  for (const [occ, count] of wonByOccasion.entries()) {
    if (count < minSample) continue;
    rawCandidates.push({
      title: `Nhóm dịp mua chốt tốt: ${OCCASION_VN[occ]} (${count} đơn cọc/giao)`,
      summary: `Ghi nhận ${count} khách đặt cọc/đã giao thuộc dịp ${OCCASION_VN[occ]}. Ưu tiên khai thác sớm mốc ngày cần hàng, kích thước không gian thực tế và đề xuất giữ mẫu để khóa lịch giao đúng hẹn.`,
      topicKey: `sales-lesson:winning-occasion-${occ}`,
      kind: 'lesson',
      confidence: 0.9,
      sampleCount: count,
    });
  }

  for (const [persona, count] of wonByPersona.entries()) {
    if (count < minSample) continue;
    rawCandidates.push({
      title: `Chân dung ${persona} chuyển đổi cao (${count} đơn cọc/giao)`,
      summary: `Chân dung ${persona} (đã xác nhận đồng ý) có ${count} đơn chốt thành công. Ưu tiên áp dụng kịch bản mở lời và góc nội dung Ads bám sát nhóm ${persona}.`,
      topicKey: `sales-lesson:winning-persona-${persona.toLowerCase()}`,
      kind: 'lesson',
      confidence: 0.9,
      sampleCount: count,
    });
  }

  // Final fail-closed PII check (defense-in-depth).
  return rawCandidates.filter(
    (c) => !containsSensitiveMaterial({ title: c.title, summary: c.summary, topicKey: c.topicKey }),
  );
}
