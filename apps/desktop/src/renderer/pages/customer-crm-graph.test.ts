import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type {
  CustomerCareCrmIdField,
  CustomerCareCrmIdentity,
  CustomerCareCrmProfileInput,
  CustomerCareCrmRow,
} from '../../shared/customer-care-types';
import {
  CRM_GRAPH_KIND_COLORS,
  CRM_STAGE_COLORS,
  crmCustomerLabel,
  crmGraphRows,
  crmGraphSearch,
  crmIdentityView,
  crmOpenProfile,
  crmRowsToGraph,
  crmSelectedRow,
} from './customer-crm-graph';

const OWNER_ID = '66666666-6666-4666-8666-666666666666';
const GONE_ID = '77777777-7777-4777-8777-777777777777';
const LEAD_A = '44444444-4444-4444-8444-444444444441';
const LEAD_B = '44444444-4444-4444-8444-444444444442';
const LEAD_C = '44444444-4444-4444-8444-444444444443';
const AT = '2026-11-25T01:00:00.000Z';

const PROFILE: CustomerCareCrmProfileInput = {
  stage: 'consulting',
  ownerUserId: OWNER_ID,
  addressForm: 'chi',
  occasion: 'new_home',
  neededBy: '2026-12-20',
  productFactIds: ['ban-127'],
  nextStep: 'Gọi lại báo giá',
  nextStepDueAt: '2026-11-24T02:00:00.000Z',
  lostReason: null,
  purchasedAt: null,
  note: 'Nhà mới',
};

function row(leadId: string, overrides: Partial<CustomerCareCrmRow> = {}, profile: Partial<CustomerCareCrmProfileInput> = {}): CustomerCareCrmRow {
  return {
    leadId,
    pageId: '105252511858057',
    customerName: 'Nguyễn Thị Hoa',
    phone: '0901234567',
    zaloMentioned: false,
    leadStatus: 'contacted',
    phoneCapturedAt: '2026-11-24T06:00:00.000Z',
    lastMessageAt: '2026-11-24T06:00:00.000Z',
    recentMessages: [],
    profile: { ...PROFILE, ...profile, updatedAt: '2026-11-21T09:30:00.000Z', updatedBy: OWNER_ID },
    ...overrides,
  };
}

function field<T>(value: T, extra: Partial<CustomerCareCrmIdField<T>> = {}): CustomerCareCrmIdField<T> {
  return { value, confidence: 'high', kind: 'stated', source: 'ai', status: 'suggested', updatedAt: AT, evidence: [], ...extra };
}

const EMPTY_IDENTITY: CustomerCareCrmIdentity = {
  version: null,
  lastRunAt: null,
  consent: null,
  occasion: null,
  timeline: null,
  productFactIds: null,
  addressForm: null,
  ageBand: null,
  family: null,
  interests: null,
  persona: null,
};

const IDENTITY: CustomerCareCrmIdentity = {
  version: 'v1',
  lastRunAt: AT,
  consent: { state: 'granted', at: AT, noMarketing: false, canAsk: false },
  occasion: field<'tet'>('tet', { confidence: 'medium', kind: 'inferred' }),
  timeline: field<'before_tet'>('before_tet'),
  productFactIds: field(['ban-127', 'gone-fact']),
  addressForm: field<'chi'>('chi', { status: 'confirmed', source: 'staff' }),
  ageBand: field<Array<'25-34' | '35-44'>>(['25-34', '35-44'], { confidence: 'medium', kind: 'inferred' }),
  family: field<{ recipient: 'parents' }>({ recipient: 'parents' }, { evidence: [{ source: 'customer', at: AT, quote: 'em mua cho bố mẹ ạ' }] }),
  interests: {
    adTitle: field('Bàn thờ gỗ gụ ưu đãi Tết', { source: 'ad' }),
    sharedLinks: [
      field({ title: 'Mẫu bàn thờ đẹp', domain: 'Shopee.vn' }, { source: 'meta' }),
      field({ title: null, domain: 'tiktok.com' }, { confidence: 'low' }),
    ],
    budgetBand: field<'5m_15m'>('5m_15m', { confidence: 'medium' }),
  },
  persona: { ...field<'P2'>('P2'), summary: 'Mua cho nhà mới, trước Tết' },
};

const PRODUCTS = [
  { id: 'ban-127', label: 'Bàn thờ gỗ gụ 1m27' },
  { id: 'den-tho', label: 'Đèn thờ, hotline 0901 234 567' },
];
const ASSIGNEES = [{ userId: OWNER_ID, label: 'Lan' }];
const IDENTITY_KINDS = ['persona', 'interest', 'ad'];

const ids = (graph: { nodes: Array<{ id: string }> }) => graph.nodes.map((node) => node.id);
const linkPairs = (graph: { links: Array<{ source: string; target: string }> }) => graph.links.map((link) => `${link.source}>${link.target}`);
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

describe('crmRowsToGraph', () => {
  it('links every customer to its stage, approved products, occasion and owner with ids built from the data', () => {
    const graph = crmRowsToGraph([row(LEAD_A)], PRODUCTS, ASSIGNEES);
    expect(ids(graph)).toEqual([
      `customer:${LEAD_A}`,
      'stage:consulting',
      'product:ban-127',
      'occasion:new_home',
      `owner:${OWNER_ID}`,
    ]);
    expect(linkPairs(graph)).toEqual([
      `customer:${LEAD_A}>stage:consulting`,
      `customer:${LEAD_A}>product:ban-127`,
      `customer:${LEAD_A}>occasion:new_home`,
      `customer:${LEAD_A}>owner:${OWNER_ID}`,
    ]);
    const labels = Object.fromEntries(graph.nodes.map((node) => [node.id, node.label]));
    expect(labels).toMatchObject({
      'stage:consulting': 'Đang tư vấn',
      'product:ban-127': 'Bàn thờ gỗ gụ 1m27',
      'occasion:new_home': 'Nhà mới',
      [`owner:${OWNER_ID}`]: 'Lan',
    });
  });

  it('is deterministic: the same rows give the same graph, and shared hubs are one node with a degree', () => {
    const rows = [row(LEAD_A), row(LEAD_B, { customerName: 'Trần Văn Nam' })];
    const first = crmRowsToGraph(rows, PRODUCTS, ASSIGNEES);
    expect(crmRowsToGraph(rows, PRODUCTS, ASSIGNEES)).toEqual(first);
    expect(first.nodes.filter((node) => node.id === 'stage:consulting')).toHaveLength(1);
    expect(first.nodes.find((node) => node.id === 'stage:consulting')?.degree).toBe(2);
    expect(new Set(first.links.map((link) => link.id)).size).toBe(first.links.length);
    // Reordering rows never changes an id.
    expect(new Set(ids(crmRowsToGraph([...rows].reverse(), PRODUCTS, ASSIGNEES)))).toEqual(new Set(ids(first)));
  });

  it('colors customers and their stage hub by stage', () => {
    const graph = crmRowsToGraph([
      row(LEAD_A, {}, { stage: 'deposit' }),
      row(LEAD_B, {}, { stage: 'do_not_contact' }),
    ], PRODUCTS, ASSIGNEES);
    const color = (id: string) => graph.nodes.find((node) => node.id === id)?.color;
    expect(color(`customer:${LEAD_A}`)).toBe(CRM_STAGE_COLORS.deposit);
    expect(color('stage:deposit')).toBe(CRM_STAGE_COLORS.deposit);
    expect(color(`customer:${LEAD_B}`)).toBe(CRM_STAGE_COLORS.do_not_contact);
    expect(color('product:ban-127')).toBe(CRM_GRAPH_KIND_COLORS.product);
    expect(new Set(Object.values(CRM_STAGE_COLORS)).size).toBe(6);
  });

  it('skips unknown products, an unassigned owner and an empty occasion, and names a departed owner', () => {
    const graph = crmRowsToGraph([
      row(LEAD_A, {}, { productFactIds: ['not-on-this-pc'], ownerUserId: null, occasion: null }),
      row(LEAD_B, {}, { ownerUserId: GONE_ID }),
    ], PRODUCTS, ASSIGNEES);
    expect(ids(graph)).not.toContain('product:not-on-this-pc');
    expect(linkPairs(graph).filter((pair) => pair.startsWith(`customer:${LEAD_A}`))).toEqual([`customer:${LEAD_A}>stage:consulting`]);
    expect(graph.nodes.find((node) => node.id === `owner:${GONE_ID}`)?.label).toBe('Người đã rời dự án');
  });

  it('adds persona, source-ad and shared-link nodes only when identity is present', () => {
    expect(crmRowsToGraph([row(LEAD_A)], PRODUCTS, ASSIGNEES).nodes.some((node) => IDENTITY_KINDS.includes(node.kind))).toBe(false);
    expect(crmRowsToGraph([row(LEAD_A, { identity: EMPTY_IDENTITY })], PRODUCTS, ASSIGNEES).nodes
      .some((node) => IDENTITY_KINDS.includes(node.kind))).toBe(false);

    const graph = crmRowsToGraph([row(LEAD_A, { identity: IDENTITY })], PRODUCTS, ASSIGNEES);
    const extra = graph.nodes.filter((node) => IDENTITY_KINDS.includes(node.kind));
    expect(extra.map((node) => [node.id, node.label])).toEqual([
      ['persona:P2', 'Chân dung P2'],
      ['ad:bàn thờ gỗ gụ ưu đãi tết', 'Bàn thờ gỗ gụ ưu đãi Tết'],
      ['interest:shopee.vn', 'shopee.vn'],
    ]);
    expect(linkPairs(graph)).toEqual(expect.arrayContaining([
      `customer:${LEAD_A}>persona:P2`,
      `customer:${LEAD_A}>ad:bàn thờ gỗ gụ ưu đãi tết`,
      `customer:${LEAD_A}>interest:shopee.vn`,
    ]));
    // The low-confidence link is hidden; age, family, form of address, budget and the AI occasion stay off the graph.
    expect(ids(graph)).not.toContain('interest:tiktok.com');
    expect(ids(graph)).not.toContain('occasion:tet');
    expect(graph.nodes.some((node) => /25-34|parents|budget|5m_15m|before_tet/.test(node.id))).toBe(false);
  });

  it('links customers who share a persona to one P1–P4 hub', () => {
    const graph = crmRowsToGraph([
      row(LEAD_A, { identity: IDENTITY }),
      row(LEAD_B, { identity: { ...EMPTY_IDENTITY, persona: { ...field<'P2'>('P2', { confidence: 'medium' }), summary: '' } } }),
      row(LEAD_C, { identity: { ...EMPTY_IDENTITY, persona: { ...field<'P3'>('P3', { confidence: 'low' }), summary: '' } } }),
    ], PRODUCTS, ASSIGNEES);
    expect(graph.nodes.find((node) => node.id === 'persona:P2')?.degree).toBe(2);
    expect(ids(graph)).not.toContain('persona:P3');
  });

  it('ignores identity values outside the contract instead of drawing them', () => {
    const odd = {
      ...EMPTY_IDENTITY,
      persona: { ...field('P9'), summary: '' },
      interests: {
        adTitle: { ...field('Ad'), source: 'robot' },
        sharedLinks: [field({ title: '  ', domain: '' }), field('not-an-object'), { value: { domain: 'x.vn' } }],
        budgetBand: null,
      },
    } as unknown as CustomerCareCrmIdentity;
    const graph = crmRowsToGraph([row(LEAD_A, { identity: odd })], PRODUCTS, ASSIGNEES);
    expect(graph.nodes.some((node) => IDENTITY_KINDS.includes(node.kind))).toBe(false);
  });

  it('never puts a phone number in a node label', () => {
    const phoneName = row(LEAD_A, { customerName: 'Hoa 0901 234 567' });
    const noName = row(LEAD_B, { customerName: null, phone: '0912345678' }, { productFactIds: ['den-tho'] });
    const blank = row(LEAD_C, { customerName: '  ', phone: '0987654321' });
    const identity: CustomerCareCrmIdentity = {
      ...IDENTITY,
      interests: {
        adTitle: field('Gọi ngay 0901.234.567'),
        sharedLinks: [field({ title: null, domain: 'zalo.me/0901234567' })],
        budgetBand: null,
      },
    };
    const graph = crmRowsToGraph([{ ...phoneName, identity }, noName, blank], PRODUCTS, ASSIGNEES);
    const labels = graph.nodes.map((node) => node.label);
    for (const label of labels) {
      expect(label.replace(/\D/g, '')).not.toMatch(/\d{7,}/);
      for (const phone of ['0901234567', '901234567', '0912345678', '0987654321']) expect(label).not.toContain(phone);
    }
    expect(labels).toEqual(expect.arrayContaining(['Khách ·567', 'Khách ·678', 'Khách ·321']));
    expect(labels.some((label) => label.startsWith('Đèn thờ, hotline'))).toBe(true);
    expect(JSON.stringify(graph)).not.toMatch(/0901234567|0912345678|0987654321|0901\.234\.567/);
  });

  it('strips invisible and bidi characters from labels', () => {
    const graph = crmRowsToGraph([row(LEAD_A, { customerName: 'Ho\u200Ba\u202E Lan\u0007' })], PRODUCTS, ASSIGNEES);
    expect(graph.nodes[0].label).toBe('Hoa Lan');
  });
});

describe('crmCustomerLabel', () => {
  it('uses the name, or "Khách ·" and the last three digits', () => {
    expect(crmCustomerLabel({ customerName: 'Nguyễn Thị Hoa', phone: '0901234567' })).toBe('Nguyễn Thị Hoa');
    expect(crmCustomerLabel({ customerName: null, phone: '0901234567' })).toBe('Khách ·567');
  });
});

describe('crmGraphSearch', () => {
  it('finds customers by name without accents and never by phone', () => {
    const graph = crmRowsToGraph([row(LEAD_A), row(LEAD_B, { customerName: 'Trần Văn Nam' })], PRODUCTS, ASSIGNEES);
    expect(crmGraphSearch(graph, 'nguyen thi').map((node) => node.leadId)).toEqual([LEAD_A]);
    expect(crmGraphSearch(graph, 'TRAN')).toHaveLength(1);
    expect(crmGraphSearch(graph, '0901')).toEqual([]);
    expect(crmGraphSearch(graph, '   ')).toEqual([]);
    expect(crmGraphSearch(graph, 'đang tư vấn')).toEqual([]);
  });
});

describe('graph view state', () => {
  it('filters the graph by stage only (the call list is a table view)', () => {
    const rows = [row(LEAD_A), row(LEAD_B, {}, { stage: 'lost' })];
    expect(crmGraphRows(rows, 'any')).toEqual(rows);
    expect(crmGraphRows(rows, 'lost').map((item) => item.leadId)).toEqual([LEAD_B]);
  });

  it('keeps the card on a customer still on screen and drops it when the row is gone', () => {
    const rows = [row(LEAD_A), row(LEAD_B)];
    expect(crmSelectedRow(rows, LEAD_B)?.leadId).toBe(LEAD_B);
    expect(crmSelectedRow(rows, LEAD_C)).toBeNull();
    expect(crmSelectedRow(rows, null)).toBeNull();
  });

  it('"Mở hồ sơ" switches to the table with that row open and brought into view', () => {
    expect(crmOpenProfile(LEAD_A)).toEqual({ display: 'table', expandedId: LEAD_A, revealId: LEAD_A });
  });
});

describe('crmIdentityView', () => {
  it('is null without identity', () => {
    expect(crmIdentityView(undefined, PRODUCTS)).toBeNull();
    expect(crmIdentityView(null, PRODUCTS)).toBeNull();
  });

  it('lists each shown field with an AI or "Đã duyệt" badge and a confidence, and the age apart as an estimate', () => {
    const view = crmIdentityView(IDENTITY, PRODUCTS)!;
    expect(view.consent).toEqual({ label: 'Đồng ý', tone: 'granted' });
    expect(view.lines.map((line) => [line.key, line.label, line.value, line.badge, line.confidence])).toEqual([
      ['persona', 'Chân dung', 'P2 · Mua cho nhà mới, trước Tết', 'AI', 'cao'],
      ['addressForm', 'Xưng hô', 'Chị', 'Đã duyệt', 'cao'],
      ['family', 'Gia đình', 'Mua cho bố mẹ', 'AI', 'cao'],
      ['occasion', 'Dịp mua', 'Tết', 'AI', 'vừa'],
      ['timeline', 'Thời điểm', 'Trước Tết', 'AI', 'cao'],
      ['productFactIds', 'Sản phẩm quan tâm', 'Bàn thờ gỗ gụ 1m27, 1 sản phẩm khác', 'AI', 'cao'],
      ['adTitle', 'Quảng cáo', 'Bàn thờ gỗ gụ ưu đãi Tết', 'AI', 'cao'],
      ['sharedLink:0', 'Liên kết khách gửi', 'Mẫu bàn thờ đẹp · shopee.vn', 'AI', 'cao'],
      ['budgetBand', 'Ngân sách', '5–15 triệu', 'AI', 'vừa'],
    ]);
    expect(view.lines.find((line) => line.key === 'family')?.quote).toBe('em mua cho bố mẹ ạ');
    expect(view.age).toMatchObject({ label: 'Độ tuổi (ước tính)', value: '25–44', badge: 'AI', confidence: 'vừa' });
  });

  it('hides low-confidence fields and a family value without the customer\'s words', () => {
    const view = crmIdentityView({
      ...EMPTY_IDENTITY,
      persona: { ...field<'P1'>('P1', { confidence: 'low' }), summary: 'x' },
      ageBand: field<Array<'55+'>>(['55+'], { confidence: 'low' }),
      family: field<{ recipient: 'gift' }>({ recipient: 'gift' }, { evidence: [{ source: 'izzi', at: AT, quote: null }] }),
    }, PRODUCTS)!;
    expect(view).toEqual({ consent: null, lines: [], age: null });
  });

  it('names every consent state with one of the four chips', () => {
    const chip = (state: 'unknown' | 'asked' | 'granted' | 'declined' | 'withdrawn') => crmIdentityView({
      ...EMPTY_IDENTITY, consent: { state, at: null, noMarketing: false, canAsk: true },
    }, PRODUCTS)?.consent?.label;
    expect(['unknown', 'asked', 'granted', 'declined', 'withdrawn'].map((state) => chip(state as 'unknown'))).toEqual([
      'Chưa hỏi', 'Đã hỏi', 'Đồng ý', 'Từ chối', 'Từ chối',
    ]);
  });

  it('shows one age band or two adjacent ones, nothing else', () => {
    const age = (bands: string[]) => crmIdentityView({
      ...EMPTY_IDENTITY, ageBand: field(bands as Array<'18-24'>, { confidence: 'medium' }),
    }, PRODUCTS)?.age?.value ?? null;
    expect(age(['18-24'])).toBe('18–24');
    expect(age(['55+'])).toBe('55+');
    expect(age(['45-54', '55+'])).toBe('45+');
    expect(age(['18-24', '35-44'])).toBeNull();
    expect(age(['18-24', '25-34', '35-44'])).toBeNull();
    expect(age(['12-17'])).toBeNull();
  });

  it('has no gender field anywhere in the contract or the view', () => {
    for (const file of ['../../shared/customer-care-types.ts', './customer-crm-graph.ts', './CustomerCrmCard.tsx']) {
      expect(read(file), file).not.toMatch(/\bgender\??\s*:|giới tính/i);
    }
  });
});
