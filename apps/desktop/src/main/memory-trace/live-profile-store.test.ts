import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { LiveProfileStore } from './live-profile-store';
import { mustStayLocal } from '../../shared/memory-trace/classification';

const scratch = mkdtempSync(join(tmpdir(), 'cmr224-'));
const NOW = '2026-08-05T09:30:00.000Z';
let counter = 0;

function freshStore(): LiveProfileStore {
  counter += 1;
  const directory = join(scratch, `case-${counter}`);
  return new LiveProfileStore({ directory, now: () => NOW });
}

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('CMR-224 LiveProfileStore', () => {
  it('reports absent before anything is written', () => {
    const store = freshStore();
    expect(store.read().status).toBe('absent');
    expect(store.read().profile).toBeNull();
  });

  it('creates the file from the template on ensure, then is idempotent', () => {
    const store = freshStore();
    const created = store.ensure();
    expect(created.status).toBe('ok');
    expect(created.profile?.revision).toBe(1);
    expect(created.profile?.body).toContain('# Live');

    const before = readFileSync(store.path, 'utf8');
    const again = store.ensure();
    expect(again.profile?.revision).toBe(1);
    expect(readFileSync(store.path, 'utf8')).toBe(before);
  });

  it('bumps the revision on each accepted write', () => {
    const store = freshStore();
    store.ensure();
    expect(store.write('first').profile?.revision).toBe(2);
    expect(store.write('second').profile?.revision).toBe(3);
    expect(store.read().profile?.body).toBe('second');
  });

  it('writes the file even when it did not exist yet', () => {
    const store = freshStore();
    const result = store.write('straight to content');
    expect(result.status).toBe('ok');
    expect(result.profile?.revision).toBe(1);
    expect(store.read().profile?.body).toBe('straight to content');
  });

  it('refuses to overwrite a file it cannot parse', () => {
    const store = freshStore();
    store.ensure();
    writeFileSync(store.path, 'the operator hand-broke the frontmatter', 'utf8');

    const result = store.write('replacement');
    expect(result.status).toBe('unreadable');
    expect(result.profile).toBeNull();
    // The operator's bytes survive untouched.
    expect(readFileSync(store.path, 'utf8')).toBe('the operator hand-broke the frontmatter');
  });

  it('leaves no temp file behind after a successful write', () => {
    const store = freshStore();
    store.ensure();
    store.write('content');
    expect(() => readFileSync(`${store.path}.tmp-${process.pid}`, 'utf8')).toThrow();
  });

  it('rejects a body over the size limit without touching the file', () => {
    const store = freshStore();
    store.ensure();
    const before = readFileSync(store.path, 'utf8');
    expect(store.write('x'.repeat(256_001)).status).toBe('rejected');
    expect(readFileSync(store.path, 'utf8')).toBe(before);
  });

  it('exposes the profile as a local-only trace unit with exact provenance', () => {
    const store = freshStore();
    store.ensure();
    store.write('Tôi muốn báo cáo ngắn, không dùng biệt ngữ.');

    const unit = store.asTraceUnit('workspace-local');
    expect(unit).not.toBeNull();
    expect(unit?.actor).toBe('user');
    expect(unit?.classification).toBe('live_profile');
    expect(mustStayLocal(unit!.classification)).toBe(true);
    expect(unit?.provenance.sourceKind).toBe('live_profile');
    expect(unit?.provenance.sourceId).toBe('Live.md#rev2');
    expect(unit?.provenance.boundaryId).toBe('workspace-local');
    expect(unit?.provenance.observedAt).toBe(NOW);
  });

  it('converts the exact saved revision even after the file changes again', () => {
    const store = freshStore();
    store.ensure();
    const firstWrite = store.write('first saved body');
    expect(firstWrite.status).toBe('ok');
    store.write('newer body');

    const unit = store.toTraceUnit(firstWrite.profile!, 'workspace-local');

    expect(unit?.text).toBe('first saved body');
    expect(unit?.provenance.sourceId).toBe('Live.md#rev2');
  });

  it('returns no trace unit when the profile is absent, unreadable, or empty', () => {
    const absent = freshStore();
    expect(absent.asTraceUnit('workspace-local')).toBeNull();

    const broken = freshStore();
    broken.ensure();
    writeFileSync(broken.path, 'not a live profile', 'utf8');
    expect(broken.asTraceUnit('workspace-local')).toBeNull();

    const blank = freshStore();
    blank.write('   \n  \n');
    expect(blank.asTraceUnit('workspace-local')).toBeNull();
  });

  it('reports unreadable rather than throwing when the path is a directory', () => {
    counter += 1;
    const directory = join(scratch, `dir-case-${counter}`);
    const store = new LiveProfileStore({ directory, now: () => NOW });
    // Make the target path itself a directory, so reads fail with EISDIR.
    mkdirSync(store.path, { recursive: true });
    expect(store.read().status).toBe('unreadable');
    expect(store.write('anything').status).toBe('unreadable');
  });
});
