import { describe, expect, it } from 'vitest';
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
  CRM_REFRESH_MS,
  crmChangedFields,
  crmReloadAfterSave,
  crmRowReadOnly,
  crmRowsOnFirstPage,
  crmShouldLoadOnShow,
  crmShouldSkipNextTick,
  crmDue,
  crmEditAfterSaved,
  crmEditOnChange,
  crmEditOnConflict,
  crmEditOnDiscard,
  crmEditOnReapply,
  crmFailureView,
  crmFieldVisibility,
  crmProductOptions,
  crmRowsOnRefresh,
  crmSaveDecision,
  crmVisibleRows,
  isCallToday,
  loadCrmPages,
  localInputToIso,
  isoToLocalInput,
  normalizeCrmProfile,
  profileFromRow,
  validateCrmProfile,
} from './customer-crm-flow';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '66666666-6666-4666-8666-666666666666';
// Local wall-clock times so "today" means the same thing in every time zone the tests run in.
const NOW = new Date(2026, 10, 24, 14, 0).getTime();
const at = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).toISOString();

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
    profile: { ...EMPTY, ...profile, updatedAt: '2026-11-21T09:30:00.000Z', updatedBy: OWNER_ID },
    ...extra,
  };
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

  it('never puts a do-not-contact customer on the call list or at the top', () => {
    const profile = { ...EMPTY, stage: 'do_not_contact' as const, nextStepDueAt: at(22, 9) };
    expect(isCallToday(profile, NOW)).toBe(false);
    expect(crmDue(profile, NOW)).toBe('none');
  });

  it('sorts overdue, then due today, then by stage, then newest phone', () => {
    const newestHasPhone = row({}, { phoneCapturedAt: at(23, 9) });
    const olderHasPhone = row({}, { phoneCapturedAt: at(20, 9) });
    const consulting = row({ stage: 'consulting' });
    const deposit = row({ stage: 'deposit' });
    const delivered = row({ stage: 'delivered' });
    const lost = row({ stage: 'lost' }, { phoneCapturedAt: at(23, 12) });
    const doNotContact = row({ stage: 'do_not_contact' }, { phoneCapturedAt: at(23, 13) });
    const dueToday = row({ stage: 'delivered', nextStepDueAt: at(24, 18) });
    const overdue = row({ stage: 'lost', nextStepDueAt: at(22, 9) });
    const rows = [lost, doNotContact, delivered, olderHasPhone, consulting, dueToday, deposit, overdue, newestHasPhone];
    expect(crmVisibleRows(rows, { view: 'all', stage: 'any' }, NOW).map((item) => item.leadId)).toEqual([
      overdue, dueToday, newestHasPhone, olderHasPhone, consulting, deposit, delivered, doNotContact, lost,
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

  it('round-trips the due time through the local date-time input', () => {
    const iso = at(25, 9, 30);
    expect(isoToLocalInput(iso)).toBe('2026-11-25T09:30');
    expect(localInputToIso('2026-11-25T09:30')).toBe(iso);
    expect(localInputToIso('')).toBeNull();
    expect(isoToLocalInput(null)).toBe('');
  });
});

describe('row edits: debounce input, conflict and re-apply', () => {
  it('saves only a changed, valid profile with the updatedAt it was edited against', () => {
    const base = row({ stage: 'consulting' });
    expect(crmSaveDecision(undefined, base, NOW)).toEqual({ kind: 'skip' });
    const unchanged = crmEditOnChange(undefined, profileFromRow(base));
    expect(crmSaveDecision(unchanged, base, NOW)).toEqual({ kind: 'skip' });
    const edit = crmEditOnChange(undefined, { ...profileFromRow(base), stage: 'deposit', note: ' Cọc 2 triệu ' });
    expect(crmSaveDecision(edit, base, NOW)).toEqual({
      kind: 'save',
      input: {
        leadId: base.leadId,
        expectedUpdatedAt: base.profile.updatedAt,
        profile: { ...profileFromRow(base), stage: 'deposit', note: 'Cọc 2 triệu' },
      },
    });
    const invalid = crmEditOnChange(undefined, { ...profileFromRow(base), neededBy: '2031-01-01' });
    expect(crmSaveDecision(invalid, base, NOW)).toMatchObject({ kind: 'invalid' });
  });

  it('sends null for the first save of a lead without a profile', () => {
    const fresh = row();
    const noProfile = { ...fresh, profile: { ...fresh.profile, updatedAt: null, updatedBy: null } };
    const edit = crmEditOnChange(undefined, { ...EMPTY, stage: 'consulting' });
    expect(crmSaveDecision(edit, noProfile, NOW)).toMatchObject({ kind: 'save', input: { expectedUpdatedAt: null } });
  });

  it('clears the edit after a save that matches the latest input, and keeps newer typing', () => {
    const base = row();
    const sent = { ...EMPTY, stage: 'consulting' as const };
    const saved = { ...base, profile: { ...sent, updatedAt: '2026-11-24T07:00:00.000Z', updatedBy: OWNER_ID } };
    expect(crmEditAfterSaved(crmEditOnChange(undefined, sent), saved)).toBeNull();
    const typedMore = crmEditOnChange(undefined, { ...sent, note: 'thêm' });
    expect(crmEditAfterSaved(typedMore, saved)).toEqual({ draft: typedMore.draft, rejected: null, error: '' });
  });

  it('on a conflict shows the server row and keeps the unsaved values for re-applying', () => {
    const mine = { ...EMPTY, stage: 'deposit' as const, note: 'Khách cọc rồi' };
    const server = row({ stage: 'lost', lostReason: 'price' });
    const conflict = crmEditOnConflict(crmEditOnChange(undefined, mine), server);
    expect(conflict).toEqual({ draft: profileFromRow(server), rejected: mine, error: CRM_CONFLICT_MESSAGE });
    expect(crmSaveDecision(conflict, server, NOW)).toEqual({ kind: 'skip' });

    const reapplied = crmEditOnReapply(conflict);
    expect(reapplied).toEqual({ draft: mine, rejected: null, error: '' });
    expect(crmSaveDecision(reapplied, server, NOW)).toMatchObject({
      kind: 'save', input: { expectedUpdatedAt: server.profile.updatedAt, profile: { stage: 'deposit', note: 'Khách cọc rồi' } },
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

describe('refresh merge', () => {
  it('keeps a newer local row, drops removed and vanished rows and follows the server order', () => {
    const a = row();
    const b = row();
    const c = row();
    const newerB = { ...b, profile: { ...b.profile, stage: 'deposit' as const, updatedAt: '2026-11-24T08:00:00.000Z' } };
    const merged = crmRowsOnRefresh([a, newerB, c], [c, b, a], new Set([a.leadId]));
    expect(merged).toEqual([c, newerB]);
    expect(crmRowsOnRefresh([a], [b], new Set())).toEqual([b]);
  });

  describe('periodic refresh: page 1 merged into the loaded rows by leadId', () => {
    const captured = (day: number) => ({ phoneCapturedAt: at(day, 9) });

    it('adds a new lead, updates a changed row and keeps rows older than page 1', () => {
      const older = row({}, captured(10));
      const kept = row({}, captured(20));
      const changed = { ...kept, profile: { ...kept.profile, stage: 'deposit' as const, updatedAt: '2026-11-24T07:00:00.000Z' } };
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
      const newer = { ...base, profile: { ...base.profile, stage: 'deposit' as const, updatedAt: '2026-11-24T08:00:00.000Z' } };
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

  it('reloads every page after a 409, checks page 1 after a 403, and nothing otherwise', () => {
    const server = row();
    expect(crmReloadAfterSave({ ok: false, error: 'profile_conflict', workspaceId: WORKSPACE, row: server })).toBe('full');
    expect(crmReloadAfterSave({ ok: false, error: 'forbidden' })).toBe('page1');
    expect(crmReloadAfterSave({ ok: true, workspaceId: WORKSPACE, row: server })).toBeNull();
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
    const edit = crmEditOnChange(undefined, { ...profileFromRow(unreadable), stage: 'deposit' });
    expect(crmSaveDecision(edit, unreadable, NOW)).toEqual({ kind: 'skip' });
    expect(profileFromRow(unreadable)).not.toHaveProperty('detailsUnreadable');
  });
});

describe('paging', () => {
  const ok = (rows: CustomerCareCrmRow[], nextCursor: string | null, workspaceId = WORKSPACE): CustomerCareCrmListResult => ({
    ok: true, workspaceId, role: 'editor', canDelete: false, rows, nextCursor, assignees: [],
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

  it('the periodic refresh reads page 1 only: incomplete but not cut off', async () => {
    let calls = 0;
    const result = await loadCrmPages(async () => { calls += 1; return ok([row()], `c${calls}`); }, 1);
    expect(calls).toBe(1);
    expect(result).toMatchObject({ ok: true, pages: 1, complete: false, truncated: false });
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
