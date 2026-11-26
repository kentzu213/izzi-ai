import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createNodeSqliteDatabase } from '../work/test-support';
import { WorkDb } from '../work/work-sqlite';
import {
  KnowledgeAuthorityError,
  KnowledgeStore,
  KnowledgeValidationError,
} from './knowledge-store';

const tempDirs: string[] = [];

function makeStore(nowIso = '2026-11-26T10:00:00.000Z') {
  const { db, close } = createNodeSqliteDatabase();
  const store = new KnowledgeStore(new WorkDb(db), () => new Date(nowIso));
  return { store, db, close };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('KnowledgeStore (Obsidian-grade selective filter)', () => {
  it('captures candidate records with deterministic dedup and blocks secrets/PII/credential URIs', () => {
    const { store, close } = makeStore();
    try {
      const r1 = store.capture({
        scope: 'project',
        workspaceId: 'izzi-ai',
        kind: 'decision',
        title: 'Use manifest SHA-256 for Vault sync',
        summary: 'Always verify file hash against .vault-manifest.json before cloud push.',
        topicKey: 'vault-sync',
        source: { type: 'user', uri: 'user://approval/1' },
        author: 'orchestrator',
        evidence: 'direct',
        confidence: 0.95,
      });

      expect(r1.state).toBe('candidate');
      expect(r1.sensitivity).toBe('local');

      // Idempotent duplicate capture returns the exact same record id.
      const r2 = store.capture({
        scope: 'project',
        workspaceId: 'izzi-ai',
        kind: 'decision',
        title: 'Use manifest SHA-256 for Vault sync',
        summary: 'Always verify file hash against .vault-manifest.json before cloud push.',
        topicKey: 'vault-sync',
        source: { type: 'user', uri: 'user://approval/1' },
        author: 'orchestrator',
        evidence: 'direct',
        confidence: 0.95,
      });
      expect(r2.id).toBe(r1.id);

      // Fail-closed on secret, email, Luhn card, and .env URI.
      expect(() =>
        store.capture({
          scope: 'project',
          workspaceId: 'izzi-ai',
          kind: 'fact',
          title: 'Key leak',
          summary: 'Token is sk-proj-1234567890abcdefghijklmno',
          topicKey: 'sec',
          source: { type: 'user', uri: 'user://1' },
          author: 'user',
          evidence: 'direct',
          confidence: 1,
        }),
      ).toThrow(KnowledgeValidationError);

      expect(() =>
        store.capture({
          scope: 'project',
          workspaceId: 'izzi-ai',
          kind: 'fact',
          title: 'Email leak',
          summary: 'Contact private@company.com directly',
          topicKey: 'pii',
          source: { type: 'user', uri: 'user://2' },
          author: 'user',
          evidence: 'direct',
          confidence: 1,
        }),
      ).toThrow(KnowledgeValidationError);

      expect(() =>
        store.capture({
          scope: 'project',
          workspaceId: 'izzi-ai',
          kind: 'fact',
          title: 'Env file',
          summary: 'Production settings live here',
          topicKey: 'env',
          source: { type: 'artifact', uri: '/repo/.env.production' },
          author: 'user',
          evidence: 'direct',
          confidence: 1,
        }),
      ).toThrow(KnowledgeValidationError);
    } finally {
      close();
    }
  });

  it('forbids agent self-promotion of inferences while allowing explicit user approval or verified artifact SHA-256', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'izzi-kn-'));
    tempDirs.push(dir);
    const artifact = path.join(dir, 'proof.txt');
    fs.writeFileSync(artifact, 'verified content v1', 'utf8');
    const sha256 = crypto.createHash('sha256').update('verified content v1').digest('hex');

    const { store, close } = makeStore();
    try {
      const inferred = store.capture({
        scope: 'project',
        workspaceId: 'izzi-ai',
        kind: 'lesson',
        title: 'Distilled inference lesson',
        summary: 'Agents must never auto-promote their own inferences.',
        topicKey: 'promotion-rule',
        source: { type: 'inference', uri: 'izzi://session/1' },
        author: 'orchestrator',
        evidence: 'derived',
        confidence: 0.7,
      });

      // Orchestrator cannot promote inference!
      expect(() =>
        store.promote({ id: inferred.id, reviewer: 'orchestrator', basis: 'user_instruction' }),
      ).toThrow(KnowledgeAuthorityError);

      // Explicit interactive user approval promotes & can opt-in to shareable.
      const promoted = store.promote({
        id: inferred.id,
        reviewer: 'user',
        basis: 'user_approval',
        sensitivity: 'shareable',
      });
      expect(promoted.state).toBe('active');
      expect(promoted.sensitivity).toBe('shareable');

      // Artifact with matching SHA-256 can be promoted by orchestrator, and becomes stale if modified.
      const verified = store.capture({
        scope: 'project',
        workspaceId: 'izzi-ai',
        kind: 'fact',
        title: 'Verified build artifact',
        summary: 'Matches proof.txt hash on disk.',
        topicKey: 'artifact-check',
        source: { type: 'artifact', uri: artifact, sha256 },
        author: 'builder',
        evidence: 'direct',
        confidence: 1,
      });
      const activeArtifact = store.promote({
        id: verified.id,
        reviewer: 'orchestrator',
        basis: 'verified_artifact',
      });
      expect(activeArtifact.state).toBe('active');
      expect(activeArtifact.sourceCurrent).toBe(true);

      // Mutate file on disk → sourceCurrent flips false and recall excludes it!
      fs.writeFileSync(artifact, 'modified content v2', 'utf8');
      const reloaded = store.get(verified.id)!;
      expect(reloaded.sourceCurrent).toBe(false);
      expect(store.recall({ workspaceId: 'izzi-ai', query: 'artifact' })).toEqual([]);
    } finally {
      close();
    }
  });

  it('detects same-topic conflicts, excludes them from recall until superseded, and supports FTS5 offline search', () => {
    const { store, db, close } = makeStore();
    try {
      const a = store.capture({
        scope: 'project',
        workspaceId: 'izzi-ai',
        kind: 'decision',
        title: 'Use local folder A',
        summary: 'Default vault directory is folder Alpha.',
        topicKey: 'vault-dir',
        source: { type: 'user', uri: 'user://1' },
        author: 'user',
        evidence: 'direct',
        confidence: 0.9,
      });
      const b = store.capture({
        scope: 'project',
        workspaceId: 'izzi-ai',
        kind: 'decision',
        title: 'Use local folder B',
        summary: 'Default vault directory is folder Beta.',
        topicKey: 'vault-dir',
        source: { type: 'user', uri: 'user://2' },
        author: 'user',
        evidence: 'direct',
        confidence: 0.9,
      });

      store.promote({ id: a.id, reviewer: 'user', basis: 'user_approval', sensitivity: 'shareable' });
      store.promote({ id: b.id, reviewer: 'user', basis: 'user_approval', sensitivity: 'shareable' });

      // Both active on same topicKey → conflict detected, excluded from recall & shareable export!
      expect(store.get(a.id)!.conflicts).toEqual([b.id]);
      expect(store.recall({ workspaceId: 'izzi-ai', query: 'vault' })).toEqual([]);
      expect(store.listShareableActive()).toEqual([]);

      // Supersede A with B → conflict resolved, B surfaces in recall & FTS5 search!
      store.supersede(a.id, b.id, 'user', 'User confirmed folder Beta');
      const recalled = store.recall({ workspaceId: 'izzi-ai', query: 'Beta' });
      expect(recalled.map((r) => r.id)).toEqual([b.id]);
      expect(store.listShareableActive().map((r) => r.id)).toEqual([b.id]);
      expect(store.search('Beta').map((r) => r.id)).toContain(b.id);

      // Append-only audit events trigger blocks UPDATE/DELETE.
      expect(() => db.exec(`DELETE FROM knowledge_events`)).toThrow(/append-only/);
      expect(() =>
        db.exec(`UPDATE knowledge_records SET title = 'tampered' WHERE id = '${b.id}'`),
      ).toThrow(/immutable/);
    } finally {
      close();
    }
  });
});
