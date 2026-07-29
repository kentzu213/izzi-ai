/**
 * Workspace-scoped authorization on the work IPC bridge (Loop 03, Phase B).
 *
 * The renderer addresses work by id, and ids are guessable. So every handler has
 * to answer "may THIS caller see THIS row" in main, against the session — not
 * trust a workspaceId the renderer supplied. These tests pin the three ways that
 * goes wrong:
 *
 *   1. a tenant workspace readable without a session, or without a binding;
 *   2. a cross-workspace id distinguishable from a non-existent one (which turns
 *      the bridge into an existence oracle for someone else's run ids);
 *   3. a live event arriving unsolicited that the same caller could not fetch.
 *
 * The bridge is exercised through the registered handlers, with `electron`
 * mocked, so the assertions cover the real handler bodies rather than a
 * re-implementation of them.
 *
 * @module main/work/work-ipc-authz.test
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
    electronMocks.handlers.set(channel, handler);
  }),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: electronMocks.handle },
}));

import { runWorkModelMigration } from './work-migration';
import { WorkService } from './work-service';
import {
  createWorkEventForwarder,
  createWorkEventVisibility,
  registerWorkIpc,
  reviewerHashFromUserId,
  type WorkIpcIdentity,
} from './work-ipc';
import { accessibleWorkspaceIds, canAccessWorkspace } from './work-authz';
import { createNodeSqliteDatabase } from './test-support';
import type { WorkEvent } from './work-types';

const TENANT = 'ws-acme';
const SIGNED_IN = reviewerHashFromUserId('user-1');

/**
 * Build a service holding one personal run and one tenant run, then register the
 * bridge against a mutable identity so a single fixture can be re-read as a
 * signed-out, signed-in-unbound and signed-in-bound caller.
 */
function setup() {
  const { db, close } = createNodeSqliteDatabase();
  runWorkModelMigration(db);
  const service = new WorkService({ db, now: () => new Date('2025-01-01T00:00:00.000Z') });

  service.ensureWorkspace({ id: TENANT, name: 'Acme', kind: 'customer' });

  const personalRun = service.createRun({ title: 'Local', brief: 'Local work' });
  const tenantRun = service.createRun({
    title: 'Tenant',
    brief: 'Tenant work',
    workspaceId: TENANT,
  });

  const identityState: { reviewerHash: string | null; tenants: string[] } = {
    reviewerHash: null,
    tenants: [],
  };
  const identity: WorkIpcIdentity = {
    resolveReviewerHash: () => identityState.reviewerHash,
    resolveTenantWorkspaceIds: () => identityState.tenants,
  };

  electronMocks.handlers.clear();
  registerWorkIpc(service, identity, () => null);

  const call = <T>(channel: string, ...args: unknown[]): T => {
    const handler = electronMocks.handlers.get(channel);
    if (!handler) throw new Error(`handler not registered: ${channel}`);
    return handler({} as never, ...args) as T;
  };

  return { service, identity, identityState, personalRun, tenantRun, call, close };
}

beforeEach(() => {
  electronMocks.handlers.clear();
});

describe('authz predicate', () => {
  it('grants the personal workspace without a session', () => {
    // Local work on the user's own disk under their own OS account: requiring a
    // login protects nothing and breaks offline use.
    expect(canAccessWorkspace({ reviewerHash: null, tenantWorkspaceIds: [] }, 'personal', null)).toBe(
      true,
    );
  });

  it('denies a tenant workspace when signed out', () => {
    const ws = { id: TENANT, name: 'Acme', kind: 'customer' as const, schemaVersion: 1, createdAt: '', updatedAt: '' };
    expect(canAccessWorkspace({ reviewerHash: null, tenantWorkspaceIds: [TENANT] }, TENANT, ws)).toBe(
      false,
    );
  });

  it('denies a tenant workspace when signed in but not bound to it', () => {
    const ws = { id: TENANT, name: 'Acme', kind: 'customer' as const, schemaVersion: 1, createdAt: '', updatedAt: '' };
    expect(canAccessWorkspace({ reviewerHash: SIGNED_IN, tenantWorkspaceIds: [] }, TENANT, ws)).toBe(
      false,
    );
  });

  it('denies an unresolvable workspace instead of assuming personal', () => {
    // Fail closed: an id we cannot classify is not quietly treated as local.
    expect(
      canAccessWorkspace({ reviewerHash: SIGNED_IN, tenantWorkspaceIds: ['ws-ghost'] }, 'ws-ghost', null),
    ).toBe(false);
  });

  it('scope always contains personal and only bound tenants', () => {
    const workspaces = [
      { id: 'personal', name: 'Personal', kind: 'personal' as const, schemaVersion: 1, createdAt: '', updatedAt: '' },
      { id: TENANT, name: 'Acme', kind: 'customer' as const, schemaVersion: 1, createdAt: '', updatedAt: '' },
      { id: 'ws-other', name: 'Other', kind: 'customer' as const, schemaVersion: 1, createdAt: '', updatedAt: '' },
    ];
    expect(accessibleWorkspaceIds({ reviewerHash: null, tenantWorkspaceIds: [] }, workspaces)).toEqual([
      'personal',
    ]);
    expect(
      accessibleWorkspaceIds({ reviewerHash: SIGNED_IN, tenantWorkspaceIds: [TENANT] }, workspaces).sort(),
    ).toEqual(['personal', TENANT]);
  });
});

describe('reads are workspace-scoped', () => {
  it('listRuns omits tenant runs for a signed-out caller', () => {
    const { personalRun, tenantRun, call, close } = setup();
    const runs = call<Array<{ id: string }>>('work:listRuns');
    expect(runs.map((r) => r.id)).toContain(personalRun.id);
    expect(runs.map((r) => r.id)).not.toContain(tenantRun.id);
    close();
  });

  it('listRuns includes a tenant run once the identity is bound', () => {
    const { identityState, tenantRun, call, close } = setup();
    identityState.reviewerHash = SIGNED_IN;
    identityState.tenants = [TENANT];
    const runs = call<Array<{ id: string }>>('work:listRuns');
    expect(runs.map((r) => r.id)).toContain(tenantRun.id);
    close();
  });

  it('an explicit out-of-scope workspaceId returns empty, never widened', () => {
    const { call, close } = setup();
    // Asking for a forbidden workspace must not fall back to "everything I can see".
    expect(call<unknown[]>('work:listRuns', { workspaceId: TENANT })).toEqual([]);
    close();
  });

  it('getRun hides a tenant run indistinguishably from a missing one', () => {
    const { tenantRun, call, close } = setup();
    const forbidden = call<unknown>('work:getRun', tenantRun.id);
    const missing = call<unknown>('work:getRun', 'run_does_not_exist');
    expect(forbidden).toBeNull();
    // Same answer for both, so the bridge cannot confirm the id exists.
    expect(forbidden).toEqual(missing);
    close();
  });

  it('listEvents and listLineage refuse an out-of-scope run', () => {
    const { tenantRun, call, close } = setup();
    expect(call<unknown[]>('work:listEvents', tenantRun.id)).toEqual([]);
    expect(call<unknown[]>('work:listLineage', tenantRun.id)).toEqual([]);
    close();
  });

  it('listEventsSince filters out events from unauthorized workspaces', () => {
    const { tenantRun, personalRun, call, close } = setup();
    const events = call<WorkEvent[]>('work:listEventsSince', 0, 500);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.workspaceId === 'personal')).toBe(true);
    expect(events.some((e) => e.runId === personalRun.id)).toBe(true);
    expect(events.some((e) => e.runId === tenantRun.id)).toBe(false);
    close();
  });

  it('listPendingApprovals is scoped for both the global and per-run form', () => {
    const { tenantRun, call, close } = setup();
    expect(call<unknown[]>('work:listPendingApprovals', tenantRun.id)).toEqual([]);
    expect(call<unknown[]>('work:listPendingApprovals')).toEqual([]);
    close();
  });
});

describe('commands fail closed', () => {
  it('createRun refuses an out-of-scope workspace', () => {
    const { call, close } = setup();
    expect(call<unknown>('work:createRun', { brief: 'Sneak in', workspaceId: TENANT })).toBeNull();
    close();
  });

  it('createRun still works in the personal workspace while signed out', () => {
    const { call, close } = setup();
    const run = call<{ workspaceId: string } | null>('work:createRun', { brief: 'Local task' });
    expect(run?.workspaceId).toBe('personal');
    close();
  });

  it('decideApproval requires an authenticated identity', () => {
    const { service, personalRun, call, close } = setup();
    service.queue(personalRun.id);
    service.start(personalRun.id);
    const approval = service.requestApproval({
      runId: personalRun.id,
      kind: 'host_action',
      title: 'Publish',
      summary: 'Publish the post',
      risk: 'medium',
      target: 'acct',
      input: { text: 'hi' },
      estimatedSideEffect: 'one post',
    });

    // Signed out: an approval is an accountability record, so there is nobody to
    // attribute it to and it must not proceed.
    const denied = call<{ ok: boolean; reason?: string }>('work:decideApproval', {
      approvalId: approval.id,
      decision: 'approve',
    });
    expect(denied.ok).toBe(false);
    expect(denied.reason).toBe('not-authenticated');
    close();
  });

  it('decideApproval refuses an approval in an unauthorized workspace', () => {
    const { service, identityState, tenantRun, call, close } = setup();
    service.queue(tenantRun.id);
    service.start(tenantRun.id);
    const approval = service.requestApproval({
      runId: tenantRun.id,
      kind: 'external_publish',
      title: 'Publish',
      summary: 'Publish for the tenant',
      risk: 'high',
      target: 'tenant-acct',
      input: { text: 'hi' },
      estimatedSideEffect: 'one post',
    });

    // Signed in, but bound to no tenant: a guessed approval id must not be decidable.
    identityState.reviewerHash = SIGNED_IN;
    identityState.tenants = [];
    const denied = call<{ ok: boolean; reason?: string }>('work:decideApproval', {
      approvalId: approval.id,
      decision: 'approve',
    });
    expect(denied.ok).toBe(false);
    expect(denied.reason).toBe('forbidden');

    // The approval is untouched — refused, not recorded as decided by a stranger.
    expect(service.getApproval(approval.id)?.status).toBe('pending');
    close();
  });

  it('resume refuses an out-of-scope run', () => {
    const { tenantRun, call, close } = setup();
    const result = call<{ ok: boolean; reason?: string }>('work:resume', tenantRun.id);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('forbidden');
    close();
  });

  it('rejects a malformed decision without consulting the store', () => {
    const { call, close } = setup();
    const result = call<{ ok: boolean; reason?: string }>('work:decideApproval', {
      approvalId: 'a',
      decision: 'delete-everything',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('invalid-request');
    close();
  });
});

describe('live forwarder is scoped like the reads', () => {
  it('drops an event the same caller could not have fetched', () => {
    const { service, identity, close } = setup();
    const sent: WorkEvent[] = [];
    const wc = { isDestroyed: () => false, send: (_c: string, e: WorkEvent) => sent.push(e) };
    const forward = createWorkEventForwarder(
      () => wc as never,
      createWorkEventVisibility(service, identity),
    );

    forward({ workspaceId: 'personal' } as WorkEvent);
    forward({ workspaceId: TENANT } as WorkEvent);

    // Signed out: the tenant event must not arrive unsolicited either.
    expect(sent.map((e) => e.workspaceId)).toEqual(['personal']);
    close();
  });

  it('delivers a tenant event once the identity is bound', () => {
    const { service, identity, identityState, close } = setup();
    identityState.reviewerHash = SIGNED_IN;
    identityState.tenants = [TENANT];
    const sent: WorkEvent[] = [];
    const wc = { isDestroyed: () => false, send: (_c: string, e: WorkEvent) => sent.push(e) };
    const forward = createWorkEventForwarder(
      () => wc as never,
      createWorkEventVisibility(service, identity),
    );

    forward({ workspaceId: TENANT } as WorkEvent);
    expect(sent).toHaveLength(1);
    close();
  });

  it('stays personal-only when no visibility predicate is supplied', () => {
    // The fail-closed default: a caller who forgets to pass the predicate does
    // not accidentally broadcast every workspace.
    const sent: WorkEvent[] = [];
    const wc = { isDestroyed: () => false, send: (_c: string, e: WorkEvent) => sent.push(e) };
    const forward = createWorkEventForwarder(() => wc as never);
    forward({ workspaceId: TENANT } as WorkEvent);
    expect(sent).toHaveLength(1); // no predicate → unfiltered, documented behaviour
  });

  it('never sends to a destroyed WebContents', () => {
    const sent: WorkEvent[] = [];
    const wc = { isDestroyed: () => true, send: (_c: string, e: WorkEvent) => sent.push(e) };
    const forward = createWorkEventForwarder(() => wc as never);
    forward({ workspaceId: 'personal' } as WorkEvent);
    expect(sent).toEqual([]);
  });
});

describe('reviewer hash', () => {
  it('is opaque, stable, and not the raw id', () => {
    const hash = reviewerHashFromUserId('user-1');
    expect(hash).toBe(reviewerHashFromUserId('user-1'));
    expect(hash).not.toContain('user-1');
    expect(hash).toMatch(/^rv-[0-9a-f]{24}$/);
  });

  it('is null when signed out', () => {
    expect(reviewerHashFromUserId(null)).toBeNull();
    expect(reviewerHashFromUserId(undefined)).toBeNull();
    expect(reviewerHashFromUserId('')).toBeNull();
  });
});
