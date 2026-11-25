import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type {
  CustomerCareCrmConsent,
  CustomerCareCrmIdField,
  CustomerCareCrmIdentity,
  CustomerCareCrmProfile,
  CustomerCareCrmRow,
} from './customer-care-types';
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
  crmAdsExportBlock,
  crmConsentedPersona,
  crmProfileLayerAllowed,
  hasExplicitMarketingConsent,
  isCrmRowAdsSuppressed,
  isCrmSocialDomain,
  maxFreeNoteLength,
  normalizeVietnamPhoneForMeta,
  replaceEditableFreeNote,
  sanitizeCtxDomain,
  selectMetaAudience,
  splitCrmNote,
  summarizeAdsAudiences,
  summarizeCareCrmSegments,
  wouldTruncateFreeNote,
  type CrmAdsIdentityState,
  type CrmCustomerPortrait,
  type CrmEnterpriseProduct,
} from './customer-crm-enterprise';

const NOW_ISO = '2026-11-25T02:00:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);
const HOUR_MS = 60 * 60 * 1000;

const IDENTITY_ON: CrmAdsIdentityState = { identityEnabled: true, identityUnavailable: false };

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

function idField<T>(value: T, overrides: Partial<CustomerCareCrmIdField<T>> = {}): CustomerCareCrmIdField<T> {
  return {
    value,
    confidence: 'high',
    kind: 'stated',
    source: 'ai',
    status: 'suggested',
    updatedAt: NOW_ISO,
    evidence: [],
    ...overrides,
  };
}

function makeIdentity(
  overrides: Partial<CustomerCareCrmIdentity> = {},
  consent: Partial<CustomerCareCrmConsent> = {},
): CustomerCareCrmIdentity {
  return {
    version: '2026-11-25T01:00:00.000Z',
    lastRunAt: NOW_ISO,
    consent: { state: 'granted', at: NOW_ISO, noMarketing: false, canAsk: false, eraseRequestedAt: null, ...consent },
    occasion: null,
    timeline: null,
    productFactIds: null,
    addressForm: null,
    ageBand: null,
    family: null,
    interests: null,
    persona: null,
    ...overrides,
  };
}

/** A full profile layer, as a server would send it after "Đồng ý". */
function fullProfileIdentity(consent: Partial<CustomerCareCrmConsent> = {}): CustomerCareCrmIdentity {
  return makeIdentity(
    {
      occasion: idField('tet' as const),
      timeline: idField('before_tet' as const),
      productFactIds: idField(['ngu-su-dong']),
      addressForm: idField('chi' as const),
      ageBand: idField(['25-34', '35-44'] as Array<'25-34' | '35-44'>, { kind: 'inferred' }),
      family: idField({ recipient: 'parents' as const }, {
        evidence: [{ source: 'customer', at: NOW_ISO, quote: 'Chị mua biếu bố mẹ dịp Tết' }],
      }),
      interests: {
        adTitle: idField('Bàn thờ gia tiên Tết', { source: 'ad' }),
        sharedLinks: [
          idField({ domain: 'facebook.com', title: 'Nhà chị Mai' }),
          idField({ domain: 'shopee.vn', title: 'Bộ ngũ sự 60cm' }),
          idField({ domain: 'm.facebook.com', title: 'Trang cá nhân' }),
        ],
        budgetBand: idField('5m_15m' as const, { evidence: [{ source: 'customer', at: NOW_ISO, quote: 'tầm 10 triệu' }] }),
      },
      persona: { ...idField('P2' as const, { kind: 'inferred' }), summary: 'Khách sắm Tết' },
    },
    consent,
  );
}

const PROFILE_LABELS = (portrait: CrmCustomerPortrait) => [
  portrait.layer_1_age.label,
  portrait.layer_2_demographic.label,
  portrait.layer_3_household.label,
  portrait.layer_4_interests.label,
  portrait.layer_5_persona.label,
].join(' | ');

describe('A1 · [izzi-ctx] codec on profile.note: a timeline and a refusal only, never consent', () => {
  it('round-trips a timeline and a refusal while keeping the free note separate', () => {
    const note = composeCrmNote('Khách hẹn cuối tuần qua xem mẫu gỗ gụ.', { timeline: 'before_tet', consent: 'declined' });
    expect(note).toBe('Khách hẹn cuối tuần qua xem mẫu gỗ gụ.\n[izzi-ctx: v=1; timeline=before_tet; consent=declined]');
    expect(splitCrmNote(note)).toEqual({
      freeNote: 'Khách hẹn cuối tuần qua xem mẫu gỗ gụ.',
      ctx: { timeline: 'before_tet', consent: 'declined' },
    });
  });

  it('ignores the profile-layer keys and consent=granted that beta.121 wrote, and drops them on the next save', () => {
    const legacy = [
      'Khách hỏi kỹ thước Lỗ Ban',
      '[izzi-ctx: v=1; persona=P2; age=35-44; recipient=parents; timeline=before_tet; budget=5m_15m; consent=granted; ad=Ban tho go gu; domain=shopee.vn]',
    ].join('\n');

    const { freeNote, ctx } = splitCrmNote(legacy);
    expect(freeNote).toBe('Khách hỏi kỹ thước Lỗ Ban');
    expect(ctx).toEqual({ timeline: 'before_tet', consent: null });

    // The table's note editor rewrites the tag from what it read: the profile-layer keys are gone.
    const resaved = replaceEditableFreeNote(legacy, 'Khách hẹn thứ Bảy');
    expect(resaved).toBe('Khách hẹn thứ Bảy\n[izzi-ctx: v=1; timeline=before_tet]');
    expect(resaved).not.toMatch(/persona|age=|recipient|budget|granted|ad=|domain=/);
    expect(composeCrmNote(freeNote, ctx)).toBe('Khách hỏi kỹ thước Lỗ Ban\n[izzi-ctx: v=1; timeline=before_tet]');
  });

  it('keeps a refusal from any tag line, and a later tag never cancels it', () => {
    const parsed = splitCrmNote('Dòng 1\n[izzi-ctx: v=1; consent=withdrawn]\nDòng 2\n[izzi-ctx: v=1; timeline=this_week; consent=granted]');
    expect(parsed.freeNote).toBe('Dòng 1\nDòng 2');
    expect(parsed.ctx).toEqual({ timeline: 'this_week', consent: 'withdrawn' });
  });

  it('validates values strictly and rejects a wrong version', () => {
    expect(splitCrmNote('[izzi-ctx: v=1; timeline=tomorrow; consent=yes]').ctx).toEqual(EMPTY_CRM_STAFF_CONTEXT);
    expect(splitCrmNote('[izzi-ctx: v=1; consent=granted]').ctx).toEqual(EMPTY_CRM_STAFF_CONTEXT);
    expect(splitCrmNote('Ghi chú\n[izzi-ctx: v=2; timeline=later]')).toEqual({ freeNote: 'Ghi chú', ctx: EMPTY_CRM_STAFF_CONTEXT });
    expect(composeCrmNote('   ', EMPTY_CRM_STAFF_CONTEXT)).toBeNull();
  });

  it('caps the composed note at 1000 code points and passes the CRM profile validator', () => {
    const ctx = { timeline: 'before_tet' as const, consent: 'declined' as const };
    const maxLen = maxFreeNoteLength(ctx);
    expect(maxLen).toBeGreaterThan(900);
    expect(maxLen).toBeLessThan(CARE_CRM_MAX_NOTE);
    expect(wouldTruncateFreeNote('G'.repeat(990), ctx)).toBe(true);
    expect(wouldTruncateFreeNote('G'.repeat(900), ctx)).toBe(false);

    const family = String.fromCodePoint(0x1f468, 0x200d, 0x1f469);
    const composed = composeCrmNote(`${family} ${'Gỗ gụ chuẩn xưởng '.repeat(80)}`, ctx);
    expect(composed).not.toBeNull();
    expect(Array.from(composed!).length).toBeLessThanOrEqual(CARE_CRM_MAX_NOTE);
    const valid = parseCareCrmProfileInput(
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
    expect(valid).not.toBeNull();
    expect(splitCrmNote(composed).ctx).toEqual(ctx);
  });

  it('rejects phone-like and malformed domains', () => {
    expect(sanitizeCtxDomain('WWW.Shopee.VN')).toBe('shopee.vn');
    expect(sanitizeCtxDomain('https://evil.example/path')).toBeNull();
    expect(sanitizeCtxDomain('0901234567.vn')).toBeNull();
    expect(sanitizeCtxDomain('0901-234-567.com')).toBeNull();
  });
});

describe('A2 · portrait: server identity first, profile layer only after consent', () => {
  const chattyRow = makeRow({
    customerName: 'Nguyễn Văn Hùng',
    recentMessages: [
      { text: 'Chào shop, anh sn 1988, hai vợ chồng đang hoàn thiện nhà mới cần tìm bàn thờ gỗ gụ chạm sen tầm 12 triệu', at: NOW_ISO },
      { text: 'Em xem mẫu giống link https://shopee.vn/ban-tho-197 này nhé, kịp trước Tết không?', at: NOW_ISO },
    ],
  });

  it('without any identity uses the chat for the order layer only: no age, family, budget, links, persona or gender', () => {
    const portrait = buildCustomerPortrait(chattyRow, PRODUCTS, NOW_MS);

    expect(portrait.profileAllowed).toBe(false);
    expect(portrait.layer_4_interests.matchedProducts.map((p) => p.id)).toEqual(['ban-tho-gu']);
    expect(portrait.layer_4_interests.topicKeywords).toContain('Bàn thờ');
    expect(portrait.layer_4_interests.timeline).toBe('before_tet');

    expect(portrait.layer_1_age.ageBands).toEqual([]);
    expect(portrait.layer_3_household.recipient).toBeNull();
    expect(portrait.layer_4_interests.budgetBand).toBeNull();
    expect(portrait.layer_4_interests.sharedLinks).toEqual([]);
    expect(portrait.layer_4_interests.adTitle).toBeNull();
    expect(portrait.layer_5_persona.persona).toBeNull();
    expect(portrait.layer_1_age.label).toBe('Chỉ có khi khách đồng ý');
    expect(PROFILE_LABELS(portrait)).not.toMatch(/Nam|Nữ|hôn nhân|lập gia đình|vợ chồng/);
  });

  it('never takes the form of address from a name; only staff or the consented server identity set it', () => {
    const named = buildCustomerPortrait(makeRow({ customerName: 'Trần Thị Hương' }), PRODUCTS, NOW_MS);
    expect(named.layer_2_demographic.addressForm).toBeNull();
    expect(named.layer_2_demographic.salutation).toBe('Anh/Chị');
    expect(named.layer_2_demographic.label).toBe('Chưa rõ · Tạm xưng Anh/Chị');

    const staff = buildCustomerPortrait(makeRow({ customerName: 'Trần Thị Hương' }, { addressForm: 'chi' }), PRODUCTS, NOW_MS);
    expect(staff.layer_2_demographic).toMatchObject({ addressForm: 'chi', salutation: 'Chị', label: 'Xưng Chị', source: 'staff' });
  });

  it('with a server identity but no consent uses the server order layer and nothing else, not the chat', () => {
    const asked = makeIdentity(
      {
        occasion: idField('new_home' as const),
        timeline: idField('this_month' as const),
        productFactIds: idField(['ngu-su-dong']),
        // A profile layer the server should never send before consent is still ignored here.
        ageBand: idField(['35-44'] as Array<'35-44'>),
        family: idField({ recipient: 'spouse' as const }, { evidence: [{ source: 'customer', at: NOW_ISO, quote: 'hai vợ chồng' }] }),
        persona: { ...idField('P1' as const), summary: 'x' },
      },
      { state: 'asked' },
    );
    const portrait = buildCustomerPortrait({ ...chattyRow, identity: asked }, PRODUCTS, NOW_MS);

    expect(portrait.profileAllowed).toBe(false);
    expect(portrait.layer_4_interests.occasion).toBe('new_home');
    expect(portrait.layer_4_interests.timeline).toBe('this_month');
    expect(portrait.layer_4_interests.matchedProducts.map((p) => p.id)).toEqual(['ngu-su-dong']);
    expect(portrait.layer_4_interests.topicKeywords).toEqual([]);
    expect(portrait.layer_1_age.ageBands).toEqual([]);
    expect(portrait.layer_3_household.recipient).toBeNull();
    expect(portrait.layer_5_persona.persona).toBeNull();
    expect(crmConsentedPersona({ ...chattyRow, identity: asked })).toBeNull();
  });

  it('after consent shows the server profile layer: age as an estimate, no gender, social links as a domain only', () => {
    const row = makeRow({ customerName: 'Trần Thị Mai', identity: fullProfileIdentity() });
    const portrait = buildCustomerPortrait(row, PRODUCTS, NOW_MS);

    expect(crmProfileLayerAllowed(row)).toBe(true);
    expect(portrait.layer_1_age).toMatchObject({ ageBands: ['25-34', '35-44'], label: '25–44 tuổi (ước tính)', source: 'identity' });
    expect(portrait.layer_2_demographic).toMatchObject({ addressForm: 'chi', label: 'Gợi ý Chị' });
    expect(portrait.layer_3_household).toMatchObject({ recipient: 'parents', label: 'Mua biếu bố mẹ', quote: 'Chị mua biếu bố mẹ dịp Tết' });
    expect(portrait.layer_4_interests.adTitle).toBe('Bàn thờ gia tiên Tết');
    expect(portrait.layer_4_interests.budgetBand).toBe('5m_15m');
    expect(portrait.layer_4_interests.sharedLinks).toEqual([
      { domain: 'facebook.com', title: null },
      { domain: 'shopee.vn', title: 'Bộ ngũ sự 60cm' },
      { domain: 'm.facebook.com', title: null },
    ]);
    expect(portrait.layer_5_persona.persona).toBe('P2');
    expect(PROFILE_LABELS(portrait)).not.toMatch(/Nam|Nữ|hôn nhân/);
    expect(isCrmSocialDomain('web.facebook.com')).toBe(true);
    expect(isCrmSocialDomain('notfacebook.com')).toBe(false);
  });

  it('keeps who-it-is-for only with a quote of the customer, never a sensitive one', () => {
    const withoutCustomerQuote = makeIdentity({
      family: idField({ recipient: 'spouse' as const }, { evidence: [{ source: 'izzi', at: NOW_ISO, quote: 'hai vợ chồng' }] }),
    });
    expect(buildCustomerPortrait(makeRow({ identity: withoutCustomerQuote }), PRODUCTS, NOW_MS).layer_3_household.recipient).toBeNull();

    const sensitive = makeIdentity({
      family: idField({ recipient: 'parents' as const }, { evidence: [{ source: 'customer', at: NOW_ISO, quote: 'Bố anh mới mất gần 49 ngày' }] }),
    });
    const filtered = buildCustomerPortrait(makeRow({ identity: sensitive }), PRODUCTS, NOW_MS).layer_3_household;
    expect(filtered.recipient).toBeNull();
    expect(filtered.quote).toBeNull();

    expect(containsSensitiveHouseholdTerm('Chị đơn thân mới ly hôn muốn mua đồ')).toBe(true);
    expect(containsSensitiveHouseholdTerm('Muốn mua một bộ bàn thờ gỗ gụ, tranh Quan Âm, lư hương và bộ ngũ sự')).toBe(false);
  });

  it('locks the profile layer while an erase request is pending, for an unreadable identity and for low confidence', () => {
    const erasing = makeRow({ identity: fullProfileIdentity({ eraseRequestedAt: '2026-11-25T01:30:00.000Z' }) });
    expect(crmProfileLayerAllowed(erasing)).toBe(false);
    expect(buildCustomerPortrait(erasing, PRODUCTS, NOW_MS).layer_5_persona.persona).toBeNull();

    const unreadable = makeRow({ identity: fullProfileIdentity(), identityUnavailable: true });
    expect(crmProfileLayerAllowed(unreadable)).toBe(false);
    expect(buildCustomerPortrait(unreadable, PRODUCTS, NOW_MS).layer_1_age.ageBands).toEqual([]);

    const low = makeRow({ identity: makeIdentity({ persona: { ...idField('P4' as const, { confidence: 'low' }), summary: 'x' } }) });
    expect(crmConsentedPersona(low)).toBeNull();
  });

  it('asks only order-layer discovery questions', () => {
    const portrait = buildCustomerPortrait(makeRow(), PRODUCTS, NOW_MS);
    expect(portrait.missingPrompts).toHaveLength(3);
    expect(portrait.missingPrompts.join(' ')).not.toMatch(/ngân sách|gia đình|biếu|tuổi|phong cách/i);
  });
});

describe('A3 · Saler playbook, Ads export & lifecycle', () => {
  it('scores Saler priority, closes do-not-contact leads and builds scripts from staff data', () => {
    const hotRow = makeRow(
      {
        customerName: 'Lê Minh Tuấn',
        lastMessageAt: new Date(NOW_MS - 30 * 60 * 1000).toISOString(),
        recentMessages: [{ text: 'Anh cần gấp bàn thờ gỗ gụ trong tuần này', at: NOW_ISO }],
      },
      { stage: 'has_phone', addressForm: 'anh', occasion: 'new_home', productFactIds: ['ban-tho-gu'] },
    );
    const playbook = buildSalerPlaybook(hotRow, buildCustomerPortrait(hotRow, PRODUCTS, NOW_MS), PRODUCTS, NOW_MS);
    expect(playbook.priorityScore).toBeGreaterThanOrEqual(75);
    expect(playbook.priorityBand).toBe('hot');
    expect(playbook.canContact).toBe(true);
    expect(playbook.opener).toContain('em chào anh');
    expect(playbook.discoveryQuestions.length).toBeLessThanOrEqual(3);
    expect(playbook.closingChecklist.length).toBeGreaterThanOrEqual(3);
    expect(Date.parse(playbook.suggestedDueIso)).toBeGreaterThan(NOW_MS);

    const dncRow = makeRow({}, { stage: 'do_not_contact' });
    const dnc = buildSalerPlaybook(dncRow, buildCustomerPortrait(dncRow, PRODUCTS, NOW_MS), PRODUCTS, NOW_MS);
    expect(dnc).toMatchObject({ priorityScore: 0, priorityBand: 'closed', canContact: false });
  });

  describe('Meta Custom Audience export', () => {
    const granted = makeRow({ leadId: 'lead-granted', customerName: 'Nguyễn Văn Hùng', phone: '0901234567', identity: fullProfileIdentity() });
    const grantedAgainSamePhone = makeRow({ leadId: 'lead-dup', phone: '+84901234567', identity: makeIdentity() });
    const noteGrantedOnly = makeRow(
      { leadId: 'lead-note', phone: '0912345678' },
      { note: '[izzi-ctx: v=1; consent=granted; persona=P2]' },
    );
    const noMarketing = makeRow({ leadId: 'lead-nomkt', phone: '0987654321', identity: makeIdentity({}, { noMarketing: true }) });
    const erasing = makeRow({ leadId: 'lead-erase', phone: '0933445566', identity: makeIdentity({}, { eraseRequestedAt: NOW_ISO }) });
    const declined = makeRow({ leadId: 'lead-declined', phone: '0977889900', identity: makeIdentity({}, { state: 'declined', noMarketing: true }) });
    const unknown = makeRow({ leadId: 'lead-unknown', phone: '0966778899', identity: makeIdentity({}, { state: 'unknown' }) });
    const unreadable = makeRow({ leadId: 'lead-unreadable', phone: '0955667788', identity: makeIdentity(), identityUnavailable: true });
    const dncGranted = makeRow({ leadId: 'lead-dnc', phone: '0944556677', identity: makeIdentity() }, { stage: 'do_not_contact' });
    const rows = [granted, grantedAgainSamePhone, noteGrantedOnly, noMarketing, erasing, declined, unknown, unreadable, dncGranted];

    it('includes only server-granted customers who allow offers and asked for no erasure; a note tag never counts', async () => {
      expect(hasExplicitMarketingConsent(granted)).toBe(true);
      expect(hasExplicitMarketingConsent(noteGrantedOnly)).toBe(false);
      expect(isCrmRowAdsSuppressed(erasing)).toBe(true);
      expect(isCrmRowAdsSuppressed(makeRow({}, { note: '[izzi-ctx: v=1; consent=declined]' }))).toBe(true);

      const hash = createHash('sha256').update('84901234567', 'utf8').digest('hex');
      const exported = await buildMetaCustomAudienceCsv(rows, 'all', IDENTITY_ON);
      expect(exported).toEqual({
        csv: `phone\n${hash}`,
        includedCount: 1,
        excludedNoConsent: 3,
        excludedSuppressed: 4,
        blockedReason: null,
      });
      expect(exported.csv.split('\n')[0]).toBe('phone');
      expect(exported.csv).not.toMatch(/0901234567|84901234567|Hùng|P2|35-44|parents|ước tính/);
    });

    it('fails closed while the AI profile is off, on a server without it, or while the identity could not be loaded', async () => {
      expect(crmAdsExportBlock({ identityEnabled: false, identityUnavailable: false })).toBe('identity_off');
      expect(crmAdsExportBlock({ identityEnabled: null, identityUnavailable: false })).toBe('identity_off');
      expect(crmAdsExportBlock({ identityEnabled: true, identityUnavailable: true })).toBe('identity_unavailable');
      expect(crmAdsExportBlock(IDENTITY_ON)).toBeNull();

      for (const state of [
        { identityEnabled: false, identityUnavailable: false },
        { identityEnabled: null, identityUnavailable: false },
        { identityEnabled: true, identityUnavailable: true },
      ]) {
        const exported = await buildMetaCustomAudienceCsv(rows, 'all', state);
        expect(exported).toMatchObject({ csv: 'phone', includedCount: 0, blockedReason: crmAdsExportBlock(state) });
        expect(summarizeAdsAudiences(rows, state).consentedCount).toBe(0);
      }
    });

    it('filters a persona by the server persona after consent only, and the preview matches the export', async () => {
      const legacyTagP2 = makeRow({ leadId: 'lead-legacy', phone: '0922334455' }, { note: '[izzi-ctx: v=1; persona=P2; consent=granted]' });
      const lowConfidenceP2 = makeRow({
        leadId: 'lead-low',
        phone: '0911223344',
        identity: makeIdentity({ persona: { ...idField('P2' as const, { confidence: 'low' }), summary: 'x' } }),
      });
      const selection = selectMetaAudience([granted, legacyTagP2, lowConfidenceP2], 'P2', IDENTITY_ON);
      expect(selection).toEqual({ blockedReason: null, phones: ['84901234567'], excludedNoConsent: 0, excludedSuppressed: 0 });
      expect((await buildMetaCustomAudienceCsv([granted, legacyTagP2, lowConfidenceP2], 'P2', IDENTITY_ON)).includedCount).toBe(1);

      const summary = summarizeAdsAudiences(rows, IDENTITY_ON);
      expect(summary.consentedCount).toBe(2);
      expect(selectMetaAudience(rows, 'all', IDENTITY_ON).phones).toHaveLength(1);
      expect(summary.byPersona.P2.count).toBe(1);
      expect(summary.byPersona.P1.count + summary.byPersona.P3.count + summary.byPersona.P4.count).toBe(0);
      expect(normalizeVietnamPhoneForMeta('0901234567')).toBe('84901234567');
    });
  });

  it('builds N+1 / N+7 / N+30 post-sale milestones and switches channel at the 23h Messenger boundary', () => {
    const deliveredRecentChat = makeRow(
      { leadId: 'lead-post', lastMessageAt: new Date(NOW_MS - 5 * HOUR_MS).toISOString() },
      { stage: 'delivered', addressForm: 'chi', purchasedAt: '2026-11-20', productFactIds: ['ngu-su-dong'] },
    );
    const staleConsulting = makeRow(
      { leadId: 'lead-stale', lastMessageAt: new Date(NOW_MS - 60 * HOUR_MS).toISOString() },
      { stage: 'consulting', addressForm: 'anh', productFactIds: ['ban-tho-gu'] },
    );
    const lostPriceWithin23h = makeRow(
      { leadId: 'lead-lost-price', lastMessageAt: new Date(NOW_MS - 22 * HOUR_MS).toISOString() },
      { stage: 'lost', lostReason: 'price' },
    );
    const suppressedDnc = makeRow({ leadId: 'lead-dnc' }, { stage: 'do_not_contact' });

    const plan = buildLifecyclePlan([deliveredRecentChat, staleConsulting, lostPriceWithin23h, suppressedDnc], PRODUCTS, NOW_MS);

    const postSale = plan.filter((item) => item.leadId === 'lead-post');
    expect(postSale.map((item) => item.milestoneLabel)).toEqual([
      expect.stringContaining('N+1'),
      expect.stringContaining('N+7'),
      expect.stringContaining('N+30'),
    ]);
    expect(postSale[0]!.isOverdue).toBe(true);
    expect(postSale[1]!.isOverdue).toBe(false);
    expect(postSale[0]!.channel).toBe('messenger_24h');
    expect(plan.find((item) => item.leadId === 'lead-stale')).toMatchObject({ category: 'remarketing', channel: 'zalo_or_call', isOverdue: true });
    expect(plan.find((item) => item.leadId === 'lead-lost-price')).toMatchObject({ category: 'remarketing', channel: 'messenger_24h' });
    expect(plan.some((item) => item.leadId === 'lead-dnc')).toBe(false);
  });

  it('closes an unreadable row everywhere', () => {
    const unreadableRow = makeRow(
      { leadId: 'lead-unreadable', recentMessages: [{ text: 'Anh muốn đặt bàn thờ', at: NOW_ISO }] },
      { stage: 'delivered', purchasedAt: '2026-11-20', note: null, detailsUnreadable: true },
    );
    expect(isCrmRowAdsSuppressed(unreadableRow)).toBe(true);
    const playbook = buildSalerPlaybook(unreadableRow, buildCustomerPortrait(unreadableRow, PRODUCTS, NOW_MS), PRODUCTS, NOW_MS);
    expect(playbook).toMatchObject({ priorityScore: 0, priorityBand: 'closed', canContact: false });
    expect(buildLifecyclePlan([unreadableRow], PRODUCTS, NOW_MS)).toEqual([]);
  });
});

describe('B1 · MyGraph segments: counts only', () => {
  it('carries no phone, name, PSID, lead id, quote or note, and counts personas and consent from the server only', () => {
    const consented = makeRow({
      leadId: '22222222-2222-4222-8222-222222222222',
      customerName: 'Nguyễn Văn Hùng',
      phone: '0901234567',
      recentMessages: [{ text: 'Chị mua biếu bố mẹ dịp Tết số 0901234567', at: NOW_ISO }],
      identity: fullProfileIdentity(),
    }, { note: 'Khách ở Quận 7' });
    const legacyTag = makeRow({
      leadId: '33333333-3333-4333-8333-333333333333',
      pageId: '105252511858057',
      customerName: 'Trần Thị Lan',
      phone: '0912345678',
    }, { stage: 'has_phone', note: '[izzi-ctx: v=1; persona=P1; consent=granted]' });

    const segments = summarizeCareCrmSegments([consented, legacyTag], IDENTITY_ON, NOW_MS, false);
    expect(segments.byPersona).toEqual({ P1: 0, P2: 1, P3: 0, P4: 0, unclassified: 1 });
    expect(segments.adsBuckets.consented).toBe(1);

    const serialized = JSON.stringify(segments);
    for (const secret of ['0901234567', '0912345678', 'Nguyễn Văn Hùng', 'Trần Thị Lan', '22222222', '33333333', '105252511858057', 'Quận 7', 'biếu bố mẹ', 'shopee', 'facebook']) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).not.toMatch(/\d{8,}/);

    expect(summarizeCareCrmSegments([consented, legacyTag], { identityEnabled: false, identityUnavailable: false }, NOW_MS).adsBuckets.consented).toBe(0);
  });
});
