import type { CustomerChannel, CustomerRun } from './customer-marketing-types';

// Campaign board: 6 customer-journey phases × framework channels. Each cell is one unit of
// work; its status is derived from the sessions (runs) attached to it. The only hand-set status
// is "done" with written evidence, on channels the agent can only plan (events, OOH, KOL, e-commerce).

export const CAMPAIGN_PHASES = [
  'p0_foundation',
  'p1_awareness',
  'p2_consideration',
  'p3_comparison',
  'p4_purchase',
  'p5_post_purchase',
] as const;
export type CampaignPhase = (typeof CAMPAIGN_PHASES)[number];

export const CAMPAIGN_PHASE_INFO: Record<CampaignPhase, { label: string; question: string }> = {
  p0_foundation: { label: 'Nền móng', question: 'Khách tìm đến thì đã có gì để xem, để hỏi và để đo chưa?' },
  p1_awareness: { label: 'Nhận biết', question: 'Khách đã từng thấy thương hiệu mình chưa?' },
  p2_consideration: { label: 'Quan tâm', question: 'Vì sao sản phẩm này đáng để tìm hiểu thêm?' },
  p3_comparison: { label: 'So sánh', question: 'Vì sao chọn mình thay vì lựa chọn khác?' },
  p4_purchase: { label: 'Mua hàng', question: 'Mua ở đâu, mua thế nào cho nhanh?' },
  p5_post_purchase: { label: 'Sau mua', question: 'Khách có quay lại và giới thiệu người khác không?' },
};

export const CAMPAIGN_CHANNELS = [
  'kol_koc_pr',
  'events',
  'outdoor_ads',
  'building_frames',
  'tiktok',
  'meta_ads',
  'facebook_fanpage',
  'instagram',
  'threads',
  'zalo',
  'youtube',
  'google_ads',
  'seo',
  'aeo',
  'geo',
  'openai_ads',
  'website_email',
  'ecommerce',
  'data_measurement',
  'telegram',
  'x',
] as const;
export type CampaignChannel = (typeof CAMPAIGN_CHANNELS)[number];

export type CampaignChannelGroup =
  | 'kol_pr'
  | 'offline'
  | 'tiktok'
  | 'meta'
  | 'zalo'
  | 'google'
  | 'search_ai'
  | 'website'
  | 'ecommerce'
  | 'data'
  | 'other';

export const CAMPAIGN_CHANNEL_GROUP_LABELS: Record<CampaignChannelGroup, string> = {
  kol_pr: 'KOL / KOC / PR',
  offline: 'Offline',
  tiktok: 'TikTok',
  meta: 'Meta',
  zalo: 'Zalo',
  google: 'Google',
  search_ai: 'Tìm kiếm & AI',
  website: 'Website & email',
  ecommerce: 'Sàn TMĐT',
  data: 'Dữ liệu',
  other: 'Kênh khác',
};

export const CAMPAIGN_CHANNEL_INFO: Record<CampaignChannel, { label: string; group: CampaignChannelGroup }> = {
  kol_koc_pr: { label: 'KOL, KOC & báo chí', group: 'kol_pr' },
  events: { label: 'Sự kiện', group: 'offline' },
  outdoor_ads: { label: 'Quảng cáo ngoài trời', group: 'offline' },
  building_frames: { label: 'Màn hình toà nhà', group: 'offline' },
  tiktok: { label: 'TikTok', group: 'tiktok' },
  meta_ads: { label: 'Quảng cáo Meta', group: 'meta' },
  facebook_fanpage: { label: 'Fanpage Facebook', group: 'meta' },
  instagram: { label: 'Instagram', group: 'meta' },
  threads: { label: 'Threads', group: 'meta' },
  zalo: { label: 'Zalo OA', group: 'zalo' },
  youtube: { label: 'YouTube', group: 'google' },
  google_ads: { label: 'Google Ads', group: 'google' },
  seo: { label: 'SEO', group: 'search_ai' },
  aeo: { label: 'AEO', group: 'search_ai' },
  geo: { label: 'GEO', group: 'search_ai' },
  openai_ads: { label: 'Quảng cáo trên trợ lý AI', group: 'search_ai' },
  website_email: { label: 'Website & email', group: 'website' },
  ecommerce: { label: 'Sàn TMĐT', group: 'ecommerce' },
  data_measurement: { label: 'Đo lường', group: 'data' },
  telegram: { label: 'Telegram', group: 'other' },
  x: { label: 'X', group: 'other' },
};

export const CAMPAIGN_TAGS = ['paid', 'owned', 'earned', 'organic', 'data'] as const;
export type CampaignTag = (typeof CAMPAIGN_TAGS)[number];

// Onboarding channels stay on the CustomerChannel enum (the remote seven-day API depends on it);
// the board only maps them onto framework rows.
const FRAMEWORK_CHANNELS_BY_CUSTOMER_CHANNEL: Record<CustomerChannel, CampaignChannel[]> = {
  facebook: ['facebook_fanpage'],
  tiktok: ['tiktok'],
  instagram: ['instagram'],
  youtube: ['youtube'],
  website: ['website_email'],
  email: ['website_email'],
  crm: ['data_measurement'],
  ads: ['meta_ads', 'google_ads'],
  telegram: ['telegram'],
  x: ['x'],
  seo: ['seo', 'aeo', 'geo'],
};

// Measurement is always on the board: without it no other cell can prove it worked.
const ALWAYS_VISIBLE_CHANNELS: CampaignChannel[] = ['data_measurement'];

export interface CampaignCellSuggestion {
  phase: CampaignPhase;
  channel: CampaignChannel;
  tactic: string;
  tags: CampaignTag[];
}

export interface CampaignCell extends CampaignCellSuggestion {
  id: string;
  runIds: string[];
  manualCompletion?: { completedAt: string; evidence: string };
  // Set when a completed session of this cell was pruned from storage, so the cell stays done.
  archivedCompletedAt?: string;
  updatedAt: string;
}

export type CampaignCellStatus = 'todo' | 'in_progress' | 'awaiting_approval' | 'done' | 'blocked';

export interface CampaignCellState {
  status: CampaignCellStatus;
  runId?: string;
  reason?: string;
}

export type CampaignPhaseProgress = Record<CampaignPhase, { done: number; total: number }>;

export const CAMPAIGN_TEMPLATE: CampaignCellSuggestion[] = [
  { phase: 'p0_foundation', channel: 'website_email', tactic: 'Trang đích có giá, chính sách đổi trả và nút liên hệ rõ ràng', tags: ['owned'] },
  { phase: 'p0_foundation', channel: 'data_measurement', tactic: 'Gắn pixel, GA4 và UTM cho mọi kênh trước khi chạy', tags: ['data'] },
  { phase: 'p0_foundation', channel: 'facebook_fanpage', tactic: 'Hoàn thiện fanpage: ảnh bìa, giới thiệu, trả lời tin nhắn tự động', tags: ['owned'] },
  { phase: 'p0_foundation', channel: 'zalo', tactic: 'Mở Zalo OA và soạn sẵn kịch bản trả lời câu hỏi thường gặp', tags: ['owned'] },
  { phase: 'p0_foundation', channel: 'seo', tactic: 'Nghiên cứu từ khoá và chuẩn hoá cấu trúc trang', tags: ['organic'] },
  { phase: 'p0_foundation', channel: 'ecommerce', tactic: 'Dựng gian hàng với ảnh, mô tả và giá khớp website', tags: ['owned'] },
  { phase: 'p1_awareness', channel: 'tiktok', tactic: 'Chuỗi video ngắn nói đúng vấn đề khách đang gặp', tags: ['organic'] },
  { phase: 'p1_awareness', channel: 'kol_koc_pr', tactic: 'Gửi sản phẩm cho KOC đúng tệp để đăng trải nghiệm thật', tags: ['earned', 'paid'] },
  { phase: 'p1_awareness', channel: 'events', tactic: 'Gian trải nghiệm tại nơi tệp khách mục tiêu hay lui tới', tags: ['paid'] },
  { phase: 'p1_awareness', channel: 'outdoor_ads', tactic: 'Biển quảng cáo trên tuyến đường khách đi qua hằng ngày', tags: ['paid'] },
  { phase: 'p1_awareness', channel: 'building_frames', tactic: 'Màn hình thang máy ở toà văn phòng hoặc chung cư mục tiêu', tags: ['paid'] },
  { phase: 'p1_awareness', channel: 'meta_ads', tactic: 'Chiến dịch tiếp cận rộng bằng video ngắn', tags: ['paid'] },
  { phase: 'p1_awareness', channel: 'instagram', tactic: 'Reels và ảnh thương hiệu theo một tông thị giác thống nhất', tags: ['organic'] },
  { phase: 'p1_awareness', channel: 'threads', tactic: 'Chia sẻ hậu trường và trò chuyện cùng cộng đồng', tags: ['organic'] },
  { phase: 'p1_awareness', channel: 'youtube', tactic: 'Video 1–3 phút kể câu chuyện thương hiệu', tags: ['organic'] },
  { phase: 'p1_awareness', channel: 'telegram', tactic: 'Kênh thông báo cho nhóm khách quan tâm sớm', tags: ['owned'] },
  { phase: 'p1_awareness', channel: 'x', tactic: 'Chuỗi bài ngắn bình luận chủ đề trong ngành', tags: ['organic'] },
  { phase: 'p2_consideration', channel: 'facebook_fanpage', tactic: 'Bài giải thích công dụng và trả lời bình luận nhanh', tags: ['owned', 'organic'] },
  { phase: 'p2_consideration', channel: 'meta_ads', tactic: 'Tiếp thị lại người đã xem video', tags: ['paid'] },
  { phase: 'p2_consideration', channel: 'seo', tactic: 'Bài hướng dẫn trả lời câu hỏi khách hay tìm', tags: ['organic'] },
  { phase: 'p2_consideration', channel: 'aeo', tactic: 'Khối hỏi đáp ngắn để công cụ tìm kiếm trích dẫn được', tags: ['organic'] },
  { phase: 'p2_consideration', channel: 'google_ads', tactic: 'Quảng cáo tìm kiếm cho từ khoá đang tìm hiểu', tags: ['paid'] },
  { phase: 'p2_consideration', channel: 'website_email', tactic: 'Chuỗi email nuôi dưỡng người đã để lại thông tin', tags: ['owned'] },
  { phase: 'p3_comparison', channel: 'geo', tactic: 'Thông tin sản phẩm và đánh giá rõ ràng để AI so sánh đúng', tags: ['organic'] },
  { phase: 'p3_comparison', channel: 'openai_ads', tactic: 'Quảng cáo khi khách hỏi trợ lý AI để chọn sản phẩm', tags: ['paid'] },
  { phase: 'p3_comparison', channel: 'kol_koc_pr', tactic: 'Bài đánh giá có số liệu từ người có chuyên môn', tags: ['earned'] },
  { phase: 'p3_comparison', channel: 'website_email', tactic: 'Trang so sánh thẳng thắn với các lựa chọn thay thế', tags: ['owned'] },
  { phase: 'p3_comparison', channel: 'ecommerce', tactic: 'Thu thập đánh giá kèm ảnh trên gian hàng', tags: ['earned'] },
  { phase: 'p4_purchase', channel: 'ecommerce', tactic: 'Mã giảm giá và phiên livestream bán hàng', tags: ['paid', 'owned'] },
  { phase: 'p4_purchase', channel: 'tiktok', tactic: 'Gắn giỏ hàng vào video đang có lượt xem tốt', tags: ['paid'] },
  { phase: 'p4_purchase', channel: 'zalo', tactic: 'Nhắn ưu đãi chốt đơn cho người đã hỏi giá', tags: ['owned'] },
  { phase: 'p4_purchase', channel: 'meta_ads', tactic: 'Chiến dịch chuyển đổi về trang đích', tags: ['paid'] },
  { phase: 'p4_purchase', channel: 'google_ads', tactic: 'Quảng cáo mua sắm cho từ khoá sẵn sàng mua', tags: ['paid'] },
  { phase: 'p4_purchase', channel: 'data_measurement', tactic: 'Đo tỉ lệ chuyển đổi và chi phí mỗi đơn theo kênh', tags: ['data'] },
  { phase: 'p5_post_purchase', channel: 'zalo', tactic: 'Chăm sóc sau mua và nhắc mua lại đúng chu kỳ', tags: ['owned'] },
  { phase: 'p5_post_purchase', channel: 'website_email', tactic: 'Email cảm ơn, hướng dẫn dùng và mời đánh giá', tags: ['owned'] },
  { phase: 'p5_post_purchase', channel: 'facebook_fanpage', tactic: 'Nhóm cộng đồng cho khách đã mua', tags: ['owned'] },
  { phase: 'p5_post_purchase', channel: 'instagram', tactic: 'Đăng lại nội dung khách gắn thẻ thương hiệu', tags: ['earned'] },
  { phase: 'p5_post_purchase', channel: 'telegram', tactic: 'Nhóm ưu đãi riêng cho khách cũ', tags: ['owned'] },
  { phase: 'p5_post_purchase', channel: 'data_measurement', tactic: 'Tổng kết số liệu và đưa bài học về pha nền móng', tags: ['data'] },
];

function inFrameworkOrder(channels: Iterable<CampaignChannel>): CampaignChannel[] {
  const wanted = new Set(channels);
  return CAMPAIGN_CHANNELS.filter((channel) => wanted.has(channel));
}

export function campaignChannelsForCustomerChannels(channels: CustomerChannel[]): CampaignChannel[] {
  return inFrameworkOrder(channels.flatMap((channel) => FRAMEWORK_CHANNELS_BY_CUSTOMER_CHANNEL[channel] ?? []));
}

// Channels the agent can only plan, never execute: the customer marks their cells done by hand.
const MANUAL_CAMPAIGN_CHANNELS: CampaignChannel[] = ['kol_koc_pr', 'events', 'outdoor_ads', 'building_frames', 'ecommerce'];

export function isManualCampaignChannel(channel: CampaignChannel): boolean {
  return MANUAL_CAMPAIGN_CHANNELS.includes(channel);
}

function hasManualEvidence(cell: CampaignCell): boolean {
  return Boolean(cell.manualCompletion?.evidence.trim());
}

// A row the customer did not pick at onboarding still shows once work exists on it, or once the
// customer added it from the board.
export function visibleCampaignChannels(
  onboardingChannels: CustomerChannel[],
  cells: CampaignCell[],
  extraChannels: CampaignChannel[] = [],
): CampaignChannel[] {
  const worked = cells
    .filter((cell) => cell.runIds.length > 0 || hasManualEvidence(cell))
    .map((cell) => cell.channel);
  return inFrameworkOrder([
    ...campaignChannelsForCustomerChannels(onboardingChannels),
    ...worked,
    ...extraChannels,
    ...ALWAYS_VISIBLE_CHANNELS,
  ]);
}

// Latest by updatedAt; on a tie the run attached later to the cell wins.
function latestRun(runs: CustomerRun[]): CustomerRun | undefined {
  return runs.reduce<CustomerRun | undefined>(
    (latest, run) => (!latest || run.updatedAt >= latest.updatedAt ? run : latest),
    undefined,
  );
}

const ACTIVE_RUN_STATUS: Partial<Record<CustomerRun['status'], CampaignCellStatus>> = {
  queued: 'in_progress',
  in_progress: 'in_progress',
  ready: 'in_progress',
  awaiting_approval: 'awaiting_approval',
};

// Precedence: manual evidence > active session > completed session (kept or archived) >
// blocked session > todo. Other run ids pruned from storage are ignored.
export function deriveCampaignCellStatus(cell: CampaignCell, runs: CustomerRun[]): CampaignCellState {
  if (hasManualEvidence(cell)) return { status: 'done' };

  const runsById = new Map(runs.map((run) => [run.id, run]));
  const cellRuns = cell.runIds
    .map((id) => runsById.get(id))
    .filter((run): run is CustomerRun => run !== undefined);

  const active = latestRun(cellRuns.filter((run) => ACTIVE_RUN_STATUS[run.status]));
  if (active) return { status: ACTIVE_RUN_STATUS[active.status]!, runId: active.id };

  const completed = latestRun(cellRuns.filter((run) => run.status === 'completed'));
  if (completed) return { status: 'done', runId: completed.id };
  if (cell.archivedCompletedAt) return { status: 'done' };

  const latest = latestRun(cellRuns);
  if (latest?.status === 'blocked' && latest.stage !== 'superseded_by_new_goal') {
    return latest.blockedReason
      ? { status: 'blocked', runId: latest.id, reason: latest.blockedReason }
      : { status: 'blocked', runId: latest.id };
  }

  return { status: 'todo' };
}

export function summarizeCampaignPhases(
  cells: CampaignCell[],
  runs: CustomerRun[],
  visibleChannels: CampaignChannel[],
): CampaignPhaseProgress {
  const visible = new Set(visibleChannels);
  const progress = Object.fromEntries(
    CAMPAIGN_PHASES.map((phase) => [phase, { done: 0, total: 0 }]),
  ) as CampaignPhaseProgress;

  for (const cell of cells) {
    if (!visible.has(cell.channel)) continue;
    const phase = progress[cell.phase];
    phase.total += 1;
    if (deriveCampaignCellStatus(cell, runs).status === 'done') phase.done += 1;
  }
  return progress;
}

export function campaignTemplateCells(channels: CampaignChannel[], now: string): CampaignCell[] {
  const wanted = new Set(channels);
  return CAMPAIGN_TEMPLATE.filter((suggestion) => wanted.has(suggestion.channel)).map((suggestion) => ({
    ...suggestion,
    tags: [...suggestion.tags],
    id: `tpl:${suggestion.phase}:${suggestion.channel}`,
    runIds: [],
    updatedAt: now,
  }));
}

export interface CampaignBoard {
  channels: CampaignChannel[];
  cells: CampaignCell[];
  progress: CampaignPhaseProgress;
}

// Until the director stores a campaign map, the board shows the template for the chosen channels.
export function resolveCampaignBoard(
  storedCells: CampaignCell[] | undefined,
  onboardingChannels: CustomerChannel[],
  runs: CustomerRun[],
  now: string = new Date().toISOString(),
  extraChannels: CampaignChannel[] = [],
): CampaignBoard {
  const channels = visibleCampaignChannels(onboardingChannels, storedCells ?? [], extraChannels);
  const cells = storedCells ?? campaignTemplateCells(channels, now);
  return { channels, cells, progress: summarizeCampaignPhases(cells, runs, channels) };
}

export type CampaignLinkKind = 'previous' | 'next' | 'data' | 'loop';

const phaseIndex = (phase: CampaignPhase) => CAMPAIGN_PHASES.indexOf(phase);
const LOOP_TARGET_PHASES: CampaignPhase[] = ['p0_foundation', 'p1_awareness'];
const LAST_PHASE: CampaignPhase = 'p5_post_purchase';

function nearestPhaseCells(cells: CampaignCell[], from: number, step: 1 | -1): CampaignCell[] {
  for (let index = from + step; index >= 0 && index < CAMPAIGN_PHASES.length; index += step) {
    const found = cells.filter((cell) => phaseIndex(cell.phase) === index);
    if (found.length > 0) return found;
  }
  return [];
}

// What a selected cell feeds and is fed by: the same channel one phase either side, measurement in
// the same phase, and the post-purchase loop back to the start of the journey.
export function linkedCampaignCells(selected: CampaignCell, cells: CampaignCell[]): Map<string, CampaignLinkKind> {
  const links = new Map<string, CampaignLinkKind>();
  const others = cells.filter((cell) => cell.id !== selected.id);
  const sameChannel = others.filter((cell) => cell.channel === selected.channel);
  const from = phaseIndex(selected.phase);

  for (const cell of nearestPhaseCells(sameChannel, from, -1)) links.set(cell.id, 'previous');
  for (const cell of nearestPhaseCells(sameChannel, from, 1)) links.set(cell.id, 'next');

  const measuresSelected = selected.channel === 'data_measurement';
  for (const cell of others) {
    if (cell.phase !== selected.phase) continue;
    if (measuresSelected || cell.channel === 'data_measurement') links.set(cell.id, 'data');
  }

  if (selected.phase === LAST_PHASE) {
    for (const cell of others) {
      const restartsJourney = cell.channel === selected.channel && LOOP_TARGET_PHASES.includes(cell.phase);
      const feedsFoundation = cell.channel === 'data_measurement' && cell.phase === 'p0_foundation';
      if (restartsJourney || feedsFoundation) links.set(cell.id, 'loop');
    }
  } else if (LOOP_TARGET_PHASES.includes(selected.phase)) {
    for (const cell of sameChannel) if (cell.phase === LAST_PHASE) links.set(cell.id, 'loop');
  }
  return links;
}

function visibleCellsInBoardOrder(cells: CampaignCell[], visibleChannels: CampaignChannel[]): CampaignCell[] {
  const visible = new Set(visibleChannels);
  const channelIndex = (channel: CampaignChannel) => CAMPAIGN_CHANNELS.indexOf(channel);
  return cells
    .filter((cell) => visible.has(cell.channel))
    .sort((a, b) => phaseIndex(a.phase) - phaseIndex(b.phase) || channelIndex(a.channel) - channelIndex(b.channel));
}

// The board's own "do this next": the earliest-phase cell nobody has started, or that got stuck.
export function nextCampaignCell(
  cells: CampaignCell[],
  runs: CustomerRun[],
  visibleChannels: CampaignChannel[],
): CampaignCell | undefined {
  return visibleCellsInBoardOrder(cells, visibleChannels).find((cell) => {
    const { status } = deriveCampaignCellStatus(cell, runs);
    return status === 'todo' || status === 'blocked';
  });
}

// Where the campaign is right now: the earliest cell an agent is running or waiting on approval,
// else the next cell to start.
export function currentCampaignCell(
  cells: CampaignCell[],
  runs: CustomerRun[],
  visibleChannels: CampaignChannel[],
): CampaignCell | undefined {
  const active = visibleCellsInBoardOrder(cells, visibleChannels).find((cell) => {
    const { status } = deriveCampaignCellStatus(cell, runs);
    return status === 'in_progress' || status === 'awaiting_approval';
  });
  return active ?? nextCampaignCell(cells, runs, visibleChannels);
}

const PAID_WARNING_PHASES: CampaignPhase[] = ['p1_awareness', 'p2_consideration', 'p3_comparison', 'p4_purchase'];

// Paid cells already started while the foundation is unfinished: money spent before the landing
// page, tracking or inbox can catch it. Empty when the foundation is done.
export function campaignFoundationWarning(
  cells: CampaignCell[],
  runs: CustomerRun[],
  visibleChannels: CampaignChannel[],
): CampaignCell[] {
  const ordered = visibleCellsInBoardOrder(cells, visibleChannels);
  const statusOf = (cell: CampaignCell) => deriveCampaignCellStatus(cell, runs).status;
  const foundationOpen = ordered.some((cell) => cell.phase === 'p0_foundation' && statusOf(cell) !== 'done');
  if (!foundationOpen) return [];
  return ordered.filter(
    (cell) => PAID_WARNING_PHASES.includes(cell.phase) && cell.tags.includes('paid') && statusOf(cell) !== 'todo',
  );
}

// Sessions from before the board existed (or whose plan did not parse) belong to no cell.
// Sessions replaced by a newer goal are history, not open work.
export function unclassifiedCampaignRuns(cells: CampaignCell[], runs: CustomerRun[]): CustomerRun[] {
  const classified = new Set(cells.flatMap((cell) => cell.runIds));
  return runs.filter((run) => !classified.has(run.id) && run.stage !== 'superseded_by_new_goal');
}

export interface CampaignMap {
  cells: CampaignCell[];
  // Channels the customer added from the board on top of the onboarding choice.
  extraChannels?: CampaignChannel[];
  updatedAt: string;
}

const MAX_SUGGESTIONS_PER_RUN = 12;
// Bounds the stored map: past this, sessions still link to existing cells but add no new ones.
export const MAX_CAMPAIGN_CELLS = 200;
const MIN_TACTIC_LENGTH = 3;
const MAX_TACTIC_LENGTH = 160;
const SUGGESTION_KEYS = ['channel', 'phase', 'tactic', 'tags'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCampaignPhase(value: unknown): value is CampaignPhase {
  return (CAMPAIGN_PHASES as readonly unknown[]).includes(value);
}

function isCampaignChannel(value: unknown): value is CampaignChannel {
  return (CAMPAIGN_CHANNELS as readonly unknown[]).includes(value);
}

function parseTags(value: unknown): CampaignTag[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (!value.every((tag) => (CAMPAIGN_TAGS as readonly unknown[]).includes(tag))) return null;
  return new Set(value).size === value.length ? (value as CampaignTag[]) : null;
}

function parseTactic(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const tactic = value.trim();
  return tactic.length >= MIN_TACTIC_LENGTH && tactic.length <= MAX_TACTIC_LENGTH ? tactic : null;
}

// Each cell is checked on its own: one outside the framework or the allowed channels is dropped
// and the valid ones are kept. A list with no valid cell (or a malformed list) returns null.
export function parseCampaignCellSuggestions(
  value: unknown,
  allowedChannels: CampaignChannel[],
): CampaignCellSuggestion[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SUGGESTIONS_PER_RUN) return null;
  const allowed = new Set(allowedChannels);
  const suggestions: CampaignCellSuggestion[] = [];
  for (const item of value) {
    if (!isRecord(item) || Object.keys(item).sort().join() !== SUGGESTION_KEYS.join()) continue;
    if (!isCampaignPhase(item.phase) || !isCampaignChannel(item.channel) || !allowed.has(item.channel)) continue;
    const tactic = parseTactic(item.tactic);
    const tags = parseTags(item.tags);
    if (!tactic || !tags) continue;
    suggestions.push({ phase: item.phase, channel: item.channel, tactic, tags: [...tags] });
  }
  return suggestions.length > 0 ? suggestions : null;
}

function normalizeManualCompletion(value: unknown): CampaignCell['manualCompletion'] | undefined {
  if (!isRecord(value) || typeof value.completedAt !== 'string' || typeof value.evidence !== 'string') return undefined;
  return { completedAt: value.completedAt, evidence: value.evidence };
}

function normalizeCampaignCell(value: unknown): CampaignCell | null {
  if (!isRecord(value)) return null;
  const { id, phase, channel, tactic, runIds, updatedAt } = value;
  const tags = parseTags(value.tags);
  if (typeof id !== 'string' || !id || !isCampaignPhase(phase) || !isCampaignChannel(channel)) return null;
  if (typeof tactic !== 'string' || !tactic.trim() || !tags || typeof updatedAt !== 'string') return null;
  if (!Array.isArray(runIds) || !runIds.every((runId) => typeof runId === 'string')) return null;
  const manualCompletion = normalizeManualCompletion(value.manualCompletion);
  const { archivedCompletedAt } = value;
  return {
    id,
    phase,
    channel,
    tactic,
    tags: [...tags],
    runIds: [...runIds],
    ...(manualCompletion ? { manualCompletion } : {}),
    ...(typeof archivedCompletedAt === 'string' ? { archivedCompletedAt } : {}),
    updatedAt,
  };
}

// Stored maps come from disk: drop what no longer parses instead of failing the whole record.
export function normalizeCampaignMap(value: unknown): CampaignMap | undefined {
  if (!isRecord(value) || !Array.isArray(value.cells) || typeof value.updatedAt !== 'string') return undefined;
  const cells = value.cells
    .map(normalizeCampaignCell)
    .filter((cell): cell is CampaignCell => cell !== null);
  const extraChannels = Array.isArray(value.extraChannels)
    ? inFrameworkOrder(value.extraChannels.filter(isCampaignChannel))
    : [];
  return { cells, ...(extraChannels.length > 0 ? { extraChannels } : {}), updatedAt: value.updatedAt };
}

function withMapExtras(map: CampaignMap | undefined): Pick<CampaignMap, 'extraChannels'> {
  return map?.extraChannels?.length ? { extraChannels: [...map.extraChannels] } : {};
}

function sameWork(cell: CampaignCellSuggestion, suggestion: CampaignCellSuggestion): boolean {
  const key = (tactic: string) => tactic.trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi');
  return cell.phase === suggestion.phase && cell.channel === suggestion.channel && key(cell.tactic) === key(suggestion.tactic);
}

// An untouched template cell in the same phase and channel: a session's own wording of that work
// takes the starter cell over instead of adding a near-duplicate beside it.
function claimableTemplateCell(cells: CampaignCell[], suggestion: CampaignCellSuggestion): CampaignCell | undefined {
  return cells.find(
    (cell) =>
      cell.id.startsWith('tpl:') &&
      cell.phase === suggestion.phase &&
      cell.channel === suggestion.channel &&
      cell.runIds.length === 0 &&
      !hasManualEvidence(cell),
  );
}

// Links a director session to the cells it planned. The first session seeds the template so the
// board keeps its starter work; a suggestion matching an existing cell reuses it, otherwise it
// claims the untouched starter cell of its phase and channel, otherwise it becomes a new cell.
export function attachRunToCampaignMap(
  map: CampaignMap | undefined,
  seedChannels: CampaignChannel[],
  suggestions: CampaignCellSuggestion[],
  runId: string,
  now: string,
): CampaignMap {
  let cells = map ? map.cells : campaignTemplateCells(seedChannels, now);
  suggestions.forEach((suggestion, index) => {
    const match = cells.find((cell) => sameWork(cell, suggestion));
    if (!match) {
      const claim = claimableTemplateCell(cells, suggestion);
      if (claim) {
        cells = cells.map((cell) => (cell === claim ? { ...cell, runIds: [runId], updatedAt: now } : cell));
      } else if (cells.length < MAX_CAMPAIGN_CELLS) {
        cells = [...cells, { ...suggestion, tags: [...suggestion.tags], id: `run:${runId}:${index}`, runIds: [runId], updatedAt: now }];
      }
      return;
    }
    if (match.runIds.includes(runId)) return;
    cells = cells.map((cell) => (cell === match ? { ...cell, runIds: [...cell.runIds, runId], updatedAt: now } : cell));
  });
  return { cells, ...withMapExtras(map), updatedAt: now };
}

const MIN_EVIDENCE_LENGTH = 3;
const MAX_EVIDENCE_LENGTH = 500;

export function parseCampaignEvidence(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const evidence = value.trim();
  return evidence.length >= MIN_EVIDENCE_LENGTH && evidence.length <= MAX_EVIDENCE_LENGTH ? evidence : null;
}

// Work no session can do (a booth, a billboard) is marked done by hand, and only with evidence.
// Returns null when the cell does not exist, is not on a manual channel, or the evidence is missing.
export function markCampaignCellDone(
  map: CampaignMap | undefined,
  seedChannels: CampaignChannel[],
  cellId: unknown,
  evidence: unknown,
  now: string,
): CampaignMap | null {
  const proof = parseCampaignEvidence(evidence);
  const cells = map ? map.cells : campaignTemplateCells(seedChannels, now);
  const target = cells.find((cell) => cell.id === cellId);
  if (!proof || !target || !isManualCampaignChannel(target.channel)) return null;
  // Marking a done cell again keeps the first evidence.
  if (map && hasManualEvidence(target)) return map;
  return {
    cells: cells.map((cell) =>
      cell.id === cellId ? { ...cell, manualCompletion: { completedAt: now, evidence: proof }, updatedAt: now } : cell,
    ),
    ...withMapExtras(map),
    updatedAt: now,
  };
}

// Storage keeps only the latest sessions. Before completed ones are dropped, their cells record
// it so the board does not fall back to "todo" for work that was done.
export function archiveCompletedCampaignRuns(
  map: CampaignMap | undefined,
  droppedRuns: CustomerRun[],
  now: string,
): CampaignMap | undefined {
  if (!map) return map;
  const done = new Set(droppedRuns.filter((run) => run.status === 'completed').map((run) => run.id));
  let changed = false;
  const cells = map.cells.map((cell) => {
    if (cell.archivedCompletedAt || !cell.runIds.some((id) => done.has(id))) return cell;
    changed = true;
    return { ...cell, archivedCompletedAt: now, updatedAt: now };
  });
  return changed ? { ...map, cells, updatedAt: now } : map;
}

// When the director's plan names no usable cell, the session still lands on the board: the next
// open starter cell of each channel it ran on.
export function fallbackCampaignSuggestions(
  map: CampaignMap | undefined,
  seedChannels: CampaignChannel[],
  runChannels: CampaignChannel[],
  runs: CustomerRun[],
  now: string,
): CampaignCellSuggestion[] {
  const cells = map ? map.cells : campaignTemplateCells(seedChannels, now);
  return runChannels
    .map((channel) => nextCampaignCell(cells, runs, [channel]))
    .filter((cell): cell is CampaignCell => cell !== undefined && deriveCampaignCellStatus(cell, runs).status === 'todo')
    .map(({ phase, channel, tactic, tags }) => ({ phase, channel, tactic, tags: [...tags] }));
}

export interface CampaignCellDoneInput {
  cellId: string;
  evidence: string;
}

export interface CampaignAddChannelInput {
  channel: CampaignChannel;
}

// Adds a channel row the customer skipped at onboarding, seeded with its template work.
export function addCampaignChannel(
  map: CampaignMap | undefined,
  seedChannels: CampaignChannel[],
  channel: unknown,
  now: string,
): CampaignMap | null {
  if (!isCampaignChannel(channel)) return null;
  const cells = map ? map.cells : campaignTemplateCells(seedChannels, now);
  const seeded = cells.some((cell) => cell.channel === channel) ? [] : campaignTemplateCells([channel], now);
  return {
    cells: [...cells, ...seeded],
    extraChannels: inFrameworkOrder([...(map?.extraChannels ?? []), channel]),
    updatedAt: now,
  };
}

// Vietnamese marketplace double-day sales; each needs about two months of build-up, so the board
// flags them inside that window and names the phases worth pushing for the time left.
const SALE_DAYS = [
  { label: '9.9', month: 9, day: 9 },
  { label: '10.10', month: 10, day: 10 },
  { label: '11.11', month: 11, day: 11 },
  { label: '12.12', month: 12, day: 12 },
] as const;
export const SALE_LOOKAHEAD_DAYS = 75;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface UpcomingSale {
  label: string;
  date: string;
  daysLeft: number;
  focus: CampaignPhase[];
}

function saleFocus(daysLeft: number): CampaignPhase[] {
  if (daysLeft >= 45) return ['p0_foundation', 'p1_awareness'];
  if (daysLeft >= 15) return ['p2_consideration', 'p3_comparison'];
  return ['p4_purchase'];
}

export function upcomingSaleSeasons(today: Date): UpcomingSale[] {
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const year = today.getFullYear();
  return [year, year + 1]
    .flatMap((y) => SALE_DAYS.map((sale) => ({ sale, at: Date.UTC(y, sale.month - 1, sale.day) })))
    .map(({ sale, at }) => ({ sale, at, daysLeft: Math.round((at - start) / DAY_MS) }))
    .filter(({ daysLeft }) => daysLeft >= 0 && daysLeft <= SALE_LOOKAHEAD_DAYS)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .map(({ sale, at, daysLeft }) => ({
      label: sale.label,
      date: new Date(at).toISOString().slice(0, 10),
      daysLeft,
      focus: saleFocus(daysLeft),
    }));
}
