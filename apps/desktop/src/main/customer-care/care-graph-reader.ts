/**
 * Reads the Care nodes back out of the synced MyGraph node list (`graph_nodes` cache) and turns them into
 * the Care block of the AI Marketing Director's prompt. Pure: no network.
 *
 * Graph content is user-editable and comes back through the backend, so every field is re-validated:
 * own properties only, enums checked, counts bounded integers. Unknown keys (the backend merges auto
 * `tags` into metadata) are ignored. A node that fails is dropped, never half-trusted.
 *
 * @module main/customer-care/care-graph-reader
 */
import {
  CUSTOMER_CARE_AUTO_REPLY_PROBLEMS,
  CUSTOMER_CARE_CRM_PERSONAS,
  CUSTOMER_CARE_CRM_STAGES,
  type CustomerCareAutoReplyProblem,
  type CustomerCareCrmPersona,
  type CustomerCareCrmStage,
  type CustomerCareFactTopic,
} from '../../shared/customer-care-types';
import { ISO_PATTERN } from '../marketing/native-marketing-client';
import {
  CARE_GRAPH_SCHEMA,
  CARE_PROBLEM_LABELS,
  CARE_TOPICS,
  CARE_TOPIC_LABELS,
  careWorkspaceKey,
  formatCareGraphTime,
  type CareAutoReplyMode,
  type CareCrmSegmentsMeta,
  type CareFactsMeta,
  type CareGraphKind,
  type CareGraphMeta,
  type CarePageState,
  type CareProcessMeta,
  type CareResultsMeta,
  type CareTopicCounts,
} from './care-graph-digest';

export interface CareGraphView {
  process: CareProcessMeta | null;
  facts: CareFactsMeta | null;
  results: CareResultsMeta | null;
  crmSegments: CareCrmSegmentsMeta | null;
}

/** Results older than this are shown as stale: the Director must not set KPIs from them. */
export const CARE_GRAPH_STALE_MS = 48 * 60 * 60 * 1000;
const MAX_COUNT = 1_000_000;
const PAGE_STATES: readonly CarePageState[] = ['connected', 'needs_reauth', 'not_connected', 'unknown'];
const AUTO_REPLY_MODES: readonly CareAutoReplyMode[] = ['on', 'off', 'unavailable', 'unknown'];

type Fields = Record<string, unknown>;

function record(value: unknown): Fields | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Fields : null;
}

function own(obj: Fields, key: string): unknown {
  return Object.hasOwn(obj, key) ? obj[key] : undefined;
}

function isIso(value: unknown): value is string {
  return typeof value === 'string' && ISO_PATTERN.test(value) && Number.isFinite(Date.parse(value));
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_COUNT;
}

function isOneOf<T extends string>(value: unknown, options: readonly T[]): value is T {
  return typeof value === 'string' && (options as readonly string[]).includes(value);
}

function countOrNull(value: unknown): number | null | undefined {
  if (value === null) return null;
  return isCount(value) ? value : undefined;
}

function isoOrNull(value: unknown): string | null | undefined {
  if (value === null) return null;
  return isIso(value) ? value : undefined;
}

function parseProcess(meta: Fields, wsKey: string): CareProcessMeta | null {
  const page = own(meta, 'page');
  const autoReply = own(meta, 'autoReply');
  const since = isoOrNull(own(meta, 'autoReplySince'));
  const factsUploadedAt = isoOrNull(own(meta, 'factsUploadedAt'));
  const serverFactCount = countOrNull(own(meta, 'serverFactCount'));
  const processVersion = own(meta, 'processVersion');
  if (!isOneOf(page, PAGE_STATES) || !isOneOf(autoReply, AUTO_REPLY_MODES) || since === undefined) return null;
  if (factsUploadedAt === undefined || serverFactCount === undefined) return null;
  if (typeof processVersion !== 'string' || processVersion.length === 0 || processVersion.length > 40) return null;
  return {
    kind: 'care-process', schema: CARE_GRAPH_SCHEMA, wsKey, processVersion, page, autoReply, autoReplySince: since,
    factsUploadedAt, serverFactCount,
  };
}

function parseFacts(meta: Fields, wsKey: string): CareFactsMeta | null {
  const handoffSet = own(meta, 'handoffSet');
  const rawTopics = record(own(meta, 'byTopic'));
  const expired = own(meta, 'expired');
  const rawMissing = own(meta, 'missing');
  if (typeof handoffSet !== 'boolean' || !rawTopics || !isCount(expired)) return null;
  const byTopic = {} as CareTopicCounts;
  for (const topic of CARE_TOPICS) {
    const count = own(rawTopics, topic);
    if (!isCount(count)) return null;
    byTopic[topic] = count;
  }
  if (!Array.isArray(rawMissing) || rawMissing.length > CARE_TOPICS.length) return null;
  if (!rawMissing.every((topic) => isOneOf(topic, CARE_TOPICS))) return null;
  const missing = CARE_TOPICS.filter((topic) => rawMissing.includes(topic)) as CustomerCareFactTopic[];
  return { kind: 'care-facts', schema: CARE_GRAPH_SCHEMA, wsKey, handoffSet, byTopic, expired, missing };
}

function parseResults(meta: Fields, wsKey: string): CareResultsMeta | null {
  const asOf = own(meta, 'asOf');
  const counts = ['sent24h', 'stopped24h', 'leads24h', 'leads7d', 'leadsOpen'].map((key) => countOrNull(own(meta, key)));
  const leadsCapped = own(meta, 'leadsCapped');
  const rawProblem = own(meta, 'lastProblem');
  if (!isIso(asOf) || counts.some((count) => count === undefined) || typeof leadsCapped !== 'boolean') return null;
  if (rawProblem !== null && !isOneOf(rawProblem, CUSTOMER_CARE_AUTO_REPLY_PROBLEMS)) return null;
  const [sent24h, stopped24h, leads24h, leads7d, leadsOpen] = counts as (number | null)[];
  return {
    kind: 'care-results', schema: CARE_GRAPH_SCHEMA, wsKey, asOf, sent24h, stopped24h, leads24h, leads7d, leadsOpen,
    leadsCapped, lastProblem: rawProblem as CustomerCareAutoReplyProblem | null,
  };
}

function parseCrmSegments(meta: Fields, wsKey: string): CareCrmSegmentsMeta | null {
  const asOf = own(meta, 'asOf');
  const totalLeads = own(meta, 'totalLeads');
  const leadsCapped = own(meta, 'leadsCapped');
  const rawStages = record(own(meta, 'byStage'));
  const rawPersonas = record(own(meta, 'byPersona'));
  const rawAds = record(own(meta, 'adsBuckets'));
  const rawLifecycle = record(own(meta, 'lifecycleDue'));
  if (!isIso(asOf) || !isCount(totalLeads) || typeof leadsCapped !== 'boolean') return null;
  if (!rawStages || !rawPersonas || !rawAds || !rawLifecycle) return null;

  const byStage = {} as Record<CustomerCareCrmStage, number>;
  for (const stage of CUSTOMER_CARE_CRM_STAGES) {
    const val = own(rawStages, stage);
    if (!isCount(val)) return null;
    byStage[stage] = val;
  }

  const personaKeys = [...CUSTOMER_CARE_CRM_PERSONAS, 'unclassified'] as const;
  const byPersona = {} as Record<CustomerCareCrmPersona | 'unclassified', number>;
  for (const key of personaKeys) {
    const val = own(rawPersonas, key);
    if (!isCount(val)) return null;
    byPersona[key] = val;
  }

  const highIntent = own(rawAds, 'highIntent');
  const vipLookalike = own(rawAds, 'vipLookalike');
  const reengageLost = own(rawAds, 'reengageLost');
  const consented = own(rawAds, 'consented');
  const suppressed = own(rawAds, 'suppressed');
  if (!isCount(highIntent) || !isCount(vipLookalike) || !isCount(reengageLost) || !isCount(consented) || !isCount(suppressed)) {
    return null;
  }

  const postSale = own(rawLifecycle, 'postSale');
  const remarketing = own(rawLifecycle, 'remarketing');
  if (!isCount(postSale) || !isCount(remarketing)) return null;

  return {
    kind: 'care-crm-segments',
    schema: CARE_GRAPH_SCHEMA,
    wsKey,
    asOf,
    totalLeads,
    leadsCapped,
    byStage,
    byPersona,
    adsBuckets: { highIntent, vipLookalike, reengageLost, consented, suppressed },
    lifecycleDue: { postSale, remarketing },
  };
}

function parseMeta(node: Fields, wsKey: string): CareGraphMeta | null {
  const meta = record(own(node, 'metadata'));
  if (!meta || own(meta, 'schema') !== CARE_GRAPH_SCHEMA || own(meta, 'wsKey') !== wsKey) return null;
  switch (own(meta, 'kind')) {
    case 'care-process': return parseProcess(meta, wsKey);
    case 'care-facts': return parseFacts(meta, wsKey);
    case 'care-results': return parseResults(meta, wsKey);
    case 'care-crm-segments': return parseCrmSegments(meta, wsKey);
    default: return null;
  }
}

/**
 * The workspace's Care view from the cached node list, or null when it has no valid Care node. When a kind
 * appears more than once (an old duplicate), the most recently updated node wins.
 */
export function readCareGraph(cachedNodes: unknown, wsKey: string): CareGraphView | null {
  if (!Array.isArray(cachedNodes)) return null;
  const best = new Map<CareGraphKind, { meta: CareGraphMeta; updatedMs: number }>();
  for (const raw of cachedNodes) {
    const node = record(raw);
    if (!node) continue;
    const meta = parseMeta(node, wsKey);
    if (!meta) continue;
    const updated = own(node, 'updatedAt');
    const updatedMs = typeof updated === 'string' && Number.isFinite(Date.parse(updated)) ? Date.parse(updated) : 0;
    const current = best.get(meta.kind);
    if (!current || updatedMs > current.updatedMs) best.set(meta.kind, { meta, updatedMs });
  }
  if (best.size === 0) return null;
  return {
    process: (best.get('care-process')?.meta as CareProcessMeta | undefined) ?? null,
    facts: (best.get('care-facts')?.meta as CareFactsMeta | undefined) ?? null,
    results: (best.get('care-results')?.meta as CareResultsMeta | undefined) ?? null,
    crmSegments: (best.get('care-crm-segments')?.meta as CareCrmSegmentsMeta | undefined) ?? null,
  };
}

const AUTO_REPLY_TEXT: Record<CareAutoReplyMode, string> = {
  on: 'đang bật',
  off: 'đang tắt',
  unavailable: 'máy chủ chưa mở tính năng',
  unknown: 'chưa rõ',
};
const PAGE_TEXT: Record<CarePageState, string> = {
  connected: 'đã kết nối',
  needs_reauth: 'cần kết nối lại',
  not_connected: 'chưa kết nối',
  unknown: 'chưa rõ',
};

function topicList(topics: readonly CustomerCareFactTopic[]): string {
  return topics.map((topic) => CARE_TOPIC_LABELS[topic]).join(', ');
}

function processLine(process: CareProcessMeta): string {
  const switchText = process.autoReply === 'on' && process.autoReplySince
    ? `đang bật từ ${formatCareGraphTime(process.autoReplySince)}`
    : AUTO_REPLY_TEXT[process.autoReply];
  return `- Tự trả lời khách: ${switchText}; Page ${PAGE_TEXT[process.page]}.`;
}

function factsLine(facts: CareFactsMeta): string {
  const counts = CARE_TOPICS.map((topic) => `${CARE_TOPIC_LABELS[topic]} ${facts.byTopic[topic]}`).join(', ');
  const missing = facts.missing.length > 0 ? `; còn thiếu: ${topicList(facts.missing)}` : '; đủ cả 5 chủ đề';
  return `- Thông tin đã duyệt: ${counts}${missing}; bàn giao nhân viên ${facts.handoffSet ? 'đã cài' : 'chưa cài'}.`;
}

function count(value: number, capped: boolean): string {
  return capped ? `${value}+` : String(value);
}

function resultsLine(results: CareResultsMeta): string {
  const replies = results.sent24h === null || results.stopped24h === null
    ? '24 giờ qua: chưa đọc được số tin izzi gửi.'
    : `24 giờ qua: izzi gửi ${results.sent24h} tin, dừng với ${results.stopped24h} khách.`;
  const leads = results.leads7d === null || results.leadsOpen === null
    ? '7 ngày qua: chưa đọc được số khách để lại số.'
    : `7 ngày qua: ${count(results.leads7d, results.leadsCapped)} khách để lại số, `
      + `${count(results.leadsOpen, results.leadsCapped)} khách chưa được gọi lại.`;
  return `- ${replies} ${leads}`;
}

const PERSONA_DIRECTOR_ANGLES: Record<CustomerCareCrmPersona, string> = {
  P1: 'P1 (Gia chủ nhà mới / Sắm chính — ưu tiên nội dung chuẩn thước Lỗ Ban, phối cảnh phòng thờ chung cư/nhà phố)',
  P2: 'P2 (Gia đình truyền thống / Lễ Tết — ưu tiên nội dung hiếu kính gia tiên, chất liệu bền đẹp đón Tết/giỗ chạp)',
  P3: 'P3 (Quà biếu / Tri ân — ưu tiên nội dung hộp quà trang trọng, giao đúng ngày mừng tân gia/tri ân)',
  P4: 'P4 (Khảo giá / Ngân sách — ưu tiên nội dung minh bạch phân khúc giá tại xưởng, so sánh chất liệu thực tế)',
};

function dominantPersona(byPersona: Record<CustomerCareCrmPersona | 'unclassified', number>): CustomerCareCrmPersona | null {
  let top: CustomerCareCrmPersona | null = null;
  let bestCount = 0;
  for (const persona of CUSTOMER_CARE_CRM_PERSONAS) {
    if (byPersona[persona] > bestCount) {
      bestCount = byPersona[persona];
      top = persona;
    }
  }
  return top;
}

function crmSegmentsLine(seg: CareCrmSegmentsMeta): string {
  const cap = seg.leadsCapped;
  return `- Phân khúc CRM (${count(seg.totalLeads, cap)} khách, cập nhật ${formatCareGraphTime(seg.asOf)}): `
    + `Có số ${seg.byStage.has_phone}, Đang tư vấn ${seg.byStage.consulting}, `
    + `Đã cọc ${seg.byStage.deposit}, Đã giao ${seg.byStage.delivered}; `
    + `Chân dung P1 ${seg.byPersona.P1}, P2 ${seg.byPersona.P2}, P3 ${seg.byPersona.P3}, P4 ${seg.byPersona.P4}; `
    + `Tệp Ads khách ấm ${seg.adsBuckets.highIntent}, hạt giống Lookalike ${seg.adsBuckets.vipLookalike}, `
    + `đồng ý nhận tin ${seg.adsBuckets.consented}; `
    + `Lịch Hậu mãi ${seg.lifecycleDue.postSale}, Remarketing ${seg.lifecycleDue.remarketing}.`;
}

function guidance(view: CareGraphView, fresh: boolean, crmFresh: boolean): string[] {
  const lines = ['Cách dùng khối Chăm sóc khách:'];
  if (view.process?.autoReply === 'on' && fresh) {
    lines.push('- Tự trả lời đang bật: được dùng CTA "Nhắn tin Page để được tư vấn"; '
      + 'KPI tuần có "số khách để lại số qua Messenger".');
  } else if (view.process?.autoReply === 'on') {
    lines.push('- Chưa có số liệu mới để xác nhận tự trả lời còn chạy: không hứa khách sẽ được trả lời ngay trên '
      + 'Messenger cho tới khi chủ shop kiểm tra lại.');
  } else if (view.process) {
    lines.push('- Tự trả lời đang không bật: không hứa khách sẽ được trả lời ngay trên Messenger.');
  }
  if (view.facts && view.facts.missing.length > 0) {
    lines.push('- Trong mục "Cần khách hàng duyệt", thêm việc bổ sung thông tin đã duyệt về: '
      + `${topicList(view.facts.missing)} (khách hỏi các chủ đề này phải chờ nhân viên).`);
  }
  const problem = view.results?.lastProblem;
  if (problem === 'standby' || problem === 'other_app') {
    lines.push('- Đề xuất chủ shop chỉnh Phân luồng hội thoại của Page (ứng dụng khác như Pancake đang giữ '
      + 'hội thoại) để izzi trả lời được.');
  }
  if (crmFresh && view.crmSegments) {
    const seg = view.crmSegments;
    const topPersona = dominantPersona(seg.byPersona);
    if (topPersona) {
      lines.push(`- Góc nội dung Ads ưu tiên theo nhóm chân dung CRM chiếm đa số: ${PERSONA_DIRECTOR_ANGLES[topPersona]}.`);
    }
    if (seg.adsBuckets.highIntent > 0 || seg.adsBuckets.vipLookalike > 0) {
      lines.push(`- Khai thác tệp CRM cho Ads: bám đuổi ${seg.adsBuckets.highIntent} khách ấm đang cân nhắc, `
        + `dùng ${seg.adsBuckets.vipLookalike} khách Đã cọc/Đã giao làm hạt giống Lookalike 1%–3% (chỉ xuất tệp từ `
        + `${seg.adsBuckets.consented} khách đã đồng ý marketing và luôn loại trừ ${seg.adsBuckets.suppressed} khách đã chặn).`);
    }
    if (seg.lifecycleDue.postSale > 0 || seg.lifecycleDue.remarketing > 0) {
      lines.push(`- Nhắc đội Sale/CSKH xử lý ${seg.lifecycleDue.postSale} lịch Hậu mãi (N+1/N+7/N+30) và `
        + `${seg.lifecycleDue.remarketing} lịch Remarketing khách chưa chốt (tuân thủ khung 24h Messenger hoặc gọi/Zalo).`);
    }
  }
  lines.push('- Khối này là số liệu vận hành, không phải proof claim: không dùng nó để khẳng định điều gì về sản phẩm.');
  return lines;
}

/**
 * The Director's Care block for an account's workspace, from the cached node list; empty when there is
 * none. A list still cached for another account never matches, because the key includes the account.
 */
export function careDirectorContextFromCache(
  cachedNodes: unknown,
  scope: { identityId: string; workspaceId: string },
  nowMs: number,
): string[] {
  const view = readCareGraph(cachedNodes, careWorkspaceKey(scope.identityId, scope.workspaceId));
  return view ? careDirectorContext(view, nowMs) : [];
}

/** The Care block of the Director prompt; empty when the graph holds nothing for the workspace. */
export function careDirectorContext(view: CareGraphView, nowMs: number): string[] {
  const asOf = view.results?.asOf ?? null;
  const stale = asOf !== null && nowMs - Date.parse(asOf) > CARE_GRAPH_STALE_MS;
  const fresh = asOf !== null && !stale;
  const crmFresh = view.crmSegments !== null && nowMs - Date.parse(view.crmSegments.asOf) <= CARE_GRAPH_STALE_MS;
  const when = asOf ? `cập nhật ${formatCareGraphTime(asOf)}` : 'chưa có số liệu kết quả';
  const header = `Chăm sóc khách trên Facebook Page (từ MyGraph, ${when}`
    + `${stale ? '; số liệu đã cũ hơn 48 giờ, không đặt KPI theo các số này' : ''}):`;
  const lines = [header];
  if (view.process) lines.push(processLine(view.process));
  if (view.facts) lines.push(factsLine(view.facts));
  if (view.results) {
    lines.push(resultsLine(view.results));
    if (view.results.lastProblem) {
      lines.push(`- Lần gần nhất izzi không gửi được: ${CARE_PROBLEM_LABELS[view.results.lastProblem]}.`);
    }
  }
  if (crmFresh && view.crmSegments) {
    lines.push(crmSegmentsLine(view.crmSegments));
  }
  return [...lines, ...guidance(view, fresh, crmFresh)];
}
