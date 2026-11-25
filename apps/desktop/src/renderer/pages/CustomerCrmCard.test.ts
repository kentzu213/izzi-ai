import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CustomerCareCrmIdField, CustomerCareCrmIdentity, CustomerCareCrmRow } from '../../shared/customer-care-types';
import { CustomerCrmCard, type CustomerCrmCardProps } from './CustomerCrmCard';

const OWNER_ID = '66666666-6666-4666-8666-666666666666';
/** Wall-clock time in Vietnam (UTC+7), whatever zone this PC is in. */
const vn = (day: number, hour: number) => new Date(Date.UTC(2026, 10, day, hour - 7, 0)).toISOString();
const NOW = Date.parse(vn(24, 14));
const noop = () => undefined;

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
  profile: {
    stage: 'consulting',
    ownerUserId: OWNER_ID,
    addressForm: 'chi',
    occasion: 'new_home',
    neededBy: '2026-12-20',
    productFactIds: ['ban-127', 'gone-fact'],
    nextStep: 'Gọi lại báo giá',
    nextStepDueAt: vn(24, 9),
    lostReason: null,
    purchasedAt: null,
    note: 'Nhà mới',
    updatedAt: '2026-11-21T09:30:00.000Z',
    updatedBy: OWNER_ID,
  },
};

const AT = '2026-11-25T01:00:00.000Z';

function field<T>(value: T, extra: Partial<CustomerCareCrmIdField<T>> = {}): CustomerCareCrmIdField<T> {
  return { value, confidence: 'high', kind: 'stated', source: 'ai', status: 'suggested', updatedAt: AT, evidence: [], ...extra };
}

const IDENTITY: CustomerCareCrmIdentity = {
  version: 'v1',
  lastRunAt: AT,
  consent: { state: 'asked', at: AT, noMarketing: false, canAsk: false },
  occasion: null,
  timeline: null,
  productFactIds: null,
  addressForm: field<'chi'>('chi', { status: 'confirmed', source: 'staff' }),
  ageBand: field<Array<'35-44'>>(['35-44'], { confidence: 'medium', kind: 'inferred' }),
  family: field<{ recipient: 'parents' }>({ recipient: 'parents' }, { evidence: [{ source: 'customer', at: AT, quote: 'em mua cho bố mẹ ạ' }] }),
  interests: { adTitle: null, sharedLinks: [field({ title: null, domain: 'tiktok.com' }, { confidence: 'low' })], budgetBand: null },
  persona: { ...field<'P2'>('P2'), summary: 'Mua cho nhà mới' },
};

function render(overrides: Partial<CustomerCrmCardProps> = {}): string {
  const props: CustomerCrmCardProps = {
    row: ROW,
    nowMs: NOW,
    assignees: [{ userId: OWNER_ID, label: 'Lan' }],
    products: [{ id: 'ban-127', label: 'Bàn thờ gỗ gụ 1m27' }],
    onCopy: noop,
    onOpenProfile: noop,
    onClose: noop,
    ...overrides,
  };
  return renderToStaticMarkup(createElement(CustomerCrmCard, props));
}

describe('CustomerCrmCard (thẻ nhận diện khách)', () => {
  it('shows the phone with "Sao chép", the stage, the owner and the next step', () => {
    const html = render();
    expect(html).toContain('Nguyễn Thị Hoa');
    expect(html).toContain('0901 234 567');
    expect(html).toContain('aria-label="Sao chép số của Nguyễn Thị Hoa"');
    expect(html).toContain('>Sao chép<');
    expect(html).toContain('Đang tư vấn');
    expect(html).toContain('Lan');
    expect(html).toContain('Gọi lại báo giá');
    expect(html).toContain('Quá hạn');
    expect(html).toContain('09:00 24/11');
    expect(html).toContain('Có nhắc Zalo');
  });

  it('shows the products and the occasion, counting products not on this machine', () => {
    const html = render();
    expect(html).toContain('Bàn thờ gỗ gụ 1m27');
    expect(html).toContain('1 sản phẩm khác');
    expect(html).toContain('Nhà mới');
    expect(html).toContain('20/12/2026');
  });

  it('offers "Mở hồ sơ" and a close button', () => {
    const html = render();
    expect(html).toContain('>Mở hồ sơ<');
    expect(html).toContain('aria-label="Đóng thẻ khách"');
  });

  it('shows no identity section until the backend sends one', () => {
    const html = render();
    expect(html).not.toContain('Nhận diện');
    expect(html).not.toContain('Chân dung');
  });

  it('shows the identity with a consent chip, badges, confidence, the family quote and the age as an estimate', () => {
    const row: CustomerCareCrmRow = { ...ROW, identity: IDENTITY };
    const html = render({ row });
    expect(html).toContain('Nhận diện');
    expect(html).toContain('v2-crm-card__consent is-neutral"><span class="v2-visually-hidden">Xin phép lưu hồ sơ: </span>Đã hỏi</span>');
    expect(html).toContain('P2 · Mua cho nhà mới');
    expect(html).toContain('Mua cho bố mẹ');
    expect(html).toContain('<q class="v2-crm-card__quote">em mua cho bố mẹ ạ</q>');
    expect(html).toMatch(/>AI</);
    expect(html).toMatch(/>Đã duyệt</);
    expect(html).toContain('tin cậy cao');
    expect(html).toContain('Độ tuổi (ước tính): 35–44');
    expect(html).toContain('tin cậy vừa');
    // A low-confidence field is never shown.
    expect(html).not.toContain('tiktok.com');
  });

  it('shows no identity section when every field is hidden and no consent came', () => {
    const hidden: CustomerCareCrmIdentity = { ...IDENTITY, consent: null, addressForm: null, ageBand: null, family: null, persona: null };
    expect(render({ row: { ...ROW, identity: hidden } })).not.toContain('Nhận diện');
  });

  it('says when the details could not be opened', () => {
    const unreadable: CustomerCareCrmRow = {
      ...ROW,
      profile: { ...ROW.profile, occasion: null, productFactIds: [], nextStep: null, note: null, detailsUnreadable: true },
    };
    expect(render({ row: unreadable })).toContain('Không đọc được chi tiết khách này.');
  });

  it('uses "Khách ·" and the last three digits when the customer has no name', () => {
    const html = render({ row: { ...ROW, customerName: null } });
    expect(html).toContain('Khách ·567');
  });
});
