import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type {
  CustomerCareCrmProfileInput,
  CustomerCareCrmRow,
} from '../../shared/customer-care-types';
import {
  composeCrmNote,
  effectiveCrmIdentity,
  EMPTY_CRM_STAFF_CONTEXT,
  splitCrmNote,
} from '../../shared/customer-crm-enterprise';
import { CustomerCrmCard } from './CustomerCrmCard';
import {
  CrmAdsWorkspace,
  CrmEnterpriseKpiStrip,
  CrmLifecycleWorkspace,
  CrmPortraitInspector,
  CrmSalerWorkspace,
  applyLifecycleNextStep,
  applyStaffContextPatch,
  formatFreeNoteTruncationWarning,
} from './CustomerCrmEnterpriseViews';
import { CustomerCrmDisplaySwitch } from './CustomerCrmPanel';
import { CustomerCrmRow, updateCrmRowFreeNote, type CustomerCrmRowProps } from './CustomerCrmRow';
import { CRM_CONFLICT_MESSAGE, isCallToday, profileFromRow } from './customer-crm-flow';
import { crmRowsToGraph, type CrmDisplay } from './customer-crm-graph';

const OWNER_ID = '66666666-6666-4666-8666-666666666666';
const vn = (day: number, hour: number) => new Date(Date.UTC(2026, 10, day, hour - 7, 0)).toISOString();
const NOW = Date.parse(vn(25, 10));
const noop = () => undefined;

const PRODUCTS = [
  { id: 'ban-127', label: 'Bàn thờ gỗ gụ 1m27' },
  { id: 'ngu-su', label: 'Bộ ngũ sự đồng đỏ 60cm' },
];
const ASSIGNEES = [{ userId: OWNER_ID, label: 'Lan' }];

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
  note: composeCrmNote('Khách hỏi kỹ thước Lỗ Ban', {
    ...EMPTY_CRM_STAFF_CONTEXT,
    consent: 'granted',
    adTitle: 'Bàn thờ chung cư chuẩn Lỗ Ban',
  }),
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
};

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
    note: null,
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
};

const ALL_ROWS: readonly CustomerCareCrmRow[] = [ROW_HOT, ROW_DELIVERED, ROW_LOST, ROW_DNC];

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
  it('summarizes total leads, call-today count, P1–P4 portraits, Ads-consented leads and due lifecycle items', () => {
    const html = renderToStaticMarkup(
      createElement(CrmEnterpriseKpiStrip, {
        rows: ALL_ROWS,
        products: PRODUCTS,
        nowMs: NOW,
        display: 'saler',
        onSelectDisplay: noop,
      }),
    );
    expect(html).toContain('Tổng khách');
    expect(html).toContain('Cần gọi hôm nay');
    expect(html).toContain('Chân dung P1–P4');
    expect(html).toContain('Đủ điều kiện Ads');
    expect(html).toContain('Lịch Hậu mãi / Remarketing');
    expect(html).toContain('P1:1 · P2:1 · P3:0 · P4:1');
  });
});

describe('CrmPortraitInspector — 5-Layer Customer Reasoning & AI Staff Context', () => {
  it('renders all 5 reasoning layers (Tầng 1 → Tầng 5), completeness %, source badges and customer quotes', () => {
    const html = renderToStaticMarkup(
      createElement(CrmPortraitInspector, {
        variant: 'panel',
        row: ROW_HOT,
        profile: profileFromRow(ROW_HOT),
        products: PRODUCTS,
        nowMs: NOW,
        onChangeProfile: noop,
        onClose: noop,
      }),
    );

    expect(html).toContain('Tầng 1 · Độ tuổi ước tính');
    expect(html).toContain('Tầng 2 · Giới tính &amp; Xưng hô');
    expect(html).toContain('Tầng 3 · Tình trạng hôn nhân &amp; Gia đình');
    expect(html).toContain('Tầng 4 · Mối quan tâm gần đây');
    expect(html).toContain('Tầng 5 · Chân dung khách hàng tổng hợp');
    expect(html).toContain('aria-valuenow="100"');
    expect(html).toContain('100% (6/6 chiều)');
    expect(html).toContain('P1 · Gia chủ nhà mới / Sắm chính');
    expect(html).toContain('AI suy luận');
    expect(html).toContain('Đã xác nhận');
    expect(html).toContain('<q class="v2-crm-portrait__quote">');
    expect(html).toContain('hai vợ chồng anh chuẩn bị nhập trạch');
    expect(html).toContain('QC: Bàn thờ chung cư chuẩn Lỗ Ban');
    expect(html).toContain('Link: shopee.vn');
    expect(html).toContain('Bổ sung ngữ cảnh cho AI (Saler ghi nhận từ hội thoại / cuộc gọi)');
  });

  it('locks AI context editing when detailsUnreadable is true', () => {
    const unreadable: CustomerCareCrmRow = {
      ...ROW_HOT,
      profile: { ...ROW_HOT.profile, note: null, detailsUnreadable: true },
    };
    const html = renderToStaticMarkup(
      createElement(CrmPortraitInspector, {
        row: unreadable,
        profile: profileFromRow(unreadable),
        products: PRODUCTS,
        nowMs: NOW,
        onChangeProfile: noop,
      }),
    );
    expect(html).toContain('Không đọc được chi tiết khách này');
    expect(html).not.toContain('Bổ sung ngữ cảnh cho AI (Saler ghi nhận từ hội thoại / cuộc gọi)');
    expect(html).not.toContain('<select');
  });

  it('embeds inside CustomerCrmCard extraSection and lights up P1–P4 / Ad / Link graph hubs via effectiveCrmIdentity', () => {
    const enriched: CustomerCareCrmRow = {
      ...ROW_HOT,
      identity: effectiveCrmIdentity(ROW_HOT, PRODUCTS, NOW),
    };
    const graph = crmRowsToGraph([enriched], PRODUCTS, ASSIGNEES);
    const nodeIds = graph.nodes.map((n) => n.id);
    expect(nodeIds).toContain('persona:P1');
    expect(nodeIds).toContain('ad:bàn thờ chung cư chuẩn lỗ ban');
    expect(nodeIds).toContain('interest:shopee.vn');

    const cardHtml = renderToStaticMarkup(
      createElement(CustomerCrmCard, {
        row: enriched,
        nowMs: NOW,
        assignees: ASSIGNEES,
        products: PRODUCTS,
        onCopy: noop,
        onOpenProfile: noop,
        onClose: noop,
        extraSection: createElement(CrmPortraitInspector, {
          variant: 'card',
          row: ROW_HOT,
          profile: profileFromRow(ROW_HOT),
          products: PRODUCTS,
          nowMs: NOW,
          onChangeProfile: noop,
        }),
      }),
    );
    expect(cardHtml.indexOf('Chân dung 5 tầng tư duy')).toBeGreaterThan(-1);
    expect(cardHtml.indexOf('Chân dung 5 tầng tư duy')).toBeLessThan(cardHtml.indexOf('>Mở hồ sơ<'));
  });
});

describe('3 Enterprise Workspaces — Saler, Ads & Lifecycle', () => {
  it('renders CrmSalerWorkspace sorted by priorityScore descending with opener, discovery questions and objection hints', () => {
    const html = renderToStaticMarkup(
      createElement(CrmSalerWorkspace, {
        rows: [ROW_LOST, ROW_DELIVERED, ROW_HOT],
        products: PRODUCTS,
        assignees: ASSIGNEES,
        savingIds: new Set<string>(),
        nowMs: NOW,
        onChangeProfile: noop,
        onCopyText: noop,
        onOpenProfile: noop,
      }),
    );

    expect(html).toContain('Ưu tiên nóng');
    expect(html).toContain('Sao chép kịch bản');
    expect(html).toContain('Áp dụng việc tiếp theo');
    expect(html).toContain('Bổ sung ngữ cảnh AI');
    expect(html.indexOf('Nguyễn Văn Hùng')).toBeLessThan(html.indexOf('Trần Thị Mai'));
    expect(html.indexOf('Trần Thị Mai')).toBeLessThan(html.indexOf('Lê Quốc Tuấn'));
  });

  it('renders CrmAdsWorkspace with all 4 campaign buckets, P1–P4 Ad Angles and SHA-256 export privacy counts', () => {
    const html = renderToStaticMarkup(
      createElement(CrmAdsWorkspace, {
        rows: ALL_ROWS,
        products: PRODUCTS,
        nowMs: NOW,
        onNotify: noop,
      }),
    );

    expect(html).toContain('Khách ấm chưa chốt (high_intent)');
    expect(html).toContain('Hạt giống khách đã cọc / đã mua (vip_lookalike)');
    expect(html).toContain('Đánh thức khách cũ (reengage_lost)');
    expect(html).toContain('Tệp loại trừ bắt buộc (suppressed)');
    expect(html).toContain('P1 · Gia chủ nhà mới / Sắm chính');
    expect(html).toContain('P2 · Gia đình truyền thống / Lễ Tết &amp; Hiếu kính');
    expect(html).toContain('P3 · Khách mua Quà biếu / Tri ân');
    expect(html).toContain('P4 · Khách khảo giá / Cân nhắc ngân sách');
    expect(html).toContain('Đủ điều kiện xuất: 1 khách');
    expect(html).toContain('Loại bảo vệ quyền riêng tư: 2 chưa đồng ý · 1 đã chặn');
    expect(html).toContain('Sao chép CSV SHA-256');
    expect(html).toContain('Tải file CSV SHA-256');
  });

  it('renders CrmLifecycleWorkspace with post-sale & remarketing milestones and 24h Messenger vs Zalo/Call badges', () => {
    const html = renderToStaticMarkup(
      createElement(CrmLifecycleWorkspace, {
        rows: [ROW_HOT, ROW_DELIVERED, ROW_LOST, ROW_DNC],
        products: PRODUCTS,
        nowMs: NOW,
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

    const freshDelivered: CustomerCareCrmRow = {
      ...ROW_DELIVERED,
      lastMessageAt: vn(25, 9),
    };
    const freshHtml = renderToStaticMarkup(
      createElement(CrmLifecycleWorkspace, {
        rows: [freshDelivered],
        products: PRODUCTS,
        nowMs: NOW,
        onChangeProfile: noop,
        onCopyText: noop,
        onOpenProfile: noop,
      }),
    );
    expect(freshHtml).toContain('Trong cửa sổ 24h Messenger');
  });
});

describe('CustomerCrmRow — [izzi-ctx] preservation without exposing raw tag in <textarea>', () => {
  function renderRow(profile: CustomerCareCrmProfileInput, withPortraitTrigger = false): string {
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
      onInspectPortrait: withPortraitTrigger ? noop : undefined,
    };
    return renderToStaticMarkup(createElement('table', null, createElement('tbody', null, createElement(CustomerCrmRow, props))));
  }

  it('hides the trailing [izzi-ctx: ...] line in <textarea> and preserves it across staff free-note edits', () => {
    const initial = applyStaffContextPatch(
      { ...BASE_PROFILE, note: 'Ghi chú ban đầu của Saler' },
      { persona: 'P1', ageBand: '35-44', consent: 'granted', sharedDomain: 'shopee.vn' },
    );
    expect(initial.note).toContain('[izzi-ctx: v=1;');

    const htmlBefore = renderRow(initial, true);
    expect(htmlBefore).toContain('>Chân dung<');
    expect(htmlBefore).toContain('>Ghi chú ban đầu của Saler</textarea>');
    expect(htmlBefore).not.toContain('[izzi-ctx:');

    const edited = updateCrmRowFreeNote(initial, 'Khách hẹn thứ Bảy qua xưởng xem mộc');
    expect(edited.note).toContain('Khách hẹn thứ Bảy qua xưởng xem mộc');
    expect(edited.note).toContain('[izzi-ctx: v=1; persona=P1; age=35-44; consent=granted; domain=shopee.vn]');

    const parsed = splitCrmNote(edited.note);
    expect(parsed.freeNote).toBe('Khách hẹn thứ Bảy qua xưởng xem mộc');
    expect(parsed.ctx).toMatchObject({
      persona: 'P1',
      ageBand: '35-44',
      consent: 'granted',
      sharedDomain: 'shopee.vn',
    });

    const htmlAfter = renderRow(edited, false);
    expect(htmlAfter).not.toContain('>Chân dung<');
    expect(htmlAfter).toContain('>Khách hẹn thứ Bảy qua xưởng xem mộc</textarea>');
    expect(htmlAfter).not.toContain('[izzi-ctx:');
  });

  it('keeps CustomerCrmEnterpriseViews free of storage, graph-store, fetch and console APIs', () => {
    const source = readFileSync(fileURLToPath(new URL('./CustomerCrmEnterpriseViews.tsx', import.meta.url)), 'utf8');
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
    expect(source).not.toMatch(/electronAPI|ipcRenderer|aibase|graph_nodes|universe|fetch\(/i);
    expect(source).not.toMatch(/console\.|\.log\(/);
  });

  it('refuses to truncate a 960-char freeNote silently, renders 409 conflicts in CrmPortraitInspector, uses saved rows in Ads, and reopens lost leads to consulting in Lifecycle', () => {
    // 1. 960-char freeNote protection
    const longFree = 'N'.repeat(960);
    const longProfile: CustomerCareCrmProfileInput = { ...BASE_PROFILE, note: longFree };
    const unchanged = applyStaffContextPatch(longProfile, {
      persona: 'P1',
      consent: 'granted',
      adTitle: 'Chiến dịch Tết gỗ gụ',
      sharedDomain: 'shopee.vn',
    });
    expect(unchanged).toBe(longProfile);
    expect(unchanged.note).toBe(longFree);
    expect(formatFreeNoteTruncationWarning(longFree)).toBe(
      'Ghi chú đang dài 960/1000 ký tự — hãy rút gọn ghi chú trước khi gắn thêm nhãn ngữ cảnh để không mất nội dung.',
    );

    // 2. 409 conflict & error visibility inside CrmPortraitInspector and non-table tabs
    const conflictHtml = renderToStaticMarkup(
      createElement(CrmPortraitInspector, {
        variant: 'card',
        row: ROW_HOT,
        profile: profileFromRow(ROW_HOT),
        products: PRODUCTS,
        nowMs: NOW,
        hasConflict: true,
        rowError: CRM_CONFLICT_MESSAGE,
        onResolveConflict: noop,
        onChangeProfile: noop,
      }),
    );
    expect(conflictHtml).toContain(CRM_CONFLICT_MESSAGE);
    expect(conflictHtml).toContain('Mở hồ sơ xử lý xung đột');

    // Verify CustomerCrmPanel passes canonical saved `rows` (not `liveRows`) into CrmAdsWorkspace
    const panelSource = readFileSync(fileURLToPath(new URL('./CustomerCrmPanel.tsx', import.meta.url)), 'utf8');
    expect(panelSource).toMatch(/<CrmAdsWorkspace\s+rows=\{rows\}/);
    expect(panelSource).not.toMatch(/<CrmAdsWorkspace\s+rows=\{liveRows\}/);

    // 3. Reopen `stage: 'lost'` -> `'consulting'` (clearing `lostReason`) when scheduling Lifecycle next step
    const lostProfile = profileFromRow(ROW_LOST);
    expect(lostProfile.stage).toBe('lost');
    expect(lostProfile.lostReason).toBe('price');
    const dueTodayIso = new Date(NOW + 2 * 3600_000).toISOString();
    const reopened = applyLifecycleNextStep(lostProfile, {
      suggestedNextStep: 'Remarketing khách cũ: hỏi thăm mẫu bàn thờ',
      suggestedDueIso: dueTodayIso,
    });
    expect(reopened.stage).toBe('consulting');
    expect(reopened.lostReason).toBeNull();
    expect(reopened.nextStep).toBe('Remarketing khách cũ: hỏi thăm mẫu bàn thờ');
    expect(isCallToday(reopened, NOW)).toBe(true);

    // Delivered customer keeps `stage: 'delivered'` on post-sale milestones
    const deliveredProfile = profileFromRow(ROW_DELIVERED);
    const postSaleApplied = applyLifecycleNextStep(deliveredProfile, {
      suggestedNextStep: 'Chăm sóc N+1',
      suggestedDueIso: dueTodayIso,
    });
    expect(postSaleApplied.stage).toBe('delivered');
    expect(postSaleApplied.purchasedAt).toBe('2026-11-17');
  });
});
