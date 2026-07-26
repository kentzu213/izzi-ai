export type MarketingHealth = 'ready' | 'attention' | 'blocked' | 'unknown';

export interface MarketingBacklogSummary {
  total: number;
  done: number;
  inProgress: number;
  external: number;
  completionPercent: number;
}

export interface MarketingContentSummary {
  total: number;
  approved: number;
  scheduled: number;
  published: number;
  warnings: number;
}

export interface MarketingQualitySummary {
  seoQualityPassed: number;
  seoTotal: number;
  seoPublished: number;
  caseStudyDrafts: number;
  caseStudyTotal: number;
  caseStudyPublishReady: number;
  proofAvailable: number;
  proofTotal: number;
}

export interface MarketingSpendSummary {
  monthlyBudgetVnd: number;
  actualSpendVnd: number;
  verifiedZeroSpendEntries: number;
}

export interface MarketingCampaignItem {
  id: string;
  day: number;
  date: string;
  phase: string;
  persona: string;
  platforms: string[];
  format: string;
  hook: string;
  cta: string;
  approvalStatus: string;
  publishStatus: string;
  proofStatus: string;
}

export interface MarketingReviewItem {
  id: string;
  type: 'social' | 'seo' | 'case-study';
  title: string;
  status: string;
  recommendation: string;
  warnings: number;
  sourcePath: string;
}

export interface MarketingHumanGate {
  id: string;
  sourceId: string;
  kind: 'case-study' | 'seo' | 'spend';
  status: string;
  sourcePath: string;
  detail: string;
  externalActionsAllowed: boolean;
  decision?: string;
  reviewer?: string;
  reviewDate?: string;
  notes?: string;
}

export interface MarketingPlatformReadiness {
  platform: 'telegram' | 'facebook' | 'youtube' | 'x' | 'tiktok' | 'seo';
  health: MarketingHealth;
  recommendation: string;
  checkedAt?: string;
}

export interface MarketingVideoJob {
  id: string;
  title: string;
  status: string;
  projectPath: string;
  provider: string;
  format: string;
  updatedAt?: string;
  renderApproved: boolean;
  commercialUseAllowed: boolean;
  license?: string;
}

export interface MarketingToolchainStatus {
  hyperframesInstalled: boolean;
  hyperframesVersion?: string;
  ffmpegConfigured: boolean;
  ffmpegBinPath?: string;
  templateConfigured: boolean;
  f5Configured: boolean;
  f5Provider?: string;
  f5ModelLicense?: string;
  commercialRenderAllowed: boolean;
  blockingReason?: string;
}

export interface MarketingSafetyGate {
  id: string;
  label: string;
  health: MarketingHealth;
  detail: string;
}

export interface MarketingWorkspaceSnapshot {
  connected: boolean;
  workspacePath?: string;
  workspaceName?: string;
  generatedAt: string;
  error?: string;
  backlog: MarketingBacklogSummary;
  content: MarketingContentSummary;
  quality: MarketingQualitySummary;
  spend: MarketingSpendSummary;
  campaigns: MarketingCampaignItem[];
  reviews: MarketingReviewItem[];
  humanGates: MarketingHumanGate[];
  platforms: MarketingPlatformReadiness[];
  videoJobs: MarketingVideoJob[];
  toolchain: MarketingToolchainStatus;
  gates: MarketingSafetyGate[];
}

export interface MarketingPathSelectionResult {
  canceled: boolean;
  snapshot?: MarketingWorkspaceSnapshot;
  error?: string;
}


