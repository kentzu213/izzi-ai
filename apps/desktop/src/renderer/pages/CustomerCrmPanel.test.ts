import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type {
  CustomerCareCrmIdentity,
  CustomerCareCrmProfileInput,
  CustomerCareCrmRow,
} from '../../shared/customer-care-types';
import { CustomerCrmDrawer, type CustomerCrmDrawerProps } from './CustomerCrmDrawer';
import { CrmEnterpriseKpiStrip, CrmSalerWorkspace } from './CustomerCrmEnterpriseViews';
import { CustomerCrmRow, type CustomerCrmRowProps } from './CustomerCrmRow';
import { CustomerCrmDisplaySwitch, CustomerCrmPanel, CustomerCrmTableSection } from './CustomerCrmPanel';
import { CustomerCrmSalerBar } from './CustomerCrmSalerBar';
import CustomerCrmSalerModal from './CustomerCrmSalerModal';
import { buildDefaultDaiLongSalerPreset } from '../../shared/customer-crm-saler-routing';
import {
  CRM_CONFLICT_MESSAGE,
  CRM_SAVE_INVALID_MESSAGE,
  PAGE_RENDER_STEP,
  crmPageOptions,
  mergeCrmPageSources,
  profileFromRow,
  snapshotPageSources,
  type CrmRowEdit,
} from './customer-crm-flow';

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

describe('CustomerCrmDisplaySwitch ("Bảng | Sơ đồ")', () => {
  it('marks the table as the pressed view by default and the graph when chosen', () => {
    const table = renderToStaticMarkup(createElement(CustomerCrmDisplaySwitch, { display: 'table', onChange: noop }));
    expect(table).toContain('aria-label="Kiểu xem"');
    expect(table).toMatch(/aria-pressed="true"[^>]*>Bảng</);
    expect(table).toMatch(/aria-pressed="false"[^>]*>Sơ đồ</);
    const graph = renderToStaticMarkup(createElement(CustomerCrmDisplaySwitch, { display: 'graph', onChange: noop }));
    expect(graph).toMatch(/aria-pressed="false"[^>]*>Bảng</);
    expect(graph).toMatch(/aria-pressed="true"[^>]*>Sơ đồ</);
  });
});

describe('the CRM graph view adds no IPC and keeps the table untouched', () => {
  const graphFiles = ['./CustomerCrmGraph.tsx', './CustomerCrmGraphSlot.tsx', './CustomerCrmCard.tsx', './customer-crm-graph.ts'];

  it('keeps drafts across "Bảng | Sơ đồ": rows hold no state, the switch only sets the view, the draft renders again', () => {
    // Switching to the graph unmounts the table rows. A draft survives because it lives in the panel's edits, not
    // in the row; the row only renders the draft it is given.
    expect(read('./CustomerCrmRow.tsx')).not.toMatch(/\buse(State|Reducer|Ref|Effect)\b/);
    const panel = read('./CustomerCrmPanel.tsx');
    expect(panel).toContain('<CustomerCrmDisplaySwitch display={display} onChange={setDisplay} />');
    expect(panel).toContain('profile={edit?.draft ?? profileFromRow(row)}');
    expect(panel.match(/setDisplay\(/g)).toHaveLength(1);
    const draft = { ...PROFILE, note: 'Khách hẹn chiều mai qua xem' };
    const edit: CrmRowEdit = { draft, rejected: null, error: '', baseUpdatedAt: ROW.profile.updatedAt };
    const before = render({ profile: draft, edit });
    const afterSwitchBack = render({ profile: draft, edit });
    expect(afterSwitchBack).toBe(before);
    expect(afterSwitchBack).toContain('Khách hẹn chiều mai qua xem');
    expect(afterSwitchBack).toContain('Chưa lưu');
  });

  it('calls only the CRM routes: the table\'s, S3 identity routes, and Saler team/bulk-assign routes', () => {
    const calls = new Set(read('./CustomerCrmPanel.tsx').match(/\bapi\??\.(\w+)\(/g)?.map((call) => call.replace(/\W/g, '').replace(/^api/, '')));
    expect([...calls].sort()).toEqual([
      'bulkAssignCrm', 'getSnapshot', 'identityAction', 'listCrm', 'purgeLead', 'refreshIdentity', 'saveCrmProfile', 'saveCrmTeam',
    ]);
  });

  it('discards list reads in flight when an identity answer lands, and reloads page 1 when the answer asks for it', () => {
    // Review of a694110, HIGH 1 and LOW 5. The merge itself is covered in customer-crm-flow.test.ts.
    const panel = read('./CustomerCrmPanel.tsx');
    const apply = panel.slice(panel.indexOf('const applyIdentityOutcome'), panel.indexOf('const identityAct'));
    expect(apply).toContain('sequenceRef.current.invalidate()');
    // A full reload in flight is started again rather than lost (re-review of a394761, LOW 3).
    expect(apply).toContain("loadRef.current('full')");
    expect(apply).toContain("loadRef.current('page1')");
    expect(panel).toContain('AI hồ sơ khách tạm không tải được.');
    // "Làm mới" and "Thử lại" ask main to try the identity again, past its 5-minute pause (LOW 2).
    expect(panel.split("void load('full', true);")).toHaveLength(3);
  });

  it('never carries its own copy of the consent question: the dialog shows the server\'s text (review MEDIUM 3)', () => {
    for (const file of ['./CustomerCrmPanel.tsx', './CustomerCrmDrawer.tsx', './CustomerCrmIdentity.tsx', './customer-crm-identity.ts']) {
      expect(read(file), file).not.toMatch(/xin phép lưu thông tin|trợ lý tự động của/);
    }
  });

  it('keeps the customerCare IPC channels exactly as they were, plus the two Care CRM S3 identity channels', () => {
    const ipc = read('../../main/customer-care/customer-care-ipc.ts');
    const methods = ipc.slice(ipc.indexOf('const METHODS = ['), ipc.indexOf('] as const;')).match(/'(\w+)'/g);
    expect(methods).toEqual([
      "'getSnapshot'", "'saveSetup'", "'assist'", "'connectFacebookPage'", "'selectFacebookPage'", "'getBackfillStatus'",
      "'disconnectFacebookPage'", "'takeFacebookPageChoices'", "'getFacebookInbox'", "'setFacebookInbox'",
      "'listLeads'", "'setLeadStatus'", "'purgeLead'", "'getAutoReply'", "'setAutoReply'", "'listCrm'", "'saveCrmProfile'",
      "'saveCrmTeam'", "'bulkAssignCrm'", "'identityAction'", "'refreshIdentity'",
    ]);
  });

  it('draws from the rows the panel holds: no IPC, no aibase graph, no export or download', () => {
    for (const file of graphFiles) {
      const source = read(file);
      expect(source, file).not.toMatch(/electronAPI|ipcRenderer|aibase|MyGraphView|fetch\(/);
      expect(source, file).not.toMatch(/createObjectURL|toDataURL|\.download\b|showSaveFilePicker/);
    }
  });
});

describe('CRM data never reaches storage, graph nodes or the logger', () => {
  const renderer = [
    './CustomerCrmPanel.tsx', './CustomerCrmDrawer.tsx', './CustomerCrmRow.tsx', './customer-crm-flow.ts', './customer-crm-save-queue.ts',
    './CustomerCrmGraph.tsx', './CustomerCrmGraphSlot.tsx', './CustomerCrmCard.tsx', './customer-crm-graph.ts',
    './CustomerCrmIdentity.tsx', './customer-crm-identity.ts', './customer-crm-ads-export.ts',
    './CustomerCrmSalerBar.tsx', './CustomerCrmSalerModal.tsx', '../../shared/customer-crm-saler-routing.ts',
  ];
  const main = [
    '../../main/customer-care/care-crm.ts', '../../main/customer-care/care-crm-client.ts', '../../main/customer-care/care-crm-identity.ts',
  ];

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
    expect(read(main[2])).not.toMatch(/console\./);
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

describe('Compact Enterprise CRM v3 — Dense Multi-Page Row & Slide-Over Drawer with S3 Identity', () => {
  const S3_IDENTITY: CustomerCareCrmIdentity = {
    version: '2026-11-25T01:00:00.000Z',
    lastRunAt: '2026-11-25T01:00:00.000Z',
    consent: { state: 'granted', at: '2026-11-25T01:00:00.000Z', noMarketing: false, canAsk: false },
    occasion: null,
    timeline: {
      value: 'before_tet', confidence: 'high', kind: 'stated', source: 'ai', status: 'suggested',
      updatedAt: '2026-11-25T01:00:00.000Z', evidence: [],
    },
    productFactIds: null,
    addressForm: null,
    ageBand: null,
    family: null,
    interests: null,
    persona: {
      value: 'P1', confidence: 'high', kind: 'inferred', source: 'ai', status: 'suggested',
      updatedAt: '2026-11-25T01:00:00.000Z', evidence: [], summary: 'Bàn thờ nhà mới',
    },
  };

  function renderDrawer(overrides: Partial<CustomerCrmDrawerProps> = {}): string {
    const props: CustomerCrmDrawerProps = {
      row: { ...ROW, identity: S3_IDENTITY },
      profile: profileFromRow(ROW),
      edit: null,
      saving: false,
      nowMs: NOW,
      pageLabel: 'Đồng Thờ Hồng Hưng',
      assignees: [{ userId: OWNER_ID, label: 'Lan' }],
      products: [{ id: 'ban-127', label: 'Bàn thờ gỗ gụ 1m27' }],
      canDelete: true,
      purging: false,
      identityHandlers: {
        enabled: true,
        consentAsk: 'Question from server',
        act: async () => ({
          identity: null, workspaceId: null, message: '', tone: 'notice',
          dropRows: false, removeRow: false, skipTick: false, reloadList: false,
        }),
        refresh: async () => ({
          identity: null, workspaceId: null, message: '', tone: 'notice',
          dropRows: false, removeRow: false, skipTick: false, reloadList: false,
        }),
      },
      positionLabel: '1/3',
      hasPrev: false,
      hasNext: true,
      onPrev: noop,
      onNext: noop,
      onClose: noop,
      onChange: noop,
      onSave: noop,
      onCopy: noop,
      onPurge: noop,
      onReapply: noop,
      onDiscard: noop,
      ...overrides,
    };
    return renderToStaticMarkup(createElement(CustomerCrmDrawer, props));
  }

  it('renders Page source tag and consented 1-line segment chips on CustomerCrmRow without sensitive words', () => {
    const html = render({
      expanded: false,
      row: { ...ROW, identity: S3_IDENTITY },
      pageLabel: 'Xưởng tranh đồng Đại Long',
      showSegmentColumn: true,
      selected: true,
    });
    expect(html).toContain('Xưởng tranh đồng Đại Long');
    expect(html).toContain('>P1<');
    expect(html).toContain('>Nhà mới<');
    expect(html).toContain('>Đã đồng ý Ads<');
    expect(html).toContain('aria-expanded="true"');
    expect(html.toLowerCase()).not.toMatch(/tuổi|hôn nhân|tôn giáo|giới tính|kết hôn/);
  });

  it('embeds S3 Identity card & actions in Tab 2, Page source & messages in Tab 3, and forces Tab 1 on 409 conflict', () => {
    const tab1 = renderDrawer({ tab: 'profile' });
    expect(tab1).toContain('id="crm-editor-44444444-4444-4444-8444-444444444444"');
    expect(tab1).toContain('Đồng Thờ Hồng Hưng');
    expect(tab1).toContain('Hồ sơ &amp; Hẹn gọi');
    expect(tab1).toContain('Nhận diện (AI)');
    expect(tab1).toContain('Phím tắt: J / K chuyển khách · Esc đóng ngăn');

    const tab2Granted = renderDrawer({ tab: 'identity' });
    expect(tab2Granted).toContain('P1 · Bàn thờ nhà mới');
    expect(tab2Granted).toContain('Cập nhật hồ sơ');
    expect(tab2Granted).toContain('Khách rút đồng ý');
    expect(tab2Granted).toContain('aria-label="Duyệt Chân dung: P1 · Bàn thờ nhà mới"');

    const tab2Unknown = renderDrawer({
      tab: 'identity',
      row: {
        ...ROW,
        identity: {
          ...S3_IDENTITY,
          consent: { state: 'unknown', at: null, noMarketing: false, canAsk: true },
        },
      },
    });
    expect(tab2Unknown).toContain('Xin phép khách');

    const tab3 = renderDrawer({ tab: 'messages' });
    expect(tab3).toContain('Nguồn Page');
    expect(tab3).toContain('Đồng Thờ Hồng Hưng');
    expect(tab3).toContain('Cho em xin giá bàn thờ');
    expect(tab3).toContain('Xoá dữ liệu khách');

    // A 409 profile_conflict forces Tab 1 even if `identity` tab was requested
    const conflict: CrmRowEdit = {
      draft: profileFromRow(ROW),
      rejected: { ...PROFILE, stage: 'deposit', note: 'Cọc 5 triệu' },
      error: CRM_CONFLICT_MESSAGE,
      baseUpdatedAt: ROW.profile.updatedAt,
    };
    const forcedTab1 = renderDrawer({ tab: 'identity', edit: conflict });
    expect(forcedTab1).toContain('Dùng lại thay đổi của tôi');
    expect(forcedTab1).toContain('Cọc 5 triệu');
  });

  it('renders 831–850 multi-Page leads with accurate 3 Page nguồn KPI and 100-row DOM pagination ("Hiện thêm 100 khách" & "Hiện tất cả")', () => {
    const PAGE_DO_DONG = '741891669999824';
    const PAGE_TRANH_DONG = '631891669999823';
    const PAGE_HONG_HUNG = '105252511858057';

    // Build 831 real-distribution rows (504 Đồ Đồng Đại Long + 300 Xưởng Tranh Đồng + 27 Đồng Thờ Hồng Hưng)
    const rows831: CustomerCareCrmRow[] = Array.from({ length: 831 }, (_, idx) => {
      const pageId = idx < 504 ? PAGE_DO_DONG : (idx < 804 ? PAGE_TRANH_DONG : PAGE_HONG_HUNG);
      const n = 1000 + idx;
      return {
        ...ROW,
        leadId: `44444444-4444-4444-8444-44444444${String(n)}`,
        pageId,
        customerName: `Khách ${idx + 1}`,
        phone: `091234${String(n)}`,
      };
    });

    const snapSources = snapshotPageSources({
      setup: null,
      pageConnection: {
        state: 'connected',
        pageId: PAGE_HONG_HUNG,
        pageName: 'Đồng Thờ Hồng Hưng',
        status: 'active',
        missingScopes: [],
        verifiedAt: '2026-11-25T00:00:00.000Z',
        crmPages: [
          { pageId: PAGE_DO_DONG, pageName: 'Đồ Đồng Đại Long', verifiedAt: '2026-11-25T00:00:00.000Z' },
          { pageId: PAGE_TRANH_DONG, pageName: 'Xưởng Tranh Đồng Đại Long Nam Định', verifiedAt: '2026-11-25T00:00:00.000Z' },
        ],
      },
    });
    const allSources = mergeCrmPageSources([], snapSources);
    const pageOpts = crmPageOptions(rows831, allSources);
    expect(pageOpts).toEqual([
      { pageId: PAGE_HONG_HUNG, label: 'Đồng Thờ Hồng Hưng', count: 27 },
      { pageId: PAGE_DO_DONG, label: 'Đồ Đồng Đại Long', count: 504 },
      { pageId: PAGE_TRANH_DONG, label: 'Xưởng Tranh Đồng Đại Long Nam Định', count: 300 },
    ]);

    const kpiHtml = renderToStaticMarkup(createElement(CrmEnterpriseKpiStrip, {
      rows: rows831,
      savedRows: rows831,
      products: [],
      nowMs: NOW,
      pageCount: pageOpts.length,
      identityState: { identityEnabled: true, identityUnavailable: false },
      display: 'table',
      onSelectDisplay: noop,
    }));
    expect(kpiHtml).toContain('>831<');
    expect(kpiHtml).toContain('3 Page nguồn');

    // Table DOM pagination: renders only 100 <tr> rows initially, with "Đang hiển thị 100 / 831 khách hàng" + both buttons
    const tableHtml = renderToStaticMarkup(createElement(CustomerCrmTableSection, {
      shown: rows831,
      renderLimit: PAGE_RENDER_STEP,
      drawerId: null,
      edits: {},
      savingIds: new Set<string>(),
      purgingId: null,
      nowMs: NOW,
      assignees: [],
      products: [],
      canDelete: false,
      identityHandlers: null,
      resolvePageLabel: (id) => pageOpts.find((o) => o.pageId === id)?.label ?? id,
      onChange: noop,
      onToggle: noop,
      onSave: noop,
      onCopy: noop,
      onPurge: noop,
      onReapply: noop,
      onDiscard: noop,
      onShowMore: noop,
      onShowAll: noop,
    }));
    expect((tableHtml.match(/<tr class="v2-crm__row/g) ?? [])).toHaveLength(100);
    expect(tableHtml).toContain('Đang hiển thị 100 / 831 khách hàng');
    expect(tableHtml).toContain('Hiện thêm 100 khách');
    expect(tableHtml).toContain('Hiện tất cả');
    expect(tableHtml).toContain('Khách 100');
    expect(tableHtml).not.toContain('Khách 101');

    // Saler workspace also computes counts on all 831 rows while rendering only 100 cards in DOM
    const salerHtml = renderToStaticMarkup(createElement(CrmSalerWorkspace, {
      rows: rows831,
      products: [],
      assignees: [],
      savingIds: new Set<string>(),
      nowMs: NOW,
      identityEnabled: true,
      onChangeProfile: noop,
      onCopyText: noop,
      onOpenProfile: noop,
    }));
    expect(salerHtml).toContain('Tất cả (831)');
    expect((salerHtml.match(/<article class="v2-crm-saler-card"/g) ?? [])).toHaveLength(100);
    expect(salerHtml).toContain('Đang hiển thị 100 / 831 khách hàng');
    expect(salerHtml).toContain('Hiện thêm 100 khách');
    expect(salerHtml).toContain('Hiện tất cả');
  });

  it('renders inline 3-step controls, colored Saler pill select, Color Tag Rail 2.0, Supervision Matrix, and Auto-Routing Modal', () => {
    const salers = buildDefaultDaiLongSalerPreset([
      { pageId: '105252511858057', pageName: 'Đồng Thờ Hồng Hưng' },
      { pageId: '741891669999824', pageName: 'Đồ Đồng Đại Long' },
    ]);
    const staleUncalled: CustomerCareCrmRow = {
      ...ROW,
      phoneCapturedAt: vn(24, 10),
      profile: {
        ...PROFILE,
        stage: 'has_phone',
        salerId: salers[0]!.id,
        careStep: 'step1_uncalled',
        callTries: 0,
        updatedAt: '2026-11-21T09:30:00.000Z',
        updatedBy: OWNER_ID,
      },
    };
    const rowHtml = render({
      expanded: false,
      row: staleUncalled,
      profile: profileFromRow(staleUncalled),
      salers,
    });
    expect(rowHtml).toContain('B1 · Chưa gọi');
    expect(rowHtml).toContain('Đã gọi');
    expect(rowHtml).toContain('Chưa nghe');
    expect(rowHtml).toContain('Sai số');
    expect(rowHtml).toContain('Tuấn Thần Đèn');

    const barHtml = renderToStaticMarkup(createElement(CustomerCrmSalerBar, {
      rows: [staleUncalled, { ...ROW, leadId: '55555555-5555-4555-8555-555555555555', profile: { ...ROW.profile, ownerUserId: null, salerId: null } }],
      salers,
      filter: { view: 'all', stage: 'any', salerId: 'any', careStep: 'any' },
      nowMs: NOW,
      canManageTeam: true,
      showMatrix: true,
      mySalerId: null,
      onSelectMySalerId: noop,
      onChangeFilter: noop,
      onOpenTeamModal: noop,
      onOpenRescueModal: noop,
    }));
    expect(barHtml).toContain('👤 Của tôi');
    expect(barHtml).toContain('⚙ Đội Saler');
    expect(barHtml).toContain('⚠ 1 &gt;2h');
    expect(barHtml).toContain('Rút số ngâm');
    expect(barHtml).toContain('B3 Đã KB Zalo (%)');

    const modalHtml = renderToStaticMarkup(createElement(CustomerCrmSalerModal, {
      open: true,
      initialTab: 'distribute',
      rows: [staleUncalled, { ...ROW, leadId: '55555555-5555-4555-8555-555555555555', profile: { ...ROW.profile, stage: 'has_phone', ownerUserId: null, salerId: null } }],
      filteredRows: [staleUncalled],
      salers,
      routing: { mode: 'by_page', protectZaloAndWon: true },
      teamRevision: 1,
      pageOptions: [{ pageId: '105252511858057', label: 'Đồng Thờ Hồng Hưng', count: 2 }],
      assignees: [{ userId: OWNER_ID, label: 'Lan' }],
      nowMs: NOW,
      busy: false,
      modalError: '',
      onClose: noop,
      onBulkAssign: async () => true,
      onSaveTeam: async () => true,
    }));
    expect(modalHtml).toContain('Xem trước kết quả chia số (Dry-Run)');
    expect(modalHtml).toContain('⚡ Phân bổ ngay 1 khách');
    expect(modalHtml).toContain('Đội Saler &amp; Phân Page (8)');

    // Synced modal validation: rescue_stale luôn tick protectZaloAndWon dù routing=false, team cap 40 ký tự & 50 page
    const rescueModalHtml = renderToStaticMarkup(createElement(CustomerCrmSalerModal, {
      open: true,
      initialTab: 'distribute',
      initialMode: 'rescue_stale',
      rows: [staleUncalled],
      filteredRows: [staleUncalled],
      salers,
      routing: { mode: 'by_page', protectZaloAndWon: false },
      teamRevision: 1,
      pageOptions: [{ pageId: '105252511858057', label: 'Đồng Thờ Hồng Hưng', count: 1 }],
      assignees: [],
      nowMs: NOW,
      busy: false,
      modalError: '',
      onClose: noop,
      onBulkAssign: async () => true,
      onSaveTeam: async () => true,
    }));
    expect(rescueModalHtml).toContain('disabled="" checked=""');

    const teamModalHtml = renderToStaticMarkup(createElement(CustomerCrmSalerModal, {
      open: true,
      initialTab: 'team',
      rows: [staleUncalled],
      filteredRows: [staleUncalled],
      salers: [{ ...salers[0]!, assignedPageIds: Array.from({ length: 50 }, (_, i) => String(100000 + i)) }],
      routing: { mode: 'by_page', protectZaloAndWon: true },
      teamRevision: 1,
      pageOptions: [{ pageId: '999999', label: 'Page 51', count: 0 }],
      assignees: [],
      nowMs: NOW,
      busy: false,
      modalError: '',
      onClose: noop,
      onBulkAssign: async () => true,
      onSaveTeam: async () => true,
    }));
    expect(teamModalHtml).toContain('maxLength="40"');
    expect(teamModalHtml).toContain('disabled=""');

    // Clearing "Chưa giao Saler" in Drawer & Row clears ownerUserId: null and Panel reloads full on multi-chunk failure
    const drawerSrc = read('./CustomerCrmDrawer.tsx');
    const rowSrc = read('./CustomerCrmRow.tsx');
    const panelSrc = read('./CustomerCrmPanel.tsx');
    expect(drawerSrc).toContain('ownerUserId: sid === null ? null : (chosen ? chosen.memberUserId : profile.ownerUserId)');
    expect(rowSrc).toContain('ownerUserId: sid === null ? null : (chosen ? chosen.memberUserId : profile.ownerUserId)');
    expect(panelSrc).toContain("if (input.assignments.length > CRM_BULK_ASSIGN_CHUNK) void loadRef.current('full');");
  });
});
