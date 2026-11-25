import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type {
  CustomerCareCrmIdentity,
  CustomerCareCrmPersona,
  CustomerCareCrmProfileInput,
  CustomerCareCrmRow,
} from '../../shared/customer-care-types';
import { composeCrmNote, splitCrmNote, type CrmAdsIdentityState } from '../../shared/customer-crm-enterprise';
import { CustomerCrmCard } from './CustomerCrmCard';
import {
  CrmAdsWorkspace,
  CrmEnterpriseKpiStrip,
  CrmLifecycleWorkspace,
  CrmSalerWorkspace,
  applyLifecycleNextStep,
} from './CustomerCrmEnterpriseViews';
import { CustomerCrmDisplaySwitch } from './CustomerCrmPanel';
import { CustomerCrmRow, updateCrmRowFreeNote, type CustomerCrmRowProps } from './CustomerCrmRow';
import { CRM_CONFLICT_MESSAGE, isCallToday, profileFromRow } from './customer-crm-flow';
import type { CrmAdsExportOutcome } from './customer-crm-ads-export';
import type { CrmDisplay } from './customer-crm-graph';

const OWNER_ID = '66666666-6666-4666-8666-666666666666';
const vn = (day: number, hour: number) => new Date(Date.UTC(2026, 10, day, hour - 7, 0)).toISOString();
const NOW = Date.parse(vn(25, 10));
const noop = () => undefined;
const IDENTITY_ON: CrmAdsIdentityState = { identityEnabled: true, identityUnavailable: false };
const IDENTITY_OFF: CrmAdsIdentityState = { identityEnabled: false, identityUnavailable: false };
const NO_DRAFTS: Readonly<Record<string, CustomerCareCrmProfileInput>> = {};
const noExport = async (): Promise<CrmAdsExportOutcome> => ({ ok: false, message: 'x' });

const PRODUCTS = [
  { id: 'ban-127', label: 'Bàn thờ gỗ gụ 1m27' },
  { id: 'ngu-su', label: 'Bộ ngũ sự đồng đỏ 60cm' },
];
const ASSIGNEES = [{ userId: OWNER_ID, label: 'Lan' }];

/** A server identity after "Đồng ý", carrying only a persona. */
function grantedIdentity(persona: CustomerCareCrmPersona): CustomerCareCrmIdentity {
  return {
    version: vn(25, 9),
    lastRunAt: vn(25, 9),
    consent: { state: 'granted', at: vn(24, 9), noMarketing: false, canAsk: false, eraseRequestedAt: null },
    occasion: null,
    timeline: null,
    productFactIds: null,
    addressForm: null,
    ageBand: null,
    family: null,
    interests: null,
    persona: {
      value: persona,
      confidence: 'high',
      kind: 'inferred',
      source: 'ai',
      status: 'suggested',
      updatedAt: vn(25, 9),
      evidence: [],
      summary: 'Khách sắm đồ thờ',
    },
  };
}

const BASE_PROFILE: CustomerCareCrmProfileInput = {
  stage: 'consulting',
  ownerUserId: OWNER_ID,
  addressForm: null,
  occasion: 'new_home',
  neededBy: '2026-12-20',
  productFactIds: ['ban-127'],
  nextStep: 'Gọi báo giá',
  nextStepDueAt: vn(25, 8),
  lostReason: null,
  purchasedAt: null,
  note: composeCrmNote('Khách hỏi kỹ thước Lỗ Ban', { timeline: 'before_tet', consent: null }),
};

const ROW_HOT: CustomerCareCrmRow = {
  leadId: '44444444-4444-4444-8444-444444444401',
  pageId: '105252511858057',
  customerName: 'Nguyễn Văn Hùng',
  phone: '0901234567',
  zaloMentioned: true,
  leadStatus: 'contacted',
  phoneCapturedAt: vn(25, 9),
  lastMessageAt: vn(25, 9),
  recentMessages: [
    {
      text: 'Anh sinh năm 1986, hai vợ chồng anh chuẩn bị nhập trạch căn hộ mới, ngân sách tầm 18 triệu, xem mẫu này https://shopee.vn/mau-ban-tho-127',
      at: vn(25, 9),
    },
  ],
  profile: { ...BASE_PROFILE, updatedAt: vn(25, 9), updatedBy: OWNER_ID },
  identity: grantedIdentity('P1'),
};

const ROW_DELIVERED: CustomerCareCrmRow = {
  leadId: '44444444-4444-4444-8444-444444444402',
  pageId: '105252511858057',
  customerName: 'Trần Thị Mai',
  phone: '0912345678',
  zaloMentioned: false,
  leadStatus: 'closed',
  phoneCapturedAt: vn(15, 10),
  lastMessageAt: vn(15, 10),
  recentMessages: [{ text: 'Chị mua bộ ngũ sự biếu bố mẹ dịp Tết', at: vn(15, 10) }],
  profile: {
    stage: 'delivered',
    ownerUserId: OWNER_ID,
    addressForm: 'chi',
    occasion: 'tet',
    neededBy: null,
    productFactIds: ['ngu-su'],
    nextStep: null,
    nextStepDueAt: null,
    lostReason: null,
    purchasedAt: '2026-11-17',
    note: 'Đã lắp đặt hoàn thiện',
    updatedAt: vn(18, 9),
    updatedBy: OWNER_ID,
  },
  identity: grantedIdentity('P2'),
};

/** No identity: the chat reads like a price hunter (P4 under the old heuristics), which must not count now. */
const ROW_LOST: CustomerCareCrmRow = {
  leadId: '44444444-4444-4444-8444-444444444403',
  pageId: '105252511858057',
  customerName: 'Lê Quốc Tuấn',
  phone: '0987654321',
  zaloMentioned: true,
  leadStatus: 'contacted',
  phoneCapturedAt: vn(10, 14),
  lastMessageAt: vn(10, 14),
  recentMessages: [{ text: 'Giá bao nhiêu tiền shop ơi, dưới 4 triệu có mẫu nào không?', at: vn(10, 14) }],
  profile: {
    stage: 'lost',
    ownerUserId: null,
    addressForm: null,
    occasion: null,
    neededBy: null,
    productFactIds: [],
    nextStep: null,
    nextStepDueAt: null,
    lostReason: 'price',
    purchasedAt: null,
    note: '[izzi-ctx: v=1; persona=P4; consent=granted]',
    updatedAt: vn(12, 9),
    updatedBy: OWNER_ID,
  },
};

const ROW_DNC: CustomerCareCrmRow = {
  leadId: '44444444-4444-4444-8444-444444444404',
  pageId: '105252511858057',
  customerName: 'Phạm Hoàng',
  phone: '0933445566',
  zaloMentioned: false,
  leadStatus: 'closed',
  phoneCapturedAt: vn(5, 10),
  lastMessageAt: vn(5, 10),
  recentMessages: [],
  profile: {
    stage: 'do_not_contact',
    ownerUserId: null,
    addressForm: null,
    occasion: null,
    neededBy: null,
    productFactIds: [],
    nextStep: null,
    nextStepDueAt: null,
    lostReason: null,
    purchasedAt: null,
    note: null,
    updatedAt: vn(5, 11),
    updatedBy: OWNER_ID,
  },
  identity: grantedIdentity('P3'),
};

const ALL_ROWS: readonly CustomerCareCrmRow[] = [ROW_HOT, ROW_DELIVERED, ROW_LOST, ROW_DNC];

const readSource = (name: string) => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');

describe('CustomerCrmDisplaySwitch — 5 Enterprise CRM modes', () => {
  it('renders all 5 modes (Bảng | Sơ đồ | Saler | Ads | Hậu mãi) and marks the active mode', () => {
    const modes: ReadonlyArray<{ id: CrmDisplay; label: string }> = [
      { id: 'table', label: 'Bảng' },
      { id: 'graph', label: 'Sơ đồ' },
      { id: 'saler', label: 'Saler' },
      { id: 'ads', label: 'Ads' },
      { id: 'lifecycle', label: 'Hậu mãi' },
    ];

    for (const active of modes) {
      const html = renderToStaticMarkup(createElement(CustomerCrmDisplaySwitch, { display: active.id, onChange: noop }));
      expect(html).toContain('aria-label="Kiểu xem"');
      for (const item of modes) {
        const pressed = item.id === active.id ? 'true' : 'false';
        expect(html).toMatch(new RegExp(`aria-pressed="${pressed}"[^>]*>${item.label}<`));
      }
    }
  });
});

describe('CrmEnterpriseKpiStrip', () => {
  const kpiValue = (html: string, label: string) =>
    new RegExp(`${label}</span><strong class="v2-crm-kpi__value">(\\d+)</strong>`).exec(html)?.[1];

  it('counts P1–P4 from the consented server persona only, and Ads-eligible customers through the export gate', () => {
    const html = renderToStaticMarkup(
      createElement(CrmEnterpriseKpiStrip, {
        rows: ALL_ROWS,
        products: PRODUCTS,
        nowMs: NOW,
        identityState: IDENTITY_ON,
        display: 'saler',
        onSelectDisplay: noop,
      }),
    );
    expect(html).toContain('Tổng khách');
    expect(html).toContain('Cần gọi hôm nay');
    expect(html).toContain('Lịch Hậu mãi / Remarketing');
    // ROW_LOST's legacy persona tag and price-hunting chat no longer make a P4; ROW_DNC is suppressed.
    expect(html).toContain('P1:1 · P2:1 · P3:0 · P4:0');
    expect(kpiValue(html, 'Đủ điều kiện Ads')).toBe('2');

    const off = renderToStaticMarkup(
      createElement(CrmEnterpriseKpiStrip, {
        rows: ALL_ROWS,
        products: PRODUCTS,
        nowMs: NOW,
        identityState: IDENTITY_OFF,
        display: 'saler',
        onSelectDisplay: noop,
      }),
    );
    expect(kpiValue(off, 'Đủ điều kiện Ads')).toBe('0');
  });
});

describe('One portrait UI per customer: the server identity card', () => {
  it('has no second portrait (no inspector, no staff context editor, no 5-layer strip) anywhere in the CRM', () => {
    const views = readSource('./CustomerCrmEnterpriseViews.tsx');
    expect(views).not.toMatch(/CrmPortraitInspector|applyStaffContextPatch|Bổ sung ngữ cảnh|v2-crm-portrait|portrait-strip|T1 Tuổi/);
    expect(views).not.toMatch(/composeCrmNote|formatStaffContextTag/);

    const panel = readSource('./CustomerCrmPanel.tsx');
    expect(panel).not.toMatch(/CrmPortraitInspector|renderExtraCard|onInspectPortrait|table-split/);
    for (const file of ['./CustomerCrmCard.tsx', './CustomerCrmGraph.tsx', './CustomerCrmRow.tsx']) {
      expect(readSource(file)).not.toMatch(/extraSection|renderExtraCard|onInspectPortrait/);
    }
  });

  it('shows the identity card on the graph card, once', () => {
    const cardHtml = renderToStaticMarkup(
      createElement(CustomerCrmCard, {
        row: ROW_HOT,
        nowMs: NOW,
        assignees: ASSIGNEES,
        products: PRODUCTS,
        onCopy: noop,
        onOpenProfile: noop,
        onClose: noop,
      }),
    );
    expect(cardHtml.split('class="v2-crm-card__identity"').length - 1).toBe(1);
    expect(cardHtml).toContain('Nhận diện (AI)');
    expect(cardHtml).not.toContain('Chân dung 5 tầng');
  });
});

describe('3 Enterprise Workspaces — Saler, Ads & Lifecycle', () => {
  it('renders CrmSalerWorkspace sorted by priority with opener and objection hints, without a portrait strip or gender', () => {
    const html = renderToStaticMarkup(
      createElement(CrmSalerWorkspace, {
        rows: [ROW_LOST, ROW_DELIVERED, ROW_HOT],
        products: PRODUCTS,
        assignees: ASSIGNEES,
        savingIds: new Set<string>(),
        nowMs: NOW,
        identityEnabled: true,
        onChangeProfile: noop,
        onCopyText: noop,
        onOpenProfile: noop,
      }),
    );

    expect(html).toContain('Ưu tiên nóng');
    expect(html).toContain('Sao chép kịch bản');
    expect(html).toContain('Áp dụng việc tiếp theo');
    expect(html).toContain('Mở hồ sơ');
    expect(html).not.toContain('Bổ sung ngữ cảnh AI');
    expect(html).not.toMatch(/T1 Tuổi|Chân dung \d+%|Nam ·|Nữ ·|hôn nhân/);
    expect(html.indexOf('Nguyễn Văn Hùng')).toBeLessThan(html.indexOf('Trần Thị Mai'));
    expect(html.indexOf('Trần Thị Mai')).toBeLessThan(html.indexOf('Lê Quốc Tuấn'));
  });

  it('with the AI profile off, the Saler script still uses the products and occasion guessed from the chat', () => {
    const guessRow: CustomerCareCrmRow = {
      ...ROW_LOST,
      leadId: '44444444-4444-4444-8444-444444444405',
      recentMessages: [{ text: 'Nhà em sắp nhập trạch, cần bàn thờ gỗ gụ 1m27', at: vn(25, 9) }],
      profile: { ...ROW_LOST.profile, stage: 'consulting', lostReason: null, note: null },
      // The server sent an identity with an empty order layer (flag-off prod, or nothing found yet).
      identity: {
        ...grantedIdentity('P1'),
        consent: { state: 'unknown', at: null, noMarketing: false, canAsk: false, eraseRequestedAt: null },
        persona: null,
      },
    };
    const render = (identityEnabled: boolean | null) => renderToStaticMarkup(createElement(CrmSalerWorkspace, {
      rows: [guessRow],
      products: PRODUCTS,
      assignees: ASSIGNEES,
      savingIds: new Set<string>(),
      nowMs: NOW,
      identityEnabled,
      onChangeProfile: noop,
      onCopyText: noop,
      onOpenProfile: noop,
    }));
    for (const html of [render(false), render(null), render(true)]) {
      expect(html).toContain('quan tâm Bàn thờ gỗ gụ 1m27 cho dịp nhà mới / nhập trạch');
    }
  });

  it('shows a save conflict on the Saler card and points to the table', () => {
    const html = renderToStaticMarkup(
      createElement(CrmSalerWorkspace, {
        rows: [ROW_HOT],
        products: PRODUCTS,
        assignees: ASSIGNEES,
        savingIds: new Set<string>(),
        edits: {
          [ROW_HOT.leadId]: {
            draft: profileFromRow(ROW_HOT),
            rejected: profileFromRow(ROW_HOT),
            error: CRM_CONFLICT_MESSAGE,
            baseUpdatedAt: ROW_HOT.profile.updatedAt,
          },
        },
        nowMs: NOW,
        identityEnabled: true,
        onChangeProfile: noop,
        onCopyText: noop,
        onOpenProfile: noop,
      }),
    );
    expect(html).toContain(CRM_CONFLICT_MESSAGE);
  });

  it('renders CrmAdsWorkspace with the 4 buckets, P1–P4 angles and export counts from the export selection', () => {
    const html = renderToStaticMarkup(
      createElement(CrmAdsWorkspace, { rows: ALL_ROWS, identityState: IDENTITY_ON, drafts: NO_DRAFTS, onExport: noExport, onNotify: noop }),
    );

    expect(html).toContain('Khách ấm chưa chốt (high_intent)');
    expect(html).toContain('Hạt giống khách đã cọc / đã mua (vip_lookalike)');
    expect(html).toContain('Đánh thức khách cũ (reengage_lost)');
    expect(html).toContain('Tệp loại trừ bắt buộc (suppressed)');
    expect(html).toContain('P1 · Gia chủ nhà mới / Sắm chính');
    expect(html).toContain('P4 · Khách khảo giá / Cân nhắc ngân sách');
    expect(html).toContain('Đủ điều kiện xuất: 2 khách');
    expect(html).toContain('Loại bảo vệ quyền riêng tư: 1 chưa đồng ý · 1 đã chặn');
    expect(html).toContain('Tệp chỉ có cột phone');
    expect(html).not.toContain('Xuất tệp Ads đang khoá');
  });

  it('locks the export with a reason while the AI profile is off or could not be loaded', () => {
    const off = renderToStaticMarkup(createElement(CrmAdsWorkspace, { rows: ALL_ROWS, identityState: IDENTITY_OFF, drafts: NO_DRAFTS, onExport: noExport, onNotify: noop }));
    expect(off).toContain('Xuất tệp Ads đang khoá: AI hồ sơ khách chưa bật cho dự án này');
    expect(off).toContain('Đủ điều kiện xuất: 0 khách');
    expect(off.match(/<button[^>]*disabled=""[^>]*>(Sao chép|Tải file) CSV SHA-256/g)).toHaveLength(2);

    const unread = renderToStaticMarkup(
      createElement(CrmAdsWorkspace, { rows: ALL_ROWS, identityState: { identityEnabled: true, identityUnavailable: true }, drafts: NO_DRAFTS, onExport: noExport, onNotify: noop }),
    );
    expect(unread).toContain('Xuất tệp Ads tạm khoá: AI hồ sơ khách chưa tải được');
  });

  it('builds the CSV only from the fresh read the panel runs on export, and the preview honours unsaved drafts', () => {
    const views = readSource('./CustomerCrmEnterpriseViews.tsx');
    expect(views).not.toMatch(/buildMetaCustomAudienceCsv/);
    expect(views.match(/await onExport\(exportTarget\)/g)).toHaveLength(1);
    expect(views.match(/await freshCsv\(/g)).toHaveLength(2);
    expect(views).toContain('izzi đọc lại toàn bộ danh sách');

    const panel = readSource('./CustomerCrmPanel.tsx');
    expect(panel).toMatch(/crmFreshAdsExport\(/);
    expect(panel).toMatch(/onExport=\{exportAds\}/);
    expect(panel).toMatch(/drafts=\{adsDrafts\}/);

    const withDraft = renderToStaticMarkup(createElement(CrmAdsWorkspace, {
      rows: ALL_ROWS,
      identityState: IDENTITY_ON,
      drafts: { [ROW_HOT.leadId]: { ...profileFromRow(ROW_HOT), stage: 'do_not_contact' } },
      onExport: noExport,
      onNotify: noop,
    }));
    expect(withDraft).toContain('Đủ điều kiện xuất: 1 khách');
    expect(withDraft).toContain('Loại bảo vệ quyền riêng tư: 1 chưa đồng ý · 2 đã chặn');
  });

  it('styles the two Ads section headings', () => {
    const css = readSource('../styles/v2/customer-crm.css');
    expect(css).toMatch(/\.izzi-v2 \.v2-crm-section-title \{[^}]*font-weight: var\(--v2-font-weight-semibold\);/);
    expect(readSource('./CustomerCrmEnterpriseViews.tsx').match(/className="v2-crm-section-title"/g)).toHaveLength(2);
  });

  it('gives Saler and Hậu mãi the AI switch, so they fall back to chat guesses for the order layer while it is off', () => {
    const panel = readSource('./CustomerCrmPanel.tsx');
    expect(panel).toMatch(/<CrmSalerWorkspace[^>]*identityEnabled=\{identityEnabled\}/);
    expect(panel).toMatch(/<CrmLifecycleWorkspace[^>]*identityEnabled=\{identityEnabled\}/);
  });

  it('renders CrmLifecycleWorkspace with post-sale & remarketing milestones and 24h Messenger vs Zalo/Call badges', () => {
    const html = renderToStaticMarkup(
      createElement(CrmLifecycleWorkspace, {
        rows: [ROW_HOT, ROW_DELIVERED, ROW_LOST, ROW_DNC],
        products: PRODUCTS,
        nowMs: NOW,
        identityEnabled: false,
        onChangeProfile: noop,
        onCopyText: noop,
        onOpenProfile: noop,
      }),
    );

    expect(html).toContain('Chăm sóc sau bán (N+1, N+7, N+30)');
    expect(html).toContain('Remarketing khách chưa chốt');
    expect(html).toContain('N+1 · Kiểm tra nhận hàng/lắp đặt');
    expect(html).toContain('N+7 · Xin ảnh thực tế');
    expect(html).toContain('N+30 / Trước Tết &amp; Dịp lễ');
    expect(html).toContain('Zalo / Gọi điện (ngoài 24h)');
    expect(html).toContain('Sao chép tin nhắn');
    expect(html).toContain('Đặt thành việc tiếp theo');
    expect(html).not.toContain('Phạm Hoàng');

    const freshDelivered: CustomerCareCrmRow = { ...ROW_DELIVERED, lastMessageAt: vn(25, 9) };
    const freshHtml = renderToStaticMarkup(
      createElement(CrmLifecycleWorkspace, {
        rows: [freshDelivered],
        products: PRODUCTS,
        nowMs: NOW,
        identityEnabled: false,
        onChangeProfile: noop,
        onCopyText: noop,
        onOpenProfile: noop,
      }),
    );
    expect(freshHtml).toContain('Trong cửa sổ 24h Messenger');
  });
});

describe('CustomerCrmRow — the note editor hides [izzi-ctx] and drops its profile-layer keys', () => {
  function renderRow(profile: CustomerCareCrmProfileInput): string {
    const props: CustomerCrmRowProps = {
      row: { ...ROW_HOT, profile: { ...profile, updatedAt: vn(25, 9), updatedBy: OWNER_ID } },
      profile,
      edit: null,
      saving: false,
      expanded: true,
      nowMs: NOW,
      assignees: ASSIGNEES,
      products: PRODUCTS,
      canDelete: false,
      purging: false,
      onChange: noop,
      onToggle: noop,
      onSave: noop,
      onCopy: noop,
      onPurge: noop,
      onReapply: noop,
      onDiscard: noop,
    };
    return renderToStaticMarkup(createElement('table', null, createElement('tbody', null, createElement(CustomerCrmRow, props))));
  }

  it('shows only the free note, and a staff edit keeps the timeline and a refusal but drops persona, age and consent=granted', () => {
    const legacy: CustomerCareCrmProfileInput = {
      ...BASE_PROFILE,
      note: 'Ghi chú ban đầu của Saler\n[izzi-ctx: v=1; persona=P1; age=35-44; timeline=this_month; consent=granted; domain=shopee.vn]',
    };
    const htmlBefore = renderRow(legacy);
    expect(htmlBefore).toContain('>Ghi chú ban đầu của Saler</textarea>');
    expect(htmlBefore).not.toContain('[izzi-ctx:');
    // The only portrait is the identity card's own line; there is no separate "Chân dung" button any more.
    expect(htmlBefore).not.toMatch(/<button[^>]*>Chân dung</);
    expect(htmlBefore.split('class="v2-crm-card__identity"').length - 1).toBe(1);

    const edited = updateCrmRowFreeNote(legacy, 'Khách hẹn thứ Bảy qua xưởng xem mộc');
    expect(edited.note).toBe('Khách hẹn thứ Bảy qua xưởng xem mộc\n[izzi-ctx: v=1; timeline=this_month]');
    expect(splitCrmNote(edited.note).ctx).toEqual({ timeline: 'this_month', consent: null });

    const refused = updateCrmRowFreeNote({ ...BASE_PROFILE, note: 'Cũ\n[izzi-ctx: v=1; consent=declined]' }, 'Mới');
    expect(refused.note).toBe('Mới\n[izzi-ctx: v=1; consent=declined]');
  });

  it('keeps CustomerCrmEnterpriseViews free of storage, graph-store, fetch and console APIs', () => {
    const source = readSource('./CustomerCrmEnterpriseViews.tsx');
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
    expect(source).not.toMatch(/electronAPI|ipcRenderer|aibase|graph_nodes|universe|fetch\(/i);
    expect(source).not.toMatch(/console\.|\.log\(/);
  });

  it('uses saved rows in Ads, and reopens lost leads to consulting in Lifecycle', () => {
    const panelSource = readSource('./CustomerCrmPanel.tsx');
    expect(panelSource).toMatch(/<CrmAdsWorkspace\s+rows=\{rows\}/);
    expect(panelSource).not.toMatch(/<CrmAdsWorkspace\s+rows=\{liveRows\}/);
    expect(panelSource).toMatch(/identityState=\{adsIdentityState\}/);

    const lostProfile = profileFromRow(ROW_LOST);
    expect(lostProfile.stage).toBe('lost');
    const dueTodayIso = new Date(NOW + 2 * 3600_000).toISOString();
    const reopened = applyLifecycleNextStep(lostProfile, {
      suggestedNextStep: 'Remarketing khách cũ: hỏi thăm mẫu bàn thờ',
      suggestedDueIso: dueTodayIso,
    });
    expect(reopened.stage).toBe('consulting');
    expect(reopened.lostReason).toBeNull();
    expect(reopened.nextStep).toBe('Remarketing khách cũ: hỏi thăm mẫu bàn thờ');
    expect(isCallToday(reopened, NOW)).toBe(true);

    const postSaleApplied = applyLifecycleNextStep(profileFromRow(ROW_DELIVERED), {
      suggestedNextStep: 'Chăm sóc N+1',
      suggestedDueIso: dueTodayIso,
    });
    expect(postSaleApplied.stage).toBe('delivered');
    expect(postSaleApplied.purchasedAt).toBe('2026-11-17');
  });
});
