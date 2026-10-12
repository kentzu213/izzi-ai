import { describe, expect, it } from 'vitest';
import type { CustomerMarketingSchedule, CustomerScheduledJob } from '../../shared/customer-marketing-types';
import {
  MAX_JOB_ATTEMPTS,
  MAX_SCHEDULED_JOBS,
  MarketingScheduleStore,
  buildScheduledJobs,
  computeDueAt,
  defaultSchedule,
  extractScheduleBlock,
  nextRetryAt,
  pickDueJob,
  validateScheduleItems,
} from './marketing-schedule';

function job(overrides: Partial<CustomerScheduledJob>): CustomerScheduledJob {
  return {
    id: 'job-1',
    runId: 'run-1',
    approvalId: 'approval-1',
    kind: 'social_post',
    channel: 'facebook',
    title: 'Bài mở màn',
    brief: 'Giới thiệu sản phẩm',
    dueAt: '2026-10-12T02:00:00.000Z',
    status: 'scheduled',
    attempts: 0,
    creditsCharged: 0,
    createdAt: '2026-10-12T00:00:00.000Z',
    updatedAt: '2026-10-12T00:00:00.000Z',
    ...overrides,
  };
}

describe('extractScheduleBlock', () => {
  it('parses the fenced schedule and removes it from the displayed plan', () => {
    const reply = [
      'Kế hoạch 14 ngày',
      '```izzi-schedule',
      '[{"dayOffset":0,"time":"09:00","kind":"social_post","channel":"facebook","title":"Bài mở màn","brief":"Giới thiệu"}]',
      '```',
      'Cần khách hàng duyệt',
    ].join('\n');

    const result = extractScheduleBlock(reply);

    expect(result.items).toEqual([
      { dayOffset: 0, time: '09:00', kind: 'social_post', channel: 'facebook', title: 'Bài mở màn', brief: 'Giới thiệu' },
    ]);
    expect(result.displayReply).toBe('Kế hoạch 14 ngày\n\nCần khách hàng duyệt');
  });

  it('returns null items when the reply has no schedule block', () => {
    const result = extractScheduleBlock('  Chỉ có văn bản  ');

    expect(result).toEqual({ items: null, displayReply: 'Chỉ có văn bản' });
  });

  it('hides an unclosed block left by a truncated reply', () => {
    const result = extractScheduleBlock('Kế hoạch\n```izzi-schedule\n[{"dayOffset":0,');

    expect(result).toEqual({ items: null, displayReply: 'Kế hoạch' });
  });

  it('returns null items when the block is not valid JSON but still hides it', () => {
    const result = extractScheduleBlock('A\n```izzi-schedule\n{oops\n```\nB');

    expect(result.items).toBeNull();
    expect(result.displayReply).toBe('A\n\nB');
  });
});

describe('validateScheduleItems', () => {
  it('drops invalid items, defaults the time and sorts by due order', () => {
    const items = validateScheduleItems([
      { dayOffset: 3, kind: 'seo_article', channel: 'Website', title: 'Bài SEO', brief: 'x' },
      { dayOffset: 99, time: '09:00', kind: 'social_post', channel: 'facebook', title: 'Quá xa', brief: '' },
      { dayOffset: 1, time: '25:00', kind: 'social_post', channel: 'facebook', title: 'Giờ sai', brief: '' },
      { dayOffset: 1, time: '08:30', kind: 'publish_now', channel: 'facebook', title: 'Loại sai', brief: '' },
      { dayOffset: 1, time: '08:30', kind: 'kpi_report', channel: 'facebook', title: '', brief: '' },
      { dayOffset: 0, time: '20:15', kind: 'community_post', channel: 'telegram', title: 'Cộng đồng', brief: 'y' },
    ]);

    expect(items).toEqual([
      { dayOffset: 0, time: '20:15', kind: 'community_post', channel: 'telegram', title: 'Cộng đồng', brief: 'y' },
      { dayOffset: 3, time: '09:00', kind: 'seo_article', channel: 'website', title: 'Bài SEO', brief: 'x' },
    ]);
  });

  it('caps the number of scheduled items', () => {
    const many = Array.from({ length: 40 }, (_, index) => ({
      dayOffset: index % 14, time: '09:00', kind: 'social_post', channel: 'facebook', title: 'Bài ' + index, brief: '',
    }));

    expect(validateScheduleItems(many)).toHaveLength(MAX_SCHEDULED_JOBS);
  });

  it('accepts an object with an items array and rejects other shapes', () => {
    expect(validateScheduleItems({ items: [{ dayOffset: 0, time: '09:00', kind: 'cro_review', channel: 'website', title: 'CRO', brief: '' }] }))
      .toHaveLength(1);
    expect(validateScheduleItems('nope')).toEqual([]);
  });
});

describe('defaultSchedule', () => {
  it('builds a 14-day schedule on the customer channels', () => {
    const items = defaultSchedule(['tiktok', 'seo', 'telegram']);

    expect(items.length).toBeGreaterThanOrEqual(6);
    expect(items.length).toBeLessThanOrEqual(MAX_SCHEDULED_JOBS);
    expect(items.every((item) => item.dayOffset >= 0 && item.dayOffset <= 13)).toBe(true);
    expect(items.find((item) => item.kind === 'social_post')?.channel).toBe('tiktok');
    expect(items.find((item) => item.kind === 'seo_article')?.channel).toBe('seo');
    expect(items.find((item) => item.kind === 'community_post')?.channel).toBe('telegram');
    expect(validateScheduleItems(items)).toEqual(items);
  });

  it('falls back to facebook and website when no channel is configured', () => {
    const items = defaultSchedule([]);

    expect(items.find((item) => item.kind === 'social_post')?.channel).toBe('facebook');
    expect(items.find((item) => item.kind === 'seo_article')?.channel).toBe('website');
  });
});

describe('computeDueAt', () => {
  it('places the job on the local day offset at the given time', () => {
    const approvedAt = new Date(2026, 9, 12, 8, 0, 0);

    const dueAt = new Date(computeDueAt(approvedAt, 2, '09:30'));

    expect(dueAt.getFullYear()).toBe(2026);
    expect(dueAt.getMonth()).toBe(9);
    expect(dueAt.getDate()).toBe(14);
    expect(dueAt.getHours()).toBe(9);
    expect(dueAt.getMinutes()).toBe(30);
  });

  it('makes a job due immediately when its time already passed today', () => {
    const approvedAt = new Date(2026, 9, 12, 15, 0, 0);

    expect(computeDueAt(approvedAt, 0, '09:00')).toBe(approvedAt.toISOString());
  });
});

describe('buildScheduledJobs', () => {
  it('creates scheduled jobs linked to the run and approval', () => {
    const approvedAt = new Date(2026, 9, 12, 8, 0, 0);
    let counter = 0;

    const jobs = buildScheduledJobs('run-1', 'approval-1', defaultSchedule(['facebook']), approvedAt, () => 'job-' + ++counter);

    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs[0]).toMatchObject({ id: 'job-1', runId: 'run-1', approvalId: 'approval-1', status: 'scheduled', attempts: 0, creditsCharged: 0 });
    expect(new Set(jobs.map((item) => item.id)).size).toBe(jobs.length);
  });
});

describe('nextRetryAt', () => {
  it('backs off 5, 15 then gives up after the last attempt', () => {
    const now = new Date('2026-10-12T00:00:00.000Z');

    expect(nextRetryAt(1, now)).toBe('2026-10-12T00:05:00.000Z');
    expect(nextRetryAt(2, now)).toBe('2026-10-12T00:15:00.000Z');
    expect(nextRetryAt(MAX_JOB_ATTEMPTS, now)).toBeNull();
  });
});

describe('pickDueJob', () => {
  const now = new Date('2026-10-12T03:00:00.000Z');

  it('picks the earliest due scheduled job', () => {
    const jobs = [
      job({ id: 'late', dueAt: '2026-10-12T02:30:00.000Z' }),
      job({ id: 'early', dueAt: '2026-10-12T01:00:00.000Z' }),
      job({ id: 'future', dueAt: '2026-10-13T01:00:00.000Z' }),
    ];

    expect(pickDueJob(jobs, now)?.id).toBe('early');
  });

  it('skips jobs that are done, running or waiting for their retry time', () => {
    const jobs = [
      job({ id: 'done', status: 'draft_ready' }),
      job({ id: 'running', status: 'running' }),
      job({ id: 'quota', status: 'blocked_quota' }),
      job({ id: 'waiting', attempts: 1, nextAttemptAt: '2026-10-12T03:05:00.000Z' }),
    ];

    expect(pickDueJob(jobs, now)).toBeNull();
  });

  it('never picks a cancelled job', () => {
    expect(pickDueJob([job({ id: 'cancelled', status: 'cancelled' })], now)).toBeNull();
  });

  it('runs a job with an unreadable due time first instead of leaving it stuck', () => {
    const jobs = [
      job({ id: 'early', dueAt: '2026-10-12T01:00:00.000Z' }),
      job({ id: 'broken', dueAt: 'not-a-date' }),
    ];

    expect(pickDueJob(jobs, now)?.id).toBe('broken');
  });
});

describe('MarketingScheduleStore', () => {
  function memoryDb() {
    const values = new Map<string, string>();
    return {
      values,
      getSetting: (key: string) => values.get(key) ?? null,
      setSetting: (key: string, value: string) => { values.set(key, value); },
    };
  }

  it('returns an empty schedule when nothing is stored or the value is corrupt', () => {
    const db = memoryDb();
    const store = new MarketingScheduleStore(db, 'k');

    expect(store.read()).toEqual({ jobs: [], drafts: [] });
    db.values.set('k', '{broken');
    expect(store.read()).toEqual({ jobs: [], drafts: [] });
  });

  it('round-trips jobs and drafts under its own key', () => {
    const db = memoryDb();
    const store = new MarketingScheduleStore(db, 'k');
    const schedule: CustomerMarketingSchedule = {
      jobs: [job({})],
      drafts: [{
        id: 'draft-1', jobId: 'job-1', runId: 'run-1', kind: 'social_post', channel: 'facebook', title: 't', body: 'b',
        guardian: { passed: true, failedChecks: [] }, status: 'pending_review', createdAt: '2026-10-12T00:00:00.000Z',
      }],
    };

    store.write(schedule);

    expect(store.read()).toEqual(schedule);
    expect(JSON.parse(db.values.get('k') ?? '{}').version).toBe(1);
  });

  it('resets running jobs back to scheduled after a restart', () => {
    const db = memoryDb();
    const store = new MarketingScheduleStore(db, 'k');
    store.write({ jobs: [job({ id: 'a', status: 'running' }), job({ id: 'b', status: 'draft_ready' })], drafts: [] });

    const recovered = store.recoverInterrupted();

    expect(recovered).toBe(1);
    expect(store.read().jobs.map((item) => item.status)).toEqual(['scheduled', 'draft_ready']);
  });
});
