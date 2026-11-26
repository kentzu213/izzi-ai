/**
 * Deterministic Daily Saler Triage & Work Queue Planner (`care-daily-triage`).
 * Pure TypeScript, runtime-agnostic — reuses `buildCustomerPortrait`,
 * `buildSalerPlaybook`, `buildLifecyclePlan`, and `CRM_STALE_UNCALLED_MS`.
 *
 * Security & Compliance:
 *  - Strictly skips `isCrmRowAdsSuppressed` and `detailsUnreadable` leads (fail-closed).
 *  - `markdownSummary` carries aggregate counts and Saler workload ONLY — 0% customer PII.
 *
 * @module shared/care-daily-triage
 */

import type {
  CustomerCareCrmCareStep,
  CustomerCareCrmRow,
  CustomerCareCrmSalerMember,
  CustomerCareCrmStage,
} from './customer-care-types';
import {
  buildCustomerPortrait,
  buildLifecyclePlan,
  buildSalerPlaybook,
  isCrmRowAdsSuppressed,
  type CrmEnterpriseProduct,
  type CrmSalerPriorityBand,
} from './customer-crm-enterprise';
import {
  CRM_STALE_UNCALLED_MS,
  resolveEffectiveCareStep,
} from './customer-crm-saler-routing';

export type DailyTriageBucket = 'urgent' | 'followup' | 'lifecycle';

export interface DailyTriageEntry {
  leadId: string;
  bucket: DailyTriageBucket;
  priorityScore: number;
  priorityBand: CrmSalerPriorityBand;
  salerId: string | null;
  salerName: string;
  stage: CustomerCareCrmStage;
  careStep: CustomerCareCrmCareStep;
  reason: string;
  suggestedNextStep: string;
  suggestedDueIso: string;
  channelLabel: string;
}

export interface DailySalerWorkload {
  salerId: string | null;
  salerName: string;
  urgent: number;
  followup: number;
  lifecycle: number;
  total: number;
}

export interface DailySalesTriagePlan {
  generatedAt: string;
  totalActiveLeads: number;
  suppressedSkipped: number;
  urgentCount: number;
  followupCount: number;
  lifecycleCount: number;
  urgent: DailyTriageEntry[];
  followup: DailyTriageEntry[];
  lifecycle: DailyTriageEntry[];
  bySaler: DailySalerWorkload[];
  /** Zero-PII operational digest safe for owner briefing or Director handoff. */
  markdownSummary: string;
}

export interface BuildDailyTriageOptions {
  products?: readonly CrmEnterpriseProduct[];
  salers?: readonly CustomerCareCrmSalerMember[];
  identityEnabled?: boolean;
  nowMs?: number;
  maxPerBucket?: number;
}

const HOUR_MS = 60 * 60 * 1000;
const MESSENGER_WINDOW_MS = 23 * HOUR_MS;

function resolveSalerName(
  salerId: string | null | undefined,
  salersById: ReadonlyMap<string, CustomerCareCrmSalerMember>,
): { id: string | null; name: string } {
  if (!salerId) return { id: null, name: 'Chưa chia Saler' };
  const member = salersById.get(salerId);
  return member ? { id: member.id, name: member.name } : { id: salerId, name: 'Chưa rõ Saler' };
}

function channelLabelFor(row: CustomerCareCrmRow, nowMs: number): string {
  const lastMs = Date.parse(row.lastMessageAt);
  if (Number.isFinite(lastMs) && nowMs - lastMs < MESSENGER_WINDOW_MS) {
    return 'Messenger (<24h) / Zalo';
  }
  return row.zaloMentioned ? 'Ưu tiên Zalo / Gọi điện' : 'Gọi điện / Zalo';
}

/**
 * Deterministically classify and rank today's CRM workload into 3 actionable queues:
 *  - `urgent`    (🔴 Gọi/Nhắn ngay: hot >= 75đ, uncalled > 2h SLA, or overdue nextStep)
 *  - `followup`  (🟡 Bám đuổi tư vấn: warm/normal open leads in has_phone / consulting)
 *  - `lifecycle` (🟢 Hậu mãi N+1/N+7/N+30 & Remarketing khách chưa chốt hợp lệ)
 */
export function buildDailySalesTriage(
  rows: readonly CustomerCareCrmRow[],
  options: BuildDailyTriageOptions = {},
): DailySalesTriagePlan {
  const nowMs = options.nowMs ?? Date.now();
  const products = options.products ?? [];
  const identityEnabled = Boolean(options.identityEnabled);
  const maxPerBucket = Math.max(5, Math.min(options.maxPerBucket ?? 50, 200));

  const salersById = new Map<string, CustomerCareCrmSalerMember>();
  for (const s of options.salers ?? []) salersById.set(s.id, s);

  const lifecycleByLead = new Map<string, { label: string; nextStep: string; dueIso: string; channelLabel: string; isOverdue: boolean }>();
  for (const item of buildLifecyclePlan(rows, products, nowMs, { identityEnabled })) {
    const prev = lifecycleByLead.get(item.leadId);
    if (!prev || (item.isOverdue && !prev.isOverdue)) {
      lifecycleByLead.set(item.leadId, {
        label: item.milestoneLabel,
        nextStep: item.suggestedNextStep,
        dueIso: item.suggestedDueIso,
        channelLabel: item.channelLabel,
        isOverdue: item.isOverdue,
      });
    }
  }

  let suppressedSkipped = 0;
  let totalActiveLeads = 0;
  const urgentAll: DailyTriageEntry[] = [];
  const followupAll: DailyTriageEntry[] = [];
  const lifecycleAll: DailyTriageEntry[] = [];
  const workloadMap = new Map<string, DailySalerWorkload>();

  const bumpWorkload = (saler: { id: string | null; name: string }, bucket: DailyTriageBucket) => {
    const key = saler.id ?? '__unassigned__';
    const cur = workloadMap.get(key) ?? {
      salerId: saler.id,
      salerName: saler.name,
      urgent: 0,
      followup: 0,
      lifecycle: 0,
      total: 0,
    };
    cur[bucket] += 1;
    cur.total += 1;
    workloadMap.set(key, cur);
  };

  for (const row of rows) {
    if (row.profile.detailsUnreadable === true || isCrmRowAdsSuppressed(row)) {
      suppressedSkipped += 1;
      continue;
    }

    const portrait = buildCustomerPortrait(row, products, nowMs, { identityEnabled });
    const playbook = buildSalerPlaybook(row, portrait, products, nowMs);
    if (!playbook.canContact) {
      suppressedSkipped += 1;
      continue;
    }

    totalActiveLeads += 1;
    const careStep = resolveEffectiveCareStep(row);
    const saler = resolveSalerName(row.profile.salerId, salersById);
    const capturedMs = Date.parse(row.phoneCapturedAt);
    const dueMs = row.profile.nextStepDueAt ? Date.parse(row.profile.nextStepDueAt) : Number.NaN;
    const isOverdue = Number.isFinite(dueMs) && dueMs <= nowMs;
    const isUncalledStale =
      careStep === 'step1_uncalled' &&
      row.profile.stage === 'has_phone' &&
      Number.isFinite(capturedMs) &&
      nowMs - capturedMs >= CRM_STALE_UNCALLED_MS;
    const lc = lifecycleByLead.get(row.leadId);

    let bucket: DailyTriageBucket | null = null;
    let reason = '';
    let suggestedNextStep = playbook.suggestedNextStep;
    let suggestedDueIso = playbook.suggestedDueIso;
    let channelLabel = channelLabelFor(row, nowMs);

    if (row.profile.stage === 'deposit' || row.profile.stage === 'delivered' || row.profile.stage === 'lost') {
      if (lc) {
        bucket = 'lifecycle';
        reason = lc.label;
        suggestedNextStep = lc.nextStep;
        suggestedDueIso = lc.dueIso;
        channelLabel = lc.channelLabel;
      } else if (row.profile.stage === 'deposit') {
        bucket = isOverdue ? 'urgent' : 'followup';
        reason = isOverdue ? 'Đã cọc · Quá hạn xác nhận lịch giao' : 'Đã cọc · Theo dõi xác nhận giao lắp';
      }
    } else if (playbook.priorityScore >= 75 || isOverdue || isUncalledStale) {
      bucket = 'urgent';
      const tags: string[] = [];
      if (playbook.priorityScore >= 75) tags.push(`Ưu tiên nóng (${playbook.priorityScore}đ)`);
      if (isOverdue) tags.push('Quá hạn lịch hẹn');
      if (isUncalledStale) tags.push('Chưa gọi >2h');
      reason = tags.join(' · ');
    } else {
      bucket = 'followup';
      reason = careStep === 'step2_no_answer'
        ? 'Chưa nghe máy · Nhắn Zalo / gọi lại khung giờ khác'
        : lc
          ? lc.label
          : `Đang mở (${row.profile.stage === 'consulting' ? 'Đang tư vấn' : 'Có số'})`;
    }

    if (!bucket) continue;

    const entry: DailyTriageEntry = {
      leadId: row.leadId,
      bucket,
      priorityScore: playbook.priorityScore,
      priorityBand: playbook.priorityBand,
      salerId: saler.id,
      salerName: saler.name,
      stage: row.profile.stage,
      careStep,
      reason,
      suggestedNextStep,
      suggestedDueIso,
      channelLabel,
    };

    if (bucket === 'urgent') urgentAll.push(entry);
    else if (bucket === 'followup') followupAll.push(entry);
    else lifecycleAll.push(entry);
    bumpWorkload(saler, bucket);
  }

  const sortEntries = (a: DailyTriageEntry, b: DailyTriageEntry) =>
    b.priorityScore - a.priorityScore || a.suggestedDueIso.localeCompare(b.suggestedDueIso);
  urgentAll.sort(sortEntries);
  followupAll.sort(sortEntries);
  lifecycleAll.sort(sortEntries);

  const bySaler = [...workloadMap.values()].sort((a, b) => b.urgent - a.urgent || b.total - a.total);
  const generatedAt = new Date(nowMs).toISOString();

  const summaryLines = [
    `# Kế hoạch Chăm sóc Sale (${generatedAt.slice(0, 10)})`,
    `- Tổng khách đang chăm sóc: **${totalActiveLeads}** (đã loại trừ ${suppressedSkipped} khách không liên hệ/không đọc được).`,
    `- 🔴 Gọi/Nhắn ngay: **${urgentAll.length}** · 🟡 Bám đuổi tư vấn: **${followupAll.length}** · 🟢 Hậu mãi & Remarketing: **${lifecycleAll.length}**.`,
    ...(bySaler.length > 0
      ? [
          '',
          '## Phân bổ theo Saler',
          ...bySaler.slice(0, 12).map(
            (s) => `- **${s.salerName}**: ${s.urgent} gấp · ${s.followup} bám đuổi · ${s.lifecycle} hậu mãi (tổng ${s.total})`,
          ),
        ]
      : []),
  ];

  return {
    generatedAt,
    totalActiveLeads,
    suppressedSkipped,
    urgentCount: urgentAll.length,
    followupCount: followupAll.length,
    lifecycleCount: lifecycleAll.length,
    urgent: urgentAll.slice(0, maxPerBucket),
    followup: followupAll.slice(0, maxPerBucket),
    lifecycle: lifecycleAll.slice(0, maxPerBucket),
    bySaler,
    markdownSummary: summaryLines.join('\n'),
  };
}
