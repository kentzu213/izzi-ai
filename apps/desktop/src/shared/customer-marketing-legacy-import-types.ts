import type { CustomerMarketingBridgeStatus } from './customer-marketing-types';

export const CUSTOMER_MARKETING_LEGACY_COLLECTIONS = [
  'socialAccounts',
  'campaigns',
  'posts',
  'schedules',
  'mediaAssets',
  'templates',
  'hashtagSets',
  'rssSources',
  'analytics',
] as const;

export type CustomerMarketingLegacyCollection = (typeof CUSTOMER_MARKETING_LEGACY_COLLECTIONS)[number];

export type CustomerMarketingLegacyImportIssueCode =
  | 'duplicate_id'
  | 'broken_reference'
  | 'platform_mismatch'
  | 'unsupported_platform';

export interface CustomerMarketingLegacyImportPreview {
  selectionId: string;
  fileName: string;
  manifestDigest: string;
  source: {
    application: '@auto-post/api';
    appVersion: string;
    exportedAt: string;
    workspaceName: string;
  };
  counts: Record<CustomerMarketingLegacyCollection, number>;
  plan: {
    migrate: { campaigns: number; content: number; schedules: number };
    reconnect: { accounts: number };
    reupload: { media: number };
    review: { records: number };
  };
  ready: boolean;
  issues: Array<{ code: CustomerMarketingLegacyImportIssueCode; count: number }>;
}

export interface CustomerMarketingLegacyImportResult {
  ok: boolean;
  status: CustomerMarketingBridgeStatus;
  preview: CustomerMarketingLegacyImportPreview | null;
  error?: string;
}

export type CustomerMarketingLegacyImportSelectionResult =
  | { canceled: true }
  | ({ canceled: false } & CustomerMarketingLegacyImportResult);

export interface CustomerMarketingLegacyImportConfirmedInput {
  selectionId: string;
  confirmed: true;
}

export interface CustomerMarketingLegacyImportReceiptCounts {
  campaigns: number;
  content: number;
  accountReconnectTasks: number;
  mediaReuploadTasks: number;
  scheduleReconnectTasks: number;
  recordReviewTasks: number;
}

export interface CustomerMarketingLegacyImportReceiptSummary {
  status: 'applied';
  duplicate: boolean;
  schemaVersion: 'izzi-auto-post-migration.v1';
  mapperVersion: string;
  counts: CustomerMarketingLegacyImportReceiptCounts;
  occurredAt: string;
}

export interface CustomerMarketingLegacyImportMutationResult {
  ok: boolean;
  status: CustomerMarketingBridgeStatus;
  receipt: CustomerMarketingLegacyImportReceiptSummary | null;
  reconciled: boolean;
  reconciliationRequired: boolean;
  error?: string;
}

const SELECTION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseCustomerMarketingLegacyImportConfirmedInput(
  value: unknown,
): CustomerMarketingLegacyImportConfirmedInput | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input).sort();
  if (
    keys.length !== 2
    || keys[0] !== 'confirmed'
    || keys[1] !== 'selectionId'
    || input.confirmed !== true
    || typeof input.selectionId !== 'string'
    || !SELECTION_ID_PATTERN.test(input.selectionId)
  ) return null;
  return { selectionId: input.selectionId, confirmed: true };
}
