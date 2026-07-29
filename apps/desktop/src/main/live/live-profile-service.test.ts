import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LiveProfileConflictError } from '../../shared/live-profile';
import { LiveProfileFileService } from './live-profile-service';

const scope = { workspaceId: 'personal', ownerId: 'owner-7' };
const at = '2026-07-29T08:00:00.000Z';
const tempRoots: string[] = [];

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'izzi-live-profile-'));
  tempRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('LiveProfileFileService', () => {
  it('initializes, updates with optimistic revision, and preserves surrounding Markdown', async () => {
    const rootDir = await tempRoot();
    const service = new LiveProfileFileService({ rootDir, scope, documentRef: 'Live.md' });
    const created = await service.initialize({
      now: at,
      defaults: [{ id: 'tone', kind: 'preference', key: 'tone', value: 'Concise.' }],
    });
    const customized = (await readFile(service.filePath, 'utf8')).replace(
      '# Live\n',
      '# Live\n\n## Notes\n\nPreserve this paragraph.\n',
    );
    await writeFile(service.filePath, customized, 'utf8');

    const updated = await service.applyUserDirective({
      expectedRevision: 1,
      actor: { kind: 'user', id: scope.ownerId },
      id: 'tone-user',
      kind: 'preference',
      key: 'tone',
      value: 'Concise with examples.',
      now: '2026-07-29T08:01:00.000Z',
    });

    expect(created.revision).toBe(1);
    expect(updated.revision).toBe(2);
    expect(await readFile(service.filePath, 'utf8')).toContain(
      '## Notes\n\nPreserve this paragraph.',
    );
    await expect(
      service.applyUserDirective({
        expectedRevision: 1,
        actor: { kind: 'user', id: scope.ownerId },
        id: 'stale',
        kind: 'rule',
        key: 'stale',
        value: 'Must fail.',
        now: '2026-07-29T08:02:00.000Z',
      }),
    ).rejects.toBeInstanceOf(LiveProfileConflictError);
  });

  it('rejects traversal and raw secrets in the persisted Markdown', async () => {
    const rootDir = await tempRoot();
    expect(
      () => new LiveProfileFileService({ rootDir, scope, documentRef: '../Live.md' }),
    ).toThrow();

    const service = new LiveProfileFileService({ rootDir, scope, documentRef: 'Live.md' });
    await service.initialize({ now: at });
    const unsafe = (await readFile(service.filePath, 'utf8')).replace(
      '# Live',
      '# Live\n\nTemporary: sk-example12345678901234567890',
    );
    await writeFile(service.filePath, unsafe, 'utf8');

    await expect(service.read()).rejects.toThrow(/credential-shaped/i);
  });

  it('fails closed when an existing Live.md belongs to another scope', async () => {
    const rootDir = await tempRoot();
    const foreign = new LiveProfileFileService({
      rootDir,
      scope: { workspaceId: 'other', ownerId: scope.ownerId },
      documentRef: 'Live.md',
    });
    await foreign.initialize({ now: at });

    const local = new LiveProfileFileService({ rootDir, scope, documentRef: 'Live.md' });

    await expect(local.read()).rejects.toThrow(/requested workspace and owner/i);
  });

  it('serializes competing writes so only one expected revision can win', async () => {
    const rootDir = await tempRoot();
    const service = new LiveProfileFileService({ rootDir, scope, documentRef: 'Live.md' });
    await service.initialize({ now: at });

    const write = (id: string) =>
      service.applyUserDirective({
        expectedRevision: 1,
        actor: { kind: 'user', id: scope.ownerId },
        id,
        kind: 'preference',
        key: id,
        value: `Value for ${id}.`,
        now: '2026-07-29T08:01:00.000Z',
      });
    const results = await Promise.allSettled([write('first'), write('second')]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect((await service.read())?.revision).toBe(2);
  });
});
