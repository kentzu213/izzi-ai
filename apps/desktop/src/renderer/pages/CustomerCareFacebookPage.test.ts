import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type {
  CustomerCareFacebookError,
  CustomerCareFacebookPageChoice,
  CustomerCarePageConnection,
  CustomerCareSetup,
} from '../../shared/customer-care-types';
import {
  CustomerCareFacebookPagePanel,
  facebookErrorMessage,
  filterPageChoices,
  pageStatusLabel,
  setupForSave,
  type CustomerCareFacebookPagePanelProps,
} from './CustomerCareFacebookPage';
import { formatBackfillSummaryNotice } from './customer-care-page-flow';

const PAGE = '105252511858057';
const CONNECTED: CustomerCarePageConnection = {
  state: 'connected',
  pageId: PAGE,
  pageName: 'Đồ Đồng Hồng Hưng',
  status: 'active',
  missingScopes: [],
  verifiedAt: '2026-11-17T00:00:00.000Z',
};
const PAGES: CustomerCareFacebookPageChoice[] = [
  { pageId: PAGE, name: 'Đồ Đồng Hồng Hưng', eligible: true, reason: 'eligible' },
  { pageId: '1234567890', name: 'Page phụ', eligible: false, reason: 'missing_moderate_task' },
  { pageId: '2234567890', name: null, eligible: false, reason: 'missing_page_token' },
];
const CHOICES = { choiceId: '33333333-3333-4333-8333-333333333333', expiresAt: '2026-11-17T00:15:00.000Z', pages: PAGES, missingScopes: [] };

function render(overrides: Partial<CustomerCareFacebookPagePanelProps> = {}): string {
  const props: CustomerCareFacebookPagePanelProps = {
    connection: { state: 'not_connected' },
    canManage: true,
    busy: false,
    waitingForFacebook: false,
    choices: null,
    selectedPageId: '',
    onConnect: vi.fn(),
    onDisconnect: vi.fn(),
    onSelectPage: vi.fn(),
    onConfirmPage: vi.fn(),
    onCancelChoices: vi.fn(),
    ...overrides,
  };
  return renderToStaticMarkup(createElement(CustomerCareFacebookPagePanel, props));
}

/** The opening tag of the button whose visible text is `label`, or null. */
function button(html: string, label: string): string | null {
  const match = html.match(new RegExp(`<button([^>]*)>${label}</button>`));
  return match ? match[1] : null;
}

function radio(html: string, pageId: string): string | null {
  const match = html.match(new RegExp(`<input([^>]*value="${pageId}"[^>]*)/?>`));
  return match ? match[1] : null;
}

describe('CustomerCareFacebookPagePanel connection actions', () => {
  it('offers connect to an owner or manager when no Page is connected', () => {
    const html = render();
    expect(html).toContain('Chưa kết nối Page Facebook');
    expect(button(html, 'Kết nối Page Facebook')).not.toMatch(/disabled/);
    expect(button(html, 'Ngắt kết nối')).toBeNull();
  });

  it('shows the verified Page with backfill, reconnect/add-page and disconnect', () => {
    const html = render({ connection: CONNECTED });
    expect(html).toContain('Đã kết nối: Đồ Đồng Hồng Hưng');
    expect(button(html, 'Đồng bộ khách cũ \\(90 ngày\\)')).not.toBeNull();
    expect(button(html, 'Kết nối lại / Thêm Page CRM')).not.toBeNull();
    expect(button(html, 'Ngắt kết nối')).not.toBeNull();
    expect(button(html, 'Kết nối Page Facebook')).toBeNull();
    expect(html).toContain('Xưởng tranh đồng Đại Long');
  });

  it('asks for re-authorization and lists missing scopes', () => {
    const html = render({ connection: { ...CONNECTED, status: 'needs_reauth', missingScopes: ['pages_messaging'] } });
    expect(html).toContain('Cần kết nối lại: Đồ Đồng Hồng Hưng');
    expect(html).toContain('pages_messaging');
  });

  it('hides every Page action from editors, reviewers and viewers', () => {
    for (const connection of [CONNECTED, { state: 'not_connected' } as const]) {
      const html = render({ connection, canManage: false, choices: CHOICES });
      expect(button(html, 'Kết nối Page Facebook')).toBeNull();
      expect(button(html, 'Đồng bộ khách cũ \\(90 ngày\\)')).toBeNull();
      expect(button(html, 'Kết nối lại / Thêm Page CRM')).toBeNull();
      expect(button(html, 'Ngắt kết nối')).toBeNull();
      expect(html).not.toContain('ccw-page-choice');
      expect(html).toContain('Chỉ chủ sở hữu và quản lý workspace');
    }
  });

  it('explains a backend without Page routes and disables connect', () => {
    const html = render({ connection: { state: 'unsupported' } });
    expect(html).toContain('Máy chủ chưa bật kết nối Page Facebook.');
    expect(button(html, 'Kết nối Page Facebook')).toMatch(/disabled/);
  });

  it('disables actions while busy and tells the operator it is waiting for Facebook', () => {
    const html = render({ connection: CONNECTED, busy: true, waitingForFacebook: true });
    expect(button(html, 'Đồng bộ khách cũ \\(90 ngày\\)')).toMatch(/disabled/);
    expect(button(html, 'Kết nối lại / Thêm Page CRM')).toMatch(/disabled/);
    expect(button(html, 'Ngắt kết nối')).toMatch(/disabled/);
    expect(html).toContain('Đang chờ bạn cấp quyền trên Facebook');
  });

  it('escapes Page names', () => {
    const html = render({ connection: { ...CONNECTED, pageName: '<img src=x onerror=alert(1)>' } });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });
});

describe('CustomerCareFacebookPagePanel picker', () => {
  it('lists eligible Pages as selectable and ineligible ones disabled with the reason', () => {
    const html = render({ choices: CHOICES });
    expect(radio(html, PAGE)).not.toMatch(/disabled/);
    expect(radio(html, '1234567890')).toMatch(/disabled/);
    expect(radio(html, '2234567890')).toMatch(/disabled/);
    expect(html).toContain('chưa có quyền quản lý tin nhắn');
    expect(html).toContain('Facebook không cấp quyền truy cập cho Page này');
    expect(html).toContain('Page chưa có tên');
  });

  it('enables confirmation only for a selected eligible Page', () => {
    expect(button(render({ choices: CHOICES }), 'Dùng Page đã chọn')).toMatch(/disabled/);
    expect(button(render({ choices: CHOICES, selectedPageId: '1234567890' }), 'Dùng Page đã chọn')).toMatch(/disabled/);
    const ready = render({ choices: CHOICES, selectedPageId: PAGE });
    expect(button(ready, 'Dùng Page đã chọn')).not.toMatch(/disabled/);
    expect(radio(ready, PAGE)).toMatch(/checked/);
    expect(button(render({ choices: CHOICES, selectedPageId: PAGE, busy: true }), 'Dùng Page đã chọn')).toMatch(/disabled/);
  });

  it('offers a filter only when the Page list is long', () => {
    expect(render({ choices: CHOICES })).not.toContain('ccw-page-filter');
    const many = Array.from({ length: 12 }, (_, index) => ({ ...PAGES[0], pageId: String(300_000 + index) }));
    expect(render({ choices: { ...CHOICES, pages: many } })).toContain('ccw-page-filter');
  });

  it('tells how to make a Business portfolio Page appear', () => {
    const html = render({ choices: CHOICES });
    expect(html).toContain('Không thấy Page');
    expect(html).toContain('Chỉ định người');
  });

  it('explains an empty Page list and scopes Facebook did not grant', () => {
    const html = render({ choices: { ...CHOICES, pages: [], missingScopes: ['pages_messaging'] } });
    expect(html).toContain('Không có Page nào');
    expect(html).toContain('pages_messaging');
  });

  it('pre-checks eligible Pages (capped at 10) for 90-day CRM backfill and shows importOnly primary CTA when already connected', () => {
    const multiChoices = {
      ...CHOICES,
      pages: [
        { pageId: PAGE, name: 'Đồng Thờ Hồng Hưng', eligible: true, reason: 'eligible' as const },
        { pageId: '631891669999823', name: 'Xưởng tranh đồng Đại Long', eligible: true, reason: 'eligible' as const },
        { pageId: '741891669999824', name: 'Đồ đồng Đại Long', eligible: true, reason: 'eligible' as const },
        { pageId: '1234567890', name: 'Page phụ', eligible: false, reason: 'missing_moderate_task' as const },
      ],
    };
    const html = render({ connection: CONNECTED, choices: multiChoices });
    expect(html).toContain('Trích xuất SĐT &amp; lịch sử khách hàng (90 ngày) vào CRM (3/3 Page, tối đa 10 Page/lần):');
    // Connected primary Page is automatically preselected as the radio choice so the operator cannot pick the wrong primary Page by mistake
    expect(radio(html, PAGE)).toMatch(/checked/);
    expect(button(html, 'Trích xuất 3 Page vào CRM \\(Giữ Page đang trực\\)')).not.toMatch(/disabled/);
    expect(button(html, 'Đổi Page chính &amp; Trích xuất')).toMatch(/disabled/);
    // Choosing a different eligible Page enables switching primary Page
    const switchedHtml = render({ connection: CONNECTED, choices: multiChoices, selectedPageId: '631891669999823' });
    expect(button(switchedHtml, 'Đổi Page chính &amp; Trích xuất')).not.toMatch(/disabled/);
    const checkboxes = html.match(/<input type="checkbox"[^>]*>/g) ?? [];
    expect(checkboxes).toHaveLength(3);
    for (const cb of checkboxes) expect(cb).toContain('checked=""');

    const twelvePages = Array.from({ length: 12 }, (_, idx) => ({
      pageId: `1000000000${String(idx + 10)}`,
      name: `Page ${idx + 1}`,
      eligible: true,
      reason: 'eligible' as const,
    }));
    const cappedHtml = render({ connection: CONNECTED, choices: { ...CHOICES, pages: twelvePages } });
    expect(cappedHtml).toContain('(10/10 Page, tối đa 10 Page/lần):');
    expect(button(cappedHtml, 'Trích xuất 10 Page vào CRM \\(Giữ Page đang trực\\)')).not.toMatch(/disabled/);
    const cappedCheckboxes = cappedHtml.match(/<input type="checkbox"[^>]*>/g) ?? [];
    expect(cappedCheckboxes).toHaveLength(12);
    expect(cappedCheckboxes.filter((cb) => cb.includes('checked=""'))).toHaveLength(10);
    expect(cappedCheckboxes.filter((cb) => cb.includes('disabled=""'))).toHaveLength(2);
  });

  it('renders all 3 connected Pages with primary + CRM badges, multi-Page sync CTA, and anti-1-click Facebook guidance', () => {
    const multiConnected: CustomerCarePageConnection = {
      ...CONNECTED,
      pageName: 'Đồng Thờ Hồng Hưng',
      crmPages: [
        { pageId: '631891669999823', pageName: 'Xưởng tranh đồng Đại Long', verifiedAt: '2026-11-17T00:00:00.000Z' },
        { pageId: '741891669999824', pageName: 'Đồ đồng Đại Long', verifiedAt: '2026-11-17T00:00:00.000Z' },
      ],
    };
    const html = render({ connection: multiConnected, waitingForFacebook: true });
    expect(html).toContain(
      'Đã kết nối 3 Page: Đồng Thờ Hồng Hưng (Trực trả lời) · Xưởng tranh đồng Đại Long, Đồ đồng Đại Long (Đồng bộ CRM)',
    );
    expect(html).toContain('🟢 Đồng Thờ Hồng Hưng · Đang trực trả lời');
    expect(html).toContain('🟣 Xưởng tranh đồng Đại Long · Đồng bộ CRM');
    expect(html).toContain('🟣 Đồ đồng Đại Long · Đồng bộ CRM');
    expect(button(html, 'Đồng bộ khách cũ \\(3 Page · 90 ngày\\)')).not.toBeNull();
    expect(html).toContain('Chỉnh sửa cài đặt trước đó');
    expect(html).toContain('Chỉnh sửa quyền truy cập');
  });

  it('warns prominently on PagePicker when Pages lack messaging scope and offers a direct button to reopen Facebook settings', () => {
    const partialChoices = {
      ...CHOICES,
      pages: [
        { pageId: PAGE, name: 'Đồng Thờ Hồng Hưng', eligible: true, reason: 'eligible' as const },
        { pageId: '631891669999823', name: 'Xưởng tranh đồng Đại Long', eligible: false, reason: 'missing_messaging_scope' as const },
        { pageId: '741891669999824', name: 'Đồ đồng Đại Long', eligible: false, reason: 'missing_messaging_scope' as const },
      ],
    };
    const html = render({ connection: CONNECTED, choices: partialChoices });
    expect(html).toContain('Có 2 Page chưa được tích cấp quyền Tin nhắn ở cửa sổ Facebook vừa rồi');
    expect(button(html, 'Mở lại Facebook để tích thêm Page')).not.toMatch(/disabled/);
    expect(radio(html, '631891669999823')).toMatch(/disabled/);
    expect(radio(html, '741891669999824')).toMatch(/disabled/);
    expect(html).toContain("Chưa tích cấp quyền Tin nhắn trên Facebook (bấm &#x27;Chỉnh sửa cài đặt trước đó&#x27; để bật)");
    // Only 1 Page is actually eligible for backfill, so the CTA says 1 Page instead of falsely claiming 3 Pages
    expect(button(html, 'Trích xuất 1 Page vào CRM \\(Giữ Page đang trực\\)')).not.toMatch(/disabled/);
  });
});

describe('filterPageChoices', () => {
  const pages: CustomerCareFacebookPageChoice[] = [
    { pageId: '105252511858057', name: 'Đồng Thờ Hồng Hưng', eligible: true, reason: 'eligible' },
    { pageId: '631891669999823', name: 'Tri Thức Việt', eligible: true, reason: 'eligible' },
    { pageId: '2234567890', name: null, eligible: false, reason: 'missing_page_token' },
  ];

  it('keeps every Page for a blank query', () => {
    expect(filterPageChoices(pages, '   ')).toEqual(pages);
  });

  it('matches names without accents or case', () => {
    expect(filterPageChoices(pages, 'dong tho').map((page) => page.pageId)).toEqual(['105252511858057']);
    expect(filterPageChoices(pages, 'TRI THỨC').map((page) => page.pageId)).toEqual(['631891669999823']);
  });

  it('matches a Page ID fragment', () => {
    expect(filterPageChoices(pages, '22345').map((page) => page.pageId)).toEqual(['2234567890']);
  });
});

describe('CustomerCareFacebookPage helpers', () => {
  it('labels every connection state for the status grid', () => {
    expect(pageStatusLabel(CONNECTED)).toBe('Đã kết nối');
    expect(pageStatusLabel({ ...CONNECTED, status: 'needs_reauth' })).toBe('Cần kết nối lại');
    expect(pageStatusLabel({ state: 'not_connected' })).toBe('Chưa kết nối');
    expect(pageStatusLabel({ state: 'unavailable' })).toBe('Chưa kiểm tra được');
    expect(pageStatusLabel({ state: 'unsupported' })).toBe('Máy chủ chưa hỗ trợ');
  });

  it('maps every error code to Vietnamese text and specific reasons to specific advice', () => {
    const errors: CustomerCareFacebookError[] = [
      'auth', 'forbidden', 'access_changed', 'invalid_input', 'declined', 'expired', 'unsupported', 'unavailable',
      'not_configured', 'rejected', 'page_bound_elsewhere', 'no_pages', 'invalid-response',
    ];
    const messages = errors.map((error) => facebookErrorMessage(error));
    expect(new Set(messages).size).toBe(errors.length);
    for (const message of messages) expect(message).toMatch(/[ăâđêôơưạảấầẩậắằẳặẹẻẽếềểễệịỉọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i);
    expect(facebookErrorMessage('declined')).toContain('từ chối');
    // 401 / signed out asks the user to sign in; it is not the role message.
    expect(facebookErrorMessage('auth')).toMatch(/^Hãy đăng nhập/);
    expect(facebookErrorMessage('auth')).not.toBe(facebookErrorMessage('forbidden'));
    expect(facebookErrorMessage('unsupported')).toBe('Máy chủ chưa bật kết nối Page Facebook.');
    expect(facebookErrorMessage('rejected', 'choice_expired')).toContain('hết hạn');
    expect(facebookErrorMessage('rejected', 'page_not_eligible')).toContain('chưa đủ điều kiện');
    expect(facebookErrorMessage('rejected', 'choice_consumed')).not.toBe(facebookErrorMessage('rejected'));
    for (const reason of ['token_invalid', 'token_app_mismatch', 'token_page_mismatch'] as const) {
      expect(facebookErrorMessage('rejected', reason)).toContain('kết nối lại');
      expect(facebookErrorMessage('rejected', reason)).toContain('Facebook');
    }
  });

  it('saves the connected Page ID and name, and leaves the setup alone otherwise', () => {
    const setup: CustomerCareSetup = { merchantName: 'Shop', pageId: '99999', pageName: 'Cũ', handoffTarget: 'Sale', facts: [] };
    expect(setupForSave(setup, CONNECTED)).toEqual({ ...setup, pageId: PAGE, pageName: 'Đồ Đồng Hồng Hưng' });
    expect(setupForSave(setup, { ...CONNECTED, pageName: null })).toEqual({ ...setup, pageId: PAGE, pageName: '' });
    expect(setupForSave(setup, { ...CONNECTED, pageName: 'x'.repeat(150) }).pageName).toHaveLength(120);
    for (const connection of [{ state: 'not_connected' }, { state: 'unavailable' }, { state: 'unsupported' }] as const) {
      expect(setupForSave(setup, connection)).toEqual(setup);
    }
    expect(setupForSave(setup, undefined)).toEqual(setup);
  });

  it('formats backfill summary with explicit Vietnamese skippedPages warning instead of silent success', () => {
    const notice = formatBackfillSummaryNotice({
      pagesProcessed: 1,
      conversationsScanned: 115,
      leadsImported: 18,
      messagesStored: 42,
      namesSealed: 18,
      skippedPages: [
        { pageId: '631891669999823', pageName: 'Xưởng tranh đồng Đại Long', reason: 'permission_missing' },
        { pageId: '741891669999824', pageName: 'Đồ đồng Đại Long', reason: 'permission_missing' },
      ],
    });
    expect(notice).toContain('Đã đồng bộ 1 Page (quét 115 hội thoại)');
    expect(notice).toContain('Cảnh báo — có 2 Page bị bỏ qua chưa đồng bộ được');
    expect(notice).toContain('Xưởng tranh đồng Đại Long (chưa được tích cấp quyền Tin nhắn trên Facebook)');
    expect(notice).toContain('Đồ đồng Đại Long (chưa được tích cấp quyền Tin nhắn trên Facebook)');
  });
});
