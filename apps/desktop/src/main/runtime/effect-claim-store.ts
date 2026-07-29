import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { RuntimeEffectReceipt } from '../../shared/runtime';

export type EffectClaimState = 'claimed' | 'effected' | 'aborted' | 'uncertain';

export interface EffectClaimKey {
  readonly approvalId: string;
  readonly actionHash: string;
  readonly idempotencyKey: string;
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly runId: string;
}
export interface EffectClaimRecord extends EffectClaimKey {
  readonly schemaVersion: 1;
  readonly claimId: string;
  readonly state: EffectClaimState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly receipt?: RuntimeEffectReceipt;
  readonly reason?: string;
}

export interface EffectClaimStore {
  claim(key: EffectClaimKey): Promise<{ created: boolean; record: EffectClaimRecord }>;
  markEffected(claimId: string, receipt: RuntimeEffectReceipt): Promise<EffectClaimRecord>;
  markAborted(claimId: string, reason: string): Promise<EffectClaimRecord>;
  markUncertain(claimId: string, reason: string): Promise<EffectClaimRecord>;
  read(claimId: string): Promise<EffectClaimRecord | null>;
}

function claimIdFor(key: EffectClaimKey): string {
  const canonical = JSON.stringify({
    approvalId: key.approvalId,
    actionHash: key.actionHash,
    idempotencyKey: key.idempotencyKey,
    tenantId: key.tenantId,
    userId: key.userId,
    workspaceId: key.workspaceId,
    runId: key.runId,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

function sameKey(record: EffectClaimRecord, key: EffectClaimKey): boolean {
  return (
    record.approvalId === key.approvalId
    && record.actionHash === key.actionHash
    && record.idempotencyKey === key.idempotencyKey
    && record.tenantId === key.tenantId
    && record.userId === key.userId
    && record.workspaceId === key.workspaceId
    && record.runId === key.runId
  );
}

export class FileEffectClaimStore implements EffectClaimStore {
  constructor(
    private readonly root: string,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async claim(key: EffectClaimKey): Promise<{ created: boolean; record: EffectClaimRecord }> {
    await fs.promises.mkdir(this.root, { recursive: true, mode: 0o700 });
    const claimId = claimIdFor(key);
    const file = this.fileFor(claimId);
    const now = this.clock().toISOString();
    const record: EffectClaimRecord = {
      schemaVersion: 1,
      claimId,
      state: 'claimed',
      ...key,
      createdAt: now,
      updatedAt: now,
    };
    try {
      const handle = await fs.promises.open(file, 'wx', 0o600);
      try {
        await handle.writeFile(JSON.stringify(record), 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await this.syncRoot();
      return { created: true, record };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const existing = await this.require(claimId);
      if (!sameKey(existing, key)) throw new Error('Effect claim hash collision or scope mismatch');
      return { created: false, record: existing };
    }
  }

  read(claimId: string): Promise<EffectClaimRecord | null> {
    return this.readInternal(claimId);
  }

  markEffected(claimId: string, receipt: RuntimeEffectReceipt): Promise<EffectClaimRecord> {
    return this.replace(claimId, 'effected', { receipt });
  }

  markAborted(claimId: string, reason: string): Promise<EffectClaimRecord> {
    return this.replace(claimId, 'aborted', { reason });
  }

  markUncertain(claimId: string, reason: string): Promise<EffectClaimRecord> {
    return this.replace(claimId, 'uncertain', { reason });
  }

  private fileFor(claimId: string): string {
    if (!/^[a-f0-9]{64}$/.test(claimId)) throw new Error('Invalid effect claim id');
    return path.join(this.root, `${claimId}.json`);
  }

  private async readInternal(claimId: string): Promise<EffectClaimRecord | null> {
    try {
      const parsed = JSON.parse(await fs.promises.readFile(this.fileFor(claimId), 'utf8')) as EffectClaimRecord;
      if (parsed.schemaVersion !== 1 || parsed.claimId !== claimId) {
        throw new Error('Invalid effect claim record');
      }
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  private async require(claimId: string): Promise<EffectClaimRecord> {
    const record = await this.readInternal(claimId);
    if (!record) throw new Error('Effect claim not found');
    return record;
  }

  private async replace(
    claimId: string,
    state: EffectClaimState,
    patch: Pick<EffectClaimRecord, 'receipt'> | Pick<EffectClaimRecord, 'reason'>,
  ): Promise<EffectClaimRecord> {
    const current = await this.require(claimId);
    if (current.state === 'effected') {
      if (state === 'effected') return current;
      throw new Error('Effected claim is immutable');
    }
    const next: EffectClaimRecord = {
      ...current,
      ...patch,
      state,
      updatedAt: this.clock().toISOString(),
    };
    const file = this.fileFor(claimId);
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    const handle = await fs.promises.open(temp, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify(next), 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await fs.promises.rename(temp, file);
    await this.syncRoot();
    return next;
  }

  private async syncRoot(): Promise<void> {
    try {
      const handle = await fs.promises.open(this.root, 'r');
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch {
      // Directory fsync is not available on every Windows filesystem. File
      // fsync plus atomic rename remains the minimum fail-closed guarantee.
    }
  }
}
