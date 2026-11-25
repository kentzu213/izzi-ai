/**
 * Care CRM S2, main side: strict parsing of renderer input (the IPC argument guard) and of the two CRM
 * route answers. Every rule of the contract rejects bad input; answers are rebuilt from exact allowlists.
 */
import { describe, expect, it } from 'vitest';
import type { CustomerCareCrmProfileInput } from '../../shared/customer-care-types';
import {
  CARE_CRM_MAX_PAGE_SIZE,
  CARE_CRM_MAX_PRODUCTS,
  canUseCareCrm,
  copyCareCrmRow,
  parseCareCrmBulkAssignBody,
  parseCareCrmBulkAssignInput,
  parseCareCrmConflictBody,
  parseCareCrmListBody,
  parseCareCrmListInput,
  parseCareCrmProfileInput,
  parseCareCrmRow,
  parseCareCrmSaveBody,
  parseCareCrmSaveInput,
  parseCareCrmTeamConflictBody,
  parseCareCrmTeamSaveBody,
  parseCareCrmTeamSaveInput,
} from './care-crm';

const NOW = new Date('2026-11-24T08:00:00.000Z');
const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE = '22222222-2222-4222-8222-222222222222';
const LEAD_ID = '44444444-4444-4444-8444-444444444444';
const LEAD_ID_2 = '55555555-5555-4555-8555-555555555555';
const OWNER_ID = '66666666-6666-4666-8666-666666666666';
const ISO = '2026-11-20T10:00:00.000Z';

const PROFILE: CustomerCareCrmProfileInput = {
  stage: 'consulting',
  ownerUserId: OWNER_ID,
  addressForm: 'chi',
  occasion: 'new_home',
  neededBy: '2026-12-20',
  productFactIds: ['ban-tho-127', 'fact.2:a'],
  nextStep: 'Gọi lại báo giá',
  nextStepDueAt: '2026-11-25T02:00:00.000Z',
  lostReason: null,
  purchasedAt: null,
  note: 'Nhà mới ở Thủ Đức.\nThích gỗ gụ.',
};

const EMPTY_PROFILE: CustomerCareCrmProfileInput = {
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
};

const ROW = {
  leadId: LEAD_ID,
  pageId: '105252511858057',
  customerName: 'Nguyễn Thị Hoa',
  phone: '0901234567',
  zaloMentioned: true,
  leadStatus: 'contacted',
  phoneCapturedAt: ISO,
  lastMessageAt: ISO,
  recentMessages: [{ text: 'Số em 0901234567', at: ISO }],
  profile: { ...PROFILE, salerId: null, careStep: null, callTries: 0, updatedAt: '2026-11-21T09:30:00.123456+00:00', updatedBy: OWNER_ID },
};

const LIST_BODY = {
  success: true,
  workspaceId: WORKSPACE,
  role: 'editor',
  canDelete: false,
  rows: [ROW],
  nextCursor: 'crm_2026-11-20T10:00:00Z',
  assignees: [{ userId: OWNER_ID, label: 'Lan' }],
};

const withProfile = (changes: Record<string, unknown>) => ({ ...PROFILE, ...changes });
const save = (profile: unknown, extra: Record<string, unknown> = {}) => ({
  leadId: LEAD_ID, expectedUpdatedAt: null, profile, ...extra,
});

describe('CRM roles', () => {
  it('lets owner, manager and editor use the CRM, never a viewer or reviewer', () => {
    expect(['owner', 'manager', 'editor'].every((role) => canUseCareCrm(role as never))).toBe(true);
    expect(canUseCareCrm('viewer')).toBe(false);
    expect(canUseCareCrm('reviewer')).toBe(false);
  });
});

describe('parseCareCrmListInput (IPC argument guard)', () => {
  it('accepts exactly { cursor } with null or an opaque cursor', () => {
    expect(parseCareCrmListInput({ cursor: null })).toEqual({ cursor: null });
    expect(parseCareCrmListInput({ cursor: 'crm_2026-11-20T10:00:00Z' })).toEqual({ cursor: 'crm_2026-11-20T10:00:00Z' });
  });

  it.each([
    undefined, null, 'x', [], {}, { cursor: '' }, { cursor: 'has space' }, { cursor: 'x'.repeat(513) },
    { cursor: null, workspaceId: WORKSPACE }, { cursor: 7 }, Object.create({ cursor: null }),
  ])('rejects %j', (input) => {
    expect(parseCareCrmListInput(input)).toBeNull();
  });
});

describe('parseCareCrmSaveInput (IPC argument guard)', () => {
  it('accepts a full profile and trims text fields', () => {
    const parsed = parseCareCrmSaveInput(save(withProfile({ nextStep: '  Gọi lại  ', note: '  Ghi chú\nhai dòng ' }), {
      expectedUpdatedAt: '2026-11-21T09:30:00.123456+00:00',
    }), NOW);
    expect(parsed).toEqual({
      leadId: LEAD_ID,
      expectedUpdatedAt: '2026-11-21T09:30:00.123456+00:00',
      profile: { ...PROFILE, nextStep: 'Gọi lại', note: 'Ghi chú\nhai dòng' },
    });
  });

  it('accepts the default empty profile for a first save', () => {
    expect(parseCareCrmSaveInput(save(EMPTY_PROFILE), NOW)?.profile).toEqual(EMPTY_PROFILE);
  });

  it('hands out a profile that shares nothing with the input', () => {
    const input = save(withProfile({}));
    const parsed = parseCareCrmSaveInput(input, NOW)!;
    expect(parsed.profile).not.toBe(input.profile);
    expect(parsed.profile.productFactIds).not.toBe(PROFILE.productFactIds);
  });

  it('rejects unknown keys at both levels and missing keys', () => {
    expect(parseCareCrmSaveInput({ ...save(PROFILE), workspaceId: WORKSPACE }, NOW)).toBeNull();
    expect(parseCareCrmSaveInput(save({ ...PROFILE, age: 40 }), NOW)).toBeNull();
    const { note: _note, ...withoutNote } = PROFILE;
    expect(parseCareCrmSaveInput(save(withoutNote), NOW)).toBeNull();
    expect(parseCareCrmSaveInput({ leadId: LEAD_ID, profile: PROFILE }, NOW)).toBeNull();
  });

  it.each([
    ['a lead id that is not a uuid', save(PROFILE, { leadId: 'lead-1' })],
    ['an expectedUpdatedAt that is not ISO', save(PROFILE, { expectedUpdatedAt: '21/11/2026' })],
    ['an unknown stage', save(withProfile({ stage: 'won' }))],
    ['an owner that is not a uuid', save(withProfile({ ownerUserId: 'lan@example.com' }))],
    ['an unknown address form', save(withProfile({ addressForm: 'ong' }))],
    ['an unknown occasion', save(withProfile({ occasion: 'wedding' }))],
    ['a neededBy that is not a calendar date', save(withProfile({ neededBy: '2026-02-30' }))],
    ['a neededBy with a time', save(withProfile({ neededBy: '2026-12-20T00:00:00Z' }))],
    ['a neededBy more than two years ahead', save(withProfile({ neededBy: '2028-12-01' }))],
    ['a neededBy more than two years back', save(withProfile({ neededBy: '2024-11-01' }))],
    ['more than 8 products', save(withProfile({ productFactIds: Array.from({ length: CARE_CRM_MAX_PRODUCTS + 1 }, (_, i) => `p${i}`) }))],
    ['a product id with a space', save(withProfile({ productFactIds: ['ban tho'] }))],
    ['a product id over 64 characters', save(withProfile({ productFactIds: ['p'.repeat(65)] }))],
    ['an empty product id', save(withProfile({ productFactIds: [''] }))],
    ['a duplicated product id', save(withProfile({ productFactIds: ['p1', 'p1'] }))],
    ['products that are not an array', save(withProfile({ productFactIds: 'p1' }))],
    ['an empty next step', save(withProfile({ nextStep: '   ' }))],
    ['a next step over 200 characters', save(withProfile({ nextStep: 'a'.repeat(201) }))],
    ['a next step with a newline', save(withProfile({ nextStep: 'Gọi\nlại' }))],
    ['a next step with a bidi override', save(withProfile({ nextStep: 'Gọi \u202E lại' }))],
    ['a nextStepDueAt that is not ISO', save(withProfile({ nextStepDueAt: '2026-11-25' }))],
    ['a nextStepDueAt more than two years ahead', save(withProfile({ nextStepDueAt: '2028-12-01T00:00:00.000Z' }))],
    ['a lost reason while not lost', save(withProfile({ lostReason: 'price' }))],
    ['an unknown lost reason', save(withProfile({ stage: 'lost', lostReason: 'rude' }))],
    ['a purchase date while consulting', save(withProfile({ purchasedAt: '2026-11-20' }))],
    ['a purchase date that is not a calendar date', save(withProfile({ stage: 'deposit', purchasedAt: '2026-13-01' }))],
    ['an empty note', save(withProfile({ note: '' }))],
    ['a note over 1000 characters', save(withProfile({ note: 'a'.repeat(1001) }))],
    ['a note with a tab', save(withProfile({ note: 'a\tb' }))],
    ['a note with a carriage return', save(withProfile({ note: 'a\r\nb' }))],
    ['a note that is not a string', save(withProfile({ note: 5 }))],
  ])('rejects %s', (_label, input) => {
    expect(parseCareCrmSaveInput(input, NOW)).toBeNull();
  });

  it('allows a lost reason only for lost, and a purchase date only for deposit or delivered', () => {
    expect(parseCareCrmProfileInput(withProfile({ stage: 'lost', lostReason: 'price' }), NOW)?.lostReason).toBe('price');
    expect(parseCareCrmProfileInput(withProfile({ stage: 'deposit', purchasedAt: '2026-11-20' }), NOW)?.purchasedAt)
      .toBe('2026-11-20');
    expect(parseCareCrmProfileInput(withProfile({ stage: 'delivered', purchasedAt: '2026-11-20' }), NOW)?.purchasedAt)
      .toBe('2026-11-20');
    expect(parseCareCrmProfileInput(withProfile({ stage: 'lost', purchasedAt: '2026-11-20' }), NOW)).toBeNull();
  });

  it('counts text in characters, so an emoji counts as one (server rule)', () => {
    const emoji = '😀';
    expect(parseCareCrmProfileInput(withProfile({ nextStep: emoji.repeat(200) }), NOW)?.nextStep).toBe(emoji.repeat(200));
    expect(parseCareCrmProfileInput(withProfile({ nextStep: emoji.repeat(201) }), NOW)).toBeNull();
    expect(parseCareCrmProfileInput(withProfile({ note: emoji.repeat(1000) }), NOW)?.note).toBe(emoji.repeat(1000));
    expect(parseCareCrmProfileInput(withProfile({ note: emoji.repeat(1001) }), NOW)).toBeNull();
  });

  it('rejects a lone surrogate the server would refuse', () => {
    expect(parseCareCrmProfileInput(withProfile({ note: 'a\uD83D b' }), NOW)).toBeNull();
    expect(parseCareCrmProfileInput(withProfile({ nextStep: 'a\uDE00' }), NOW)).toBeNull();
  });

  it('applies the server text rule: no format character except the zero-width joiner, no line or paragraph separator', () => {
    const family = '👨\u200D👩\u200D👧';
    expect(parseCareCrmProfileInput(withProfile({ nextStep: `Gọi ${family}`, note: family }), NOW)?.note).toBe(family);
    for (const bad of ['\uFEFF', '\u200B', '\u200E', '\u202E', '\u2066', '\u00AD', '\u2060', '\u2028', '\u2029']) {
      expect(parseCareCrmProfileInput(withProfile({ note: `a${bad}b` }), NOW), bad).toBeNull();
      expect(parseCareCrmProfileInput(withProfile({ nextStep: `a${bad}b` }), NOW), bad).toBeNull();
    }
  });

  it('checks the text before trimming, like the server', () => {
    expect(parseCareCrmProfileInput(withProfile({ note: '\uFEFFghi chú' }), NOW)).toBeNull();
    expect(parseCareCrmProfileInput(withProfile({ nextStep: 'gọi lại\t' }), NOW)).toBeNull();
    expect(parseCareCrmProfileInput(withProfile({ note: 'ghi chú\u2028' }), NOW)).toBeNull();
    expect(parseCareCrmProfileInput(withProfile({ note: '  ghi chú\n ' }), NOW)?.note).toBe('ghi chú');
  });

  it('never accepts the read-only profile fields in a save', () => {
    for (const extra of [{ updatedAt: null }, { updatedBy: null }, { detailsUnreadable: true }]) {
      expect(parseCareCrmSaveInput(save({ ...PROFILE, ...extra }), NOW)).toBeNull();
    }
  });

  it('requires a timezone and at most 6 fractional digits on timestamps, and passes them through unchanged', () => {
    expect(parseCareCrmSaveInput(save(PROFILE, { expectedUpdatedAt: '2026-11-21T09:30:00.123' }), NOW)).toBeNull();
    expect(parseCareCrmSaveInput(save(PROFILE, { expectedUpdatedAt: '2026-11-21T09:30:00.1234567Z' }), NOW)).toBeNull();
    expect(parseCareCrmProfileInput(withProfile({ nextStepDueAt: '2026-11-25T09:00:00' }), NOW)).toBeNull();
    const echoed = '2026-11-21T16:30:00.123+07:00';
    expect(parseCareCrmSaveInput(save(PROFILE, { expectedUpdatedAt: echoed }), NOW)?.expectedUpdatedAt).toBe(echoed);
    expect(parseCareCrmProfileInput(withProfile({ nextStepDueAt: '2026-11-25T09:00+07:00' }), NOW)?.nextStepDueAt)
      .toBe('2026-11-25T09:00+07:00');
  });

  it('accepts dates near the two-year edges', () => {
    expect(parseCareCrmProfileInput(withProfile({ neededBy: '2028-11-23' }), NOW)).not.toBeNull();
    expect(parseCareCrmProfileInput(withProfile({ neededBy: '2024-11-25' }), NOW)).not.toBeNull();
    expect(parseCareCrmProfileInput(withProfile({ neededBy: '2028-02-29' }), NOW)).not.toBeNull();
  });
});

describe('parseCareCrmRow and the list answer', () => {
  it('rebuilds a row from its exact contract fields', () => {
    expect(parseCareCrmRow(ROW)).toEqual(ROW);
  });

  it('accepts a lead that has no profile yet', () => {
    const row = { ...ROW, profile: { ...EMPTY_PROFILE, updatedAt: null, updatedBy: null } };
    expect(parseCareCrmRow(row)?.profile.updatedAt).toBeNull();
  });

  it('degrades a name that could disguise text to no name, and replaces control characters in messages', () => {
    const row = parseCareCrmRow({
      ...ROW,
      customerName: 'Hoa\u202E',
      recentMessages: [{ text: 'a\u0007b\nc', at: ISO }],
    });
    expect(row?.customerName).toBeNull();
    expect(row?.recentMessages[0].text).toBe('a�b\nc');
  });

  it.each([
    ['an extra field', { ...ROW, psid: '123' }],
    ['a phone that is not a normalized mobile', { ...ROW, phone: '+84901234567' }],
    ['an unknown lead status', { ...ROW, leadStatus: 'won' }],
    ['more than 3 messages', { ...ROW, recentMessages: Array.from({ length: 4 }, () => ({ text: 'a', at: ISO })) }],
    ['an unknown stage', { ...ROW, profile: { ...ROW.profile, stage: 'won' } }],
    ['an extra profile field', { ...ROW, profile: { ...ROW.profile, religion: 'x' } }],
    ['a note with a control character', { ...ROW, profile: { ...ROW.profile, note: 'a\u0000b' } }],
    ['a note over 1000 characters', { ...ROW, profile: { ...ROW.profile, note: 'a'.repeat(1001) } }],
    ['a neededBy that is not a date', { ...ROW, profile: { ...ROW.profile, neededBy: '2026-02-31' } }],
    ['an updatedBy that is not a uuid', { ...ROW, profile: { ...ROW.profile, updatedBy: 'lan' } }],
    ['too many products', { ...ROW, profile: { ...ROW.profile, productFactIds: Array.from({ length: 9 }, (_, i) => `p${i}`) } }],
  ])('rejects a row with %s', (_label, value) => {
    expect(parseCareCrmRow(value)).toBeNull();
  });

  it('parses the list envelope for the requested workspace', () => {
    expect(parseCareCrmListBody(LIST_BODY, WORKSPACE)).toEqual({
      role: 'editor',
      canDelete: false,
      rows: [ROW],
      nextCursor: LIST_BODY.nextCursor,
      assignees: [{ userId: OWNER_ID, label: 'Lan' }],
      // An answer without the S3 identity block (identity is covered in care-crm-identity.test.ts).
      identityEnabled: null,
      identityUnavailable: false,
      consentAsk: null,
    });
  });

  it('accepts a stored note of 1000 emoji and a row whose sealed details could not be opened', () => {
    const emojiNote = { ...ROW, profile: { ...ROW.profile, note: '😀'.repeat(1000) } };
    expect(parseCareCrmRow(emojiNote)?.profile.note).toHaveLength(2000);
    // Undecryptable details come back empty next to the plain columns; a lost row without a reason is fine.
    const unreadable = {
      ...ROW,
      profile: {
        ...ROW.profile, stage: 'lost', addressForm: null, occasion: null, productFactIds: [],
        nextStep: null, lostReason: null, note: null,
      },
    };
    expect(parseCareCrmRow(unreadable)?.profile).toMatchObject({ stage: 'lost', lostReason: null, note: null });
  });

  it('marks a profile whose sealed details could not be opened: the flag is present only as true', () => {
    const empty = { addressForm: null, occasion: null, productFactIds: [], nextStep: null, lostReason: null, note: null };
    const flagged = parseCareCrmRow({ ...ROW, profile: { ...ROW.profile, ...empty, detailsUnreadable: true } });
    expect(flagged?.profile.detailsUnreadable).toBe(true);
    expect(flagged?.profile.stage).toBe('consulting');
    expect(parseCareCrmRow(ROW)?.profile).not.toHaveProperty('detailsUnreadable');
    // The backend never sends false; anything but true breaks the contract.
    expect(parseCareCrmRow({ ...ROW, profile: { ...ROW.profile, detailsUnreadable: false } })).toBeNull();
    expect(parseCareCrmRow({ ...ROW, profile: { ...ROW.profile, detailsUnreadable: 'yes' } })).toBeNull();
  });

  it('never shows an assignee label that looks like an email, and keeps the server order', () => {
    const page = parseCareCrmListBody({
      ...LIST_BODY,
      assignees: [
        { userId: OWNER_ID, label: 'lan@example.com' },
        { userId: LEAD_ID_2, label: 'Thành viên 55555555' },
      ],
    }, WORKSPACE);
    expect(page?.assignees).toEqual([{ userId: OWNER_ID, label: null }, { userId: LEAD_ID_2, label: 'Thành viên 55555555' }]);
  });

  it('keeps an assignee whose label is unsafe or blank, without the label', () => {
    const page = parseCareCrmListBody({
      ...LIST_BODY,
      assignees: [{ userId: OWNER_ID, label: '  ' }, { userId: LEAD_ID_2, label: 'Lan\u202E' }],
    }, WORKSPACE);
    expect(page?.assignees).toEqual([{ userId: OWNER_ID, label: null }, { userId: LEAD_ID_2, label: null }]);
  });

  it.each([
    ['another workspace', { ...LIST_BODY, workspaceId: OTHER_WORKSPACE }],
    ['an unknown role', { ...LIST_BODY, role: 'viewer' }],
    ['a canDelete that is not boolean', { ...LIST_BODY, canDelete: 'yes' }],
    ['more than 100 rows', { ...LIST_BODY, rows: Array.from({ length: CARE_CRM_MAX_PAGE_SIZE + 1 }, () => ROW) }],
    ['a duplicated lead', { ...LIST_BODY, rows: [ROW, ROW] }],
    ['one invalid row', { ...LIST_BODY, rows: [ROW, { ...ROW, leadId: LEAD_ID_2, phone: '12345' }] }],
    ['a bad cursor', { ...LIST_BODY, nextCursor: 'has space' }],
    ['a duplicated assignee', { ...LIST_BODY, assignees: [{ userId: OWNER_ID, label: 'a' }, { userId: OWNER_ID, label: 'b' }] }],
    ['an assignee email field', { ...LIST_BODY, assignees: [{ userId: OWNER_ID, label: 'Lan', email: 'lan@example.com' }] }],
    ['an extra envelope field', { ...LIST_BODY, debug: true }],
    ['success false', { ...LIST_BODY, success: false }],
    ['duplicate pageId in pages', { ...LIST_BODY, pages: [{ pageId: '105252511858057', pageName: 'A' }, { pageId: '105252511858057', pageName: 'B' }] }],
    ['extra field in pages item', { ...LIST_BODY, pages: [{ pageId: '105252511858057', pageName: 'A', accessToken: 'secret' }] }],
  ])('rejects a list answer with %s', (_label, body) => {
    expect(parseCareCrmListBody(body, WORKSPACE)).toBeNull();
  });

  it('parses optional pages on both S1 and include=identity envelopes', () => {
    const pages = [
      { pageId: '105252511858057', pageName: 'Đồng Thờ Hồng Hưng' },
      { pageId: '206363622969168', pageName: 'Đồ đồng Đại Long\u202E' },
    ];
    const s1WithPages = parseCareCrmListBody({ ...LIST_BODY, pages }, WORKSPACE);
    expect(s1WithPages?.pages).toEqual([
      { pageId: '105252511858057', pageName: 'Đồng Thờ Hồng Hưng' },
      { pageId: '206363622969168', pageName: null },
    ]);
    const s3WithPages = parseCareCrmListBody({
      ...LIST_BODY,
      identityEnabled: false,
      consentAsk: null,
      pages: [{ pageId: '105252511858057', pageName: 'Xưởng tranh đồng Đại Long' }],
    }, WORKSPACE);
    expect(s3WithPages?.identityEnabled).toBe(false);
    expect(s3WithPages?.pages).toEqual([{ pageId: '105252511858057', pageName: 'Xưởng tranh đồng Đại Long' }]);
  });

  it('accepts a full 100-row page (limit=100) and rejects 101 unique rows', () => {
    const hundredRows = Array.from({ length: 100 }, (_, idx) => ({
      ...ROW,
      leadId: `44444444-4444-4444-8444-44444444${String(1000 + idx)}`,
      phone: `090123${String(1000 + idx)}`,
    }));
    const okPage = parseCareCrmListBody({ ...LIST_BODY, rows: hundredRows }, WORKSPACE);
    expect(okPage?.rows).toHaveLength(100);

    const tooManyRows = [
      ...hundredRows,
      { ...ROW, leadId: '44444444-4444-4444-8444-444444442999', phone: '0901239999' },
    ];
    expect(parseCareCrmListBody({ ...LIST_BODY, rows: tooManyRows }, WORKSPACE)).toBeNull();
  });
});

describe('save and conflict answers', () => {
  // What the backend sends after a commit when it cannot present the lead (presentRow → partialRow).
  const PARTIAL_ROW = {
    ...ROW, phone: '', phoneCapturedAt: '', lastMessageAt: '', recentMessages: [], customerName: null,
  };

  it('takes the saved profile, only for the requested workspace and lead', () => {
    expect(parseCareCrmSaveBody({ success: true, workspaceId: WORKSPACE, row: ROW }, WORKSPACE, LEAD_ID)).toEqual(ROW.profile);
    expect(parseCareCrmSaveBody({ success: true, workspaceId: OTHER_WORKSPACE, row: ROW }, WORKSPACE, LEAD_ID)).toBeNull();
    expect(parseCareCrmSaveBody({ success: true, workspaceId: WORKSPACE, row: ROW }, WORKSPACE, LEAD_ID_2)).toBeNull();
  });

  it('accepts a committed save whose row came back without its presentation fields', () => {
    expect(parseCareCrmSaveBody({ success: true, workspaceId: WORKSPACE, row: PARTIAL_ROW }, WORKSPACE, LEAD_ID))
      .toEqual(ROW.profile);
    const { phone: _p, recentMessages: _m, phoneCapturedAt: _c, ...missing } = ROW;
    expect(parseCareCrmSaveBody({ success: true, workspaceId: WORKSPACE, row: missing }, WORKSPACE, LEAD_ID))
      .toEqual(ROW.profile);
    // The profile itself stays strict, and the row may not carry fields outside the contract.
    expect(parseCareCrmSaveBody({ success: true, workspaceId: WORKSPACE, row: { ...PARTIAL_ROW, psid: '1' } }, WORKSPACE, LEAD_ID))
      .toBeNull();
    expect(parseCareCrmSaveBody(
      { success: true, workspaceId: WORKSPACE, row: { ...PARTIAL_ROW, profile: { ...ROW.profile, stage: 'won' } } },
      WORKSPACE, LEAD_ID,
    )).toBeNull();
  });

  it('reads the current profile from a profile_conflict answer, full or partial', () => {
    const body = { success: false, error: 'Customer profile changed', reason: 'profile_conflict', row: ROW };
    expect(parseCareCrmConflictBody(body, WORKSPACE, LEAD_ID)).toEqual(ROW.profile);
    expect(parseCareCrmConflictBody({ ...body, workspaceId: WORKSPACE }, WORKSPACE, LEAD_ID)).toEqual(ROW.profile);
    expect(parseCareCrmConflictBody({ ...body, row: PARTIAL_ROW }, WORKSPACE, LEAD_ID)).toEqual(ROW.profile);
  });

  it.each([
    ['another reason', { success: false, error: 'x', reason: 'invalid_request', row: ROW }],
    ['another lead', { success: false, error: 'x', reason: 'profile_conflict', row: { ...ROW, leadId: LEAD_ID_2 } }],
    ['another workspace', { success: false, reason: 'profile_conflict', row: ROW, workspaceId: OTHER_WORKSPACE }],
    ['no row', { success: false, error: 'x', reason: 'profile_conflict' }],
    ['an extra field', { success: false, reason: 'profile_conflict', row: ROW, stack: 'x' }],
  ])('ignores a conflict answer with %s', (_label, body) => {
    expect(parseCareCrmConflictBody(body, WORKSPACE, LEAD_ID)).toBeNull();
  });

  it('copies a row so the answer shares nothing with the parse result', () => {
    const row = parseCareCrmRow(ROW)!;
    const copy = copyCareCrmRow(row);
    expect(copy).toEqual(row);
    expect(copy.profile).not.toBe(row.profile);
    expect(copy.profile.productFactIds).not.toBe(row.profile.productFactIds);
    expect(copy.recentMessages[0]).not.toBe(row.recentMessages[0]);
  });

  it('accepts both 13-key legacy profiles (defaulting saler fields) and 16-key profiles', () => {
    const { salerId: _s, careStep: _c, callTries: _t, ...legacy13 } = ROW.profile;
    const parsedLegacy = parseCareCrmRow({ ...ROW, profile: legacy13 });
    expect(parsedLegacy?.profile).toEqual(ROW.profile);

    const withSaler16 = {
      ...ROW,
      profile: { ...ROW.profile, salerId: OWNER_ID, careStep: 'step2_called' as const, callTries: 2 },
    };
    expect(parseCareCrmRow(withSaler16)?.profile).toEqual(withSaler16.profile);
    expect(parseCareCrmRow({ ...ROW, profile: { ...ROW.profile, callTries: 10 } })).toBeNull();
    expect(parseCareCrmRow({ ...ROW, profile: { ...ROW.profile, careStep: 'step4_bad' } })).toBeNull();
  });
});

describe('Saler team & bulk-assign parsers', () => {
  const SALER_ID = '10000000-0000-4000-8000-000000000001';
  const SALERS = [
    {
      id: SALER_ID,
      name: 'Tuấn Thần Đèn',
      color: 'blue' as const,
      active: true,
      assignedPageIds: ['105252511858057'],
      memberUserId: OWNER_ID,
    },
  ];
  const ROUTING = { mode: 'by_page' as const, protectZaloAndWon: true };

  it('parses 14-key profile inputs including salerId, careStep and callTries', () => {
    const parsed = parseCareCrmProfileInput({
      ...PROFILE,
      salerId: SALER_ID,
      careStep: 'step3_zalo',
      callTries: 3,
    }, NOW);
    expect(parsed).toMatchObject({ salerId: SALER_ID, careStep: 'step3_zalo', callTries: 3 });
    expect(parseCareCrmProfileInput({ ...PROFILE, salerId: null, careStep: null, callTries: 10 }, NOW)).toBeNull();
    expect(parseCareCrmProfileInput({ ...PROFILE, salerId: 'bad space', careStep: null, callTries: 0 }, NOW)).toBeNull();
  });

  it('parses GET /crm envelope with salers, salerRouting and salerTeamRevision', () => {
    const page = parseCareCrmListBody({
      ...LIST_BODY,
      salers: SALERS,
      salerRouting: ROUTING,
      salerTeamRevision: 4,
    }, WORKSPACE);
    expect(page?.salers).toEqual(SALERS);
    expect(page?.salerRouting).toEqual(ROUTING);
    expect(page?.salerTeamRevision).toBe(4);
  });

  it('parses POST /crm/team input, 200 envelope and 409 team_conflict (syncing 40-char name, 50-page cap, lowercase salerId)', () => {
    const input = { expectedRevision: 2, salers: SALERS, routing: ROUTING };
    expect(parseCareCrmTeamSaveInput(input)).toEqual(input);
    expect(parseCareCrmTeamSaveInput({ ...input, expectedRevision: -1 })).toBeNull();
    expect(parseCareCrmTeamSaveInput({ ...input, workspaceId: WORKSPACE })).toBeNull();
    // Synced validation bounds with Backend: max 40 chars name, max 50 pages/saler, /^[a-z0-9_-]{2,36}$/ id
    expect(parseCareCrmTeamSaveInput({ ...input, salers: [{ ...SALERS[0]!, name: 'a'.repeat(40) }] })).not.toBeNull();
    expect(parseCareCrmTeamSaveInput({ ...input, salers: [{ ...SALERS[0]!, name: 'a'.repeat(41) }] })).toBeNull();
    expect(parseCareCrmTeamSaveInput({ ...input, salers: [{ ...SALERS[0]!, id: 'A' }] })).toBeNull();
    expect(parseCareCrmTeamSaveInput({ ...input, salers: [{ ...SALERS[0]!, id: 'UPPER_CASE' }] })).toBeNull();
    expect(parseCareCrmTeamSaveInput({
      ...input,
      salers: [{ ...SALERS[0]!, assignedPageIds: Array.from({ length: 50 }, (_, i) => String(100000 + i)) }],
    })).not.toBeNull();
    expect(parseCareCrmTeamSaveInput({
      ...input,
      salers: [{ ...SALERS[0]!, assignedPageIds: Array.from({ length: 51 }, (_, i) => String(100000 + i)) }],
    })).toBeNull();

    const body200 = { success: true, workspaceId: WORKSPACE, revision: 3, salers: SALERS, routing: ROUTING };
    expect(parseCareCrmTeamSaveBody(body200, WORKSPACE)).toEqual({ revision: 3, salers: SALERS, routing: ROUTING });
    expect(parseCareCrmTeamSaveBody({ ...body200, extra: 1 }, WORKSPACE)).toBeNull();

    expect(parseCareCrmTeamConflictBody({ success: false, error: 'Conflict', reason: 'team_conflict' }, WORKSPACE)).toEqual({});
    expect(parseCareCrmTeamConflictBody({
      success: false, reason: 'team_conflict', workspaceId: WORKSPACE, revision: 5, salers: SALERS, routing: ROUTING,
    }, WORKSPACE)).toEqual({ revision: 5, salers: SALERS, routing: ROUTING });
  });

  it('parses POST /crm/bulk-assign input and 200 envelope', () => {
    const input = {
      assignments: [{ leadId: LEAD_ID, expectedUpdatedAt: null, salerId: SALER_ID, ownerUserId: OWNER_ID }],
    };
    expect(parseCareCrmBulkAssignInput(input)).toEqual(input);
    expect(parseCareCrmBulkAssignInput({ assignments: [] })).toBeNull();

    const body200 = {
      success: true,
      workspaceId: WORKSPACE,
      assignedCount: 1,
      conflictCount: 0,
      skippedCount: 0,
      updated: [{
        leadId: LEAD_ID,
        salerId: SALER_ID,
        ownerUserId: OWNER_ID,
        careStep: 'step1_uncalled' as const,
        updatedAt: ISO,
        updatedBy: OWNER_ID,
      }],
    };
    expect(parseCareCrmBulkAssignBody(body200, WORKSPACE)).toEqual({
      assignedCount: 1,
      conflictCount: 0,
      skippedCount: 0,
      updated: body200.updated,
    });
  });
});
