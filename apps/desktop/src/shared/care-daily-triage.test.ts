import { describe, expect, it } from 'vitest';
import type { CustomerCareCrmRow, CustomerCareCrmSalerMember } from './customer-care-types';
import { buildDailySalesTriage } from './care-daily-triage';
import { distillAnonymizedSalesLessons } from './sales-outcome-distiller';

const NOW = Date.parse('2026-11-26T12:00:00Z');

const SALERS: CustomerCareCrmSalerMember[] = [
  { id: 'saler-a', name: 'Lan', color: 'teal', active: true, assignedPageIds: ['p1'], memberUserId: null },
  { id: 'saler-b', name: 'Tuấn', color: 'blue', active: true, assignedPageIds: ['p1'], memberUserId: null },
];

function row(id: string, overrides: Partial<CustomerCareCrmRow> = {}, prof: Partial<CustomerCareCrmRow['profile']> = {}): CustomerCareCrmRow {
  return {
    leadId: id,
    pageId: 'p1',
    customerName: `Khách ${id}`,
    phone: `09120000${id.slice(-2).padStart(2, '0')}`,
    zaloMentioned: true,
    leadStatus: 'new',
    phoneCapturedAt: '2026-11-26T08:00:00Z', // 4h ago -> stale > 2h
    lastMessageAt: '2026-11-26T08:30:00Z',
    recentMessages: [{ text: 'Anh hỏi mẫu đỉnh đồng nhà mới 0912345678', at: '2026-11-26T08:30:00Z' }],
    profile: {
      stage: 'has_phone',
      ownerUserId: null,
      addressForm: 'anh',
      occasion: 'new_home',
      neededBy: null,
      productFactIds: [],
      nextStep: null,
      nextStepDueAt: null,
      lostReason: null,
      purchasedAt: null,
      note: null,
      salerId: 'saler-a',
      careStep: 'step1_uncalled',
      callTries: 0,
      updatedAt: '2026-11-26T08:35:00Z',
      updatedBy: null,
      ...prof,
    },
    ...overrides,
  };
}

describe('Daily Saler Triage & Closed-Loop Outcome Distiller (Slice C)', () => {
  it('classifies leads into urgent/followup/lifecycle by SLA, excludes do_not_contact, and keeps summary 0% PII', () => {
    const rows: CustomerCareCrmRow[] = [
      row('01', {}, { stage: 'has_phone', careStep: 'step1_uncalled', salerId: 'saler-a' }), // urgent (>2h uncalled + hot)
      row('02', { phoneCapturedAt: '2026-11-26T11:30:00Z', lastMessageAt: '2026-11-24T08:00:00Z' }, { stage: 'consulting', careStep: 'step2_no_answer', salerId: 'saler-b' }), // followup
      row('03', { lastMessageAt: '2026-11-20T08:00:00Z' }, { stage: 'delivered', purchasedAt: '2026-11-20', careStep: 'step3_zalo', salerId: 'saler-a' }), // lifecycle
      row('04', {}, { stage: 'do_not_contact', salerId: 'saler-a' }), // suppressed!
    ];

    const plan = buildDailySalesTriage(rows, { salers: SALERS, nowMs: NOW });
    expect(plan.totalActiveLeads).toBe(3);
    expect(plan.suppressedSkipped).toBe(1);
    expect(plan.urgentCount).toBe(1);
    expect(plan.urgent[0].leadId).toBe('01');
    expect(plan.followupCount).toBe(1);
    expect(plan.followup[0].leadId).toBe('02');
    expect(plan.lifecycleCount).toBe(1);
    expect(plan.lifecycle[0].leadId).toBe('03');
    expect(plan.bySaler.find((s) => s.salerName === 'Lan')?.total).toBe(2);
    // Zero customer phone or personal name in operational summary!
    expect(plan.markdownSummary).not.toContain('0912');
    expect(plan.markdownSummary).not.toContain('Khách 01');
  });

  it('distills anonymized cohort lessons (n >= 3) with 0% PII across SLA stalls, lost price, and winning occasions', () => {
    const rows: CustomerCareCrmRow[] = [
      row('11', {}, { stage: 'has_phone', careStep: 'step1_uncalled' }),
      row('12', {}, { stage: 'has_phone', careStep: 'step1_uncalled' }),
      row('13', {}, { stage: 'has_phone', careStep: 'step1_uncalled' }),
      row('21', {}, { stage: 'lost', lostReason: 'price' }),
      row('22', {}, { stage: 'lost', lostReason: 'price' }),
      row('23', {}, { stage: 'lost', lostReason: 'price' }),
      row('31', {}, { stage: 'deposit', occasion: 'new_home' }),
      row('32', {}, { stage: 'delivered', occasion: 'new_home' }),
      row('33', {}, { stage: 'deposit', occasion: 'new_home' }),
    ];

    const lessons = distillAnonymizedSalesLessons(rows, { nowMs: NOW, minSampleCount: 3 });
    const topics = new Set(lessons.map((l) => l.topicKey));
    expect(topics.has('sales-playbook:sla-first-call-2h')).toBe(true);
    expect(topics.has('sales-objection:lost-price')).toBe(true);
    expect(topics.has('sales-lesson:winning-occasion-new_home')).toBe(true);

    const serialized = JSON.stringify(lessons);
    expect(serialized).not.toContain('0912');
    expect(serialized).not.toContain('Khách 11');
  });
});
