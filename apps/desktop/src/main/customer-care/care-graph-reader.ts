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
  type CustomerCareAutoReplyProblem,
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
  const handoffSet = own(meta, 'handoffSet');
  const processVersion = own(meta, 'processVersion');
  if (!isOneOf(page, PAGE_STATES) || !isOneOf(autoReply, AUTO_REPLY_MODES)) return null;
  if (since === undefined || typeof handoffSet !== 'boolean') return null;
  if (typeof processVersion !== 'string' || processVersion.length === 0 || processVersion.length > 40) return null;
  return {
    kind: 'care-process', schema: CARE_GRAPH_SCHEMA, wsKey, processVersion, page, autoReply,
    autoReplySince: since, handoffSet,
  };
}

function parseFacts(meta: Fields, wsKey: string): CareFactsMeta | null {
  const setupSaved = own(meta, 'setupSaved');
  const rawTopics = record(own(meta, 'byTopic'));
  const expired = own(meta, 'expired');
  const rawMissing = own(meta, 'missing');
  const uploadedAt = isoOrNull(own(meta, 'uploadedAt'));
  if (typeof setupSaved !== 'boolean' || !rawTopics || !isCount(expired) || uploadedAt === undefined) return null;
  const byTopic = {} as CareTopicCounts;
  for (const topic of CARE_TOPICS) {
    const count = own(rawTopics, topic);
    if (!isCount(count)) return null;
    byTopic[topic] = count;
  }
  if (!Array.isArray(rawMissing) || rawMissing.length > CARE_TOPICS.length) return null;
  if (!rawMissing.every((topic) => isOneOf(topic, CARE_TOPICS))) return null;
  const missing = CARE_TOPICS.filter((topic) => rawMissing.includes(topic)) as CustomerCareFactTopic[];
  return { kind: 'care-facts', schema: CARE_GRAPH_SCHEMA, wsKey, setupSaved, byTopic, expired, missing, uploadedAt };
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

function parseMeta(node: Fields, wsKey: string): CareGraphMeta | null {
  const meta = record(own(node, 'metadata'));
  if (!meta || own(meta, 'schema') !== CARE_GRAPH_SCHEMA || own(meta, 'wsKey') !== wsKey) return null;
  switch (own(meta, 'kind')) {
    case 'care-process': return parseProcess(meta, wsKey);
    case 'care-facts': return parseFacts(meta, wsKey);
    case 'care-results': return parseResults(meta, wsKey);
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
  return `- Tự trả lời khách: ${switchText}; Page ${PAGE_TEXT[process.page]}; `
    + `bàn giao nhân viên ${process.handoffSet ? 'đã cài' : 'chưa cài'}.`;
}

function factsLine(facts: CareFactsMeta): string {
  if (!facts.setupSaved) return '- Thông tin đã duyệt: chưa lưu thiết lập chăm sóc khách.';
  const counts = CARE_TOPICS.map((topic) => `${CARE_TOPIC_LABELS[topic]} ${facts.byTopic[topic]}`).join(', ');
  const missing = facts.missing.length > 0 ? `; còn thiếu: ${topicList(facts.missing)}` : '; đủ cả 5 chủ đề';
  return `- Thông tin đã duyệt: ${counts}${missing}.`;
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

function guidance(view: CareGraphView): string[] {
  const lines = ['Cách dùng khối Chăm sóc khách:'];
  if (view.process?.autoReply === 'on') {
    lines.push('- Tự trả lời đang bật: được dùng CTA "Nhắn tin Page để được tư vấn"; '
      + 'KPI tuần có "số khách để lại số qua Messenger".');
  } else if (view.process) {
    lines.push('- Tự trả lời đang không bật: không hứa khách sẽ được trả lời ngay trên Messenger.');
  }
  if (view.facts && !view.facts.setupSaved) {
    lines.push('- Trong mục "Cần khách hàng duyệt", thêm việc lưu thiết lập Chăm sóc khách với thông tin đã duyệt.');
  } else if (view.facts && view.facts.missing.length > 0) {
    lines.push('- Trong mục "Cần khách hàng duyệt", thêm việc bổ sung thông tin đã duyệt về: '
      + `${topicList(view.facts.missing)} (khách hỏi các chủ đề này phải chờ nhân viên).`);
  }
  const problem = view.results?.lastProblem;
  if (problem === 'standby' || problem === 'other_app') {
    lines.push('- Đề xuất chủ shop chỉnh Phân luồng hội thoại của Page (ứng dụng khác như Pancake đang giữ '
      + 'hội thoại) để izzi trả lời được.');
  }
  lines.push('- Khối này là số liệu vận hành, không phải proof claim: không dùng nó để khẳng định điều gì về sản phẩm.');
  return lines;
}

/** The Director's Care block for a workspace, from the cached node list; empty when there is none. */
export function careDirectorContextFromCache(cachedNodes: unknown, workspaceId: string, nowMs: number): string[] {
  const view = readCareGraph(cachedNodes, careWorkspaceKey(workspaceId));
  return view ? careDirectorContext(view, nowMs) : [];
}

/** The Care block of the Director prompt; empty when the graph holds nothing for the workspace. */
export function careDirectorContext(view: CareGraphView, nowMs: number): string[] {
  const asOf = view.results?.asOf ?? null;
  const stale = asOf !== null && nowMs - Date.parse(asOf) > CARE_GRAPH_STALE_MS;
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
  return [...lines, ...guidance(view)];
}
