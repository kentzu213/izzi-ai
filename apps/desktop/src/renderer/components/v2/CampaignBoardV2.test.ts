import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CustomerRun, CustomerRunStatus } from '../../../shared/customer-marketing-types';
import { resolveCampaignBoard, type CampaignCell } from '../../../shared/customer-marketing-campaign-map';
import { CampaignBoardV2, CampaignPlanV2 } from './CampaignBoardV2';

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

function renderBoard(cells: CampaignCell[], runs: CustomerRun[]) {
  const board = resolveCampaignBoard(cells, ['tiktok'], runs);
  return renderToStaticMarkup(createElement(CampaignBoardV2, { ...board, runs }));
}

describe('CampaignBoardV2', () => {
  it('shows six phase columns with their done/total counts', () => {
    const html = renderBoard(
      [cell({ id: 'a', runIds: ['run-1'] }), cell({ id: 'b', phase: 'p4_purchase', tactic: 'Gắn giỏ hàng' })],
      [run('run-1', 'completed')],
    );

    for (const label of ['Nền móng', 'Nhận biết', 'Quan tâm', 'So sánh', 'Mua hàng', 'Sau mua']) {
      expect(html).toContain(label);
    }
    expect(html).toContain('1/1');
    expect(html).toContain('0/1');
    expect(html).toContain('Đã xong 1/2 việc');
  });

  it('renders one row per visible channel only', () => {
    const html = renderBoard([cell({ id: 'a' }), cell({ id: 'z', channel: 'zalo', tactic: 'Zalo OA' })], []);

    expect(html).toContain('TikTok');
    expect(html).toContain('Đo lường');
    expect(html).not.toContain('Zalo OA');
  });

  it('labels each cell with its derived status and blocked reason', () => {
    const html = renderBoard(
      [
        cell({ id: 'a', runIds: ['run-1'] }),
        cell({ id: 'b', phase: 'p4_purchase', tactic: 'Gắn giỏ hàng', runIds: ['run-2'] }),
        cell({ id: 'c', phase: 'p2_consideration', tactic: 'Livestream' }),
      ],
      [
        run('run-1', 'awaiting_approval'),
        run('run-2', 'blocked', { stage: 'director_unavailable', blockedReason: 'Hết quota hôm nay.' }),
      ],
    );

    expect(html).toContain('Chờ duyệt');
    expect(html).toContain('Bị chặn');
    expect(html).toContain('Hết quota hôm nay.');
    expect(html).toContain('Chưa làm');
  });
});

describe('CampaignPlanV2', () => {
  it('opens on the board and keeps the session list mounted but hidden', () => {
    const html = renderToStaticMarkup(createElement(CampaignPlanV2, {
      onboardingChannels: ['tiktok'],
      runs: [],
      sessions: createElement('p', null, 'Danh sách phiên cũ'),
    }));

    expect(html).toContain('Bảng kế hoạch');
    expect(html).toMatch(/aria-pressed="true"[^>]*>Bảng kế hoạch/);
    expect(html).toContain('Chuỗi video ngắn');
    expect(html).toMatch(/<div[^>]*hidden=""[^>]*><p>Danh sách phiên cũ<\/p>/);
  });

  it('stays presentational with no IPC', () => {
    const source = readFileSync(fileURLToPath(new URL('./CampaignBoardV2.tsx', import.meta.url)), 'utf8');

    expect(source).not.toMatch(/window\.(izzi|electron|api)|ipcRenderer|invoke\(/);
  });
});
