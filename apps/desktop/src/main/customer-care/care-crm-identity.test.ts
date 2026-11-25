/**
 * Care CRM S3, main side: the identity block of `GET /crm?include=identity`, the two identity routes' answers,
 * the IPC argument guard for staff actions and refreshes, and the mapping of every error reason (backend bae6259).
 * Everything is parsed against exact allowlists; anything else is rejected.
 */
import { describe, expect, it } from 'vitest';
import {
  careCrmIdentityFailure,
  careCrmIdentityRequestBody,
  copyCareCrmIdentity,
  parseCareCrmIdentity,
  parseCareCrmIdentityActionBody,
  parseCareCrmIdentityActionInput,
  parseCareCrmIdentityConflictBody,
  parseCareCrmIdentityRefreshBody,
  parseCareCrmIdentityRefreshInput,
  parseCareCrmRefreshTooSoonBody,
} from './care-crm-identity';
import { copyCareCrmRow, parseCareCrmListBody, parseCareCrmRow } from './care-crm';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE = '22222222-2222-4222-8222-222222222222';
const LEAD_ID = '44444444-4444-4444-8444-444444444444';
const LEAD_ID_2 = '55555555-5555-4555-8555-555555555555';
const OWNER_ID = '66666666-6666-4666-8666-666666666666';
const ISO = '2026-11-20T10:00:00.000Z';
const AT = '2026-11-25T01:00:00.000Z';
const VERSION = '2026-11-25T01:02:03.456Z';

type Json = Record<string, unknown>;

function field(value: unknown, extra: Json = {}): Json {
  return { value, confidence: 'high', kind: 'stated', source: 'ai', status: 'suggested', updatedAt: AT, evidence: [], ...extra };
}

function identity(overrides: Json = {}): Json {
  return {
    version: VERSION,
    lastRunAt: AT,
    consent: { state: 'granted', at: AT, noMarketing: false, canAsk: false },
    occasion: field('tet', { confidence: 'medium', kind: 'inferred' }),
    timeline: field('before_tet'),
    productFactIds: field(['ban-127']),
    addressForm: field('chi', { status: 'confirmed', source: 'staff' }),
    ageBand: field(['25-34', '35-44'], { confidence: 'medium', kind: 'inferred' }),
    family: field({ recipient: 'parents' }, { evidence: [{ source: 'customer', at: AT, quote: 'em mua cho bố mẹ ạ' }] }),
    interests: {
      adTitle: field('Bàn thờ gỗ gụ', { source: 'ad', kind: 'inferred' }),
      sharedLinks: [field({ title: 'Mẫu bàn thờ', domain: 'tiktok.com' }, { source: 'ai', kind: 'inferred' })],
      budgetBand: field('15m_30m'),
    },
    persona: { ...field('P2'), summary: 'Tết/giỗ · Tết · cần trước Tết' },
    ...overrides,
  };
}

const EMPTY_IDENTITY: Json = {
  version: null,
  lastRunAt: null,
  consent: { state: 'unknown', at: null, noMarketing: false, canAsk: true },
  occasion: null,
  timeline: null,
  productFactIds: null,
  addressForm: null,
  ageBand: null,
  family: null,
  interests: { adTitle: null, sharedLinks: [], budgetBand: null },
  persona: null,
};

const PROFILE = {
  stage: 'consulting', ownerUserId: OWNER_ID, addressForm: 'chi', occasion: 'new_home', neededBy: '2026-12-20',
  productFactIds: ['ban-127'], nextStep: 'Gọi lại', nextStepDueAt: '2026-11-25T02:00:00.000Z', lostReason: null,
  purchasedAt: null, note: null, updatedAt: '2026-11-21T09:30:00.000Z', updatedBy: OWNER_ID,
};

function row(leadId = LEAD_ID, extra: Json = {}): Json {
  return {
    leadId, pageId: '105252511858057', customerName: 'Nguyễn Thị Hoa', phone: '0901234567', zaloMentioned: false,
    leadStatus: 'contacted', phoneCapturedAt: ISO, lastMessageAt: ISO, recentMessages: [], profile: PROFILE, ...extra,
  };
}

function listBody(rows: Json[], extra: Json = {}): Json {
  return {
    success: true, workspaceId: WORKSPACE, role: 'owner', canDelete: true, rows, nextCursor: null,
    assignees: [{ userId: OWNER_ID, label: 'Lan' }], ...extra,
  };
}

/** A copy of `base` with `path` set to `value` (or removed when `value` is `REMOVE`). */
const REMOVE = Symbol('remove');
function withPath(base: Json, path: string[], value: unknown): Json {
  const copy = structuredClone(base);
  let target: Json = copy;
  for (const key of path.slice(0, -1)) target = target[key] as Json;
  const last = path[path.length - 1];
  if (value === REMOVE) delete target[last];
  else target[last] = value;
  return copy;
}

describe('parseCareCrmIdentity', () => {
  it('rebuilds a full identity from its exact contract fields', () => {
    const raw = identity();
    const parsed = parseCareCrmIdentity(raw);
    expect(parsed).toEqual(raw);
    expect(parsed).not.toBe(raw);
    expect(parsed?.interests).not.toBe(raw.interests);
  });

  it('accepts an identity that was never written (no version, unknown consent, empty fields)', () => {
    expect(parseCareCrmIdentity(EMPTY_IDENTITY)).toEqual(EMPTY_IDENTITY);
  });

  it.each([
    ['the identity', []],
    ['the consent', ['consent']],
    ['the interests', ['interests']],
    ['a field', ['occasion']],
    ['an evidence item', ['family', 'evidence', '0']],
    ['the family value', ['family', 'value']],
    ['a shared link value', ['interests', 'sharedLinks', '0', 'value']],
    ['the persona', ['persona']],
  ])('rejects an unknown key in %s', (_label, path) => {
    const raw = identity();
    const target = path.reduce<Json>((node, key) => node[key] as Json, raw);
    target.extra = true;
    expect(parseCareCrmIdentity(raw)).toBeNull();
  });

  it('rejects a forbidden field the contract never has (gender, religion, health)', () => {
    for (const key of ['gender', 'religion', 'health']) {
      expect(parseCareCrmIdentity(identity({ [key]: field('x') }))).toBeNull();
    }
  });

  it.each([
    ['a missing key', ['consent', 'canAsk'], REMOVE],
    ['a persona without its summary', ['persona', 'summary'], REMOVE],
    ['an unknown consent state', ['consent', 'state'], 'maybe'],
    ['a consent flag that is not a boolean', ['consent', 'canAsk'], 'yes'],
    ['a version that is not a timestamp', ['version'], 'v1'],
    ['an unknown confidence', ['occasion', 'confidence'], 'certain'],
    ['an unknown status', ['occasion', 'status'], 'approved'],
    ['an unknown occasion', ['occasion', 'value'], 'birthday'],
    ['an unknown timeline', ['timeline', 'value'], 'tomorrow'],
    ['an unknown address form', ['addressForm', 'value'], 'ong'],
    ['an unknown persona', ['persona', 'value'], 'P5'],
    ['an unknown budget band', ['interests', 'budgetBand', 'value'], '1m'],
    ['an unknown recipient', ['family', 'value', 'recipient'], 'friend'],
    ['age bands that are not adjacent', ['ageBand', 'value'], ['18-24', '35-44']],
    ['age bands out of order', ['ageBand', 'value'], ['35-44', '25-34']],
    ['three age bands', ['ageBand', 'value'], ['18-24', '25-34', '35-44']],
    ['no age band', ['ageBand', 'value'], []],
    ['an empty product list', ['productFactIds', 'value'], []],
    ['seven products', ['productFactIds', 'value'], ['a', 'b', 'c', 'd', 'e', 'f', 'g']],
    ['a duplicate product', ['productFactIds', 'value'], ['a', 'a']],
    ['a product id with a space', ['productFactIds', 'value'], ['ban 127']],
    ['three pieces of evidence', ['occasion', 'evidence'], [1, 2, 3].map(() => ({ source: 'customer', at: AT, quote: null }))],
    ['an evidence source outside the contract', ['family', 'evidence', '0', 'source'], 'profile'],
    ['a quote over 80 characters', ['family', 'evidence', '0', 'quote'], 'a'.repeat(81)],
    ['a quote with a bidi control', ['family', 'evidence', '0', 'quote'], 'em mua \u202E cho bố mẹ'],
    ['a quote with surrounding spaces', ['family', 'evidence', '0', 'quote'], ' em mua '],
    ['an empty quote', ['family', 'evidence', '0', 'quote'], ''],
    ['a domain with a path', ['interests', 'sharedLinks', '0', 'value', 'domain'], 'tiktok.com/@shop'],
    ['an upper-case domain', ['interests', 'sharedLinks', '0', 'value', 'domain'], 'TikTok.com'],
    ['a link title over 120 characters', ['interests', 'sharedLinks', '0', 'value', 'title'], 'x'.repeat(121)],
    ['an ad title over 300 characters', ['interests', 'adTitle', 'value'], 'x'.repeat(301)],
    ['shared links that are not a list', ['interests', 'sharedLinks'], null],
  ])('rejects %s', (_label, path, value) => {
    expect(parseCareCrmIdentity(withPath(identity(), path, value))).toBeNull();
  });

  it('rejects a fourth shared link', () => {
    const links = [1, 2, 3, 4].map((index) => field({ title: null, domain: `site${index}.vn` }));
    expect(parseCareCrmIdentity(withPath(identity(), ['interests', 'sharedLinks'], links))).toBeNull();
  });

  it('counts a quote in characters, so 80 emoji fit', () => {
    expect(parseCareCrmIdentity(withPath(identity(), ['family', 'evidence', '0', 'quote'], '😀'.repeat(80)))).not.toBeNull();
  });

  it('copies an identity so it shares nothing with the parse result', () => {
    const parsed = parseCareCrmIdentity(identity())!;
    const copy = copyCareCrmIdentity(parsed);
    expect(copy).toEqual(parsed);
    expect(copy.ageBand?.value).not.toBe(parsed.ageBand?.value);
    expect(copy.family?.evidence[0]).not.toBe(parsed.family?.evidence[0]);
    expect(copy.interests?.sharedLinks[0].value).not.toBe(parsed.interests?.sharedLinks[0].value);
  });
});

describe('GET /crm with and without the identity block', () => {
  it('accepts an answer without identity (a server without S3): identity unavailable, rows unchanged', () => {
    const page = parseCareCrmListBody(listBody([row()]), WORKSPACE);
    expect(page?.identityEnabled).toBeNull();
    expect(page?.rows[0]).not.toHaveProperty('identity');
  });

  it('takes identityEnabled and every row identity when the server sent them', () => {
    const page = parseCareCrmListBody(listBody([row(LEAD_ID, { identity: identity() }), row(LEAD_ID_2, { identity: EMPTY_IDENTITY })], {
      identityEnabled: true,
    }), WORKSPACE);
    expect(page?.identityEnabled).toBe(true);
    expect(page?.rows[0].identity).toEqual(identity());
    expect(page?.rows[1].identity).toEqual(EMPTY_IDENTITY);
  });

  it('keeps the identities shown read-only when the AI profile is off for the workspace', () => {
    const page = parseCareCrmListBody(listBody([row(LEAD_ID, { identity: identity() })], { identityEnabled: false }), WORKSPACE);
    expect(page?.identityEnabled).toBe(false);
    expect(page?.rows[0].identity?.version).toBe(VERSION);
  });

  // One bad identity never takes the CRM down (review of a694110): the row stays, only its identity is dropped.
  it.each([
    ['an unknown key inside the identity', withPath(identity(), ['persona', 'gender'], 'x')],
    ['an unknown key inside a field', withPath(identity(), ['ageBand', 'extra'], 1)],
    ['a malformed identity', withPath(identity(), ['consent', 'state'], 'maybe')],
    ['an identity that is not an object', 'identity'],
    ['a null identity', null],
  ])('keeps the row and drops only its identity on %s', (_label, bad) => {
    const page = parseCareCrmListBody(listBody([row(LEAD_ID, { identity: identity() }), row(LEAD_ID_2, { identity: bad })], {
      identityEnabled: true,
    }), WORKSPACE);
    expect(page?.rows).toHaveLength(2);
    expect(page?.rows[0].identity).toEqual(identity());
    expect(page?.rows[0]).not.toHaveProperty('identityUnavailable');
    expect(page?.rows[1]).not.toHaveProperty('identity');
    expect(page?.rows[1].identityUnavailable).toBe(true);
    expect(page?.rows[1].profile.stage).toBe('consulting');
    expect(page?.identityEnabled).toBe(true);
    expect(page?.identityUnavailable).toBe(false);
  });

  it('marks a row the server sent without its identity as unavailable', () => {
    const page = parseCareCrmListBody(listBody([row()], { identityEnabled: true }), WORKSPACE);
    expect(page?.rows[0].identityUnavailable).toBe(true);
  });

  it('shows the table without identity when the identity part of the envelope is unreadable', () => {
    const page = parseCareCrmListBody(listBody([row(LEAD_ID, { identity: identity() })], { identityEnabled: 'yes' }), WORKSPACE);
    expect(page?.rows).toHaveLength(1);
    expect(page?.rows[0]).not.toHaveProperty('identity');
    expect(page?.identityEnabled).toBeNull();
    expect(page?.identityUnavailable).toBe(true);
    const stray = parseCareCrmListBody(listBody([row(LEAD_ID, { identity: identity() })]), WORKSPACE);
    expect(stray?.rows[0]).not.toHaveProperty('identity');
    expect(stray?.identityUnavailable).toBe(true);
  });

  it('still rejects any other unknown envelope or row key (the S1 contract)', () => {
    expect(parseCareCrmListBody(listBody([row()], { identityEnabled: true, extra: 1 }), WORKSPACE)).toBeNull();
    expect(parseCareCrmListBody(listBody([row(LEAD_ID, { identity: identity(), extra: 1 })], { identityEnabled: true }), WORKSPACE)).toBeNull();
    expect(parseCareCrmRow(row(LEAD_ID, { extra: 1 }))).toBeNull();
  });

  it('takes the exact consent question when the server sends it, and null otherwise', () => {
    const ask = { text: 'Dạ em là trợ lý tự động của Hồng Hưng ạ.\nDạ, để tư vấn đúng (chi tiết: https://izziapi.com/privacy).', copyVersion: 1 };
    expect(parseCareCrmListBody(listBody([], { identityEnabled: true, consentAsk: ask }), WORKSPACE)?.consentAsk).toEqual(ask);
    expect(parseCareCrmListBody(listBody([], { identityEnabled: true, consentAsk: null }), WORKSPACE)?.consentAsk).toBeNull();
    expect(parseCareCrmListBody(listBody([], { identityEnabled: true }), WORKSPACE)?.consentAsk).toBeNull();
    expect(parseCareCrmListBody(listBody([]), WORKSPACE)).toMatchObject({ consentAsk: null, identityUnavailable: false });
  });

  it.each([
    ['an unknown key', { text: 'x', copyVersion: 1, extra: 1 }],
    ['an empty text', { text: '', copyVersion: 1 }],
    ['a bidi control', { text: 'Dạ \u202E ạ', copyVersion: 1 }],
    ['a control character other than a line break', { text: 'Dạ\u0007 ạ', copyVersion: 1 }],
    ['over 2000 characters', { text: 'x'.repeat(2001), copyVersion: 1 }],
    ['a copy version that is not a positive whole number', { text: 'x', copyVersion: 0 }],
  ])('disables asking (consentAsk null) on a consent question with %s, keeping the page', (_label, consentAsk) => {
    const page = parseCareCrmListBody(listBody([row(LEAD_ID, { identity: identity() })], { identityEnabled: true, consentAsk }), WORKSPACE);
    expect(page?.consentAsk).toBeNull();
    expect(page?.rows[0].identity).toEqual(identity());
  });

  it('reads consent.eraseRequestedAt when present (backend round 3), strictly', () => {
    const asked = withPath(identity(), ['consent', 'eraseRequestedAt'], AT);
    expect(parseCareCrmIdentity(asked)?.consent?.eraseRequestedAt).toBe(AT);
    expect(parseCareCrmIdentity(withPath(identity(), ['consent', 'eraseRequestedAt'], null))?.consent?.eraseRequestedAt).toBeNull();
    expect(parseCareCrmIdentity(identity())?.consent).not.toHaveProperty('eraseRequestedAt');
    expect(parseCareCrmIdentity(withPath(identity(), ['consent', 'eraseRequestedAt'], 'yesterday'))).toBeNull();
    expect(copyCareCrmIdentity(parseCareCrmIdentity(asked)!).consent?.eraseRequestedAt).toBe(AT);
  });

  it('copies a row with its identity for IPC', () => {
    const page = parseCareCrmListBody(listBody([row(LEAD_ID, { identity: identity() })], { identityEnabled: true }), WORKSPACE)!;
    const copy = copyCareCrmRow(page.rows[0]);
    expect(copy).toEqual(page.rows[0]);
    expect(copy.identity).not.toBe(page.rows[0].identity);
  });
});

describe('parseCareCrmIdentityActionInput (IPC argument guard)', () => {
  const confirm = { leadId: LEAD_ID, action: 'confirm', field: 'occasion', expectedVersion: VERSION };

  it('accepts confirm and reject with a field and the version the card opened with', () => {
    expect(parseCareCrmIdentityActionInput(confirm)).toEqual(confirm);
    expect(parseCareCrmIdentityActionInput({ ...confirm, action: 'reject', expectedVersion: null })).toEqual({
      ...confirm, action: 'reject', expectedVersion: null,
    });
  });

  it.each([
    ['occasion', 'gift'],
    ['timeline', 'this_week'],
    ['productFactIds', ['ban-127', 'lu-huong']],
    ['addressForm', 'co'],
    ['ageBand', ['45-54']],
    ['ageBand', ['45-54', '55+']],
    ['family', { recipient: 'gift' }],
    ['persona', 'P3'],
    ['budgetBand', 'under_5m'],
  ])('accepts a correction of %s to a value of its type', (fieldName, value) => {
    const input = { leadId: LEAD_ID, action: 'correct', field: fieldName, expectedVersion: VERSION, value };
    const parsed = parseCareCrmIdentityActionInput(input);
    expect(parsed).toEqual(input);
    if (typeof value === 'object') expect(parsed?.value).not.toBe(value);
  });

  it('accepts a shared link by its index, with a corrected title and domain', () => {
    const input = {
      leadId: LEAD_ID, action: 'correct', field: 'sharedLink', expectedVersion: VERSION, index: 2,
      value: { title: null, domain: 'shopee.vn' },
    };
    expect(parseCareCrmIdentityActionInput(input)).toEqual(input);
    expect(parseCareCrmIdentityActionInput({ leadId: LEAD_ID, action: 'reject', field: 'sharedLink', expectedVersion: VERSION, index: 0 }))
      .not.toBeNull();
  });

  it('accepts ask_consent and withdraw_consent with the lead only', () => {
    expect(parseCareCrmIdentityActionInput({ leadId: LEAD_ID, action: 'ask_consent' })).toEqual({ leadId: LEAD_ID, action: 'ask_consent' });
    expect(parseCareCrmIdentityActionInput({ leadId: LEAD_ID, action: 'withdraw_consent' })).not.toBeNull();
  });

  it('accepts clear_erase_request (backend 79e14f9) with exactly the lead and the action', () => {
    expect(parseCareCrmIdentityActionInput({ leadId: LEAD_ID, action: 'clear_erase_request' }))
      .toEqual({ leadId: LEAD_ID, action: 'clear_erase_request' });
    for (const extra of [{ workspaceId: WORKSPACE }, { field: 'occasion' }, { expectedVersion: null }, { value: 1 }]) {
      expect(parseCareCrmIdentityActionInput({ leadId: LEAD_ID, action: 'clear_erase_request', ...extra })).toBeNull();
    }
    expect(parseCareCrmIdentityActionInput({ leadId: 'lead-1', action: 'clear_erase_request' })).toBeNull();
    expect(careCrmIdentityRequestBody(WORKSPACE, { leadId: LEAD_ID, action: 'clear_erase_request' }))
      .toEqual({ workspaceId: WORKSPACE, leadId: LEAD_ID, action: 'clear_erase_request' });
  });

  it.each([
    ['a workspace from the renderer', { ...confirm, workspaceId: WORKSPACE }],
    ['an unknown action', { ...confirm, action: 'approve' }],
    ['a lead that is not a uuid', { ...confirm, leadId: 'lead-1' }],
    ['a missing expectedVersion', { leadId: LEAD_ID, action: 'confirm', field: 'occasion' }],
    ['a value on a confirm', { ...confirm, value: 'tet' }],
    ['the ad title, which staff never act on', { ...confirm, field: 'adTitle' }],
    ['an unknown field', { ...confirm, field: 'gender' }],
    ['an index on a field that is not a link', { ...confirm, index: 0 }],
    ['a link without its index', { ...confirm, field: 'sharedLink' }],
    ['a link index of 3', { ...confirm, field: 'sharedLink', index: 3 }],
    ['a negative link index', { ...confirm, field: 'sharedLink', index: -1 }],
    ['a fractional link index', { ...confirm, field: 'sharedLink', index: 0.5 }],
    ['a version without a zone', { ...confirm, expectedVersion: '2026-11-25T01:02:03.456' }],
    ['a version with 7 fractional digits', { ...confirm, expectedVersion: '2026-11-25T01:02:03.4567890Z' }],
    ['a version without seconds', { ...confirm, expectedVersion: '2026-11-25T01:02Z' }],
    ['a consent action with a field', { leadId: LEAD_ID, action: 'ask_consent', field: 'occasion' }],
    ['a consent action with a version', { leadId: LEAD_ID, action: 'withdraw_consent', expectedVersion: null }],
    ['a correct without a value', { ...confirm, action: 'correct' }],
  ])('rejects %s', (_label, input) => {
    expect(parseCareCrmIdentityActionInput(input)).toBeNull();
  });

  it.each([
    ['occasion', 'birthday'],
    ['timeline', null],
    ['productFactIds', []],
    ['productFactIds', ['a', 'b', 'c', 'd', 'e', 'f', 'g']],
    ['productFactIds', ['a', 'a']],
    ['addressForm', 'ong'],
    ['ageBand', ['18-24', '35-44']],
    ['ageBand', '25-34'],
    ['family', { recipient: 'self', quote: 'cho em' }],
    ['family', 'self'],
    ['persona', 'P5'],
    ['budgetBand', 5_000_000],
    ['sharedLink', { title: 'x', domain: 'https://shopee.vn' }],
    ['sharedLink', { title: '\u202Ex', domain: 'shopee.vn' }],
    ['sharedLink', { domain: 'shopee.vn' }],
  ])('rejects a correction of %s to %j', (fieldName, value) => {
    const input: Json = { leadId: LEAD_ID, action: 'correct', field: fieldName, expectedVersion: VERSION, value };
    if (fieldName === 'sharedLink') input.index = 0;
    expect(parseCareCrmIdentityActionInput(input)).toBeNull();
  });

  it('rejects anything that is not a plain object', () => {
    for (const input of [null, [], 'confirm', Object.assign(Object.create({ leadId: LEAD_ID }), confirm)]) {
      expect(parseCareCrmIdentityActionInput(input)).toBeNull();
    }
  });
});

describe('parseCareCrmIdentityRefreshInput (IPC argument guard)', () => {
  it('accepts exactly { leadId }', () => {
    expect(parseCareCrmIdentityRefreshInput({ leadId: LEAD_ID })).toEqual({ leadId: LEAD_ID });
    expect(parseCareCrmIdentityRefreshInput({ leadId: LEAD_ID, workspaceId: WORKSPACE })).toBeNull();
    expect(parseCareCrmIdentityRefreshInput({ leadId: 'x' })).toBeNull();
    expect(parseCareCrmIdentityRefreshInput({})).toBeNull();
  });
});

describe('the identity request bodies', () => {
  it('adds the live workspace and keeps exactly the keys of the action', () => {
    expect(careCrmIdentityRequestBody(WORKSPACE, { leadId: LEAD_ID, action: 'ask_consent' }))
      .toEqual({ workspaceId: WORKSPACE, leadId: LEAD_ID, action: 'ask_consent' });
    expect(careCrmIdentityRequestBody(WORKSPACE, { leadId: LEAD_ID, action: 'confirm', field: 'persona', expectedVersion: null }))
      .toEqual({ workspaceId: WORKSPACE, leadId: LEAD_ID, action: 'confirm', expectedVersion: null, field: 'persona' });
    expect(careCrmIdentityRequestBody(WORKSPACE, {
      leadId: LEAD_ID, action: 'correct', field: 'sharedLink', expectedVersion: VERSION, index: 1, value: { title: null, domain: 'a.vn' },
    })).toEqual({
      workspaceId: WORKSPACE, leadId: LEAD_ID, action: 'correct', expectedVersion: VERSION, field: 'sharedLink',
      value: { title: null, domain: 'a.vn' }, index: 1,
    });
  });
});

describe('identity route answers', () => {
  it('reads a 200 action answer only for the requested workspace and lead', () => {
    const body = { success: true, workspaceId: WORKSPACE, leadId: LEAD_ID, identity: identity() };
    expect(parseCareCrmIdentityActionBody(body, WORKSPACE, LEAD_ID)).toEqual(identity());
    expect(parseCareCrmIdentityActionBody(body, OTHER_WORKSPACE, LEAD_ID)).toBeNull();
    expect(parseCareCrmIdentityActionBody(body, WORKSPACE, LEAD_ID_2)).toBeNull();
    expect(parseCareCrmIdentityActionBody({ ...body, extra: 1 }, WORKSPACE, LEAD_ID)).toBeNull();
    expect(parseCareCrmIdentityActionBody({ ...body, success: false }, WORKSPACE, LEAD_ID)).toBeNull();
  });

  it('reads the current identity from a 409 identity_conflict answer', () => {
    const body = { success: false, error: 'Customer identity changed', reason: 'identity_conflict', identity: identity() };
    expect(parseCareCrmIdentityConflictBody(body, WORKSPACE, LEAD_ID)).toEqual(identity());
    expect(parseCareCrmIdentityConflictBody({ ...body, workspaceId: WORKSPACE, leadId: LEAD_ID }, WORKSPACE, LEAD_ID)).not.toBeNull();
    expect(parseCareCrmIdentityConflictBody({ ...body, workspaceId: OTHER_WORKSPACE }, WORKSPACE, LEAD_ID)).toBeNull();
    expect(parseCareCrmIdentityConflictBody({ ...body, reason: 'profile_conflict' }, WORKSPACE, LEAD_ID)).toBeNull();
    expect(parseCareCrmIdentityConflictBody({ ...body, identity: { ...identity(), gender: null } }, WORKSPACE, LEAD_ID)).toBeNull();
  });

  it('reads a refresh answer with its outcome', () => {
    const body = { success: true, workspaceId: WORKSPACE, leadId: LEAD_ID, identity: identity(), outcome: 'updated' };
    expect(parseCareCrmIdentityRefreshBody(body, WORKSPACE, LEAD_ID)).toEqual({ identity: identity(), outcome: 'updated' });
    expect(parseCareCrmIdentityRefreshBody({ ...body, outcome: 'no_change' }, WORKSPACE, LEAD_ID)?.outcome).toBe('no_change');
    expect(parseCareCrmIdentityRefreshBody({ ...body, outcome: 'done' }, WORKSPACE, LEAD_ID)).toBeNull();
    expect(parseCareCrmIdentityRefreshBody({ ...body, leadId: LEAD_ID_2 }, WORKSPACE, LEAD_ID)).toBeNull();
  });

  it('reads retryAfterSec from a refresh_too_soon answer', () => {
    const body = { success: false, error: 'Too many requests', reason: 'refresh_too_soon', retryAfterSec: 420 };
    expect(parseCareCrmRefreshTooSoonBody(body)).toBe(420);
    expect(parseCareCrmRefreshTooSoonBody({ ...body, retryAfterSec: -1 })).toBeNull();
    expect(parseCareCrmRefreshTooSoonBody({ ...body, retryAfterSec: 1.5 })).toBeNull();
    expect(parseCareCrmRefreshTooSoonBody({ ...body, retryAfterSec: '420' })).toBeNull();
    expect(parseCareCrmRefreshTooSoonBody({ ...body, reason: 'daily_cap' })).toBeNull();
    expect(parseCareCrmRefreshTooSoonBody({ ...body, extra: 1 })).toBeNull();
  });
});

describe('careCrmIdentityFailure: every reason of the identity routes', () => {
  const envelope = (reason?: string) => (reason === undefined ? { success: false, error: 'x' } : { success: false, error: 'x', reason });
  it.each([
    [400, 'invalid_request', { ok: false, error: 'rejected', reason: 'invalid_request' }],
    [401, undefined, { ok: false, error: 'auth' }],
    [403, 'forbidden', { ok: false, error: 'forbidden' }],
    [404, undefined, { ok: false, error: 'unsupported' }],
    [409, 'identity_running', { ok: false, error: 'rejected', reason: 'identity_running' }],
    [422, 'lead_not_found', { ok: false, error: 'rejected', reason: 'lead_not_found' }],
    [422, 'consent_required', { ok: false, error: 'rejected', reason: 'consent_required' }],
    [422, 'outside_window', { ok: false, error: 'rejected', reason: 'outside_window' }],
    [422, 'ask_limit', { ok: false, error: 'rejected', reason: 'ask_limit' }],
    [422, 'page_not_connected', { ok: false, error: 'rejected', reason: 'page_not_connected' }],
    [422, 'permission_missing', { ok: false, error: 'rejected', reason: 'permission_missing' }],
    [422, 'something_else', { ok: false, error: 'rejected' }],
    [429, 'rate_limited', { ok: false, error: 'unavailable', reason: 'rate_limited' }],
    [429, undefined, { ok: false, error: 'unavailable', reason: 'rate_limited' }],
    [429, 'daily_cap', { ok: false, error: 'rejected', reason: 'daily_cap' }],
    [502, 'ai_unavailable', { ok: false, error: 'unavailable', reason: 'ai_unavailable' }],
    [502, 'provider_timeout', { ok: false, error: 'unavailable', reason: 'provider_timeout' }],
    [502, 'provider_unavailable', { ok: false, error: 'unavailable', reason: 'provider_unavailable' }],
    [502, 'provider_rejected', { ok: false, error: 'rejected', reason: 'provider_rejected' }],
    [503, 'not_configured', { ok: false, error: 'not_configured' }],
    [503, 'profile_ai_off', { ok: false, error: 'rejected', reason: 'profile_ai_off' }],
    [500, undefined, { ok: false, error: 'unavailable' }],
  ])('maps %i %s', (status, reason, expected) => {
    expect(careCrmIdentityFailure(status, envelope(reason))).toEqual(expected);
  });

  it('never reads the server text, and survives a body that is not an object', () => {
    expect(careCrmIdentityFailure(422, { success: false, error: 'consent_required' })).toEqual({ ok: false, error: 'rejected' });
    expect(careCrmIdentityFailure(502, null)).toEqual({ ok: false, error: 'unavailable' });
  });
});
