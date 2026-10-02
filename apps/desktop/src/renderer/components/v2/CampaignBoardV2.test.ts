import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CustomerChannel, CustomerRun, CustomerRunStatus } from '../../../shared/customer-marketing-types';
import {
  resolveCampaignBoard,
  type CampaignCell,
  type CampaignChannel,
} from '../../../shared/customer-marketing-campaign-map';
import { CampaignBoardV2, CampaignPlanV2, type CampaignBoardV2Props } from './CampaignBoardV2';

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

function cellClass(html: string, tactic: string): string {
  const match = html.match(
    new RegExp(`<li class="([^"]*)"><button[^>]*><span[^>]*>[^<]*</span><span class="v2-campaign-board__tactic">${tactic}</span>`),
  );
  if (!match) throw new Error(`cell "${tactic}" not rendered`);
  return match[1];
}

function renderWith(
  cells: CampaignCell[],
  runs: CustomerRun[],
  props: Partial<CampaignBoardV2Props> = {},
  onboarding: CustomerChannel[] = ['tiktok'],
  extraChannels: CampaignChannel[] = [],
) {
  const board = resolveCampaignBoard(cells, onboarding, runs, undefined, extraChannels);
  return renderToStaticMarkup(createElement(CampaignBoardV2, { ...board, runs, ...props }));
}

describe('CampaignBoardV2 project-manager view', () => {
  it('shows a progress bar and percent for each phase', () => {
    const html = renderWith(
      [cell({ id: 'a', runIds: ['run-1'] }), cell({ id: 'b', tactic: 'Livestream' })],
      [run('run-1', 'completed')],
    );

    expect(html.match(/role="progressbar"/g)).toHaveLength(6);
    expect(html).toContain('aria-valuenow="50"');
    expect(html).toContain('1/2 · 50%');
    expect(html).toContain('width:50%');
  });

  it('lights up the cells linked to the selected one and dims the rest', () => {
    const html = renderWith(
      [
        cell({ id: 'p0', phase: 'p0_foundation', tactic: 'Hồ sơ kênh' }),
        cell({ id: 'sel', tactic: 'Video ngắn' }),
        cell({ id: 'p2', phase: 'p2_consideration', tactic: 'Livestream' }),
        cell({ id: 'p5', phase: 'p5_post_purchase', tactic: 'Video cảm ơn' }),
        cell({ id: 'dm1', channel: 'data_measurement', tactic: 'Đo lượt xem' }),
        cell({ id: 'dm3', channel: 'data_measurement', phase: 'p3_comparison', tactic: 'Đo so sánh' }),
      ],
      [],
      { initialSelectedCellId: 'sel' },
    );

    expect(cellClass(html, 'Video ngắn')).toContain('is-selected');
    expect(cellClass(html, 'Hồ sơ kênh')).toContain('is-linked-previous');
    expect(cellClass(html, 'Livestream')).toContain('is-linked-next');
    expect(cellClass(html, 'Đo lượt xem')).toContain('is-linked-data');
    expect(cellClass(html, 'Video cảm ơn')).toContain('is-linked-loop');
    expect(cellClass(html, 'Đo so sánh')).toContain('is-dimmed');
    expect(html).toContain('aria-label="Chi tiết việc"');
  });

  it('dims nothing when no cell is selected', () => {
    const html = renderWith([cell({ id: 'a' }), cell({ id: 'b', phase: 'p2_consideration', tactic: 'Livestream' })], []);

    expect(html).not.toContain('is-dimmed');
    expect(html).not.toContain('is-selected');
  });

  it('lists sessions that belong to no cell under "Chưa phân loại"', () => {
    const html = renderWith(
      [cell({ id: 'a', runIds: ['run-new'] })],
      [
        run('run-new', 'completed'),
        run('run-old', 'completed', { goal: 'Bài đăng cũ 30/09', createdAt: '2026-09-30T08:00:00.000Z' }),
      ],
    );

    expect(html).toContain('Chưa phân loại');
    expect(html).toContain('Bài đăng cũ 30/09');
    expect(renderWith([cell({ id: 'a', runIds: ['run-new'] })], [run('run-new', 'completed')])).not.toContain(
      'Chưa phân loại',
    );
  });

  it('suggests the earliest unfinished cell as the next job, falling back to the director', () => {
    const open = renderWith(
      [cell({ id: 'a', phase: 'p0_foundation', tactic: 'Hồ sơ kênh', runIds: ['run-1'] }), cell({ id: 'b' })],
      [run('run-1', 'completed')],
    );
    expect(open).toContain('Việc tiếp theo:');
    expect(open).toContain('Nhận biết · TikTok — Video ngắn');

    const finished = renderWith([cell({ id: 'a', runIds: ['run-1'] })], [run('run-1', 'completed')], {
      nextActions: ['Gọi lại khách cũ'],
    });
    expect(finished).toContain('Gọi lại khách cũ');

    expect(renderWith([cell({ id: 'a', runIds: ['run-1'] })], [run('run-1', 'completed')])).not.toContain(
      'Việc tiếp theo',
    );
  });

  it('warns when paid ads run before the foundation is done', () => {
    const cells = [
      cell({ id: 'p0', phase: 'p0_foundation', tactic: 'Hồ sơ kênh' }),
      cell({ id: 'ads', channel: 'meta_ads', tactic: 'Quảng cáo video', tags: ['paid'], runIds: ['run-ads'] }),
    ];
    const runs = [run('run-ads', 'in_progress')];

    const html = renderWith(cells, runs, {}, ['tiktok', 'ads']);
    expect(html).toContain('role="alert"');
    expect(html).toContain('Nhận biết · Quảng cáo Meta');

    const founded = renderWith(
      [{ ...cells[0], runIds: ['run-p0'] }, cells[1]],
      [...runs, run('run-p0', 'completed')],
      {},
      ['tiktok', 'ads'],
    );
    expect(founded).not.toContain('role="alert"');
  });

  it('asks for evidence before a manual channel cell is marked done', () => {
    const ecommerce = cell({ id: 'ecom', channel: 'ecommerce', phase: 'p4_purchase', tactic: 'Mở gian hàng' });
    const html = renderWith([cell({ id: 'a' }), ecommerce], [], {
      initialSelectedCellId: 'ecom',
      onMarkCellDone: () => undefined,
    }, ['tiktok'], ['ecommerce']);

    expect(html).toContain('Agent chỉ lập kế hoạch cho kênh này');
    expect(html).toContain('aria-label="Bằng chứng đã làm"');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Đã làm<\/button>/);
  });

  it('offers no evidence form on agent channels or once proof exists', () => {
    const agentCell = renderWith([cell({ id: 'a' })], [], { initialSelectedCellId: 'a', onMarkCellDone: () => undefined });
    expect(agentCell).not.toContain('Bằng chứng đã làm');

    const proven = cell({
      id: 'ecom',
      channel: 'ecommerce',
      phase: 'p4_purchase',
      tactic: 'Mở gian hàng',
      manualCompletion: { completedAt: '2026-10-01T00:00:00.000Z', evidence: 'shopee.vn/serum-shop' },
    });
    const done = renderWith([proven], [], { initialSelectedCellId: 'ecom', onMarkCellDone: () => undefined });
    expect(done).toContain('Bằng chứng: shopee.vn/serum-shop');
    expect(done).not.toContain('aria-label="Bằng chứng đã làm"');
  });

  it('offers hidden channels to add only when the room can add them', () => {
    expect(renderWith([cell({ id: 'a' })], [])).not.toContain('+ thêm kênh');

    const html = renderWith([cell({ id: 'a' })], [], { onAddChannel: () => undefined });
    expect(html).toContain('+ thêm kênh');
    expect(html).toContain('<option value="zalo">Zalo OA</option>');
    expect(html).not.toContain('<option value="tiktok">');
  });

  it('groups channel rows under collapsible group headers', () => {
    const html = renderWith([cell({ id: 'a' })], []);

    expect(html).toMatch(/aria-expanded="true"[^>]*>▾ TikTok<\/button>/);
    expect(html).toMatch(/aria-expanded="true"[^>]*>▾ Dữ liệu<\/button>/);
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
