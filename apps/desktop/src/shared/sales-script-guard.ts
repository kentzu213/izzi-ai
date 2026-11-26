/**
 * Fact-Grounded AI Sales Coach contract, prompt builder, and deterministic
 * anti-hallucination guard (`sales-script-guard`). Pure, runtime-agnostic.
 *
 * Security & Commercial Guardrails:
 *  - Zero unmasked PII enters the prompt (`maskCrmPhones` + `redactSensitiveText`).
 *  - Profile layer (`persona`) enters ONLY when `crmProfileLayerAllowed(row)` is true.
 *  - Every numeric price, percentage discount, free-shipping promise, or warranty
 *    duration emitted by the model MUST match an approved `CustomerCareFact`; any
 *    ungrounded promise is deterministically flagged and sanitized so a Saler never
 *    copies a hallucinated commitment to a real customer.
 *  - Every `evidenceQuote` MUST be a verbatim substring of the masked conversation.
 *
 * @module shared/sales-script-guard
 */

import type { CustomerCareCrmRow, CustomerCareFact } from './customer-care-types';
import {
  buildCustomerPortrait,
  buildSalerPlaybook,
  crmProfileLayerAllowed,
  maskCrmPhones,
  type CrmCustomerPortrait,
  type CrmEnterpriseProduct,
} from './customer-crm-enterprise';
import { containsSensitiveMaterial, redactSensitiveText } from './secret-pii-gate';

export type SalesScriptChannel = 'zalo' | 'call' | 'messenger';

export type SalesScriptGuardKind =
  | 'ungrounded_price'
  | 'ungrounded_discount'
  | 'ungrounded_shipping'
  | 'ungrounded_warranty'
  | 'pii_leak';

export interface SalesScriptGuardFinding {
  kind: SalesScriptGuardKind;
  snippet: string;
  reason: string;
}

export interface SalesKnowledgeHint {
  id: string;
  kind: string;
  topicKey: string;
  title: string;
  summary: string;
}

export interface SalesCoachScriptSet {
  zalo: string;
  call: string;
  messenger: string;
}

export interface SalesCoachOutput {
  buyerDiagnosis: string;
  evidenceQuotes: string[];
  objectionStrategy: string;
  scripts: SalesCoachScriptSet;
  nextBestAction: string;
  factGuardPassed: boolean;
  guardFindings: SalesScriptGuardFinding[];
  usedKnowledgeTitles: string[];
  source: 'ai' | 'fallback';
}

export type SalesCoachResult =
  | { ok: true; data: SalesCoachOutput }
  | { ok: false; error: 'auth' | 'forbidden' | 'suppressed' | 'invalid_request' | 'quota' | 'unavailable'; message: string };

export interface SalesCoachPromptPayload {
  systemPrompt: string;
  userPrompt: string;
  maskedCorpus: string;
}

const PRICE_CLAIM_RE =
  /(?<![\p{L}\d])\d+(?:[.,]\d+)*\s*(?:triệu|trieu|tr|k|nghìn|nghin|ngàn|ngan|vnđ|vnd|đ|₫)(?![\p{L}\d])/giu;
const DISCOUNT_CLAIM_RE =
  /(?:giảm|giam|chiết\s*khấu|chiet\s*khau|sale|ưu\s*đãi|uu\s*dai|khuyến\s*mãi|khuyen\s*mai|bớt|bot)(?:\s+(?:ngay|tới|đến|riêng|thêm|lên\s+tới|lên\s+đến)){0,2}\s*\d+(?:[.,]\d+)*\s*(?:%|triệu|trieu|tr|k|nghìn|nghin|ngàn|ngan|vnđ|vnd|đ|₫)(?![\p{L}\d])/giu;
const FREESHIP_CLAIM_RE =
  /(?<![\p{L}\d])(?:freeship|free\s*ship|miễn\s*phí\s*(?:vận\s*chuyển|giao\s*hàng|ship)|mien\s*phi\s*(?:van\s*chuyen|giao\s*hang|ship))(?![\p{L}\d])/giu;
const WARRANTY_CLAIM_RE =
  /(?:bảo\s*hành|bao\s*hanh)\s*(?:lên\s*đến\s*|tới\s*)?(?:\d+\s*(?:năm|nam|tháng|thang|ngày|ngay)|trọn\s*đời|tron\s*doi)(?![\p{L}\d])/giu;
const NON_CURRENCY_PHONE_RE =
  /(?<!\d)(?:\+?84|0)\d(?:[\s._-]{0,2}\d){7,9}(?!\s*(?:đ|₫|vnđ|vnd|triệu|trieu|tr|k|nghìn|nghin|ngàn|ngan))(?![\p{L}\d])/giu;

function foldVi(text: string): string {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePriceToken(raw: string): string {
  return foldVi(raw)
    .replace(/trieu/g, 'tr')
    .replace(/nghin|ngan/g, 'k')
    .replace(/vnd|₫/g, 'd')
    .replace(/\s+/g, '');
}

function extractNormalizedSet(text: string, re: RegExp, normalizer: (s: string) => string): Set<string> {
  const out = new Set<string>();
  const local = new RegExp(re.source, re.flags);
  let m: RegExpExecArray | null;
  while ((m = local.exec(text)) !== null) {
    out.add(normalizer(m[0]));
  }
  return out;
}

/**
 * Deterministic Fact & Promise Guard: verifies every price, discount, free-shipping,
 * and warranty claim in `text` against the shop's merchant-approved `facts`.
 * Ungrounded claims are flagged and replaced with safe placeholders.
 */
export function auditSalesScriptAgainstFacts(
  rawText: string,
  approvedFacts: readonly Pick<CustomerCareFact, 'topic' | 'text'>[],
): { sanitized: string; findings: SalesScriptGuardFinding[] } {
  const findings: SalesScriptGuardFinding[] = [];
  const factsCorpus = approvedFacts.map((f) => f.text).join('\n');
  const foldedFacts = foldVi(factsCorpus);

  const allowedPrices = extractNormalizedSet(factsCorpus, PRICE_CLAIM_RE, normalizePriceToken);
  const allowedDiscounts = extractNormalizedSet(factsCorpus, DISCOUNT_CLAIM_RE, (s) => foldVi(s).replace(/\s+/g, ''));
  const hasFreeshipFact = FREESHIP_CLAIM_RE.test(factsCorpus);
  FREESHIP_CLAIM_RE.lastIndex = 0;
  const allowedWarranties = extractNormalizedSet(factsCorpus, WARRANTY_CLAIM_RE, (s) => foldVi(s).replace(/\s+/g, ''));

  let text = String(rawText ?? '').normalize('NFC').trim();

  // 1. Redact any leaked PII / secrets first (without eating multi-dot VND prices like 15.000.000đ).
  const red = redactSensitiveText(text);
  const maskedAfter = red.text.replace(new RegExp(NON_CURRENCY_PHONE_RE.source, NON_CURRENCY_PHONE_RE.flags), '[SĐT đã ẩn]');
  if (red.redactedCount > 0 || maskedAfter !== red.text) {
    findings.push({
      kind: 'pii_leak',
      snippet: '[REDACTED]',
      reason: 'Đã tự động che thông tin nhạy cảm / SĐT / token trước khi hiển thị.',
    });
    text = maskedAfter;
  }

  // 2. Discounts / Promos (check BEFORE generic price so "giảm 500k" is caught as discount).
  text = text.replace(new RegExp(DISCOUNT_CLAIM_RE.source, DISCOUNT_CLAIM_RE.flags), (match) => {
    const norm = foldVi(match).replace(/\s+/g, '');
    if (allowedDiscounts.has(norm) || foldedFacts.includes(foldVi(match))) return match;
    findings.push({
      kind: 'ungrounded_discount',
      snippet: match,
      reason: 'Ưu đãi/giảm giá chưa có trong Shop Facts đã duyệt — đã thay bằng placeholder an toàn.',
    });
    return '[theo chính sách ưu đãi hiện hành của shop]';
  });

  // 3. Explicit Prices.
  text = text.replace(new RegExp(PRICE_CLAIM_RE.source, PRICE_CLAIM_RE.flags), (match) => {
    const norm = normalizePriceToken(match);
    if (allowedPrices.has(norm)) return match;
    findings.push({
      kind: 'ungrounded_price',
      snippet: match,
      reason: 'Mức giá không khớp với Shop Facts đã duyệt — đã thay bằng placeholder để Saler tự điền.',
    });
    return '[điền giá theo báo giá thật]';
  });

  // 4. Free Shipping promises.
  text = text.replace(new RegExp(FREESHIP_CLAIM_RE.source, FREESHIP_CLAIM_RE.flags), (match) => {
    if (hasFreeshipFact) return match;
    findings.push({
      kind: 'ungrounded_shipping',
      snippet: match,
      reason: 'Chưa có Shop Fact xác nhận miễn phí vận chuyển — đã thay bằng placeholder.',
    });
    return '[chính sách giao hàng theo báo giá shop]';
  });

  // 5. Warranty duration claims.
  text = text.replace(new RegExp(WARRANTY_CLAIM_RE.source, WARRANTY_CLAIM_RE.flags), (match) => {
    const norm = foldVi(match).replace(/\s+/g, '');
    if (allowedWarranties.has(norm) || foldedFacts.includes(foldVi(match))) return match;
    findings.push({
      kind: 'ungrounded_warranty',
      snippet: match,
      reason: 'Thời hạn bảo hành chưa có trong Shop Facts đã duyệt — đã thay bằng placeholder.',
    });
    return '[theo chính sách bảo hành chuẩn của shop]';
  });

  return { sanitized: text, findings };
}

/** Build deterministic zero-latency fallback scripts using existing `buildSalerPlaybook()`. */
export function buildFallbackSalesCoachOutput(
  row: CustomerCareCrmRow,
  portrait: CrmCustomerPortrait,
  products: readonly CrmEnterpriseProduct[],
  vaultPlaybooks: readonly SalesKnowledgeHint[],
  nowMs = Date.now(),
): SalesCoachOutput {
  const pb = buildSalerPlaybook(row, portrait, products, nowMs);
  const sal = portrait.layer_2_demographic.salutation;
  const salLower = sal === 'Anh/Chị' ? 'anh/chị' : sal.toLowerCase();
  const topLesson = vaultPlaybooks[0];
  const lessonNote = topLesson ? ` (Kinh nghiệm Vault: ${topLesson.title})` : '';

  const diagnosisParts: string[] = [];
  if (portrait.layer_4_interests.occasionLabel) diagnosisParts.push(`Dịp: ${portrait.layer_4_interests.occasionLabel}`);
  if (portrait.layer_4_interests.timelineLabel) diagnosisParts.push(`Tiến độ: ${portrait.layer_4_interests.timelineLabel}`);
  if (portrait.layer_5_persona.persona && crmProfileLayerAllowed(row)) {
    diagnosisParts.push(`Chân dung: ${portrait.layer_5_persona.label}`);
  }
  if (portrait.layer_4_interests.matchedProducts.length > 0) {
    diagnosisParts.push(`Quan tâm: ${portrait.layer_4_interests.matchedProducts.map((p) => p.label).slice(0, 2).join(', ')}`);
  }

  const evidenceQuotes = row.recentMessages
    .map((m) => redactSensitiveText(maskCrmPhones(m.text)).text.trim())
    .filter((t) => t.length >= 4)
    .slice(-2)
    .map((t) => (t.length > 80 ? `${t.slice(0, 79)}…` : t));

  return {
    buyerDiagnosis: diagnosisParts.length > 0
      ? diagnosisParts.join(' · ')
      : `Khách ở giai đoạn ${row.profile.stage}, mức ưu tiên ${pb.priorityScore}đ.`,
    evidenceQuotes,
    objectionStrategy: `${pb.objectionHint}${lessonNote}`,
    scripts: {
      zalo: `${pb.opener}\n${pb.discoveryQuestions[0] ?? ''}`.trim(),
      call: `${pb.opener} — Sau đó hỏi: "${pb.discoveryQuestions[0] ?? `Dạ ${salLower} cần giao tầm nào để em tư vấn đúng mẫu ạ?`}"`,
      messenger: pb.opener,
    },
    nextBestAction: pb.suggestedNextStep,
    factGuardPassed: true,
    guardFindings: [],
    usedKnowledgeTitles: vaultPlaybooks.map((k) => k.title),
    source: 'fallback',
  };
}

/** Build a strictly masked, bounded LLM prompt grounded in Shop Facts & Local Vault playbooks. */
export function buildSalesCoachPrompt(input: {
  row: CustomerCareCrmRow;
  portrait: CrmCustomerPortrait;
  approvedFacts: readonly CustomerCareFact[];
  vaultPlaybooks: readonly SalesKnowledgeHint[];
}): SalesCoachPromptPayload {
  const { row, portrait, approvedFacts, vaultPlaybooks } = input;
  const profileAllowed = crmProfileLayerAllowed(row);
  const salutation = portrait.layer_2_demographic.salutation;

  const maskedMessages = row.recentMessages
    .slice(-6)
    .map((m, idx) => {
      const clean = redactSensitiveText(maskCrmPhones(m.text)).text.replace(/\s+/g, ' ').trim().slice(0, 220);
      return `m${idx + 1}: ${clean}`;
    })
    .filter((line) => line.length > 4);

  const factsBlock = approvedFacts.slice(0, 12).map((f) => `- [${f.topic}] ${f.text.slice(0, 220)}`).join('\n');
  const playbooksBlock = vaultPlaybooks
    .slice(0, 5)
    .map((k) => `- [${k.kind}] ${k.title}: ${k.summary}`)
    .join('\n');

  const leadSignals: string[] = [
    `Xưng hô: ${salutation}`,
    `Giai đoạn CRM: ${row.profile.stage}`,
    `Bước chăm sóc: ${row.profile.careStep ?? 'step1_uncalled'}`,
    ...(portrait.layer_4_interests.occasionLabel ? [`Dịp mua (Order Layer): ${portrait.layer_4_interests.occasionLabel}`] : []),
    ...(portrait.layer_4_interests.timelineLabel ? [`Tiến độ cần (Order Layer): ${portrait.layer_4_interests.timelineLabel}`] : []),
    ...(row.profile.neededBy ? [`Mốc ngày cần: ${row.profile.neededBy}`] : []),
    ...(row.profile.lostReason ? [`Lý do từng chưa chốt: ${row.profile.lostReason}`] : []),
    ...(portrait.layer_4_interests.matchedProducts.length > 0
      ? [`Sản phẩm quan tâm: ${portrait.layer_4_interests.matchedProducts.map((p) => p.label).join(', ')}`]
      : []),
    ...(profileAllowed && portrait.layer_5_persona.persona
      ? [`Chân dung đã đồng ý (Profile Layer): ${portrait.layer_5_persona.label}`]
      : ['Chân dung cá nhân: chưa có đồng ý — chỉ tư vấn theo Order Layer, không đoán tuổi/giới tính/gia đình']),
  ];

  const systemPrompt = [
    'Bạn là Huấn luyện viên Bán hàng (Senior Sales Coach) giúp Saler Việt Nam soạn kịch bản chăm sóc khách tinh tế, tự nhiên, đúng nhu cầu.',
    'LUẬT BẮT BUỘC:',
    '1. TUYỆT ĐỐI KHÔNG tự bịa giá tiền, phần trăm giảm giá, freeship, quà tặng hay số năm bảo hành nếu KHÔNG có trong mục SHOP FACTS ĐÃ DUYỆT.',
    '2. Nếu khách hỏi giá/ưu đãi mà Shop Facts chưa ghi cụ thể, hãy viết câu dẫn khéo để Saler báo giá trực tiếp (không điền số giả).',
    '3. Mọi câu thoại phải dùng đúng xưng hô đã cung cấp, tự nhiên như người thật, ngắn gọn (2–4 câu/kênh), tránh giọng robot.',
    '4. Không bao giờ nhắc hoặc lặp lại số điện thoại, thông tin nhạy cảm (bệnh tật, tang lễ, tôn giáo, ly hôn).',
    '5. Chỉ trả về DUY NHẤT một JSON hợp lệ theo schema sau (không giải thích ngoài JSON):',
    '{"buyerDiagnosis":"string <=180","evidenceQuotes":["string <=80 trích nguyên văn từ tin nhắn đã che"],"objectionStrategy":"string <=240","scripts":{"zalo":"string <=420","call":"string <=420","messenger":"string <=360"},"nextBestAction":"string <=140"}',
  ].join('\n');

  const userPrompt = [
    '=== HỒ SƠ ĐƠN HÀNG KHÁCH (ĐÃ CHE PII) ===',
    ...leadSignals,
    '',
    '=== TIN NHẮN GẦN ĐÂY CỦA KHÁCH (ĐÃ CHE PII) ===',
    ...(maskedMessages.length > 0 ? maskedMessages : ['(Chưa có nội dung tin nhắn gần đây)']),
    '',
    '=== SHOP FACTS ĐÃ DUYỆT (NGUỒN CHÂN LÝ CỨNG) ===',
    factsBlock || '(Chưa có Shop Facts — tuyệt đối không nêu giá, % giảm giá, freeship hay số năm bảo hành cụ thể)',
    '',
    '=== KINH NGHIỆM BÁN HÀNG TỪ LOCAL VAULT (ĐÃ LỌC 0% PII) ===',
    playbooksBlock || '(Chưa có kinh nghiệm riêng trong Vault — dùng nguyên tắc tư vấn trung thực, khơi gợi nhu cầu)',
  ].join('\n');

  return {
    systemPrompt,
    userPrompt,
    maskedCorpus: maskedMessages.join('\n'),
  };
}

function ownStr(obj: Record<string, unknown>, key: string, maxLen: number): string {
  if (!Object.hasOwn(obj, key)) return '';
  const v = obj[key];
  if (typeof v !== 'string') return '';
  return v.normalize('NFC').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

/**
 * Parse strict LLM JSON output, validate evidence quotes verbatim against masked history,
 * and apply deterministic `auditSalesScriptAgainstFacts` to every output field.
 */
export function parseSalesCoachModelOutput(input: {
  rawReply: string;
  maskedCorpus: string;
  approvedFacts: readonly CustomerCareFact[];
  vaultPlaybooks: readonly SalesKnowledgeHint[];
}): SalesCoachOutput | null {
  const trimmed = String(input.rawReply ?? '').trim();
  if (!trimmed || trimmed.length > 8_000) return null;

  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const rec = parsed as Record<string, unknown>;
  const scriptsRaw = Object.hasOwn(rec, 'scripts') && rec.scripts && typeof rec.scripts === 'object' && !Array.isArray(rec.scripts)
    ? (rec.scripts as Record<string, unknown>)
    : null;
  if (!scriptsRaw) return null;

  const zaloRaw = ownStr(scriptsRaw, 'zalo', 500);
  const callRaw = ownStr(scriptsRaw, 'call', 500);
  const messengerRaw = ownStr(scriptsRaw, 'messenger', 420);
  if (!zaloRaw || !callRaw || !messengerRaw) return null;

  const diagnosisRaw = ownStr(rec, 'buyerDiagnosis', 220);
  const objectionRaw = ownStr(rec, 'objectionStrategy', 300);
  const nextRaw = ownStr(rec, 'nextBestAction', 180);

  const foldedCorpus = foldVi(input.maskedCorpus);
  const rawQuotes = Object.hasOwn(rec, 'evidenceQuotes') && Array.isArray(rec.evidenceQuotes) ? rec.evidenceQuotes : [];
  const evidenceQuotes: string[] = [];
  for (const q of rawQuotes) {
    if (typeof q !== 'string') continue;
    const cleanQ = redactSensitiveText(maskCrmPhones(q)).text.trim().slice(0, 80);
    if (cleanQ.length >= 4 && foldedCorpus.includes(foldVi(cleanQ))) {
      evidenceQuotes.push(cleanQ);
      if (evidenceQuotes.length >= 2) break;
    }
  }

  const allFindings: SalesScriptGuardFinding[] = [];
  const guardField = (val: string): string => {
    const res = auditSalesScriptAgainstFacts(val, input.approvedFacts);
    allFindings.push(...res.findings);
    return res.sanitized;
  };

  const zalo = guardField(zaloRaw);
  const call = guardField(callRaw);
  const messenger = guardField(messengerRaw);
  const objectionStrategy = guardField(objectionRaw || 'Tư vấn đúng nhu cầu thực tế và gửi ảnh/video kiểm chứng tại xưởng.');
  const buyerDiagnosis = redactSensitiveText(maskCrmPhones(diagnosisRaw || 'Đã tổng hợp theo tín hiệu đơn hàng hiện tại.')).text;
  const nextBestAction = redactSensitiveText(maskCrmPhones(nextRaw || 'Gọi/nhắn Zalo tư vấn theo kịch bản trên.')).text;

  // Final defense-in-depth PII sweep.
  if (containsSensitiveMaterial({ zalo, call, messenger, buyerDiagnosis, objectionStrategy })) {
    allFindings.push({
      kind: 'pii_leak',
      snippet: '[REDACTED]',
      reason: 'Phát hiện dấu hiệu dữ liệu nhạy cảm — đã tự động làm sạch.',
    });
  }

  return {
    buyerDiagnosis,
    evidenceQuotes,
    objectionStrategy,
    scripts: { zalo, call, messenger },
    nextBestAction,
    factGuardPassed: allFindings.length === 0,
    guardFindings: allFindings,
    usedKnowledgeTitles: input.vaultPlaybooks.map((k) => k.title),
    source: 'ai',
  };
}

/** Convenience helper combining portrait + fallback + prompt preparation. */
export function prepareSalesCoachContext(
  row: CustomerCareCrmRow,
  products: readonly CrmEnterpriseProduct[],
  approvedFacts: readonly CustomerCareFact[],
  vaultPlaybooks: readonly SalesKnowledgeHint[],
  identityEnabled: boolean,
  nowMs = Date.now(),
): { portrait: CrmCustomerPortrait; fallback: SalesCoachOutput; prompt: SalesCoachPromptPayload } {
  const portrait = buildCustomerPortrait(row, products, nowMs, { identityEnabled });
  const fallback = buildFallbackSalesCoachOutput(row, portrait, products, vaultPlaybooks, nowMs);
  const prompt = buildSalesCoachPrompt({ row, portrait, approvedFacts, vaultPlaybooks });
  return { portrait, fallback, prompt };
}
