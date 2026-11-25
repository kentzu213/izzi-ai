/**
 * Care CRM S3 identity card, pure rules: what the card offers (consent gating, the AI switch), the staff edit
 * values, the version an action is sent against (always the one on screen), the 409 flow, refresh answers and every
 * error reason in Vietnamese.
 */
import { describe, expect, it } from 'vitest';
import type {
  CustomerCareCrmIdField,
  CustomerCareCrmIdentity,
  CustomerCareCrmIdentityActionResult,
  CustomerCareCrmIdentityRefreshResult,
  CustomerCareFacebookFailure,
  CustomerCareFacebookRejectReason,
} from '../../shared/customer-care-types';
import {
  CRM_IDENTITY_CONFLICT_MESSAGE,
  CRM_IDENTITY_OFF_MESSAGE,
  crmConsentConfirmText,
  crmIdentityActionInput,
  crmIdentityActionView,
  crmIdentityCardBegin,
  crmIdentityCardSettle,
  crmIdentityCardStart,
  crmIdentityEditor,
  crmIdentityEditValue,
  crmIdentityLineTarget,
  crmIdentityPermissions,
  crmIdentityRefreshView,
  crmRetryMinutes,
  crmRowsWithIdentity,
  crmClearEraseConfirmText,
  crmWithdrawConfirmText,
} from './customer-crm-identity';
import { crmRowsOnRefresh } from './customer-crm-flow';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const LEAD_ID = '44444444-4444-4444-8444-444444444444';
const LEAD_ID_2 = '55555555-5555-4555-8555-555555555555';
const AT = '2026-11-25T01:00:00.000Z';
const V1 = '2026-11-25T01:00:00.000Z';
const V2 = '2026-11-25T02:00:00.000Z';

function field<T>(value: T, extra: Partial<CustomerCareCrmIdField<T>> = {}): CustomerCareCrmIdField<T> {
  return { value, confidence: 'high', kind: 'stated', source: 'ai', status: 'suggested', updatedAt: AT, evidence: [], ...extra };
}

function identity(state: CustomerCareCrmIdentity['consent'] extends infer C ? C extends { state: infer S } ? S : never : never = 'granted',
  extra: Partial<CustomerCareCrmIdentity> = {}): CustomerCareCrmIdentity {
  return {
    version: V1,
    lastRunAt: AT,
    consent: { state, at: AT, noMarketing: false, canAsk: state === 'unknown' || state === 'asked' },
    occasion: field<'tet'>('tet'),
    timeline: null,
    productFactIds: field(['ban-127', 'gone-fact']),
    addressForm: null,
    ageBand: field<Array<'25-34' | '35-44'>>(['25-34', '35-44'], { confidence: 'medium', kind: 'inferred' }),
    family: null,
    interests: { adTitle: null, sharedLinks: [field({ title: 'Mẫu đẹp', domain: 'shopee.vn' })], budgetBand: null },
    persona: null,
    ...extra,
  };
}

const ASK = 'Dạ em là trợ lý tự động của Hồng Hưng ạ.\nDạ, để tư vấn đúng (chi tiết: https://izziapi.com/privacy).';
const PRODUCTS = [{ id: 'ban-127', label: 'Bàn thờ gỗ gụ 1m27' }, { id: 'lu-huong', label: 'Lư hương đồng' }];
const fail = (error: CustomerCareFacebookFailure['error'], reason?: CustomerCareFacebookRejectReason): CustomerCareFacebookFailure =>
  (reason ? { ok: false, error, reason } : { ok: false, error });

describe('crmIdentityPermissions: what the card offers', () => {
  it('offers field actions, refresh and withdraw once the customer agreed; asking follows the server', () => {
    expect(crmIdentityPermissions(identity('granted'), true, true, ASK)).toEqual({
      fieldActions: true, canAsk: false, canWithdraw: true, canRefresh: true,
    });
  });

  it('before an answer: the order layer can be acted on and refreshed, "Xin phép khách" only when the server allows', () => {
    expect(crmIdentityPermissions(identity('unknown'), true, true, ASK)).toEqual({ fieldActions: true, canAsk: true, canWithdraw: false, canRefresh: true });
    const askedTwice = identity('asked');
    askedTwice.consent = { ...askedTwice.consent!, canAsk: false };
    expect(crmIdentityPermissions(askedTwice, true, true, ASK)).toEqual({ fieldActions: true, canAsk: false, canWithdraw: true, canRefresh: true });
  });

  it('offers nothing once the customer refused or withdrew, whatever the server flag says', () => {
    for (const state of ['declined', 'withdrawn'] as const) {
      const refused = identity(state);
      refused.consent = { ...refused.consent!, canAsk: true };
      expect(crmIdentityPermissions(refused, true, true, ASK)).toEqual({ fieldActions: false, canAsk: false, canWithdraw: false, canRefresh: false });
    }
  });

  it('hides every AI action while the AI profile is off, on a server without S3, or without the IPC handlers', () => {
    const none = { fieldActions: false, canAsk: false, canWithdraw: false, canRefresh: false };
    expect(crmIdentityPermissions(identity('unknown'), false, true, ASK)).toEqual(none);
    expect(crmIdentityPermissions(identity('unknown'), null, true, ASK)).toEqual(none);
    expect(crmIdentityPermissions(identity('unknown'), true, false, ASK)).toEqual(none);
    expect(crmIdentityPermissions(undefined, true, true, ASK)).toEqual(none);
  });

  it('offers "Xin phép khách" only with the server\'s consent question (review LOW 4)', () => {
    expect(crmIdentityPermissions(identity('unknown'), true, true, ASK).canAsk).toBe(true);
    expect(crmIdentityPermissions(identity('unknown'), true, true, null)).toEqual({
      fieldActions: true, canAsk: false, canWithdraw: false, canRefresh: true,
    });
  });

  it('hides "Xin phép khách" and "Cập nhật hồ sơ" while the customer\'s erase request is pending (backend 79e14f9)', () => {
    const pending = identity('unknown');
    pending.consent = { ...pending.consent!, canAsk: true, eraseRequestedAt: AT };
    expect(crmIdentityPermissions(pending, true, true, ASK)).toMatchObject({ canAsk: false, canRefresh: false });
    pending.consent = { ...pending.consent!, eraseRequestedAt: null };
    expect(crmIdentityPermissions(pending, true, true, ASK)).toMatchObject({ canAsk: true, canRefresh: true });
  });

  it('keeps "Khách rút đồng ý" with the AI profile off for a customer who agreed or was asked (backend 84c2523)', () => {
    const withdrawOnly = { fieldActions: false, canAsk: false, canWithdraw: true, canRefresh: false };
    expect(crmIdentityPermissions(identity('granted'), false, true, ASK)).toEqual(withdrawOnly);
    expect(crmIdentityPermissions(identity('asked'), false, true, ASK)).toEqual(withdrawOnly);
    expect(crmIdentityPermissions(identity('granted'), null, true, ASK).canWithdraw).toBe(false);
  });
});

describe('crmIdentityLineTarget', () => {
  it('names the field a line acts on; the source ad is never one', () => {
    expect(crmIdentityLineTarget('persona')).toEqual({ field: 'persona' });
    expect(crmIdentityLineTarget('ageBand')).toEqual({ field: 'ageBand' });
    expect(crmIdentityLineTarget('sharedLink:2')).toEqual({ field: 'sharedLink', index: 2 });
    for (const key of ['adTitle', 'sharedLink:3', 'sharedLink:x', 'gender', '']) expect(crmIdentityLineTarget(key)).toBeNull();
  });
});

describe('staff corrections (Sửa)', () => {
  it('offers one band or two adjacent bands for the age, labelled as ranges', () => {
    const editor = crmIdentityEditor('ageBand', identity(), undefined, PRODUCTS);
    expect(editor?.kind).toBe('select');
    if (editor?.kind !== 'select') throw new Error('select expected');
    expect(editor.current).toBe('25-34|35-44');
    expect(editor.options.map((option) => option.label)).toEqual([
      '18–24', '25–34', '35–44', '45–54', '55+', '18–34', '25–44', '35–54', '45+',
    ]);
    expect(crmIdentityEditValue('ageBand', '45-54|55+')).toEqual(['45-54', '55+']);
    expect(crmIdentityEditValue('ageBand', '18-24')).toEqual(['18-24']);
    expect(crmIdentityEditValue('ageBand', '18-24|35-44')).toBeNull();
  });

  it('builds typed values for the other fields and refuses anything outside the contract', () => {
    expect(crmIdentityEditValue('occasion', 'gift')).toBe('gift');
    expect(crmIdentityEditValue('occasion', 'birthday')).toBeNull();
    expect(crmIdentityEditValue('timeline', 'before_tet')).toBe('before_tet');
    expect(crmIdentityEditValue('addressForm', 'co')).toBe('co');
    expect(crmIdentityEditValue('family', 'parents')).toEqual({ recipient: 'parents' });
    expect(crmIdentityEditValue('family', 'friend')).toBeNull();
    expect(crmIdentityEditValue('persona', 'P4')).toBe('P4');
    expect(crmIdentityEditValue('budgetBand', '5m_15m')).toBe('5m_15m');
  });

  it('picks products from this machine (1 to 6), keeping ids that are not on it', () => {
    const editor = crmIdentityEditor('productFactIds', identity(), undefined, PRODUCTS);
    expect(editor).toEqual({ kind: 'products', options: PRODUCTS, current: ['ban-127', 'gone-fact'] });
    expect(crmIdentityEditValue('productFactIds', ['lu-huong', 'gone-fact'])).toEqual(['lu-huong', 'gone-fact']);
    expect(crmIdentityEditValue('productFactIds', [])).toBeNull();
    expect(crmIdentityEditValue('productFactIds', ['a', 'b', 'c', 'd', 'e', 'f', 'g'])).toBeNull();
    expect(crmIdentityEditor('productFactIds', identity(), undefined, [])).toBeNull();
  });

  it('corrects a shared link as a title and a domain, never an address', () => {
    expect(crmIdentityEditor('sharedLink', identity(), 0, PRODUCTS)).toEqual({ kind: 'link', title: 'Mẫu đẹp', domain: 'shopee.vn' });
    expect(crmIdentityEditValue('sharedLink', { title: '  Mẫu mới ', domain: ' Shopee.VN ' })).toEqual({ title: 'Mẫu mới', domain: 'shopee.vn' });
    expect(crmIdentityEditValue('sharedLink', { title: '', domain: 'tiki.vn' })).toEqual({ title: null, domain: 'tiki.vn' });
    for (const domain of ['https://shopee.vn', 'shopee.vn/abc', 'shopee', '']) {
      expect(crmIdentityEditValue('sharedLink', { title: 'x', domain })).toBeNull();
    }
    expect(crmIdentityEditValue('sharedLink', { title: 'x'.repeat(121), domain: 'tiki.vn' })).toBeNull();
  });

  it('keeps a social-network link as its domain only, like the server (any subdomain counts)', () => {
    for (const domain of ['facebook.com', 'm.facebook.com', 'zalo.me', 'tiktok.com', 'instagram.com', 'threads.net']) {
      expect(crmIdentityEditValue('sharedLink', { title: 'Trang của Hoa', domain }), domain).toEqual({ title: null, domain });
    }
    expect(crmIdentityEditValue('sharedLink', { title: 'Video mẫu', domain: 'youtube.com' })).toEqual({ title: 'Video mẫu', domain: 'youtube.com' });
  });
});

describe('the version an action is sent against (review HIGH 1)', () => {
  const row = (leadId: string, value: CustomerCareCrmIdentity, updatedAt = AT) => ({
    leadId, profile: { updatedAt } as never, identity: value,
  }) as unknown as import('../../shared/customer-care-types').CustomerCareCrmRow;

  it('sends the version of the identity on screen, for confirm, reject and consent-free fields alike', () => {
    expect(crmIdentityActionInput(V1, LEAD_ID, { action: 'confirm', field: 'ageBand' }))
      .toEqual({ leadId: LEAD_ID, action: 'confirm', field: 'ageBand', expectedVersion: V1 });
    expect(crmIdentityActionInput(null, LEAD_ID, { action: 'reject', field: 'occasion' }).expectedVersion).toBeNull();
  });

  it('sends a correction against the version its editor was opened on', () => {
    expect(crmIdentityActionInput(V2, LEAD_ID, { action: 'correct', field: 'ageBand', value: ['55+'], expectedVersion: V1 }))
      .toEqual({ leadId: LEAD_ID, action: 'correct', field: 'ageBand', value: ['55+'], expectedVersion: V1 });
  });

  it('a late 60 s tick that read v1 never brings v1 back over a staff correction (v2); the next Bỏ is sent against v2', () => {
    // The tick read the list while the identity was still v1.
    const before = [row(LEAD_ID, identity('granted', { version: V1 })), row(LEAD_ID_2, identity('granted', { version: V1 }))];
    const lateTick = before.map((item) => ({ ...item }));
    // Meanwhile staff corrected the age: the server answered with v2.
    const v2 = identity('granted', { version: V2, ageBand: field<Array<'55+'>>(['55+'], { status: 'corrected', source: 'staff' }) });
    const afterAction = crmRowsWithIdentity(before, LEAD_ID, v2);
    // The tick lands afterwards with v1.
    const shown = crmRowsOnRefresh(afterAction, lateTick, new Set());
    expect(shown[0].identity?.version).toBe(V2);
    expect(shown[0].identity?.ageBand?.value).toEqual(['55+']);
    expect(shown[1].identity?.version).toBe(V1);
    // "Bỏ" on the age the screen shows goes out against v2.
    const reject = crmIdentityActionInput(shown[0].identity!.version, LEAD_ID, { action: 'reject', field: 'ageBand' });
    expect(reject).toEqual({ leadId: LEAD_ID, action: 'reject', field: 'ageBand', expectedVersion: V2 });
  });

  it('reloads with the identity a 409 returned and says so; the card then shows (and sends) that version', () => {
    const newer = identity('granted', { version: V2 });
    const result: CustomerCareCrmIdentityActionResult = {
      ok: false, error: 'identity_conflict', workspaceId: WORKSPACE, leadId: LEAD_ID, identity: newer,
    };
    const view = crmIdentityActionView('confirm', result);
    expect(view).toMatchObject({ identity: newer, tone: 'notice', dropRows: false, removeRow: false, workspaceId: WORKSPACE });
    expect(view.message).toBe(CRM_IDENTITY_CONFLICT_MESSAGE);
    expect(CRM_IDENTITY_CONFLICT_MESSAGE.startsWith('Hồ sơ vừa được cập nhật')).toBe(true);
    const busy = crmIdentityCardBegin(crmIdentityCardStart(), 'ageBand');
    expect(busy.pending).toBe('ageBand');
    expect(crmIdentityCardSettle(busy, view)).toEqual({ pending: null, message: { text: CRM_IDENTITY_CONFLICT_MESSAGE, tone: 'notice' } });
    const shown = crmRowsWithIdentity([row(LEAD_ID, identity())], LEAD_ID, view.identity!);
    expect(crmIdentityActionInput(shown[0].identity!.version, LEAD_ID, { action: 'reject', field: 'ageBand' }).expectedVersion).toBe(V2);
  });

  it('sends consent actions without a field or a version, and a link with its server index', () => {
    expect(crmIdentityActionInput(V1, LEAD_ID, { action: 'ask_consent' })).toEqual({ leadId: LEAD_ID, action: 'ask_consent' });
    expect(crmIdentityActionInput(V1, LEAD_ID, { action: 'correct', field: 'sharedLink', index: 1, value: { title: null, domain: 'a.vn' } }))
      .toEqual({ leadId: LEAD_ID, action: 'correct', field: 'sharedLink', index: 1, value: { title: null, domain: 'a.vn' }, expectedVersion: V1 });
  });

  it('replaces only that customer\'s identity in the rows the panel holds', () => {
    const rows = [{ leadId: LEAD_ID, identity: identity() }, { leadId: LEAD_ID_2, identity: identity() }];
    const next = crmRowsWithIdentity(rows, LEAD_ID, identity('granted', { version: V2 }));
    expect(next[0].identity?.version).toBe(V2);
    expect(next[1]).toBe(rows[1]);
    expect(rows[0].identity.version).toBe(V1);
  });
});

describe('crmIdentityActionView: success texts and every error reason', () => {
  it.each([
    ['confirm', 'Đã duyệt.'],
    ['correct', 'Đã sửa.'],
    ['reject', 'Đã bỏ. AI sẽ không đề xuất lại giá trị này.'],
    ['ask_consent', 'Đã gửi lời xin phép cho khách qua Messenger.'],
    ['withdraw_consent', 'Đã ghi nhận khách rút đồng ý. Thông tin AI về khách đã được xoá.'],
    ['clear_erase_request', 'Đã bỏ yêu cầu xoá. Khách vẫn không nhận ưu đãi và cần đồng ý lại trước khi izzi lưu hồ sơ.'],
  ] as const)('%s succeeds with "%s"', (action, message) => {
    const view = crmIdentityActionView(action, { ok: true, workspaceId: WORKSPACE, leadId: LEAD_ID, identity: identity() });
    expect(view).toMatchObject({ message, tone: 'success', dropRows: false, removeRow: false, skipTick: false });
  });

  it.each([
    ['rejected', 'consent_required', 'Khách chưa đồng ý lưu hồ sơ.'],
    ['rejected', 'outside_window', 'Đã quá 24 giờ từ tin cuối của khách nên Messenger không cho gửi. Chờ khách nhắn lại.'],
    ['rejected', 'ask_limit',
      'Chưa xin phép được lúc này: đã hỏi đủ 2 lần (cách nhau 7 ngày), đang có lời xin phép đang gửi, hoặc khách đã từ chối trong 24 tháng.'],
    ['rejected', 'page_not_connected', 'Page chưa kết nối với izzi nên chưa gửi được.'],
    ['rejected', 'permission_missing', 'Page chưa cho izzi quyền gửi tin nhắn. Kết nối lại Page để cấp quyền.'],
    ['rejected', 'provider_rejected', 'Facebook không nhận tin này. Thử lại sau.'],
    ['unavailable', 'provider_timeout', 'Chưa gửi được qua Facebook. Thử lại sau ít phút.'],
    ['unavailable', 'provider_unavailable', 'Chưa gửi được qua Facebook. Thử lại sau ít phút.'],
    ['rejected', 'profile_ai_off', CRM_IDENTITY_OFF_MESSAGE],
    ['rejected', 'identity_running', 'AI đang cập nhật hồ sơ này. Chờ một lát rồi thử lại.'],
    ['unavailable', 'rate_limited', 'Đang có nhiều yêu cầu. Chờ ít phút rồi thử lại.'],
    ['rejected', 'invalid_request', 'Giá trị không hợp lệ. Hãy tải lại rồi thử lại.'],
  ] as const)('%s %s reads "%s"', (error, reason, message) => {
    const view = crmIdentityActionView('ask_consent', fail(error, reason));
    expect(view).toMatchObject({ identity: null, message, tone: 'error', dropRows: false, removeRow: false });
  });

  it('removes a customer who is gone, drops every row when access is lost, and rests the tick on a server problem', () => {
    expect(crmIdentityActionView('confirm', fail('rejected', 'lead_not_found'))).toMatchObject({
      removeRow: true, message: 'Khách này không còn trong danh sách.',
    });
    for (const error of ['forbidden', 'auth', 'access_changed'] as const) {
      expect(crmIdentityActionView('confirm', fail(error)).dropRows, error).toBe(true);
    }
    expect(crmIdentityActionView('confirm', fail('unavailable', 'rate_limited')).skipTick).toBe(true);
    expect(crmIdentityActionView('confirm', fail('not_configured'))).toMatchObject({
      skipTick: true, message: 'Máy chủ izzi chưa sẵn sàng cho hồ sơ AI. Hãy liên hệ hỗ trợ izzi.',
    });
    expect(crmIdentityActionView('confirm', fail('unsupported')).message).toBe('Máy chủ izzi chưa có hồ sơ AI.');
    expect(crmIdentityActionView('confirm', fail('invalid_input')).message).toBe('Giá trị không hợp lệ. Hãy tải lại rồi thử lại.');
    expect(crmIdentityActionView('confirm', fail('invalid-response')).message).toBe('Phản hồi từ máy chủ không hợp lệ. Thử lại sau.');
    expect(crmIdentityActionView('confirm', fail('rejected')).message).toBe('Máy chủ izzi chưa làm được việc này. Thử lại sau.');
  });

  it('keeps the row when a consent action finds no stored conversation (lead_not_found on ask or withdraw)', () => {
    expect(crmIdentityActionView('ask_consent', fail('rejected', 'lead_not_found'))).toMatchObject({
      removeRow: false, tone: 'error',
      message: 'Không còn tin nhắn nào của khách được lưu (tin giữ 30 ngày) nên chưa gửi được lời xin phép.',
    });
    expect(crmIdentityActionView('withdraw_consent', fail('rejected', 'lead_not_found'))).toMatchObject({
      removeRow: false, message: 'Chưa ghi nhận được: không tìm thấy hội thoại của khách trên Page đang kết nối.',
    });
  });
});

describe('clear_erase_request answers (backend 79e14f9)', () => {
  it('is sent with the lead only, and its answers are explained without dropping the rows on a role refusal', () => {
    expect(crmIdentityActionInput(V1, LEAD_ID, { action: 'clear_erase_request' })).toEqual({ leadId: LEAD_ID, action: 'clear_erase_request' });
    expect(crmIdentityActionView('clear_erase_request', fail('forbidden'))).toMatchObject({
      dropRows: false, removeRow: false, tone: 'error', message: 'Chỉ chủ shop hoặc quản lý bỏ được yêu cầu xoá.',
    });
    expect(crmIdentityActionView('clear_erase_request', fail('rejected', 'lead_not_found'))).toMatchObject({
      removeRow: true, message: 'Khách này không còn trong danh sách.',
    });
    expect(crmIdentityActionView('clear_erase_request', fail('unavailable', 'rate_limited'))).toMatchObject({
      skipTick: true, message: 'Đang có nhiều yêu cầu. Chờ ít phút rồi thử lại.',
    });
    expect(crmIdentityActionView('clear_erase_request', fail('rejected', 'invalid_request')).message)
      .toBe('Giá trị không hợp lệ. Hãy tải lại rồi thử lại.');
    expect(crmIdentityActionView('clear_erase_request', fail('not_configured')).message)
      .toBe('Máy chủ izzi chưa sẵn sàng cho hồ sơ AI. Hãy liên hệ hỗ trợ izzi.');
    expect(crmIdentityActionView('clear_erase_request', fail('unavailable')).message).toBe('Chưa kết nối được máy chủ izzi. Thử lại sau ít phút.');
    // Lost access still drops the rows.
    expect(crmIdentityActionView('clear_erase_request', fail('auth')).dropRows).toBe(true);
  });
});

describe('reading the list again after an answer that changed what the card may do (review LOW 5)', () => {
  it('asks for a page-1 reload after consent_required and profile_ai_off, from an action or a refresh', () => {
    for (const reason of ['consent_required', 'profile_ai_off'] as const) {
      expect(crmIdentityActionView('confirm', fail('rejected', reason)).reloadList, reason).toBe(true);
      expect(crmIdentityRefreshView(fail('rejected', reason)).reloadList, reason).toBe(true);
    }
    for (const view of [
      crmIdentityActionView('confirm', fail('rejected', 'ask_limit')),
      crmIdentityActionView('confirm', fail('unavailable', 'rate_limited')),
      crmIdentityActionView('confirm', { ok: true, workspaceId: WORKSPACE, leadId: LEAD_ID, identity: identity() }),
    ]) {
      expect(view.reloadList).toBe(false);
    }
  });
});

describe('crmIdentityRefreshView ("Cập nhật hồ sơ")', () => {
  const refreshed = (outcome: 'updated' | 'no_change'): CustomerCareCrmIdentityRefreshResult => ({
    ok: true, workspaceId: WORKSPACE, leadId: LEAD_ID, identity: identity('granted', { version: V2 }), outcome,
  });

  it('takes the new identity and says whether anything changed', () => {
    expect(crmIdentityRefreshView(refreshed('updated'))).toMatchObject({ message: 'Đã cập nhật hồ sơ.', tone: 'success' });
    expect(crmIdentityRefreshView(refreshed('no_change'))).toMatchObject({ message: 'Hồ sơ chưa có gì mới.', tone: 'notice' });
    expect(crmIdentityRefreshView(refreshed('updated')).identity?.version).toBe(V2);
  });

  it('says "Thử lại sau N phút" on refresh_too_soon, rounding up to whole minutes', () => {
    const soon = (retryAfterSec: number): CustomerCareCrmIdentityRefreshResult => ({
      ok: false, error: 'refresh_too_soon', workspaceId: WORKSPACE, leadId: LEAD_ID, retryAfterSec,
    });
    expect(crmIdentityRefreshView(soon(420))).toMatchObject({ message: 'Thử lại sau 7 phút.', tone: 'notice', identity: null });
    expect(crmIdentityRefreshView(soon(61)).message).toBe('Thử lại sau 2 phút.');
    expect(crmIdentityRefreshView(soon(0)).message).toBe('Thử lại sau 1 phút.');
    expect(crmRetryMinutes(600)).toBe(10);
  });

  it('shows daily_cap, ai_unavailable and consent_required as short notices', () => {
    expect(crmIdentityRefreshView(fail('rejected', 'daily_cap')).message).toBe('Hôm nay đã hết lượt cập nhật hồ sơ. Mai thử lại nhé.');
    expect(crmIdentityRefreshView(fail('unavailable', 'ai_unavailable')).message).toBe('AI đang bận. Thử lại sau ít phút.');
    expect(crmIdentityRefreshView(fail('rejected', 'consent_required')).message).toBe('Khách chưa đồng ý lưu hồ sơ.');
  });

  it('stops the spinner with a plain notice when the 45 s wait ran out or the server could not be reached', () => {
    expect(crmIdentityRefreshView(fail('unavailable'))).toMatchObject({
      message: 'Chưa cập nhật được hồ sơ. Thử lại sau ít phút.', tone: 'error', skipTick: true,
    });
  });
});

describe('the consent question and the withdraw confirm', () => {
  it('shows the server\'s consent question verbatim, with its two buttons (review MEDIUM 3)', () => {
    const text = crmConsentConfirmText(ASK);
    expect(text).toBe(`Gửi tin này cho khách qua Messenger?\n\n${ASK}\n\nKèm 2 nút: [Đồng ý] [Không]`);
  });

  it('explains what dropping an erase request does before staff confirm it', () => {
    const text = crmClearEraseConfirmText('Nguyễn Thị Hoa');
    expect(text).toContain('Nguyễn Thị Hoa');
    expect(text).toContain('đổi ý');
    expect(text).toContain('đồng ý lại');
  });

  it('explains what withdrawing does before staff record it', () => {
    const text = crmWithdrawConfirmText('Nguyễn Thị Hoa');
    expect(text).toContain('Nguyễn Thị Hoa');
    expect(text).toContain('xoá các thông tin AI');
    expect(text).toContain('không xin phép lại');
  });
});
