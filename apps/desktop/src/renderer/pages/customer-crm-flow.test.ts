import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  CustomerCareCrmListResult,
  CustomerCareCrmProfileInput,
  CustomerCareCrmRow,
  CustomerCareCrmStage,
  CustomerCareFact,
} from '../../shared/customer-care-types';
import {
  CRM_CONFLICT_MESSAGE,
  CRM_FORBIDDEN_MESSAGE,
  CRM_MAX_PAGES,
  CRM_OWNER_NOT_ELIGIBLE_MESSAGE,
  CRM_REFRESH_COOLDOWN_MS,
  CRM_REFRESH_MS,
  CRM_SAVE_INVALID_MESSAGE,
  CrmLoadSequence,
  crmChangedFields,
  crmDateBounds,
  crmDue,
  crmEditAfterSaved,
  crmEditOnChange,
  crmEditOnConflict,
  crmEditOnDiscard,
  crmEditOnReapply,
  crmFailureView,
  crmFieldVisibility,
  crmProductOptions,
  crmRefreshCooldownLeft,
  crmReloadAfterSave,
  crmRowReadOnly,
  crmRowWithProfile,
  crmRowsOnFirstPage,
  crmRowsOnRefresh,
  crmSaveDecision,
  crmSaveFailureView,
  crmShouldLoadOnShow,
  crmShouldSkipNextTick,
  crmVisibleRows,
  formatCrmDue,
  isCallToday,
  isoToLocalInput,
  loadCrmPages,
  localInputToIso,
  normalizeCrmProfile,
  profileFromRow,
  validateCrmProfile,
} from './customer-crm-flow';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '66666666-6666-4666-8666-666666666666';
const T1 = '2026-11-21T09:30:00.000Z';
const T2 = '2026-11-24T06:00:00.000Z';
/** Wall-clock time in Vietnam (UTC+7, no daylight saving), whatever zone this PC is in. */
const at = (day: number, hour: number, minute = 0) => new Date(Date.UTC(2026, 10, day, hour - 7, minute)).toISOString();
const NOW = Date.parse(at(24, 14));

const EMPTY: CustomerCareCrmProfileInput = {
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

let seq = 0;
function row(profile: Partial<CustomerCareCrmProfileInput> = {}, extra: Partial<CustomerCareCrmRow> = {}): CustomerCareCrmRow {
  seq += 1;
  const id = `${String(seq).padStart(8, '0')}-4444-4444-8444-444444444444`;
  return {
    leadId: id,
    pageId: '105252511858057',
    customerName: `Khách ${seq}`,
    phone: '0901234567',
    zaloMentioned: false,
    leadStatus: 'new',
    phoneCapturedAt: at(20, 9),
    lastMessageAt: at(20, 9),
    recentMessages: [],
    profile: { ...EMPTY, ...profile, updatedAt: T1, updatedBy: OWNER_ID },
    ...extra,
  };
}

/** The same row after someone else saved it. */
function refreshed(base: CustomerCareCrmRow, changes: Partial<CustomerCareCrmProfileInput>, updatedAt = T2): CustomerCareCrmRow {
  return { ...base, profile: { ...base.profile, ...changes, updatedAt } };
}

describe('call list: due state, today view, filters and sort order', () => {
  it('classifies a next step as overdue, due today, later or none', () => {
    expect(crmDue({ ...EMPTY, nextStepDueAt: at(23, 9) }, NOW)).toBe('overdue');
    expect(crmDue({ ...EMPTY, nextStepDueAt: at(24, 9) }, NOW)).toBe('overdue');
    expect(crmDue({ ...EMPTY, nextStepDueAt: at(24, 18) }, NOW)).toBe('today');
    expect(crmDue({ ...EMPTY, nextStepDueAt: at(25, 8) }, NOW)).toBe('later');
    expect(crmDue(EMPTY, NOW)).toBe('none');
  });

  it('puts due-today, overdue and has_phone without a next step on today\'s call list', () => {
    expect(isCallToday({ ...EMPTY, stage: 'consulting', nextStepDueAt: at(24, 18) }, NOW)).toBe(true);
    expect(isCallToday({ ...EMPTY, stage: 'deposit', nextStepDueAt: at(22, 9) }, NOW)).toBe(true);
    expect(isCallToday(EMPTY, NOW)).toBe(true);
    expect(isCallToday({ ...EMPTY, nextStep: 'Gửi mẫu' }, NOW)).toBe(false);
    expect(isCallToday({ ...EMPTY, stage: 'consulting' }, NOW)).toBe(false);
    expect(isCallToday({ ...EMPTY, stage: 'consulting', nextStepDueAt: at(26, 9) }, NOW)).toBe(false);
  });

  it('keeps delivered follow-ups, but never lost or do-not-contact customers, even with an old due date', () => {
    expect(isCallToday({ ...EMPTY, stage: 'delivered', nextStepDueAt: at(22, 9) }, NOW)).toBe(true);
    for (const stage of ['lost', 'do_not_contact'] as const) {
      const profile = { ...EMPTY, stage, nextStepDueAt: at(22, 9) };
      expect(isCallToday(profile, NOW), stage).toBe(false);
      expect(crmDue(profile, NOW), stage).toBe('none');
    }
  });

  it('sorts overdue, then due today, then by stage, then newest phone', () => {
    const newestHasPhone = row({}, { phoneCapturedAt: at(23, 9) });
    const olderHasPhone = row({}, { phoneCapturedAt: at(20, 9) });
    const consulting = row({ stage: 'consulting' });
    const deposit = row({ stage: 'deposit' });
    const delivered = row({ stage: 'delivered' });
    const lost = row({ stage: 'lost' }, { phoneCapturedAt: at(23, 12) });
    const doNotContact = row({ stage: 'do_not_contact' }, { phoneCapturedAt: at(23, 13) });
    const lostWithOldDue = row({ stage: 'lost', nextStepDueAt: at(22, 9) }, { phoneCapturedAt: at(23, 14) });
    const dueToday = row({ stage: 'delivered', nextStepDueAt: at(24, 18) });
    const overdue = row({ stage: 'deposit', nextStepDueAt: at(22, 9) });
    const rows = [lost, doNotContact, delivered, olderHasPhone, lostWithOldDue, consulting, dueToday, deposit, overdue, newestHasPhone];
    expect(crmVisibleRows(rows, { view: 'all', stage: 'any' }, NOW).map((item) => item.leadId)).toEqual([
      overdue, dueToday, newestHasPhone, olderHasPhone, consulting, deposit, delivered, lostWithOldDue, doNotContact, lost,
    ].map((item) => item.leadId));
  });

  it('filters by view and stage, and keeps the row being edited on screen', () => {
    const today = row();
    const later = row({ stage: 'consulting', nextStepDueAt: at(28, 9) });
    const lost = row({ stage: 'lost' });
    expect(crmVisibleRows([today, later, lost], { view: 'today', stage: 'any' }, NOW)).toEqual([today]);
    expect(crmVisibleRows([today, later, lost], { view: 'all', stage: 'lost' }, NOW)).toEqual([lost]);
    expect(crmVisibleRows([today, later, lost], { view: 'today', stage: 'any' }, NOW, later.leadId)).toEqual([today, later]);
  });
});

describe('Vietnam time, whatever the PC zone', () => {
  const original = process.env.TZ;
  beforeAll(() => { process.env.TZ = 'America/New_York'; });
  afterAll(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  it('runs this block in a zone that is not UTC+7', () => {
    expect(new Date(Date.UTC(2026, 10, 24, 3, 0)).getHours()).toBe(22);
  });

  it('decides today and overdue on the Vietnamese calendar', () => {
    // 00:30 on 25/11 in Vietnam is still 24/11 in New York.
    const now = Date.parse(at(25, 0, 30));
    expect(crmDue({ ...EMPTY, nextStepDueAt: at(25, 9) }, now)).toBe('today');
    expect(crmDue({ ...EMPTY, nextStepDueAt: at(24, 23) }, now)).toBe('overdue');
    expect(crmDue({ ...EMPTY, nextStepDueAt: at(26, 1) }, now)).toBe('later');
  });

  it('fills and reads the date-time input in Vietnamese time', () => {
    const iso = at(25, 9, 30);
    expect(isoToLocalInput(iso)).toBe('2026-11-25T09:30');
    expect(localInputToIso('2026-11-25T09:30')).toBe(iso);
    expect(localInputToIso('')).toBeNull();
    expect(isoToLocalInput(null)).toBe('');
    expect(formatCrmDue(iso)).toBe('09:30 25/11');
  });

  it('bounds the date pickers from the Vietnamese date', () => {
    expect(crmDateBounds(Date.parse(at(25, 0, 30)))).toEqual({ min: '2024-11-26', max: '2028-11-24' });
  });
});

describe('field visibility by stage', () => {
  it.each([
    ['has_phone', false, false],
    ['consulting', false, false],
    ['deposit', false, true],
    ['delivered', false, true],
    ['lost', true, false],
    ['do_not_contact', false, false],
  ] as const)('%s shows lost reason %s and purchase date %s', (stage, lostReason, purchasedAt) => {
    expect(crmFieldVisibility(stage as CustomerCareCrmStage)).toEqual({ lostReason, purchasedAt });
  });

  it('drops hidden fields, trims text and removes duplicates before saving', () => {
    expect(normalizeCrmProfile({
      ...EMPTY,
      stage: 'consulting',
      lostReason: 'price',
      purchasedAt: '2026-11-20',
      productFactIds: ['a', 'b', 'a'],
      nextStep: '  Gọi\tlại  ',
      note: ' dòng 1\r\ndòng 2 ',
    })).toEqual({
      ...EMPTY,
      stage: 'consulting',
      lostReason: null,
      purchasedAt: null,
      productFactIds: ['a', 'b'],
      nextStep: 'Gọi lại',
      note: 'dòng 1\ndòng 2',
    });
    expect(normalizeCrmProfile({ ...EMPTY, nextStep: '   ', note: '' })).toEqual(EMPTY);
    expect(normalizeCrmProfile({ ...EMPTY, note: 'a\rb\r\nc' }).note).toBe('a\nb\nc');
    expect(normalizeCrmProfile({ ...EMPTY, note: ' \r\n ' }).note).toBeNull();
    expect(normalizeCrmProfile({ ...EMPTY, stage: 'lost', lostReason: 'price' }).lostReason).toBe('price');
    expect(normalizeCrmProfile({ ...EMPTY, stage: 'delivered', purchasedAt: '2026-11-20' }).purchasedAt).toBe('2026-11-20');
  });

  it('strips every format character the server refuses, keeps the zero-width joiner and turns separators into line breaks', () => {
    const family = '👨\u200D👩\u200D👧';
    const cleaned = normalizeCrmProfile({
      ...EMPTY,
      nextStep: '\uFEFFGọi\u200B lại\u202E\u2028mai',
      note: `dòng 1\u2028dòng 2\u2029dòng 3\u00AD ${family}\u2066`,
    });
    expect(cleaned.nextStep).toBe('Gọi lại mai');
    expect(cleaned.note).toBe(`dòng 1\ndòng 2\ndòng 3 ${family}`);
    expect(normalizeCrmProfile({ ...EMPTY, note: '\uFEFF\u200B' }).note).toBeNull();
  });

  it('checks dates and lengths locally so an invalid profile never costs a request', () => {
    expect(validateCrmProfile(EMPTY, NOW)).toBeNull();
    expect(validateCrmProfile({ ...EMPTY, neededBy: '2030-01-01' }, NOW)).toMatch(/2 năm/);
    expect(validateCrmProfile({ ...EMPTY, nextStepDueAt: '2020-01-01T00:00:00.000Z' }, NOW)).toMatch(/2 năm/);
    expect(validateCrmProfile({ ...EMPTY, note: 'a'.repeat(1001) }, NOW)).toMatch(/1000/);
    expect(validateCrmProfile({ ...EMPTY, nextStep: 'a'.repeat(201) }, NOW)).toMatch(/200/);
    expect(validateCrmProfile({ ...EMPTY, productFactIds: Array.from({ length: 9 }, (_, i) => `p${i}`) }, NOW)).toMatch(/8/);
  });

  it('counts an emoji as one character, like the server', () => {
    expect(validateCrmProfile({ ...EMPTY, nextStep: '😀'.repeat(200), note: '😀'.repeat(1000) }, NOW)).toBeNull();
    expect(validateCrmProfile({ ...EMPTY, nextStep: '😀'.repeat(201) }, NOW)).toMatch(/200/);
  });
});

describe('row edits: debounce input, conflict and re-apply', () => {
  it('saves only a changed, valid profile, against the updatedAt the edit started from', () => {
    const base = row({ stage: 'consulting' });
    expect(crmSaveDecision(undefined, base, NOW)).toEqual({ kind: 'skip' });
    const unchanged = crmEditOnChange(undefined, profileFromRow(base), base);
    expect(crmSaveDecision(unchanged, base, NOW)).toEqual({ kind: 'skip' });
    const edit = crmEditOnChange(undefined, { ...profileFromRow(base), stage: 'deposit', note: ' Cọc 2 triệu ' }, base);
    expect(edit.baseUpdatedAt).toBe(T1);
    expect(crmSaveDecision(edit, base, NOW)).toEqual({
      kind: 'save',
      input: {
        leadId: base.leadId,
        expectedUpdatedAt: T1,
        profile: { ...profileFromRow(base), stage: 'deposit', note: 'Cọc 2 triệu' },
      },
    });
    const invalid = crmEditOnChange(undefined, { ...profileFromRow(base), neededBy: '2031-01-01' }, base);
    expect(crmSaveDecision(invalid, base, NOW)).toMatchObject({ kind: 'invalid' });
  });

  it('keeps the starting updatedAt when a refresh brings a newer row, so the save gets a 409 instead of overwriting', () => {
    const base = row({ stage: 'consulting', note: 'của tôi' });
    const edit = crmEditOnChange(undefined, { ...profileFromRow(base), stage: 'deposit' }, base);
    // Someone else saved meanwhile; a page-1 or full refresh swapped the row in.
    const theirs = refreshed(base, { stage: 'lost', lostReason: 'price' });
    const typedMore = crmEditOnChange(edit, { ...edit.draft, note: 'thêm' }, theirs);
    expect(typedMore.baseUpdatedAt).toBe(T1);
    expect(crmSaveDecision(typedMore, theirs, NOW)).toMatchObject({ kind: 'save', input: { expectedUpdatedAt: T1 } });
  });

  it('sends the starting updatedAt for a draft stuck after a 429, a 503 or a 400 and then saved with "Lưu"', () => {
    const base = row({ stage: 'consulting' });
    const edit = crmEditOnChange(undefined, { ...profileFromRow(base), stage: 'deposit' }, base);
    for (const message of ['Đang có nhiều yêu cầu.', 'Máy chủ izzi chưa sẵn sàng cho CRM.', CRM_SAVE_INVALID_MESSAGE]) {
      const stuck = { ...edit, error: message };
      const theirs = refreshed(base, { stage: 'lost' });
      expect(crmSaveDecision(stuck, theirs, NOW)).toMatchObject({ kind: 'save', input: { expectedUpdatedAt: T1 } });
      // The row stays editable: the next change clears the message and keeps the base.
      expect(crmEditOnChange(stuck, { ...stuck.draft, note: 'sửa' }, theirs)).toMatchObject({ error: '', baseUpdatedAt: T1 });
    }
  });

  it('sends null for the first save of a lead without a profile', () => {
    const fresh = row();
    const noProfile = { ...fresh, profile: { ...fresh.profile, updatedAt: null, updatedBy: null } };
    const edit = crmEditOnChange(undefined, { ...EMPTY, stage: 'consulting' }, noProfile);
    expect(crmSaveDecision(edit, noProfile, NOW)).toMatchObject({ kind: 'save', input: { expectedUpdatedAt: null } });
  });

  it('never puts the read-only profile fields in a save', () => {
    const base = row({ stage: 'consulting' });
    const edit = crmEditOnChange(undefined, { ...profileFromRow(base), stage: 'deposit' }, base);
    const decision = crmSaveDecision(edit, base, NOW);
    if (decision.kind !== 'save') throw new Error('expected a save');
    expect(Object.keys(decision.input.profile).sort()).toEqual(Object.keys(EMPTY).sort());
  });

  it('clears the edit after a save that matches the latest input, and moves newer typing onto the saved version', () => {
    const base = row();
    const sent = { ...EMPTY, stage: 'consulting' as const };
    const saved = { ...base, profile: { ...sent, updatedAt: T2, updatedBy: OWNER_ID } };
    expect(crmEditAfterSaved(crmEditOnChange(undefined, sent, base), saved)).toBeNull();
    const typedMore = crmEditOnChange(undefined, { ...sent, note: 'thêm' }, base);
    expect(crmEditAfterSaved(typedMore, saved)).toEqual({ draft: typedMore.draft, rejected: null, error: '', baseUpdatedAt: T2 });
  });

  it('on a conflict shows the server row and keeps the unsaved values for re-applying', () => {
    const base = row({ stage: 'consulting' });
    const mine = { ...EMPTY, stage: 'deposit' as const, note: 'Khách cọc rồi' };
    const server = refreshed(base, { stage: 'lost', lostReason: 'price' });
    const conflict = crmEditOnConflict(crmEditOnChange(undefined, mine, base), server);
    expect(conflict).toEqual({ draft: profileFromRow(server), rejected: mine, error: CRM_CONFLICT_MESSAGE, baseUpdatedAt: T2 });
    expect(crmSaveDecision(conflict, server, NOW)).toEqual({ kind: 'skip' });

    const reapplied = crmEditOnReapply(conflict);
    expect(reapplied).toEqual({ draft: mine, rejected: null, error: '', baseUpdatedAt: T2 });
    expect(crmSaveDecision(reapplied, server, NOW)).toMatchObject({
      kind: 'save', input: { expectedUpdatedAt: T2, profile: { stage: 'deposit', note: 'Khách cọc rồi' } },
    });
    expect(crmEditOnDiscard(conflict, server)).toBeNull();
  });

  it('lists the unsaved values that differ from the server, in plain words', () => {
    const server = profileFromRow(row({ stage: 'consulting', note: 'cũ' }));
    const mine = { ...server, stage: 'deposit' as const, ownerUserId: OWNER_ID, note: 'mới' };
    expect(crmChangedFields(mine, server, [{ userId: OWNER_ID, label: 'Lan' }], [])).toEqual([
      { label: 'Giai đoạn', value: 'Đã cọc' },
      { label: 'Người phụ trách', value: 'Lan' },
      { label: 'Ghi chú', value: 'mới' },
    ]);
  });

  it('leaves out fields the user\'s own stage hides', () => {
    const server = profileFromRow(row({ stage: 'lost', lostReason: 'price' }));
    const mine = { ...server, stage: 'consulting' as const, lostReason: null };
    expect(crmChangedFields(mine, server, [], [])).toEqual([{ label: 'Giai đoạn', value: 'Đang tư vấn' }]);
  });
});

describe('save answers', () => {
  it('merges a saved profile into the known row and keeps its phone, messages and times', () => {
    const known = row({ stage: 'consulting' }, { recentMessages: [{ text: 'Cho em xin giá', at: at(20, 9) }] });
    const savedProfile = { ...known.profile, stage: 'deposit' as const, updatedAt: T2 };
    const merged = crmRowWithProfile(known, savedProfile);
    expect(merged).toEqual({ ...known, profile: savedProfile });
    expect(merged.profile).not.toBe(savedProfile);
  });

  it('reads 403 owner_not_eligible as a fixable field, reloading page 1 for the assignees', () => {
    const failure = { ok: false as const, error: 'rejected' as const, reason: 'owner_not_eligible' as const };
    expect(crmSaveFailureView(failure)).toEqual({ message: CRM_OWNER_NOT_ELIGIBLE_MESSAGE, dropRows: false });
    expect(CRM_OWNER_NOT_ELIGIBLE_MESSAGE).toBe('Người phụ trách này không còn trong dự án.');
    expect(crmReloadAfterSave(failure)).toBe('page1');
  });

  it('keeps a row editable after a 400 and says what to do', () => {
    for (const failure of [
      { ok: false as const, error: 'rejected' as const, reason: 'invalid_request' as const },
      { ok: false as const, error: 'invalid_input' as const },
    ]) {
      expect(crmSaveFailureView(failure)).toEqual({ message: CRM_SAVE_INVALID_MESSAGE, dropRows: false });
    }
  });

  it('drops the rows when the save shows this account lost access', () => {
    expect(crmSaveFailureView({ ok: false, error: 'forbidden' })).toEqual({ message: CRM_FORBIDDEN_MESSAGE, dropRows: true });
  });
});

describe('refresh merge', () => {
  it('keeps a newer local row, drops removed and vanished rows and follows the server order', () => {
    const a = row();
    const b = row();
    const c = row();
    const newerB = { ...b, profile: { ...b.profile, stage: 'deposit' as const, updatedAt: T2 } };
    const merged = crmRowsOnRefresh([a, newerB, c], [c, b, a], new Set([a.leadId]));
    expect(merged).toEqual([c, newerB]);
    expect(crmRowsOnRefresh([a], [b], new Set())).toEqual([b]);
  });

  describe('identity (Care CRM S3): merged by its own version, apart from the profile (review HIGH 1)', () => {
    const identity = (version: string | null, state: 'unknown' | 'granted' = 'granted') => ({
      version, lastRunAt: null, consent: { state, at: null, noMarketing: false, canAsk: false },
      occasion: null, timeline: null, productFactIds: null, addressForm: null, ageBand: null, family: null,
      interests: { adTitle: null, sharedLinks: [], budgetBand: null }, persona: null,
    });
    const V1 = '2026-11-25T01:02:03.456Z';
    const V2 = '2026-11-25T01:02:03.457Z';

    it('keeps a newer local identity over an older incoming one, to the millisecond', () => {
      const local = row({}, { identity: identity(V2) });
      const incoming = { ...local, identity: identity(V1) };
      expect(crmRowsOnRefresh([local], [incoming], new Set())[0].identity?.version).toBe(V2);
      expect(crmRowsOnRefresh([local], [{ ...local, identity: identity('2026-11-25T01:02:03.457+00:00') }], new Set())[0].identity?.version)
        .toBe('2026-11-25T01:02:03.457+00:00');
    });

    it('takes the incoming identity when it is as new or newer (a consent change keeps the version)', () => {
      const local = row({}, { identity: identity(V1, 'unknown') });
      expect(crmRowsOnRefresh([local], [{ ...local, identity: identity(V1, 'granted') }], new Set())[0].identity?.consent?.state).toBe('granted');
      expect(crmRowsOnRefresh([local], [{ ...local, identity: identity(V2) }], new Set())[0].identity?.version).toBe(V2);
      expect(crmRowsOnRefresh([row({}, { identity: identity(null) })], [{ ...local, identity: identity(V1) }], new Set())[0].identity?.version)
        .toBe(V1);
    });

    it('keeps a newer local identity even when the incoming profile wins, and the other way round', () => {
      const local = row({}, { identity: identity(V2) });
      const incoming = { ...local, profile: { ...local.profile, stage: 'deposit' as const, updatedAt: T2 }, identity: identity(V1) };
      const merged = crmRowsOnRefresh([local], [incoming], new Set())[0];
      expect(merged.profile.stage).toBe('deposit');
      expect(merged.identity?.version).toBe(V2);
      const newerProfile = { ...local, profile: { ...local.profile, updatedAt: T2 } };
      const keptProfile = crmRowsOnRefresh([newerProfile], [{ ...newerProfile, profile: { ...local.profile, updatedAt: T1 }, identity: identity(V2) }], new Set())[0];
      expect(keptProfile.profile.updatedAt).toBe(T2);
    });

    // Re-review of a394761: a wipe can delete the identity row (version null), and a refusal or an erase request must
    // show at once; reads that predate a staff action are dropped by the load sequence instead.
    it('takes an incoming identity with no version (wiped) over a newer local one, erase request included', () => {
      const local = row({}, { identity: identity(V2, 'granted') });
      const wiped = { ...identity(null, 'granted'), consent: { state: 'granted' as const, at: null, noMarketing: true, canAsk: false, eraseRequestedAt: V2 } };
      const merged = crmRowsOnRefresh([local], [{ ...local, identity: wiped }], new Set())[0];
      expect(merged.identity?.version).toBeNull();
      expect(merged.identity?.consent?.eraseRequestedAt).toBe(V2);
    });

    it('takes an incoming refusal or erase request even when its version is older', () => {
      const local = row({}, { identity: identity(V2, 'granted') });
      for (const state of ['declined', 'withdrawn'] as const) {
        const refused = { ...identity(V1), consent: { state, at: null, noMarketing: true, canAsk: false } };
        expect(crmRowsOnRefresh([local], [{ ...local, identity: refused }], new Set())[0].identity?.consent?.state, state).toBe(state);
      }
      const erasing = { ...identity(V1), consent: { state: 'granted' as const, at: null, noMarketing: true, canAsk: false, eraseRequestedAt: V1 } };
      expect(crmRowsOnRefresh([local], [{ ...local, identity: erasing }], new Set())[0].identity?.consent?.eraseRequestedAt).toBe(V1);
    });

    it('follows the server when it sends no identity this time (read without it)', () => {
      const local = row({}, { identity: identity(V2) });
      const plain = { ...local, identity: undefined };
      expect(crmRowsOnRefresh([local], [plain], new Set())[0].identity).toBeUndefined();
    });
  });

  describe('periodic refresh: page 1 merged into the loaded rows by leadId', () => {
    const captured = (day: number) => ({ phoneCapturedAt: at(day, 9) });

    it('adds a new lead, updates a changed row and keeps rows older than page 1', () => {
      const older = row({}, captured(10));
      const kept = row({}, captured(20));
      const changed = { ...kept, profile: { ...kept.profile, stage: 'deposit' as const, updatedAt: T2 } };
      const fresh = row({}, captured(23));
      expect(crmRowsOnFirstPage([kept, older], [fresh, changed], false, new Set())).toEqual([fresh, changed, older]);
    });

    it('drops a row inside page 1\'s window that page 1 no longer has, and skips rows deleted here', () => {
      const gone = row({}, captured(22));
      const onPage = row({}, captured(21));
      const older = row({}, captured(10));
      const deletedHere = row({}, captured(23));
      expect(crmRowsOnFirstPage([gone, onPage, older], [deletedHere, onPage], false, new Set([deletedHere.leadId])))
        .toEqual([onPage, older]);
    });

    it('treats a complete page 1 as the whole list', () => {
      const a = row({}, captured(21));
      const old = row({}, captured(5));
      expect(crmRowsOnFirstPage([a, old], [a], true, new Set())).toEqual([a]);
    });

    it('never undoes a save that finished after the refresh started', () => {
      const base = row({}, captured(21));
      const newer = { ...base, profile: { ...base.profile, stage: 'deposit' as const, updatedAt: T2 } };
      expect(crmRowsOnFirstPage([newer], [base], false, new Set())).toEqual([newer]);
    });
  });
});

describe('load budget (no ETag; every page is several DB queries)', () => {
  it('reloads every page when the tab opens, at most once per refresh period', () => {
    expect(crmShouldLoadOnShow(null, NOW)).toBe(true);
    expect(crmShouldLoadOnShow(NOW - 5_000, NOW)).toBe(false);
    expect(crmShouldLoadOnShow(NOW - CRM_REFRESH_MS, NOW)).toBe(true);
  });

  it('cools "Làm mới" down for 15 s after a full reload', () => {
    expect(CRM_REFRESH_COOLDOWN_MS).toBe(15_000);
    expect(crmRefreshCooldownLeft(null, NOW)).toBe(0);
    expect(crmRefreshCooldownLeft(NOW - 5_000, NOW)).toBe(10_000);
    expect(crmRefreshCooldownLeft(NOW - 15_000, NOW)).toBe(0);
  });

  it('reloads every page after a 409, page 1 after owner_not_eligible, and nothing otherwise', () => {
    const conflict = { ok: false as const, error: 'profile_conflict' as const, workspaceId: WORKSPACE, leadId: row().leadId, profile: row().profile };
    expect(crmReloadAfterSave(conflict)).toBe('full');
    expect(crmReloadAfterSave({ ok: false, error: 'forbidden' })).toBeNull();
    expect(crmReloadAfterSave({ ok: true, workspaceId: WORKSPACE, leadId: row().leadId, profile: row().profile })).toBeNull();
    expect(crmReloadAfterSave({ ok: false, error: 'unavailable', reason: 'rate_limited' })).toBeNull();
  });

  it('skips the next tick after a 429 or a 503, never after a refusal', () => {
    expect(crmShouldSkipNextTick({ ok: false, error: 'unavailable', reason: 'rate_limited' })).toBe(true);
    expect(crmShouldSkipNextTick({ ok: false, error: 'not_configured' })).toBe(true);
    expect(crmShouldSkipNextTick({ ok: false, error: 'unavailable' })).toBe(true);
    expect(crmShouldSkipNextTick({ ok: false, error: 'forbidden' })).toBe(false);
    expect(crmShouldSkipNextTick({ ok: false, error: 'rejected', reason: 'invalid_request' })).toBe(false);
  });

  it('says plainly that a 429 will be retried later', () => {
    expect(crmFailureView({ ok: false, error: 'unavailable', reason: 'rate_limited' })).toEqual({
      message: 'Đang có nhiều yêu cầu. CRM sẽ tự tải lại sau ít phút.', dropRows: false,
    });
  });
});

describe('a profile whose sealed details could not be opened', () => {
  it('is read-only: never saved, whatever was typed', () => {
    const base = row({ stage: 'consulting' });
    const unreadable = { ...base, profile: { ...base.profile, detailsUnreadable: true as const } };
    expect(crmRowReadOnly(unreadable)).toBe(true);
    expect(crmRowReadOnly(base)).toBe(false);
    const edit = crmEditOnChange(undefined, { ...profileFromRow(unreadable), stage: 'deposit' }, unreadable);
    expect(crmSaveDecision(edit, unreadable, NOW)).toEqual({ kind: 'skip' });
    expect(profileFromRow(unreadable)).not.toHaveProperty('detailsUnreadable');
  });
});

describe('paging', () => {
  const ok = (
    rows: CustomerCareCrmRow[],
    nextCursor: string | null,
    workspaceId = WORKSPACE,
    identityEnabled: boolean | null = null,
    extra: { identityUnavailable?: boolean; consentAsk?: { text: string; copyVersion: number } | null } = {},
  ): CustomerCareCrmListResult => ({
    ok: true, workspaceId, role: 'editor', canDelete: false, rows, nextCursor, assignees: [], identityEnabled,
    identityUnavailable: extra.identityUnavailable ?? false, consentAsk: extra.consentAsk ?? null,
  });

  it('takes identityEnabled and the consent question (Care CRM S3) from the first page', async () => {
    const ask = { text: 'Dạ em là trợ lý tự động của shop ạ.', copyVersion: 1 };
    const pages = [ok([row()], 'c1', WORKSPACE, true, { consentAsk: ask }), ok([row()], null, WORKSPACE, true)];
    expect(await loadCrmPages(async () => pages.shift()!)).toMatchObject({ ok: true, identityEnabled: true, consentAsk: ask });
    expect(await loadCrmPages(async () => ok([row()], null))).toMatchObject({ ok: true, identityEnabled: null, consentAsk: null });
  });

  it('asks main to try the identity again on the first page only when the user pressed "Làm mới"', async () => {
    const inputs: unknown[] = [];
    const pages = [ok([row()], 'c1'), ok([row()], null)];
    await loadCrmPages(async (input) => { inputs.push(input); return pages.shift()!; }, CRM_MAX_PAGES, { retryIdentity: true });
    expect(inputs).toEqual([{ cursor: null, retryIdentity: true }, { cursor: 'c1' }]);
    const plain: unknown[] = [];
    await loadCrmPages(async (input) => { plain.push(input); return ok([row()], null); });
    expect(plain).toEqual([{ cursor: null }]);
  });

  it('reports the identity unavailable when any page was read without it', async () => {
    const pages = [ok([row()], 'c1', WORKSPACE, true), ok([row()], null, WORKSPACE, null, { identityUnavailable: true })];
    expect(await loadCrmPages(async () => pages.shift()!)).toMatchObject({ ok: true, identityUnavailable: true });
    expect(await loadCrmPages(async () => ok([row()], null, WORKSPACE, true))).toMatchObject({ ok: true, identityUnavailable: false });
  });

  it('loads at most 10 pages and reports the list as cut off', async () => {
    const cursors: (string | null)[] = [];
    const result = await loadCrmPages(async ({ cursor }) => {
      cursors.push(cursor);
      return ok([row()], `c${cursors.length}`);
    });
    expect(cursors).toHaveLength(CRM_MAX_PAGES);
    expect(cursors[0]).toBeNull();
    expect(result).toMatchObject({ ok: true, truncated: true, pages: CRM_MAX_PAGES, complete: false });
    if (result.ok) expect(result.rows).toHaveLength(CRM_MAX_PAGES);
  });

  it('stops at the last page and removes a row repeated on the next page', async () => {
    const a = row();
    const b = row();
    const pages = [ok([a], 'c1'), ok([a, b], null)];
    const result = await loadCrmPages(async () => pages.shift()!);
    expect(result).toMatchObject({ ok: true, truncated: false, rows: [a, b], pages: 2, complete: true });
  });

  it('measures "cut off" against the page cap it was given', async () => {
    let calls = 0;
    const result = await loadCrmPages(async () => { calls += 1; return ok([row()], `c${calls}`); }, 1);
    expect(calls).toBe(1);
    expect(result).toMatchObject({ ok: true, pages: 1, complete: false, truncated: true });
  });

  it('fails when a page fails or answers for another workspace', async () => {
    const pages: CustomerCareCrmListResult[] = [ok([row()], 'c1'), { ok: false, error: 'unavailable' }];
    expect(await loadCrmPages(async () => pages.shift()!)).toEqual({ ok: false, error: 'unavailable' });
    const switched = [ok([row()], 'c1'), ok([row()], null, '22222222-2222-4222-8222-222222222222')];
    expect(await loadCrmPages(async () => switched.shift()!)).toEqual({ ok: false, error: 'access_changed' });
  });
});

describe('RBAC and failure states', () => {
  it('shows the no-access text for a viewer and drops every row', () => {
    expect(crmFailureView({ ok: false, error: 'forbidden' })).toEqual({ message: CRM_FORBIDDEN_MESSAGE, dropRows: true });
    expect(CRM_FORBIDDEN_MESSAGE).toBe('Bạn không có quyền xem CRM của dự án này.');
  });

  it('drops rows on sign-out or a switch, and keeps them through a passing failure', () => {
    expect(crmFailureView({ ok: false, error: 'auth' }).dropRows).toBe(true);
    expect(crmFailureView({ ok: false, error: 'access_changed' }).dropRows).toBe(true);
    expect(crmFailureView({ ok: false, error: 'unavailable' }).dropRows).toBe(false);
    expect(crmFailureView({ ok: false, error: 'unsupported' }).message).toMatch(/chưa bật CRM/);
    expect(crmFailureView({ ok: false, error: 'not_configured' }).message).toMatch(/chưa sẵn sàng/);
    expect(crmFailureView({ ok: false, error: 'rejected', reason: 'lead_not_found' }).message).toMatch(/không còn/);
  });
});

describe('product picker', () => {
  const fact = (id: string, topic: CustomerCareFact['topic'], text: string, extra: Partial<CustomerCareFact> = {}): CustomerCareFact => ({
    id, topic, text, source: 'Bảng giá', approvedAt: '2026-11-01T00:00:00.000Z', ...extra,
  });

  it('offers the shop\'s active product and price facts only', () => {
    const options = crmProductOptions([
      fact('ban-127', 'catalog', 'Bàn thờ gỗ gụ 1m27'),
      fact('gia-127', 'price', 'Bàn thờ 1m27 giá 15 triệu'),
      fact('doi-tra', 'policy', 'Đổi trả trong 7 ngày'),
      fact('cu', 'catalog', 'Mẫu cũ', { expiresAt: '2026-11-10T00:00:00.000Z' }),
      fact('moi', 'catalog', 'Mẫu sắp có', { approvedAt: '2026-12-01T00:00:00.000Z' }),
      fact('dai', 'catalog', 'x'.repeat(120)),
    ], NOW);
    expect(options.map((option) => option.id)).toEqual(['ban-127', 'gia-127', 'dai']);
    expect(options[2].label.length).toBeLessThanOrEqual(80);
    expect(crmProductOptions(undefined, NOW)).toEqual([]);
  });
});

describe('CrmLoadSequence: which list read is current (re-review of a394761, LOW 3)', () => {
  it('drops a read that a later read started after, and stops the spinner with the full reload it belongs to', () => {
    const sequence = new CrmLoadSequence();
    const full = sequence.start('full');
    const tick = sequence.start('page1');
    expect(sequence.isCurrent(full)).toBe(false);
    expect(sequence.isCurrent(tick)).toBe(true);
    expect(sequence.finish(tick)).toBe(false);
    expect(sequence.finish(full)).toBe(true);
  });

  it('an identity answer drops every read in flight; a full reload in flight is started again, not lost', () => {
    const sequence = new CrmLoadSequence();
    const full = sequence.start('full');
    expect(sequence.invalidate()).toBe(true);
    expect(sequence.isCurrent(full)).toBe(false);
    const again = sequence.start('full');
    // The dropped reload ends first: the spinner keeps going for the one started again.
    expect(sequence.finish(full)).toBe(false);
    expect(sequence.isCurrent(again)).toBe(true);
    expect(sequence.finish(again)).toBe(true);
  });

  it('an identity answer during a tick only drops the tick', () => {
    const sequence = new CrmLoadSequence();
    const tick = sequence.start('page1');
    expect(sequence.invalidate()).toBe(false);
    expect(sequence.isCurrent(tick)).toBe(false);
    expect(sequence.invalidate()).toBe(false);
  });
});
