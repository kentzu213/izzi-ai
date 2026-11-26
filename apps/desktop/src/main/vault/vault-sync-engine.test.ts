import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNodeSqliteDatabase } from '../work/test-support';
import { WorkDb } from '../work/work-sqlite';
import { KnowledgeStore } from '../knowledge/knowledge-store';
import { DistilledSessionCapturer } from '../agents/session-distiller';
import { VaultSyncEngine, type VaultCloudClient } from './vault-sync-engine';
import type { GraphNode } from '../../shared/graph-types';

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    fs.rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

function makeFixture(initialNodes: GraphNode[] = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'izzi-vault-sync-'));
  tempDirs.push(dir);
  const { db, close } = createNodeSqliteDatabase();
  const workDb = new WorkDb(db);
  const knowledge = new KnowledgeStore(workDb);

  const cloudNodes: GraphNode[] = [...initialNodes];
  const updateNode = vi.fn(async (id: string, patch: Partial<GraphNode>) => {
    const target = cloudNodes.find((n) => n.id === id);
    if (target) {
      if (patch.title !== undefined) target.title = patch.title;
      if (patch.content !== undefined) target.content = patch.content;
      target.updatedAt = new Date().toISOString();
    }
    return { ok: true as const };
  });
  const createNode = vi.fn(async (input: Partial<GraphNode> & { title: string }) => {
    const created: GraphNode = {
      id: `cloud-${cloudNodes.length + 1}`,
      title: input.title,
      nodeType: input.nodeType || 'wiki',
      color: input.color || '#45d982',
      content: input.content,
      metadata: input.metadata,
      createdAt: '2026-11-26T10:00:00Z',
      updatedAt: '2026-11-26T10:00:00Z',
    };
    cloudNodes.push(created);
    return created;
  });

  const cloud: VaultCloudClient = {
    listNodes: vi.fn(async () => [...cloudNodes]),
    listLinks: vi.fn(async () => []),
    createNode,
    updateNode,
    recallMemory: vi.fn(async () => ({
      status: 'ok' as const,
      sessions: [],
      insights: [
        {
          id: 'insight--1',
          summary: 'Luôn kiểm tra manifest SHA-256 trước khi ghi đè.',
          themes: ['vault'],
          sourceSessionIds: ['session--1'],
          createdAt: '2026-11-26T08:00:00Z',
          validFrom: '2026-11-26T08:00:00Z',
          validTo: null,
        },
      ],
      procedures: [
        {
          id: 'procedure--1',
          intent: 'Release PC/Mac an toàn',
          steps: ['Chạy test', 'Kiểm tra chữ ký'],
          tools: ['vitest'],
          featureSpec: 'release',
          createdAt: '2026-11-26T10:00:00Z',
          validFrom: '2026-11-26T10:00:00Z',
          validTo: null,
        },
      ],
    })),
  };

  const engine = new VaultSyncEngine(workDb, cloud, knowledge, { vaultDir: dir, enabled: true });
  return { dir, close, knowledge, cloud, cloudNodes, updateNode, createNode, engine };
}

describe('VaultSyncEngine (Local-First Obsidian Vault + 3-way Cloud Sync)', () => {
  it('pulls cloud nodes + L4/L5 insights into local .md vault, caches FTS5 offline, and pushes shareable knowledge', async () => {
    const fx = makeFixture([
      {
        id: 'n-1',
        title: 'Kiến trúc Local-First',
        nodeType: 'wiki',
        color: '#5ca7ff',
        content: '# Kiến trúc Local-First\n\nLưu toàn bộ tri thức tại IzziVault.',
        createdAt: '2026-11-26T09:00:00Z',
        updatedAt: '2026-11-26T09:00:00Z',
      },
    ]);

    try {
      // Capture two knowledge records: 1 local-only, 1 approved shareable.
      const localRec = fx.knowledge.capture({
        scope: 'project',
        workspaceId: 'izzi-ai',
        kind: 'fact',
        title: 'Ghi chú nội bộ chỉ ở máy',
        summary: 'Không bao giờ đẩy bản local-only lên cloud.',
        topicKey: 'local-only',
        source: { type: 'user', uri: 'user://1' },
        author: 'user',
        evidence: 'direct',
        confidence: 1,
      });
      fx.knowledge.promote({ id: localRec.id, reviewer: 'user', basis: 'user_approval', sensitivity: 'local' });

      const shareRec = fx.knowledge.capture({
        scope: 'project',
        workspaceId: 'izzi-ai',
        kind: 'decision',
        title: 'Quy chuẩn đồng bộ MyGraph',
        summary: 'Chỉ bản ghi active và shareable mới đồng bộ lên cloud MyGraph.',
        topicKey: 'sync-policy',
        source: { type: 'user', uri: 'user://2' },
        author: 'user',
        evidence: 'direct',
        confidence: 1,
      });
      fx.knowledge.promote({ id: shareRec.id, reviewer: 'user', basis: 'user_approval', sensitivity: 'shareable' });

      const status = await fx.engine.syncNow();
      expect(status.localNodes).toBe(2); // original cloud node + 1 pushed shareable knowledge
      expect(fx.createNode).toHaveBeenCalledTimes(1); // local-only record was NEVER pushed!
      expect(fs.existsSync(path.join(fx.dir, 'Index.md'))).toBe(true);
      expect(fs.existsSync(path.join(fx.dir, 'insights', 'insight--1.md'))).toBe(true);
      expect(fs.existsSync(path.join(fx.dir, 'insights', 'procedure--1.md'))).toBe(true);

      // Offline FTS5 search hits both cached MyGraph body and local knowledge.
      const hits = fx.engine.searchLocal('IzziVault');
      expect(hits.length).toBeGreaterThanOrEqual(1);

      // Repeat sync is idempotent (does not duplicate shareable knowledge push).
      await fx.engine.syncNow();
      expect(fx.createNode).toHaveBeenCalledTimes(1);
    } finally {
      fx.close();
    }
  });

  it('blocks secret-bearing local .md edits from pushing and preserves 3-way conflicts without silent overwrite', async () => {
    const fx = makeFixture([
      {
        id: 'n-conflict',
        title: 'Ghi chú chung',
        nodeType: 'note',
        color: '#5ca7ff',
        content: 'Phiên bản ban đầu',
        createdAt: '2026-11-26T09:00:00Z',
        updatedAt: '2026-11-26T09:00:00Z',
      },
    ]);

    try {
      await fx.engine.syncNow();
      const notesDir = path.join(fx.dir, 'notes');
      const noteFile = path.join(notesDir, fs.readdirSync(notesDir)[0]);

      // 1. Secret edit on disk → refused from pushing to cloud!
      const original = fs.readFileSync(noteFile, 'utf8');
      fs.writeFileSync(noteFile, `${original}\nAPI_KEY=sk-proj-1234567890abcdefghijklmno\n`, 'utf8');
      const s1 = await fx.engine.syncNow();
      expect(s1.blockedSecrets.length).toBe(1);
      expect(fx.updateNode).not.toHaveBeenCalled();

      // 2. Clean edit on BOTH local and remote → creates sibling .conflict-*.md without losing local text!
      fs.writeFileSync(noteFile, `${original}\nBản sửa cục bộ trên Obsidian.\n`, 'utf8');
      fx.cloudNodes[0].content = 'Bản sửa từ web izziapi.com';
      fx.cloudNodes[0].updatedAt = '2026-11-26T12:00:00Z';

      const s2 = await fx.engine.syncNow();
      expect(s2.conflicts.length).toBe(1);
      const conflictAbs = path.join(fx.dir, s2.conflicts[0]);
      expect(fs.existsSync(conflictAbs)).toBe(true);
      expect(fs.readFileSync(conflictAbs, 'utf8')).toContain('Bản sửa cục bộ trên Obsidian');
      expect(fs.readFileSync(noteFile, 'utf8')).toContain('Bản sửa từ web izziapi.com');
    } finally {
      fx.close();
    }
  });

  it('imports an external Obsidian folder as local candidates while blocking files containing secrets', () => {
    const fx = makeFixture();
    const extObsidian = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-obs-'));
    tempDirs.push(extObsidian);
    try {
      fs.writeFileSync(
        path.join(extObsidian, 'clean-note.md'),
        '# Quy tắc viết bài\n\nLuôn kiểm tra nguồn và giữ câu ngắn gọn.',
        'utf8',
      );
      fs.writeFileSync(
        path.join(extObsidian, 'secret-note.md'),
        '# Key nội bộ\n\nToken: izzi-0123456789abcdef0123456789abcdef',
        'utf8',
      );

      const res = fx.engine.importMarkdownFolder(extObsidian);
      expect(res.ok).toBe(true);
      expect(res.imported).toBe(1);
      expect(res.blockedSecrets).toBe(1);

      const candidates = fx.knowledge.list({ state: 'candidate' });
      expect(candidates).toHaveLength(1);
      expect(candidates[0].sensitivity).toBe('local');
    } finally {
      fx.close();
    }
  });

  it('closes the Slice 1 → Slice 2 → Slice 3 loop: session distill → candidate → user approve → cloud push + vault .md', async () => {
    const fx = makeFixture();
    try {
      const captureMemorySession = vi.fn().mockResolvedValue({ status: 'written', nodeId: 'session--loop1' });
      const capturer = new DistilledSessionCapturer({
        captureMemorySession,
        recallMemory: fx.cloud.recallMemory,
      });
      capturer.addCandidateHook(fx.knowledge);

      const cap = await capturer.capture({
        agentId: 'orchestrator',
        agentName: 'Orchestrator',
        request: 'Thiết kế luồng đồng bộ MyGraph theo .kiro/specs/vault-sync/design.md',
        reply: 'Quyết định: tách 3 lớp dữ liệu và bắt buộc duyệt candidate trước khi đẩy lên cloud.',
        startedAt: '2026-11-26T10:00:00Z',
        finishedAt: '2026-11-26T10:02:00Z',
        turnId: 'turn-loop-1',
      });
      expect(cap.ok).toBe(true);
      expect(cap.via).toBe('memory-loop');

      // Candidate automatically queued in Review Inbox (local, not yet pushed to cloud).
      const pending = fx.knowledge.list({ state: 'candidate' });
      expect(pending.length).toBeGreaterThanOrEqual(1);
      await fx.engine.syncNow();
      expect(fx.createNode).not.toHaveBeenCalled();

      // User approves & opts into shareable → pushed to cloud user_nodes + materialized in Vault .md!
      fx.knowledge.promote({
        id: pending[0].id,
        reviewer: 'user',
        basis: 'user_approval',
        sensitivity: 'shareable',
      });
      const after = await fx.engine.syncNow();
      expect(fx.createNode).toHaveBeenCalledTimes(1);
      expect(after.activeKnowledge).toBe(1);
      expect(fs.existsSync(path.join(fx.dir, 'knowledge', 'project', `${pending[0].id}.md`))).toBe(true);
    } finally {
      fx.close();
    }
  });

  it('imports Codex KnowledgeMemory JSON exports into local Review Inbox while skipping retracted/sensitive items', () => {
    const fx = makeFixture();
    const codexDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-exp-'));
    tempDirs.push(codexDir);
    try {
      const projDir = path.join(codexDir, 'projects');
      fs.mkdirSync(projDir, { recursive: true });
      fs.writeFileSync(
        path.join(projDir, 'proj-1.json'),
        JSON.stringify({
          schema: 'codex-knowledge-graph/v1',
          project_id: 'proj-1',
          nodes: [
            { id: 'proj-1', label: 'Starizzi', type: 'project' },
            {
              id: 'rec-1',
              label: 'Chốt cấu trúc Vault',
              type: 'decision',
              status: 'active',
              summary: 'Lưu file Markdown tại IzziVault có manifest SHA-256.',
            },
            {
              id: 'rec-2',
              label: 'Bản đã rút lại',
              type: 'lesson',
              status: 'retracted',
              summary: 'Không được nhập.',
            },
            {
              id: 'rec-3',
              label: 'Bản chứa email nhạy cảm',
              type: 'fact',
              status: 'active',
              summary: 'Email riêng: admin@secret.vn',
            },
          ],
        }),
        'utf8',
      );

      const res = fx.engine.importCodexExports(codexDir);
      expect(res.ok).toBe(true);
      expect(res.imported).toBe(1);
      expect(res.skipped).toBe(1);
      expect(res.blockedSecrets).toBe(1);
    } finally {
      fx.close();
    }
  });
});
