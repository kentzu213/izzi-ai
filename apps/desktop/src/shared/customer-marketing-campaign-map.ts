import type { CustomerChannel, CustomerRun } from './customer-marketing-types';

// Campaign board: 6 customer-journey phases × framework channels. Each cell is one unit of
// work; its status is derived from the sessions (runs) attached to it, never set by hand.

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

export type CampaignTag = 'paid' | 'owned' | 'earned' | 'organic' | 'data';

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

function hasManualEvidence(cell: CampaignCell): boolean {
  return Boolean(cell.manualCompletion?.evidence.trim());
}

// A row the customer did not pick at onboarding still shows once work exists on it.
export function visibleCampaignChannels(onboardingChannels: CustomerChannel[], cells: CampaignCell[]): CampaignChannel[] {
  const worked = cells
    .filter((cell) => cell.runIds.length > 0 || hasManualEvidence(cell))
    .map((cell) => cell.channel);
  return inFrameworkOrder([
    ...campaignChannelsForCustomerChannels(onboardingChannels),
    ...worked,
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

// Precedence: manual evidence > active session > completed session > blocked session > todo.
// Run ids pruned from storage are ignored, so such a cell falls back to todo.
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
): CampaignBoard {
  const channels = visibleCampaignChannels(onboardingChannels, storedCells ?? []);
  const cells = storedCells ?? campaignTemplateCells(channels, now);
  return { channels, cells, progress: summarizeCampaignPhases(cells, runs, channels) };
}
