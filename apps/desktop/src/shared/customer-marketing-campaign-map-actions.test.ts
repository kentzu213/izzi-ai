import { describe, expect, it } from 'vitest';
import type { CustomerRun, CustomerRunStatus } from './customer-marketing-types';
import {
  addCampaignChannel,
  attachRunToCampaignMap,
  campaignFoundationWarning,
  isManualCampaignChannel,
  linkedCampaignCells,
  markCampaignCellDone,
  nextCampaignCell,
  normalizeCampaignMap,
  parseCampaignEvidence,
  unclassifiedCampaignRuns,
  type CampaignCell,
  type CampaignMap,
} from './customer-marketing-campaign-map';

const now = '2026-10-02T00:00:00.000Z';

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

function cell(extra: Partial<CampaignCell>): CampaignCell {
  return {
    id: 'cell',
    phase: 'p1_awareness',
    channel: 'tiktok',
    tactic: 'Video ngắn',
    tags: ['organic'],
    runIds: [],
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...extra,
  };
}

describe('linkedCampaignCells', () => {
  const cells = [
    cell({ id: 'p0', phase: 'p0_foundation' }),
    cell({ id: 'p1' }),
    cell({ id: 'p3', phase: 'p3_comparison' }),
    cell({ id: 'p5', phase: 'p5_post_purchase' }),
    cell({ id: 'dm0', channel: 'data_measurement', phase: 'p0_foundation' }),
    cell({ id: 'dm1', channel: 'data_measurement' }),
    cell({ id: 'zalo1', channel: 'zalo' }),
  ];
  const kinds = (id: string) => Object.fromEntries(linkedCampaignCells(cells.find((c) => c.id === id)!, cells));

  it('links the nearest same-channel phase on each side, skipping empty phases', () => {
    expect(kinds('p1')).toMatchObject({ p0: 'previous', p3: 'next', dm1: 'data' });
    expect(kinds('p1')).not.toHaveProperty('zalo1');
    expect(kinds('p1')).not.toHaveProperty('p1');
  });

  it('links every channel in the same phase when a measurement cell is selected', () => {
    expect(kinds('dm1')).toMatchObject({ p1: 'data', zalo1: 'data', dm0: 'previous' });
  });

  it('loops post-purchase back to the start of the journey and to foundation measurement', () => {
    expect(kinds('p5')).toMatchObject({ p0: 'loop', p1: 'loop', dm0: 'loop', p3: 'previous' });
    expect(kinds('p0')).toMatchObject({ p5: 'loop', p1: 'next' });
  });
});

describe('nextCampaignCell', () => {
  it('returns the earliest visible cell that is todo or blocked', () => {
    const cells = [
      cell({ id: 'p0', phase: 'p0_foundation', runIds: ['done'] }),
      cell({ id: 'zalo0', channel: 'zalo', phase: 'p0_foundation' }),
      cell({ id: 'p1', runIds: ['busy'] }),
      cell({ id: 'p2', phase: 'p2_consideration', runIds: ['stuck'] }),
    ];
    const runs = [run('done', 'completed'), run('busy', 'in_progress'), run('stuck', 'blocked')];

    expect(nextCampaignCell(cells, runs, ['tiktok'])?.id).toBe('p2');
    expect(nextCampaignCell(cells, runs, ['tiktok', 'zalo'])?.id).toBe('zalo0');
    expect(nextCampaignCell([cells[0]], runs, ['tiktok'])).toBeUndefined();
  });
});

describe('campaignFoundationWarning', () => {
  const paid = cell({ id: 'ads', channel: 'meta_ads', tags: ['paid'], runIds: ['ads-run'] });
  const foundation = cell({ id: 'p0', phase: 'p0_foundation', runIds: ['p0-run'] });

  it('flags started paid cells while the foundation is unfinished', () => {
    const runs = [run('ads-run', 'awaiting_approval'), run('p0-run', 'in_progress')];
    expect(campaignFoundationWarning([foundation, paid], runs, ['tiktok', 'meta_ads']).map((c) => c.id)).toEqual(['ads']);
  });

  it('ignores untouched paid cells, hidden channels and a finished foundation', () => {
    const open = [run('p0-run', 'in_progress')];
    expect(campaignFoundationWarning([foundation, { ...paid, runIds: [] }], open, ['tiktok', 'meta_ads'])).toEqual([]);
    expect(campaignFoundationWarning([foundation, paid], [...open, run('ads-run', 'in_progress')], ['tiktok'])).toEqual([]);
    const done = [run('p0-run', 'completed'), run('ads-run', 'in_progress')];
    expect(campaignFoundationWarning([foundation, paid], done, ['tiktok', 'meta_ads'])).toEqual([]);
  });
});

describe('unclassifiedCampaignRuns', () => {
  it('returns sessions no cell refers to', () => {
    const runs = [run('linked', 'completed'), run('old-30-09', 'blocked')];
    expect(unclassifiedCampaignRuns([cell({ runIds: ['linked'] })], runs).map((r) => r.id)).toEqual(['old-30-09']);
  });
});

describe('parseCampaignEvidence', () => {
  it('trims and accepts 3 to 500 characters only', () => {
    expect(parseCampaignEvidence('  shopee.vn/serum  ')).toBe('shopee.vn/serum');
    expect(parseCampaignEvidence('ab')).toBeNull();
    expect(parseCampaignEvidence('   ')).toBeNull();
    expect(parseCampaignEvidence('x'.repeat(501))).toBeNull();
    expect(parseCampaignEvidence('x'.repeat(500))).toHaveLength(500);
    expect(parseCampaignEvidence(42)).toBeNull();
  });
});

describe('markCampaignCellDone', () => {
  const ecommerce = cell({ id: 'ecom', channel: 'ecommerce', phase: 'p4_purchase' });
  const map: CampaignMap = { cells: [cell({ id: 'tt' }), ecommerce], extraChannels: ['ecommerce'], updatedAt: '2026-10-01T00:00:00.000Z' };

  it('records evidence on a manual channel cell without mutating the stored map', () => {
    const next = markCampaignCellDone(map, ['tiktok'], 'ecom', ' shopee.vn/serum ', now);

    expect(next?.cells.find((c) => c.id === 'ecom')).toMatchObject({
      manualCompletion: { completedAt: now, evidence: 'shopee.vn/serum' },
      updatedAt: now,
    });
    expect(next?.extraChannels).toEqual(['ecommerce']);
    expect(next?.updatedAt).toBe(now);
    expect(map.cells[1].manualCompletion).toBeUndefined();
  });

  it('refuses agent channels, unknown cells and missing evidence', () => {
    expect(markCampaignCellDone(map, ['tiktok'], 'tt', 'đã đăng', now)).toBeNull();
    expect(markCampaignCellDone(map, ['tiktok'], 'nope', 'đã đăng', now)).toBeNull();
    expect(markCampaignCellDone(map, ['tiktok'], 'ecom', 'ok', now)).toBeNull();
    expect(markCampaignCellDone(map, ['tiktok'], { id: 'ecom' }, 'đã đăng', now)).toBeNull();
  });

  it('seeds the template when nothing is stored yet', () => {
    const next = markCampaignCellDone(undefined, ['ecommerce'], 'tpl:p4_purchase:ecommerce', 'Mở gian hàng Shopee', now);
    expect(next?.cells.find((c) => c.id === 'tpl:p4_purchase:ecommerce')?.manualCompletion?.evidence).toBe('Mở gian hàng Shopee');
  });

  it('only treats offline and marketplace channels as manual', () => {
    expect(['kol_koc_pr', 'events', 'outdoor_ads', 'building_frames', 'ecommerce'].every((c) => isManualCampaignChannel(c as never))).toBe(true);
    expect(isManualCampaignChannel('tiktok')).toBe(false);
  });
});

describe('addCampaignChannel', () => {
  it('adds the channel once and seeds its template work', () => {
    const first = addCampaignChannel(undefined, ['tiktok'], 'zalo', now);
    expect(first?.extraChannels).toEqual(['zalo']);
    expect(first?.cells.some((c) => c.channel === 'tiktok')).toBe(true);
    const zaloCells = first!.cells.filter((c) => c.channel === 'zalo').length;
    expect(zaloCells).toBeGreaterThan(0);

    const again = addCampaignChannel(first, ['tiktok'], 'zalo', now);
    expect(again?.extraChannels).toEqual(['zalo']);
    expect(again!.cells.filter((c) => c.channel === 'zalo')).toHaveLength(zaloCells);
  });

  it('rejects anything that is not a framework channel', () => {
    expect(addCampaignChannel(undefined, ['tiktok'], 'myspace', now)).toBeNull();
    expect(addCampaignChannel(undefined, ['tiktok'], undefined, now)).toBeNull();
  });
});

describe('extra channels survive storage and later sessions', () => {
  it('keeps known extra channels through normalize and attach, dropping unknown ones', () => {
    const stored = normalizeCampaignMap({ cells: [], extraChannels: ['zalo', 'myspace', 'tiktok'], updatedAt: now });
    expect(stored?.extraChannels).toEqual(['tiktok', 'zalo']);

    const attached = attachRunToCampaignMap(stored, ['tiktok'], [
      { phase: 'p1_awareness', channel: 'zalo', tactic: 'Tin nhắn OA', tags: ['owned'] },
    ], 'run-1', now);
    expect(attached.extraChannels).toEqual(['tiktok', 'zalo']);
    expect(normalizeCampaignMap({ cells: [], updatedAt: now })).not.toHaveProperty('extraChannels');
  });
});
