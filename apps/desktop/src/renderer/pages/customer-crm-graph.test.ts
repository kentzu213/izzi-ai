import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type {
  CustomerCareCrmConsent,
  CustomerCareCrmIdField,
  CustomerCareCrmIdentity,
  CustomerCareCrmProfileInput,
  CustomerCareCrmRow,
} from '../../shared/customer-care-types';
import { crmVisibleRows } from './customer-crm-flow';
import {
  CRM_GRAPH_KIND_COLORS,
  CRM_NO_SELECTION,
  CRM_STAGE_COLORS,
  crmCardOccasion,
  crmCustomerLabel,
  crmGraphReuse,
  crmGraphRows,
  crmGraphSearch,
  crmIdentityView,
  crmOpenProfile,
  crmRowsToGraph,
  crmSelectedRow,
  crmSelectionOnClick,
  crmSelectionOnClose,
  crmSelectionOnSearch,
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

const GRANTED: CustomerCareCrmConsent = { state: 'granted', at: AT, noMarketing: false, canAsk: false };
const NOT_GRANTED: Array<CustomerCareCrmConsent | null> = [
  { state: 'declined', at: AT, noMarketing: true, canAsk: false },
  { state: 'withdrawn', at: AT, noMarketing: true, canAsk: false },
  { state: 'unknown', at: null, noMarketing: false, canAsk: true },
  { state: 'asked', at: AT, noMarketing: false, canAsk: false },
  null,
];

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
  consent: GRANTED,
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
      row(LEAD_B, { identity: { ...EMPTY_IDENTITY, consent: GRANTED, persona: { ...field<'P2'>('P2', { confidence: 'medium' }), summary: '' } } }),
      row(LEAD_C, { identity: { ...EMPTY_IDENTITY, consent: GRANTED, persona: { ...field<'P3'>('P3', { confidence: 'low' }), summary: '' } } }),
    ], PRODUCTS, ASSIGNEES);
    expect(graph.nodes.find((node) => node.id === 'persona:P2')?.degree).toBe(2);
    expect(ids(graph)).not.toContain('persona:P3');
  });

  it('ignores identity values outside the contract instead of drawing them', () => {
    const odd = {
      ...EMPTY_IDENTITY,
      consent: GRANTED,
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
      expect(label.normalize('NFKC').replace(/[\s._/,-]/g, '')).not.toMatch(/\d{9,}/);
      for (const phone of ['0901234567', '901234567', '0912345678', '0987654321']) expect(label).not.toContain(phone);
    }
    expect(labels).toEqual(expect.arrayContaining(['Khách ·567', 'Khách ·678', 'Khách ·321']));
    expect(labels.some((label) => label.startsWith('Đèn thờ, hotline'))).toBe(true);
    expect(JSON.stringify(graph)).not.toMatch(/0901234567|0912345678|0987654321|0901\.234\.567/);
  });

  it('masks a run of nine or more digits in every probe form, full-width included, and keeps shorter numbers', () => {
    const probes = [
      '0901234567', '0901 234 567', '0901.234.567', '0901-234-567', '0901/234/567', '0901_234_567', '0901,234,567',
      '+84 901 234 567', '０９０１２３４５６７', '0 9 0 1 2 3 4 5 6 7', '901234567',
    ];
    const products = probes.map((probe, index) => ({ id: `p-${index}`, label: `Gọi ${probe} nhé` }));
    const graph = crmRowsToGraph([row(LEAD_A, {}, { productFactIds: products.map((product) => product.id) })], products, ASSIGNEES);
    const labels = graph.nodes.filter((node) => node.kind === 'product').map((node) => node.label);
    expect(labels).toHaveLength(probes.length);
    for (const label of labels) expect(label).toBe('Gọi ••• nhé');
    for (const probe of probes) {
      expect(crmCustomerLabel({ customerName: `Hoa ${probe}`, phone: '0901234567' }), probe).toBe('Khách ·567');
    }
    // A price of eight digits stays; privacy wins over a longer digit run, which is always masked.
    const short = crmRowsToGraph([row(LEAD_A, {}, { productFactIds: ['x'] })], [{ id: 'x', label: 'Bàn 1m27 giá 15.000.000đ' }], ASSIGNEES);
    expect(short.nodes.find((node) => node.id === 'product:x')?.label).toBe('Bàn 1m27 giá 15.000.000đ');
  });

  it('strips invisible and bidi characters from labels', () => {
    const graph = crmRowsToGraph([row(LEAD_A, { customerName: 'Ho\u200Ba\u202E Lan\u0007' })], PRODUCTS, ASSIGNEES);
    expect(graph.nodes[0].label).toBe('Hoa Lan');
  });
});

describe('consent gate (second guard behind the server)', () => {
  it('draws no persona, ad or link node unless the customer agreed', () => {
    for (const consent of NOT_GRANTED) {
      const graph = crmRowsToGraph([row(LEAD_A, { identity: { ...IDENTITY, consent } })], PRODUCTS, ASSIGNEES);
      expect(graph.nodes.some((node) => IDENTITY_KINDS.includes(node.kind)), String(consent?.state)).toBe(false);
    }
    const granted = crmRowsToGraph([row(LEAD_A, { identity: IDENTITY })], PRODUCTS, ASSIGNEES);
    expect(granted.nodes.filter((node) => IDENTITY_KINDS.includes(node.kind))).toHaveLength(3);
  });

  it('shows only the order layer on the card unless the customer agreed, and leaks nothing else', () => {
    for (const consent of NOT_GRANTED) {
      const view = crmIdentityView({ ...IDENTITY, consent }, PRODUCTS)!;
      expect(view.lines.map((line) => line.key), String(consent?.state)).toEqual(['timeline', 'productFactIds']);
      expect(view.age).toBeNull();
      const text = JSON.stringify(view);
      for (const secret of ['P2', 'Chị', 'bố mẹ', 'ưu đãi', 'shopee', 'Mẫu bàn thờ', 'triệu', '25', 'Mua cho nhà mới']) {
        expect(text, `${String(consent?.state)}: ${secret}`).not.toContain(secret);
      }
    }
  });
});

describe('crmGraphReuse (a refresh that changed nothing keeps the layout)', () => {
  it('returns the same graph for equal data in new arrays, and a new one when a row, identity or label changes', () => {
    const rows = [row(LEAD_A, { identity: IDENTITY }), row(LEAD_B)];
    const first = crmGraphReuse(null, rows, PRODUCTS, ASSIGNEES);
    const copy = rows.map((item) => ({ ...item, profile: { ...item.profile }, recentMessages: [{ text: 'mới', at: AT }] }));
    expect(crmGraphReuse(first, copy, [...PRODUCTS], [...ASSIGNEES])).toBe(first);

    const saved = [rows[0], { ...rows[1], profile: { ...rows[1].profile, stage: 'deposit' as const, updatedAt: '2026-11-25T02:00:00.000Z' } }];
    const afterSave = crmGraphReuse(first, saved, PRODUCTS, ASSIGNEES);
    expect(afterSave).not.toBe(first);
    expect(afterSave.graph.nodes.some((node) => node.id === 'stage:deposit')).toBe(true);

    expect(crmGraphReuse(first, [{ ...rows[0], identity: { ...IDENTITY, version: 'v2' } }, rows[1]], PRODUCTS, ASSIGNEES)).not.toBe(first);
    const withdrawn = crmGraphReuse(first, [{ ...rows[0], identity: { ...IDENTITY, consent: NOT_GRANTED[1] } }, rows[1]], PRODUCTS, ASSIGNEES);
    expect(withdrawn.graph.nodes.some((node) => node.kind === 'persona')).toBe(false);
    expect(crmGraphReuse(first, rows, PRODUCTS, [{ userId: OWNER_ID, label: 'Lan Anh' }])).not.toBe(first);
    expect(crmGraphReuse(first, [rows[1]], PRODUCTS, ASSIGNEES)).not.toBe(first);
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

  it('"Mở hồ sơ" shows a row that "Cần gọi hôm nay" and the stage filter leave out, by pinning it open', () => {
    const now = Date.parse('2026-11-25T03:00:00.000Z');
    // Not due today (a later step) and not in the stage chosen in the graph.
    const later = row(LEAD_B, {}, { stage: 'deposit', nextStepDueAt: '2026-12-10T02:00:00.000Z' });
    const rows = [row(LEAD_A, {}, { stage: 'has_phone', nextStep: null, nextStepDueAt: null }), later];
    const filter = { view: 'today' as const, stage: 'has_phone' as const };
    expect(crmVisibleRows(rows, filter, now, null).map((item) => item.leadId)).toEqual([LEAD_A]);

    const opened = crmOpenProfile(LEAD_B);
    expect(opened.display).toBe('table');
    expect(opened.revealId).toBe(LEAD_B);
    expect(crmVisibleRows(rows, filter, now, opened.expandedId).map((item) => item.leadId)).toEqual([LEAD_A, LEAD_B]);
  });
});

describe('graph selection and focus', () => {
  const customer = { id: `customer:${LEAD_A}`, kind: 'customer' as const };
  const hub = { id: 'stage:consulting', kind: 'stage' as const };

  it('a node click selects from the canvas; a second click on a hub clears it, on a customer keeps it', () => {
    const clicked = crmSelectionOnClick(CRM_NO_SELECTION, customer);
    expect(clicked).toEqual({ nodeId: customer.id, from: 'canvas' });
    expect(crmSelectionOnClick(clicked, customer)).toEqual(clicked);
    const onHub = crmSelectionOnClick(clicked, hub);
    expect(onHub).toEqual({ nodeId: hub.id, from: 'canvas' });
    expect(crmSelectionOnClick(onHub, hub)).toEqual(CRM_NO_SELECTION);
  });

  it('closing the card returns focus where the customer was chosen: the search box or the canvas', () => {
    expect(crmSelectionOnClose(crmSelectionOnSearch(customer.id))).toEqual({ next: CRM_NO_SELECTION, focus: 'search' });
    expect(crmSelectionOnClose(crmSelectionOnClick(CRM_NO_SELECTION, customer))).toEqual({ next: CRM_NO_SELECTION, focus: 'stage' });
    expect(crmSelectionOnClose(CRM_NO_SELECTION)).toEqual({ next: CRM_NO_SELECTION, focus: null });
  });
});

describe('crmCardOccasion ("Dịp mua" once on the card)', () => {
  it('uses the staff value, and the AI value only when staff left it empty', () => {
    expect(crmCardOccasion(row(LEAD_A, { identity: IDENTITY }))).toEqual({ label: 'Nhà mới', badge: null });
    expect(crmCardOccasion(row(LEAD_A, { identity: IDENTITY }, { occasion: null }))).toEqual({ label: 'Tết', badge: 'AI gợi ý' });
    const confirmed = { ...IDENTITY, occasion: field<'gift'>('gift', { status: 'confirmed', source: 'staff' }) };
    expect(crmCardOccasion(row(LEAD_A, { identity: confirmed }, { occasion: null }))).toEqual({ label: 'Làm quà', badge: 'Đã duyệt' });
    // The occasion is order-layer data, so it shows without consent; a low-confidence one never does.
    expect(crmCardOccasion(row(LEAD_A, { identity: { ...IDENTITY, consent: NOT_GRANTED[0] } }, { occasion: null }))?.label).toBe('Tết');
    const low = { ...IDENTITY, occasion: field<'tet'>('tet', { confidence: 'low' }) };
    expect(crmCardOccasion(row(LEAD_A, { identity: low }, { occasion: null }))).toBeNull();
    expect(crmCardOccasion(row(LEAD_A, {}, { occasion: null }))).toBeNull();
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
      consent: GRANTED,
      persona: { ...field<'P1'>('P1', { confidence: 'low' }), summary: 'x' },
      ageBand: field<Array<'55+'>>(['55+'], { confidence: 'low' }),
      family: field<{ recipient: 'gift' }>({ recipient: 'gift' }, { evidence: [{ source: 'izzi', at: AT, quote: null }] }),
    }, PRODUCTS)!;
    expect(view).toEqual({ consent: { label: 'Đồng ý', tone: 'granted' }, lines: [], age: null });
  });

  it('shows family only with a quote whose source is the customer; a page or izzi quote never counts', () => {
    const family = (evidence: CustomerCareCrmIdField<unknown>['evidence']) => crmIdentityView({
      ...EMPTY_IDENTITY,
      consent: GRANTED,
      family: field<{ recipient: 'parents' }>({ recipient: 'parents' }, { evidence }),
    }, PRODUCTS)!.lines.find((line) => line.key === 'family') ?? null;
    expect(family([{ source: 'izzi', at: AT, quote: 'Shop: chị mua cho bố mẹ ạ' }])).toBeNull();
    expect(family([{ source: 'page', at: AT, quote: 'mua cho bố mẹ' }])).toBeNull();
    expect(family([{ source: 'customer', at: AT, quote: '   ' }])).toBeNull();
    expect(family([
      { source: 'page', at: AT, quote: 'Shop: chị mua cho bố mẹ ạ' },
      { source: 'customer', at: AT, quote: 'em mua cho bố mẹ ạ' },
    ])?.quote).toBe('em mua cho bố mẹ ạ');
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
      ...EMPTY_IDENTITY, consent: GRANTED, ageBand: field(bands as Array<'18-24'>, { confidence: 'medium' }),
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
