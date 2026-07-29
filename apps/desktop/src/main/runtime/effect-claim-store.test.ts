import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RuntimeEffectReceipt } from '../../shared/runtime';
import { FileEffectClaimStore, type EffectClaimKey } from './effect-claim-store';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function makeStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'izzi-runtime-claims-'));
  roots.push(root);
  return { root, store: new FileEffectClaimStore(root, () => new Date('2026-07-29T00:00:00Z')) };
}

const key: EffectClaimKey = {
  approvalId: 'approval-1',
  actionHash: 'hash-1',
  idempotencyKey: 'effect-1',
  tenantId: 'tenant-1',
  userId: 'user-1',
  workspaceId: 'workspace-1',
  runId: 'run-1',
};

describe('FileEffectClaimStore', () => {
  it('allows only one atomic claim across concurrent callers', async () => {
    const { store } = makeStore();
    const results = await Promise.all([store.claim(key), store.claim(key), store.claim(key)]);
    expect(results.filter((item) => item.created)).toHaveLength(1);
    expect(new Set(results.map((item) => item.record.claimId)).size).toBe(1);
  });

  it('persists an effected receipt and returns it after restart', async () => {
    const { root, store } = makeStore();
    const claimed = await store.claim(key);
    const receipt: RuntimeEffectReceipt = {
      schemaVersion: 1,
      claimId: claimed.record.claimId,
      approvalId: key.approvalId,
      actionHash: key.actionHash,
      idempotencyKey: key.idempotencyKey,
      workspaceId: key.workspaceId,
      runId: key.runId,
      target: 'http://127.0.0.1:43111/submit',
      responseDigest: `sha256:${'a'.repeat(64)}`,
      externalActionPerformed: true,
      performedAt: '2026-07-29T00:00:00Z',
    };
    await store.markEffected(claimed.record.claimId, receipt);
    const restarted = new FileEffectClaimStore(root);
    expect((await restarted.claim(key)).record.receipt).toEqual(receipt);
    await expect(restarted.markAborted(claimed.record.claimId, 'late cancel')).rejects.toThrow(
      'immutable',
    );
  });

  it('binds a claim to tenant/user/workspace/run scope', async () => {
    const { store } = makeStore();
    await store.claim(key);
    const other = await store.claim({ ...key, workspaceId: 'workspace-2' });
    expect(other.record.claimId).not.toBe((await store.claim(key)).record.claimId);
  });
});
