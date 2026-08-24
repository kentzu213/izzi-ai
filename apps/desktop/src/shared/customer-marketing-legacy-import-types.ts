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
