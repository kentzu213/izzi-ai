/**
 * Care → MyGraph digest (design: docs/CARE-GRAPH-AGENTS.md). Pure: no network, no Electron.
 *
 * Builds the three per-workspace Care nodes izzi agents read from the personal graph. The input type
 * holds only counts, fixed codes, topic names, times and the Page's public name, so customer messages,
 * PSIDs, names, phones and Zalo cannot reach a node by construction. The Page name is scrubbed of long
 * digit runs, and the workspace is named by a letters-only hash, never by its id.
 *
 * @module main/customer-care/care-graph-digest
 */
import { createHash } from 'node:crypto';
import type {
  CustomerCareAutoReplyProblem,
  CustomerCareAutoReplyState,
  CustomerCareFact,
  CustomerCareFactTopic,
  CustomerCareLead,
  CustomerCarePageConnection,
} from '../../shared/customer-care-types';

export const CARE_GRAPH_SCHEMA = 1;
export const CARE_PROCESS_VERSION = 'phase-c-1';
/** Same muted accent as the agent hub nodes. */
export const CARE_GRAPH_COLOR = '#5B8AA6';
export const CARE_GRAPH_KINDS = ['care-process', 'care-facts', 'care-results'] as const;
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
  handoffSet: boolean;
  /** null: no Care setup saved on this machine for this account and workspace. */
  facts: CareFactCoverage | null;
  /** null: no live Page binding, a role without access, or the state could not be read. */
  autoReply: CustomerCareAutoReplyState | null;
  /** null: leads are not being read (inbox off, role, not yet checked). */
  leads: CareLeadSummary | null;
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
  handoffSet: boolean;
}
export interface CareFactsMeta {
  kind: 'care-facts';
  schema: 1;
  wsKey: string;
  setupSaved: boolean;
  byTopic: CareTopicCounts;
  expired: number;
  missing: CustomerCareFactTopic[];
  uploadedAt: string | null;
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
export type CareGraphMeta = CareProcessMeta | CareFactsMeta | CareResultsMeta;

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

/** Names a workspace inside the graph without its id. */
export function careWorkspaceKey(workspaceId: string): string {
  return lettersHash(JSON.stringify(['care-graph.v1', workspaceId]), 16);
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
    url: `${GRAPH_URL}?care=${kind}&ws=${wsKey}`,
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
    handoffSet: source.handoffSet,
  };
  const switchText = since ? `${AUTO_REPLY_TEXT[mode]} từ ${formatCareGraphTime(since)}` : AUTO_REPLY_TEXT[mode];
  const content = [
    `Quy trình chăm sóc khách trên Facebook Page${pageName ? ` "${pageName}"` : ''} (izzi tự trả lời).`,
    `Trạng thái: tự trả lời ${switchText} · Page ${PAGE_TEXT[source.page]} · `
      + `bàn giao nhân viên ${source.handoffSet ? 'đã cài' : 'chưa cài'}.`,
    '',
    '1. Khách nhắn Page: izzi trả lời bằng câu cố định và thông tin shop đã duyệt, rồi xin SĐT/Zalo.',
    '2. Mỗi khách nhận tối đa 3 tin tự động trong 24 giờ, chỉ khi tin cuối của khách chưa quá 23 giờ.',
    '3. izzi dừng khi khách để số (sau một tin chốt), khi khách từ chối, hoặc khi nhân viên/ứng dụng khác trả lời.',
    '4. Câu hỏi chưa có thông tin đã duyệt: izzi hẹn nhân viên báo lại.',
    '5. Khách để số: hiện trong "Khách để lại số" để nhân viên gọi lại.',
  ].join('\n');
  return draft('care-process', 'Chăm sóc khách · Quy trình', content, metadata, wsKey);
}

function factsNode(source: CareGraphSource, wsKey: string): CareGraphNodeDraft {
  const coverage = source.facts;
  const byTopic: CareTopicCounts = coverage
    ? { ...coverage.byTopic }
    : { catalog: 0, price: 0, quality: 0, policy: 0, contact: 0 };
  const missing = coverage ? CARE_TOPICS.filter((topic) => byTopic[topic] === 0) : [];
  const uploadedAt = source.autoReply?.scriptUpdatedAt ?? null;
  const metadata: CareFactsMeta = {
    kind: 'care-facts',
    schema: CARE_GRAPH_SCHEMA,
    wsKey,
    setupSaved: coverage !== null,
    byTopic,
    expired: coverage?.expired ?? 0,
    missing,
    uploadedAt,
  };
  const lines = ['Thông tin shop đã duyệt để izzi trả lời khách (chỉ số lượng, không chép nội dung).'];
  if (!coverage) {
    lines.push('Chưa lưu thiết lập chăm sóc khách trên máy này.');
  } else {
    lines.push(`${CARE_TOPICS.map((topic) => `${CARE_TOPIC_LABELS[topic]} ${byTopic[topic]}`).join(' · ')}.`);
    lines.push(`Đã hết hạn: ${coverage.expired}.`);
    lines.push(missing.length > 0
      ? `Còn thiếu: ${missing.map((topic) => CARE_TOPIC_LABELS[topic]).join(', ')}.`
      : 'Đủ cả 5 chủ đề.');
  }
  lines.push(uploadedAt
    ? `Gửi lên máy chủ lần cuối: ${formatCareGraphTime(uploadedAt)}.`
    : 'Chưa gửi lên máy chủ.');
  return draft('care-facts', 'Chăm sóc khách · Thông tin đã duyệt', lines.join('\n'), metadata, wsKey);
}

function resultsNode(source: CareGraphSource, wsKey: string, asOf: string): CareGraphNodeDraft {
  const state = source.autoReply;
  const leads = source.leads;
  const metadata: CareResultsMeta = {
    kind: 'care-results',
    schema: CARE_GRAPH_SCHEMA,
    wsKey,
    asOf,
    sent24h: state?.sentLast24h ?? null,
    stopped24h: state?.stoppedLast24h ?? null,
    leads24h: leads?.last24h ?? null,
    leads7d: leads?.last7d ?? null,
    leadsOpen: leads?.open ?? null,
    leadsCapped: leads?.capped ?? false,
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

/** The three Care nodes in a fixed order: process, facts, results. */
export function buildCareGraphNodes(source: CareGraphSource, wsKey: string, asOf: string): CareGraphNodeDraft[] {
  return [processNode(source, wsKey), factsNode(source, wsKey), resultsNode(source, wsKey, asOf)];
}
