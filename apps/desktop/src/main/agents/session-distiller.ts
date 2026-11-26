/**
 * SessionDistiller & RecallContextService — closes the desktop L4–L5 memory loop.
 *
 * Replaces raw per-turn `user_nodes` dumping with a clean, gated pipeline:
 *  1. Filters trivial filler turns (`ok`, `thanks`, smalltalk with 0 tool steps).
 *  2. Distills substantive turns into redacted `SessionMemoryWriteInput`
 *     (summary, decisions, followUps, specsTouched, filesTouched, outcome).
 *  3. Writes to `POST /api/aibase/memory/session` (`kb_memory_nodes`, `kind='session'`)
 *     so backend L4 Reflection, L5 Procedural Induction, and Graph Projection run
 *     automatically without duplicate raw-note spam.
 *  4. Only falls back to redacted `AgentSessionCapturer.capture()` when backend
 *     reports `status === 'disabled'`, preserving visibility without double-writes.
 *  5. Optionally emits candidate knowledge records to a local sink (Slice 2).
 *  6. Provides cached, bounded `GET /api/aibase/memory/recall` briefings for
 *     agents at session start so L4 insights + L5 procedures feed back into work.
 *
 * Security (security-baseline A/B/C/D):
 *  - Every outgoing field passes `secret-pii-gate` redaction.
 *  - Best-effort & fail-closed: never throws, never blocks chat turns.
 *  - Recalled memory is strictly formatted as read-only evidence, never authority.
 *
 * @module main/agents/session-distiller
 */

import {
  extractWorkBlockFromTurn,
  formatRecallBriefing,
  type CaptureSessionResult,
  type SessionMemoryWriteInput,
  type UnifiedRecallResult,
} from '../../shared/memory-loop-types';
import type { AgentSessionCapturer, AgentSessionInput } from './agent-session-graph';

export interface MemoryLoopTransport {
  captureMemorySession(input: SessionMemoryWriteInput): Promise<CaptureSessionResult>;
  recallMemory(opts?: {
    queryText?: string;
    featureSpec?: string;
    limit?: number;
    timeoutMs?: number;
  }): Promise<UnifiedRecallResult>;
}

export interface SessionCandidateHook {
  onWorkBlockDistilled(block: SessionMemoryWriteInput, raw: AgentSessionInput): void;
}

export interface DistillCaptureOutcome {
  ok: boolean;
  via: 'memory-loop' | 'graph-fallback' | 'skipped' | 'disabled' | 'failed';
  nodeId?: string;
  reason?: string;
}

/**
 * Drop-in sink compatible with `SessionRecorder`: distills turns into L4–L5
 * structured session memory before falling back to redacted graph notes.
 */
export class DistilledSessionCapturer {
  private candidateHooks: SessionCandidateHook[] = [];

  constructor(
    private readonly transport: MemoryLoopTransport,
    private readonly fallbackGraph?: Pick<AgentSessionCapturer, 'capture'>,
    private readonly isCaptureEnabled: () => boolean = () => true,
  ) {}

  addCandidateHook(hook: SessionCandidateHook): void {
    this.candidateHooks.push(hook);
  }

  async capture(input: AgentSessionInput): Promise<DistillCaptureOutcome> {
    try {
      if (!this.isCaptureEnabled()) {
        return { ok: false, via: 'disabled', reason: 'capture-disabled' };
      }

      const workBlock = extractWorkBlockFromTurn({
        agentId: input.agentId,
        agentName: input.agentName,
        request: input.request,
        reply: input.reply,
        steps: input.steps,
      });

      if (!workBlock) {
        return { ok: true, via: 'skipped', reason: 'trivial-turn' };
      }

      // Notify local selective knowledge inbox (Slice 2) — always best-effort.
      for (const hook of this.candidateHooks) {
        try {
          hook.onWorkBlockDistilled(workBlock, input);
        } catch {
          // Never allow candidate hook errors to fail capture.
        }
      }

      const res = await this.transport.captureMemorySession(workBlock);
      if (res.status === 'written' || res.status === 'queued') {
        return { ok: true, via: 'memory-loop', nodeId: res.nodeId };
      }

      // Only fall back to legacy redacted user_nodes capture when the backend
      // memory loop flag is explicitly off. Do NOT fall back on unauthorized/quota.
      if (res.status === 'disabled' && this.fallbackGraph) {
        const fb = await this.fallbackGraph.capture(input);
        return {
          ok: fb.ok,
          via: fb.ok ? 'graph-fallback' : 'failed',
          nodeId: fb.nodeId,
          reason: fb.reason,
        };
      }

      return { ok: false, via: 'failed', reason: res.error ?? res.status };
    } catch {
      return { ok: false, via: 'failed', reason: 'error' };
    }
  }
}

/**
 * Cached, opt-in recall briefing provider for desktop agents (`IzziAgent` and
 * `AgentService`). Caches per-scope briefing for `ttlMs` so multi-turn chats
 * don't hit `/recall` on every single message.
 */
export class AgentRecallContextProvider {
  private cache = new Map<string, { briefing: string; expiresAt: number }>();

  constructor(
    private readonly transport: Pick<MemoryLoopTransport, 'recallMemory'>,
    private readonly isRecallEnabled: () => boolean = () => true,
    private readonly ttlMs = 5 * 60 * 1000,
  ) {}

  async getBriefing(opts: {
    scopeKey: string;
    queryText?: string;
    featureSpec?: string;
    maxChars?: number;
  }): Promise<string> {
    if (!this.isRecallEnabled()) return '';

    const key = opts.scopeKey || 'default';
    const now = Date.now();
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.briefing;
    }

    try {
      const recall = await this.transport.recallMemory({
        queryText: opts.queryText,
        featureSpec: opts.featureSpec,
        limit: 8,
        timeoutMs: 2000,
      });
      const briefing = formatRecallBriefing(recall, { maxChars: opts.maxChars ?? 3000 });
      this.cache.set(key, { briefing, expiresAt: now + this.ttlMs });
      return briefing;
    } catch {
      return '';
    }
  }

  invalidate(scopeKey?: string): void {
    if (scopeKey) this.cache.delete(scopeKey);
    else this.cache.clear();
  }
}
