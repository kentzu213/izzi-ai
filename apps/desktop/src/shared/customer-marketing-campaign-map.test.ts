import { describe, expect, it } from 'vitest';
import type { CustomerRun, CustomerRunStatus } from './customer-marketing-types';
import {
  CAMPAIGN_CHANNELS,
  CAMPAIGN_PHASES,
  CAMPAIGN_TEMPLATE,
  campaignChannelsForCustomerChannels,
  deriveCampaignCellStatus,
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
    ['completed', 'done'],
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

  it('keeps an approved cell done when a later session fails', () => {
    const runs = [
      run('run-1', 'completed'),
      run('run-2', 'blocked', { blockedReason: 'Hết quota.' }),
    ];

    expect(deriveCampaignCellStatus(cell({ runIds: ['run-1', 'run-2'] }), runs)).toEqual({
      status: 'done',
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

    expect(summary.p0_foundation).toEqual({ done: 1, total: 2 });
    expect(summary.p1_awareness).toEqual({ done: 0, total: 1 });
    expect(summary.p5_post_purchase).toEqual({ done: 0, total: 0 });
  });
});
