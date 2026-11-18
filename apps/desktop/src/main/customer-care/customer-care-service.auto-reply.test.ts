/**
 * Phase C automatic replies through CustomerCareService. Invariants: only `{ enabled }` crosses from the
 * renderer; the uploaded script is built in main from the saved setup (active facts only, no sources);
 * owner/manager switch, editors read; a role or account change during the call discards the answer;
 * saving the setup refreshes the server's script only while automatic replies are on.
 */
import { describe, expect, it, vi } from 'vitest';
import type {
  CustomerCareAuthority,
  CustomerCareAutoReplyState,
  CustomerCareSetup,
} from '../../shared/customer-care-types';
import { CustomerCareService, type CustomerCareSafeStorage } from './customer-care-service';
import type { CareAutoReplyGateway, CareAutoReplyScript, CareFacebookResult } from './care-facebook-client';
import { buildCareAutoReplyScript, parseCareAutoReplyInput } from './care-auto-reply';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const OWNER: CustomerCareAuthority = { identityId: 'user-aaaa-1111', workspaceId: WORKSPACE, role: 'owner' };
const as = (role: CustomerCareAuthority['role']): CustomerCareAuthority => ({ ...OWNER, role });
const NOW = new Date('2026-11-18T10:00:00.000Z');
const ISO = '2026-11-18T09:00:00.000Z';

const STATE: CustomerCareAutoReplyState = {
  enabled: true,
  enabledAt: ISO,
  available: true,
  scriptUpdatedAt: ISO,
  factCount: 1,
  sentLast24h: 0,
  lastSentAt: null,
  stoppedLast24h: 0,
  lastProblem: null,
};

const SETUP: CustomerCareSetup = {
  merchantName: 'Đồng Thờ Hồng Hưng',
  pageId: '',
  pageName: '',
  handoffTarget: 'Sale Hưng',
  facts: [
    { id: 'gia', topic: 'price', text: 'Bộ đồ thờ 60cm giá 12.500.000đ', source: 'Bảng giá 11/2026', approvedAt: '2026-11-01T00:00:00.000Z' },
    { id: 'het-han', topic: 'policy', text: 'Miễn phí ship tháng 10', source: 'KM', approvedAt: '2026-10-01T00:00:00.000Z', expiresAt: '2026-11-01T00:00:00.000Z' },
    { id: 'giao', topic: 'policy', text: 'Giao toàn quốc', source: 'Chính sách', approvedAt: '2026-11-01T00:00:00.000Z', expiresAt: '2026-12-31T00:00:00.000Z' },
  ],
};

/** What a save accepts: every fact still valid at save time. */
const SAVED: CustomerCareSetup = { ...SETUP, facts: SETUP.facts.filter((fact) => fact.id !== "het-han") };

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

class FakeAutoReply implements CareAutoReplyGateway {
  readonly calls: unknown[][] = [];
  during: () => void = () => {};
  getResult: CareFacebookResult<CustomerCareAutoReplyState | null> = { ok: true, value: STATE };
  setResult: CareFacebookResult<CustomerCareAutoReplyState> = { ok: true, value: STATE };
  async getAutoReply(workspaceId: string) { this.calls.push(['get', workspaceId]); this.during(); return this.getResult; }
  async setAutoReply(workspaceId: string, enabled: boolean, script: CareAutoReplyScript | null) {
    this.calls.push(['set', workspaceId, enabled, script]); this.during(); return this.setResult;
  }
}

function fixture(options: { authority?: CustomerCareAuthority | null; autoReply?: FakeAutoReply | null } = {}) {
  const autoReply = options.autoReply === null ? undefined : options.autoReply ?? new FakeAutoReply();
  const state = { authority: ('authority' in options ? options.authority : OWNER) as CustomerCareAuthority | null };
  const service = new CustomerCareService({
    store: new MemorySettings(),
    crypto: storage,
    resolveAuthority: async () => state.authority,
    currentIdentityId: () => state.authority?.identityId ?? null,
    now: () => NOW,
    autoReply,
  });
  return { service, autoReply: autoReply as FakeAutoReply, switchTo: (next: CustomerCareAuthority | null) => { state.authority = next; } };
}

describe('Care automatic reply input and script', () => {
  it('accepts exactly { enabled: boolean }', () => {
    expect(parseCareAutoReplyInput({ enabled: true })).toEqual({ enabled: true });
    for (const input of [null, [], {}, { enabled: 'yes' }, { enabled: true, workspaceId: WORKSPACE }, { enabled: true, script: {} }]) {
      expect(parseCareAutoReplyInput(input)).toBeNull();
    }
  });

  it('uploads only facts valid now, without their sources', () => {
    expect(buildCareAutoReplyScript(SETUP, NOW)).toEqual({
      facts: [
        { id: 'gia', topic: 'price', text: 'Bộ đồ thờ 60cm giá 12.500.000đ', approvedAt: '2026-11-01T00:00:00.000Z', expiresAt: null },
        { id: 'giao', topic: 'policy', text: 'Giao toàn quốc', approvedAt: '2026-11-01T00:00:00.000Z', expiresAt: '2026-12-31T00:00:00.000Z' },
      ],
    });
    expect(JSON.stringify(buildCareAutoReplyScript(SETUP, NOW))).not.toContain('Bảng giá');
  });
});

describe('CustomerCareService automatic replies', () => {
  it('lets owner, manager and editor read the state; canManage only for owner/manager', async () => {
    for (const [role, canManage] of [['owner', true], ['manager', true], ['editor', false]] as const) {
      const { service } = fixture({ authority: as(role) });
      expect(await service.getAutoReply()).toEqual({ ok: true, workspaceId: WORKSPACE, autoReply: STATE, canManage });
    }
    for (const role of ['viewer', 'reviewer'] as const) {
      const { service, autoReply } = fixture({ authority: as(role) });
      expect(await service.getAutoReply()).toEqual({ ok: false, error: 'forbidden' });
      expect(autoReply.calls).toEqual([]);
    }
  });

  it('answers unsupported without the Phase C backend and auth when signed out', async () => {
    expect(await fixture({ autoReply: null }).service.getAutoReply()).toEqual({ ok: false, error: 'unsupported' });
    expect(await fixture({ authority: null }).service.getAutoReply()).toEqual({ ok: false, error: 'auth' });
  });

  it('turns on with the script built from the saved setup, never from the renderer', async () => {
    const { service, autoReply } = fixture();
    expect((await service.saveSetup(SAVED)).ok).toBe(true);
    autoReply.calls.length = 0;

    expect(await service.setAutoReply({ enabled: true })).toEqual({ ok: true, workspaceId: WORKSPACE, autoReply: STATE, canManage: true });
    expect(autoReply.calls).toEqual([['set', WORKSPACE, true, buildCareAutoReplyScript(SAVED, NOW)]]);
  });

  it('refuses to turn on without a saved setup, and lets editors switch nothing', async () => {
    const first = fixture();
    expect(await first.service.setAutoReply({ enabled: true })).toEqual({ ok: false, error: 'setup_required' });
    expect(first.autoReply.calls).toEqual([]);

    const editor = fixture({ authority: as('editor') });
    expect(await editor.service.setAutoReply({ enabled: false })).toEqual({ ok: false, error: 'forbidden' });
    expect(await fixture().service.setAutoReply({ enabled: 'on' })).toEqual({ ok: false, error: 'invalid_input' });
  });

  it('turns off without uploading anything', async () => {
    const { service, autoReply } = fixture();
    autoReply.setResult = { ok: true, value: { ...STATE, enabled: false, enabledAt: null } };
    expect((await service.setAutoReply({ enabled: false })).ok).toBe(true);
    expect(autoReply.calls).toEqual([['set', WORKSPACE, false, null]]);
  });

  it('discards an answer when the account or role changed during the call', async () => {
    const { service, autoReply, switchTo } = fixture();
    autoReply.during = () => switchTo(as('editor'));
    expect(await service.setAutoReply({ enabled: false })).toEqual({ ok: false, error: 'access_changed' });
  });

  it('passes a bounded server refusal through', async () => {
    const { service, autoReply } = fixture();
    await service.saveSetup(SAVED);
    autoReply.setResult = { ok: false, error: 'rejected', reason: 'inbox_off' };
    expect(await service.setAutoReply({ enabled: true })).toEqual({ ok: false, error: 'rejected', reason: 'inbox_off' });
  });

  it('refreshes the server script after a save while automatic replies are on', async () => {
    const { service, autoReply } = fixture();
    const saved = await service.saveSetup(SAVED);
    expect(saved).toEqual(expect.objectContaining({ ok: true, autoReplyScript: 'updated' }));
    expect(autoReply.calls).toEqual([
      ['get', WORKSPACE],
      ['set', WORKSPACE, true, buildCareAutoReplyScript(SAVED, NOW)],
    ]);
  });

  it('does not upload on save while automatic replies are off, and reports a failed refresh', async () => {
    const off = fixture();
    off.autoReply.getResult = { ok: true, value: { ...STATE, enabled: false, enabledAt: null } };
    const saved = await off.service.saveSetup(SAVED);
    expect(saved.ok).toBe(true);
    expect(saved).not.toHaveProperty('autoReplyScript');
    expect(off.autoReply.calls).toEqual([['get', WORKSPACE]]);

    const failing = fixture();
    failing.autoReply.setResult = { ok: false, error: 'unavailable' };
    expect(await failing.service.saveSetup(SAVED)).toEqual(expect.objectContaining({ ok: true, autoReplyScript: 'failed' }));

    const throwing = fixture();
    throwing.autoReply.getAutoReply = vi.fn(async () => { throw new Error('network'); });
    const unknown = await throwing.service.saveSetup(SAVED);
    expect(unknown.ok).toBe(true);
    expect(unknown).not.toHaveProperty('autoReplyScript');

    const oldServer = fixture();
    oldServer.autoReply.getResult = { ok: false, error: 'unsupported' };
    expect(await oldServer.service.saveSetup(SAVED)).not.toHaveProperty('autoReplyScript');
  });
});
