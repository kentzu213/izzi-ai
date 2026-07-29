import type {
  CustomerProductMarketingContextRef,
  CustomerProductMarketingContextSaveInput,
  CustomerProductMarketingContextV1,
} from './customer-marketing-product-context';

export type {
  CustomerProductMarketingContextRef,
  CustomerProductMarketingContextSaveInput,
  CustomerProductMarketingContextV1,
} from './customer-marketing-product-context';

export type CustomerRole = 'owner' | 'manager' | 'editor' | 'reviewer' | 'viewer';

export type CustomerAutomationMode = 'copilot' | 'semi_autonomous' | 'guardrailed_autonomous';
export type CustomerWorkspaceSyncStatus = 'local' | 'synced' | 'unavailable';
export type CustomerProfileSyncStatus = CustomerWorkspaceSyncStatus | 'conflict';
export type CustomerCapabilityCatalogStatus = CustomerWorkspaceSyncStatus | 'forbidden';
export type CustomerMarketingPlan = 'free' | 'starter' | 'pro' | 'max' | 'ultra';
export type CustomerCapabilityPermission = 'view' | 'edit' | 'execute' | 'approve' | 'manage';
export type CustomerCapabilityStability = 'stable' | 'beta' | 'preview';
export type CustomerCapabilityCategory =
  | 'strategy'
  | 'content'
  | 'social'
  | 'creative'
  | 'analytics'
  | 'automation'
  | 'research'
  | 'customer_support';

export type CustomerObjective =
  | 'brand_awareness'
  | 'engagement'
  | 'traffic'
  | 'leads'
  | 'revenue'
  | 'launch'
  | 'community';

export type CustomerChannel =
  | 'facebook'
  | 'tiktok'
  | 'instagram'
  | 'youtube'
  | 'website'
  | 'email'
  | 'crm'
  | 'ads'
  | 'telegram'
  | 'x'
  | 'seo';

export type CustomerRunStatus = 'queued' | 'in_progress' | 'awaiting_approval' | 'ready' | 'completed' | 'blocked';

export type CustomerApprovalStatus = 'pending' | 'approved' | 'rejected';

export type CustomerApprovalKind = 'strategy' | 'media_preview' | 'media_render' | 'media_publish';

export type CustomerMediaJobStatus =
  | 'awaiting_preview_approval'
  | 'checking'
  | 'preview_ready'
  | 'blocked'
  | 'failed';

export type CustomerMediaArtifactKind = 'project_manifest' | 'check_receipt' | 'snapshot';

export type CustomerMediaRuntimeState = 'ready' | 'blocked' | 'needs_setup';

export interface CustomerBusinessProfile {
  name: string;
  industry: string;
  website: string;
  offer: string;
  region: string;
}

export interface CustomerBrandProfile {
  logoUrl: string;
  primaryColor: string;
  accentColor: string;
  font: string;
  tone: string;
  guidelines: string;
  wordsToUse: string[];
  wordsToAvoid: string[];
}

export interface CustomerAudienceProfile {
  segments: string;
  needs: string;
  painPoints: string;
  behaviors: string;
  market: string;
}

export interface CustomerOnboardingProfile {
  business: CustomerBusinessProfile;
  brand: CustomerBrandProfile;
  audience: CustomerAudienceProfile;
  objectives: CustomerObjective[];
  channels: CustomerChannel[];
  resources: string[];
  automationMode: CustomerAutomationMode;
  completedSteps: number[];
  completed: boolean;
  updatedAt: string;
}

export interface CustomerWorkspaceSummary {
  id: string;
  name: string;
  role: CustomerRole;
  plan: string;
  creditBalance: number;
  monthlyQuota: number;
  usedCredits: number;
  syncStatus: CustomerWorkspaceSyncStatus;
  profileSyncStatus: CustomerProfileSyncStatus;
  onboardingComplete: boolean;
  updatedAt: string;
}

export type CustomerAssignableRole = Exclude<CustomerRole, 'owner'>;
export type CustomerWorkspaceMemberStatus = 'active' | 'suspended';

export interface CustomerWorkspaceMember {
  userId: string;
  email: string;
  role: CustomerRole;
  status: CustomerWorkspaceMemberStatus;
  joinedAt: string;
  updatedAt: string;
  isCurrentUser: boolean;
  editableRoles: CustomerAssignableRole[];
}

export interface CustomerWorkspaceMembersResult {
  ok: boolean;
  members: CustomerWorkspaceMember[];
  error?: string;
}

export interface CustomerWorkspaceMemberRoleInput {
  memberUserId: string;
  role: CustomerAssignableRole;
}

export interface CustomerWorkspaceInvitationInput {
  email: string;
  role: CustomerAssignableRole;
}

export interface CustomerWorkspaceInvitationResult {
  ok: boolean;
  email?: string;
  role?: CustomerAssignableRole;
  expiresAt?: string;
  copied: boolean;
  error?: string;
}

export interface CustomerWorkspaceInvitationAcceptanceResult {
  ok: boolean;
  workspaceId?: string;
  role?: CustomerRole;
  pending?: boolean;
  error?: string;
}

export interface CustomerCapability {
  id: string;
  name: string;
  description: string;
  category: CustomerCapabilityCategory;
  role: string;
  source: 'core' | 'extension';
  status: 'available' | 'installed' | 'running' | 'needs_setup';
  automationModes: CustomerAutomationMode[];
  requiredIntegrations: string[];
  minimumPlan: CustomerMarketingPlan;
  permission: CustomerCapabilityPermission;
  stability: CustomerCapabilityStability;
  creditEstimate: {
    minimum: number;
    maximum: number;
    unit: 'credits_per_run';
  };
  inputs: string[];
  outputs: string[];
  extensionId?: string;
}

export interface CustomerCapabilityCatalogSummary {
  status: CustomerCapabilityCatalogStatus;
  revision?: number;
}

export interface CustomerRunStep {
  id: string;
  label: string;
  owner: string;
  status: 'todo' | 'in_progress' | 'done' | 'blocked';
  requiresApproval: boolean;
}

export interface CustomerRun {
  id: string;
  goal: string;
  status: CustomerRunStatus;
  stage: string;
  progress: number;
  steps: CustomerRunStep[];
  productContextRef?: CustomerProductMarketingContextRef;
  directorReply?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerApproval {
  id: string;
  runId: string;
  kind?: CustomerApprovalKind;
  mediaJobId?: string;
  evidenceDigest?: string;
  productContextRef?: CustomerProductMarketingContextRef;
  title: string;
  summary: string;
  risk: 'low' | 'medium' | 'high';
  status: CustomerApprovalStatus;
  requestedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
}

export interface CustomerMediaRuntimeStatus {
  status: CustomerMediaRuntimeState;
  version?: string;
  detail: string;
}

export interface CustomerMediaToolchain {
  hyperframes: CustomerMediaRuntimeStatus;
  node: CustomerMediaRuntimeStatus;
  ffmpeg: CustomerMediaRuntimeStatus;
  f5Tts: CustomerMediaRuntimeStatus;
  voiceStudio: CustomerMediaRuntimeStatus;
  previewAvailable: boolean;
  commercialRenderAvailable: boolean;
}

export interface CustomerMediaVoicePolicy {
  provider: string;
  modelId?: string;
  modelHash?: string;
  license?: string;
  licenseSource?: string;
  commercialUseAllowed: boolean;
  referenceVoiceConsent: boolean;
}

export interface CustomerMediaGates {
  previewApproved: boolean;
  renderApproved: boolean;
  finalQcApproved: boolean;
  publishApproved: boolean;
}

export interface CustomerMediaPreviewReceipt {
  checkedAt: string;
  passed: boolean;
  summary: string;
  snapshotCount: number;
}

export interface CustomerMediaJob {
  id: string;
  projectId: string;
  title: string;
  source: 'local_project';
  status: CustomerMediaJobStatus;
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  sceneCount: number;
  voice: CustomerMediaVoicePolicy;
  gates: CustomerMediaGates;
  preview?: CustomerMediaPreviewReceipt;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerMediaArtifact {
  id: string;
  jobId: string;
  kind: CustomerMediaArtifactKind;
  name: string;
  sha256?: string;
  sizeBytes?: number;
  createdAt: string;
}

export interface CustomerMediaWorkspace {
  toolchain: CustomerMediaToolchain;
  jobs: CustomerMediaJob[];
  artifacts: CustomerMediaArtifact[];
}

export interface CustomerMarketingSnapshot {
  workspace: CustomerWorkspaceSummary;
  onboarding: CustomerOnboardingProfile | null;
  productMarketingContext: CustomerProductMarketingContextV1 | null;
  capabilityCatalog: CustomerCapabilityCatalogSummary;
  capabilities: CustomerCapability[];
  runs: CustomerRun[];
  approvals: CustomerApproval[];
  media: CustomerMediaWorkspace;
  nextActions: string[];
  externalActionsAllowed: boolean;
  generatedAt: string;
}

export interface CustomerOnboardingInput {
  business: CustomerBusinessProfile;
  brand: CustomerBrandProfile;
  audience: CustomerAudienceProfile;
  objectives: CustomerObjective[];
  channels: CustomerChannel[];
  resources: string[];
  automationMode: CustomerAutomationMode;
  completedSteps: number[];
}

export interface CustomerGoalInput {
  goal: string;
  channels?: CustomerChannel[];
  automationMode?: CustomerAutomationMode;
}

export interface CustomerDirectorInput {
  goal: string;
  channels?: CustomerChannel[];
  automationMode?: CustomerAutomationMode;
}

export interface CustomerReviewInput {
  approvalId: string;
  decision: Exclude<CustomerApprovalStatus, 'pending'>;
}

export interface CustomerMediaPreviewInput {
  jobId: string;
}

export interface CustomerMediaProjectSelectionResult {
  canceled: boolean;
  result?: CustomerMutationResult;
  error?: string;
}

export interface CustomerMutationResult {
  ok: boolean;
  snapshot?: CustomerMarketingSnapshot;
  reply?: string;
  error?: string;
}

export type CustomerProductMarketingContextMutationStatus =
  | 'saved'
  | 'conflict'
  | 'forbidden'
  | 'unavailable'
  | 'invalid';

export interface CustomerProductMarketingContextMutationResult {
  ok: boolean;
  status: CustomerProductMarketingContextMutationStatus;
  context: CustomerProductMarketingContextV1 | null;
  snapshot?: CustomerMarketingSnapshot;
  duplicate?: boolean;
  error?: string;
}

export type CustomerMarketingResourceKind = 'campaign' | 'content' | 'asset' | 'knowledge';

export type CustomerMarketingBridgeStatus =
  | 'synced'
  | 'local'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'quota_exceeded'
  | 'unavailable';

export type CustomerMarketingResourceLifecycleStatus =
  | 'draft'
  | 'in_review'
  | 'approved'
  | 'rejected'
  | 'archived';

export type CustomerMarketingMetadataPrimitive = string | number | boolean | null;
export type CustomerMarketingResourceMetadata = Record<string, CustomerMarketingMetadataPrimitive>;

export interface CustomerMarketingResourceBase {
  id: string;
  workspaceId: string;
  kind: CustomerMarketingResourceKind;
  status: CustomerMarketingResourceLifecycleStatus;
  revision: number;
  title: string;
  metadata: CustomerMarketingResourceMetadata;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerMarketingCampaignResource extends CustomerMarketingResourceBase {
  kind: 'campaign';
  description: string | null;
  objective: string | null;
  startsAt: string | null;
  endsAt: string | null;
}

export interface CustomerMarketingContentResource extends CustomerMarketingResourceBase {
  kind: 'content';
  body: string;
  channel: string;
  scheduledAt: string | null;
  campaignId: string | null;
}

export interface CustomerMarketingAssetResource extends CustomerMarketingResourceBase {
  kind: 'asset';
  mimeType: string;
  sizeBytes: number;
  altText: string | null;
  checksum: string | null;
}

export interface CustomerMarketingKnowledgeResource extends CustomerMarketingResourceBase {
  kind: 'knowledge';
  body: string;
  sourceUrl: string | null;
}

export type CustomerMarketingResource =
  | CustomerMarketingCampaignResource
  | CustomerMarketingContentResource
  | CustomerMarketingAssetResource
  | CustomerMarketingKnowledgeResource;

export interface CustomerMarketingCampaignCreateInput {
  kind: 'campaign';
  title: string;
  metadata: CustomerMarketingResourceMetadata;
  description: string | null;
  objective: string | null;
  startsAt: string | null;
  endsAt: string | null;
}

export interface CustomerMarketingContentCreateInput {
  kind: 'content';
  title: string;
  metadata: CustomerMarketingResourceMetadata;
  body: string;
  channel: string;
  scheduledAt: string | null;
  campaignId: string | null;
}

export interface CustomerMarketingAssetCreateInput {
  kind: 'asset';
  title: string;
  metadata: CustomerMarketingResourceMetadata;
  mimeType: string;
  sizeBytes: number;
  altText: string | null;
  checksum: string | null;
}

export interface CustomerMarketingKnowledgeCreateInput {
  kind: 'knowledge';
  title: string;
  metadata: CustomerMarketingResourceMetadata;
  body: string;
  sourceUrl: string | null;
}

export type CustomerMarketingResourceCreateInput =
  | CustomerMarketingCampaignCreateInput
  | CustomerMarketingContentCreateInput
  | CustomerMarketingAssetCreateInput
  | CustomerMarketingKnowledgeCreateInput;

export type CustomerMarketingCampaignPatch = Partial<Omit<CustomerMarketingCampaignCreateInput, 'kind'>>;
export type CustomerMarketingContentPatch = Partial<Omit<CustomerMarketingContentCreateInput, 'kind'>>;
export type CustomerMarketingAssetPatch = Partial<Omit<CustomerMarketingAssetCreateInput, 'kind'>>;
export type CustomerMarketingKnowledgePatch = Partial<Omit<CustomerMarketingKnowledgeCreateInput, 'kind'>>;

export type CustomerMarketingResourceUpdateInput =
  | { kind: 'campaign'; resourceId: string; expectedRevision: number; patch: CustomerMarketingCampaignPatch }
  | { kind: 'content'; resourceId: string; expectedRevision: number; patch: CustomerMarketingContentPatch }
  | { kind: 'asset'; resourceId: string; expectedRevision: number; patch: CustomerMarketingAssetPatch }
  | { kind: 'knowledge'; resourceId: string; expectedRevision: number; patch: CustomerMarketingKnowledgePatch };

export interface CustomerMarketingCalendarInput {
  from: string;
  to: string;
}

export interface CustomerMarketingAnalyticsWindow {
  from: string;
  to: string;
}

export interface CustomerMarketingAnalyticsKindCounts {
  campaign: number;
  content: number;
  asset: number;
  knowledge: number;
}

export interface CustomerMarketingAnalyticsStatusCounts {
  draft: number;
  inReview: number;
  approved: number;
  rejected: number;
  archived: number;
}

export interface CustomerMarketingAnalyticsReport {
  source: 'marketing_resources';
  generatedAt: string;
  window: CustomerMarketingAnalyticsWindow & {
    timeZone: 'UTC';
    activityBasis: 'resource_updated_at';
    scheduleBasis: 'content_scheduled_at';
  };
  inventory: {
    total: number;
    campaigns: number;
    content: number;
    assets: number;
    knowledge: number;
  };
  activity: {
    updatedInWindow: number;
    byKind: CustomerMarketingAnalyticsKindCounts;
    byStatus: CustomerMarketingAnalyticsStatusCounts;
  };
  schedule: {
    contentScheduledInWindow: number;
    byChannel: Array<{ channel: string; count: number }>;
    byStatus: CustomerMarketingAnalyticsStatusCounts;
  };
  attribution: {
    model: 'direct_campaign_id';
    basis: 'content_updated_at';
    contentConsidered: number;
    attributedContent: number;
    unattributedContent: number;
    unresolvedCampaignLinks: number;
    campaigns: Array<{
      campaignId: string;
      title: string;
      contentCount: number;
      scheduledContentCount: number;
    }>;
  };
  dataAvailability: {
    performanceMetrics: {
      status: 'unavailable';
      reason: string;
      omittedMetrics: ['impressions', 'reach', 'clicks', 'conversions', 'revenue'];
    };
  };
}

export type CustomerMarketingReviewAction = 'submit' | 'approve' | 'reject';

export interface CustomerMarketingResourceReviewInput {
  kind: 'campaign' | 'content';
  resourceId: string;
  action: CustomerMarketingReviewAction;
  expectedRevision: number;
}

export interface CustomerMarketingResourceArchiveInput {
  kind: CustomerMarketingResourceKind;
  resourceId: string;
  expectedRevision: number;
}

export interface CustomerMarketingResourceListResult {
  ok: boolean;
  status: CustomerMarketingBridgeStatus;
  resources: CustomerMarketingResource[];
  error?: string;
}

export interface CustomerMarketingAnalyticsResult {
  ok: boolean;
  status: CustomerMarketingBridgeStatus;
  report: CustomerMarketingAnalyticsReport | null;
  error?: string;
}

export interface CustomerMarketingResourceMutationResult {
  ok: boolean;
  status: CustomerMarketingBridgeStatus;
  resource: CustomerMarketingResource | null;
  duplicate?: boolean;
  error?: string;
}

export interface CustomerMarketingResourceArchiveResult {
  ok: boolean;
  status: CustomerMarketingBridgeStatus;
  deleted: boolean;
  error?: string;
}

export type CustomerMarketingWorkflowTarget = 'social' | 'seo' | 'email' | 'crm';
export type CustomerMarketingWorkflowPolicyRevision = 'cmr-306.v1';
export type CustomerMarketingWorkflowAllowedOperation = 'read' | 'draft' | 'validate';
export type CustomerMarketingWorkflowDeniedOperation =
  | 'publish'
  | 'send'
  | 'bulk'
  | 'spend'
  | 'integration.write'
  | 'contacts.write';
export type CustomerMarketingWorkflowRequestedOperation =
  | CustomerMarketingWorkflowAllowedOperation
  | CustomerMarketingWorkflowDeniedOperation;
export type CustomerMarketingWorkflowDecision = 'approved' | 'rejected';
export type CustomerMarketingWorkflowReviewStatus = 'pending' | CustomerMarketingWorkflowDecision;

/** Public, persisted resource identity. It deliberately carries no body, path, or integration data. */
export interface CustomerMarketingPersistedResourceRef {
  id: string;
  workspaceId: string;
  kind: 'campaign' | 'content';
  revision: number;
  sha256: string;
  title: string;
}

/** Renderer-safe approved source summary. Workspace identity and resource body stay in main. */
export interface CustomerMarketingWorkflowSource {
  id: string;
  kind: 'campaign' | 'content';
  revision: number;
  sha256: string;
  title: string;
  channel: string | null;
}

export interface CustomerMarketingWorkflowPrepareRequest {
  target: CustomerMarketingWorkflowTarget;
  resourceId: string;
  expectedRevision: number;
  operations?: readonly CustomerMarketingWorkflowRequestedOperation[];
}

export interface CustomerMarketingWorkflowInputRefV1 {
  id: string;
  kind: 'campaign' | 'content';
  revision: number;
  sha256: string;
}

export interface CustomerMarketingWorkflowGrantLimitsV1 {
  maxItems: 1;
  maxRecipients: 0;
  maxSpendVnd: 0;
}

export interface CustomerMarketingWorkflowGrantV1 {
  operations: CustomerMarketingWorkflowAllowedOperation[];
  channels: CustomerMarketingWorkflowTarget[];
  limits: CustomerMarketingWorkflowGrantLimitsV1;
  expiresAt: string;
  policyRevision: CustomerMarketingWorkflowPolicyRevision;
}

export interface CustomerMarketingWorkflowDryRunV1 {
  steps: string[];
  outputs: string[];
  warnings: string[];
  externalActionPerformed: false;
}

export interface CustomerMarketingWorkflowManifestV1 {
  kind: CustomerMarketingWorkflowTarget;
  title: string;
  workspaceHash: string;
  inputRef: CustomerMarketingWorkflowInputRefV1;
  grant: CustomerMarketingWorkflowGrantV1;
  dryRun: CustomerMarketingWorkflowDryRunV1;
  nonce: string;
  createdAt: string;
}

export interface CustomerMarketingWorkflowAuditReceiptV1 {
  id: string;
  workflowId: string;
  approvalId: string;
  manifestDigest: string;
  decision: CustomerMarketingWorkflowDecision;
  reviewerHash: string;
  reviewedAt: string;
  policyRevision: CustomerMarketingWorkflowPolicyRevision;
  externalActionPerformed: false;
  receiptDigest: string;
}

export interface CustomerMarketingWorkflowPrepareInput<
  TTarget extends CustomerMarketingWorkflowTarget = CustomerMarketingWorkflowTarget,
> {
  target: TTarget;
  inputRef: CustomerMarketingPersistedResourceRef;
  operations?: readonly CustomerMarketingWorkflowRequestedOperation[];
}

export interface CustomerMarketingWorkflowReviewInput {
  workflowId: string;
  approvalId: string;
  manifestDigest: string;
  decision: CustomerMarketingWorkflowDecision;
  reviewerHash: string;
  note?: string;
}

/** Renderer review request. Main derives the reviewer hash from authenticated identity. */
export interface CustomerMarketingWorkflowReviewRequest {
  target: CustomerMarketingWorkflowTarget;
  workflowId: string;
  approvalId: string;
  manifestDigest: string;
  decision: CustomerMarketingWorkflowDecision;
  note?: string;
}

export interface CustomerMarketingWorkflowRecord {
  workflowId: string;
  approvalId: string;
  manifestDigest: string;
  status: CustomerMarketingWorkflowReviewStatus;
  manifest: CustomerMarketingWorkflowManifestV1;
  receipt: CustomerMarketingWorkflowAuditReceiptV1 | null;
}

export interface CustomerMarketingWorkflowSourceListResult {
  ok: boolean;
  status: CustomerMarketingBridgeStatus;
  sources: CustomerMarketingWorkflowSource[];
  error?: string;
}

export interface CustomerMarketingWorkflowListResult {
  ok: boolean;
  status: CustomerMarketingBridgeStatus;
  workflows: CustomerMarketingWorkflowRecord[];
  error?: string;
}

export interface CustomerMarketingWorkflowMutationResult {
  ok: boolean;
  status: CustomerMarketingBridgeStatus;
  workflow: CustomerMarketingWorkflowRecord | null;
  error?: string;
}
