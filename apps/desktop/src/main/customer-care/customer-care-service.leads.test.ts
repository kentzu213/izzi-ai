import { describe, expect, it, vi } from 'vitest';
import type {
  CustomerCareAuthority,
  CustomerCareInboxState,
  CustomerCareLead,
  CustomerCareLeadStatus,
} from '../../shared/customer-care-types';
import { CustomerCareService, type CustomerCareSafeStorage } from './customer-care-service';
import type { CareFacebookResult, CareLeadPage, CareLeadPurge, CareLeadsGateway } from './care-facebook-client';
import {
  parseCareInboxInput,
  parseCareLeadListInput,
  parseCareLeadPurgeInput,
  parseCareLeadStatusInput,
} from './care-leads';

const IDENTITY_A = 'user-aaaa-1111';
const IDENTITY_B = 'user-bbbb-2222';
const WORKSPACE_A = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_B = '22222222-2222-4222-8222-222222222222';
const LEAD_ID = '44444444-4444-4444-8444-444444444444';
const ISO = '2026-11-17T10:00:00.000Z';
const OWNER: CustomerCareAuthority = { identityId: IDENTITY_A, workspaceId: WORKSPACE_A, role: 'owner' };
const as = (role: CustomerCareAuthority['role']): CustomerCareAuthority => ({ ...OWNER, role });

const INBOX: CustomerCareInboxState = { enabled: true, subscribedAt: ISO, lastEventAt: ISO };
const LEAD: CustomerCareLead = {
  id: LEAD_ID,
  pageId: '105252511858057',
  customerName: 'Nguyễn Văn An',
  phone: '0901234567',
  zaloMentioned: false,
  status: 'new',
  phoneCapturedAt: ISO,
  lastMessageAt: ISO,
  statusChangedAt: null,
  recentMessages: [{ text: 'Số em 0901234567', at: ISO }],
};

class MemorySettings {
  readonly values = new Map<string, string>();
  getSetting(key: string): string | null { return this.values.get(key) ?? null; }
  setSetting(key: string, value: string): void { this.values.set(key, value); }
}

const storage: CustomerCareSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(value, 'utf8'),
  decryptString: (value) => value.toString('utf8'),
};

class FakeLeads implements CareLeadsGateway {
  readonly calls: unknown[][] = [];
  during: () => void = () => {};
  inboxResult: CareFacebookResult<CustomerCareInboxState | null> = { ok: true, value: INBOX };
  setResult: CareFacebookResult<CustomerCareInboxState> = { ok: true, value: INBOX };
  listResult: CareFacebookResult<CareLeadPage> = { ok: true, value: { leads: [LEAD], nextCursor: 'next-1' } };
  statusResult: CareFacebookResult<CustomerCareLead> = { ok: true, value: { ...LEAD, status: 'contacted' } };

  async getInbox(workspaceId: string) { this.calls.push(['getInbox', workspaceId]); this.during(); return this.inboxResult; }
  async setInbox(workspaceId: string, enabled: boolean) {
    this.calls.push(['setInbox', workspaceId, enabled]); this.during(); return this.setResult;
  }
  async listLeads(workspaceId: string, cursor: string | null = null) {
    this.calls.push(['listLeads', workspaceId, cursor]); this.during(); return this.listResult;
  }
  async setLeadStatus(workspaceId: string, leadId: string, status: CustomerCareLeadStatus) {
    this.calls.push(['setLeadStatus', workspaceId, leadId, status]); this.during(); return this.statusResult;
  }
  purgeResult: CareFacebookResult<CareLeadPurge> = { ok: true, value: { leadId: LEAD_ID, deletedMessages: 2 } };
  async purgeLead(workspaceId: string, leadId: string) {
    this.calls.push(['purgeLead', workspaceId, leadId]); this.during(); return this.purgeResult;
  }
}

function fixture(options: { authority?: unknown; leads?: FakeLeads | null } = {}) {
  const leads = options.leads === null ? undefined : options.leads ?? new FakeLeads();
  const state = { authority: ('authority' in options ? options.authority : OWNER) as unknown };
  const onFacebookInboxChanged = vi.fn();
  const service = new CustomerCareService({
    store: new MemorySettings(),
    crypto: storage,
    resolveAuthority: async () => state.authority as CustomerCareAuthority | null,
    currentIdentityId: () => (state.authority as { identityId?: string } | null)?.identityId ?? null,
    leads,
    onFacebookInboxChanged,
  });
  const switchTo = (authority: unknown) => { state.authority = authority; };
  return { service, leads: leads as FakeLeads, switchTo, onFacebookInboxChanged };
}

describe('CustomerCareService inbox', () => {
  it.each([
    ['owner', true],
    ['manager', true],
    ['editor', false],
  ] as const)('lets %s read the inbox of the live workspace (canManage %s)', async (role, canManage) => {
    const { service, leads } = fixture({ authority: as(role) });
    expect(await service.getFacebookInbox()).toEqual({ ok: true, workspaceId: WORKSPACE_A, inbox: INBOX, canManage });
    expect(leads.calls).toEqual([['getInbox', WORKSPACE_A]]);
  });

  it.each(['reviewer', 'viewer'] as const)('refuses %s without asking the backend', async (role) => {
    const { service, leads } = fixture({ authority: as(role) });
    expect(await service.getFacebookInbox()).toEqual({ ok: false, error: 'forbidden' });
    expect(await service.listLeads({ cursor: null })).toEqual({ ok: false, error: 'forbidden' });
    expect(await service.setLeadStatus({ leadId: LEAD_ID, status: 'closed' })).toEqual({ ok: false, error: 'forbidden' });
    expect(leads.calls).toEqual([]);
  });

  it('reports a missing Page binding as a null inbox', async () => {
    const { service, leads } = fixture();
    leads.inboxResult = { ok: true, value: null };
    expect(await service.getFacebookInbox()).toEqual({ ok: true, workspaceId: WORKSPACE_A, inbox: null, canManage: true });
  });

  it('answers auth when signed out, unavailable when the authority is unreachable, unsupported without the backend', async () => {
    expect(await fixture({ authority: null }).service.getFacebookInbox()).toEqual({ ok: false, error: 'auth' });
    expect(await fixture({ authority: 'unavailable' }).service.getFacebookInbox()).toEqual({ ok: false, error: 'unavailable' });
    expect(await fixture({ leads: null }).service.getFacebookInbox()).toEqual({ ok: false, error: 'unsupported' });
  });

  it('lets only owner and manager switch the inbox and refreshes background checks after a switch', async () => {
    const editor = fixture({ authority: as('editor') });
    expect(await editor.service.setFacebookInbox({ enabled: true })).toEqual({ ok: false, error: 'forbidden' });
    expect(editor.leads.calls).toEqual([]);

    const manager = fixture({ authority: as('manager') });
    expect(await manager.service.setFacebookInbox({ enabled: true }))
      .toEqual({ ok: true, workspaceId: WORKSPACE_A, inbox: INBOX, canManage: true });
    expect(manager.leads.calls).toEqual([['setInbox', WORKSPACE_A, true]]);
    expect(manager.onFacebookInboxChanged).toHaveBeenCalledTimes(1);
  });

  it('does not report a switch that the backend refused', async () => {
    const { service, leads, onFacebookInboxChanged } = fixture();
    leads.setResult = { ok: false, error: 'rejected', reason: 'page_not_connected' };
    expect(await service.setFacebookInbox({ enabled: true }))
      .toEqual({ ok: false, error: 'rejected', reason: 'page_not_connected' });
    expect(onFacebookInboxChanged).not.toHaveBeenCalled();
  });

  it.each([
    undefined,
    null,
    {},
    { enabled: 'true' },
    { enabled: true, workspaceId: WORKSPACE_B },
    [true],
  ])('rejects inbox input %j before any authority or backend call', async (input) => {
    const { service, leads } = fixture();
    expect(await service.setFacebookInbox(input)).toEqual({ ok: false, error: 'invalid_input' });
    expect(leads.calls).toEqual([]);
  });

  it('discards the answer when the account or workspace changes during the call', async () => {
    const { service, leads, switchTo } = fixture();
    leads.during = () => switchTo({ ...OWNER, workspaceId: WORKSPACE_B });
    expect(await service.setFacebookInbox({ enabled: true })).toEqual({ ok: false, error: 'access_changed' });
    leads.during = () => switchTo({ ...OWNER, identityId: IDENTITY_B });
    expect(await service.listLeads({ cursor: null })).toEqual({ ok: false, error: 'access_changed' });
  });
});

describe('CustomerCareService leads', () => {
  it('lists leads for the live workspace, passing only the opaque cursor through', async () => {
    const { service, leads } = fixture({ authority: as('editor') });
    expect(await service.listLeads({ cursor: null }))
      .toEqual({ ok: true, workspaceId: WORKSPACE_A, leads: [LEAD], nextCursor: 'next-1' });
    expect(await service.listLeads({ cursor: 'next-1' })).toMatchObject({ ok: true });
    expect(leads.calls).toEqual([['listLeads', WORKSPACE_A, null], ['listLeads', WORKSPACE_A, 'next-1']]);
  });

  it('hands out copies that share nothing with the gateway result', async () => {
    const { service, leads } = fixture();
    const result = await service.listLeads({ cursor: null });
    expect(result.ok && result.leads[0]).not.toBe(LEAD);
    expect(result.ok && result.leads[0].recentMessages[0]).not.toBe(LEAD.recentMessages[0]);
    expect(leads.listResult.ok && leads.listResult.value.leads[0]).toBe(LEAD);
  });

  it.each([
    undefined,
    {},
    { cursor: '' },
    { cursor: 'has space' },
    { cursor: 42 },
    { cursor: null, workspaceId: WORKSPACE_B },
  ])('rejects lead list input %j without a backend call', async (input) => {
    const { service, leads } = fixture();
    expect(await service.listLeads(input)).toEqual({ ok: false, error: 'invalid_input' });
    expect(leads.calls).toEqual([]);
  });

  it('lets an editor move a lead and forwards lead_not_found', async () => {
    const { service, leads } = fixture({ authority: as('editor') });
    expect(await service.setLeadStatus({ leadId: LEAD_ID, status: 'contacted' }))
      .toEqual({ ok: true, workspaceId: WORKSPACE_A, lead: { ...LEAD, status: 'contacted' } });
    expect(leads.calls).toEqual([['setLeadStatus', WORKSPACE_A, LEAD_ID, 'contacted']]);

    leads.statusResult = { ok: false, error: 'rejected', reason: 'lead_not_found' };
    expect(await service.setLeadStatus({ leadId: LEAD_ID, status: 'closed' }))
      .toEqual({ ok: false, error: 'rejected', reason: 'lead_not_found' });
  });

  it.each([
    { leadId: 'lead-1', status: 'new' },
    { leadId: LEAD_ID, status: 'done' },
    { leadId: LEAD_ID },
    { leadId: LEAD_ID, status: 'new', workspaceId: WORKSPACE_B },
  ])('rejects status input %j without a backend call', async (input) => {
    const { service, leads } = fixture();
    expect(await service.setLeadStatus(input)).toEqual({ ok: false, error: 'invalid_input' });
    expect(leads.calls).toEqual([]);
  });

  it('turns a throwing gateway into unavailable', async () => {
    const { service, leads } = fixture();
    leads.listLeads = async () => { throw new Error('socket hang up 0901234567'); };
    expect(await service.listLeads({ cursor: null })).toEqual({ ok: false, error: 'unavailable' });
  });
});

describe('CustomerCareService customer purge (B1b)', () => {
  it.each(['owner', 'manager'] as const)('lets %s delete one customer of the live workspace', async (role) => {
    const { service, leads } = fixture({ authority: as(role) });
    expect(await service.purgeLead({ leadId: LEAD_ID }))
      .toEqual({ ok: true, workspaceId: WORKSPACE_A, leadId: LEAD_ID });
    expect(leads.calls).toEqual([['purgeLead', WORKSPACE_A, LEAD_ID]]);
  });

  it.each(['editor', 'reviewer', 'viewer'] as const)('refuses %s without asking the backend', async (role) => {
    const { service, leads } = fixture({ authority: as(role) });
    expect(await service.purgeLead({ leadId: LEAD_ID })).toEqual({ ok: false, error: 'forbidden' });
    expect(leads.calls).toEqual([]);
  });

  it.each([
    undefined,
    {},
    { leadId: 'lead-1' },
    { leadId: LEAD_ID, workspaceId: WORKSPACE_B },
    { leadId: LEAD_ID, phone: '0901234567' },
  ])('rejects purge input %j without a backend call', async (input) => {
    const { service, leads } = fixture();
    expect(await service.purgeLead(input)).toEqual({ ok: false, error: 'invalid_input' });
    expect(leads.calls).toEqual([]);
  });

  it('forwards lead_not_found, maps a throwing gateway to unavailable and drops an answer after an account switch', async () => {
    const { service, leads } = fixture();
    leads.purgeResult = { ok: false, error: 'rejected', reason: 'lead_not_found' };
    expect(await service.purgeLead({ leadId: LEAD_ID })).toEqual({ ok: false, error: 'rejected', reason: 'lead_not_found' });

    leads.purgeLead = async () => { throw new Error('socket hang up 0901234567'); };
    expect(await service.purgeLead({ leadId: LEAD_ID })).toEqual({ ok: false, error: 'unavailable' });

    const changing = fixture();
    changing.leads.during = () => changing.switchTo({ ...OWNER, workspaceId: WORKSPACE_B });
    expect(await changing.service.purgeLead({ leadId: LEAD_ID })).toEqual({ ok: false, error: 'access_changed' });
  });
});

describe('care-leads input parsers', () => {
  it('accepts exactly the documented shapes', () => {
    expect(parseCareInboxInput({ enabled: false })).toEqual({ enabled: false });
    expect(parseCareLeadListInput({ cursor: null })).toEqual({ cursor: null });
    expect(parseCareLeadStatusInput({ leadId: LEAD_ID, status: 'closed' })).toEqual({ leadId: LEAD_ID, status: 'closed' });
    expect(parseCareLeadPurgeInput({ leadId: LEAD_ID })).toEqual({ leadId: LEAD_ID });
    expect(parseCareInboxInput(Object.create({ enabled: true }))).toBeNull();
    expect(parseCareLeadPurgeInput(Object.create({ leadId: LEAD_ID }))).toBeNull();
  });
});
