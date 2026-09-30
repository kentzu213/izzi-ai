import { beforeEach, describe, expect, it, vi } from 'vitest';

const handlers = new Map<string, (...args: any[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: any[]) => unknown) => {
      handlers.set(channel, handler);
    },
  },
}));

import {
  LEGACY_GATEWAY_SESSION_TYPE,
  gatewaySessionRowId,
  gatewaySessionScope,
  registerGatewaySessionIpc,
} from './gateway-session-ipc';

// Mirrors user_data: upsert by id (overwrites type/data), list by type.
function fakeStore() {
  const rows = new Map<string, { type: string; data: object }>();
  return {
    rows,
    getUserData: vi.fn((type: string) => [...rows.values()].filter((r) => r.type === type).map((r) => r.data)),
    cacheUserData: vi.fn((id: string, type: string, data: object) => {
      rows.set(id, { type, data });
    }),
    deleteUserData: vi.fn((id: string) => {
      rows.delete(id);
    }),
    getUserDataType: vi.fn((id: string) => rows.get(id)?.type ?? null),
  };
}

const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args);

let store: ReturnType<typeof fakeStore>;
let currentUser: string | null;

beforeEach(() => {
  handlers.clear();
  store = fakeStore();
  currentUser = 'user-a';
  registerGatewaySessionIpc({ store, currentUserId: () => currentUser });
});

describe('gateway session IPC account scoping', () => {
  it('keeps the same session id isolated across accounts', () => {
    call('gatewaySessions:save', 'user-a', { id: 's1', content: 'A' });
    currentUser = 'user-b';
    call('gatewaySessions:save', 'user-b', { id: 's1', content: 'B' });

    expect(call('gatewaySessions:list', 'user-b')).toEqual([{ id: 's1', content: 'B' }]);
    currentUser = 'user-a';
    expect(call('gatewaySessions:list', 'user-a')).toEqual([{ id: 's1', content: 'A' }]);
    expect(store.rows.size).toBe(2);
  });

  it('moves legacy bare gateway_session rows to the first trusted account that lists', () => {
    store.rows.set('s1', { type: LEGACY_GATEWAY_SESSION_TYPE, data: { id: 's1', content: 'legacy' } });

    expect(call('gatewaySessions:list', 'user-a')).toEqual([{ id: 's1', content: 'legacy' }]);

    expect(store.rows.has('s1')).toBe(false);
    expect(store.rows.get(gatewaySessionRowId('user-a', 's1'))).toEqual({
      type: gatewaySessionScope('user-a'),
      data: { id: 's1', content: 'legacy' },
    });
    currentUser = 'user-b';
    expect(call('gatewaySessions:list', 'user-b')).toEqual([]);
  });

  it.each([
    ['signed out', null, 'user-a'],
    ['mismatched owner', 'user-b', 'user-a'],
  ])('leaves legacy rows untouched when %s', (_label, user, claimed) => {
    currentUser = user;
    store.rows.set('s1', { type: LEGACY_GATEWAY_SESSION_TYPE, data: { id: 's1' } });

    expect(call('gatewaySessions:list', claimed)).toEqual([]);

    expect(store.rows.get('s1')).toEqual({ type: LEGACY_GATEWAY_SESSION_TYPE, data: { id: 's1' } });
    expect(store.cacheUserData).not.toHaveBeenCalled();
  });

  it('skips a legacy row whose stored id differs from its session id', () => {
    store.rows.set('row-x', { type: LEGACY_GATEWAY_SESSION_TYPE, data: { id: 's1' } });

    expect(call('gatewaySessions:list', 'user-a')).toEqual([]);

    expect(store.rows.get('row-x')).toEqual({ type: LEGACY_GATEWAY_SESSION_TYPE, data: { id: 's1' } });
    expect(store.cacheUserData).not.toHaveBeenCalled();
  });

  it('never overwrites an existing scoped row with a legacy copy', () => {
    call('gatewaySessions:save', 'user-a', { id: 's1', content: 'current' });
    store.rows.set('s1', { type: LEGACY_GATEWAY_SESSION_TYPE, data: { id: 's1', content: 'legacy' } });

    expect(call('gatewaySessions:list', 'user-a')).toEqual([{ id: 's1', content: 'current' }]);

    expect(store.rows.get('s1')?.type).toBe(LEGACY_GATEWAY_SESSION_TYPE);
  });

  it('fails closed when a legacy row already uses the scoped row id', () => {
    const rowId = gatewaySessionRowId('user-a', 's1');
    const legacy = { type: LEGACY_GATEWAY_SESSION_TYPE, data: { id: rowId, content: 'legacy' } };
    store.rows.set(rowId, legacy);

    expect(call('gatewaySessions:save', 'user-a', { id: 's1', content: 'A' })).toEqual({ ok: false });
    expect(call('gatewaySessions:delete', 'user-a', 's1')).toEqual({ ok: false });

    expect(store.rows.get(rowId)).toEqual(legacy);
    expect(store.cacheUserData).not.toHaveBeenCalled();
    expect(store.deleteUserData).not.toHaveBeenCalled();
    expect(call('gatewaySessions:list', 'user-a')).toEqual([]);
  });

  it('fails closed when a row of any other type already uses the scoped row id', () => {
    const rowId = gatewaySessionRowId('user-a', 's1');
    store.rows.set(rowId, { type: 'budget_entry', data: { id: rowId } });

    expect(call('gatewaySessions:save', 'user-a', { id: 's1' })).toEqual({ ok: false });
    expect(call('gatewaySessions:delete', 'user-a', 's1')).toEqual({ ok: false });

    expect(store.rows.get(rowId)).toEqual({ type: 'budget_entry', data: { id: rowId } });
  });

  it('still overwrites and deletes its own scoped row', () => {
    const rowId = gatewaySessionRowId('user-a', 's1');
    expect(call('gatewaySessions:save', 'user-a', { id: 's1', v: 1 })).toEqual({ ok: true });
    expect(call('gatewaySessions:save', 'user-a', { id: 's1', v: 2 })).toEqual({ ok: true });
    expect(store.rows.get(rowId)?.data).toEqual({ id: 's1', v: 2 });

    expect(call('gatewaySessions:delete', 'user-a', 's1')).toEqual({ ok: true });
    expect(store.rows.has(rowId)).toBe(false);
  });

  it('fails closed on a late save after logout', () => {
    currentUser = null;

    expect(call('gatewaySessions:save', 'user-a', { id: 's1' })).toEqual({ ok: false });
    expect(call('gatewaySessions:list', 'user-a')).toEqual([]);
    expect(store.cacheUserData).not.toHaveBeenCalled();
  });

  it('fails closed on a stale save from the previous account after a switch', () => {
    currentUser = 'user-b';

    expect(call('gatewaySessions:save', 'user-a', { id: 's1' })).toEqual({ ok: false });
    expect(call('gatewaySessions:list', 'user-a')).toEqual([]);
    expect(store.cacheUserData).not.toHaveBeenCalled();
  });

  it.each([
    ['missing owner', undefined],
    ['null owner', null],
    ['non-string owner', 42],
    ['other owner', 'user-b'],
  ])('rejects a %s claimed by the renderer', (_label, claimed) => {
    call('gatewaySessions:save', 'user-a', { id: 's1' });

    expect(call('gatewaySessions:list', claimed)).toEqual([]);
    expect(call('gatewaySessions:save', claimed, { id: 's2' })).toEqual({ ok: false });
    expect(call('gatewaySessions:delete', claimed, 's1')).toEqual({ ok: false });
    expect(store.rows.size).toBe(1);
  });

  it('deletes only the current owner row', () => {
    call('gatewaySessions:save', 'user-a', { id: 's1' });
    currentUser = 'user-b';
    call('gatewaySessions:save', 'user-b', { id: 's1' });

    expect(call('gatewaySessions:delete', 'user-b', 's1')).toEqual({ ok: true });

    expect(store.rows.has(gatewaySessionRowId('user-b', 's1'))).toBe(false);
    expect(store.rows.has(gatewaySessionRowId('user-a', 's1'))).toBe(true);
  });

  it('rejects sessions without a valid id', () => {
    expect(call('gatewaySessions:save', 'user-a', null)).toEqual({ ok: false });
    expect(call('gatewaySessions:save', 'user-a', { id: '' })).toEqual({ ok: false });
    expect(call('gatewaySessions:save', 'user-a', { id: 'x'.repeat(201) })).toEqual({ ok: false });
    expect(call('gatewaySessions:delete', 'user-a', '')).toEqual({ ok: false });
    expect(store.cacheUserData).not.toHaveBeenCalled();
    expect(store.deleteUserData).not.toHaveBeenCalled();
  });

  it('keeps row ids unambiguous when an owner contains the separator', () => {
    expect(gatewaySessionRowId('a', 'b:c')).not.toBe(gatewaySessionRowId('a:b', 'c'));
    expect(gatewaySessionScope('a:b')).not.toBe(gatewaySessionScope('a'));
  });
});
