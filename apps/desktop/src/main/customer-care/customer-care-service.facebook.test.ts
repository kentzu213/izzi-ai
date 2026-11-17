import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomerCareAuthority, CustomerCareSetup } from '../../shared/customer-care-types';
import { CustomerCareService, type CustomerCareSafeStorage } from './customer-care-service';
import type {
  CareFacebookCallbackResult,
  CareFacebookConnectStart,
  CareFacebookConnection,
  CareFacebookGateway,
  CareFacebookResult,
  CareFacebookStatus,
} from './care-facebook-client';
import {
  CARE_BLOCKER_PAGE_MISMATCH,
  CARE_BLOCKER_PAGE_NOT_CONNECTED,
  CARE_BLOCKER_PAGE_STATUS_UNAVAILABLE,
  CARE_BLOCKER_PAGE_UNSUPPORTED,
  CARE_BLOCKER_PAGE_UNVERIFIED,
  CARE_MODE_REASON_PHASE,
} from './care-page-connection';

const NOW = '2026-11-17T00:00:00.000Z';
const IDENTITY_A = 'user-aaaa-1111';
const IDENTITY_B = 'user-bbbb-2222';
const WORKSPACE_A = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_B = '22222222-2222-4222-8222-222222222222';
const CHOICE = '33333333-3333-4333-8333-333333333333';
const PAGE = '105252511858057';
const STATE = 'care-state-0123456789abcdef';
const CODE = 'provider-code-0123456789';
const OWNER: CustomerCareAuthority = { identityId: IDENTITY_A, workspaceId: WORKSPACE_A, role: 'owner' };
const PENDING = { workspaceId: WORKSPACE_A, identityId: IDENTITY_A };
const NON_MANAGERS = ['editor', 'reviewer', 'viewer'] as const;

const CONNECTION: CareFacebookConnection = {
  pageId: PAGE,
  pageName: 'Đồ Đồng Hồng Hưng',
  status: 'active',
  grantedScopes: ['pages_show_list', 'pages_manage_metadata', 'pages_messaging'],
  missingScopes: [],
  verifiedAt: NOW,
  tokenExpiresAt: null,
};

class MemorySettings {
  readonly values = new Map<string, string>();
  getSetting(key: string): string | null { return this.values.get(key) ?? null; }
  setSetting(key: string, value: string): void { this.values.set(key, value); }
}

class XorStorage implements CustomerCareSafeStorage {
  isEncryptionAvailable(): boolean { return true; }
  encryptString(value: string): Buffer { return Buffer.from(Buffer.from(value, 'utf8').map((byte) => byte ^ 0x5a)); }
  decryptString(value: Buffer): string { return Buffer.from(value.map((byte) => byte ^ 0x5a)).toString('utf8'); }
}

class FakeFacebook implements CareFacebookGateway {
  readonly calls: Array<[string, ...string[]]> = [];
  /** Runs inside every gateway call, so tests can switch identity/workspace mid-flight. */
  during: () => void = () => {};
  startResult: CareFacebookResult<CareFacebookConnectStart> = {
    ok: true,
    value: {
      success: true,
      workspaceId: WORKSPACE_A,
      state: STATE,
      expiresAt: '2026-11-17T00:10:00.000Z',
      authorizeUrl: `https://www.facebook.com/v26.0/dialog/oauth?state=${STATE}`,
    },
  };
  callbackResult: CareFacebookResult<CareFacebookCallbackResult> = {
    ok: true,
    value: {
      success: true,
      workspaceId: WORKSPACE_A,
      choiceId: CHOICE,
      expiresAt: '2026-11-17T00:15:00.000Z',
      grantedScopes: ['pages_show_list'],
      missingScopes: ['pages_messaging'],
      pages: [{ pageId: PAGE, name: 'Đồ Đồng Hồng Hưng', eligible: true, reason: 'eligible' }],
    },
  };
  selectResult: CareFacebookResult<CareFacebookConnection> = { ok: true, value: CONNECTION };
  statusResult: CareFacebookResult<CareFacebookStatus> | (() => Promise<CareFacebookResult<CareFacebookStatus>>) = {
    ok: true,
    value: { success: true, workspaceId: WORKSPACE_A, requiredScopes: [], connection: null },
  };
  disconnectResult: CareFacebookResult<null> = { ok: true, value: null };

  async startConnect(workspaceId: string) { this.calls.push(['startConnect', workspaceId]); this.during(); return this.startResult; }
  async completeCallback(workspaceId: string, state: string, code: string) {
    this.calls.push(['completeCallback', workspaceId, state, code]); this.during(); return this.callbackResult;
  }
  async selectPage(workspaceId: string, choiceId: string, pageId: string) {
    this.calls.push(['selectPage', workspaceId, choiceId, pageId]); this.during(); return this.selectResult;
  }
  async getStatus(workspaceId: string) {
    this.calls.push(['getStatus', workspaceId]);
    return typeof this.statusResult === 'function' ? this.statusResult() : this.statusResult;
  }
  async disconnect(workspaceId: string) { this.calls.push(['disconnect', workspaceId]); this.during(); return this.disconnectResult; }
}

function setup(pageId = ''): CustomerCareSetup {
  return { merchantName: 'Đồ Đồng Hồng Hưng', pageId, pageName: '', handoffTarget: 'Sale ca ngày', facts: [] };
}

function fixture(options: { facebook?: FakeFacebook | null; authority?: unknown } = {}) {
  const facebook = options.facebook === null ? undefined : options.facebook ?? new FakeFacebook();
  const state = { authority: ('authority' in options ? options.authority : OWNER) as unknown };
  const resolveAuthority = vi.fn(async () => state.authority as CustomerCareAuthority | null);
  const service = new CustomerCareService({
    store: new MemorySettings(),
    crypto: new XorStorage(),
    resolveAuthority,
    currentIdentityId: () => (state.authority as { identityId?: string } | null)?.identityId ?? null,
    now: () => new Date(NOW),
    facebook,
  });
  const as = (authority: unknown) => { state.authority = authority; };
  return { service, facebook: facebook as FakeFacebook, as, resolveAuthority };
}

describe('CustomerCareService Page connection snapshot', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('reports unsupported without a Facebook dependency and stays in shadow mode', async () => {
    const { service } = fixture({ facebook: null });
    const snapshot = await service.getSnapshot();
    expect(snapshot.pageConnection).toEqual({ state: 'unsupported' });
    expect(snapshot.blockers).toContain(CARE_BLOCKER_PAGE_UNSUPPORTED);
    expect(snapshot).toMatchObject({ mode: 'shadow', outboundEnabled: false });
    expect(snapshot.modeReasons[0]).toBe(CARE_MODE_REASON_PHASE);
  });

  it('reads the status for the resolved workspace only', async () => {
    const { service, facebook } = fixture();
    const snapshot = await service.getSnapshot();
    expect(facebook.calls).toEqual([['getStatus', WORKSPACE_A]]);
    expect(snapshot.pageConnection).toEqual({ state: 'not_connected' });
    expect(snapshot.blockers).toContain(CARE_BLOCKER_PAGE_NOT_CONNECTED);
  });

  it('shows the verified Page and removes the not-connected blocker once the saved Page matches', async () => {
    const { service, facebook } = fixture();
    facebook.statusResult = { ok: true, value: { success: true, workspaceId: WORKSPACE_A, requiredScopes: [], connection: CONNECTION } };
    expect((await service.saveSetup(setup(PAGE))).ok).toBe(true);

    const snapshot = await service.getSnapshot();
    expect(snapshot.pageConnection).toEqual({
      state: 'connected', pageId: PAGE, pageName: 'Đồ Đồng Hồng Hưng', status: 'active', missingScopes: [], verifiedAt: NOW,
    });
    expect(snapshot.blockers.join('\n')).not.toMatch(/Page/);
    expect(snapshot).toMatchObject({ mode: 'shadow', outboundEnabled: false, modeReasons: [CARE_MODE_REASON_PHASE] });
    expect(JSON.stringify(snapshot)).not.toMatch(/grantedScopes|tokenExpiresAt/);
  });

  it('flags a saved Page ID that differs from the connected Page', async () => {
    const { service, facebook } = fixture();
    facebook.statusResult = { ok: true, value: { success: true, workspaceId: WORKSPACE_A, requiredScopes: [], connection: CONNECTION } };
    await service.saveSetup(setup('1234567890'));
    expect((await service.getSnapshot()).blockers).toContain(CARE_BLOCKER_PAGE_MISMATCH);
  });

  it.each([
    ['404', { ok: false, error: 'unsupported' }, 'unsupported', CARE_BLOCKER_PAGE_UNSUPPORTED],
    ['5xx', { ok: false, error: 'unavailable' }, 'unavailable', CARE_BLOCKER_PAGE_STATUS_UNAVAILABLE],
    ['403', { ok: false, error: 'forbidden' }, 'unavailable', CARE_BLOCKER_PAGE_STATUS_UNAVAILABLE],
    ['bad body', { ok: false, error: 'invalid-response' }, 'unavailable', CARE_BLOCKER_PAGE_STATUS_UNAVAILABLE],
  ] as const)('maps a %s status failure to %s', async (_label, result, state, blocker) => {
    const { service, facebook } = fixture();
    facebook.statusResult = result;
    const snapshot = await service.getSnapshot();
    expect(snapshot.pageConnection).toEqual({ state });
    expect(snapshot.blockers).toContain(blocker);
  });

  it('keeps a manually entered Page ID unverified when the status cannot confirm it', async () => {
    const { service, facebook } = fixture();
    facebook.statusResult = { ok: false, error: 'unavailable' };
    await service.saveSetup(setup(PAGE));
    expect((await service.getSnapshot()).blockers).toContain(CARE_BLOCKER_PAGE_UNVERIFIED);
  });

  it('treats a throwing or hanging status read as unavailable within a bound', async () => {
    const throwing = fixture();
    throwing.facebook.statusResult = async () => { throw new Error('private detail'); };
    expect((await throwing.service.getSnapshot()).pageConnection).toEqual({ state: 'unavailable' });

    vi.useFakeTimers();
    const hanging = fixture();
    hanging.facebook.statusResult = () => new Promise(() => {});
    const pending = hanging.service.getSnapshot();
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await pending).pageConnection).toEqual({ state: 'unavailable' });
  });

  it('marks only owners and managers as able to manage the Page', async () => {
    const { service, as } = fixture();
    expect((await service.getSnapshot()).canManagePage).toBe(true);
    as({ ...OWNER, role: 'manager' });
    expect((await service.getSnapshot()).canManagePage).toBe(true);
    for (const role of NON_MANAGERS) {
      as({ ...OWNER, role });
      expect((await service.getSnapshot()).canManagePage).toBe(false);
    }
  });
});

describe('CustomerCareService Facebook Page actions', () => {
  it('begins a connect for an owner and returns the main-only state binding', async () => {
    const { service, facebook, resolveAuthority } = fixture();
    expect(await service.beginFacebookConnect()).toEqual({
      ok: true,
      workspaceId: WORKSPACE_A,
      identityId: IDENTITY_A,
      state: STATE,
      expiresAt: '2026-11-17T00:10:00.000Z',
      authorizeUrl: `https://www.facebook.com/v26.0/dialog/oauth?state=${STATE}`,
    });
    expect(facebook.calls).toEqual([['startConnect', WORKSPACE_A]]);
    expect(resolveAuthority).toHaveBeenCalledTimes(2);
  });

  it('refuses every Page action for editors, reviewers and viewers without calling the backend', async () => {
    const { service, facebook, as } = fixture();
    for (const role of NON_MANAGERS) {
      as({ ...OWNER, role });
      expect(await service.beginFacebookConnect()).toEqual({ ok: false, error: 'forbidden' });
      expect(await service.completeFacebookConnect(STATE, CODE, PENDING)).toEqual({ ok: false, error: 'forbidden' });
      expect(await service.selectFacebookPage({ choiceId: CHOICE, pageId: PAGE })).toEqual({ ok: false, error: 'forbidden' });
      expect(await service.disconnectFacebookPage()).toEqual({ ok: false, error: 'forbidden' });
    }
    expect(facebook.calls).toEqual([]);
  });

  it('lets managers run every Page action', async () => {
    const { service, as } = fixture();
    as({ ...OWNER, role: 'manager' });
    expect((await service.beginFacebookConnect()).ok).toBe(true);
    expect((await service.completeFacebookConnect(STATE, CODE, PENDING)).ok).toBe(true);
    expect((await service.selectFacebookPage({ choiceId: CHOICE, pageId: PAGE })).ok).toBe(true);
    expect((await service.disconnectFacebookPage()).ok).toBe(true);
  });

  it('fails closed when signed out, when authority is unreachable and without the Facebook dependency', async () => {
    const signedOut = fixture({ authority: null });
    expect(await signedOut.service.beginFacebookConnect()).toEqual({ ok: false, error: 'auth' });
    expect(await signedOut.service.disconnectFacebookPage()).toEqual({ ok: false, error: 'auth' });

    vi.useFakeTimers();
    try {
      const unreachable = fixture({ authority: 'unavailable' });
      const pending = unreachable.service.beginFacebookConnect();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await pending).toEqual({ ok: false, error: 'unavailable' });
    } finally {
      vi.useRealTimers();
    }

    const missing = fixture({ facebook: null });
    expect(await missing.service.beginFacebookConnect()).toEqual({ ok: false, error: 'unsupported' });
    expect(await missing.service.selectFacebookPage({ choiceId: CHOICE, pageId: PAGE })).toEqual({ ok: false, error: 'unsupported' });
  });

  it.each([
    ['workspace switch', { ...OWNER, workspaceId: WORKSPACE_B }],
    ['identity switch', { ...OWNER, identityId: IDENTITY_B }],
    ['role downgrade', { ...OWNER, role: 'viewer' }],
    ['sign-out', null],
  ])('discards every Page action result after a mid-flight %s', async (_label, next) => {
    const { service, facebook, as } = fixture();
    facebook.during = () => as(next);
    expect(await service.beginFacebookConnect()).toEqual({ ok: false, error: 'access_changed' });
    as(OWNER);
    expect(await service.completeFacebookConnect(STATE, CODE, PENDING)).toEqual({ ok: false, error: 'access_changed' });
    as(OWNER);
    expect(await service.selectFacebookPage({ choiceId: CHOICE, pageId: PAGE })).toEqual({ ok: false, error: 'access_changed' });
    as(OWNER);
    expect(await service.disconnectFacebookPage()).toEqual({ ok: false, error: 'access_changed' });
  });

  it('refuses a callback whose pending binding belongs to another identity or workspace', async () => {
    const { service, facebook } = fixture();
    expect(await service.completeFacebookConnect(STATE, CODE, { ...PENDING, identityId: IDENTITY_B }))
      .toEqual({ ok: false, error: 'access_changed' });
    expect(await service.completeFacebookConnect(STATE, CODE, { ...PENDING, workspaceId: WORKSPACE_B }))
      .toEqual({ ok: false, error: 'access_changed' });
    expect(facebook.calls).toEqual([]);
  });

  it('returns the Page choices for the renderer without the state or scopes granted', async () => {
    const { service, facebook } = fixture();
    const result = await service.completeFacebookConnect(STATE, CODE, PENDING);
    expect(result).toEqual({
      ok: true,
      choiceId: CHOICE,
      expiresAt: '2026-11-17T00:15:00.000Z',
      pages: [{ pageId: PAGE, name: 'Đồ Đồng Hồng Hưng', eligible: true, reason: 'eligible' }],
      missingScopes: ['pages_messaging'],
    });
    expect(facebook.calls).toEqual([['completeCallback', WORKSPACE_A, STATE, CODE]]);
    expect(JSON.stringify(result)).not.toContain(STATE);
    expect(JSON.stringify(result)).not.toContain(CODE);
  });

  it('rejects a malformed state or code before calling the backend', async () => {
    const { service, facebook } = fixture();
    expect(await service.completeFacebookConnect('x', CODE, PENDING)).toEqual({ ok: false, error: 'invalid_input' });
    expect(await service.completeFacebookConnect(STATE, 'bad code', PENDING)).toEqual({ ok: false, error: 'invalid_input' });
    expect(facebook.calls).toEqual([]);
  });

  it.each([
    ['extra workspace field', { choiceId: CHOICE, pageId: PAGE, workspaceId: WORKSPACE_B }],
    ['missing page', { choiceId: CHOICE }],
    ['non-uuid choice', { choiceId: 'choice-1', pageId: PAGE }],
    ['short page id', { choiceId: CHOICE, pageId: '1234' }],
    ['31-digit page id', { choiceId: CHOICE, pageId: '1'.repeat(31) }],
    ['numeric page id', { choiceId: CHOICE, pageId: 105252511858057 }],
    ['array', [CHOICE, PAGE]],
    ['null', null],
  ])('rejects select input with %s', async (_label, input) => {
    const { service, facebook } = fixture();
    expect(await service.selectFacebookPage(input)).toEqual({ ok: false, error: 'invalid_input' });
    expect(facebook.calls).toEqual([]);
  });

  it('selects a Page for the resolved workspace and returns a snapshot with the connection', async () => {
    const { service, facebook } = fixture();
    const result = await service.selectFacebookPage({ choiceId: CHOICE, pageId: PAGE });
    expect(facebook.calls).toEqual([['selectPage', WORKSPACE_A, CHOICE, PAGE]]);
    expect(result.ok && result.snapshot.pageConnection).toMatchObject({ state: 'connected', pageId: PAGE });
    expect(result.ok && result.snapshot).toMatchObject({ workspaceId: WORKSPACE_A, mode: 'shadow', outboundEnabled: false });
  });

  it('passes bounded backend failures through', async () => {
    const { service, facebook } = fixture();
    facebook.selectResult = { ok: false, error: 'page_bound_elsewhere' };
    expect(await service.selectFacebookPage({ choiceId: CHOICE, pageId: PAGE })).toEqual({ ok: false, error: 'page_bound_elsewhere' });
    facebook.selectResult = { ok: false, error: 'rejected', reason: 'choice_expired' };
    expect(await service.selectFacebookPage({ choiceId: CHOICE, pageId: PAGE }))
      .toEqual({ ok: false, error: 'rejected', reason: 'choice_expired' });
    facebook.callbackResult = { ok: false, error: 'no_pages' };
    expect(await service.completeFacebookConnect(STATE, CODE, PENDING)).toEqual({ ok: false, error: 'no_pages' });
    facebook.startResult = { ok: false, error: 'not_configured' };
    expect(await service.beginFacebookConnect()).toEqual({ ok: false, error: 'not_configured' });
  });

  it('disconnects and returns a not-connected snapshot', async () => {
    const { service, facebook } = fixture();
    const result = await service.disconnectFacebookPage();
    expect(facebook.calls).toEqual([['disconnect', WORKSPACE_A]]);
    expect(result.ok && result.snapshot.pageConnection).toEqual({ state: 'not_connected' });
  });

  it('maps a throwing gateway to unavailable without leaking its message', async () => {
    const { service, facebook } = fixture();
    facebook.during = () => { throw new Error('token EAAB-private'); };
    expect(await service.disconnectFacebookPage()).toEqual({ ok: false, error: 'unavailable' });
  });
});
