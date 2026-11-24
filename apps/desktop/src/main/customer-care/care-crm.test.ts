/**
 * Care CRM S2, main side: strict parsing of renderer input (the IPC argument guard) and of the two CRM
 * route answers. Every rule of the contract rejects bad input; answers are rebuilt from exact allowlists.
 */
import { describe, expect, it } from 'vitest';
import type { CustomerCareCrmProfileInput } from '../../shared/customer-care-types';
import {
  CARE_CRM_MAX_PRODUCTS,
  canUseCareCrm,
  copyCareCrmRow,
  parseCareCrmConflictBody,
  parseCareCrmListBody,
  parseCareCrmListInput,
  parseCareCrmProfileInput,
  parseCareCrmRow,
  parseCareCrmSaveBody,
  parseCareCrmSaveInput,
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
  profile: { ...PROFILE, updatedAt: '2026-11-21T09:30:00.123456+00:00', updatedBy: OWNER_ID },
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
    ['a next step with a bidi override', save(withProfile({ nextStep: 'Gọi ‮ lại' }))],
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
      customerName: 'Hoa‮',
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
    });
  });

  it('keeps an assignee whose label is unsafe or blank, without the label', () => {
    const page = parseCareCrmListBody({
      ...LIST_BODY,
      assignees: [{ userId: OWNER_ID, label: '  ' }, { userId: LEAD_ID_2, label: 'Lan‮' }],
    }, WORKSPACE);
    expect(page?.assignees).toEqual([{ userId: OWNER_ID, label: null }, { userId: LEAD_ID_2, label: null }]);
  });

  it.each([
    ['another workspace', { ...LIST_BODY, workspaceId: OTHER_WORKSPACE }],
    ['an unknown role', { ...LIST_BODY, role: 'viewer' }],
    ['a canDelete that is not boolean', { ...LIST_BODY, canDelete: 'yes' }],
    ['more than 50 rows', { ...LIST_BODY, rows: Array.from({ length: 51 }, () => ROW) }],
    ['a duplicated lead', { ...LIST_BODY, rows: [ROW, ROW] }],
    ['one invalid row', { ...LIST_BODY, rows: [ROW, { ...ROW, leadId: LEAD_ID_2, phone: '12345' }] }],
    ['a bad cursor', { ...LIST_BODY, nextCursor: 'has space' }],
    ['a duplicated assignee', { ...LIST_BODY, assignees: [{ userId: OWNER_ID, label: 'a' }, { userId: OWNER_ID, label: 'b' }] }],
    ['an assignee email field', { ...LIST_BODY, assignees: [{ userId: OWNER_ID, label: 'Lan', email: 'lan@example.com' }] }],
    ['an extra envelope field', { ...LIST_BODY, debug: true }],
    ['success false', { ...LIST_BODY, success: false }],
  ])('rejects a list answer with %s', (_label, body) => {
    expect(parseCareCrmListBody(body, WORKSPACE)).toBeNull();
  });
});

describe('save and conflict answers', () => {
  it('accepts the saved row only for the requested workspace and lead', () => {
    expect(parseCareCrmSaveBody({ success: true, workspaceId: WORKSPACE, row: ROW }, WORKSPACE, LEAD_ID)).toEqual(ROW);
    expect(parseCareCrmSaveBody({ success: true, workspaceId: OTHER_WORKSPACE, row: ROW }, WORKSPACE, LEAD_ID)).toBeNull();
    expect(parseCareCrmSaveBody({ success: true, workspaceId: WORKSPACE, row: ROW }, WORKSPACE, LEAD_ID_2)).toBeNull();
  });

  it('reads the current row from a profile_conflict answer', () => {
    const body = { success: false, error: 'Conflict', reason: 'profile_conflict', row: ROW };
    expect(parseCareCrmConflictBody(body, WORKSPACE, LEAD_ID)).toEqual(ROW);
    expect(parseCareCrmConflictBody({ ...body, workspaceId: WORKSPACE }, WORKSPACE, LEAD_ID)).toEqual(ROW);
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
});
