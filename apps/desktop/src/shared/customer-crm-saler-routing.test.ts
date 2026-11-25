import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_CARE_CRM_SALER_COLORS,
  type CustomerCareCrmProfileInput,
  type CustomerCareCrmRow,
  type CustomerCareCrmSalerMember,
} from './customer-care-types';
import {
  CRM_SALER_COLOR_PALETTE,
  applyCareStepTransition,
  buildDefaultDaiLongSalerPreset,
  buildQuickSalersFromNames,
  buildSalerSupervisionMatrix,
  parseQuickSalerNames,
  planSalerAutoDistribution,
  resolveEffectiveCareStep,
} from './customer-crm-saler-routing';
import { parseCareCrmProfileInput } from '../main/customer-care/care-crm';

const NOW = Date.parse('2026-11-25T10:00:00.000Z');
const PAGE_DAI_LONG = '741891669999824';
const PAGE_TRANH = '631891669999823';
const PAGE_HONG_HUNG = '105252511858057';

const BASE_PROFILE: CustomerCareCrmProfileInput = {
  stage: 'has_phone',
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
  salerId: null,
  careStep: null,
  callTries: 0,
};

let seq = 0;
function makeRow(
  profileOverrides: Partial<CustomerCareCrmProfileInput> = {},
  rowOverrides: Partial<CustomerCareCrmRow> = {},
): CustomerCareCrmRow {
  seq += 1;
  return {
    leadId: `${String(seq).padStart(8, '0')}-4444-4444-8444-444444444444`,
    pageId: PAGE_DAI_LONG,
    customerName: `Khách ${seq}`,
    phone: `090123${String(1000 + seq)}`,
    zaloMentioned: false,
    leadStatus: 'new',
    phoneCapturedAt: new Date(NOW - seq * 60_000).toISOString(),
    lastMessageAt: new Date(NOW - seq * 60_000).toISOString(),
    recentMessages: [],
    profile: {
      ...BASE_PROFILE,
      ...profileOverrides,
      updatedAt: null,
      updatedBy: null,
    },
    ...rowOverrides,
  };
}

describe('CRM_SALER_COLOR_PALETTE & presets', () => {
  it('defines all 14 closed color tokens with readable white text', () => {
    for (const color of CUSTOMER_CARE_CRM_SALER_COLORS) {
      expect(CRM_SALER_COLOR_PALETTE[color]).toMatchObject({
        color,
        text: '#ffffff',
      });
    }
  });

  it('parses quick saler names separated by comma, semicolon, or newline without duplicates', () => {
    expect(parseQuickSalerNames('Tuấn Thần Đèn, Đại\nNga; tuan than den , Hà My\n')).toEqual([
      'Tuấn Thần Đèn',
      'Đại',
      'Nga',
      'Hà My',
    ]);
  });

  it('builds the 8-saler preset and auto-maps Đồ Đồng Đại Long / Xưởng Tranh Đồng / Hồng Hưng pages', () => {
    const preset = buildDefaultDaiLongSalerPreset([
      { pageId: PAGE_DAI_LONG, pageName: 'Đồ Đồng Đại Long' },
      { pageId: PAGE_TRANH, pageName: 'Xưởng Tranh Đồng Đại Long Nam Định' },
      { pageId: PAGE_HONG_HUNG, pageName: 'Đồng Thờ Hồng Hưng' },
    ]);
    expect(preset).toHaveLength(8);
    expect(preset.find((s) => s.name === 'Tuấn Thần Đèn')?.assignedPageIds).toEqual([PAGE_DAI_LONG]);
    expect(preset.find((s) => s.name === 'Hà My')?.assignedPageIds).toEqual([PAGE_TRANH]);
    expect(preset.find((s) => s.name === 'Thanh Tùng')?.assignedPageIds).toEqual([PAGE_HONG_HUNG]);

    const added = buildQuickSalersFromNames('Minh, Tuấn Thần Đèn, Lan', preset);
    expect(added.map((s) => s.name)).toEqual(['Minh', 'Lan']);
  });
});

describe('3-step workflow transitions & SLA', () => {
  it('resolves legacy 11-key rows and executes all 7 transitions compliant with server validation', () => {
    expect(resolveEffectiveCareStep(makeRow({ stage: 'has_phone', careStep: null }))).toBe('step1_uncalled');
    expect(resolveEffectiveCareStep(makeRow({ stage: 'consulting', nextStep: 'Gọi lại (chưa nghe)' }))).toBe('step2_no_answer');
    expect(resolveEffectiveCareStep(makeRow({ stage: 'consulting', nextStep: 'Báo giá' }))).toBe('step2_called');
    expect(resolveEffectiveCareStep(makeRow({ stage: 'deposit' }))).toBe('step3_zalo');

    const nowDate = new Date(NOW);
    const noAnswer = applyCareStepTransition(BASE_PROFILE, 'step2_no_answer', NOW);
    expect(noAnswer).toMatchObject({
      stage: 'consulting',
      careStep: 'step2_no_answer',
      callTries: 1,
      nextStepDueAt: new Date(NOW + 2 * 3600_000).toISOString(),
    });
    expect(parseCareCrmProfileInput(noAnswer, nowDate)).not.toBeNull();

    const called = applyCareStepTransition(noAnswer, 'step2_called', NOW);
    expect(called).toMatchObject({
      stage: 'consulting',
      careStep: 'step2_called',
      callTries: 2,
      nextStepDueAt: new Date(NOW + 4 * 3600_000).toISOString(),
    });
    expect(parseCareCrmProfileInput(called, nowDate)).not.toBeNull();

    const zalo = applyCareStepTransition(called, 'step3_zalo', NOW);
    expect(zalo).toMatchObject({
      stage: 'consulting',
      careStep: 'step3_zalo',
      nextStepDueAt: new Date(NOW + 24 * 3600_000).toISOString(),
    });
    expect(parseCareCrmProfileInput(zalo, nowDate)).not.toBeNull();

    const won = applyCareStepTransition(zalo, 'won', NOW);
    expect(won).toMatchObject({
      stage: 'deposit',
      careStep: 'step3_zalo',
      purchasedAt: '2026-11-25',
      lostReason: null,
    });
    expect(parseCareCrmProfileInput(won, nowDate)).not.toBeNull();

    const badPhone = applyCareStepTransition(BASE_PROFILE, 'step1_bad_phone', NOW);
    expect(badPhone).toMatchObject({ stage: 'lost', careStep: 'step1_bad_phone', lostReason: 'no_reply', purchasedAt: null });
    expect(parseCareCrmProfileInput(badPhone, nowDate)).not.toBeNull();

    const lostFromWon = applyCareStepTransition(won, 'lost', NOW);
    expect(lostFromWon).toMatchObject({ stage: 'lost', purchasedAt: null, lostReason: 'other' });
    expect(parseCareCrmProfileInput(lostFromWon, nowDate)).not.toBeNull();
  });
});

describe('planSalerAutoDistribution & buildSalerSupervisionMatrix', () => {
  const salers: CustomerCareCrmSalerMember[] = [
    { id: 's1', name: 'Tuấn', color: 'blue', active: true, assignedPageIds: [PAGE_DAI_LONG], memberUserId: '11111111-1111-4111-8111-111111111111' },
    { id: 's2', name: 'Hà My', color: 'purple', active: true, assignedPageIds: [PAGE_TRANH], memberUserId: '22222222-2222-4222-8222-222222222222' },
    { id: 's3', name: 'Tùng', color: 'indigo', active: true, assignedPageIds: [], memberUserId: null },
  ];

  it('distributes round_robin fairly while protecting step3_zalo and won/closed leads', () => {
    const r1 = makeRow({}, { phoneCapturedAt: new Date(NOW - 10_000).toISOString() });
    const r2 = makeRow({}, { phoneCapturedAt: new Date(NOW - 20_000).toISOString() });
    const r3 = makeRow({}, { phoneCapturedAt: new Date(NOW - 30_000).toISOString() });
    const protectedZalo = makeRow({ stage: 'consulting', careStep: 'step3_zalo' });
    const protectedWon = makeRow({ stage: 'deposit' });

    const plan = planSalerAutoDistribution({
      rows: [r3, protectedZalo, r1, protectedWon, r2],
      salers,
      mode: 'round_robin',
      sourceScope: 'unassigned',
      protectZaloAndWon: true,
      nowMs: NOW,
    });

    expect(plan.skippedLockedCount).toBe(2);
    expect(plan.assignments.map((a) => [a.leadId, a.salerId])).toEqual([
      [r1.leadId, 's1'],
      [r2.leadId, 's2'],
      [r3.leadId, 's3'],
    ]);
    expect(plan.bySaler.map((b) => b.addedCount)).toEqual([1, 1, 1]);
  });

  it('routes by_page to dedicated Page salers and falls back to general active salers', () => {
    const daiLongLead = makeRow({}, { pageId: PAGE_DAI_LONG });
    const tranhLead = makeRow({}, { pageId: PAGE_TRANH });
    const hongHungLead = makeRow({}, { pageId: PAGE_HONG_HUNG });

    const plan = planSalerAutoDistribution({
      rows: [daiLongLead, tranhLead, hongHungLead],
      salers,
      mode: 'by_page',
      nowMs: NOW,
    });

    const byLead = new Map(plan.assignments.map((a) => [a.leadId, a.salerId]));
    expect(byLead.get(daiLongLead.leadId)).toBe('s1');
    expect(byLead.get(tranhLead.leadId)).toBe('s2');
    expect(byLead.get(hongHungLead.leadId)).toBe('s3');
  });

  it('rescues stale >2h step1_uncalled leads to other active salers without touching step3_zalo or fresh leads', () => {
    const stale = makeRow(
      { stage: 'has_phone', careStep: 'step1_uncalled', salerId: 's1' },
      { phoneCapturedAt: new Date(NOW - 3 * 3600_000).toISOString() },
    );
    const fresh = makeRow(
      { stage: 'has_phone', careStep: 'step1_uncalled', salerId: 's1' },
      { phoneCapturedAt: new Date(NOW - 30 * 60_000).toISOString() },
    );
    const zalo = makeRow(
      { stage: 'consulting', careStep: 'step3_zalo', salerId: 's1' },
      { phoneCapturedAt: new Date(NOW - 5 * 3600_000).toISOString() },
    );

    const plan = planSalerAutoDistribution({
      rows: [stale, fresh, zalo],
      salers,
      mode: 'rescue_stale',
      rescueSalerId: 's1',
      nowMs: NOW,
    });

    expect(plan.assignments).toHaveLength(1);
    expect(plan.assignments[0]!.leadId).toBe(stale.leadId);
    expect(plan.assignments[0]!.salerId).not.toBe('s1');
  });

  it('builds supervision matrix counts and Zalo conversion percentages accurately', () => {
    const rows = [
      makeRow({ salerId: 's1', stage: 'has_phone', careStep: 'step1_uncalled' }, { phoneCapturedAt: new Date(NOW - 3 * 3600_000).toISOString() }),
      makeRow({ salerId: 's1', stage: 'consulting', careStep: 'step3_zalo' }),
      makeRow({ salerId: 's1', stage: 'deposit', careStep: 'step3_zalo' }),
      makeRow({ salerId: null, ownerUserId: null, stage: 'has_phone' }, { phoneCapturedAt: new Date(NOW - 10_000).toISOString() }),
    ];
    const matrix = buildSalerSupervisionMatrix(rows, salers, NOW);
    const s1 = matrix.rows.find((r) => r.saler?.id === 's1')!;
    expect(s1).toMatchObject({
      total: 3,
      step1Uncalled: 1,
      step1StaleOver2h: 1,
      step3Zalo: 2,
      wonCount: 1,
      zaloRatePct: 67,
    });
    expect(matrix.unassigned.total).toBe(1);
    expect(matrix.totals.total).toBe(4);
  });
});
