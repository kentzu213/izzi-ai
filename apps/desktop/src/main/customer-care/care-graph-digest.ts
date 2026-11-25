/**
 * Care → MyGraph digest (design: docs/CARE-GRAPH-AGENTS.md). Pure: no network, no Electron.
 *
 * Builds the three per-workspace Care nodes izzi agents read from the personal graph. The input type
 * holds only counts, fixed codes, topic names, times and the Page's public name, so customer messages,
 * PSIDs, names, phones and Zalo cannot reach a node by construction. The Page name is scrubbed of long
 * digit runs, and the account + workspace are named by a letters-only hash, never by their ids.
 *
 * Each node has one source, so two devices of one account never overwrite each other with less:
 * process = server state (Page, switch); facts = this machine's saved setup (built only when there is
 * one); results = server counts + this machine's fresh lead check (built only when there is one).
 *
 * @module main/customer-care/care-graph-digest
 */
import { createHash } from 'node:crypto';
import type {
  CustomerCareAutoReplyProblem,
  CustomerCareAutoReplyState,
  CustomerCareCrmPersona,
  CustomerCareCrmStage,
  CustomerCareFact,
  CustomerCareFactTopic,
  CustomerCareLead,
  CustomerCarePageConnection,
} from '../../shared/customer-care-types';
import type { CareCrmSegmentSummary } from '../../shared/customer-crm-enterprise';

export type { CareCrmSegmentSummary };

export const CARE_GRAPH_SCHEMA = 1;
export const CARE_PROCESS_VERSION = 'phase-c-1';
/** Same muted accent as the agent hub nodes. */
export const CARE_GRAPH_COLOR = '#5B8AA6';
export const CARE_GRAPH_KINDS = ['care-process', 'care-facts', 'care-results', 'care-crm-segments'] as const;
export type CareGraphKind = (typeof CARE_GRAPH_KINDS)[number];
export const CARE_TOPICS: readonly CustomerCareFactTopic[] = ['catalog', 'price', 'quality', 'policy', 'contact'];
export const CARE_TOPIC_LABELS: Record<CustomerCareFactTopic, string> = {
  catalog: 'Danh mục',
  price: 'Giá',
  quality: 'Chất lượng',
  policy: 'Chính sách',
  contact: 'Liên hệ',
};
/** Short labels for the last reply izzi did not send; agents get the code, people get the label. */
export const CARE_PROBLEM_LABELS: Record<CustomerCareAutoReplyProblem, string> = {
  standby: 'ứng dụng khác (ví dụ Pancake) đang điều khiển hội thoại',
  outside_window: 'khách nhắn đã quá 23 giờ',
  page_limit: 'Page chạm giới hạn 60 tin tự động mỗi giờ',
  declined: 'khách từ chối để lại liên hệ',
  other_app: 'ứng dụng khác hoặc nhân viên đã trả lời',
  recipient_not_allowed: 'Facebook chỉ cho gửi tới tài khoản có vai trò trên ứng dụng (chờ App Review)',
  recipient_unavailable: 'khách không nhận được tin',
  token_invalid: 'Page cần kết nối lại',
  token_unreadable: 'Page cần kết nối lại',
  permission_missing: 'Page chưa cấp quyền gửi tin',
  rate_limited: 'Facebook đang giới hạn tốc độ gửi',
  invalid_script: 'máy chủ không đọc được thông tin đã duyệt',
  message_unreadable: 'máy chủ không đọc được tin của khách',
  switched_off: 'trả lời tự động vừa được tắt',
  unknown: 'lần gửi gần nhất không thành công',
};

const GRAPH_URL = 'https://izziapi.com/aibase/graph';
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const VN_OFFSET_MS = 7 * HOUR_MS;
const MAX_PAGE_NAME = 80;
/** 8 or more digits, also when split by spaces, dots or dashes (phone numbers, PSIDs). */
const LONG_DIGIT_RUN = /\d(?:[\s.-]*\d){7,}/g;

export type CareTopicCounts = Record<CustomerCareFactTopic, number>;
export interface CareFactCoverage {
  byTopic: CareTopicCounts;
  expired: number;
}
/** The saved setup as the graph may know it: fact counts and whether a handoff target is set. */
export interface CareSetupCoverage extends CareFactCoverage {
  handoffSet: boolean;
}
export interface CareLeadSummary {
  last24h: number;
  last7d: number;
  /** Leads still `new`, i.e. not called back yet. */
  open: number;
  /** The first lead page was full: every count is a lower bound. */
  capped: boolean;
}
export type CarePageState = 'connected' | 'needs_reauth' | 'not_connected' | 'unknown';
export type CareAutoReplyMode = 'on' | 'off' | 'unavailable' | 'unknown';

/** Everything the graph may learn about one workspace's Care. Counts, codes, times and the Page name only. */
export interface CareGraphSource {
  pageName: string | null;
  page: CarePageState;
  /** null: no Care setup saved on this machine for this account and workspace (no facts node). */
  facts: CareSetupCoverage | null;
  /** null: no live Page binding, or no automatic-reply backend. */
  autoReply: CustomerCareAutoReplyState | null;
  /** null: no fresh lead check (inbox off, not checked yet): no results node. */
  leads: CareLeadSummary | null;
  /** Optional aggregated CRM segment counts (zero PII); absent/null omits the `care-crm-segments` node. */
  crmSegments?: CareCrmSegmentSummary | null;
}

/** What main reads for the signed-in account's active workspace; leads are added by the publisher. */
export interface CareGraphSnapshot {
  identityId: string;
  workspaceId: string;
  source: Omit<CareGraphSource, 'leads'>;
}

export interface CareProcessMeta {
  kind: 'care-process';
  schema: 1;
  wsKey: string;
  processVersion: string;
  page: CarePageState;
  autoReply: CareAutoReplyMode;
  autoReplySince: string | null;
  /** When the facts the server answers with were last uploaded, and how many there are (server state). */
  factsUploadedAt: string | null;
  serverFactCount: number | null;
}
export interface CareFactsMeta {
  kind: 'care-facts';
  schema: 1;
  wsKey: string;
  handoffSet: boolean;
  byTopic: CareTopicCounts;
  expired: number;
  missing: CustomerCareFactTopic[];
}
export interface CareResultsMeta {
  kind: 'care-results';
  schema: 1;
  wsKey: string;
  asOf: string;
  sent24h: number | null;
  stopped24h: number | null;
  leads24h: number | null;
  leads7d: number | null;
  leadsOpen: number | null;
  leadsCapped: boolean;
  lastProblem: CustomerCareAutoReplyProblem | null;
}
export interface CareCrmSegmentsMeta {
  kind: 'care-crm-segments';
  schema: 1;
  wsKey: string;
  asOf: string;
  totalLeads: number;
  leadsCapped: boolean;
  byStage: Record<CustomerCareCrmStage, number>;
  byPersona: Record<CustomerCareCrmPersona | 'unclassified', number>;
  adsBuckets: {
    highIntent: number;
    vipLookalike: number;
    reengageLost: number;
    consented: number;
    suppressed: number;
  };
  lifecycleDue: {
    postSale: number;
    remarketing: number;
  };
}
export type CareGraphMeta = CareProcessMeta | CareFactsMeta | CareResultsMeta | CareCrmSegmentsMeta;

export interface CareGraphNodeDraft {
  kind: CareGraphKind;
  title: string;
  content: string;
  url: string;
  color: string;
  nodeType: 'note';
  metadata: CareGraphMeta;
  /** Changes only when what the node says changes; the refresh time of the results node is left out. */
  fingerprint: string;
}

/** Hex digest → letters a-p, so keys and fingerprints never carry digit runs. */
function lettersHash(value: string, length: number): string {
  const hex = createHash('sha256').update(value, 'utf8').digest('hex').slice(0, length);
  return Array.from(hex, (char) => String.fromCharCode(97 + parseInt(char, 16))).join('');
}

/**
 * Names an account's workspace inside the graph without either id. The account is part of the key, so a
 * node list still cached for another account never matches.
 */
export function careWorkspaceKey(identityId: string, workspaceId: string): string {
  return lettersHash(JSON.stringify(['care-graph.v1', identityId, workspaceId]), 16);
}

export function countCareFacts(
  facts: readonly Pick<CustomerCareFact, 'topic' | 'expiresAt'>[],
  nowMs: number,
): CareFactCoverage {
  const byTopic: CareTopicCounts = { catalog: 0, price: 0, quality: 0, policy: 0, contact: 0 };
  let expired = 0;
  for (const fact of facts) {
    if (fact.expiresAt !== undefined && Date.parse(fact.expiresAt) <= nowMs) {
      expired += 1;
    } else if (Object.hasOwn(byTopic, fact.topic)) {
      byTopic[fact.topic] += 1;
    }
  }
  return { byTopic, expired };
}

/** Counts only: the phone, name and messages of each lead are never read here. */
export function summarizeCareLeads(
  leads: readonly Pick<CustomerCareLead, 'phoneCapturedAt' | 'status'>[],
  nowMs: number,
  capped: boolean,
): CareLeadSummary {
  let last24h = 0;
  let last7d = 0;
  let open = 0;
  for (const lead of leads) {
    if (lead.status === 'new') open += 1;
    const capturedMs = Date.parse(lead.phoneCapturedAt);
    if (!Number.isFinite(capturedMs)) continue;
    if (capturedMs > nowMs - DAY_MS) last24h += 1;
    if (capturedMs > nowMs - 7 * DAY_MS) last7d += 1;
  }
  return { last24h, last7d, open, capped };
}

/** The Page name as the graph may show it: long digit runs removed, bounded, null when empty. */
export function scrubCareGraphText(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(LONG_DIGIT_RUN, '[số]').replace(/\s+/g, ' ').trim().slice(0, MAX_PAGE_NAME);
  return text.length > 0 ? text : null;
}

/** Vietnam time (UTC+7, no daylight saving) as dd/MM/yyyy HH:mm. */
export function formatCareGraphTime(isoTime: string): string {
  const shifted = new Date(Date.parse(isoTime) + VN_OFFSET_MS);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(shifted.getUTCDate())}/${pad(shifted.getUTCMonth() + 1)}/${shifted.getUTCFullYear()} `
    + `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`;
}

/** A Page connection as the graph names it; a status that could not be read is `unknown`. */
export function carePageState(connection: CustomerCarePageConnection): CarePageState {
  switch (connection.state) {
    case 'connected': return connection.status === 'active' ? 'connected' : 'needs_reauth';
    case 'not_connected': return 'not_connected';
    default: return 'unknown';
  }
}

export function careAutoReplyMode(state: CustomerCareAutoReplyState | null): CareAutoReplyMode {
  if (!state) return 'unknown';
  if (!state.available) return 'unavailable';
  return state.enabled ? 'on' : 'off';
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

function countText(value: number | null, capped = false): string {
  if (value === null) return 'chưa rõ';
  return capped ? `${value}+` : String(value);
}

/** The stable address of one Care node; the publisher finds the node in the graph by it. */
export function careNodeUrl(kind: CareGraphKind, wsKey: string): string {
  return `${GRAPH_URL}?care=${kind}&ws=${wsKey}`;
}

function draft(
  kind: CareGraphKind,
  title: string,
  stableContent: string,
  metadata: CareGraphMeta,
  wsKey: string,
  extraContent = '',
): CareGraphNodeDraft {
  const stableMeta: Record<string, unknown> = { ...metadata };
  delete stableMeta.asOf;
  return {
    kind,
    title,
    content: extraContent ? `${stableContent}\n${extraContent}` : stableContent,
    url: careNodeUrl(kind, wsKey),
    color: CARE_GRAPH_COLOR,
    nodeType: 'note',
    metadata,
    fingerprint: lettersHash(JSON.stringify([title, stableContent, stableMeta]), 32),
  };
}

function processNode(source: CareGraphSource, wsKey: string): CareGraphNodeDraft {
  const mode = careAutoReplyMode(source.autoReply);
  const since = mode === 'on' ? source.autoReply?.enabledAt ?? null : null;
  const pageName = scrubCareGraphText(source.pageName);
  const metadata: CareProcessMeta = {
    kind: 'care-process',
    schema: CARE_GRAPH_SCHEMA,
    wsKey,
    processVersion: CARE_PROCESS_VERSION,
    page: source.page,
    autoReply: mode,
    autoReplySince: since,
    factsUploadedAt: source.autoReply?.scriptUpdatedAt ?? null,
    serverFactCount: source.autoReply?.factCount ?? null,
  };
  const switchText = since ? `${AUTO_REPLY_TEXT[mode]} từ ${formatCareGraphTime(since)}` : AUTO_REPLY_TEXT[mode];
  const uploaded = metadata.factsUploadedAt && metadata.serverFactCount !== null
    ? `Máy chủ đang trả lời bằng ${metadata.serverFactCount} thông tin đã duyệt, `
      + `gửi lên lúc ${formatCareGraphTime(metadata.factsUploadedAt)}.`
    : 'Máy chủ chưa nhận thông tin đã duyệt nào.';
  const content = [
    `Quy trình chăm sóc khách trên Facebook Page${pageName ? ` "${pageName}"` : ''} (izzi tự trả lời).`,
    `Trạng thái: tự trả lời ${switchText} · Page ${PAGE_TEXT[source.page]}.`,
    uploaded,
    '',
    '1. Khách nhắn Page: izzi trả lời bằng câu cố định và thông tin shop đã duyệt, rồi xin SĐT/Zalo.',
    '2. Mỗi khách nhận tối đa 3 tin tự động trong 24 giờ, chỉ khi tin cuối của khách chưa quá 23 giờ.',
    '3. izzi dừng khi khách để số (sau một tin chốt), khi khách từ chối, hoặc khi nhân viên/ứng dụng khác trả lời.',
    '4. Câu hỏi chưa có thông tin đã duyệt: izzi hẹn nhân viên báo lại.',
    '5. Khách để số: hiện trong "Khách để lại số" để nhân viên gọi lại.',
  ].join('\n');
  return draft('care-process', 'Chăm sóc khách · Quy trình', content, metadata, wsKey);
}

function factsNode(coverage: CareSetupCoverage, wsKey: string): CareGraphNodeDraft {
  const byTopic: CareTopicCounts = { ...coverage.byTopic };
  const missing = CARE_TOPICS.filter((topic) => byTopic[topic] === 0);
  const metadata: CareFactsMeta = {
    kind: 'care-facts',
    schema: CARE_GRAPH_SCHEMA,
    wsKey,
    handoffSet: coverage.handoffSet,
    byTopic,
    expired: coverage.expired,
    missing,
  };
  const lines = [
    'Thông tin shop đã duyệt để izzi trả lời khách (chỉ số lượng, không chép nội dung).',
    `${CARE_TOPICS.map((topic) => `${CARE_TOPIC_LABELS[topic]} ${byTopic[topic]}`).join(' · ')}.`,
    `Đã hết hạn: ${coverage.expired}.`,
    missing.length > 0
      ? `Còn thiếu: ${missing.map((topic) => CARE_TOPIC_LABELS[topic]).join(', ')}.`
      : 'Đủ cả 5 chủ đề.',
    `Bàn giao nhân viên: ${coverage.handoffSet ? 'đã cài' : 'chưa cài'}.`,
  ];
  return draft('care-facts', 'Chăm sóc khách · Thông tin đã duyệt', lines.join('\n'), metadata, wsKey);
}

function resultsNode(
  source: CareGraphSource,
  leads: CareLeadSummary,
  wsKey: string,
  asOf: string,
): CareGraphNodeDraft {
  const state = source.autoReply;
  const metadata: CareResultsMeta = {
    kind: 'care-results',
    schema: CARE_GRAPH_SCHEMA,
    wsKey,
    asOf,
    sent24h: state?.sentLast24h ?? null,
    stopped24h: state?.stoppedLast24h ?? null,
    leads24h: leads.last24h,
    leads7d: leads.last7d,
    leadsOpen: leads.open,
    leadsCapped: leads.capped,
    lastProblem: state?.lastProblem?.reason ?? null,
  };
  const capped = metadata.leadsCapped;
  const lines = [
    'Kết quả chăm sóc khách (chỉ số đếm).',
    `24 giờ qua: izzi gửi ${countText(metadata.sent24h)} tin, dừng với ${countText(metadata.stopped24h)} khách.`,
    `7 ngày qua: ${countText(metadata.leads7d, capped)} khách để lại số `
      + `(24 giờ qua: ${countText(metadata.leads24h, capped)}); `
      + `${countText(metadata.leadsOpen, capped)} khách chưa được gọi lại.`,
  ];
  if (metadata.lastProblem) {
    lines.push(`Lần gần nhất izzi không gửi được: ${CARE_PROBLEM_LABELS[metadata.lastProblem]}.`);
  }
  return draft(
    'care-results',
    'Chăm sóc khách · Kết quả',
    lines.join('\n'),
    metadata,
    wsKey,
    `Cập nhật: ${formatCareGraphTime(asOf)}.`,
  );
}

function safeSegmentCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  // Bounded strictly below 8 digits (<= 9,999,999) so serialized nodes never carry an 8-digit run.
  return Math.max(0, Math.min(9_999_999, Math.trunc(value)));
}

function crmSegmentsNode(
  segments: CareCrmSegmentSummary,
  wsKey: string,
  asOf: string,
): CareGraphNodeDraft {
  const byStage: Record<CustomerCareCrmStage, number> = {
    has_phone: safeSegmentCount(segments.byStage.has_phone),
    consulting: safeSegmentCount(segments.byStage.consulting),
    deposit: safeSegmentCount(segments.byStage.deposit),
    delivered: safeSegmentCount(segments.byStage.delivered),
    lost: safeSegmentCount(segments.byStage.lost),
    do_not_contact: safeSegmentCount(segments.byStage.do_not_contact),
  };
  const byPersona: Record<CustomerCareCrmPersona | 'unclassified', number> = {
    P1: safeSegmentCount(segments.byPersona.P1),
    P2: safeSegmentCount(segments.byPersona.P2),
    P3: safeSegmentCount(segments.byPersona.P3),
    P4: safeSegmentCount(segments.byPersona.P4),
    unclassified: safeSegmentCount(segments.byPersona.unclassified),
  };
  const adsBuckets = {
    highIntent: safeSegmentCount(segments.adsBuckets.highIntent),
    vipLookalike: safeSegmentCount(segments.adsBuckets.vipLookalike),
    reengageLost: safeSegmentCount(segments.adsBuckets.reengageLost),
    consented: safeSegmentCount(segments.adsBuckets.consented),
    suppressed: safeSegmentCount(segments.adsBuckets.suppressed),
  };
  const lifecycleDue = {
    postSale: safeSegmentCount(segments.lifecycleDue.postSale),
    remarketing: safeSegmentCount(segments.lifecycleDue.remarketing),
  };
  const metadata: CareCrmSegmentsMeta = {
    kind: 'care-crm-segments',
    schema: CARE_GRAPH_SCHEMA,
    wsKey,
    asOf,
    totalLeads: safeSegmentCount(segments.totalLeads),
    leadsCapped: Boolean(segments.leadsCapped),
    byStage,
    byPersona,
    adsBuckets,
    lifecycleDue,
  };
  const lines = [
    'Phân khúc khách hàng CRM (chỉ số đếm tổng hợp, không lưu thông tin cá nhân).',
    `Tổng số khách phân tích: ${countText(metadata.totalLeads, metadata.leadsCapped)} khách.`,
    `Theo giai đoạn: Có số ${byStage.has_phone} · Đang tư vấn ${byStage.consulting} · Đã cọc ${byStage.deposit} `
      + `· Đã giao ${byStage.delivered} · Không mua ${byStage.lost} · Không liên hệ ${byStage.do_not_contact}.`,
    `Chân dung: P1 (Gia chủ nhà mới) ${byPersona.P1} · P2 (Lễ Tết & Gia đình) ${byPersona.P2} `
      + `· P3 (Quà biếu) ${byPersona.P3} · P4 (Khảo giá) ${byPersona.P4} · Chưa phân loại ${byPersona.unclassified}.`,
    `Tệp Ads: Khách ấm ${adsBuckets.highIntent} · Hạt giống Lookalike ${adsBuckets.vipLookalike} `
      + `· Đánh thức lại ${adsBuckets.reengageLost} · Đã đồng ý marketing ${adsBuckets.consented} `
      + `· Đã chặn ${adsBuckets.suppressed}.`,
    `Lịch chăm sóc cần xử lý: Hậu mãi ${lifecycleDue.postSale} · Remarketing ${lifecycleDue.remarketing}.`,
  ];
  return draft(
    'care-crm-segments',
    'Chăm sóc khách · Phân khúc CRM',
    lines.join('\n'),
    metadata,
    wsKey,
    `Cập nhật: ${formatCareGraphTime(asOf)}.`,
  );
}

/**
 * While the server answers customers, its script is the truth: a machine whose saved setup has a different
 * number of active facts (an older or newer setup on another device) does not describe the facts.
 */
function setupMatchesServer(coverage: CareSetupCoverage, state: CustomerCareAutoReplyState | null): boolean {
  if (!state?.enabled) return true;
  const active = CARE_TOPICS.reduce((sum, topic) => sum + coverage.byTopic[topic], 0);
  return active === state.factCount;
}

/**
 * The Care nodes this machine can vouch for, in a fixed order: process always; facts only with a saved
 * setup; results only with a fresh lead check; crm-segments only when CRM segment counts were read.
 * A node left out keeps what the graph already holds.
 */
export function buildCareGraphNodes(source: CareGraphSource, wsKey: string, asOf: string): CareGraphNodeDraft[] {
  const nodes = [processNode(source, wsKey)];
  if (source.facts && setupMatchesServer(source.facts, source.autoReply)) nodes.push(factsNode(source.facts, wsKey));
  if (source.leads) nodes.push(resultsNode(source, source.leads, wsKey, asOf));
  if (source.crmSegments) nodes.push(crmSegmentsNode(source.crmSegments, wsKey, asOf));
  return nodes;
}
