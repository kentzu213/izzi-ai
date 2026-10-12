import type {
  CustomerMarketingDraft,
  CustomerMarketingSchedule,
  CustomerScheduledJob,
  CustomerScheduledJobKind,
} from '../../shared/customer-marketing-types';

/** Scheduled steps of an approved strategy, run on the customer's machine when due. */
export interface MarketingScheduleItem {
  dayOffset: number;
  time: string;
  kind: CustomerScheduledJobKind;
  channel: string;
  title: string;
  brief: string;
}

export const MAX_SCHEDULED_JOBS = 14;
export const MAX_SCHEDULE_DAY_OFFSET = 13;
export const MAX_JOB_ATTEMPTS = 3;
/** A Content Agent call that has not answered after this long counts as a failed attempt. */
export const SCHEDULED_JOB_TIMEOUT_MS = 5 * 60_000;
/** Retry delay when IzziAPI cannot confirm credit; it does not use up an attempt. */
export const CREDIT_UNCONFIRMED_RETRY_MS = 5 * 60_000;
export const SCHEDULE_BLOCK_LANGUAGE = 'izzi-schedule';

const RETRY_DELAYS_MS = [5 * 60_000, 15 * 60_000];
const MAX_STORED_JOBS = 200;
const MAX_STORED_DRAFTS = 100;
const MAX_TITLE_LENGTH = 160;
const MAX_BRIEF_LENGTH = 1000;
const DEFAULT_TIME = '09:00';
const SCHEDULE_KINDS: readonly CustomerScheduledJobKind[] = [
  'seo_article',
  'social_post',
  'community_post',
  'cro_review',
  'kpi_report',
];
const SOCIAL_CHANNELS = ['facebook', 'tiktok', 'instagram', 'x', 'youtube'];
const SCHEDULE_FENCE = /```izzi-schedule[^\n]*\n([\s\S]*?)```/i;
const SCHEDULE_FENCE_OPEN = /```izzi-schedule/i;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const CHANNEL_PATTERN = /^[a-z0-9_-]{1,40}$/;

function cleanText(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, maxLength) : '';
}

function toScheduleItem(value: unknown): MarketingScheduleItem | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const dayOffset = raw.dayOffset;
  if (typeof dayOffset !== 'number' || !Number.isInteger(dayOffset) || dayOffset < 0 || dayOffset > MAX_SCHEDULE_DAY_OFFSET) {
    return null;
  }
  const time = raw.time === undefined ? DEFAULT_TIME : raw.time;
  if (typeof time !== 'string' || !TIME_PATTERN.test(time)) return null;
  const kind = raw.kind as CustomerScheduledJobKind;
  if (!SCHEDULE_KINDS.includes(kind)) return null;
  const channel = cleanText(raw.channel, 40).toLowerCase();
  if (!CHANNEL_PATTERN.test(channel)) return null;
  const title = cleanText(raw.title, MAX_TITLE_LENGTH);
  if (!title) return null;
  return { dayOffset, time, kind, channel, title, brief: cleanText(raw.brief, MAX_BRIEF_LENGTH) };
}

export function validateScheduleItems(value: unknown): MarketingScheduleItem[] {
  const list = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { items?: unknown }).items)
      ? (value as { items: unknown[] }).items
      : [];
  return list
    .map(toScheduleItem)
    .filter((item): item is MarketingScheduleItem => item !== null)
    .slice(0, MAX_SCHEDULED_JOBS)
    .sort((a, b) => a.dayOffset - b.dayOffset || a.time.localeCompare(b.time));
}

/** Splits the machine-readable schedule block out of the Director reply. */
export function extractScheduleBlock(reply: string): { items: MarketingScheduleItem[] | null; displayReply: string } {
  const match = SCHEDULE_FENCE.exec(reply);
  if (!match) {
    // A reply cut off by the token limit leaves the block unclosed; hide the partial JSON.
    const openIndex = reply.search(SCHEDULE_FENCE_OPEN);
    return { items: null, displayReply: (openIndex >= 0 ? reply.slice(0, openIndex) : reply).trim() };
  }
  const displayReply = (reply.slice(0, match.index) + reply.slice(match.index + match[0].length)).trim();
  try {
    const items = validateScheduleItems(JSON.parse(match[1]));
    return { items: items.length > 0 ? items : null, displayReply };
  } catch {
    return { items: null, displayReply };
  }
}

/** Fallback 14-day schedule used when the Director did not return a valid block. */
export function defaultSchedule(channels: readonly string[]): MarketingScheduleItem[] {
  const social = channels.find((channel) => SOCIAL_CHANNELS.includes(channel)) ?? 'facebook';
  const seo = channels.includes('seo') ? 'seo' : 'website';
  const community = channels.includes('telegram') ? 'telegram' : social;
  return [
    { dayOffset: 0, time: '09:00', kind: 'social_post', channel: social, title: 'Bài mở màn: vấn đề khách hàng đang gặp', brief: 'Nêu vấn đề chính của khách hàng mục tiêu và cách sản phẩm giải quyết.' },
    { dayOffset: 1, time: '10:00', kind: 'seo_article', channel: seo, title: 'Bài SEO trụ cột về sản phẩm', brief: 'Bài dài giải thích sản phẩm, lợi ích chính và câu hỏi thường gặp.' },
    { dayOffset: 2, time: '19:00', kind: 'community_post', channel: community, title: 'Câu hỏi thảo luận cho cộng đồng', brief: 'Mở thảo luận về nhu cầu thật của khách hàng, không bán hàng trực tiếp.' },
    { dayOffset: 4, time: '09:00', kind: 'social_post', channel: social, title: 'Bài lợi ích kèm bằng chứng', brief: 'Một lợi ích cụ thể, chỉ dùng bằng chứng đã được duyệt.' },
    { dayOffset: 6, time: '10:00', kind: 'cro_review', channel: 'website', title: 'Rà soát trang đích và lời kêu gọi hành động', brief: 'Liệt kê điểm cần sửa trên trang đích để tăng chuyển đổi.' },
    { dayOffset: 7, time: '17:00', kind: 'kpi_report', channel: 'internal', title: 'Báo cáo KPI tuần 1', brief: 'Tổng hợp việc đã làm và chỉ số cần theo dõi tuần tới.' },
    { dayOffset: 8, time: '10:00', kind: 'seo_article', channel: seo, title: 'Bài SEO trả lời câu hỏi thường gặp', brief: 'Trả lời các câu hỏi khách hàng hay tìm kiếm.' },
    { dayOffset: 10, time: '09:00', kind: 'social_post', channel: social, title: 'Bài tình huống sử dụng thực tế', brief: 'Kể một tình huống sử dụng sản phẩm, không bịa số liệu.' },
    { dayOffset: 11, time: '19:00', kind: 'community_post', channel: community, title: 'Khảo sát nhỏ trong cộng đồng', brief: 'Một câu hỏi khảo sát ngắn để hiểu nhu cầu.' },
    { dayOffset: 13, time: '17:00', kind: 'kpi_report', channel: 'internal', title: 'Báo cáo KPI 14 ngày và đề xuất bước tiếp', brief: 'Tổng kết 14 ngày, đề xuất kế hoạch giai đoạn tiếp theo.' },
  ];
}

/** Local wall-clock time on approval day + dayOffset; a time already passed is due immediately. */
export function computeDueAt(approvedAt: Date, dayOffset: number, time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  const due = new Date(
    approvedAt.getFullYear(),
    approvedAt.getMonth(),
    approvedAt.getDate() + dayOffset,
    hours,
    minutes,
    0,
    0,
  );
  return (due.getTime() < approvedAt.getTime() ? approvedAt : due).toISOString();
}

export function buildScheduledJobs(
  runId: string,
  approvalId: string,
  items: readonly MarketingScheduleItem[],
  approvedAt: Date,
  newId: () => string,
): CustomerScheduledJob[] {
  const createdAt = approvedAt.toISOString();
  return items.map((item) => ({
    id: newId(),
    runId,
    approvalId,
    kind: item.kind,
    channel: item.channel,
    title: item.title,
    brief: item.brief,
    dueAt: computeDueAt(approvedAt, item.dayOffset, item.time),
    status: 'scheduled',
    attempts: 0,
    creditsCharged: 0,
    createdAt,
    updatedAt: createdAt,
  }));
}

/** When to retry after a failed attempt, or null when the job has used all attempts. */
export function nextRetryAt(attempts: number, now: Date): string | null {
  if (attempts >= MAX_JOB_ATTEMPTS) return null;
  const delay = RETRY_DELAYS_MS[Math.max(0, attempts - 1)] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
  return new Date(now.getTime() + delay).toISOString();
}

/** An unreadable due time counts as overdue so the job runs instead of staying stuck forever. */
function dueTime(job: CustomerScheduledJob): number {
  const time = Date.parse(job.dueAt);
  return Number.isNaN(time) ? -Infinity : time;
}

export function pickDueJob(jobs: readonly CustomerScheduledJob[], now: Date): CustomerScheduledJob | null {
  const nowMs = now.getTime();
  const due = jobs.filter((job) => job.status === 'scheduled'
    && dueTime(job) <= nowMs
    && (!job.nextAttemptAt || Date.parse(job.nextAttemptAt) <= nowMs));
  if (due.length === 0) return null;
  return due.reduce((earliest, job) => (dueTime(job) < dueTime(earliest) ? job : earliest));
}

interface ScheduleSettingsStore {
  getSetting(key: string): string | null;
  setSetting(key: string, value: string): void;
}

/** Stored separately from the tenant record so the scheduler never rewrites runs it does not own. */
export class MarketingScheduleStore {
  constructor(
    private readonly db: ScheduleSettingsStore,
    private readonly key: string,
  ) {}

  read(): CustomerMarketingSchedule {
    const raw = this.db.getSetting(this.key);
    if (!raw) return { jobs: [], drafts: [] };
    try {
      const parsed = JSON.parse(raw) as { version?: unknown; jobs?: unknown; drafts?: unknown };
      if (parsed.version !== 1) return { jobs: [], drafts: [] };
      return {
        jobs: Array.isArray(parsed.jobs)
          ? parsed.jobs.filter((job): job is CustomerScheduledJob => typeof job?.id === 'string')
          : [],
        drafts: Array.isArray(parsed.drafts)
          ? parsed.drafts.filter((draft): draft is CustomerMarketingDraft => typeof draft?.id === 'string')
          : [],
      };
    } catch {
      return { jobs: [], drafts: [] };
    }
  }

  write(schedule: CustomerMarketingSchedule): void {
    this.db.setSetting(this.key, JSON.stringify({
      version: 1,
      jobs: schedule.jobs.slice(-MAX_STORED_JOBS),
      drafts: schedule.drafts.slice(-MAX_STORED_DRAFTS),
    }));
  }

  /** A job left `running` was interrupted by an app exit; put it back in the queue. */
  recoverInterrupted(): number {
    const schedule = this.read();
    const interrupted = schedule.jobs.filter((job) => job.status === 'running').length;
    if (interrupted > 0) {
      this.write({
        ...schedule,
        jobs: schedule.jobs.map((job) => (job.status === 'running' ? { ...job, status: 'scheduled' } : job)),
      });
    }
    return interrupted;
  }
}
