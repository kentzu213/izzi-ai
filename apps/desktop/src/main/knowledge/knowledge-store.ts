/**
 * KnowledgeStore — local SQLite canonical knowledge store matching the Obsidian
 * `project-memory` (`memory_store.py`) filter inside Izzi AI App.
 *
 * Uses `WorkDb` (`WorkSqliteDatabase`) so production shares `DatabaseManager`'s
 * single WAL `better-sqlite3` connection while unit tests execute real SQL +
 * triggers + FTS5 on Node's built-in `node:sqlite`.
 *
 * Invariants enforced at the SQL & service boundary:
 *  - Fail-closed secret & PII gate (blocks API keys, JWTs, emails, Luhn cards,
 *    and credential-bearing URIs).
 *  - Evidence immutability trigger on `knowledge_records` + append-only triggers
 *    on `knowledge_events`.
 *  - Deterministic SHA-256 `digest` deduplication.
 *  - Explicit promotion authority: inferences can NEVER be self-promoted by an
 *    agent; only interactive user approval (`reviewer: 'user'`) or matching file
 *    SHA-256 / direct user instruction activates a record.
 *  - Effective recall excludes candidates, superseded/retracted, expired, stale
 *    file-hash, and unresolved same-topic conflicts.
 *
 * @module main/knowledge/knowledge-store
 */

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WorkDb } from '../work/work-sqlite';
import {
  KNOWLEDGE_EVIDENCE_TYPES,
  KNOWLEDGE_KINDS,
  KNOWLEDGE_RELATION_TYPES,
  KNOWLEDGE_SCOPES,
  KNOWLEDGE_SENSITIVITIES,
  KNOWLEDGE_SOURCE_TYPES,
  type KnowledgeCaptureInput,
  type KnowledgeEvidenceType,
  type KnowledgeKind,
  type KnowledgePromoteInput,
  type KnowledgeRecord,
  type KnowledgeRelation,
  type KnowledgeScope,
  type KnowledgeSensitivity,
  type KnowledgeSourceType,
  type KnowledgeState,
  type KnowledgeStats,
} from '../../shared/knowledge-types';
import {
  containsSensitiveMaterial,
  redactSensitiveText,
  validateSourceUri,
} from '../../shared/secret-pii-gate';
import type { SessionMemoryWriteInput } from '../../shared/memory-loop-types';
import type { AgentSessionInput } from '../agents/agent-session-graph';
import type { SessionCandidateHook } from '../agents/session-distiller';

const SCOPE_SET = new Set<string>(KNOWLEDGE_SCOPES);
const KIND_SET = new Set<string>(KNOWLEDGE_KINDS);
const SOURCE_TYPE_SET = new Set<string>(KNOWLEDGE_SOURCE_TYPES);
const EVIDENCE_SET = new Set<string>(KNOWLEDGE_EVIDENCE_TYPES);
const SENSITIVITY_SET = new Set<string>(KNOWLEDGE_SENSITIVITIES);
const RELATION_TYPE_SET = new Set<string>(KNOWLEDGE_RELATION_TYPES);
const SHA256_RE = /^[0-9a-fA-F]{64}$/;
const AGENT_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const MAX_RETRIEVAL_TEXT = 6_000;

const SCOPE_PRIORITY: Record<KnowledgeScope, number> = {
  task: 0,
  project: 1,
  role: 2,
  user: 3,
  'policy-reference': 4,
};

interface KnowledgeRow {
  id: string;
  digest: string;
  scope: KnowledgeScope;
  workspace_id: string | null;
  agent: string | null;
  kind: KnowledgeKind;
  title: string;
  summary: string;
  topic_key: string;
  source_type: KnowledgeSourceType;
  source_uri: string;
  source_sha256: string | null;
  author: string;
  evidence: KnowledgeEvidenceType;
  confidence: number;
  sensitivity: KnowledgeSensitivity;
  review_after: string;
  relations_json: string;
  state: KnowledgeState;
  cloud_node_id: string | null;
  created_at: string;
  updated_at: string;
  promoted_at: string | null;
  reviewer: string | null;
  basis: string | null;
  superseded_by: string | null;
  retracted_by: string | null;
  retracted_reason: string | null;
}

export class KnowledgeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KnowledgeValidationError';
  }
}

export class KnowledgeAuthorityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KnowledgeAuthorityError';
  }
}

export class KnowledgeNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KnowledgeNotFoundError';
  }
}

/** Initialize the canonical knowledge tables, triggers, and FTS5 index (idempotent). */
export function ensureKnowledgeSchema(db: WorkDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_records (
      id TEXT PRIMARY KEY,
      digest TEXT NOT NULL UNIQUE,
      scope TEXT NOT NULL,
      workspace_id TEXT,
      agent TEXT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      topic_key TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_uri TEXT NOT NULL,
      source_sha256 TEXT,
      author TEXT NOT NULL,
      evidence TEXT NOT NULL,
      confidence REAL NOT NULL,
      sensitivity TEXT NOT NULL DEFAULT 'local',
      review_after TEXT NOT NULL,
      relations_json TEXT NOT NULL DEFAULT '[]',
      state TEXT NOT NULL DEFAULT 'candidate',
      cloud_node_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      promoted_at TEXT,
      reviewer TEXT,
      basis TEXT,
      superseded_by TEXT REFERENCES knowledge_records(id),
      retracted_by TEXT,
      retracted_reason TEXT
    );

    CREATE TABLE IF NOT EXISTS knowledge_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      record_id TEXT REFERENCES knowledge_records(id),
      workspace_id TEXT,
      actor TEXT NOT NULL,
      detail_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_partition
      ON knowledge_records(scope, workspace_id, topic_key, agent, state);
    CREATE INDEX IF NOT EXISTS idx_knowledge_state_created
      ON knowledge_records(state, created_at DESC);

    CREATE TRIGGER IF NOT EXISTS knowledge_events_no_update
    BEFORE UPDATE ON knowledge_events
    BEGIN SELECT RAISE(ABORT, 'knowledge events are append-only'); END;

    CREATE TRIGGER IF NOT EXISTS knowledge_events_no_delete
    BEFORE DELETE ON knowledge_events
    BEGIN SELECT RAISE(ABORT, 'knowledge events are append-only'); END;

    CREATE TRIGGER IF NOT EXISTS knowledge_evidence_immutable
    BEFORE UPDATE ON knowledge_records
    WHEN OLD.digest IS NOT NEW.digest
      OR OLD.scope IS NOT NEW.scope
      OR OLD.workspace_id IS NOT NEW.workspace_id
      OR OLD.agent IS NOT NEW.agent
      OR OLD.kind IS NOT NEW.kind
      OR OLD.title IS NOT NEW.title
      OR OLD.summary IS NOT NEW.summary
      OR OLD.topic_key IS NOT NEW.topic_key
      OR OLD.source_type IS NOT NEW.source_type
      OR OLD.source_uri IS NOT NEW.source_uri
      OR OLD.source_sha256 IS NOT NEW.source_sha256
      OR OLD.author IS NOT NEW.author
      OR OLD.evidence IS NOT NEW.evidence
      OR OLD.confidence IS NOT NEW.confidence
      OR OLD.review_after IS NOT NEW.review_after
      OR OLD.relations_json IS NOT NEW.relations_json
      OR OLD.created_at IS NOT NEW.created_at
    BEGIN SELECT RAISE(ABORT, 'knowledge record evidence is immutable'); END;

    CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(
      record_id UNINDEXED,
      title,
      summary,
      topic_key,
      kind
    );
  `);
}

function requiredText(value: unknown, field: string, maxLen: number): string {
  if (typeof value !== 'string') throw new KnowledgeValidationError(`invalid ${field}`);
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > maxLen) {
    throw new KnowledgeValidationError(`invalid ${field}`);
  }
  return trimmed;
}

function parseIsoUtc(value: string): number {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new KnowledgeValidationError('invalid ISO timestamp');
  return ms;
}

function resolveLocalFilePath(uri: string): string | null {
  if (uri.startsWith('file://')) {
    try {
      return fileURLToPath(uri);
    } catch {
      return null;
    }
  }
  if (path.isAbsolute(uri)) return uri;
  return null;
}

function matchingFileSha256(filePath: string | null, expected: string | null): boolean {
  if (!filePath || !expected) return false;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    const hash = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    return hash.toLowerCase() === expected.toLowerCase();
  } catch {
    return false;
  }
}

function tokenize(text: string): Set<string> {
  const matches = String(text ?? '')
    .toLowerCase()
    .match(/[\p{L}\p{N}_-]+/gu);
  return new Set(matches ?? []);
}

function slugifyTopic(raw: string): string {
  return String(raw ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'general';
}

export class KnowledgeStore implements SessionCandidateHook {
  constructor(
    private readonly db: WorkDb,
    private readonly nowFn: () => Date = () => new Date(),
  ) {
    ensureKnowledgeSchema(this.db);
  }

  private nowIso(): string {
    return this.nowFn().toISOString();
  }

  private insertEvent(
    eventType: string,
    opts: { actor: string; recordId?: string | null; workspaceId?: string | null; detail?: Record<string, unknown> },
  ): void {
    this.db.run(
      `INSERT INTO knowledge_events(event_type, record_id, workspace_id, actor, detail_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      eventType,
      opts.recordId ?? null,
      opts.workspaceId ?? null,
      opts.actor,
      JSON.stringify(opts.detail ?? {}),
      this.nowIso(),
    );
  }

  private sourceCurrent(row: KnowledgeRow): boolean {
    if (row.source_type !== 'artifact' && row.source_type !== 'test') return true;
    return matchingFileSha256(resolveLocalFilePath(row.source_uri), row.source_sha256);
  }

  private conflictsFor(row: KnowledgeRow): string[] {
    if (row.state !== 'active' || !this.sourceCurrent(row)) return [];
    let sql = `SELECT * FROM knowledge_records
      WHERE id <> ? AND state = 'active' AND scope = ?
        AND ((workspace_id = ?) OR (workspace_id IS NULL AND ? IS NULL))
        AND topic_key = ?`;
    const params: unknown[] = [row.id, row.scope, row.workspace_id, row.workspace_id, row.topic_key];
    if (row.scope === 'role') {
      sql += ' AND agent = ?';
      params.push(row.agent);
    }
    sql += ' ORDER BY id ASC';
    const others = this.db.all<KnowledgeRow>(sql, ...params);
    return others.filter((other) => this.sourceCurrent(other)).map((other) => other.id);
  }

  private toRecord(row: KnowledgeRow): KnowledgeRecord {
    const nowMs = this.nowFn().getTime();
    let relations: KnowledgeRelation[] = [];
    try {
      const parsed = JSON.parse(row.relations_json);
      if (Array.isArray(parsed)) relations = parsed as KnowledgeRelation[];
    } catch {
      relations = [];
    }

    const source: KnowledgeRecord['source'] = {
      type: row.source_type,
      uri: row.source_uri,
      ...(row.source_sha256 ? { sha256: row.source_sha256 } : {}),
    };

    return {
      id: row.id,
      digest: row.digest,
      scope: row.scope,
      workspaceId: row.workspace_id,
      agent: row.agent,
      kind: row.kind,
      title: row.title,
      summary: row.summary,
      topicKey: row.topic_key,
      source,
      author: row.author,
      evidence: row.evidence,
      confidence: row.confidence,
      sensitivity: row.sensitivity,
      reviewAfter: row.review_after,
      relations,
      state: row.state,
      sourceCurrent: this.sourceCurrent(row),
      expired: Date.parse(row.review_after) <= nowMs,
      conflicts: this.conflictsFor(row),
      cloudNodeId: row.cloud_node_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      promotedAt: row.promoted_at,
      reviewer: row.reviewer,
      basis: row.basis,
      supersededBy: row.superseded_by,
      retractedBy: row.retracted_by,
      retractedReason: row.retracted_reason,
    };
  }

  /**
   * Capture a new atomic knowledge record as a `candidate`.
   * Fail-closed on secrets, PII, credential URIs, or invalid schema fields.
   * Deduplicates idempotently by canonical SHA-256 `digest`.
   */
  capture(input: KnowledgeCaptureInput): KnowledgeRecord {
    if (!input || typeof input !== 'object') {
      throw new KnowledgeValidationError('invalid knowledge payload');
    }
    if (containsSensitiveMaterial(input)) {
      throw new KnowledgeValidationError('payload contains prohibited secret or PII material');
    }

    if (!SCOPE_SET.has(input.scope)) throw new KnowledgeValidationError('invalid scope');
    if (!KIND_SET.has(input.kind)) throw new KnowledgeValidationError('invalid kind');
    if (!EVIDENCE_SET.has(input.evidence)) throw new KnowledgeValidationError('invalid evidence');
    const sensitivity: KnowledgeSensitivity = input.sensitivity ?? 'local';
    if (!SENSITIVITY_SET.has(sensitivity)) throw new KnowledgeValidationError('invalid sensitivity');

    const title = requiredText(input.title, 'title', 160);
    const summary = requiredText(input.summary, 'summary', 1200);
    const topicKey = requiredText(input.topicKey, 'topicKey', 120);
    const author = requiredText(input.author, 'author', 120);

    if (
      typeof input.confidence !== 'number' ||
      !Number.isFinite(input.confidence) ||
      input.confidence < 0 ||
      input.confidence > 1
    ) {
      throw new KnowledgeValidationError('invalid confidence');
    }

    let workspaceId: string | null = input.workspaceId ? String(input.workspaceId).trim() : null;
    let agent: string | null = input.agent ? String(input.agent).trim() : null;
    if (input.scope === 'project' || input.scope === 'task') {
      if (!workspaceId) workspaceId = 'default';
      if (agent !== null && !AGENT_RE.test(agent)) throw new KnowledgeValidationError('invalid agent');
    } else if (input.scope === 'role') {
      if (workspaceId !== null) throw new KnowledgeValidationError('role memory cannot bind a workspace');
      if (!agent || !AGENT_RE.test(agent)) throw new KnowledgeValidationError('invalid agent');
    } else {
      workspaceId = null;
      agent = null;
    }

    if (!input.source || typeof input.source !== 'object') {
      throw new KnowledgeValidationError('invalid source');
    }
    if (!SOURCE_TYPE_SET.has(input.source.type)) {
      throw new KnowledgeValidationError('invalid source type');
    }
    const sourceUri = requiredText(input.source.uri, 'source URI', 2048);
    const uriCheck = validateSourceUri(sourceUri);
    if (!uriCheck.ok) throw new KnowledgeValidationError(uriCheck.reason);

    let sourceSha256: string | null = null;
    if (input.source.sha256 !== undefined && input.source.sha256 !== null) {
      if (typeof input.source.sha256 !== 'string' || !SHA256_RE.test(input.source.sha256)) {
        throw new KnowledgeValidationError('invalid source sha256');
      }
      sourceSha256 = input.source.sha256.toLowerCase();
    }

    const relations: KnowledgeRelation[] = [];
    const seenRel = new Set<string>();
    for (const rel of input.relations ?? []) {
      if (!rel || !RELATION_TYPE_SET.has(rel.type) || typeof rel.target !== 'string' || !rel.target.trim()) {
        throw new KnowledgeValidationError('invalid relation');
      }
      const key = `${rel.type}:${rel.target.trim()}`;
      if (!seenRel.has(key)) {
        seenRel.add(key);
        relations.push({ type: rel.type, target: rel.target.trim() });
      }
    }
    relations.sort((a, b) => a.type.localeCompare(b.type) || a.target.localeCompare(b.target));

    const reviewAfter = input.reviewAfter
      ? new Date(parseIsoUtc(input.reviewAfter)).toISOString()
      : new Date(
          this.nowFn().getTime() + (input.scope === 'task' ? 7 : 90) * 24 * 60 * 60 * 1000,
        ).toISOString();

    const digestPayload = JSON.stringify({
      scope: input.scope,
      workspaceId,
      agent,
      topicKey,
      source: { type: input.source.type, uri: sourceUri, ...(sourceSha256 ? { sha256: sourceSha256 } : {}) },
      title,
      summary,
    });
    const digest = crypto.createHash('sha256').update(digestPayload).digest('hex');
    const id = `kn-${digest.slice(0, 24)}`;

    return this.db.transaction(() => {
      for (const rel of relations) {
        const exists = this.db.get<{ id: string }>('SELECT id FROM knowledge_records WHERE id = ?', rel.target);
        if (!exists) throw new KnowledgeValidationError('unknown relation target');
      }

      const existing = this.db.get<KnowledgeRow>('SELECT * FROM knowledge_records WHERE digest = ?', digest);
      if (existing) return this.toRecord(existing);

      const now = this.nowIso();
      this.db.run(
        `INSERT INTO knowledge_records(
          id, digest, scope, workspace_id, agent, kind, title, summary, topic_key,
          source_type, source_uri, source_sha256, author, evidence, confidence,
          sensitivity, review_after, relations_json, state, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate', ?, ?)`,
        id,
        digest,
        input.scope,
        workspaceId,
        agent,
        input.kind,
        title,
        summary,
        topicKey,
        input.source.type,
        sourceUri,
        sourceSha256,
        author,
        input.evidence,
        input.confidence,
        sensitivity,
        reviewAfter,
        JSON.stringify(relations),
        now,
        now,
      );

      this.db.run(
        `INSERT INTO knowledge_fts(record_id, title, summary, topic_key, kind) VALUES (?, ?, ?, ?, ?)`,
        id,
        title,
        summary,
        topicKey,
        input.kind,
      );

      this.insertEvent('captured', {
        actor: author,
        recordId: id,
        workspaceId,
        detail: { digest, state: 'candidate', sensitivity },
      });

      const created = this.db.get<KnowledgeRow>('SELECT * FROM knowledge_records WHERE id = ?', id)!;
      return this.toRecord(created);
    });
  }

  /**
   * Promote a `candidate` record to `active`.
   * Agents (`root`/`orchestrator`) cannot self-promote `inference` records; only
   * explicit user approval (`reviewer: 'user'`), verified file SHA-256, or direct
   * user instruction is accepted.
   */
  promote(input: KnowledgePromoteInput): KnowledgeRecord {
    return this.db.transaction(() => {
      const row = this.db.get<KnowledgeRow>('SELECT * FROM knowledge_records WHERE id = ?', input.id);
      if (!row) throw new KnowledgeNotFoundError('knowledge record not found');
      if (row.state === 'active') {
        if (input.reviewer === 'user' && input.sensitivity && input.sensitivity !== row.sensitivity) {
          return this.setSensitivityInternal(row, input.sensitivity, 'user');
        }
        return this.toRecord(row);
      }
      if (row.state !== 'candidate') {
        throw new KnowledgeAuthorityError('record is not promotable');
      }

      let authorized = false;
      if (input.basis === 'user_approval') {
        authorized = input.reviewer === 'user';
      } else if (input.basis === 'user_instruction') {
        authorized = row.source_type === 'user' && row.evidence === 'direct';
      } else if (input.basis === 'verified_artifact') {
        authorized =
          (row.source_type === 'artifact' || row.source_type === 'test') &&
          matchingFileSha256(resolveLocalFilePath(row.source_uri), row.source_sha256);
      }

      if (!authorized || (input.reviewer !== 'user' && row.source_type === 'inference')) {
        throw new KnowledgeAuthorityError('promotion evidence or authority is insufficient');
      }

      let nextSensitivity: KnowledgeSensitivity = row.sensitivity;
      if (input.reviewer === 'user' && input.sensitivity && SENSITIVITY_SET.has(input.sensitivity)) {
        if (input.sensitivity === 'shareable' && containsSensitiveMaterial({ t: row.title, s: row.summary })) {
          throw new KnowledgeValidationError('cannot mark sensitive content as shareable');
        }
        nextSensitivity = input.sensitivity;
      }

      const now = this.nowIso();
      this.db.run(
        `UPDATE knowledge_records
         SET state = 'active', sensitivity = ?, updated_at = ?, promoted_at = ?, reviewer = ?, basis = ?
         WHERE id = ?`,
        nextSensitivity,
        now,
        now,
        input.reviewer,
        input.basis,
        row.id,
      );

      this.insertEvent('promoted', {
        actor: input.reviewer,
        recordId: row.id,
        workspaceId: row.workspace_id,
        detail: { basis: input.basis, state: 'active', sensitivity: nextSensitivity },
      });

      const updated = this.db.get<KnowledgeRow>('SELECT * FROM knowledge_records WHERE id = ?', row.id)!;
      return this.toRecord(updated);
    });
  }

  private setSensitivityInternal(
    row: KnowledgeRow,
    sensitivity: KnowledgeSensitivity,
    actor: string,
  ): KnowledgeRecord {
    if (sensitivity === 'shareable' && containsSensitiveMaterial({ t: row.title, s: row.summary })) {
      throw new KnowledgeValidationError('cannot mark sensitive content as shareable');
    }
    const now = this.nowIso();
    this.db.run(
      `UPDATE knowledge_records SET sensitivity = ?, updated_at = ? WHERE id = ?`,
      sensitivity,
      now,
      row.id,
    );
    this.insertEvent('sensitivity_changed', {
      actor,
      recordId: row.id,
      workspaceId: row.workspace_id,
      detail: { sensitivity },
    });
    const updated = this.db.get<KnowledgeRow>('SELECT * FROM knowledge_records WHERE id = ?', row.id)!;
    return this.toRecord(updated);
  }

  /** Supersede an active record with another active record in the same partition. */
  supersede(oldId: string, newId: string, reviewer: string, reason: string): KnowledgeRecord {
    if (oldId === newId) throw new KnowledgeValidationError('records must differ');
    const cleanReason = requiredText(reason, 'reason', 500);

    return this.db.transaction(() => {
      const oldRow = this.db.get<KnowledgeRow>('SELECT * FROM knowledge_records WHERE id = ?', oldId);
      const newRow = this.db.get<KnowledgeRow>('SELECT * FROM knowledge_records WHERE id = ?', newId);
      if (!oldRow || !newRow) throw new KnowledgeNotFoundError('knowledge record not found');
      if (oldRow.state !== 'active' || newRow.state !== 'active') {
        throw new KnowledgeValidationError('supersession requires active records');
      }
      const samePartition =
        oldRow.scope === newRow.scope &&
        (oldRow.workspace_id ?? '') === (newRow.workspace_id ?? '') &&
        oldRow.topic_key === newRow.topic_key &&
        (oldRow.scope !== 'role' || (oldRow.agent ?? '') === (newRow.agent ?? ''));
      if (!samePartition) {
        throw new KnowledgeValidationError('records are not in the same partition');
      }

      const now = this.nowIso();
      this.db.run(
        `UPDATE knowledge_records SET state = 'superseded', superseded_by = ?, updated_at = ? WHERE id = ?`,
        newId,
        now,
        oldId,
      );
      this.insertEvent('superseded', {
        actor: reviewer,
        recordId: oldId,
        workspaceId: oldRow.workspace_id,
        detail: { newId, reason: cleanReason },
      });

      const updated = this.db.get<KnowledgeRow>('SELECT * FROM knowledge_records WHERE id = ?', oldId)!;
      return this.toRecord(updated);
    });
  }

  /** Retract a candidate or active record while preserving audit history. */
  retract(id: string, actor: string, reason: string): KnowledgeRecord {
    const cleanActor = requiredText(actor, 'actor', 120);
    const cleanReason = requiredText(reason, 'reason', 500);

    return this.db.transaction(() => {
      const row = this.db.get<KnowledgeRow>('SELECT * FROM knowledge_records WHERE id = ?', id);
      if (!row) throw new KnowledgeNotFoundError('knowledge record not found');
      if (row.state === 'retracted') return this.toRecord(row);
      if (row.state !== 'candidate' && row.state !== 'active') {
        throw new KnowledgeValidationError('record cannot be retracted');
      }

      const now = this.nowIso();
      this.db.run(
        `UPDATE knowledge_records
         SET state = 'retracted', retracted_by = ?, retracted_reason = ?, updated_at = ?
         WHERE id = ?`,
        cleanActor,
        cleanReason,
        now,
        id,
      );
      this.insertEvent('retracted', {
        actor: cleanActor,
        recordId: id,
        workspaceId: row.workspace_id,
        detail: { reason: cleanReason },
      });

      const updated = this.db.get<KnowledgeRow>('SELECT * FROM knowledge_records WHERE id = ?', id)!;
      return this.toRecord(updated);
    });
  }

  /** Link an active shareable record to its synced cloud `user_nodes.id`. */
  markCloudSynced(id: string, cloudNodeId: string): void {
    this.db.run(
      `UPDATE knowledge_records SET cloud_node_id = ?, updated_at = ? WHERE id = ?`,
      cloudNodeId,
      this.nowIso(),
      id,
    );
  }

  get(id: string): KnowledgeRecord | null {
    const row = this.db.get<KnowledgeRow>('SELECT * FROM knowledge_records WHERE id = ?', id);
    return row ? this.toRecord(row) : null;
  }

  list(filter?: {
    state?: KnowledgeState;
    scope?: KnowledgeScope;
    workspaceId?: string;
    sensitivity?: KnowledgeSensitivity;
    includeInactive?: boolean;
    limit?: number;
  }): KnowledgeRecord[] {
    const clauses: string[] = [];
    const params: unknown[] = [];

    if (filter?.state) {
      clauses.push('state = ?');
      params.push(filter.state);
    } else if (!filter?.includeInactive) {
      clauses.push(`state IN ('candidate', 'active')`);
    }

    if (filter?.scope) {
      clauses.push('scope = ?');
      params.push(filter.scope);
    }
    if (filter?.workspaceId) {
      clauses.push('workspace_id = ?');
      params.push(filter.workspaceId);
    }
    if (filter?.sensitivity) {
      clauses.push('sensitivity = ?');
      params.push(filter.sensitivity);
    }

    const where = clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '';
    const lim =
      typeof filter?.limit === 'number' && Number.isFinite(filter.limit) && filter.limit > 0
        ? ` LIMIT ${Math.min(Math.trunc(filter.limit), 500)}`
        : '';

    const rows = this.db.all<KnowledgeRow>(
      `SELECT * FROM knowledge_records${where} ORDER BY created_at DESC, id ASC${lim}`,
      ...params,
    );
    return rows.map((r) => this.toRecord(r));
  }

  /**
   * Effective retrieval: strictly `active`, `sourceCurrent`, unexpired, and
   * conflict-free on each `topic_key`, ordered by scope priority then query overlap.
   */
  recall(opts: {
    workspaceId?: string;
    agent?: string;
    query?: string;
    limit?: number;
    includeShared?: boolean;
  } = {}): KnowledgeRecord[] {
    const limit = Math.max(1, Math.min(Math.trunc(opts.limit ?? 5), 20));
    const includeShared = opts.includeShared !== false;
    const nowMs = this.nowFn().getTime();
    const queryTokens = tokenize(opts.query ?? '');

    const activeRows = this.db.all<KnowledgeRow>(
      `SELECT * FROM knowledge_records WHERE state = 'active' ORDER BY created_at DESC, id ASC`,
    );

    const eligible = activeRows.filter((row) => {
      if (!this.sourceCurrent(row)) return false;
      if (Date.parse(row.review_after) <= nowMs) return false;
      if (row.scope === 'project' || row.scope === 'task') {
        return (
          (!opts.workspaceId || row.workspace_id === opts.workspaceId) &&
          (row.agent === null || (opts.agent !== undefined && row.agent === opts.agent))
        );
      }
      if (!includeShared) return false;
      if (row.scope === 'role') return opts.agent !== undefined && row.agent === opts.agent;
      return row.scope === 'user' || row.scope === 'policy-reference';
    });

    const audiencePriority = (row: KnowledgeRow): number => {
      if (row.scope === 'project' || row.scope === 'task') {
        return opts.agent && row.agent === opts.agent ? 0 : 1;
      }
      return 0;
    };

    // Resolve per topic_key: exclude unresolved same-level conflicts (exact memory_store.py rule).
    const byTopic = new Map<string, KnowledgeRow[]>();
    for (const row of eligible) {
      const list = byTopic.get(row.topic_key);
      if (list) list.push(row);
      else byTopic.set(row.topic_key, [row]);
    }

    const winners: KnowledgeRow[] = [];
    for (const rows of byTopic.values()) {
      const bestScope = Math.min(...rows.map((r) => SCOPE_PRIORITY[r.scope]));
      const scoped = rows.filter((r) => SCOPE_PRIORITY[r.scope] === bestScope);
      const bestAud = Math.min(...scoped.map(audiencePriority));
      const top = scoped.filter((r) => audiencePriority(r) === bestAud);
      if (top.length === 1) winners.push(top[0]);
    }

    const ranked = winners
      .map((row) => {
        const hay = tokenize(`${row.title} ${row.summary} ${row.topic_key} ${row.kind}`);
        let overlap = 0;
        for (const t of queryTokens) {
          if (hay.has(t)) overlap += 1;
        }
        return { row, overlap };
      })
      .filter((entry) => queryTokens.size === 0 || entry.overlap > 0)
      .sort((a, b) => {
        const pDiff = SCOPE_PRIORITY[a.row.scope] - SCOPE_PRIORITY[b.row.scope];
        if (pDiff !== 0) return pDiff;
        if (b.overlap !== a.overlap) return b.overlap - a.overlap;
        return Date.parse(b.row.created_at) - Date.parse(a.row.created_at);
      });

    const out: KnowledgeRecord[] = [];
    let chars = 0;
    for (const { row } of ranked) {
      const sz = row.title.length + row.summary.length;
      if (chars + sz > MAX_RETRIEVAL_TEXT) continue;
      out.push(this.toRecord(row));
      chars += sz;
      if (out.length >= limit) break;
    }
    return out;
  }

  /** Local FTS5 search over active/candidate knowledge records (works 100% offline). */
  search(query: string, limit = 20): KnowledgeRecord[] {
    const terms = Array.from(tokenize(query)).slice(0, 6);
    if (terms.length === 0) return [];
    const matchExpr = terms.map((t) => `"${t.replace(/"/g, '')}"*`).join(' OR ');
    const lim = Math.max(1, Math.min(Math.trunc(limit), 100));

    try {
      const rows = this.db.all<KnowledgeRow>(
        `SELECT r.* FROM knowledge_fts f
         JOIN knowledge_records r ON r.id = f.record_id
         WHERE knowledge_fts MATCH ? AND r.state IN ('candidate', 'active')
         ORDER BY bm25(knowledge_fts) ASC
         LIMIT ?`,
        matchExpr,
        lim,
      );
      return rows.map((r) => this.toRecord(r));
    } catch {
      return [];
    }
  }

  /** Publishable subset eligible for cloud MyGraph sync (exact Obsidian gate). */
  listShareableActive(): KnowledgeRecord[] {
    return this.list({ state: 'active', sensitivity: 'shareable' }).filter(
      (r) => r.sourceCurrent && !r.expired && r.conflicts.length === 0,
    );
  }

  getStats(): KnowledgeStats {
    const all = this.list({ includeInactive: true });
    const eventsRow = this.db.get<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM knowledge_events');
    return {
      total: all.length,
      candidate: all.filter((r) => r.state === 'candidate').length,
      active: all.filter((r) => r.state === 'active').length,
      shareable: all.filter((r) => r.state === 'active' && r.sensitivity === 'shareable').length,
      conflicts: all.filter((r) => r.state === 'active' && r.conflicts.length > 0).length,
      expired: all.filter((r) => r.state === 'active' && r.expired).length,
      events: Number(eventsRow?.cnt ?? 0),
    };
  }

  /**
   * SessionCandidateHook (Slice 1 → Slice 2 bridge): capture distilled decisions
   * from completed desktop sessions into the Review Inbox as `candidate` items
   * (`sensitivity: 'local'`, never auto-promoted). Best-effort; never throws.
   */
  onWorkBlockDistilled(block: SessionMemoryWriteInput, raw: AgentSessionInput): void {
    if (!block.decisions || block.decisions.length === 0) return;
    const topicBase = slugifyTopic(block.featureSpec || block.specsTouched[0] || raw.agentId);

    for (const decision of block.decisions.slice(0, 3)) {
      const safeDecision = redactSensitiveText(decision).text.trim();
      if (safeDecision.length < 16) continue;
      // Skip pure tool-execution log lines; keep genuine decisions/lessons.
      if (/^Tool\s+[A-Za-z0-9._-]+$/i.test(safeDecision)) continue;

      const safeSummary = redactSensitiveText(`${block.summary}\n${safeDecision}`).text.slice(0, 1100);
      const title = safeDecision.slice(0, 150);
      try {
        this.capture({
          scope: 'project',
          workspaceId: 'default',
          agent: raw.agentId && AGENT_RE.test(raw.agentId) ? raw.agentId : null,
          kind: 'decision',
          title,
          summary: safeSummary,
          topicKey: `${topicBase}:${slugifyTopic(title).slice(0, 32)}`,
          source: {
            type: 'inference',
            uri: `izzi://session/${raw.turnId || raw.finishedAt || 'turn'}`,
          },
          author: raw.agentId || 'desktop-agent',
          evidence: 'derived',
          confidence: block.outcome === 'success' ? 0.75 : 0.45,
          sensitivity: 'local',
        });
      } catch {
        // Best-effort — validation rejection (e.g. residual PII) safely skips capture.
      }
    }
  }
}
