/**
 * Care CRM S2 through `CustomerCareService`: the live authority decides the workspace and the role, renderer
 * input is parsed strictly, answers are copies, and CRM data never reaches the settings store (SQLite),
 * the Care graph refresh (graph_nodes) or the logger.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  CustomerCareAuthority,
  CustomerCareCrmProfileInput,
  CustomerCareCrmRow,
  CustomerCareCrmSaveInput,
} from '../../shared/customer-care-types';
import { CustomerCareService, type CustomerCareSafeStorage } from './customer-care-service';
import type { CareFacebookResult } from './care-facebook-client';
import type { CareCrmGateway, CareCrmPage, CareCrmSaveOutcome } from './care-crm';

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

const PAGE: CareCrmPage = {
  role: 'owner',
  canDelete: true,
  rows: [ROW],
  nextCursor: 'crm-next-1',
  assignees: [{ userId: OWNER_ID, label: 'Lan' }],
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
  saveResult: CareFacebookResult<CareCrmSaveOutcome> = { ok: true, value: { kind: 'saved', row: ROW } };

  async listCrm(workspaceId: string, cursor: string | null) {
    this.calls.push(['listCrm', workspaceId, cursor]); this.during(); return this.listResult;
  }
  async saveCrmProfile(workspaceId: string, input: CustomerCareCrmSaveInput) {
    this.calls.push(['saveCrmProfile', workspaceId, input]); this.during(); return this.saveResult;
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
  it('saves for the live workspace and returns the saved row', async () => {
    const { service, crm } = fixture({ authority: as('editor') });
    expect(await service.saveCrmProfile(SAVE)).toEqual({ ok: true, workspaceId: WORKSPACE_A, row: ROW });
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

  it('returns the current server row on a conflict, and forwards lead_not_found', async () => {
    const crm = new FakeCrm();
    const current = { ...ROW, profile: { ...ROW.profile, stage: 'deposit' as const, updatedAt: '2026-11-24T07:00:00.000Z' } };
    crm.saveResult = { ok: true, value: { kind: 'conflict', row: current } };
    const { service } = fixture({ crm });
    const conflict = await service.saveCrmProfile(SAVE);
    expect(conflict).toEqual({ ok: false, error: 'profile_conflict', workspaceId: WORKSPACE_A, row: current });
    if (conflict.ok || conflict.error !== 'profile_conflict') throw new Error('expected a conflict');
    expect(conflict.row).not.toBe(current);

    crm.saveResult = { ok: false, error: 'rejected', reason: 'lead_not_found' };
    expect(await service.saveCrmProfile(SAVE)).toEqual({ ok: false, error: 'rejected', reason: 'lead_not_found' });
  });

  it('discards a save answer after an account switch', async () => {
    const { service, crm, switchTo } = fixture();
    crm.during = () => switchTo({ ...OWNER, identityId: IDENTITY_B });
    expect(await service.saveCrmProfile(SAVE)).toEqual({ ok: false, error: 'access_changed' });
  });
});

describe('CRM data stays out of SQLite, graph_nodes and the logger', () => {
  it('never writes the settings store, never asks for a Care graph refresh and never logs', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const)
      .map((level) => vi.spyOn(console, level).mockImplementation(() => undefined));
    const { service, crm, store, onCareChanged, onFacebookInboxChanged, switchTo } = fixture();

    await service.listCrm({ cursor: null });
    await service.saveCrmProfile(SAVE);
    crm.saveResult = { ok: true, value: { kind: 'conflict', row: ROW } };
    await service.saveCrmProfile(SAVE);
    crm.saveResult = { ok: false, error: 'unavailable' };
    await service.saveCrmProfile(SAVE);
    crm.saveCrmProfile = async () => { throw new Error(`${PHONE} ${NAME} ${NOTE}`); };
    await service.saveCrmProfile(SAVE);
    await service.saveCrmProfile({ ...SAVE, profile: { ...PROFILE, note: `bad\u0000${NOTE}` } });
    crm.during = () => switchTo(null);
    await service.listCrm({ cursor: null });

    expect(store.setSetting).not.toHaveBeenCalled();
    expect(store.getSetting).not.toHaveBeenCalled();
    expect(onCareChanged).not.toHaveBeenCalled();
    expect(onFacebookInboxChanged).not.toHaveBeenCalled();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
