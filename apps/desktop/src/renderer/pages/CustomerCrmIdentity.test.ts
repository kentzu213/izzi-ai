import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CustomerCareCrmIdField, CustomerCareCrmIdentity, CustomerCareCrmRow } from '../../shared/customer-care-types';
import { CRM_IDENTITY_CONFLICT_MESSAGE, CRM_IDENTITY_OFF_MESSAGE, crmIdentityCardStart } from './customer-crm-identity';
import { CustomerCrmCard } from './CustomerCrmCard';
import { CustomerCrmRow } from './CustomerCrmRow';
import { profileFromRow } from './customer-crm-flow';
import { CustomerCrmIdentity, type CrmIdentityController, type CrmIdentityHandlers, type CustomerCrmIdentityProps } from './CustomerCrmIdentity';

const OWNER_ID = '66666666-6666-4666-8666-666666666666';
const AT = '2026-11-25T01:00:00.000Z';
const noop = () => undefined;

function field<T>(value: T, extra: Partial<CustomerCareCrmIdField<T>> = {}): CustomerCareCrmIdField<T> {
  return { value, confidence: 'high', kind: 'stated', source: 'ai', status: 'suggested', updatedAt: AT, evidence: [], ...extra };
}

type ConsentState = NonNullable<CustomerCareCrmIdentity['consent']>['state'];

function identity(state: ConsentState = 'granted', canAsk = false): CustomerCareCrmIdentity {
  return {
    version: AT,
    lastRunAt: AT,
    consent: { state, at: AT, noMarketing: false, canAsk },
    occasion: field<'tet'>('tet', { confidence: 'medium', kind: 'inferred' }),
    timeline: field<'before_tet'>('before_tet', { evidence: [{ source: 'page', at: AT, quote: 'shop giao trước Tết ạ' }] }),
    productFactIds: field(['ban-127']),
    addressForm: field<'chi'>('chi', { status: 'confirmed', source: 'staff' }),
    ageBand: field<Array<'25-34' | '35-44'>>(['25-34', '35-44'], {
      confidence: 'medium', kind: 'inferred', evidence: [{ source: 'customer', at: AT, quote: 'chị mua cho bố mẹ' }],
    }),
    family: field<{ recipient: 'parents' }>({ recipient: 'parents' }, { evidence: [{ source: 'customer', at: AT, quote: 'em mua cho bố mẹ ạ' }] }),
    interests: {
      adTitle: field('Bàn thờ gỗ gụ ưu đãi Tết', { source: 'ad' }),
      sharedLinks: [
        field({ title: 'Mẫu ẩn', domain: 'hidden.vn' }, { confidence: 'low' }),
        field({ title: 'Mẫu bàn thờ đẹp', domain: 'shopee.vn' }),
      ],
      budgetBand: field<'5m_15m'>('5m_15m', { confidence: 'medium' }),
    },
    persona: { ...field<'P2'>('P2'), summary: 'Tết/giỗ · Tết · cần trước Tết' },
  };
}

const ROW: CustomerCareCrmRow = {
  leadId: '44444444-4444-4444-8444-444444444444',
  pageId: '105252511858057',
  customerName: 'Nguyễn Thị Hoa',
  phone: '0901234567',
  zaloMentioned: false,
  leadStatus: 'contacted',
  phoneCapturedAt: AT,
  lastMessageAt: AT,
  recentMessages: [],
  profile: {
    stage: 'consulting', ownerUserId: OWNER_ID, addressForm: null, occasion: null, neededBy: null, productFactIds: [],
    nextStep: null, nextStepDueAt: null, lostReason: null, purchasedAt: null, note: null, updatedAt: null, updatedBy: null,
  },
  identity: identity(),
};

const PRODUCTS = [{ id: 'ban-127', label: 'Bàn thờ gỗ gụ 1m27' }];

function handlers(enabled: boolean | null = true): CrmIdentityHandlers {
  return { enabled, pageName: 'Hồng Hưng', act: vi.fn(), refresh: vi.fn() };
}

function render(overrides: Partial<CustomerCrmIdentityProps> = {}): string {
  return renderToStaticMarkup(createElement(CustomerCrmIdentity, {
    row: ROW, products: PRODUCTS, handlers: handlers(), showOccasion: true, ...overrides,
  }));
}

const withIdentity = (value: CustomerCareCrmIdentity, profile: Partial<CustomerCareCrmRow['profile']> = {}): CustomerCareCrmRow => ({
  ...ROW, identity: value, profile: { ...ROW.profile, ...profile },
});
const buttons = (html: string) => (html.match(/<button\b[^>]*>[^<]*(?:<span[^>]*><\/span>)?[^<]*<\/button>/g) ?? []);
const buttonText = (html: string) => buttons(html).map((button) => button.replace(/<[^>]+>/g, ''));

describe('CustomerCrmIdentity: the AI identity card', () => {
  it('shows each field with its badge and confidence, the age as an estimate, and Duyệt only on AI suggestions', () => {
    const html = render();
    expect(html).toContain('Nhận diện (AI)');
    expect(html).toContain('P2 · Tết/giỗ · Tết · cần trước Tết');
    expect(html).toContain('Độ tuổi (ước tính): 25–44');
    expect(html).toContain('tin cậy cao');
    expect(html).toContain('tin cậy vừa');
    expect(html).toContain('aria-label="Duyệt Chân dung: P2 · Tết/giỗ · Tết · cần trước Tết"');
    // "Xưng hô" was confirmed by staff: Sửa and Bỏ, no Duyệt.
    expect(html).not.toContain('aria-label="Duyệt Xưng hô');
    expect(html).toContain('aria-label="Sửa Xưng hô"');
    expect(html).toContain('aria-label="Bỏ Xưng hô: Chị"');
    expect(html).toContain('aria-label="Duyệt Độ tuổi (ước tính): 25–44"');
  });

  it('quotes the customer for family only, and names the source of any other quote', () => {
    const html = render();
    expect(html).toContain('<q class="v2-crm-card__quote">em mua cho bố mẹ ạ</q>');
    expect(html).toContain('<span class="v2-crm-card__quote">Shop: <q>shop giao trước Tết ạ</q></span>');
  });

  it('shows the source ad, the shared links as plain text and the budget; the ad takes no action', () => {
    const html = render();
    expect(html).toContain('Bàn thờ gỗ gụ ưu đãi Tết');
    expect(html).toContain('Mẫu bàn thờ đẹp · shopee.vn');
    expect(html).toContain('5–15 triệu');
    expect(html).not.toMatch(/<a\b|href=/);
    expect(html).not.toContain('aria-label="Bỏ Quảng cáo');
    // A low-confidence link stays hidden; the shown one keeps its server index (1) for its actions.
    expect(html).not.toContain('hidden.vn');
    expect(html).toContain('id="crm-identity-44444444-4444-4444-8444-444444444444"');
    expect(html).toContain('aria-label="Bỏ Liên kết khách gửi: Mẫu bàn thờ đẹp · shopee.vn"');
  });

  it('offers refresh and "Khách rút đồng ý" once the customer agreed, not the consent question', () => {
    const text = buttonText(render());
    expect(text).toContain('Cập nhật hồ sơ');
    expect(text).toContain('Khách rút đồng ý');
    expect(text).not.toContain('Xin phép khách');
  });

  it('without consent shows only the order layer, with its actions, and offers "Xin phép khách" when the server allows', () => {
    const html = render({ row: withIdentity(identity('unknown', true)) });
    expect(html).toContain('</span>Chưa hỏi</span>');
    for (const hidden of ['Chân dung', 'Xưng hô', 'bố mẹ', 'Độ tuổi', 'shopee.vn', 'Quảng cáo', '5–15 triệu']) {
      expect(html, hidden).not.toContain(hidden);
    }
    expect(html).toContain('Trước Tết');
    expect(html).toContain('aria-label="Duyệt Thời điểm: Trước Tết"');
    const ask = buttons(html).find((button) => button.includes('Xin phép khách'))!;
    expect(ask).not.toContain('disabled');
    expect(buttonText(html)).not.toContain('Khách rút đồng ý');
  });

  it('keeps "Xin phép khách" disabled, with the reason, when the server says izzi may not ask now', () => {
    const html = render({ row: withIdentity(identity('asked', false)) });
    const ask = buttons(html).find((button) => button.includes('Xin phép khách'))!;
    expect(ask).toContain('disabled');
    expect(ask).toContain('aria-describedby="crm-identity-ask-44444444-4444-4444-8444-444444444444"');
    expect(html).toContain('Chỉ xin phép được trong 24 giờ sau tin cuối của khách');
  });

  it('offers nothing after the customer refused or withdrew', () => {
    for (const state of ['declined', 'withdrawn'] as const) {
      const html = render({ row: withIdentity(identity(state, true)) });
      expect(html, state).toContain('</span>Từ chối</span>');
      expect(buttons(html), state).toEqual([]);
    }
  });

  it('says the AI profile is off and hides every AI action, keeping the values read-only and the withdrawal', () => {
    const html = render({ handlers: handlers(false) });
    expect(html).toContain(CRM_IDENTITY_OFF_MESSAGE);
    expect(html).toContain('P2 · Tết/giỗ');
    // Withdrawing protects the customer, so the server takes it with the AI profile off (backend 84c2523).
    expect(buttonText(html)).toEqual(['Khách rút đồng ý']);
    const unknown = render({ handlers: handlers(false), row: withIdentity(identity('unknown', true)) });
    expect(buttons(unknown)).toEqual([]);
  });

  it('shows a social-network link as its domain only, whatever title it carries', () => {
    const social = identity();
    social.interests = { ...social.interests!, sharedLinks: [field({ title: 'Trang cá nhân của Hoa', domain: 'facebook.com' })] };
    const html = render({ row: withIdentity(social) });
    expect(html).toContain('<span class="v2-crm-card__layer-value">facebook.com</span>');
    expect(html).not.toContain('Trang cá nhân');
  });

  it('shows the identity without any action on an older preload (no handlers)', () => {
    const html = render({ handlers: null });
    expect(html).toContain('P2 · Tết/giỗ');
    expect(buttons(html)).toEqual([]);
    expect(html).not.toContain(CRM_IDENTITY_OFF_MESSAGE);
  });

  it('lists the AI occasion only while staff left "Dịp mua" empty', () => {
    expect(render()).toContain('aria-label="Duyệt Dịp mua: Tết"');
    const staff = render({ row: withIdentity(identity(), { occasion: 'new_home' }) });
    expect(staff).not.toContain('Dịp mua');
    expect(render({ showOccasion: false })).not.toContain('Dịp mua');
  });

  it('shows the spinner while "Cập nhật hồ sơ" runs, with every action waiting', () => {
    const controller: CrmIdentityController = {
      state: { ...crmIdentityCardStart(ROW.identity), pending: 'refresh' },
      run: noop,
      refresh: noop,
    };
    const html = render({ controller });
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('v2-crm-card__spinner');
    expect(html).toContain('Đang cập nhật…');
    for (const button of buttons(html)) expect(button).toContain('disabled');
  });

  it('shows the last answer in a polite live region', () => {
    const controller: CrmIdentityController = {
      state: { baseVersion: AT, pending: null, message: { text: CRM_IDENTITY_CONFLICT_MESSAGE, tone: 'notice' } },
      run: noop,
      refresh: noop,
    };
    const html = render({ controller });
    expect(html).toContain(`role="status" aria-live="polite">${CRM_IDENTITY_CONFLICT_MESSAGE}</p>`);
    expect(render()).toContain('role="status" aria-live="polite"></p>');
  });

  it('renders nothing for a row without identity (a server without S3)', () => {
    expect(render({ row: { ...ROW, identity: undefined } })).toBe('');
  });
});

describe('CustomerCrmRow editor with the identity card (table view)', () => {
  const editor = (identityHandlers: CrmIdentityHandlers | null) => renderToStaticMarkup(createElement('table', null, createElement('tbody', null,
    createElement(CustomerCrmRow, {
      row: ROW, profile: profileFromRow(ROW), edit: null, saving: false, expanded: true, nowMs: Date.parse(AT), assignees: [],
      products: PRODUCTS, canDelete: false, purging: false, onChange: noop, onToggle: noop, onSave: noop, onCopy: noop,
      onPurge: noop, onReapply: noop, onDiscard: noop, identityHandlers,
    }))));

  it('shows the AI identity under the staff form, with the AI occasion as its own line', () => {
    const html = editor(handlers());
    expect(html).toContain('Nhận diện (AI)');
    expect(html).toContain('v2-crm-card__layer-label">Dịp mua');
    expect(html).toContain('aria-label="Duyệt Dịp mua: Tết"');
    expect(html.indexOf('Nhận diện (AI)')).toBeGreaterThan(html.indexOf('Giai đoạn'));
  });

  it('keeps the staff form unchanged when the row has no identity', () => {
    const html = renderToStaticMarkup(createElement('table', null, createElement('tbody', null, createElement(CustomerCrmRow, {
      row: { ...ROW, identity: undefined }, profile: profileFromRow(ROW), edit: null, saving: false, expanded: true, nowMs: Date.parse(AT),
      assignees: [], products: PRODUCTS, canDelete: false, purging: false, onChange: noop, onToggle: noop, onSave: noop, onCopy: noop,
      onPurge: noop, onReapply: noop, onDiscard: noop, identityHandlers: handlers(),
    }))));
    expect(html).not.toContain('Nhận diện');
    expect(html.toLowerCase()).not.toMatch(/tuổi|hôn nhân|tôn giáo|giới tính/);
  });
});

describe('CustomerCrmCard with identity actions (graph view)', () => {
  const card = (row: CustomerCareCrmRow, identityHandlers: CrmIdentityHandlers | null = handlers()) => renderToStaticMarkup(
    createElement(CustomerCrmCard, {
      row, nowMs: Date.parse(AT), assignees: [], products: PRODUCTS, onCopy: noop, onOpenProfile: noop, onClose: noop, identityHandlers,
    }),
  );

  it('keeps one "Dịp mua" and acts on the AI occasion in that row', () => {
    const html = card(ROW);
    // One visible "Dịp mua" (the facts row); the identity section never repeats it.
    expect(html.match(/<dt>Dịp mua<\/dt>/g)).toHaveLength(1);
    expect(html).not.toContain('v2-crm-card__layer-label">Dịp mua');
    expect(html).toContain('aria-label="Duyệt Dịp mua: Tết"');
    expect(html).toContain('aria-label="Sửa Dịp mua"');
    expect(html).toContain('aria-label="Bỏ Dịp mua: Tết"');
  });

  it('offers no occasion action when staff set it, and none at all without handlers', () => {
    expect(card(withIdentity(identity(), { occasion: 'new_home' }))).not.toContain('aria-label="Duyệt Dịp mua');
    expect(buttonText(card(ROW, null))).toEqual(['✕', 'Sao chép', 'Mở hồ sơ']);
  });
});
