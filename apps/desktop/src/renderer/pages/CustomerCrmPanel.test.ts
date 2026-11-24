import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type {
  CustomerCareCrmProfileInput,
  CustomerCareCrmRow,
} from '../../shared/customer-care-types';
import { CustomerCrmRow, type CustomerCrmRowProps } from './CustomerCrmRow';
import { CustomerCrmPanel } from './CustomerCrmPanel';
import { CRM_CONFLICT_MESSAGE, CRM_SAVE_INVALID_MESSAGE, profileFromRow, type CrmRowEdit } from './customer-crm-flow';

const OWNER_ID = '66666666-6666-4666-8666-666666666666';
/** Wall-clock time in Vietnam (UTC+7), whatever zone this PC is in. */
const vn = (day: number, hour: number) => new Date(Date.UTC(2026, 10, day, hour - 7, 0)).toISOString();
const NOW = Date.parse(vn(24, 14));
const noop = () => undefined;

const PROFILE: CustomerCareCrmProfileInput = {
  stage: 'consulting',
  ownerUserId: OWNER_ID,
  addressForm: 'chi',
  occasion: 'new_home',
  neededBy: '2026-12-20',
  productFactIds: ['ban-127'],
  nextStep: 'Gọi lại báo giá',
  nextStepDueAt: vn(24, 9),
  lostReason: null,
  purchasedAt: null,
  note: 'Nhà mới',
};

const ROW: CustomerCareCrmRow = {
  leadId: '44444444-4444-4444-8444-444444444444',
  pageId: '105252511858057',
  customerName: 'Nguyễn Thị Hoa',
  phone: '0901234567',
  zaloMentioned: true,
  leadStatus: 'contacted',
  phoneCapturedAt: vn(24, 13),
  lastMessageAt: vn(24, 13),
  recentMessages: [{ text: 'Cho em xin giá bàn thờ', at: vn(24, 13) }],
  profile: { ...PROFILE, updatedAt: '2026-11-21T09:30:00.000Z', updatedBy: OWNER_ID },
};

function render(overrides: Partial<CustomerCrmRowProps> = {}): string {
  const props: CustomerCrmRowProps = {
    row: ROW,
    profile: profileFromRow(ROW),
    edit: null,
    saving: false,
    expanded: true,
    nowMs: NOW,
    assignees: [{ userId: OWNER_ID, label: 'Lan' }],
    products: [{ id: 'ban-127', label: 'Bàn thờ gỗ gụ 1m27' }],
    canDelete: false,
    purging: false,
    onChange: noop,
    onToggle: noop,
    onSave: noop,
    onCopy: noop,
    onPurge: noop,
    onReapply: noop,
    onDiscard: noop,
    ...overrides,
  };
  return renderToStaticMarkup(createElement('table', null, createElement('tbody', null, createElement(CustomerCrmRow, props))));
}

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

describe('CustomerCrmRow', () => {
  it('shows the customer, the formatted phone, the stage and an overdue next step', () => {
    const html = render({ expanded: false });
    expect(html).toContain('Nguyễn Thị Hoa');
    expect(html).toContain('0901 234 567');
    expect(html).toContain('Có nhắc Zalo');
    expect(html).toContain('Quá hạn');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('Ghi chú');
  });

  it('shows the lost reason only for lost and the purchase date only for deposit or delivered', () => {
    const consulting = render();
    expect(consulting).not.toContain('Lý do không mua');
    expect(consulting).not.toContain('Ngày mua');
    const lost = render({ profile: { ...PROFILE, stage: 'lost', lostReason: 'price' } });
    expect(lost).toContain('Lý do không mua');
    expect(lost).not.toContain('Ngày mua');
    for (const stage of ['deposit', 'delivered'] as const) {
      const html = render({ profile: { ...PROFILE, stage } });
      expect(html).toContain('Ngày mua');
      expect(html).not.toContain('Lý do không mua');
    }
  });

  it('hides the product picker when this machine has no approved products', () => {
    expect(render()).toContain('Sản phẩm quan tâm');
    expect(render({ products: [] })).not.toContain('Sản phẩm quan tâm');
  });

  it('offers the existing purge only when the server allows delete', () => {
    expect(render()).not.toContain('Xoá dữ liệu khách');
    expect(render({ canDelete: true })).toContain('Xoá dữ liệu khách');
  });

  it('on a conflict says someone just updated the customer and keeps the unsaved values to re-apply', () => {
    const edit: CrmRowEdit = {
      draft: profileFromRow(ROW),
      rejected: { ...PROFILE, stage: 'deposit', note: 'Khách đã cọc 2 triệu' },
      error: CRM_CONFLICT_MESSAGE,
      baseUpdatedAt: '2026-11-24T06:00:00.000Z',
    };
    const html = render({ edit });
    expect(html).toContain('Có người vừa cập nhật khách này.');
    expect(html).toContain('Khách đã cọc 2 triệu');
    expect(html).toContain('Dùng lại thay đổi của tôi');
  });

  it('shows a profile whose details could not be opened read-only: plain fields only, a short note, no save', () => {
    const unreadable: CustomerCareCrmRow = {
      ...ROW,
      profile: {
        ...ROW.profile, addressForm: null, occasion: null, productFactIds: [], nextStep: null, lostReason: null, note: null,
        detailsUnreadable: true,
      },
    };
    const html = render({ row: unreadable, profile: profileFromRow(unreadable), canDelete: true });
    expect(html).toContain('Không đọc được chi tiết khách này.');
    for (const plain of ['Giai đoạn', 'Người phụ trách', 'Cần trước ngày', 'Hạn']) expect(html).toContain(plain);
    for (const detail of ['Xưng hô', 'Dịp mua', 'Sản phẩm quan tâm', 'Việc tiếp theo', 'Lý do không mua', 'Ghi chú']) {
      expect(html).not.toContain(detail);
    }
    const controls = html.match(/<(input|select|textarea)\b[^>]*>/g) ?? [];
    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) expect(control).toContain('disabled=""');
    expect(html).not.toMatch(/>Lưu</);
    expect(html).toContain('Xoá dữ liệu khách');
  });

  it('keeps a row editable after a 400: the message shows, every control and "Lưu" stay enabled', () => {
    const draft = { ...PROFILE, note: 'Ghi chú mới' };
    const edit: CrmRowEdit = { draft, rejected: null, error: CRM_SAVE_INVALID_MESSAGE, baseUpdatedAt: ROW.profile.updatedAt };
    const html = render({ profile: draft, edit });
    expect(html).toContain(CRM_SAVE_INVALID_MESSAGE);
    const controls = html.match(/<(input|select|textarea)\b[^>]*>/g) ?? [];
    expect(controls.length).toBeGreaterThan(5);
    for (const control of controls) expect(control).not.toContain('disabled');
    expect(html).toContain('<button type="button" class="v2-button v2-button--primary">Lưu</button>');
  });

  it('labels every control and asks for no age, marital status or religion', () => {
    const html = render({ profile: { ...PROFILE, stage: 'lost', lostReason: 'price' }, canDelete: true });
    for (const label of ['Giai đoạn', 'Người phụ trách', 'Xưng hô', 'Dịp mua', 'Cần trước ngày', 'Việc tiếp theo', 'Hạn', 'Ghi chú']) {
      expect(html).toContain(label);
    }
    expect(html.toLowerCase()).not.toMatch(/tuổi|hôn nhân|tôn giáo|giới tính|kết hôn/);
    const inputs = html.match(/<(input|select|textarea)\b[^>]*>/g) ?? [];
    for (const control of inputs) expect(control).toMatch(/\bid="[^"]+"/);
  });
});

describe('CustomerCrmPanel', () => {
  it('starts in a loading state without touching any API during render', () => {
    expect(renderToStaticMarkup(createElement(CustomerCrmPanel))).toContain('Đang tải CRM');
  });
});

describe('CRM data never reaches storage, graph nodes or the logger', () => {
  const renderer = ['./CustomerCrmPanel.tsx', './CustomerCrmRow.tsx', './customer-crm-flow.ts', './customer-crm-save-queue.ts'];
  const main = ['../../main/customer-care/care-crm.ts', '../../main/customer-care/care-crm-client.ts'];

  it('keeps the renderer CRM files free of storage, graph and logging APIs', () => {
    for (const file of renderer) {
      const source = read(file);
      expect(source, file).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
      expect(source, file).not.toMatch(/electronAPI\??\.graph|aibase-api|graph_nodes|universe/i);
      expect(source, file).not.toMatch(/console\.|\.log\(/);
    }
  });

  it('keeps the main CRM files free of SQLite, settings, graph and file APIs, logging only a route label', () => {
    for (const file of main) {
      const source = read(file);
      expect(source, file).not.toMatch(/better-sqlite3|dbManager|setSetting|getSetting|setUserData|graph_nodes/);
      expect(source, file).not.toMatch(/node:fs|writeFile|appendFile|electron-store/);
    }
    expect(read(main[0])).not.toMatch(/console\./);
    expect(read(main[1]).match(/console\.\w+/g)).toEqual(['console.warn']);
  });

  it('builds the CRM client in main from the token provider and the origin only', () => {
    const index = read('../../main/index.ts');
    const start = index.indexOf('new CareCrmClient(');
    expect(start).toBeGreaterThan(-1);
    const call = index.slice(start, index.indexOf('});', start));
    expect(call).not.toMatch(/dbManager|store|graph|log/i);
  });
});
