import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CustomerCareCrmIdentity, CustomerCareCrmProfile, CustomerCareCrmRow } from './customer-care-types';
import { parseCareCrmProfileInput } from '../main/customer-care/care-crm';
import {
  CARE_CRM_MAX_NOTE,
  EMPTY_CRM_STAFF_CONTEXT,
  buildCustomerPortrait,
  buildLifecyclePlan,
  buildMetaCustomAudienceCsv,
  buildSalerPlaybook,
  composeCrmNote,
  containsSensitiveHouseholdTerm,
  effectiveCrmIdentity,
  extractSafeSharedLink,
  isCrmRowAdsSuppressed,
  maxFreeNoteLength,
  normalizeVietnamPhoneForMeta,
  sanitizeCtxDomain,
  splitCrmNote,
  summarizeAdsAudiences,
  summarizeCareCrmSegments,
  wouldTruncateFreeNote,
  type CrmEnterpriseProduct,
  type CrmStaffContext,
} from './customer-crm-enterprise';

const NOW_ISO = '2026-11-25T02:00:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);
const HOUR_MS = 60 * 60 * 1000;

const PRODUCTS: readonly CrmEnterpriseProduct[] = [
  { id: 'ban-tho-gu', label: 'Bàn thờ gỗ gụ chạm sen 1m97' },
  { id: 'ngu-su-dong', label: 'Bộ ngũ sự đồng đỏ khảm tam khí 60cm' },
  { id: 'tranh-quan-am', label: 'Tranh Quan Âm mạ vàng hộp quà tặng' },
];

function makeProfile(overrides: Partial<CustomerCareCrmProfile> = {}): CustomerCareCrmProfile {
  return {
    stage: 'consulting',
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
    updatedAt: '2026-11-24T10:00:00.000Z',
    updatedBy: null,
    ...overrides,
  };
}

function makeRow(overrides: Partial<CustomerCareCrmRow> = {}, profileOverrides: Partial<CustomerCareCrmProfile> = {}): CustomerCareCrmRow {
  return {
    leadId: '11111111-1111-4111-8111-111111111111',
    pageId: '105252511858057',
    customerName: 'Khách Ẩn Danh',
    phone: '0901234567',
    zaloMentioned: true,
    leadStatus: 'new',
    phoneCapturedAt: '2026-11-24T08:00:00.000Z',
    lastMessageAt: '2026-11-25T01:00:00.000Z',
    recentMessages: [],
    profile: makeProfile(profileOverrides),
    ...overrides,
  };
}

describe('A1 · [izzi-ctx] codec on profile.note', () => {
  it('round-trips a full staff context tag cleanly while keeping freeNote separate', () => {
    const rawNote = [
      'Khách hẹn cuối tuần qua xem mẫu gỗ gụ.',
      'Cần kiểm tra chiều ngang phòng thờ.',
      '[izzi-ctx: v=1; persona=P2; age=35-44; recipient=parents; timeline=before_tet; budget=5m_15m; consent=granted; ad=Ban tho go gu; domain=shopee.vn]',
    ].join('\n');

    const { freeNote, ctx } = splitCrmNote(rawNote);
    expect(freeNote).toBe('Khách hẹn cuối tuần qua xem mẫu gỗ gụ.\nCần kiểm tra chiều ngang phòng thờ.');
    expect(ctx).toEqual({
      persona: 'P2',
      ageBand: '35-44',
      recipient: 'parents',
      timeline: 'before_tet',
      budgetBand: '5m_15m',
      consent: 'granted',
      adTitle: 'Ban tho go gu',
      sharedDomain: 'shopee.vn',
    });

    const recomposed = composeCrmNote(freeNote, ctx);
    expect(recomposed).toBe(rawNote);
  });

  it('validates enums strictly, masks phones in adTitle, strips delimiters, and validates lowercase domain', () => {
    const dirtyTag = '[izzi-ctx: v=1; persona=P99; age=10-15; recipient=boss; timeline=tomorrow; budget=million; consent=yes; ad=Quảng cáo 0912 345 678 cực đẹp; domain=WWW.Shopee.VN]';
    const parsed = splitCrmNote(dirtyTag);
    expect(parsed.freeNote).toBe('');
    expect(parsed.ctx).toEqual({
      ...EMPTY_CRM_STAFF_CONTEXT,
      adTitle: 'Quảng cáo ••• cực đẹp',
      sharedDomain: 'shopee.vn',
    });
  });

  it('sanitizes adTitle (<=48 chars, masks phone, drops ; ] \\n) and rejects invalid domains', () => {
    const ctx: CrmStaffContext = {
      ...EMPTY_CRM_STAFF_CONTEXT,
      persona: 'P1',
      adTitle: `Bộ bàn thờ 0987.654.321; giảm giá]\n${'A'.repeat(60)}`,
      sharedDomain: 'WWW.DongThoHongHung.VN',
    };
    const composed = composeCrmNote('Ghi chú nhân viên\r\nDòng hai\t\u200B', ctx);
    expect(composed).not.toBeNull();
    expect(composed).not.toContain('0987.654.321');
    expect(composed).toContain('•••');

    const round = splitCrmNote(composed);
    expect(round.freeNote).toBe('Ghi chú nhân viên\nDòng hai');
    expect(round.ctx.persona).toBe('P1');
    expect(round.ctx.adTitle).not.toBeNull();
    expect(Array.from(round.ctx.adTitle!).length).toBeLessThanOrEqual(48);
    expect(round.ctx.sharedDomain).toBe('dongthohonghung.vn');

    const badDomain = splitCrmNote('[izzi-ctx: v=1; domain=https://evil.example/path]');
    expect(badDomain.ctx.sharedDomain).toBeNull();

    const wrongVersion = splitCrmNote('Ghi chú\n[izzi-ctx: v=2; persona=P1]');
    expect(wrongVersion.freeNote).toBe('Ghi chú');
    expect(wrongVersion.ctx).toEqual(EMPTY_CRM_STAFF_CONTEXT);
  });

  it('caps composed note at <= 1000 code points and passes care-crm server profile validation', () => {
    const fullCtx: CrmStaffContext = {
      persona: 'P2',
      ageBand: '45-54',
      recipient: 'parents',
      timeline: 'before_tet',
      budgetBand: '15m_30m',
      consent: 'granted',
      adTitle: 'Bàn thờ gia tiên gỗ gụ Lào cao cấp chuẩn Lỗ Ban',
      sharedDomain: 'dongthohonghung.vn',
    };
    const maxLen = maxFreeNoteLength(fullCtx);
    expect(maxLen).toBeGreaterThan(700);
    expect(maxLen).toBeLessThan(CARE_CRM_MAX_NOTE);

    const hugeFreeNote = `👨‍👩‍👧 ${'Gỗ gụ chuẩn xưởng '.repeat(80)}\u2028\u200B`;
    const composed = composeCrmNote(hugeFreeNote, fullCtx);
    expect(composed).not.toBeNull();
    expect(Array.from(composed!).length).toBeLessThanOrEqual(CARE_CRM_MAX_NOTE);

    // Must pass strict IPC/server validator in care-crm.ts!
    const validProfile = parseCareCrmProfileInput(
      {
        stage: 'consulting',
        ownerUserId: null,
        addressForm: 'anh',
        occasion: 'tet',
        neededBy: '2027-01-15',
        productFactIds: ['ban-tho-gu'],
        nextStep: 'Gọi lại tư vấn kích thước',
        nextStepDueAt: '2026-11-26T03:00:00.000Z',
        lostReason: null,
        purchasedAt: null,
        note: composed,
      },
      new Date(NOW_MS),
    );
    expect(validProfile).not.toBeNull();
    expect(splitCrmNote(composed).ctx).toEqual(fullCtx);
    expect(composeCrmNote('   ', EMPTY_CRM_STAFF_CONTEXT)).toBeNull();
  });
});

describe('A2 · 5-Layer Customer Portrait & effectiveCrmIdentity', () => {
  it('returns the exact 5 ordered reasoning layers and calculates birth-year age against nowMs', () => {
    const row = makeRow(
      {
        customerName: 'Nguyễn Văn Hùng',
        recentMessages: [
          { text: 'Chào shop, anh sn 1988, hai vợ chồng đang hoàn thiện nhà mới cần tìm bàn thờ gỗ gụ tầm 12 triệu', at: NOW_ISO },
          { text: 'Em xem mẫu giống link https://l.facebook.com/l.php?u=https%3A%2F%2Fshopee.vn%2Fban-tho-197 này nhé, kịp trước Tết không?', at: NOW_ISO },
        ],
      },
      { note: composeCrmNote('Khách thiện chí', { ...EMPTY_CRM_STAFF_CONTEXT, adTitle: 'QC Bàn Thờ Gỗ Gụ' }) },
    );

    const portrait = buildCustomerPortrait(row, PRODUCTS, NOW_MS);
    expect(Object.keys(portrait).slice(0, 5)).toEqual([
      'layer_1_age',
      'layer_2_demographic',
      'layer_3_household',
      'layer_4_interests',
      'layer_5_persona',
    ]);

    expect(portrait.layer_1_age.exactAge).toBe(38);
    expect(portrait.layer_1_age.ageBands).toEqual(['35-44']);
    expect(portrait.layer_1_age.confidence).toBe('high');
    expect(portrait.layer_1_age.quote).toContain('sn 1988');

    expect(portrait.layer_2_demographic.addressForm).toBe('anh');
    expect(portrait.layer_2_demographic.label).toBe('Nam · Xưng Anh');

    expect(portrait.layer_3_household.recipient).toBe('spouse');
    expect(portrait.layer_3_household.label).toBe('Đã lập gia đình · Vợ chồng');

    expect(portrait.layer_4_interests.sharedLinks).toEqual([{ domain: 'shopee.vn', title: null }]);
    expect(portrait.layer_4_interests.adTitle).toBe('QC Bàn Thờ Gỗ Gụ');
    expect(portrait.layer_4_interests.matchedProducts.map((p) => p.id)).toContain('ban-tho-gu');
    expect(portrait.layer_4_interests.budgetBand).toBe('5m_15m');
    expect(portrait.layer_4_interests.timeline).toBe('before_tet');

    expect(portrait.layer_5_persona.persona).toBe('P1');
    expect(portrait.completenessPct).toBe(100);
    expect(portrait.missingPrompts).toEqual([]);
  });

  it('infers contextual age bands and Vietnamese name gender while skipping unisex and business names', () => {
    const youngRow = makeRow({
      customerName: 'Trần Thị Hương',
      recentMessages: [{ text: 'Shop ơi mẫu này giá bnhiu, ship liền dc ko ạ?', at: NOW_ISO }],
    });
    const youngPortrait = buildCustomerPortrait(youngRow, PRODUCTS, NOW_MS);
    expect(youngPortrait.layer_1_age.ageBand).toBe('18-24');
    expect(youngPortrait.layer_2_demographic.label).toBe('Nữ · Gợi ý Chị');
    expect(youngPortrait.layer_5_persona.persona).toBe('P4');

    const seniorRow = makeRow(
      { customerName: 'Đồ Thờ Phong Thủy Tâm An', recentMessages: [{ text: 'Cô mua bộ ngũ sự tặng vợ chồng cháu nội', at: NOW_ISO }] },
      { addressForm: null },
    );
    const seniorPortrait = buildCustomerPortrait(seniorRow, PRODUCTS, NOW_MS);
    expect(seniorPortrait.layer_1_age.ageBand).toBe('55+');
    expect(seniorPortrait.layer_2_demographic.addressForm).toBe('co');

    const unisexShopRow = makeRow({ customerName: 'Hoàng Minh An', recentMessages: [{ text: 'Xin thông tin kích thước ạ', at: NOW_ISO }] });
    const unisexPortrait = buildCustomerPortrait(unisexShopRow, PRODUCTS, NOW_MS);
    expect(unisexPortrait.layer_2_demographic.addressForm).toBeNull();
    expect(unisexPortrait.layer_2_demographic.salutation).toBe('Anh/Chị');
  });

  it('enforces the sensitive household denylist without blocking worship/altar product names', () => {
    expect(containsSensitiveHouseholdTerm('Gia đình có người mới qua đời, 49 ngày')).toBe(true);
    expect(containsSensitiveHouseholdTerm('Chị đơn thân mới ly hôn muốn mua đồ')).toBe(true);
    expect(containsSensitiveHouseholdTerm('Ông đang nằm bệnh viện vì tai biến')).toBe(true);
    expect(containsSensitiveHouseholdTerm('Nhà chị là phật tử hay đi lễ chùa')).toBe(true);

    // Must NEVER block product names!
    expect(containsSensitiveHouseholdTerm('Muốn mua một bộ bàn thờ gỗ gụ, tranh Quan Âm, lư hương và bộ ngũ sự')).toBe(false);

    const bereavementRow = makeRow({
      recentMessages: [
        { text: 'Bố anh mới mất gần 49 ngày, hai vợ chồng em muốn tìm bộ bàn thờ mới.', at: NOW_ISO },
      ],
    });
    const p1 = buildCustomerPortrait(bereavementRow, PRODUCTS, NOW_MS);
    expect(p1.layer_3_household.sensitiveFiltered).toBe(true);
    expect(p1.layer_3_household.recipient).toBeNull();
    expect(p1.layer_3_household.quote).toBeNull();

    const productRow = makeRow({
      recentMessages: [
        { text: 'Hai vợ chồng em mua bàn thờ, tranh Quan Âm, ngũ sự số 0909111222.', at: NOW_ISO },
      ],
    });
    const p2 = buildCustomerPortrait(productRow, PRODUCTS, NOW_MS);
    expect(p2.layer_3_household.sensitiveFiltered).toBe(false);
    expect(p2.layer_3_household.recipient).toBe('spouse');
    expect(p2.layer_3_household.quote).toContain('•••');
    expect(p2.layer_3_household.quote).not.toContain('0909111222');
  });

  it('strips personal Facebook profile usernames while keeping post/video/reel safe labels', () => {
    expect(extractSafeSharedLink('https://www.facebook.com/nguyenvana.1988?mibextid=abc')).toEqual({
      domain: 'facebook.com',
      title: null,
    });
    expect(extractSafeSharedLink('https://facebook.com/dongthohonghung/posts/123456789')).toEqual({
      domain: 'facebook.com',
      title: 'Bài viết Facebook',
    });
    expect(extractSafeSharedLink('https://m.facebook.com/reel/99887766')).toEqual({
      domain: 'facebook.com',
      title: 'Reels Facebook',
    });
  });

  it('synthesizes effectiveCrmIdentity for graph hubs and preserves server identity fields when present', () => {
    const row = makeRow(
      {
        recentMessages: [{ text: 'Anh mua làm quà tân gia hộp quà sang trọng tầm 20 củ https://shopee.vn/qua-tang', at: NOW_ISO }],
      },
      {
        occasion: 'gift',
        note: composeCrmNote('', { ...EMPTY_CRM_STAFF_CONTEXT, adTitle: 'Quà Tân Gia Cao Cấp', consent: 'granted' }),
      },
    );

    const synthesized = effectiveCrmIdentity(row, PRODUCTS, NOW_MS);
    expect(synthesized.persona?.value).toBe('P3');
    expect(synthesized.interests?.adTitle?.value).toBe('Quà Tân Gia Cao Cấp');
    expect(synthesized.interests?.sharedLinks[0]?.value.domain).toBe('shopee.vn');
    expect(synthesized.interests?.budgetBand?.value).toBe('15m_30m');
    expect(synthesized.consent?.state).toBe('granted');

    const serverGranted: CustomerCareCrmIdentity = {
      version: 's3-prod',
      lastRunAt: NOW_ISO,
      consent: { state: 'granted', at: NOW_ISO, noMarketing: false, canAsk: false },
      occasion: null,
      timeline: null,
      productFactIds: null,
      addressForm: null,
      ageBand: null,
      family: null,
      interests: null,
      persona: {
        value: 'P2',
        confidence: 'high',
        kind: 'inferred',
        source: 'ai',
        status: 'confirmed',
        updatedAt: NOW_ISO,
        evidence: [{ source: 'customer', at: NOW_ISO, quote: 'Nhà anh có người mới mất nên sắm lại' }],
        summary: 'Khách truyền thống từ server',
      },
    };
    const mergedGranted = effectiveCrmIdentity({ ...row, identity: serverGranted }, PRODUCTS, NOW_MS);
    expect(mergedGranted.persona?.value).toBe('P2');
    // Sensitive evidence quotes on base server identity must also be stripped
    expect(mergedGranted.persona?.evidence).toEqual([]);
    expect(mergedGranted.interests?.adTitle?.value).toBe('Quà Tân Gia Cao Cấp');

    // Server refusal must never be overridden by a staff tag, and c5898f6 consent gate withholds all profile-layer fields
    const serverDeclined: CustomerCareCrmIdentity = {
      ...serverGranted,
      consent: { state: 'declined', at: NOW_ISO, noMarketing: true, canAsk: false },
    };
    const mergedDeclined = effectiveCrmIdentity({ ...row, identity: serverDeclined }, PRODUCTS, NOW_MS);
    expect(mergedDeclined.consent?.state).toBe('declined');
    expect(mergedDeclined.occasion?.value).toBe('gift'); // order-layer stays
    expect(mergedDeclined.persona).toBeNull();
    expect(mergedDeclined.ageBand).toBeNull();
    expect(mergedDeclined.addressForm).toBeNull();
    expect(mergedDeclined.family).toBeNull();
    expect(mergedDeclined.interests).toBeNull();

    // Without consent=granted, only order-layer fields are exposed on effectiveCrmIdentity
    const unconsentedRow = makeRow(
      { recentMessages: [{ text: 'Anh sn 1988 muốn mua bàn thờ gỗ gụ trước Tết tầm 15 triệu', at: NOW_ISO }] },
      { occasion: 'tet', productFactIds: ['ban-tho-gu'] },
    );
    const orderOnly = effectiveCrmIdentity(unconsentedRow, PRODUCTS, NOW_MS);
    expect(orderOnly.occasion?.value).toBe('tet');
    expect(orderOnly.timeline?.value).toBe('before_tet');
    expect(orderOnly.productFactIds?.value).toContain('ban-tho-gu');
    expect(orderOnly.persona).toBeNull();
    expect(orderOnly.ageBand).toBeNull();
    expect(orderOnly.addressForm).toBeNull();
    expect(orderOnly.family).toBeNull();
    expect(orderOnly.interests).toBeNull();
  });

  it('strips sensitive quotes across ALL 5 reasoning layers even when birth year and budget appear in the same clause', () => {
    const sensitiveAllLayers = makeRow({
      recentMessages: [
        {
          text: 'Anh sn 1988, gia đình mới có người qua đời gần 49 ngày nên vợ chồng anh tìm bàn thờ tầm 12 triệu',
          at: NOW_ISO,
        },
      ],
    });
    const portrait = buildCustomerPortrait(sensitiveAllLayers, PRODUCTS, NOW_MS);
    expect(portrait.layer_1_age.quote).toBeNull();
    expect(portrait.layer_2_demographic.quote).toBeNull();
    expect(portrait.layer_3_household.quote).toBeNull();
    expect(portrait.layer_3_household.recipient).toBeNull();
    expect(portrait.layer_4_interests.quote).toBeNull();
    expect(portrait.layer_5_persona.quote).toBeNull();
  });
});

describe('A3 · Saler Playbook, Ads SHA-256 CSV & Lifecycle / Remarketing', () => {
  it('scores Saler priority accurately, zeroes closed/DNC leads, and builds actionable scripts', () => {
    const hotRow = makeRow(
      {
        customerName: 'Lê Minh Tuấn',
        lastMessageAt: new Date(NOW_MS - 30 * 60 * 1000).toISOString(),
        recentMessages: [{ text: 'Anh cần gấp bàn thờ gỗ gụ trong tuần này tầm 25 triệu', at: NOW_ISO }],
      },
      { stage: 'has_phone', addressForm: 'anh', occasion: 'new_home', productFactIds: ['ban-tho-gu'] },
    );
    const hotPortrait = buildCustomerPortrait(hotRow, PRODUCTS, NOW_MS);
    const playbook = buildSalerPlaybook(hotRow, hotPortrait, PRODUCTS, NOW_MS);
    expect(playbook.priorityScore).toBeGreaterThanOrEqual(75);
    expect(playbook.priorityBand).toBe('hot');
    expect(playbook.canContact).toBe(true);
    expect(playbook.opener).toContain('anh');
    expect(playbook.discoveryQuestions.length).toBeLessThanOrEqual(3);
    expect(playbook.closingChecklist.length).toBeGreaterThanOrEqual(3);
    expect(Date.parse(playbook.suggestedDueIso)).toBeGreaterThan(NOW_MS);

    const dncRow = makeRow({}, { stage: 'do_not_contact' });
    const dncPlaybook = buildSalerPlaybook(dncRow, buildCustomerPortrait(dncRow, PRODUCTS, NOW_MS), PRODUCTS, NOW_MS);
    expect(dncPlaybook.priorityScore).toBe(0);
    expect(dncPlaybook.priorityBand).toBe('closed');
    expect(dncPlaybook.canContact).toBe(false);
  });

  it('segments Ads buckets and exports SHA-256 hex CSV of 84... phones only for consented non-suppressed leads', async () => {
    const consentedWarm = makeRow(
      { leadId: 'lead-1', customerName: 'Nguyễn Văn Hùng', phone: '0901234567' },
      {
        stage: 'consulting',
        occasion: 'new_home',
        note: composeCrmNote('', { ...EMPTY_CRM_STAFF_CONTEXT, consent: 'granted', persona: 'P1' }),
      },
    );
    const noConsentWarm = makeRow(
      { leadId: 'lead-2', customerName: 'Trần Thị Lan', phone: '0912345678' },
      { stage: 'has_phone', occasion: 'new_home' },
    );
    const dncWithConsentTag = makeRow(
      { leadId: 'lead-3', customerName: 'Phạm Quốc Sơn', phone: '0987654321' },
      {
        stage: 'do_not_contact',
        note: composeCrmNote('', { ...EMPTY_CRM_STAFF_CONTEXT, consent: 'granted' }),
      },
    );
    const vipDelivered = makeRow(
      { leadId: 'lead-4', customerName: 'Hoàng Thị Mai', phone: '0933445566' },
      {
        stage: 'delivered',
        purchasedAt: '2026-11-20',
        note: composeCrmNote('', { ...EMPTY_CRM_STAFF_CONTEXT, consent: 'granted', persona: 'P2' }),
      },
    );
    const lostBoughtElsewhere = makeRow(
      { leadId: 'lead-5', phone: '0977889900' },
      { stage: 'lost', lostReason: 'bought_elsewhere' },
    );

    const rows = [consentedWarm, noConsentWarm, dncWithConsentTag, vipDelivered, lostBoughtElsewhere];
    const summary = summarizeAdsAudiences(rows, PRODUCTS, NOW_MS);
    expect(summary.buckets.high_intent.count).toBe(2);
    expect(summary.buckets.vip_lookalike.count).toBe(1);
    expect(summary.buckets.suppressed.count).toBe(2);
    expect(summary.consentedCount).toBe(2);
    expect(summary.byPersona.P1.adAngles.length).toBeGreaterThan(0);

    expect(normalizeVietnamPhoneForMeta('0901234567')).toBe('84901234567');
    const expectedHash1 = createHash('sha256').update('84901234567', 'utf8').digest('hex');
    const expectedHash4 = createHash('sha256').update('84933445566', 'utf8').digest('hex');

    const exported = await buildMetaCustomAudienceCsv(rows, 'all');
    expect(exported).toEqual({
      csv: ['phone', expectedHash1, expectedHash4].join('\n'),
      includedCount: 2,
      excludedNoConsent: 1,
      excludedSuppressed: 2,
    });
    expect(exported.csv).not.toContain('0901234567');
    expect(exported.csv).not.toContain('84901234567');
    expect(exported.csv).not.toContain('Nguyễn Văn Hùng');
  });

  it('builds N+1 / N+7 / N+30 post-sale milestones and switches channel at the 23h Messenger boundary', () => {
    const deliveredRecentChat = makeRow(
      {
        leadId: 'lead-post',
        lastMessageAt: new Date(NOW_MS - 5 * HOUR_MS).toISOString(), // < 23h -> messenger_24h
      },
      { stage: 'delivered', addressForm: 'chi', purchasedAt: '2026-11-20', productFactIds: ['ngu-su-dong'] },
    );
    const staleConsulting = makeRow(
      {
        leadId: 'lead-stale',
        lastMessageAt: new Date(NOW_MS - 60 * HOUR_MS).toISOString(), // >= 48h & >= 23h -> zalo_or_call
      },
      { stage: 'consulting', addressForm: 'anh', productFactIds: ['ban-tho-gu'] },
    );
    const lostPriceWithin23h = makeRow(
      {
        leadId: 'lead-lost-price',
        lastMessageAt: new Date(NOW_MS - 22 * HOUR_MS).toISOString(), // < 23h -> messenger_24h
      },
      { stage: 'lost', lostReason: 'price' },
    );
    const suppressedDnc = makeRow({ leadId: 'lead-dnc' }, { stage: 'do_not_contact' });

    const plan = buildLifecyclePlan(
      [deliveredRecentChat, staleConsulting, lostPriceWithin23h, suppressedDnc],
      PRODUCTS,
      NOW_MS,
    );

    const postSale = plan.filter((item) => item.leadId === 'lead-post');
    expect(postSale).toHaveLength(3);
    expect(postSale.map((item) => item.milestoneLabel)).toEqual([
      expect.stringContaining('N+1'),
      expect.stringContaining('N+7'),
      expect.stringContaining('N+30'),
    ]);
    expect(postSale[0]!.isOverdue).toBe(true); // 2026-11-21 < 2026-11-25
    expect(postSale[1]!.isOverdue).toBe(false); // 2026-11-27 > 2026-11-25
    expect(postSale[0]!.channel).toBe('messenger_24h');

    const staleItem = plan.find((item) => item.leadId === 'lead-stale');
    expect(staleItem?.category).toBe('remarketing');
    expect(staleItem?.channel).toBe('zalo_or_call');
    expect(staleItem?.isOverdue).toBe(true);

    const lostItem = plan.find((item) => item.leadId === 'lead-lost-price');
    expect(lostItem?.category).toBe('remarketing');
    expect(lostItem?.channel).toBe('messenger_24h');

    expect(plan.some((item) => item.leadId === 'lead-dnc')).toBe(false);

    const segments = summarizeCareCrmSegments(
      [deliveredRecentChat, staleConsulting, lostPriceWithin23h, suppressedDnc],
      PRODUCTS,
      NOW_MS,
      false,
    );
    expect(segments.totalLeads).toBe(4);
    expect(JSON.stringify(segments)).not.toMatch(/\d{8,}/);
  });

  it('enforces fail-closed blocking for detailsUnreadable, mid-note tag injection, /l.php non-http schemes, phone domains, and consent-mandatory CSV', async () => {
    const unreadableRow = makeRow(
      {
        leadId: 'lead-unreadable',
        lastMessageAt: new Date(NOW_MS - 72 * HOUR_MS).toISOString(),
        recentMessages: [{ text: 'Anh muốn đặt bàn thờ', at: NOW_ISO }],
      },
      {
        stage: 'delivered',
        purchasedAt: '2026-11-20',
        note: '[izzi-ctx: v=1; consent=granted; persona=P1]',
        detailsUnreadable: true,
      },
    );

    expect(isCrmRowAdsSuppressed(unreadableRow)).toBe(true);
    const unreadablePortrait = buildCustomerPortrait(unreadableRow, PRODUCTS, NOW_MS);
    const unreadablePlaybook = buildSalerPlaybook(unreadableRow, unreadablePortrait, PRODUCTS, NOW_MS);
    expect(unreadablePlaybook.priorityScore).toBe(0);
    expect(unreadablePlaybook.priorityBand).toBe('closed');
    expect(unreadablePlaybook.canContact).toBe(false);
    expect(buildLifecyclePlan([unreadableRow], PRODUCTS, NOW_MS)).toEqual([]);
    expect(effectiveCrmIdentity(unreadableRow, PRODUCTS, NOW_MS).persona).toBeNull();

    // CSV export has no consent-bypass flag: unconsented and unreadable rows are strictly excluded
    const unconsentedRow = makeRow({ leadId: 'lead-no-consent', phone: '0911222333' }, { stage: 'consulting' });
    const csvRes = await buildMetaCustomAudienceCsv([unreadableRow, unconsentedRow], 'all');
    expect(csvRes).toEqual({
      csv: 'phone',
      includedCount: 0,
      excludedNoConsent: 1,
      excludedSuppressed: 1,
    });

    // Mid-note [izzi-ctx: ...] lines are stripped everywhere, and wouldTruncateFreeNote detects 960-char overflow
    const midTag = splitCrmNote('Dòng 1\n[izzi-ctx: v=1; consent=declined]\nDòng 2\n[izzi-ctx: v=1; persona=P1]');
    expect(midTag.freeNote).toBe('Dòng 1\nDòng 2');
    expect(midTag.ctx.persona).toBe('P1');
    expect(midTag.ctx.consent).toBeNull();

    const longFree = 'G'.repeat(960);
    expect(wouldTruncateFreeNote(longFree, { ...EMPTY_CRM_STAFF_CONTEXT, persona: 'P1', consent: 'granted', adTitle: 'Quảng cáo' })).toBe(true);

    // URL & domain hardening
    expect(extractSafeSharedLink(`https://shopee.vn/${'a'.repeat(2100)}`)).toBeNull();
    expect(extractSafeSharedLink('https://l.facebook.com/l.php?u=javascript%3Aalert(1)')).toBeNull();
    expect(extractSafeSharedLink('https://l.facebook.com/l.php?u=data%3Atext%2Fhtml%2Chi')).toBeNull();
    expect(sanitizeCtxDomain('0901234567.vn')).toBeNull();
    expect(sanitizeCtxDomain('0901-234-567.com')).toBeNull();
  });
});
