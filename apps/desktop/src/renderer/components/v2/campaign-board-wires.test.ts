import { describe, expect, it } from 'vitest';
import type { CampaignCell, CampaignLinkKind } from '../../../shared/customer-marketing-campaign-map';
import { campaignWires, wirePath } from './campaign-board-wires';

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

const focus = cell({ id: 'focus' });
const cells = [
  focus,
  cell({ id: 'p0', phase: 'p0_foundation' }),
  cell({ id: 'p2-zalo', phase: 'p2_consideration', channel: 'zalo' }),
  cell({ id: 'p2-tiktok', phase: 'p2_consideration' }),
  cell({ id: 'p5', phase: 'p5_post_purchase' }),
  cell({ id: 'dm1', channel: 'data_measurement' }),
];

describe('campaignWires', () => {
  it('numbers wires by kind, then phase, then channel, and drops unknown cells', () => {
    const links = new Map<string, CampaignLinkKind>([
      ['p5', 'loop'],
      ['dm1', 'data'],
      ['p2-zalo', 'next'],
      ['p2-tiktok', 'next'],
      ['p0', 'previous'],
      ['ghost', 'next'],
    ]);

    const wires = campaignWires(focus, links, cells);

    expect(wires.map((wire) => [wire.order, wire.kind, wire.cellId])).toEqual([
      [1, 'previous', 'p0'],
      [2, 'next', 'p2-tiktok'],
      [3, 'next', 'p2-zalo'],
      [4, 'data', 'dm1'],
      [5, 'loop', 'p5'],
    ]);
  });

  it('points previous and loop wires into the focus and the rest out of it', () => {
    const links = new Map<string, CampaignLinkKind>([
      ['p0', 'previous'],
      ['p2-tiktok', 'next'],
      ['dm1', 'data'],
      ['p5', 'loop'],
    ]);

    const ends = campaignWires(focus, links, cells).map(({ from, to }) => `${from}>${to}`);

    expect(ends).toEqual(['p0>focus', 'focus>p2-tiktok', 'focus>dm1', 'p5>focus']);
  });

  it('points the loop out of the last phase back to the start of the journey', () => {
    const last = cells.find((item) => item.id === 'p5')!;
    const wires = campaignWires(last, new Map([['focus', 'loop']]), cells);

    expect(wires).toEqual([{ from: 'p5', to: 'focus', cellId: 'focus', kind: 'loop', order: 1 }]);
  });
});

describe('wirePath', () => {
  const box = (left: number, top: number) => ({ left, top, width: 100, height: 40 });

  it('runs forward wires from the right edge to the left edge', () => {
    expect(wirePath(box(0, 0), box(200, 100))).toEqual({
      d: 'M 100 20 C 150 20, 150 120, 200 120',
      labelX: 150,
      labelY: 70,
    });
  });

  it('keeps a minimum bend when the columns are close', () => {
    expect(wirePath(box(0, 0), box(110, 0)).d).toBe('M 100 20 C 124 20, 86 20, 110 20');
  });

  it('arches backward wires over the top of both cells', () => {
    expect(wirePath(box(300, 100), box(0, 60))).toEqual({
      d: 'M 350 100 C 350 20, 50 20, 50 60',
      labelX: 200,
      labelY: 35,
    });
    expect(wirePath(box(300, 10), box(0, 20)).d).toBe('M 350 10 C 350 4, 50 4, 50 20');
  });

  it('bows wires inside one column out to the left', () => {
    expect(wirePath(box(50, 0), box(50, 100)).d).toBe('M 50 20 C 26 20, 26 120, 50 120');
  });
});
