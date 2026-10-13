import { describe, expect, it } from 'vitest';
import type {
  CustomerMarketingDraft,
  CustomerRun,
  CustomerRunStatus,
  CustomerScheduledJob,
} from './customer-marketing-types';
import {
  CAMPAIGN_CHANNELS,
  CAMPAIGN_PHASES,
  CAMPAIGN_TEMPLATE,
  MAX_CAMPAIGN_CELLS,
  attachRunToCampaignMap,
  campaignChannelsForCustomerChannels,
  campaignTemplateCells,
  deriveCampaignCellStatus,
  linkScheduleToCells,
  normalizeCampaignMap,
  parseCampaignCellSuggestions,
  resolveCampaignBoard,
  summarizeCampaignPhases,
  visibleCampaignChannels,
  type CampaignCell,
} from './customer-marketing-campaign-map';

function run(id: string, status: CustomerRunStatus, extra: Partial<CustomerRun> = {}): CustomerRun {
  return {
    id,
    goal: 'Ra mắt serum tháng 10',
    status,
    stage: status,
    progress: 0,
    steps: [],
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...extra,
  };
}

function cell(extra: Partial<CampaignCell> = {}): CampaignCell {
  return {
    id: 'p1_awareness:tiktok:short-video',
    phase: 'p1_awareness',
    channel: 'tiktok',
    tactic: 'Video ngắn giới thiệu',
    tags: ['organic'],
    runIds: [],
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...extra,
  };
}

function job(extra: Partial<CustomerScheduledJob> = {}): CustomerScheduledJob {
  return {
    id: 'job-1',
    runId: 'run-1',
    approvalId: 'approval-1',
    kind: 'social_post',
    channel: 'facebook',
    title: 'Bài mở màn',
    brief: '',
    dueAt: '2026-10-03T02:00:00.000Z',
    status: 'scheduled',
    attempts: 0,
    creditsCharged: 0,
    createdAt: '2026-10-02T00:00:00.000Z',
    updatedAt: '2026-10-02T00:00:00.000Z',
    ...extra,
  };
}

function draft(extra: Partial<CustomerMarketingDraft> = {}): CustomerMarketingDraft {
  return {
    id: 'draft-1',
    jobId: 'job-1',
    runId: 'run-1',
    kind: 'social_post',
    channel: 'facebook',
    title: 'Bài mở màn',
    body: 'Nội dung',
    guardian: { passed: true, failedChecks: [] },
    status: 'pending_review',
    createdAt: '2026-10-03T02:05:00.000Z',
    ...extra,
  };
}

describe('campaign framework taxonomy', () => {
  it('has six ordered phases and unique channels', () => {
    expect(CAMPAIGN_PHASES).toEqual([
      'p0_foundation',
      'p1_awareness',
      'p2_consideration',
      'p3_comparison',
      'p4_purchase',
      'p5_post_purchase',
    ]);
    expect(new Set(CAMPAIGN_CHANNELS).size).toBe(CAMPAIGN_CHANNELS.length);
  });

  it('only suggests template cells on known phases and channels with at least one tag', () => {
    for (const suggestion of CAMPAIGN_TEMPLATE) {
      expect(CAMPAIGN_PHASES).toContain(suggestion.phase);
      expect(CAMPAIGN_CHANNELS).toContain(suggestion.channel);
      expect(suggestion.tactic.trim()).not.toBe('');
      expect(suggestion.tags.length).toBeGreaterThan(0);
    }
  });

  it('suggests each phase and channel pair at most once', () => {
    const pairs = CAMPAIGN_TEMPLATE.map((suggestion) => `${suggestion.phase}:${suggestion.channel}`);
    expect(new Set(pairs).size).toBe(pairs.length);
  });

  it('gives every channel at least one suggested tactic', () => {
    const covered = new Set(CAMPAIGN_TEMPLATE.map((suggestion) => suggestion.channel));
    expect([...covered].sort()).toEqual([...CAMPAIGN_CHANNELS].sort());
  });
});

describe('visibleCampaignChannels', () => {
  it('maps onboarding channels onto framework rows in framework order', () => {
    expect(campaignChannelsForCustomerChannels(['seo', 'facebook'])).toEqual([
      'facebook_fanpage',
      'seo',
      'aeo',
      'geo',
    ]);
    expect(campaignChannelsForCustomerChannels(['ads'])).toEqual(['meta_ads', 'google_ads']);
  });

  it('shows only selected channels plus the measurement row', () => {
    expect(visibleCampaignChannels(['tiktok', 'website'], [])).toEqual([
      'tiktok',
      'website_email',
      'data_measurement',
    ]);
  });

  it('keeps a row visible when a session already worked on it', () => {
    expect(visibleCampaignChannels(['tiktok'], [cell({ channel: 'zalo', runIds: ['run-1'] })])).toEqual([
      'tiktok',
      'zalo',
      'data_measurement',
    ]);
  });
});

describe('deriveCampaignCellStatus', () => {
  it('returns todo when no session has touched the cell', () => {
    expect(deriveCampaignCellStatus(cell(), [run('run-1', 'completed')])).toEqual({ status: 'todo' });
  });

  it.each([
    ['queued', 'in_progress'],
    ['in_progress', 'in_progress'],
    ['ready', 'in_progress'],
    ['awaiting_approval', 'awaiting_approval'],
    ['completed', 'planned'],
  ] as const)('maps a %s session to %s', (runStatus, expected) => {
    expect(deriveCampaignCellStatus(cell({ runIds: ['run-1'] }), [run('run-1', runStatus)])).toEqual({
      status: expected,
      runId: 'run-1',
    });
  });

  it('reports the plain-language reason of a blocked session', () => {
    const blocked = run('run-1', 'blocked', {
      stage: 'director_unavailable',
      blockedReason: 'IzziAPI gateway đang lỗi (mã 502).',
    });

    expect(deriveCampaignCellStatus(cell({ runIds: ['run-1'] }), [blocked])).toEqual({
      status: 'blocked',
      runId: 'run-1',
      reason: 'IzziAPI gateway đang lỗi (mã 502).',
    });
  });

  it('does not treat a superseded session as blocked', () => {
    const superseded = run('run-1', 'blocked', { stage: 'superseded_by_new_goal' });

    expect(deriveCampaignCellStatus(cell({ runIds: ['run-1'] }), [superseded])).toEqual({ status: 'todo' });
  });

  it('keeps an approved cell planned when a later session fails', () => {
    const runs = [
      run('run-1', 'completed'),
      run('run-2', 'blocked', { blockedReason: 'Hết quota.' }),
    ];

    expect(deriveCampaignCellStatus(cell({ runIds: ['run-1', 'run-2'] }), runs)).toEqual({
      status: 'planned',
      runId: 'run-1',
    });
  });

  it('shows the active session when a done cell is being reworked', () => {
    const runs = [run('run-1', 'completed'), run('run-2', 'awaiting_approval')];

    expect(deriveCampaignCellStatus(cell({ runIds: ['run-1', 'run-2'] }), runs)).toEqual({
      status: 'awaiting_approval',
      runId: 'run-2',
    });
  });

  it('accepts a manual completion only with evidence', () => {
    expect(deriveCampaignCellStatus(
      cell({ manualCompletion: { completedAt: '2026-10-02T00:00:00.000Z', evidence: 'Ảnh pano tại Times City' } }),
      [],
    )).toEqual({ status: 'done' });
    expect(deriveCampaignCellStatus(
      cell({ manualCompletion: { completedAt: '2026-10-02T00:00:00.000Z', evidence: '   ' } }),
      [],
    )).toEqual({ status: 'todo' });
  });

  it('ignores session ids that are no longer stored', () => {
    expect(deriveCampaignCellStatus(cell({ runIds: ['run-pruned'] }), [])).toEqual({ status: 'todo' });
  });
});

describe('summarizeCampaignPhases', () => {
  it('counts done cells per phase for the visible channels only', () => {
    const cells = [
      cell({ id: 'a', phase: 'p0_foundation', channel: 'website_email', runIds: ['run-1'] }),
      cell({ id: 'b', phase: 'p0_foundation', channel: 'data_measurement' }),
      cell({ id: 'c', phase: 'p1_awareness', channel: 'tiktok', runIds: ['run-2'] }),
      cell({ id: 'd', phase: 'p1_awareness', channel: 'zalo', runIds: ['run-1'] }),
    ];
    const runs = [run('run-1', 'completed'), run('run-2', 'in_progress')];

    const summary = summarizeCampaignPhases(cells, runs, ['website_email', 'data_measurement', 'tiktok']);

    expect(summary.p0_foundation).toEqual({ done: 0, total: 2 });
    expect(summary.p1_awareness).toEqual({ done: 0, total: 1 });
    expect(summary.p5_post_purchase).toEqual({ done: 0, total: 0 });
  });
});

describe('campaignTemplateCells', () => {
  it('turns template suggestions for the given channels into empty cells', () => {
    const cells = campaignTemplateCells(['tiktok'], '2026-10-02T00:00:00.000Z');

    expect(cells.map((item) => item.id)).toEqual(['tpl:p1_awareness:tiktok', 'tpl:p4_purchase:tiktok']);
    expect(cells.every((item) => item.channel === 'tiktok')).toBe(true);
    expect(cells[0]).toMatchObject({ runIds: [], updatedAt: '2026-10-02T00:00:00.000Z' });
  });
});

describe('resolveCampaignBoard', () => {
  it('falls back to the template for the onboarding channels when nothing is stored', () => {
    const board = resolveCampaignBoard(undefined, ['tiktok'], [], '2026-10-02T00:00:00.000Z');

    expect(board.channels).toEqual(['tiktok', 'data_measurement']);
    expect(board.cells.map((item) => item.id)).toEqual([
      'tpl:p0_foundation:data_measurement',
      'tpl:p1_awareness:tiktok',
      'tpl:p4_purchase:tiktok',
      'tpl:p4_purchase:data_measurement',
      'tpl:p5_post_purchase:data_measurement',
    ]);
    expect(board.progress.p1_awareness).toEqual({ done: 0, total: 1 });
  });

  it('uses stored cells and does not count a finished plan as done work', () => {
    const stored = [cell({ runIds: ['run-1'] })];

    const board = resolveCampaignBoard(stored, ['tiktok'], [run('run-1', 'completed')]);

    expect(board.cells).toBe(stored);
    expect(board.progress.p1_awareness).toEqual({ done: 0, total: 1 });
  });

  it('counts a cell done once its scheduled drafts are ready to publish', () => {
    const stored = [cell({ runIds: ['run-1'] })];
    const schedule = {
      jobs: [job({ channel: 'tiktok', status: 'draft_ready', draftId: 'draft-1' })],
      drafts: [draft({ status: 'ready_to_publish' })],
    };

    const board = resolveCampaignBoard(stored, ['tiktok'], [run('run-1', 'completed')], undefined, [], schedule);

    expect(board.progress.p1_awareness).toEqual({ done: 1, total: 1 });
  });
});

describe('linkScheduleToCells', () => {
  const foundation = cell({ id: 'p0:web', phase: 'p0_foundation', channel: 'website_email', runIds: ['run-1'] });
  const fanpageP0 = cell({ id: 'p0:fb', phase: 'p0_foundation', channel: 'facebook_fanpage', runIds: ['run-1'] });
  const fanpageP1 = cell({ id: 'p1:fb', phase: 'p1_awareness', channel: 'facebook_fanpage', runIds: ['run-1'] });

  it('links a facebook post to the fanpage cell past the foundation', () => {
    const links = linkScheduleToCells([fanpageP0, fanpageP1], { jobs: [job({ channel: 'facebook' })], drafts: [] });

    expect(links.byCell.get('p1:fb')?.jobs.map((item) => item.id)).toEqual(['job-1']);
    expect(links.byCell.has('p0:fb')).toBe(false);
  });

  it('links a landing page review to the foundation website cell', () => {
    const review = job({ kind: 'cro_review', channel: 'website' });

    const links = linkScheduleToCells([foundation], { jobs: [review], drafts: [] });

    expect(links.byCell.get('p0:web')?.jobs).toEqual([review]);
  });

  it('keeps jobs without a matching cell or session as unlinked', () => {
    const otherSession = job({ id: 'job-2', channel: 'facebook', runId: 'run-9' });
    const noCell = job({ id: 'job-3', channel: 'telegram' });

    const links = linkScheduleToCells([fanpageP1], { jobs: [otherSession, noCell], drafts: [] });

    expect(links.byCell.size).toBe(0);
    expect(links.unlinked.map((item) => item.id)).toEqual(['job-2', 'job-3']);
  });

  it('attaches the draft each job produced', () => {
    const links = linkScheduleToCells([fanpageP1], {
      jobs: [job({ channel: 'facebook', status: 'draft_ready', draftId: 'draft-1' })],
      drafts: [draft(), draft({ id: 'draft-2', jobId: 'job-other' })],
    });

    expect(links.byCell.get('p1:fb')?.drafts.map((item) => item.id)).toEqual(['draft-1']);
  });

  it('places a launch post in consideration even when only the post-purchase cell carries the session', () => {
    const fanpage = (phase: CampaignCell['phase'], runIds: string[]) =>
      cell({ id: `${phase}:fb`, phase, channel: 'facebook_fanpage', runIds });

    const links = linkScheduleToCells(
      [fanpage('p0_foundation', []), fanpage('p2_consideration', []), fanpage('p5_post_purchase', ['run-1'])],
      { jobs: [job({ channel: 'facebook' })], drafts: [] },
    );

    expect([...links.byCell.keys()]).toEqual(['p2_consideration:fb']);
  });

  it('links a KPI report to the purchase-stage measurement cell of the same session', () => {
    const measurement = (phase: CampaignCell['phase']) =>
      cell({ id: `${phase}:data`, phase, channel: 'data_measurement' });
    const sessionCell = cell({ id: 'p1:tiktok', runIds: ['run-1'] });

    const links = linkScheduleToCells(
      [measurement('p0_foundation'), measurement('p4_purchase'), measurement('p5_post_purchase'), sessionCell],
      { jobs: [job({ kind: 'kpi_report', channel: 'internal' })], drafts: [] },
    );

    expect([...links.byCell.keys()]).toEqual(['p4_purchase:data']);
    expect(links.unlinked).toEqual([]);
  });

  it('links an SEO article to the consideration SEO cell', () => {
    const seoP0 = cell({ id: 'p0:seo', phase: 'p0_foundation', channel: 'seo', runIds: ['run-1'] });
    const seoP2 = cell({ id: 'p2:seo', phase: 'p2_consideration', channel: 'seo' });

    const links = linkScheduleToCells([seoP0, seoP2], { jobs: [job({ kind: 'seo_article', channel: 'seo' })], drafts: [] });

    expect([...links.byCell.keys()]).toEqual(['p2:seo']);
  });

  it('prefers the cell carrying the session when two cells share the preferred phase', () => {
    const plain = cell({ id: 'p1:fb:a', phase: 'p1_awareness', channel: 'facebook_fanpage' });
    const withRun = cell({ id: 'p1:fb:b', phase: 'p1_awareness', channel: 'facebook_fanpage', runIds: ['run-1'] });

    const links = linkScheduleToCells([plain, withRun], { jobs: [job({ channel: 'facebook' })], drafts: [] });

    expect([...links.byCell.keys()]).toEqual(['p1:fb:b']);
  });

  it('never moves a post into a preferred-phase cell another session already owns', () => {
    const otherSession = cell({ id: 'p2:fb', phase: 'p2_consideration', channel: 'facebook_fanpage', runIds: ['run-2'] });
    const ownSession = cell({ id: 'p5:fb', phase: 'p5_post_purchase', channel: 'facebook_fanpage', runIds: ['run-1'] });

    const links = linkScheduleToCells([otherSession, ownSession], { jobs: [job({ channel: 'facebook' })], drafts: [] });

    expect([...links.byCell.keys()]).toEqual(['p5:fb']);
  });

  it('never moves a KPI report into a purchase-stage cell another session already owns', () => {
    const otherSession = cell({ id: 'p4:data', phase: 'p4_purchase', channel: 'data_measurement', runIds: ['run-2'] });
    const ownSession = cell({ id: 'p5:data', phase: 'p5_post_purchase', channel: 'data_measurement', runIds: ['run-1'] });

    const links = linkScheduleToCells([otherSession, ownSession], {
      jobs: [job({ kind: 'kpi_report', channel: 'internal' })],
      drafts: [],
    });

    expect([...links.byCell.keys()]).toEqual(['p5:data']);
  });
});

describe('deriveCampaignCellStatus with scheduled work', () => {
  const planned = cell({ runIds: ['run-1'] });
  const runs = [run('run-1', 'completed')];
  const linked = (jobs: CustomerScheduledJob[], drafts: CustomerMarketingDraft[] = []) => ({ jobs, drafts });

  it('shows jobs waiting for their time as planned', () => {
    expect(deriveCampaignCellStatus(planned, runs, linked([job()]))).toEqual({
      status: 'planned',
      reason: 'Đang chờ tới lịch',
    });
  });

  it('shows a running job as in progress', () => {
    expect(deriveCampaignCellStatus(planned, runs, linked([job(), job({ id: 'job-2', status: 'running' })]))).toEqual({
      status: 'in_progress',
      reason: 'Đang tạo bài',
    });
  });

  it('waits for the customer while a draft is pending review', () => {
    const state = deriveCampaignCellStatus(
      planned,
      runs,
      linked([job({ status: 'draft_ready', draftId: 'draft-1' })], [draft()]),
    );

    expect(state).toEqual({ status: 'awaiting_approval', reason: 'Bản nháp chờ bạn duyệt' });
  });

  it('shows a job stopped by quota as blocked with its error', () => {
    const state = deriveCampaignCellStatus(
      planned,
      runs,
      linked([job({ status: 'blocked_quota', lastError: 'Hết credit' })]),
    );

    expect(state).toEqual({ status: 'blocked', reason: 'Hết credit' });
  });

  it('shows a job waiting for a channel login as blocked with its error', () => {
    const state = deriveCampaignCellStatus(
      planned,
      runs,
      linked([job({ status: 'blocked_connection', lastError: 'Chưa kết nối Facebook' })]),
    );

    expect(state).toEqual({ status: 'blocked', reason: 'Chưa kết nối Facebook' });
  });

  it('is done only when every live job has a draft ready to publish', () => {
    const ready = job({ status: 'draft_ready', draftId: 'draft-1' });
    const cancelled = job({ id: 'job-2', status: 'cancelled' });

    const state = deriveCampaignCellStatus(
      planned,
      runs,
      linked([ready, cancelled], [draft({ status: 'ready_to_publish' })]),
    );

    expect(state).toEqual({ status: 'done' });
  });

  it('falls back to the finished plan when every job was cancelled', () => {
    expect(deriveCampaignCellStatus(planned, runs, linked([job({ status: 'cancelled' })]))).toEqual({
      status: 'planned',
      runId: 'run-1',
    });
  });
});

describe('parseCampaignCellSuggestions', () => {
  const allowed = campaignChannelsForCustomerChannels(['facebook']);
  const valid = { phase: 'p1_awareness', channel: 'facebook_fanpage', tactic: '  Bài viết kể chuyện  ', tags: ['organic'] };

  it('accepts cells on allowed phases and channels, trimming the tactic', () => {
    expect(parseCampaignCellSuggestions([valid], allowed)).toEqual([
      { phase: 'p1_awareness', channel: 'facebook_fanpage', tactic: 'Bài viết kể chuyện', tags: ['organic'] },
    ]);
  });

  it.each([
    ['unknown phase', { ...valid, phase: 'p9_viral' }],
    ['channel outside the allowed list', { ...valid, channel: 'tiktok' }],
    ['unknown channel', { ...valid, channel: 'myspace' }],
    ['blank tactic', { ...valid, tactic: '  ' }],
    ['overlong tactic', { ...valid, tactic: 'x'.repeat(161) }],
    ['no tags', { ...valid, tags: [] }],
    ['unknown tag', { ...valid, tags: ['viral'] }],
    ['duplicate tags', { ...valid, tags: ['paid', 'paid'] }],
    ['extra key', { ...valid, runIds: ['run-1'] }],
  ])('drops a cell with %s and keeps the valid ones', (_label, bad) => {
    expect(parseCampaignCellSuggestions([valid, bad], allowed)).toEqual([
      { phase: 'p1_awareness', channel: 'facebook_fanpage', tactic: 'Bài viết kể chuyện', tags: ['organic'] },
    ]);
  });

  it('rejects a list where no cell is valid', () => {
    expect(parseCampaignCellSuggestions([{ ...valid, phase: 'p9_viral' }, { ...valid, channel: 'tiktok' }], allowed)).toBeNull();
  });

  it('rejects a non-array, an empty list and more than twelve cells', () => {
    expect(parseCampaignCellSuggestions('cells', allowed)).toBeNull();
    expect(parseCampaignCellSuggestions([], allowed)).toBeNull();
    expect(parseCampaignCellSuggestions(Array.from({ length: 13 }, () => valid), allowed)).toBeNull();
  });
});

describe('normalizeCampaignMap', () => {
  const updatedAt = '2026-10-01T00:00:00.000Z';

  it('returns undefined when nothing usable is stored', () => {
    expect(normalizeCampaignMap(undefined)).toBeUndefined();
    expect(normalizeCampaignMap('corrupt')).toBeUndefined();
    expect(normalizeCampaignMap({ cells: 'x', updatedAt })).toBeUndefined();
  });

  it('keeps valid cells and drops malformed ones', () => {
    const good = cell({ runIds: ['run-1'], manualCompletion: { completedAt: updatedAt, evidence: 'Link bài đăng' } });
    const map = normalizeCampaignMap({
      updatedAt,
      cells: [good, { ...good, id: 'bad-phase', phase: 'p9' }, { ...good, id: 'bad-runs', runIds: [1] }, null],
    });

    expect(map).toEqual({ updatedAt, cells: [good] });
  });

  it('drops a malformed manual completion but keeps the cell', () => {
    const map = normalizeCampaignMap({ updatedAt, cells: [{ ...cell(), manualCompletion: { evidence: 42 } }] });

    expect(map?.cells[0]).toEqual(cell());
  });
});

describe('attachRunToCampaignMap', () => {
  const now = '2026-10-02T00:00:00.000Z';

  it('seeds the template for the onboarding channels on first use', () => {
    const map = attachRunToCampaignMap(
      undefined,
      ['tiktok'],
      [{ phase: 'p1_awareness', channel: 'tiktok', tactic: 'Video mới', tags: ['organic'] }],
      'run-1',
      now,
    );

    expect(map.updatedAt).toBe(now);
    expect(map.cells.find((item) => item.id === 'tpl:p1_awareness:tiktok')).toMatchObject({
      runIds: ['run-1'],
      updatedAt: now,
    });
    expect(map.cells.some((item) => item.id.startsWith('run:'))).toBe(false);
  });

  it('adds a new cell when the same phase and channel already has work', () => {
    const existing = { updatedAt: '2026-10-01T00:00:00.000Z', cells: [cell({ id: 'a', runIds: ['run-0'] })] };
    const map = attachRunToCampaignMap(
      existing,
      ['tiktok'],
      [{ phase: 'p1_awareness', channel: 'tiktok', tactic: 'Livestream', tags: ['organic'] }],
      'run-1',
      now,
    );

    expect(map.cells.map((item) => [item.id, item.runIds])).toEqual([
      ['a', ['run-0']],
      ['run:run-1:0', ['run-1']],
    ]);
  });

  it('does not claim a manually completed cell', () => {
    const done = cell({ id: 'tpl:p1_awareness:tiktok', manualCompletion: { completedAt: now, evidence: 'Đã đăng' } });
    const map = attachRunToCampaignMap(
      { updatedAt: now, cells: [done] },
      ['tiktok'],
      [{ phase: 'p1_awareness', channel: 'tiktok', tactic: 'Livestream', tags: ['organic'] }],
      'run-1',
      now,
    );

    expect(map.cells[0].runIds).toEqual([]);
    expect(map.cells[1]).toMatchObject({ id: 'run:run-1:0', runIds: ['run-1'] });
  });

  it('attaches the run to an existing cell with the same phase, channel and tactic', () => {
    const existing = { updatedAt: '2026-10-01T00:00:00.000Z', cells: [cell({ id: 'a', runIds: ['run-0'] })] };
    const map = attachRunToCampaignMap(
      existing,
      ['tiktok'],
      [{ phase: 'p1_awareness', channel: 'tiktok', tactic: ' video NGẮN giới thiệu ', tags: ['organic'] }],
      'run-1',
      now,
    );

    expect(map.cells).toHaveLength(1);
    expect(map.cells[0]).toMatchObject({ id: 'a', runIds: ['run-0', 'run-1'], updatedAt: now });
    expect(existing.cells[0].runIds).toEqual(['run-0']);
  });

  it('never lists the same run twice on one cell', () => {
    const existing = { updatedAt: now, cells: [cell({ id: 'a', runIds: ['run-1'] })] };
    const map = attachRunToCampaignMap(
      existing,
      ['tiktok'],
      [{ phase: 'p1_awareness', channel: 'tiktok', tactic: 'Video ngắn giới thiệu', tags: ['organic'] }],
      'run-1',
      now,
    );

    expect(map.cells[0].runIds).toEqual(['run-1']);
  });

  it('stops adding cells at the cap but still links the run to existing work', () => {
    const full = {
      updatedAt: now,
      cells: Array.from({ length: MAX_CAMPAIGN_CELLS }, (_, index) =>
        cell({ id: `c${index}`, tactic: `Việc số ${index}` }),
      ),
    };
    const map = attachRunToCampaignMap(
      full,
      ['tiktok'],
      [
        { phase: 'p1_awareness', channel: 'tiktok', tactic: 'Việc hoàn toàn mới', tags: ['organic'] },
        { phase: 'p1_awareness', channel: 'tiktok', tactic: 'Việc số 7', tags: ['organic'] },
      ],
      'run-1',
      now,
    );

    expect(map.cells).toHaveLength(MAX_CAMPAIGN_CELLS);
    expect(map.cells[7].runIds).toEqual(['run-1']);
  });
});
