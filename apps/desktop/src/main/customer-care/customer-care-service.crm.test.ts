/**
 * Care CRM S2 through `CustomerCareService`: the live authority decides the workspace and the role, renderer
 * input is parsed strictly, answers are copies, and CRM data never reaches the settings store (SQLite),
 * the Care graph refresh (graph_nodes) or the logger.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CustomerCareAuthority,
  CustomerCareCrmIdentity,
  CustomerCareCrmIdentityActionInput,
  CustomerCareCrmProfileInput,
  CustomerCareCrmRow,
  CustomerCareCrmSaveInput,
} from '../../shared/customer-care-types';
import { CustomerCareService, type CustomerCareSafeStorage } from './customer-care-service';
import type { CareFacebookResult } from './care-facebook-client';
import type { CareCrmGateway, CareCrmPage, CareCrmSaveOutcome } from './care-crm';
import type { CareCrmIdentityOutcome, CareCrmRefreshOutcome } from './care-crm-identity';

const NOW = new Date('2026-11-24T08:00:00.000Z');
const IDENTITY_A = 'user-aaaa-1111';
const IDENTITY_B = 'user-bbbb-2222';
const WORKSPACE_A = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_B = '22222222-2222-4222-8222-222222222222';
const LEAD_ID = '44444444-4444-4444-8444-444444444444';
const OWNER_ID = '66666666-6666-4666-8666-666666666666';
const ISO = '2026-11-20T10:00:00.000Z';
const UPDATED = '2026-11-21T09:30:00.000Z';
const PHONE = '0901234567';
const NAME = 'Nguyễn Thị Hoa';
const NOTE = 'Nhà mới ở Thủ Đức, thích gỗ gụ';
const NEXT_STEP = 'Gọi lại báo giá bàn thờ';
const OWNER: CustomerCareAuthority = { identityId: IDENTITY_A, workspaceId: WORKSPACE_A, role: 'owner' };
const as = (role: CustomerCareAuthority['role']): CustomerCareAuthority => ({ ...OWNER, role });

const PROFILE: CustomerCareCrmProfileInput = {
  stage: 'consulting',
  ownerUserId: OWNER_ID,
  addressForm: 'chi',
  occasion: 'new_home',
  neededBy: '2026-12-20',
  productFactIds: ['ban-tho-127'],
  nextStep: NEXT_STEP,
  nextStepDueAt: '2026-11-25T02:00:00.000Z',
  lostReason: null,
  purchasedAt: null,
  note: NOTE,
};

const ROW: CustomerCareCrmRow = {
  leadId: LEAD_ID,
  pageId: '105252511858057',
  customerName: NAME,
  phone: PHONE,
  zaloMentioned: true,
  leadStatus: 'contacted',
  phoneCapturedAt: ISO,
  lastMessageAt: ISO,
  recentMessages: [{ text: `Số em ${PHONE}`, at: ISO }],
  profile: { ...PROFILE, updatedAt: UPDATED, updatedBy: OWNER_ID },
};

const QUOTE = 'em mua cho bố mẹ ạ';
const VERSION = '2026-11-25T01:02:03.456Z';
const IDENTITY: CustomerCareCrmIdentity = {
  version: VERSION,
  lastRunAt: VERSION,
  consent: { state: 'granted', at: VERSION, noMarketing: false, canAsk: false },
  occasion: null,
  timeline: null,
  productFactIds: { value: ['ban-tho-127'], confidence: 'high', kind: 'stated', source: 'ai', status: 'suggested', updatedAt: VERSION, evidence: [] },
  addressForm: null,
  ageBand: { value: ['25-34', '35-44'], confidence: 'medium', kind: 'inferred', source: 'ai', status: 'suggested', updatedAt: VERSION, evidence: [] },
  family: {
    value: { recipient: 'parents' }, confidence: 'high', kind: 'stated', source: 'ai', status: 'suggested', updatedAt: VERSION,
    evidence: [{ source: 'customer', at: VERSION, quote: QUOTE }],
  },
  interests: { adTitle: null, sharedLinks: [], budgetBand: null },
  persona: null,
};

const PAGE: CareCrmPage = {
  role: 'owner',
  canDelete: true,
  rows: [ROW],
  nextCursor: 'crm-next-1',
  assignees: [{ userId: OWNER_ID, label: 'Lan' }],
  identityEnabled: null,
  identityUnavailable: false,
  consentAsk: null,
};

const SAVE: CustomerCareCrmSaveInput = { leadId: LEAD_ID, expectedUpdatedAt: UPDATED, profile: PROFILE };

class SpyStore {
  readonly getSetting = vi.fn((_key: string): string | null => null);
  readonly setSetting = vi.fn((_key: string, _value: string): void => undefined);
}

const storage: CustomerCareSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value, 'utf8'),
  decryptString: (value) => value.toString('utf8'),
};

class FakeCrm implements CareCrmGateway {
  readonly calls: unknown[][] = [];
  during: () => void = () => {};
  listResult: CareFacebookResult<CareCrmPage> = { ok: true, value: PAGE };
  saveResult: CareFacebookResult<CareCrmSaveOutcome> = { ok: true, value: { kind: 'saved', leadId: LEAD_ID, profile: ROW.profile } };

  readonly listOptions: unknown[] = [];
  async listCrm(workspaceId: string, cursor: string | null, options?: unknown) {
    this.calls.push(['listCrm', workspaceId, cursor]); this.listOptions.push(options); this.during(); return this.listResult;
  }
  async saveCrmProfile(workspaceId: string, input: CustomerCareCrmSaveInput) {
    this.calls.push(['saveCrmProfile', workspaceId, input]); this.during(); return this.saveResult;
  }
  identityResult: CareFacebookResult<CareCrmIdentityOutcome> = { ok: true, value: { kind: 'applied', leadId: LEAD_ID, identity: IDENTITY } };
  refreshResult: CareFacebookResult<CareCrmRefreshOutcome> = {
    ok: true, value: { kind: 'refreshed', leadId: LEAD_ID, identity: IDENTITY, outcome: 'updated' },
  };
  async identityAction(workspaceId: string, input: CustomerCareCrmIdentityActionInput) {
    this.calls.push(['identityAction', workspaceId, input]); this.during(); return this.identityResult;
  }
  async refreshIdentity(workspaceId: string, leadId: string) {
    this.calls.push(['refreshIdentity', workspaceId, leadId]); this.during(); return this.refreshResult;
  }
}

function fixture(options: { authority?: unknown; crm?: FakeCrm | null } = {}) {
  const crm = options.crm === null ? undefined : options.crm ?? new FakeCrm();
  const state = { authority: ('authority' in options ? options.authority : OWNER) as unknown };
  const store = new SpyStore();
  const onCareChanged = vi.fn();
  const onFacebookInboxChanged = vi.fn();
  const service = new CustomerCareService({
    store,
    crypto: storage,
    now: () => NOW,
    resolveAuthority: async () => state.authority as CustomerCareAuthority | null,
    currentIdentityId: () => (state.authority as { identityId?: string } | null)?.identityId ?? null,
    crm,
    onCareChanged,
    onFacebookInboxChanged,
  });
  const switchTo = (authority: unknown) => { state.authority = authority; };
  return { service, crm: crm as FakeCrm, store, onCareChanged, onFacebookInboxChanged, switchTo };
}

afterEach(() => vi.restoreAllMocks());

describe('CustomerCareService.listCrm', () => {
  it('lists the live workspace, passing only the opaque cursor through', async () => {
    const { service, crm } = fixture();
    expect(await service.listCrm({ cursor: null })).toEqual({ ok: true, workspaceId: WORKSPACE_A, ...PAGE });
    await service.listCrm({ cursor: 'crm-next-1' });
    expect(crm.calls).toEqual([['listCrm', WORKSPACE_A, null], ['listCrm', WORKSPACE_A, 'crm-next-1']]);
  });

  it('rejects any other renderer input before reaching the server', async () => {
    const { service, crm } = fixture();
    for (const input of [undefined, {}, { cursor: null, workspaceId: WORKSPACE_B }, { cursor: 'has space' }]) {
      expect(await service.listCrm(input)).toEqual({ ok: false, error: 'invalid_input' });
    }
    expect(crm.calls).toEqual([]);
  });

  it('lets owner, manager and editor read; a viewer or reviewer gets forbidden without a request', async () => {
    for (const role of ['manager', 'editor'] as const) {
      expect((await fixture({ authority: as(role) }).service.listCrm({ cursor: null })).ok).toBe(true);
    }
    for (const role of ['viewer', 'reviewer'] as const) {
      const { service, crm } = fixture({ authority: as(role) });
      expect(await service.listCrm({ cursor: null })).toEqual({ ok: false, error: 'forbidden' });
      expect(crm.calls).toEqual([]);
    }
  });

  it('offers delete only when the server and the live role both allow it', async () => {
    expect(await fixture({ authority: as('editor') }).service.listCrm({ cursor: null }))
      .toMatchObject({ ok: true, canDelete: false });
    const crm = new FakeCrm();
    crm.listResult = { ok: true, value: { ...PAGE, canDelete: false } };
    expect(await fixture({ crm }).service.listCrm({ cursor: null })).toMatchObject({ ok: true, canDelete: false });
    expect(await fixture({ authority: as('manager') }).service.listCrm({ cursor: null }))
      .toMatchObject({ ok: true, canDelete: true });
  });

  it('forwards server failures and answers auth, unavailable and unsupported', async () => {
    const crm = new FakeCrm();
    crm.listResult = { ok: false, error: 'not_configured' };
    expect(await fixture({ crm }).service.listCrm({ cursor: null })).toEqual({ ok: false, error: 'not_configured' });
    expect(await fixture({ authority: null }).service.listCrm({ cursor: null })).toEqual({ ok: false, error: 'auth' });
    expect(await fixture({ crm: null }).service.listCrm({ cursor: null })).toEqual({ ok: false, error: 'unsupported' });
    const limited = new FakeCrm();
    limited.listResult = { ok: false, error: 'unavailable', reason: 'rate_limited' };
    expect(await fixture({ crm: limited }).service.listCrm({ cursor: null }))
      .toEqual({ ok: false, error: 'unavailable', reason: 'rate_limited' });
    const throwing = new FakeCrm();
    throwing.listCrm = async () => { throw new Error(PHONE); };
    expect(await fixture({ crm: throwing }).service.listCrm({ cursor: null })).toEqual({ ok: false, error: 'unavailable' });
  });

  it('discards the answer when the account or workspace changes during the call', async () => {
    const { service, crm, switchTo } = fixture();
    crm.during = () => switchTo({ ...OWNER, workspaceId: WORKSPACE_B });
    expect(await service.listCrm({ cursor: null })).toEqual({ ok: false, error: 'access_changed' });
    crm.during = () => switchTo({ ...OWNER, identityId: IDENTITY_B });
    expect(await service.listCrm({ cursor: null })).toEqual({ ok: false, error: 'access_changed' });
  });

  it('hands out copies that share nothing with the gateway result', async () => {
    const { service } = fixture();
    const result = await service.listCrm({ cursor: null });
    if (!result.ok) throw new Error('expected rows');
    expect(result.rows[0]).not.toBe(ROW);
    expect(result.rows[0].profile).not.toBe(ROW.profile);
    expect(result.rows[0].profile.productFactIds).not.toBe(ROW.profile.productFactIds);
    expect(result.assignees[0]).not.toBe(PAGE.assignees[0]);
  });
});

describe('CustomerCareService.saveCrmProfile', () => {
  it('saves for the live workspace and returns the saved profile', async () => {
    const { service, crm } = fixture({ authority: as('editor') });
    const result = await service.saveCrmProfile(SAVE);
    expect(result).toEqual({ ok: true, workspaceId: WORKSPACE_A, leadId: LEAD_ID, profile: ROW.profile });
    if (!result.ok) throw new Error('expected a save');
    expect(result.profile).not.toBe(ROW.profile);
    expect(result.profile.productFactIds).not.toBe(ROW.profile.productFactIds);
    expect(crm.calls).toEqual([['saveCrmProfile', WORKSPACE_A, SAVE]]);
  });

  it('rejects invalid input, including a workspace from the renderer, before reaching the server', async () => {
    const { service, crm } = fixture();
    for (const input of [
      undefined,
      { ...SAVE, workspaceId: WORKSPACE_B },
      { ...SAVE, profile: { ...PROFILE, stage: 'won' } },
      { ...SAVE, profile: { ...PROFILE, lostReason: 'price' } },
      { ...SAVE, profile: { ...PROFILE, neededBy: '2030-01-01' } },
    ]) {
      expect(await service.saveCrmProfile(input)).toEqual({ ok: false, error: 'invalid_input' });
    }
    expect(crm.calls).toEqual([]);
  });

  it('forbids a viewer or reviewer without a request', async () => {
    for (const role of ['viewer', 'reviewer'] as const) {
      const { service, crm } = fixture({ authority: as(role) });
      expect(await service.saveCrmProfile(SAVE)).toEqual({ ok: false, error: 'forbidden' });
      expect(crm.calls).toEqual([]);
    }
  });

  it('returns the current server profile on a conflict, and forwards lead_not_found and owner_not_eligible', async () => {
    const crm = new FakeCrm();
    const current = { ...ROW.profile, stage: 'deposit' as const, updatedAt: '2026-11-24T07:00:00.000Z' };
    crm.saveResult = { ok: true, value: { kind: 'conflict', leadId: LEAD_ID, profile: current } };
    const { service } = fixture({ crm });
    const conflict = await service.saveCrmProfile(SAVE);
    expect(conflict).toEqual({ ok: false, error: 'profile_conflict', workspaceId: WORKSPACE_A, leadId: LEAD_ID, profile: current });
    if (conflict.ok || conflict.error !== 'profile_conflict') throw new Error('expected a conflict');
    expect(conflict.profile).not.toBe(current);

    crm.saveResult = { ok: false, error: 'rejected', reason: 'owner_not_eligible' };
    expect(await service.saveCrmProfile(SAVE)).toEqual({ ok: false, error: 'rejected', reason: 'owner_not_eligible' });

    crm.saveResult = { ok: false, error: 'rejected', reason: 'lead_not_found' };
    expect(await service.saveCrmProfile(SAVE)).toEqual({ ok: false, error: 'rejected', reason: 'lead_not_found' });
  });

  it('discards a save answer after an account switch', async () => {
    const { service, crm, switchTo } = fixture();
    crm.during = () => switchTo({ ...OWNER, identityId: IDENTITY_B });
    expect(await service.saveCrmProfile(SAVE)).toEqual({ ok: false, error: 'access_changed' });
  });
});

const CONFIRM = { leadId: LEAD_ID, action: 'confirm', field: 'family', expectedVersion: VERSION } as const;

describe('CustomerCareService.listCrm with identity (Care CRM S3)', () => {
  it('scopes the identity pause to the live account and workspace, and passes "Làm mới" through', async () => {
    const { service, crm, switchTo } = fixture();
    await service.listCrm({ cursor: null });
    await service.listCrm({ cursor: null, retryIdentity: true });
    switchTo({ ...OWNER, identityId: IDENTITY_B });
    await service.listCrm({ cursor: null });
    switchTo({ ...OWNER, workspaceId: WORKSPACE_B });
    await service.listCrm({ cursor: null });
    const [first, retry, otherAccount, otherWorkspace] = crm.listOptions as Array<{ scope: string; retryIdentity: boolean }>;
    expect(first).toEqual({ scope: expect.any(String), retryIdentity: false });
    expect(retry).toEqual({ scope: first.scope, retryIdentity: true });
    expect(new Set([first.scope, otherAccount.scope, otherWorkspace.scope]).size).toBe(3);
    // The scope is a hash: it never carries the account or the workspace id.
    for (const id of [IDENTITY_A, IDENTITY_B, WORKSPACE_A, WORKSPACE_B]) expect(JSON.stringify(crm.listOptions)).not.toContain(id);
  });

  it('passes the consent question, a row whose identity was unreadable, and the unavailable flag through', async () => {
    const crm = new FakeCrm();
    const consentAsk = { text: 'Dạ em là trợ lý tự động của shop ạ.', copyVersion: 1 };
    crm.listResult = { ok: true, value: { ...PAGE, identityEnabled: true, identityUnavailable: true, consentAsk, rows: [{ ...ROW, identityUnavailable: true }] } };
    const result = await fixture({ crm }).service.listCrm({ cursor: null });
    if (!result.ok) throw new Error('expected rows');
    expect(result).toMatchObject({ identityEnabled: true, identityUnavailable: true, consentAsk });
    expect(result.consentAsk).not.toBe(consentAsk);
    expect(result.rows[0].identityUnavailable).toBe(true);
  });

  it('passes identityEnabled and hands out identity copies', async () => {
    const crm = new FakeCrm();
    crm.listResult = { ok: true, value: { ...PAGE, identityEnabled: true, rows: [{ ...ROW, identity: IDENTITY }] } };
    const result = await fixture({ crm }).service.listCrm({ cursor: null });
    if (!result.ok) throw new Error('expected rows');
    expect(result.identityEnabled).toBe(true);
    expect(result.rows[0].identity).toEqual(IDENTITY);
    expect(result.rows[0].identity).not.toBe(IDENTITY);
    expect(result.rows[0].identity?.family?.evidence[0]).not.toBe(IDENTITY.family?.evidence[0]);
  });
});

describe('CustomerCareService.identityAction (Care CRM S3)', () => {
  it('acts for the live workspace and returns the identity after the action', async () => {
    const { service, crm } = fixture({ authority: as('editor') });
    const result = await service.identityAction(CONFIRM);
    expect(result).toEqual({ ok: true, workspaceId: WORKSPACE_A, leadId: LEAD_ID, identity: IDENTITY });
    if (!result.ok) throw new Error('expected an identity');
    expect(result.identity).not.toBe(IDENTITY);
    expect(crm.calls).toEqual([['identityAction', WORKSPACE_A, CONFIRM]]);
  });

  it('returns the current identity on a conflict, so the card reloads instead of overwriting', async () => {
    const { service, crm } = fixture();
    const newer = { ...IDENTITY, version: '2026-11-25T02:00:00.000Z' };
    crm.identityResult = { ok: true, value: { kind: 'conflict', leadId: LEAD_ID, identity: newer } };
    expect(await service.identityAction(CONFIRM)).toEqual({
      ok: false, error: 'identity_conflict', workspaceId: WORKSPACE_A, leadId: LEAD_ID, identity: newer,
    });
  });

  it('rejects invalid input, including a workspace from the renderer, before reaching the server', async () => {
    const { service, crm } = fixture();
    for (const input of [
      undefined, {}, { ...CONFIRM, workspaceId: WORKSPACE_B }, { ...CONFIRM, action: 'delete' }, { ...CONFIRM, field: 'gender' },
      { leadId: LEAD_ID, action: 'ask_consent', expectedVersion: null },
    ]) {
      expect(await service.identityAction(input)).toEqual({ ok: false, error: 'invalid_input' });
    }
    expect(crm.calls).toEqual([]);
  });

  it('forbids a viewer or reviewer without a request, and forwards every server reason', async () => {
    for (const role of ['viewer', 'reviewer'] as const) {
      const { service, crm } = fixture({ authority: as(role) });
      expect(await service.identityAction(CONFIRM)).toEqual({ ok: false, error: 'forbidden' });
      expect(crm.calls).toEqual([]);
    }
    const { service, crm } = fixture();
    for (const reason of ['consent_required', 'outside_window', 'ask_limit', 'profile_ai_off', 'provider_rejected'] as const) {
      crm.identityResult = { ok: false, error: 'rejected', reason };
      expect(await service.identityAction({ leadId: LEAD_ID, action: 'ask_consent' })).toEqual({ ok: false, error: 'rejected', reason });
    }
  });

  it('discards the answer when the account or workspace changes during the call', async () => {
    const { service, crm, switchTo } = fixture();
    crm.during = () => switchTo({ ...OWNER, workspaceId: WORKSPACE_B });
    expect(await service.identityAction(CONFIRM)).toEqual({ ok: false, error: 'access_changed' });
  });

  it('lets only an owner or a manager clear an erase request; an editor is refused without a request', async () => {
    const clear = { leadId: LEAD_ID, action: 'clear_erase_request' } as const;
    for (const role of ['owner', 'manager'] as const) {
      const { service, crm } = fixture({ authority: as(role) });
      expect(await service.identityAction(clear)).toEqual({ ok: true, workspaceId: WORKSPACE_A, leadId: LEAD_ID, identity: IDENTITY });
      expect(crm.calls).toEqual([['identityAction', WORKSPACE_A, clear]]);
    }
    for (const role of ['editor', 'viewer', 'reviewer'] as const) {
      const { service, crm } = fixture({ authority: as(role) });
      expect(await service.identityAction(clear), role).toEqual({ ok: false, error: 'forbidden' });
      expect(crm.calls).toEqual([]);
    }
    const { service, crm } = fixture();
    crm.identityResult = { ok: false, error: 'rejected', reason: 'lead_not_found' };
    expect(await service.identityAction(clear)).toEqual({ ok: false, error: 'rejected', reason: 'lead_not_found' });
    crm.identityResult = { ok: false, error: 'forbidden' };
    expect(await service.identityAction(clear)).toEqual({ ok: false, error: 'forbidden' });
  });
});

describe('CustomerCareService.refreshIdentity (Care CRM S3)', () => {
  it('runs for the live workspace and returns the identity with its outcome', async () => {
    const { service, crm } = fixture();
    expect(await service.refreshIdentity({ leadId: LEAD_ID })).toEqual({
      ok: true, workspaceId: WORKSPACE_A, leadId: LEAD_ID, identity: IDENTITY, outcome: 'updated',
    });
    expect(crm.calls).toEqual([['refreshIdentity', WORKSPACE_A, LEAD_ID]]);
  });

  it('says when the next refresh may run, and forwards daily_cap and ai_unavailable', async () => {
    const { service, crm } = fixture();
    crm.refreshResult = { ok: true, value: { kind: 'too_soon', leadId: LEAD_ID, retryAfterSec: 420 } };
    expect(await service.refreshIdentity({ leadId: LEAD_ID })).toEqual({
      ok: false, error: 'refresh_too_soon', workspaceId: WORKSPACE_A, leadId: LEAD_ID, retryAfterSec: 420,
    });
    crm.refreshResult = { ok: false, error: 'rejected', reason: 'daily_cap' };
    expect(await service.refreshIdentity({ leadId: LEAD_ID })).toEqual({ ok: false, error: 'rejected', reason: 'daily_cap' });
    crm.refreshResult = { ok: false, error: 'unavailable', reason: 'ai_unavailable' };
    expect(await service.refreshIdentity({ leadId: LEAD_ID })).toEqual({ ok: false, error: 'unavailable', reason: 'ai_unavailable' });
  });

  it('rejects invalid input and a viewer without a request', async () => {
    const { service, crm } = fixture();
    for (const input of [undefined, {}, { leadId: 'x' }, { leadId: LEAD_ID, workspaceId: WORKSPACE_B }]) {
      expect(await service.refreshIdentity(input)).toEqual({ ok: false, error: 'invalid_input' });
    }
    expect(crm.calls).toEqual([]);
    const viewer = fixture({ authority: as('viewer') });
    expect(await viewer.service.refreshIdentity({ leadId: LEAD_ID })).toEqual({ ok: false, error: 'forbidden' });
    expect(viewer.crm.calls).toEqual([]);
  });
});

describe('CRM data stays out of SQLite, graph_nodes and the logger', () => {
  it('never writes the settings store, never asks for a Care graph refresh and never logs', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const)
      .map((level) => vi.spyOn(console, level).mockImplementation(() => undefined));
    const { service, crm, store, onCareChanged, onFacebookInboxChanged, switchTo } = fixture();

    await service.listCrm({ cursor: null });
    await service.saveCrmProfile(SAVE);
    crm.saveResult = { ok: true, value: { kind: 'conflict', leadId: LEAD_ID, profile: ROW.profile } };
    await service.saveCrmProfile(SAVE);
    crm.saveResult = { ok: false, error: 'unavailable' };
    await service.saveCrmProfile(SAVE);
    crm.saveCrmProfile = async () => { throw new Error(`${PHONE} ${NAME} ${NOTE}`); };
    await service.saveCrmProfile(SAVE);
    await service.saveCrmProfile({ ...SAVE, profile: { ...PROFILE, note: `bad\u0000${NOTE}` } });
    // Care CRM S3: the identity card (ages, family quotes, consent) is never stored or logged either.
    crm.listResult = { ok: true, value: { ...PAGE, identityEnabled: true, rows: [{ ...ROW, identity: IDENTITY }] } };
    await service.listCrm({ cursor: null });
    await service.identityAction(CONFIRM);
    crm.identityResult = { ok: true, value: { kind: 'conflict', leadId: LEAD_ID, identity: IDENTITY } };
    await service.identityAction(CONFIRM);
    await service.identityAction({ ...CONFIRM, field: 'ageBand', action: 'correct', value: ['55+'] });
    await service.refreshIdentity({ leadId: LEAD_ID });
    crm.refreshResult = { ok: true, value: { kind: 'too_soon', leadId: LEAD_ID, retryAfterSec: 60 } };
    await service.refreshIdentity({ leadId: LEAD_ID });
    crm.identityAction = async () => { throw new Error(`${QUOTE} ${NAME}`); };
    crm.refreshIdentity = async () => { throw new Error(`${QUOTE} ${PHONE}`); };
    await service.identityAction(CONFIRM);
    await service.refreshIdentity({ leadId: LEAD_ID });
    crm.during = () => switchTo(null);
    await service.listCrm({ cursor: null });

    expect(store.setSetting).not.toHaveBeenCalled();
    expect(store.getSetting).not.toHaveBeenCalled();
    expect(onCareChanged).not.toHaveBeenCalled();
    expect(onFacebookInboxChanged).not.toHaveBeenCalled();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
