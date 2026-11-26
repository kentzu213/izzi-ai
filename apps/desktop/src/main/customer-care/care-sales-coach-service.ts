/**
 * CareSalesCoachService — Main-process AI Sales Coach & Closed-Loop Lesson Saver.
 *
 * Bridges:
 *  - Active workspace's merchant-approved `Shop Facts` (hard grounding)
 *  - Local `KnowledgeStore` approved sales playbooks & objection counters (Slice A)
 *  - Masked CRM lead signals (Order Layer + consented Profile Layer ONLY)
 *  - Owner-approved cheap reasoning model (`gpt-6-luna` primary, `gpt-4o-mini` fallback)
 *  - Deterministic `auditSalesScriptAgainstFacts` guard (0% hallucinated prices/promos)
 *
 * Privacy & Safety:
 *  - Never writes customer PII to SQLite, `IzziVault`, Cloud MyGraph, or logs.
 *  - Never sends messages automatically to customers (strictly Human-in-the-loop for Salers).
 *  - Stops immediately on HTTP 402 quota errors and degrades smoothly to deterministic fallback.
 *
 * @module main/customer-care/care-sales-coach-service
 */

import type {
  CustomerCareAuthorityLookup,
  CustomerCareCrmRow,
  CustomerCareFact,
  CustomerCareRole,
} from '../../shared/customer-care-types';
import {
  buildCustomerPortrait,
  crmProfileLayerAllowed,
  isCrmRowAdsSuppressed,
  type CrmEnterpriseProduct,
} from '../../shared/customer-crm-enterprise';
import {
  buildFallbackSalesCoachOutput,
  buildSalesCoachPrompt,
  parseSalesCoachModelOutput,
  type SalesCoachResult,
} from '../../shared/sales-script-guard';
import { containsSensitiveMaterial, redactSensitiveText } from '../../shared/secret-pii-gate';
import {
  distillAnonymizedSalesLessons,
  type DistilledSalesLessonCandidate,
} from '../../shared/sales-outcome-distiller';
import {
  retrieveSalesPlaybookKnowledge,
  type LocalKnowledgeRecallReader,
} from '../agents/hybrid-context-assembler';
import type { KnowledgeStore } from '../knowledge/knowledge-store';
import {
  AGENT_PROFILE_FALLBACK_MODEL,
  AGENT_PROFILE_MODEL,
  type AgentProfileChat,
} from '../agents/memory/agent-profile-service';

const ALLOWED_ROLES: ReadonlySet<CustomerCareRole> = new Set(['owner', 'manager', 'editor']);
const CALL_TIMEOUT_MS = 45_000;
const QUOTA_RE = /\b402\b|insufficient|quota/i;

export interface CareSalesCoachServiceOptions {
  resolveAuthority: () => Promise<CustomerCareAuthorityLookup>;
  readApprovedFacts: () => Promise<CustomerCareFact[]>;
  knowledgeStore: Pick<KnowledgeStore, 'capture' | 'recall'> & LocalKnowledgeRecallReader;
  chat: AgentProfileChat;
  onKnowledgeMutated?: () => void;
  now?: () => number;
}

export interface SaveSalesLessonInput {
  title: string;
  summary: string;
  topicKey?: string;
  kind?: 'lesson' | 'procedure' | 'pitfall';
}

export class CareSalesCoachService {
  private readonly now: () => number;

  constructor(private readonly options: CareSalesCoachServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  async generateScript(input: unknown): Promise<SalesCoachResult> {
    const authority = await this.options.resolveAuthority();
    if (authority === null) {
      return { ok: false, error: 'auth', message: 'Vui lòng đăng nhập để dùng Trợ lý Kịch bản Sale.' };
    }
    if (authority === 'unavailable') {
      return { ok: false, error: 'unavailable', message: 'Không kết nối được quyền workspace. Thử lại sau.' };
    }
    if (!ALLOWED_ROLES.has(authority.role)) {
      return { ok: false, error: 'forbidden', message: 'Tài khoản của bạn chỉ có quyền xem, không tạo kịch bản CRM.' };
    }

    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { ok: false, error: 'invalid_request', message: 'Thiếu dữ liệu khách hàng.' };
    }
    const payload = input as {
      row?: CustomerCareCrmRow;
      products?: CrmEnterpriseProduct[];
      identityEnabled?: boolean;
    };
    const row = payload.row;
    if (!row || typeof row !== 'object' || typeof row.leadId !== 'string' || !row.profile) {
      return { ok: false, error: 'invalid_request', message: 'Hồ sơ khách không hợp lệ.' };
    }
    if (row.profile.detailsUnreadable === true || isCrmRowAdsSuppressed(row)) {
      return {
        ok: false,
        error: 'suppressed',
        message: 'Khách này đang ở trạng thái không liên hệ hoặc chưa đọc được hồ sơ — không tạo kịch bản gọi.',
      };
    }

    const products = Array.isArray(payload.products) ? payload.products : [];
    const identityEnabled = Boolean(payload.identityEnabled);
    const nowMs = this.now();

    const approvedFacts = await this.options.readApprovedFacts().catch(() => []);
    const portrait = buildCustomerPortrait(row, products, nowMs, { identityEnabled });
    const vaultPlaybooks = retrieveSalesPlaybookKnowledge(this.options.knowledgeStore, {
      workspaceId: authority.workspaceId,
      persona: crmProfileLayerAllowed(row) ? portrait.layer_5_persona.persona : null,
      stage: row.profile.stage,
      occasion: portrait.layer_4_interests.occasion,
      lostReason: row.profile.lostReason,
      productKeywords: [
        ...portrait.layer_4_interests.matchedProducts.map((p) => p.label),
        ...portrait.layer_4_interests.topicKeywords,
      ],
      limit: 5,
    });

    const fallback = buildFallbackSalesCoachOutput(row, portrait, products, vaultPlaybooks, nowMs);
    const prompt = buildSalesCoachPrompt({ row, portrait, approvedFacts, vaultPlaybooks });

    const models = [AGENT_PROFILE_MODEL, AGENT_PROFILE_FALLBACK_MODEL];
    for (const model of models) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CALL_TIMEOUT_MS);
      try {
        const maxTokens = model === AGENT_PROFILE_MODEL ? 4_200 : 1_200;
        const res = await this.options.chat(
          {
            systemPrompt: prompt.systemPrompt,
            message: prompt.userPrompt,
            model,
            enableTools: false,
            maxTokens,
          },
          controller.signal,
        );
        if (res.error) {
          if (QUOTA_RE.test(res.error)) {
            return { ok: true, data: fallback };
          }
          continue;
        }
        const parsed = parseSalesCoachModelOutput({
          rawReply: res.reply,
          maskedCorpus: prompt.maskedCorpus,
          approvedFacts,
          vaultPlaybooks,
        });
        if (parsed) {
          return { ok: true, data: parsed };
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : '';
        if (QUOTA_RE.test(msg)) {
          return { ok: true, data: fallback };
        }
      } finally {
        clearTimeout(timer);
      }
    }

    // Graceful deterministic fallback (works 100% offline or when model is busy).
    return { ok: true, data: fallback };
  }

  /**
   * Save an anonymized, 0%-PII sales lesson/objection counter into Local `KnowledgeStore`
   * (`state: 'candidate'`, `sensitivity: 'local'`) for owner approval in `Hộp duyệt`.
   */
  async saveSalesLesson(input: unknown): Promise<{ ok: true; recordId: string } | { ok: false; error: string }> {
    const authority = await this.options.resolveAuthority();
    if (authority === null || authority === 'unavailable') {
      return { ok: false, error: 'Vui lòng đăng nhập để lưu kinh nghiệm bán hàng.' };
    }
    if (!ALLOWED_ROLES.has(authority.role)) {
      return { ok: false, error: 'Bạn không có quyền lưu kinh nghiệm bán hàng.' };
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { ok: false, error: 'Dữ liệu kinh nghiệm không hợp lệ.' };
    }
    const raw = input as Partial<SaveSalesLessonInput>;
    const rawTitle = typeof raw.title === 'string' ? raw.title.trim() : '';
    const rawSummary = typeof raw.summary === 'string' ? raw.summary.trim() : '';
    if (rawTitle.length < 4 || rawSummary.length < 8) {
      return { ok: false, error: 'Tiêu đề và nội dung kinh nghiệm quá ngắn.' };
    }

    // Fail-closed: refuse any raw phone, email, Zalo link, card, or API key!
    if (containsSensitiveMaterial({ title: rawTitle, summary: rawSummary })) {
      return {
        ok: false,
        error: 'Bị chặn: kinh nghiệm bán hàng không được chứa SĐT, email, link Zalo, số thẻ hay API key.',
      };
    }

    const kind = raw.kind === 'procedure' || raw.kind === 'pitfall' ? raw.kind : 'lesson';
    const cleanTitle = redactSensitiveText(rawTitle).text.slice(0, 150);
    const cleanSummary = redactSensitiveText(rawSummary).text.slice(0, 1100);
    const slug = (typeof raw.topicKey === 'string' && raw.topicKey.trim()
      ? raw.topicKey.trim()
      : cleanTitle)
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9:-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80);
    const topicKey = slug.startsWith('sales-') ? slug : `sales-lesson:${slug || 'general'}`;

    try {
      const record = this.options.knowledgeStore.capture({
        scope: 'project',
        workspaceId: authority.workspaceId,
        kind,
        title: cleanTitle,
        summary: cleanSummary,
        topicKey,
        source: { type: 'user', uri: `user://sales-coach/${new Date(this.now()).toISOString().slice(0, 10)}` },
        author: 'sales-coach',
        evidence: 'direct',
        confidence: 0.9,
        sensitivity: 'local',
      });
      this.options.onKnowledgeMutated?.();
      return { ok: true, recordId: record.id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Không lưu được kinh nghiệm.' };
    }
  }

  /**
   * Closed-loop anonymized outcome distillation: extracts recurring 0%-PII sales
   * patterns (`n >= 3`) from CRM rows and queues them as `candidate` items in `Hộp duyệt`.
   */
  async distillLessonsFromCrm(input: unknown): Promise<
    | { ok: true; queuedCount: number; candidates: DistilledSalesLessonCandidate[] }
    | { ok: false; error: string }
  > {
    const authority = await this.options.resolveAuthority();
    if (authority === null || authority === 'unavailable') {
      return { ok: false, error: 'Vui lòng đăng nhập để chưng cất kinh nghiệm bán hàng.' };
    }
    if (!ALLOWED_ROLES.has(authority.role)) {
      return { ok: false, error: 'Bạn không có quyền chưng cất kinh nghiệm bán hàng.' };
    }
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      return { ok: false, error: 'Thiếu dữ liệu CRM để phân tích.' };
    }
    const payload = input as {
      rows?: CustomerCareCrmRow[];
      products?: CrmEnterpriseProduct[];
      identityEnabled?: boolean;
    };
    const rows = Array.isArray(payload.rows) ? payload.rows : [];
    const products = Array.isArray(payload.products) ? payload.products : [];
    const identityEnabled = Boolean(payload.identityEnabled);

    const candidates = distillAnonymizedSalesLessons(rows, {
      products,
      identityEnabled,
      nowMs: this.now(),
      minSampleCount: 3,
    });

    let queuedCount = 0;
    const isoNow = new Date(this.now()).toISOString();
    for (const cand of candidates) {
      try {
        this.options.knowledgeStore.capture({
          scope: 'project',
          workspaceId: authority.workspaceId,
          kind: cand.kind,
          title: cand.title,
          summary: cand.summary,
          topicKey: cand.topicKey,
          source: { type: 'inference', uri: `crm://outcome-distiller/${authority.workspaceId}/${isoNow.slice(0, 10)}` },
          author: 'sales-outcome-distiller',
          evidence: 'derived',
          confidence: cand.confidence,
          sensitivity: 'local',
        });
        queuedCount += 1;
      } catch {
        // Deduplicated or failed validation -> skip safely.
      }
    }

    if (queuedCount > 0) {
      this.options.onKnowledgeMutated?.();
    }
    return { ok: true, queuedCount, candidates };
  }
}
