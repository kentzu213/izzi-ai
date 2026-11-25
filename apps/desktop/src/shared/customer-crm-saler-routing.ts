/**
 * Pure Saler auto-routing, 3-step inline care workflow, and supervision matrix engine.
 * Runtime-agnostic (runs identically in Electron main, renderer, and Vitest without Node I/O).
 *
 * @module shared/customer-crm-saler-routing
 */
import {
  CUSTOMER_CARE_CRM_CARE_STEPS,
  CUSTOMER_CARE_CRM_SALER_COLORS,
  type CustomerCareCrmBulkAssignmentItem,
  type CustomerCareCrmCareStep,
  type CustomerCareCrmPageSource,
  type CustomerCareCrmProfileInput,
  type CustomerCareCrmRow,
  type CustomerCareCrmSalerColor,
  type CustomerCareCrmSalerMember,
  type CustomerCareCrmSalerRoutingMode,
  type CustomerCareCrmStage,
} from './customer-care-types';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const VIETNAM_OFFSET_MS = 7 * HOUR_MS;
export const CRM_STALE_UNCALLED_MS = 2 * HOUR_MS;
export const CRM_MAX_QUICK_SALER_NAMES = 50;
export const CRM_MAX_SALER_NAME = 40;
export const CRM_MAX_SALER_PAGES = 50;
export const CRM_BULK_ASSIGN_CHUNK = 500;
export const CRM_SALER_ID_PATTERN = /^[a-z0-9_-]{2,36}$/;

// ---------------------------------------------------------------------------
// 1. High-contrast Pancake / HubSpot Color Palette (14 closed tokens)
// ---------------------------------------------------------------------------

export interface CrmSalerColorToken {
  color: CustomerCareCrmSalerColor;
  label: string;
  bg: string;
  border: string;
  text: string;
  softBg: string;
}

export const CRM_SALER_COLOR_PALETTE: Readonly<Record<CustomerCareCrmSalerColor, CrmSalerColorToken>> = {
  maroon: { color: 'maroon', label: 'Đỏ đô', bg: '#881337', border: '#9f1239', text: '#ffffff', softBg: 'rgba(136, 19, 55, 0.16)' },
  crimson: { color: 'crimson', label: 'Đỏ tươi', bg: '#dc2626', border: '#ef4444', text: '#ffffff', softBg: 'rgba(220, 38, 38, 0.16)' },
  orange: { color: 'orange', label: 'Cam', bg: '#c2410c', border: '#ea580c', text: '#ffffff', softBg: 'rgba(194, 65, 12, 0.16)' },
  amber: { color: 'amber', label: 'Vàng đồng', bg: '#b45309', border: '#d97706', text: '#ffffff', softBg: 'rgba(180, 83, 9, 0.16)' },
  green: { color: 'green', label: 'Xanh lá', bg: '#15803d', border: '#16a34a', text: '#ffffff', softBg: 'rgba(21, 128, 61, 0.16)' },
  emerald: { color: 'emerald', label: 'Ngọc lục bảo', bg: '#047857', border: '#059669', text: '#ffffff', softBg: 'rgba(4, 120, 87, 0.16)' },
  teal: { color: 'teal', label: 'Xanh ngọc', bg: '#0f766e', border: '#0d9488', text: '#ffffff', softBg: 'rgba(15, 118, 110, 0.16)' },
  sky: { color: 'sky', label: 'Xanh trời', bg: '#0369a1', border: '#0284c7', text: '#ffffff', softBg: 'rgba(3, 105, 161, 0.16)' },
  blue: { color: 'blue', label: 'Xanh dương', bg: '#1d4ed8', border: '#2563eb', text: '#ffffff', softBg: 'rgba(29, 78, 216, 0.16)' },
  indigo: { color: 'indigo', label: 'Chàm', bg: '#4338ca', border: '#4f46e5', text: '#ffffff', softBg: 'rgba(67, 56, 202, 0.16)' },
  purple: { color: 'purple', label: 'Tím', bg: '#7e22ce', border: '#9333ea', text: '#ffffff', softBg: 'rgba(126, 34, 206, 0.16)' },
  pink: { color: 'pink', label: 'Hồng cánh sen', bg: '#be185d', border: '#db2777', text: '#ffffff', softBg: 'rgba(190, 24, 93, 0.16)' },
  brown: { color: 'brown', label: 'Nâu đồng', bg: '#78350f', border: '#92400e', text: '#ffffff', softBg: 'rgba(120, 53, 15, 0.16)' },
  slate: { color: 'slate', label: 'Xám đá', bg: '#334155', border: '#475569', text: '#ffffff', softBg: 'rgba(51, 65, 85, 0.16)' },
};

export interface CrmCareStepMeta {
  step: CustomerCareCrmCareStep;
  label: string;
  shortLabel: string;
  bg: string;
  border: string;
  text: string;
}

export const CRM_CARE_STEP_META: Readonly<Record<CustomerCareCrmCareStep, CrmCareStepMeta>> = {
  step1_uncalled: {
    step: 'step1_uncalled',
    label: 'B1 · Chưa gọi',
    shortLabel: 'Chưa gọi',
    bg: '#1d4ed8',
    border: '#3b82f6',
    text: '#ffffff',
  },
  step1_bad_phone: {
    step: 'step1_bad_phone',
    label: 'Sai số',
    shortLabel: 'Sai số',
    bg: '#be123c',
    border: '#e11d48',
    text: '#ffffff',
  },
  step2_no_answer: {
    step: 'step2_no_answer',
    label: 'B2 · Chưa nghe',
    shortLabel: 'Chưa nghe',
    bg: '#b45309',
    border: '#d97706',
    text: '#ffffff',
  },
  step2_called: {
    step: 'step2_called',
    label: 'B2 · Đã gọi',
    shortLabel: 'Đã gọi',
    bg: '#0369a1',
    border: '#0284c7',
    text: '#ffffff',
  },
  step3_zalo: {
    step: 'step3_zalo',
    label: 'B3 · Đã KB Zalo',
    shortLabel: 'Đã KB Zalo',
    bg: '#047857',
    border: '#059669',
    text: '#ffffff',
  },
};

export const CRM_CARE_STEP_ORDER: readonly CustomerCareCrmCareStep[] = CUSTOMER_CARE_CRM_CARE_STEPS;

// ---------------------------------------------------------------------------
// 2. Saler Preset & Quick Name Parser
// ---------------------------------------------------------------------------

function foldVietnamese(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .trim();
}

function vietnamDateKey(ms: number): string {
  return new Date(ms + VIETNAM_OFFSET_MS).toISOString().slice(0, 10);
}

/** Generates a valid UUID v4 string without requiring `node:crypto`. */
export function generateSalerId(seedIndex?: number): string {
  if (typeof globalThis.crypto?.randomUUID === 'function' && seedIndex === undefined) {
    return globalThis.crypto.randomUUID();
  }
  const n = seedIndex ?? Math.floor(Math.random() * 0xffffff);
  const tail = ((n >>> 0) % 0xffffffffffff).toString(16).padStart(12, '0');
  return `a0000000-0000-4000-8000-${tail}`;
}

function sliceCodePoints(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : chars.slice(0, max).join('');
}

function buildSalerSlugId(name: string, index: number, usedIds: Set<string>): string {
  const slug = foldVietnamese(name)
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36);
  const base = CRM_SALER_ID_PATTERN.test(slug) ? slug : `saler-${index + 1}`;
  let candidate = base;
  let suffix = 2;
  while (usedIds.has(candidate)) {
    const tag = `-${suffix}`;
    candidate = `${base.slice(0, 36 - tag.length)}${tag}`;
    suffix += 1;
  }
  usedIds.add(candidate);
  return candidate;
}

/** Splits comma, semicolon, or newline-separated saler names cleanly. */
export function parseQuickSalerNames(raw: string): string[] {
  if (typeof raw !== 'string') return [];
  const parts = raw.split(/[\r\n,;]+/);
  const result: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const clean = sliceCodePoints(part.normalize('NFC').replace(/\s+/g, ' ').trim(), CRM_MAX_SALER_NAME).trim();
    if (!clean) continue;
    const key = foldVietnamese(clean);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(clean);
    if (result.length >= CRM_MAX_QUICK_SALER_NAMES) break;
  }
  return result;
}

export interface SalerPageInput {
  pageId: string;
  pageName?: string | null;
  label?: string;
}

const DAI_LONG_PRESET_SPECS: ReadonlyArray<{
  id: string;
  name: string;
  color: CustomerCareCrmSalerColor;
  group: 'dai_long' | 'tranh' | 'hong_hung';
}> = [
  { id: '10000000-0000-4000-8000-000000000001', name: 'Tuấn Thần Đèn', color: 'blue', group: 'dai_long' },
  { id: '10000000-0000-4000-8000-000000000002', name: 'Đại', color: 'orange', group: 'dai_long' },
  { id: '10000000-0000-4000-8000-000000000003', name: 'Nga', color: 'pink', group: 'dai_long' },
  { id: '10000000-0000-4000-8000-000000000004', name: 'Hà My', color: 'purple', group: 'tranh' },
  { id: '10000000-0000-4000-8000-000000000005', name: 'Hoa', color: 'emerald', group: 'tranh' },
  { id: '10000000-0000-4000-8000-000000000006', name: 'Trang', color: 'teal', group: 'tranh' },
  { id: '10000000-0000-4000-8000-000000000007', name: 'Thanh Tùng', color: 'indigo', group: 'hong_hung' },
  { id: '10000000-0000-4000-8000-000000000008', name: 'Uyên', color: 'amber', group: 'hong_hung' },
];

function matchPageByGroup(pages: readonly SalerPageInput[]): Record<'dai_long' | 'tranh' | 'hong_hung', string[]> {
  const result: Record<'dai_long' | 'tranh' | 'hong_hung', string[]> = {
    dai_long: [],
    tranh: [],
    hong_hung: [],
  };
  for (const page of pages) {
    const folded = foldVietnamese(page.pageName ?? page.label ?? '');
    if (!folded) continue;
    if (folded.includes('hong hung')) {
      result.hong_hung.push(page.pageId);
    } else if (folded.includes('tranh')) {
      result.tranh.push(page.pageId);
    } else if (folded.includes('dai long') || folded.includes('do dong')) {
      result.dai_long.push(page.pageId);
    }
  }
  return result;
}

/**
 * 1-click preset builder for standard bronze-craft workshop sales teams,
 * automatically mapping each saler to matching Facebook Pages when present.
 */
export function buildDefaultDaiLongSalerPreset(
  pages: readonly (CustomerCareCrmPageSource | SalerPageInput)[] = [],
): CustomerCareCrmSalerMember[] {
  const byGroup = matchPageByGroup(pages);
  return DAI_LONG_PRESET_SPECS.map((spec) => ({
    id: spec.id,
    name: spec.name,
    color: spec.color,
    active: true,
    assignedPageIds: byGroup[spec.group].slice(0, CRM_MAX_SALER_PAGES),
    memberUserId: null,
  }));
}

/** Creates new Saler members from comma/newline-separated names, avoiding color collisions with existing members. */
export function buildQuickSalersFromNames(
  namesRaw: string,
  existing: readonly CustomerCareCrmSalerMember[] = [],
): CustomerCareCrmSalerMember[] {
  const names = parseQuickSalerNames(namesRaw);
  const existingKeys = new Set(existing.map((item) => foldVietnamese(item.name)));
  const usedIds = new Set(existing.map((item) => item.id));
  const created: CustomerCareCrmSalerMember[] = [];
  let colorCursor = existing.length;
  for (const [index, name] of names.entries()) {
    const key = foldVietnamese(name);
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    const color = CUSTOMER_CARE_CRM_SALER_COLORS[colorCursor % CUSTOMER_CARE_CRM_SALER_COLORS.length]!;
    colorCursor += 1;
    created.push({
      id: buildSalerSlugId(name, index, usedIds),
      name,
      color,
      active: true,
      assignedPageIds: [],
      memberUserId: null,
    });
  }
  return created;
}

export function createSalerMember(
  name: string,
  existing: readonly CustomerCareCrmSalerMember[] = [],
): CustomerCareCrmSalerMember {
  const color = CUSTOMER_CARE_CRM_SALER_COLORS[existing.length % CUSTOMER_CARE_CRM_SALER_COLORS.length]!;
  const cleanName = sliceCodePoints(name.normalize('NFC').replace(/\s+/g, ' ').trim(), CRM_MAX_SALER_NAME).trim();
  return {
    id: generateSalerId(),
    name: cleanName || `Saler ${existing.length + 1}`,
    color,
    active: true,
    assignedPageIds: [],
    memberUserId: null,
  };
}

// ---------------------------------------------------------------------------
// 3. 3-Step Workflow Resolution & 1-Tap Transitions
// ---------------------------------------------------------------------------

export type CrmCareStepAction =
  | CustomerCareCrmCareStep
  | 'won'
  | 'lost';

const WON_STAGES: readonly CustomerCareCrmStage[] = ['deposit', 'delivered'];
const CLOSED_LOCKED_STAGES: readonly CustomerCareCrmStage[] = ['deposit', 'delivered', 'lost', 'do_not_contact'];

export function isWonStage(stage: CustomerCareCrmStage): boolean {
  return WON_STAGES.includes(stage);
}

/** Resolves effective 3-step state for any row, including legacy 11-key profiles without `careStep`. */
export function resolveEffectiveCareStepFromProfile(
  profile: Pick<CustomerCareCrmProfileInput, 'stage' | 'careStep' | 'callTries' | 'nextStep' | 'lostReason'>,
): CustomerCareCrmCareStep {
  if (profile.careStep && CUSTOMER_CARE_CRM_CARE_STEPS.includes(profile.careStep)) {
    return profile.careStep;
  }
  if (profile.stage === 'deposit' || profile.stage === 'delivered') {
    return 'step3_zalo';
  }
  if (profile.stage === 'has_phone') {
    return 'step1_uncalled';
  }
  if (profile.stage === 'consulting') {
    const next = foldVietnamese(profile.nextStep ?? '');
    if (next.includes('chua nghe') || next.includes('khong nghe')) return 'step2_no_answer';
    return 'step2_called';
  }
  return (profile.callTries ?? 0) > 0 ? 'step2_called' : 'step1_uncalled';
}

export function resolveEffectiveCareStep(row: Pick<CustomerCareCrmRow, 'profile'>): CustomerCareCrmCareStep {
  return resolveEffectiveCareStepFromProfile(row.profile);
}

export function isStaleUncalledRow(row: Pick<CustomerCareCrmRow, 'phoneCapturedAt' | 'profile'>, nowMs: number): boolean {
  if (row.profile.stage !== 'has_phone') return false;
  if (resolveEffectiveCareStep(row) !== 'step1_uncalled') return false;
  const capturedMs = Date.parse(row.phoneCapturedAt);
  if (!Number.isFinite(capturedMs)) return false;
  return nowMs - capturedMs > CRM_STALE_UNCALLED_MS;
}

export function isRowLockedForRouting(
  row: Pick<CustomerCareCrmRow, 'profile'>,
  protectZaloAndWon: boolean,
): boolean {
  if (row.profile.detailsUnreadable === true) return true;
  if (CLOSED_LOCKED_STAGES.includes(row.profile.stage)) return true;
  if (protectZaloAndWon && resolveEffectiveCareStep(row) === 'step3_zalo') return true;
  return false;
}

/**
 * Applies a 1-tap 3-step transition, keeping `stage`, `careStep`, `callTries`, `nextStep`,
 * `nextStepDueAt`, `lostReason`, and `purchasedAt` strictly compliant with server validation rules.
 */
export function applyCareStepTransition(
  current: CustomerCareCrmProfileInput,
  action: CrmCareStepAction,
  nowMs: number,
): CustomerCareCrmProfileInput {
  const prevTries = Math.max(0, Math.min(9, current.callTries ?? 0));
  switch (action) {
    case 'step1_uncalled':
      return {
        ...current,
        stage: 'has_phone',
        careStep: 'step1_uncalled',
        callTries: prevTries,
        nextStep: 'Gọi lần đầu',
        nextStepDueAt: null,
        lostReason: null,
        purchasedAt: null,
      };
    case 'step1_bad_phone':
      return {
        ...current,
        stage: 'lost',
        careStep: 'step1_bad_phone',
        callTries: Math.min(9, prevTries + 1),
        nextStep: null,
        nextStepDueAt: null,
        lostReason: 'no_reply',
        purchasedAt: null,
      };
    case 'step2_no_answer':
      return {
        ...current,
        stage: 'consulting',
        careStep: 'step2_no_answer',
        callTries: Math.min(9, prevTries + 1),
        nextStep: 'Gọi lại (chưa nghe máy)',
        nextStepDueAt: new Date(nowMs + 2 * HOUR_MS).toISOString(),
        lostReason: null,
        purchasedAt: null,
      };
    case 'step2_called':
      return {
        ...current,
        stage: 'consulting',
        careStep: 'step2_called',
        callTries: Math.min(9, Math.max(1, prevTries + 1)),
        nextStep: 'Kết bạn Zalo gửi mẫu & báo giá',
        nextStepDueAt: new Date(nowMs + 4 * HOUR_MS).toISOString(),
        lostReason: null,
        purchasedAt: null,
      };
    case 'step3_zalo': {
      const won = isWonStage(current.stage);
      return {
        ...current,
        stage: won ? current.stage : 'consulting',
        careStep: 'step3_zalo',
        callTries: Math.max(1, prevTries),
        nextStep: 'Gửi video xưởng & báo giá qua Zalo',
        nextStepDueAt: new Date(nowMs + 24 * HOUR_MS).toISOString(),
        lostReason: null,
        purchasedAt: won ? current.purchasedAt : null,
      };
    }
    case 'won':
      return {
        ...current,
        stage: current.stage === 'delivered' ? 'delivered' : 'deposit',
        careStep: 'step3_zalo',
        callTries: Math.max(1, prevTries),
        nextStep: 'Xác nhận đơn & lịch giao',
        nextStepDueAt: new Date(nowMs + DAY_MS).toISOString(),
        lostReason: null,
        purchasedAt: current.purchasedAt ?? vietnamDateKey(nowMs),
      };
    case 'lost':
      return {
        ...current,
        stage: 'lost',
        careStep: current.careStep ?? resolveEffectiveCareStepFromProfile(current),
        callTries: prevTries,
        nextStep: null,
        nextStepDueAt: null,
        lostReason: current.lostReason ?? 'other',
        purchasedAt: null,
      };
  }
}

// ---------------------------------------------------------------------------
// 4. Auto-Distribution Planner & Dry-Run Preview
// ---------------------------------------------------------------------------

export type CrmAutoDistributionMode = CustomerCareCrmSalerRoutingMode | 'rescue_stale';
export type CrmAutoDistributionScope = 'unassigned' | 'filtered';

export interface PlanSalerDistributionInput {
  rows: readonly CustomerCareCrmRow[];
  salers: readonly CustomerCareCrmSalerMember[];
  mode: CrmAutoDistributionMode;
  sourceScope?: CrmAutoDistributionScope;
  filteredLeadIds?: ReadonlySet<string>;
  rescueSalerId?: string | null;
  protectZaloAndWon?: boolean;
  nowMs: number;
}

export interface SalerDistributionPreviewItem {
  saler: CustomerCareCrmSalerMember;
  beforeCount: number;
  addedCount: number;
  afterCount: number;
  pageBreakdown: Record<string, number>;
}

export interface SalerDistributionPlan {
  assignments: CustomerCareCrmBulkAssignmentItem[];
  bySaler: SalerDistributionPreviewItem[];
  totalCandidates: number;
  skippedLockedCount: number;
}

function effectiveSalerId(row: CustomerCareCrmRow, salersByMember: ReadonlyMap<string, string>): string | null {
  if (row.profile.salerId) return row.profile.salerId;
  if (row.profile.ownerUserId) return salersByMember.get(row.profile.ownerUserId) ?? null;
  return null;
}

export function planSalerAutoDistribution({
  rows,
  salers,
  mode,
  sourceScope = 'unassigned',
  filteredLeadIds,
  rescueSalerId = null,
  protectZaloAndWon = true,
  nowMs,
}: PlanSalerDistributionInput): SalerDistributionPlan {
  const activeSalers = salers.filter((s) => s.active);
  const salersByMember = new Map<string, string>();
  for (const saler of salers) {
    if (saler.memberUserId && !salersByMember.has(saler.memberUserId)) {
      salersByMember.set(saler.memberUserId, saler.id);
    }
  }

  const beforeCounts = new Map<string, number>();
  for (const saler of activeSalers) beforeCounts.set(saler.id, 0);
  for (const row of rows) {
    const ownerSalerId = effectiveSalerId(row, salersByMember);
    if (ownerSalerId && beforeCounts.has(ownerSalerId)) {
      beforeCounts.set(ownerSalerId, (beforeCounts.get(ownerSalerId) ?? 0) + 1);
    }
  }

  const addedCounts = new Map<string, number>();
  const pageBreakdowns = new Map<string, Record<string, number>>();
  for (const saler of activeSalers) {
    addedCounts.set(saler.id, 0);
    pageBreakdowns.set(saler.id, {});
  }

  if (activeSalers.length === 0) {
    return { assignments: [], bySaler: [], totalCandidates: 0, skippedLockedCount: 0 };
  }

  let skippedLockedCount = 0;
  const candidates: CustomerCareCrmRow[] = [];

  for (const row of rows) {
    if (sourceScope === 'filtered' && filteredLeadIds && !filteredLeadIds.has(row.leadId)) {
      continue;
    }

    const rowSalerId = effectiveSalerId(row, salersByMember);

    if (mode === 'rescue_stale') {
      if (isRowLockedForRouting(row, true)) {
        skippedLockedCount += 1;
        continue;
      }
      if (!isStaleUncalledRow(row, nowMs)) continue;
      if (rescueSalerId && rowSalerId !== rescueSalerId) continue;
      const otherTargets = activeSalers.filter((s) => s.id !== rowSalerId);
      if (otherTargets.length === 0) continue;
      candidates.push(row);
      continue;
    }

    if (sourceScope === 'unassigned' && (rowSalerId !== null || row.profile.ownerUserId !== null)) {
      continue;
    }

    if (isRowLockedForRouting(row, protectZaloAndWon)) {
      skippedLockedCount += 1;
      continue;
    }

    candidates.push(row);
  }

  // Sort newest phone first so warm leads interleave evenly across active salers.
  candidates.sort((a, b) => (
    Date.parse(b.phoneCapturedAt) - Date.parse(a.phoneCapturedAt)
    || a.leadId.localeCompare(b.leadId)
  ));

  const salerIndexMap = new Map(activeSalers.map((saler, idx) => [saler.id, idx]));
  const generalSalers = activeSalers.filter((s) => s.assignedPageIds.length === 0);
  const assignments: CustomerCareCrmBulkAssignmentItem[] = [];
  let rrCursor = 0;

  for (const row of candidates) {
    const currentSalerId = effectiveSalerId(row, salersByMember);
    let pool: CustomerCareCrmSalerMember[];

    if (mode === 'rescue_stale') {
      pool = activeSalers.filter((s) => s.id !== currentSalerId);
    } else if (mode === 'by_page') {
      const pageSpecialists = activeSalers.filter((s) => s.assignedPageIds.includes(row.pageId));
      if (pageSpecialists.length > 0) pool = pageSpecialists;
      else if (generalSalers.length > 0) pool = generalSalers;
      else pool = activeSalers;
    } else {
      pool = activeSalers;
    }

    if (pool.length === 0) continue;

    // Pick lowest total load (before + added), breaking ties via round-robin cursor to spread warm leads fairly.
    let chosen = pool[0]!;
    let bestScore = Infinity;
    for (const candidate of pool) {
      const load = (beforeCounts.get(candidate.id) ?? 0) + (addedCounts.get(candidate.id) ?? 0);
      const idx = salerIndexMap.get(candidate.id) ?? 0;
      const rrDistance = (idx - rrCursor + activeSalers.length) % activeSalers.length;
      const score = load * activeSalers.length + rrDistance;
      if (score < bestScore) {
        bestScore = score;
        chosen = candidate;
      }
    }

    rrCursor = ((salerIndexMap.get(chosen.id) ?? 0) + 1) % activeSalers.length;
    addedCounts.set(chosen.id, (addedCounts.get(chosen.id) ?? 0) + 1);
    const breakdown = pageBreakdowns.get(chosen.id)!;
    breakdown[row.pageId] = (breakdown[row.pageId] ?? 0) + 1;

    assignments.push({
      leadId: row.leadId,
      expectedUpdatedAt: row.profile.updatedAt,
      salerId: chosen.id,
      ownerUserId: chosen.memberUserId,
    });
  }

  const bySaler: SalerDistributionPreviewItem[] = activeSalers.map((saler) => {
    const beforeCount = beforeCounts.get(saler.id) ?? 0;
    const addedCount = addedCounts.get(saler.id) ?? 0;
    return {
      saler,
      beforeCount,
      addedCount,
      afterCount: beforeCount + addedCount,
      pageBreakdown: pageBreakdowns.get(saler.id) ?? {},
    };
  });

  return {
    assignments,
    bySaler,
    totalCandidates: candidates.length,
    skippedLockedCount,
  };
}

// ---------------------------------------------------------------------------
// 5. Saler Supervision Matrix
// ---------------------------------------------------------------------------

export interface SalerSupervisionCounts {
  total: number;
  step1Uncalled: number;
  step1StaleOver2h: number;
  step1BadPhone: number;
  step2NoAnswer: number;
  step2Called: number;
  step3Zalo: number;
  wonCount: number;
  zaloRatePct: number;
}

export interface SalerSupervisionRow extends SalerSupervisionCounts {
  saler: CustomerCareCrmSalerMember | null;
}

export interface SalerSupervisionMatrix {
  rows: SalerSupervisionRow[];
  unassigned: SalerSupervisionRow;
  totals: SalerSupervisionCounts;
}

function emptyCounts(): SalerSupervisionCounts {
  return {
    total: 0,
    step1Uncalled: 0,
    step1StaleOver2h: 0,
    step1BadPhone: 0,
    step2NoAnswer: 0,
    step2Called: 0,
    step3Zalo: 0,
    wonCount: 0,
    zaloRatePct: 0,
  };
}

function accumulateRow(bucket: SalerSupervisionCounts, row: CustomerCareCrmRow, nowMs: number): void {
  bucket.total += 1;
  const step = resolveEffectiveCareStep(row);
  if (step === 'step1_uncalled') {
    bucket.step1Uncalled += 1;
    if (isStaleUncalledRow(row, nowMs)) bucket.step1StaleOver2h += 1;
  } else if (step === 'step1_bad_phone') {
    bucket.step1BadPhone += 1;
  } else if (step === 'step2_no_answer') {
    bucket.step2NoAnswer += 1;
  } else if (step === 'step2_called') {
    bucket.step2Called += 1;
  } else if (step === 'step3_zalo') {
    bucket.step3Zalo += 1;
  }
  if (isWonStage(row.profile.stage)) {
    bucket.wonCount += 1;
  }
}

function finalizePct(counts: SalerSupervisionCounts): void {
  counts.zaloRatePct = counts.total > 0 ? Math.round((counts.step3Zalo / counts.total) * 100) : 0;
}

export function buildSalerSupervisionMatrix(
  rows: readonly CustomerCareCrmRow[],
  salers: readonly CustomerCareCrmSalerMember[],
  nowMs: number,
): SalerSupervisionMatrix {
  const byId = new Map<string, SalerSupervisionRow>();
  const salersByMember = new Map<string, string>();
  const matrixRows: SalerSupervisionRow[] = salers.map((saler) => {
    const entry: SalerSupervisionRow = { saler, ...emptyCounts() };
    byId.set(saler.id, entry);
    if (saler.memberUserId && !salersByMember.has(saler.memberUserId)) {
      salersByMember.set(saler.memberUserId, saler.id);
    }
    return entry;
  });
  const unassigned: SalerSupervisionRow = { saler: null, ...emptyCounts() };
  const totals: SalerSupervisionCounts = emptyCounts();

  for (const row of rows) {
    accumulateRow(totals, row, nowMs);
    const sid = effectiveSalerId(row, salersByMember);
    const target = sid ? (byId.get(sid) ?? unassigned) : unassigned;
    accumulateRow(target, row, nowMs);
  }

  for (const entry of matrixRows) finalizePct(entry);
  finalizePct(unassigned);
  finalizePct(totals);

  return { rows: matrixRows, unassigned, totals };
}
