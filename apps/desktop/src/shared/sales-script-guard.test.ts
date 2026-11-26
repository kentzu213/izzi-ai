import { describe, expect, it } from 'vitest';
import type { CustomerCareCrmRow, CustomerCareFact } from './customer-care-types';
import {
  auditSalesScriptAgainstFacts,
  buildSalesCoachPrompt,
  parseSalesCoachModelOutput,
  prepareSalesCoachContext,
} from './sales-script-guard';

const FACTS: CustomerCareFact[] = [
  {
    id: 'fact-price-1',
    topic: 'price',
    text: 'Bộ đỉnh đồng cao 60cm giá niêm yết 12.5 triệu, bảo hành 10 năm màu đồng.',
    source: 'Bảng giá 2026',
    approvedAt: '2026-11-20T00:00:00Z',
  },
  {
    id: 'fact-policy-1',
    topic: 'policy',
    text: 'Kiểm tra hàng trước khi thanh toán, quay video thực tế tại xưởng.',
    source: 'Chính sách shop',
    approvedAt: '2026-11-20T00:00:00Z',
  },
];

function makeRow(overrides: Partial<CustomerCareCrmRow> = {}): CustomerCareCrmRow {
  return {
    leadId: 'lead-1',
    pageId: '105252511858057',
    customerName: 'Anh Minh',
    phone: '0912345678',
    zaloMentioned: true,
    leadStatus: 'new',
    phoneCapturedAt: '2026-11-26T08:00:00Z',
    lastMessageAt: '2026-11-26T09:00:00Z',
    recentMessages: [
      { text: 'Shop ơi bộ đỉnh 60cm cho nhà mới tháng sau nhập trạch giá sao? Gọi 0912 345 678 nhé', at: '2026-11-26T09:00:00Z' },
    ],
    profile: {
      stage: 'has_phone',
      ownerUserId: null,
      addressForm: 'anh',
      occasion: 'new_home',
      neededBy: null,
      productFactIds: ['fact-price-1'],
      nextStep: null,
      nextStepDueAt: null,
      lostReason: null,
      purchasedAt: null,
      note: null,
      salerId: null,
      careStep: 'step1_uncalled',
      callTries: 0,
      updatedAt: '2026-11-26T09:05:00Z',
      updatedBy: null,
    },
    ...overrides,
  };
}

describe('sales-script-guard (Slice B)', () => {
  it('allows approved fact prices/warranties while deterministically blocking ungrounded discounts, freeship, and fake prices', () => {
    const allowed = auditSalesScriptAgainstFacts(
      'Dạ bộ đỉnh đồng 60cm bên em giá 12.5 triệu và bảo hành 10 năm ạ.',
      FACTS,
    );
    expect(allowed.findings).toEqual([]);
    expect(allowed.sanitized).toContain('12.5 triệu');
    expect(allowed.sanitized).toContain('bảo hành 10 năm');

    const hallucinated = auditSalesScriptAgainstFacts(
      'Dạ em giảm 20% còn 9.5 triệu, freeship toàn quốc và bảo hành trọn đời, gọi em 0987 654 321 nhé!',
      FACTS,
    );
    const kinds = new Set(hallucinated.findings.map((f) => f.kind));
    expect(kinds.has('ungrounded_discount')).toBe(true);
    expect(kinds.has('ungrounded_price')).toBe(true);
    expect(kinds.has('ungrounded_shipping')).toBe(true);
    expect(kinds.has('ungrounded_warranty')).toBe(true);
    expect(kinds.has('pii_leak')).toBe(true);
    expect(hallucinated.sanitized).not.toContain('9.5 triệu');
    expect(hallucinated.sanitized).not.toContain('giảm 20%');
    expect(hallucinated.sanitized).not.toContain('freeship');
    expect(hallucinated.sanitized).not.toContain('trọn đời');
    expect(hallucinated.sanitized).not.toContain('0987 654 321');
  });

  it('masks raw customer phone in prompt, withholds unconsented persona, and drops hallucinated evidence quotes', () => {
    const row = makeRow();
    const { prompt } = prepareSalesCoachContext(
      row,
      [{ id: 'fact-price-1', label: 'Bộ đỉnh đồng 60cm' }],
      FACTS,
      [{ id: 'kn-1', kind: 'lesson', topicKey: 'sales-playbook:p1', title: 'Gửi video tại xưởng', summary: 'Luôn gửi video quay thật trước khi chốt giá.' }],
      false,
      Date.parse('2026-11-26T10:00:00Z'),
    );

    expect(prompt.userPrompt).not.toContain('0912 345 678');
    expect(prompt.userPrompt).not.toContain('0912345678');
    expect(prompt.userPrompt).toContain('chưa có đồng ý');
    expect(prompt.userPrompt).toContain('Gửi video tại xưởng');

    const parsed = parseSalesCoachModelOutput({
      rawReply: JSON.stringify({
        buyerDiagnosis: 'Khách cần bộ đỉnh đồng 60cm cho dịp nhà mới.',
        evidenceQuotes: ['nhà mới tháng sau nhập trạch', 'câu bịa không hề có trong tin nhắn'],
        objectionStrategy: 'Gửi video quay thật tại xưởng trước khi báo giá.',
        scripts: {
          zalo: 'Dạ chào anh, em gửi anh mẫu bộ đỉnh 60cm giá 12.5 triệu bảo hành 10 năm nhé ạ.',
          call: 'Dạ em chào anh, em gọi tư vấn bộ đỉnh đồng 60cm cho nhà mới, tặng thêm giảm 15% ạ.',
          messenger: 'Dạ em đã nhận số, em nhắn Zalo gửi video thực tế tại xưởng cho anh ngay ạ.',
        },
        nextBestAction: 'Nhắn Zalo gửi video quay cận cảnh bộ đỉnh 60cm',
      }),
      maskedCorpus: prompt.maskedCorpus,
      approvedFacts: FACTS,
      vaultPlaybooks: [{ id: 'kn-1', kind: 'lesson', topicKey: 'sales-playbook:p1', title: 'Gửi video tại xưởng', summary: 'Luôn gửi video quay thật.' }],
    });

    expect(parsed).not.toBeNull();
    expect(parsed!.evidenceQuotes).toEqual(['nhà mới tháng sau nhập trạch']);
    expect(parsed!.factGuardPassed).toBe(false);
    expect(parsed!.scripts.call).not.toContain('giảm 15%');
    expect(parsed!.scripts.call).toContain('[theo chính sách ưu đãi hiện hành của shop]');
    expect(parsed!.scripts.zalo).toContain('12.5 triệu');
  });

  it('builds prompt cleanly when row has zero approved facts', () => {
    const row = makeRow();
    const { portrait } = prepareSalesCoachContext(row, [], [], [], false);
    const p = buildSalesCoachPrompt({ row, portrait, approvedFacts: [], vaultPlaybooks: [] });
    expect(p.userPrompt).toContain('Chưa có Shop Facts');
  });

  it('catches multi-dot Vietnamese currency (15.000.000đ / ₫) and Unicode discount phrases accurately', () => {
    const res = auditSalesScriptAgainstFacts(
      'Dạ bộ này giá 15.000.000đ, hôm nay shop khuyến mãi thêm 10% và bớt riêng 500.000₫ cho anh nhé!',
      FACTS,
    );
    const kinds = res.findings.map((f) => f.kind);
    expect(kinds).toContain('ungrounded_price');
    expect(kinds).toContain('ungrounded_discount');
    expect(res.sanitized).not.toContain('15.000.000đ');
    expect(res.sanitized).not.toContain('10%');
    expect(res.sanitized).not.toContain('500.000₫');

    const approvedVnd = auditSalesScriptAgainstFacts(
      'Dạ bộ đỉnh cao 60cm giá niêm yết 15.000.000đ đúng theo bảng giá shop ạ.',
      [...FACTS, { topic: 'price', text: 'Bộ đỉnh 60cm giá niêm yết 15.000.000 đ' }],
    );
    expect(approvedVnd.findings).toEqual([]);
    expect(approvedVnd.sanitized).toContain('15.000.000đ');
  });
});
