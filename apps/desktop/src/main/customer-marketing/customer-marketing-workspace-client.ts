import { IZZI_API_BASE } from '../config/public-config';
import type {
  CustomerAssignableRole,
  CustomerAudienceProfile,
  CustomerAutomationMode,
  CustomerBrandProfile,
  CustomerBusinessProfile,
  CustomerCapability,
  CustomerCapabilityCategory,
  CustomerCapabilityPermission,
  CustomerCapabilityStability,
  CustomerChannel,
  CustomerMarketingAnalyticsReport,
  CustomerMarketingAnalyticsWindow,
  CustomerMarketingPlan,
  CustomerMarketingBridgeStatus,
  CustomerMarketingCalendarInput,
  CustomerMarketingResource,
  CustomerMarketingResourceArchiveInput,
  CustomerMarketingResourceCreateInput,
  CustomerMarketingResourceKind,
  CustomerMarketingResourceReviewInput,
  CustomerMarketingResourceUpdateInput,
  CustomerObjective,
  CustomerOnboardingProfile,
  CustomerRole,
  CustomerWorkspaceMemberStatus,
  CustomerWorkspaceSyncStatus,
} from '../../shared/customer-marketing-types';

export interface RemoteMarketingQuota {
  creditsLimit: number;
  creditsUsed: number;
}

export interface RemoteMarketingWorkspace {
  id: string;
  name: string;
  role: CustomerRole;
  plan: string;
  quota: RemoteMarketingQuota | null;
}

export interface RemoteMarketingMember {
  userId: string;
  email: string;
  role: CustomerRole;
  status: CustomerWorkspaceMemberStatus;
  joinedAt: string;
  updatedAt: string;
}

export interface RemoteMarketingProfile extends CustomerOnboardingProfile {
  workspaceId: string;
  revision: number;
}

export type CustomerMarketingProfileStatus =
  | CustomerWorkspaceSyncStatus
  | 'forbidden'
  | 'not_found'
  | 'conflict';

export interface CustomerMarketingProfileState {
  status: CustomerMarketingProfileStatus;
  profile: RemoteMarketingProfile | null;
}

export interface CustomerMarketingCapabilityCatalogState {
  status: CustomerWorkspaceSyncStatus | 'forbidden' | 'not_found';
  revision: number | null;
  capabilities: CustomerCapability[];
}

export interface CustomerMarketingProfileUpdateInput {
  workspaceId: string;
  expectedRevision: number;
  profile: CustomerOnboardingProfile;
}

export interface CustomerMarketingMembersState {
  status: CustomerWorkspaceSyncStatus | 'forbidden';
  members: RemoteMarketingMember[];
}

export interface CustomerMarketingMemberUpdateState {
  status: CustomerWorkspaceSyncStatus | 'forbidden' | 'not_found';
  member: RemoteMarketingMember | null;
}

export interface CustomerMarketingWorkspaceState {
  status: CustomerWorkspaceSyncStatus;
  workspace: RemoteMarketingWorkspace | null;
}

export interface EnsureCustomerMarketingWorkspaceInput {
  preferredWorkspaceId?: string;
  name: string;
  operatingMode: 'copilot' | 'semi_autonomous' | 'guarded_autonomous';
}

export type CustomerMarketingQuotaMetric =
  | 'credits'
  | 'agent_runs'
  | 'automation_runs'
  | 'content_items';

export interface CustomerMarketingQuotaReservationInput {
  workspaceId: string;
  capabilityId: string;
  metric: CustomerMarketingQuotaMetric;
  units: number;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
}

export interface CustomerMarketingMemberRoleUpdateInput {
  workspaceId: string;
  memberUserId: string;
  role: CustomerAssignableRole;
}

export interface RemoteMarketingInvitation {
  id: string;
  email: string;
  role: CustomerAssignableRole;
  expiresAt: string;
  createdAt: string;
}

export interface CustomerMarketingInvitationCreateInput {
  workspaceId: string;
  email: string;
  role: CustomerAssignableRole;
  idempotencyKey: string;
}

export interface RemoteMarketingWorkflowStep {
  ordinal: number;
  stepKey: 'brief' | 'strategy' | 'content_drafts' | 'brand_guardian' | 'customer_approval';
  capabilityId: 'ai-marketing-director' | 'strategy-planning' | 'content-studio' | 'brand-guardian' | 'approval-center';
  status: 'pending' | 'running' | 'completed' | 'awaiting_approval' | 'approved' | 'rejected' | 'failed';
  startedAt: string | null;
  completedAt: string | null;
}

export interface RemoteMarketingWorkflowArtifact {
  artifactRole: 'campaign' | 'daily_content';
  dayIndex: number;
  resource: {
    id: string;
    workspaceId: string;
    kind: 'campaign' | 'content';
    status: 'draft' | 'in_review' | 'approved' | 'rejected' | 'archived';
    revision: number;
    title: string;
    scheduledAt: string | null;
  };
}

export interface RemoteMarketingWorkflowRun {
  id: string;
  workspaceId: string;
  workflowKey: 'seven_day_content_v1';
  status: 'queued' | 'running' | 'awaiting_customer_approval' | 'approved' | 'rejected' | 'failed';
  revision: number;
  objective: string;
  channels: CustomerChannel[];
  startsOn: string;
  planSnapshot: 'free' | 'starter' | 'pro' | 'max' | 'ultra';
  currentStep: number;
  steps: RemoteMarketingWorkflowStep[];
  artifacts: RemoteMarketingWorkflowArtifact[];
  approval: { status: 'pending' | 'approved' | 'rejected'; requestedAt: string; decidedAt: string | null } | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerMarketingWorkflowStartInput {
  workspaceId: string;
  objective: string;
  channels: CustomerChannel[];
  startsOn: string;
  idempotencyKey: string;
}

export interface CustomerMarketingWorkflowResumeInput {
  workspaceId: string;
  runId: string;
  expectedRevision: number;
}

export interface CustomerMarketingWorkflowReviewInput {
  workspaceId: string;
  runId: string;
  decision: 'approve' | 'reject';
  expectedRevision: number;
}

export interface CustomerMarketingWorkflowState {
  status: CustomerMarketingBridgeStatus;
  run: RemoteMarketingWorkflowRun | null;
  duplicate?: boolean;
}

export type CustomerMarketingInvitationCreateState =
  | { status: 'created'; invitation: RemoteMarketingInvitation; inviteToken: string }
  | {
    status: 'local' | 'forbidden' | 'conflict' | 'unavailable';
    invitation: null;
    inviteToken: null;
  };

export type CustomerMarketingInvitationAcceptanceState =
  | { status: 'accepted'; workspaceId: string; role: CustomerRole }
  | {
    status: 'local' | 'forbidden' | 'not_found' | 'conflict' | 'quota_exceeded' | 'unavailable';
    workspaceId: null;
    role: null;
  };

export type CustomerMarketingQuotaReservation =
  | { status: 'local'; quota: null }
  | { status: 'reserved'; duplicate: boolean; quota: RemoteMarketingQuota }
  | { status: 'quota_exceeded' | 'forbidden' | 'plan_required' | 'unavailable'; quota: null };

export interface CustomerMarketingResourceListState {
  status: CustomerMarketingBridgeStatus;
  resources: CustomerMarketingResource[];
}

export interface CustomerMarketingAnalyticsState {
  status: CustomerMarketingBridgeStatus;
  report: CustomerMarketingAnalyticsReport | null;
}

export interface CustomerMarketingResourceState {
  status: CustomerMarketingBridgeStatus;
  resource: CustomerMarketingResource | null;
  duplicate?: boolean;
}

export interface CustomerMarketingResourceArchiveState {
  status: CustomerMarketingBridgeStatus;
  deleted: boolean;
}

export interface CustomerMarketingResourceGatewayCreateInput {
  workspaceId: string;
  idempotencyKey: string;
  resource: CustomerMarketingResourceCreateInput;
}

export type CustomerMarketingResourceGatewayUpdateInput = CustomerMarketingResourceUpdateInput & {
  workspaceId: string;
};

export type CustomerMarketingResourceGatewayReviewInput = CustomerMarketingResourceReviewInput & {
  workspaceId: string;
};

export type CustomerMarketingResourceGatewayArchiveInput = CustomerMarketingResourceArchiveInput & {
  workspaceId: string;
};

export interface CustomerMarketingWorkspaceGateway {
  getCurrent(preferredWorkspaceId?: string): Promise<CustomerMarketingWorkspaceState>;
  ensureWorkspace(input: EnsureCustomerMarketingWorkspaceInput): Promise<CustomerMarketingWorkspaceState>;
  getCapabilities(workspaceId: string): Promise<CustomerMarketingCapabilityCatalogState>;
  getProfile(workspaceId: string): Promise<CustomerMarketingProfileState>;
  updateProfile(input: CustomerMarketingProfileUpdateInput): Promise<CustomerMarketingProfileState>;
  reserveQuota(input: CustomerMarketingQuotaReservationInput): Promise<CustomerMarketingQuotaReservation>;
  listMembers(workspaceId: string): Promise<CustomerMarketingMembersState>;
  updateMemberRole(input: CustomerMarketingMemberRoleUpdateInput): Promise<CustomerMarketingMemberUpdateState>;
  createInvitation(input: CustomerMarketingInvitationCreateInput): Promise<CustomerMarketingInvitationCreateState>;
  acceptInvitation(inviteToken: string): Promise<CustomerMarketingInvitationAcceptanceState>;
  listMarketingResources(workspaceId: string, kind: CustomerMarketingResourceKind): Promise<CustomerMarketingResourceListState>;
  listMarketingCalendar(workspaceId: string, input?: CustomerMarketingCalendarInput): Promise<CustomerMarketingResourceListState>;
  getMarketingAnalytics(workspaceId: string, input: CustomerMarketingAnalyticsWindow): Promise<CustomerMarketingAnalyticsState>;
  getMarketingResource(workspaceId: string, kind: CustomerMarketingResourceKind, resourceId: string): Promise<CustomerMarketingResourceState>;
  createMarketingResource(input: CustomerMarketingResourceGatewayCreateInput): Promise<CustomerMarketingResourceState>;
  updateMarketingResource(input: CustomerMarketingResourceGatewayUpdateInput): Promise<CustomerMarketingResourceState>;
  reviewMarketingResource(input: CustomerMarketingResourceGatewayReviewInput): Promise<CustomerMarketingResourceState>;
  archiveMarketingResource(input: CustomerMarketingResourceGatewayArchiveInput): Promise<CustomerMarketingResourceArchiveState>;
  startSevenDayWorkflow?(input: CustomerMarketingWorkflowStartInput): Promise<CustomerMarketingWorkflowState>;
  getSevenDayWorkflow?(workspaceId: string, runId: string): Promise<CustomerMarketingWorkflowState>;
  resumeSevenDayWorkflow?(input: CustomerMarketingWorkflowResumeInput): Promise<CustomerMarketingWorkflowState>;
  reviewSevenDayWorkflow?(input: CustomerMarketingWorkflowReviewInput): Promise<CustomerMarketingWorkflowState>;
}

interface AuthTokenProvider {
  getAccessToken(): Promise<string | null>;
}

interface ClientOptions {
  baseUrl?: string;
  enabled?: boolean;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const ROLES = new Set<CustomerRole>(['owner', 'manager', 'editor', 'reviewer', 'viewer']);
const ASSIGNABLE_ROLES = new Set<CustomerAssignableRole>(['manager', 'editor', 'reviewer', 'viewer']);
const MEMBER_STATUSES = new Set<CustomerWorkspaceMemberStatus>(['active', 'suspended']);
const INVITATION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,256}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OBJECTIVES = new Set<CustomerObjective>([
  'brand_awareness', 'engagement', 'traffic', 'leads', 'revenue', 'launch', 'community',
]);
const CHANNELS = new Set<CustomerChannel>([
  'facebook', 'tiktok', 'instagram', 'youtube', 'website', 'email',
  'crm', 'ads', 'telegram', 'x', 'seo',
]);
const AUTOMATION_MODES = new Set<CustomerAutomationMode>([
  'copilot', 'semi_autonomous', 'guardrailed_autonomous',
]);
const CAPABILITY_CATEGORIES = new Set<CustomerCapabilityCategory>([
  'strategy', 'content', 'social', 'creative', 'analytics', 'automation', 'research', 'customer_support',
]);
const CAPABILITY_PERMISSIONS = new Set<CustomerCapabilityPermission>([
  'view', 'edit', 'execute', 'approve', 'manage',
]);
const CAPABILITY_STABILITIES = new Set<CustomerCapabilityStability>([
  'stable', 'beta', 'preview',
]);
const MARKETING_PLANS = new Set<CustomerMarketingPlan>([
  'free', 'starter', 'pro', 'max', 'ultra',
]);
const WORKFLOW_STEP_KEYS = new Set<RemoteMarketingWorkflowStep['stepKey']>([
  'brief', 'strategy', 'content_drafts', 'brand_guardian', 'customer_approval',
]);
const WORKFLOW_CAPABILITY_IDS = new Set<RemoteMarketingWorkflowStep['capabilityId']>([
  'ai-marketing-director', 'strategy-planning', 'content-studio', 'brand-guardian', 'approval-center',
]);
const WORKFLOW_STEP_STATUSES = new Set<RemoteMarketingWorkflowStep['status']>([
  'pending', 'running', 'completed', 'awaiting_approval', 'approved', 'rejected', 'failed',
]);
const WORKFLOW_STATUSES = new Set<RemoteMarketingWorkflowRun['status']>([
  'queued', 'running', 'awaiting_customer_approval', 'approved', 'rejected', 'failed',
]);
const WORKFLOW_RESOURCE_KINDS = new Set<RemoteMarketingWorkflowArtifact['resource']['kind']>(['campaign', 'content']);
const WORKFLOW_RESOURCE_STATUSES = new Set<RemoteMarketingWorkflowArtifact['resource']['status']>([
  'draft', 'in_review', 'approved', 'rejected', 'archived',
]);
const CAPABILITY_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const CAPABILITY_EXTENSION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,159}$/;
const CAPABILITY_RESPONSE_FIELDS = new Set<string>([
  'workspaceId', 'revision', 'capabilities',
]);
const CAPABILITY_PUBLIC_FIELDS = new Set<string>([
  'id', 'name', 'description', 'category', 'role', 'source', 'automationModes',
  'requiredIntegrations', 'minimumPlan', 'permission', 'stability',
  'creditEstimate', 'inputs', 'outputs', 'extensionId',
]);
const CAPABILITY_CREDIT_FIELDS = new Set<string>(['minimum', 'maximum', 'unit']);
const MARKETING_RESOURCE_KINDS = new Set<CustomerMarketingResourceKind>([
  'campaign', 'content', 'asset', 'knowledge',
]);
const MARKETING_RESOURCE_STATUSES = new Set<CustomerMarketingResource['status']>([
  'draft', 'in_review', 'approved', 'rejected', 'archived',
]);
const MARKETING_RESOURCE_COLLECTIONS: Record<CustomerMarketingResourceKind, string> = {
  campaign: 'campaigns',
  content: 'content',
  asset: 'assets',
  knowledge: 'knowledge',
};
const MARKETING_CHANNEL_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const MARKETING_MIME_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/;
const MARKETING_CHECKSUM_PATTERN = /^[0-9a-f]{32,128}$/i;
const MARKETING_IDEMPOTENCY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIVATE_MARKETING_KEYS = new Set([
  'workspaceid', 'actorid', 'actoruserid', 'idempotencykey', 'storagepath',
  'storagenamespace', 'namespace', 'token', 'accesstoken', 'refreshtoken',
  'proto', 'prototype', 'constructor',
]);
const MARKETING_RESOURCE_FIELDS: Record<CustomerMarketingResourceKind, readonly string[]> = {
  campaign: ['title', 'metadata', 'description', 'objective', 'startsAt', 'endsAt'],
  content: ['title', 'metadata', 'body', 'channel', 'scheduledAt', 'campaignId'],
  asset: ['title', 'metadata', 'mimeType', 'sizeBytes', 'altText', 'checksum'],
  knowledge: ['title', 'metadata', 'body', 'sourceUrl'],
};
const MARKETING_RESOURCE_BASE_FIELDS = [
  'id', 'workspaceId', 'kind', 'status', 'revision', 'title', 'metadata', 'createdAt', 'updatedAt',
] as const;
const MAX_MARKETING_ANALYTICS_WINDOW_MS = 366 * 24 * 60 * 60 * 1_000;
const MARKETING_ANALYTICS_OMITTED_METRICS = [
  'impressions', 'reach', 'clicks', 'conversions', 'revenue',
] as const;

const PROFILE_TEXT_LIMITS = {
  business: { name: 120, industry: 120, website: 240, offer: 600, region: 120 },
  brand: { logoUrl: 500, primaryColor: 24, accentColor: 24, font: 80, tone: 160, guidelines: 800 },
  audience: { segments: 400, needs: 500, painPoints: 500, behaviors: 500, market: 160 },
} as const;

function ownValue(raw: unknown, key: string): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const object = raw as Record<string, unknown>;
  return Object.hasOwn(object, key) ? object[key] : undefined;
}

function ownObject(raw: unknown, key: string): Record<string, unknown> | null {
  const value = ownValue(raw, key);
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function ownArray(raw: unknown, key: string): unknown[] {
  const value = ownValue(raw, key);
  return Array.isArray(value) ? value : [];
}

function textValue(raw: unknown, key: string): string {
  const value = ownValue(raw, key);
  return typeof value === 'string' ? value : '';
}

function hasOnlyOwnKeys(raw: unknown, allowed: ReadonlySet<string>): boolean {
  return raw !== null
    && typeof raw === 'object'
    && !Array.isArray(raw)
    && Object.keys(raw).every((key) => allowed.has(key));
}

function recordValue(raw: unknown): Record<string, unknown> | null {
  return raw !== null && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : null;
}

function exactRecord(raw: unknown, keys: readonly string[]): Record<string, unknown> | null {
  const record = recordValue(raw);
  if (!record) return null;
  const ownKeys = Object.keys(record);
  return ownKeys.length === keys.length
    && ownKeys.every((key) => keys.includes(key))
    && keys.every((key) => Object.hasOwn(record, key))
    ? record
    : null;
}

function subsetRecord(raw: unknown, keys: readonly string[]): Record<string, unknown> | null {
  const record = recordValue(raw);
  const ownKeys = record ? Object.keys(record) : [];
  return record && ownKeys.length > 0 && ownKeys.every((key) => keys.includes(key)) ? record : null;
}

function validIso(value: unknown): value is string {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function validUtcIso(value: unknown): value is string {
  return validIso(value) && value.endsWith('Z');
}

function validNullableText(value: unknown, maxLength: number): value is string | null {
  return value === null || (typeof value === 'string' && value.length <= maxLength);
}

function validNullableIso(value: unknown): value is string | null {
  return value === null || validIso(value);
}

function validHttpUrl(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== 'string') return false;
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function normalizedPrivateKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, '');
}

function parseMarketingMetadata(value: unknown): Record<string, string | number | boolean | null> | null {
  const metadata = recordValue(value);
  if (!metadata || Object.keys(metadata).length > 30) return null;
  const parsed: Array<[string, string | number | boolean | null]> = [];
  for (const [key, item] of Object.entries(metadata)) {
    if (PRIVATE_MARKETING_KEYS.has(normalizedPrivateKey(key))) return null;
    if (item !== null && typeof item !== 'string' && typeof item !== 'boolean'
      && !(typeof item === 'number' && Number.isFinite(item))) return null;
    parsed.push([key, item as string | number | boolean | null]);
  }
  return Object.fromEntries(parsed);
}

function validMarketingField(kind: CustomerMarketingResourceKind, key: string, value: unknown): boolean {
  if (key === 'title') return typeof value === 'string' && value.length >= 1 && value.length <= 160;
  if (key === 'metadata') return parseMarketingMetadata(value) !== null;
  if (kind === 'campaign') {
    if (key === 'description') return validNullableText(value, 4_000);
    if (key === 'objective') return validNullableText(value, 240);
    if (key === 'startsAt' || key === 'endsAt') return validNullableIso(value);
  }
  if (kind === 'content') {
    if (key === 'body') return typeof value === 'string' && value.length <= 32_000;
    if (key === 'channel') return typeof value === 'string' && MARKETING_CHANNEL_PATTERN.test(value);
    if (key === 'scheduledAt') return validNullableIso(value);
    if (key === 'campaignId') return value === null || (typeof value === 'string' && UUID_PATTERN.test(value));
  }
  if (kind === 'asset') {
    if (key === 'mimeType') return typeof value === 'string' && MARKETING_MIME_PATTERN.test(value);
    if (key === 'sizeBytes') return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= 50 * 1024 * 1024;
    if (key === 'altText') return validNullableText(value, 1_000);
    if (key === 'checksum') return value === null || (typeof value === 'string' && MARKETING_CHECKSUM_PATTERN.test(value));
  }
  if (kind === 'knowledge') {
    if (key === 'body') return typeof value === 'string' && value.length <= 64_000;
    if (key === 'sourceUrl') return validHttpUrl(value);
  }
  return false;
}

function cloneMarketingFields(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [
    key,
    key === 'metadata' ? parseMarketingMetadata(value) : value,
  ]));
}

export function parseMarketingResourceKind(value: unknown): CustomerMarketingResourceKind | null {
  return typeof value === 'string' && MARKETING_RESOURCE_KINDS.has(value as CustomerMarketingResourceKind)
    ? value as CustomerMarketingResourceKind
    : null;
}

export function parseMarketingResourceCreateInput(value: unknown): CustomerMarketingResourceCreateInput | null {
  const record = recordValue(value);
  const kind = record ? parseMarketingResourceKind(record.kind) : null;
  if (!kind) return null;
  const fields = MARKETING_RESOURCE_FIELDS[kind];
  const exact = exactRecord(record, ['kind', ...fields]);
  if (!exact || fields.some((key) => !validMarketingField(kind, key, exact[key]))) return null;
  return { kind, ...cloneMarketingFields(Object.fromEntries(fields.map((key) => [key, exact[key]]))) } as CustomerMarketingResourceCreateInput;
}

export function parseMarketingResourceUpdateInput(value: unknown): CustomerMarketingResourceUpdateInput | null {
  const record = exactRecord(value, ['kind', 'resourceId', 'expectedRevision', 'patch']);
  const kind = record ? parseMarketingResourceKind(record.kind) : null;
  if (!record || !kind || typeof record.resourceId !== 'string' || !UUID_PATTERN.test(record.resourceId)
    || !Number.isSafeInteger(record.expectedRevision) || Number(record.expectedRevision) < 0) return null;
  const patch = subsetRecord(record.patch, MARKETING_RESOURCE_FIELDS[kind]);
  if (!patch || Object.entries(patch).some(([key, item]) => !validMarketingField(kind, key, item))) return null;
  return {
    kind,
    resourceId: record.resourceId,
    expectedRevision: record.expectedRevision,
    patch: cloneMarketingFields(patch),
  } as CustomerMarketingResourceUpdateInput;
}

export function parseMarketingResourceReviewInput(value: unknown): CustomerMarketingResourceReviewInput | null {
  const record = exactRecord(value, ['kind', 'resourceId', 'action', 'expectedRevision']);
  if (!record || (record.kind !== 'campaign' && record.kind !== 'content')
    || typeof record.resourceId !== 'string' || !UUID_PATTERN.test(record.resourceId)
    || (record.action !== 'submit' && record.action !== 'approve' && record.action !== 'reject')
    || !Number.isSafeInteger(record.expectedRevision) || Number(record.expectedRevision) < 0) return null;
  return record as unknown as CustomerMarketingResourceReviewInput;
}

export function parseMarketingResourceArchiveInput(value: unknown): CustomerMarketingResourceArchiveInput | null {
  const record = exactRecord(value, ['kind', 'resourceId', 'expectedRevision']);
  const kind = record ? parseMarketingResourceKind(record.kind) : null;
  if (!record || !kind || typeof record.resourceId !== 'string' || !UUID_PATTERN.test(record.resourceId)
    || !Number.isSafeInteger(record.expectedRevision) || Number(record.expectedRevision) < 0) return null;
  return { kind, resourceId: record.resourceId, expectedRevision: Number(record.expectedRevision) };
}

export function parseMarketingCalendarInput(value: unknown): CustomerMarketingCalendarInput | null {
  const record = exactRecord(value, ['from', 'to']);
  if (!record || !validIso(record.from) || !validIso(record.to)
    || Date.parse(record.from) > Date.parse(record.to)) return null;
  return { from: record.from, to: record.to };
}

export function parseMarketingAnalyticsWindow(value: unknown): CustomerMarketingAnalyticsWindow | null {
  const record = exactRecord(value, ['from', 'to']);
  if (!record || !validUtcIso(record.from) || !validUtcIso(record.to)) return null;
  const from = Date.parse(record.from);
  const to = Date.parse(record.to);
  if (from > to || to - from > MAX_MARKETING_ANALYTICS_WINDOW_MS) return null;
  return { from: record.from, to: record.to };
}

function validAnalyticsCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function parseAnalyticsKindCounts(value: unknown): CustomerMarketingAnalyticsReport['activity']['byKind'] | null {
  const record = exactRecord(value, ['campaign', 'content', 'asset', 'knowledge']);
  if (!record || !validAnalyticsCount(record.campaign) || !validAnalyticsCount(record.content)
    || !validAnalyticsCount(record.asset) || !validAnalyticsCount(record.knowledge)) return null;
  return {
    campaign: record.campaign,
    content: record.content,
    asset: record.asset,
    knowledge: record.knowledge,
  };
}

function parseAnalyticsStatusCounts(value: unknown): CustomerMarketingAnalyticsReport['activity']['byStatus'] | null {
  const record = exactRecord(value, ['draft', 'inReview', 'approved', 'rejected', 'archived']);
  if (!record || !validAnalyticsCount(record.draft) || !validAnalyticsCount(record.inReview)
    || !validAnalyticsCount(record.approved) || !validAnalyticsCount(record.rejected)
    || !validAnalyticsCount(record.archived)) return null;
  return {
    draft: record.draft,
    inReview: record.inReview,
    approved: record.approved,
    rejected: record.rejected,
    archived: record.archived,
  };
}

function countTotal(counts: object): number {
  return Object.values(counts).reduce((total, count) => total + count, 0);
}

function parseMarketingAnalyticsEnvelope(
  value: unknown,
  expectedWorkspaceId: string,
  expectedWindow: CustomerMarketingAnalyticsWindow,
): CustomerMarketingAnalyticsReport | null {
  const envelope = exactRecord(value, ['workspaceId', 'report']);
  const report = envelope ? exactRecord(envelope.report, [
    'source', 'generatedAt', 'window', 'inventory', 'activity', 'schedule', 'attribution', 'dataAvailability',
  ]) : null;
  if (!envelope || envelope.workspaceId !== expectedWorkspaceId || !report
    || report.source !== 'marketing_resources' || !validUtcIso(report.generatedAt)) return null;

  const window = exactRecord(report.window, ['from', 'to', 'timeZone', 'activityBasis', 'scheduleBasis']);
  if (!window || window.from !== expectedWindow.from || window.to !== expectedWindow.to
    || window.timeZone !== 'UTC' || window.activityBasis !== 'resource_updated_at'
    || window.scheduleBasis !== 'content_scheduled_at') return null;

  const inventory = exactRecord(report.inventory, ['total', 'campaigns', 'content', 'assets', 'knowledge']);
  if (!inventory || !validAnalyticsCount(inventory.total) || !validAnalyticsCount(inventory.campaigns)
    || !validAnalyticsCount(inventory.content) || !validAnalyticsCount(inventory.assets)
    || !validAnalyticsCount(inventory.knowledge)
    || inventory.total !== inventory.campaigns + inventory.content + inventory.assets + inventory.knowledge) return null;

  const activity = exactRecord(report.activity, ['updatedInWindow', 'byKind', 'byStatus']);
  const activityByKind = activity ? parseAnalyticsKindCounts(activity.byKind) : null;
  const activityByStatus = activity ? parseAnalyticsStatusCounts(activity.byStatus) : null;
  if (!activity || !validAnalyticsCount(activity.updatedInWindow) || !activityByKind || !activityByStatus
    || activity.updatedInWindow !== countTotal(activityByKind)
    || activity.updatedInWindow !== countTotal(activityByStatus)
    || activity.updatedInWindow > inventory.total) return null;

  const schedule = exactRecord(report.schedule, ['contentScheduledInWindow', 'byChannel', 'byStatus']);
  const scheduleByStatus = schedule ? parseAnalyticsStatusCounts(schedule.byStatus) : null;
  if (!schedule || !validAnalyticsCount(schedule.contentScheduledInWindow)
    || !Array.isArray(schedule.byChannel) || schedule.byChannel.length > 64 || !scheduleByStatus) return null;
  const channels = new Set<string>();
  const byChannel: CustomerMarketingAnalyticsReport['schedule']['byChannel'] = [];
  for (const item of schedule.byChannel) {
    const row = exactRecord(item, ['channel', 'count']);
    if (!row || typeof row.channel !== 'string' || !MARKETING_CHANNEL_PATTERN.test(row.channel)
      || !validAnalyticsCount(row.count) || channels.has(row.channel)) return null;
    channels.add(row.channel);
    byChannel.push({ channel: row.channel, count: row.count });
  }
  if (schedule.contentScheduledInWindow !== byChannel.reduce((total, item) => total + item.count, 0)
    || schedule.contentScheduledInWindow !== countTotal(scheduleByStatus)
    || schedule.contentScheduledInWindow > inventory.content) return null;

  const attribution = exactRecord(report.attribution, [
    'model', 'basis', 'contentConsidered', 'attributedContent', 'unattributedContent',
    'unresolvedCampaignLinks', 'campaigns',
  ]);
  if (!attribution || attribution.model !== 'direct_campaign_id' || attribution.basis !== 'content_updated_at'
    || !validAnalyticsCount(attribution.contentConsidered) || !validAnalyticsCount(attribution.attributedContent)
    || !validAnalyticsCount(attribution.unattributedContent) || !validAnalyticsCount(attribution.unresolvedCampaignLinks)
    || !Array.isArray(attribution.campaigns) || attribution.campaigns.length > 5_000
    || attribution.contentConsidered !== attribution.attributedContent + attribution.unattributedContent + attribution.unresolvedCampaignLinks
    || attribution.contentConsidered !== activityByKind.content) return null;
  const campaignIds = new Set<string>();
  const campaigns: CustomerMarketingAnalyticsReport['attribution']['campaigns'] = [];
  for (const item of attribution.campaigns) {
    const row = exactRecord(item, ['campaignId', 'title', 'contentCount', 'scheduledContentCount']);
    if (!row || typeof row.campaignId !== 'string' || !UUID_PATTERN.test(row.campaignId)
      || campaignIds.has(row.campaignId) || typeof row.title !== 'string' || row.title.length < 1 || row.title.length > 160
      || !validAnalyticsCount(row.contentCount) || !validAnalyticsCount(row.scheduledContentCount)
      || row.scheduledContentCount > row.contentCount) return null;
    campaignIds.add(row.campaignId);
    campaigns.push({
      campaignId: row.campaignId,
      title: row.title,
      contentCount: row.contentCount,
      scheduledContentCount: row.scheduledContentCount,
    });
  }
  if (campaigns.reduce((total, item) => total + item.contentCount, 0) !== attribution.attributedContent
    || campaigns.reduce((total, item) => total + item.scheduledContentCount, 0) > schedule.contentScheduledInWindow) return null;

  const dataAvailability = exactRecord(report.dataAvailability, ['performanceMetrics']);
  const performanceMetrics = dataAvailability
    ? exactRecord(dataAvailability.performanceMetrics, ['status', 'reason', 'omittedMetrics'])
    : null;
  if (!performanceMetrics || performanceMetrics.status !== 'unavailable'
    || typeof performanceMetrics.reason !== 'string' || performanceMetrics.reason.length < 1
    || performanceMetrics.reason.length > 500 || !Array.isArray(performanceMetrics.omittedMetrics)
    || performanceMetrics.omittedMetrics.length !== MARKETING_ANALYTICS_OMITTED_METRICS.length
    || performanceMetrics.omittedMetrics.some((metric, index) => metric !== MARKETING_ANALYTICS_OMITTED_METRICS[index])) return null;

  return {
    source: 'marketing_resources',
    generatedAt: report.generatedAt,
    window: {
      from: expectedWindow.from,
      to: expectedWindow.to,
      timeZone: 'UTC',
      activityBasis: 'resource_updated_at',
      scheduleBasis: 'content_scheduled_at',
    },
    inventory: {
      total: inventory.total,
      campaigns: inventory.campaigns,
      content: inventory.content,
      assets: inventory.assets,
      knowledge: inventory.knowledge,
    },
    activity: { updatedInWindow: activity.updatedInWindow, byKind: activityByKind, byStatus: activityByStatus },
    schedule: { contentScheduledInWindow: schedule.contentScheduledInWindow, byChannel, byStatus: scheduleByStatus },
    attribution: {
      model: 'direct_campaign_id',
      basis: 'content_updated_at',
      contentConsidered: attribution.contentConsidered,
      attributedContent: attribution.attributedContent,
      unattributedContent: attribution.unattributedContent,
      unresolvedCampaignLinks: attribution.unresolvedCampaignLinks,
      campaigns,
    },
    dataAvailability: {
      performanceMetrics: {
        status: 'unavailable',
        reason: performanceMetrics.reason,
        omittedMetrics: [...MARKETING_ANALYTICS_OMITTED_METRICS],
      },
    },
  };
}

function parseMarketingResource(
  value: unknown,
  expectedWorkspaceId: string,
  expectedKind?: CustomerMarketingResourceKind,
  expectedResourceId?: string,
): CustomerMarketingResource | null {
  const candidate = recordValue(value);
  const kind = candidate ? parseMarketingResourceKind(candidate.kind) : null;
  if (!candidate || !kind || (expectedKind && kind !== expectedKind)) return null;
  const resource = exactRecord(candidate, [...MARKETING_RESOURCE_BASE_FIELDS, ...MARKETING_RESOURCE_FIELDS[kind].slice(2)]);
  if (!resource || resource.workspaceId !== expectedWorkspaceId || (expectedResourceId && resource.id !== expectedResourceId)
    || typeof resource.id !== 'string' || !UUID_PATTERN.test(resource.id)
    || !MARKETING_RESOURCE_STATUSES.has(resource.status as CustomerMarketingResource['status'])
    || !Number.isSafeInteger(resource.revision) || Number(resource.revision) < 0
    || !validMarketingField(kind, 'title', resource.title)
    || parseMarketingMetadata(resource.metadata) === null
    || !validIso(resource.createdAt) || !validIso(resource.updatedAt)
    || MARKETING_RESOURCE_FIELDS[kind].slice(2).some((key) => !validMarketingField(kind, key, resource[key]))) return null;
  return {
    ...resource,
    kind,
    metadata: parseMarketingMetadata(resource.metadata),
  } as CustomerMarketingResource;
}

function parseMarketingListEnvelope(
  value: unknown,
  expectedWorkspaceId: string,
  expectedKind?: CustomerMarketingResourceKind,
): CustomerMarketingResource[] | null {
  const envelope = exactRecord(value, ['workspaceId', 'resources']);
  if (!envelope || envelope.workspaceId !== expectedWorkspaceId || !Array.isArray(envelope.resources)) return null;
  const resources = envelope.resources.map((resource) => parseMarketingResource(
    resource,
    expectedWorkspaceId,
    expectedKind,
  ));
  return resources.some((resource) => resource === null) ? null : resources as CustomerMarketingResource[];
}

function parseSevenDayWorkflowRun(value: unknown, expectedWorkspaceId: string): RemoteMarketingWorkflowRun | null {
  const run = exactRecord(value, [
    'id', 'workspaceId', 'workflowKey', 'status', 'revision', 'objective', 'channels', 'startsOn',
    'planSnapshot', 'currentStep', 'steps', 'artifacts', 'approval', 'createdAt', 'updatedAt',
  ]);
  if (!run || run.workspaceId !== expectedWorkspaceId
    || typeof run.id !== 'string' || !UUID_PATTERN.test(run.id)
    || run.workflowKey !== 'seven_day_content_v1'
    || !WORKFLOW_STATUSES.has(run.status as RemoteMarketingWorkflowRun['status'])
    || !Number.isSafeInteger(run.revision) || Number(run.revision) < 0
    || typeof run.objective !== 'string' || run.objective.length < 1 || run.objective.length > 500
    || !Array.isArray(run.channels) || run.channels.length < 1 || run.channels.length > 7
    || run.channels.some((channel) => !CHANNELS.has(channel as CustomerChannel))
    || typeof run.startsOn !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(run.startsOn)
    || Number.isNaN(Date.parse(`${run.startsOn}T00:00:00Z`))
    || !MARKETING_PLANS.has(run.planSnapshot as CustomerMarketingPlan)
    || !Number.isInteger(run.currentStep) || Number(run.currentStep) < 0 || Number(run.currentStep) > 4
    || !Array.isArray(run.steps) || run.steps.length !== 5
    || !Array.isArray(run.artifacts) || run.artifacts.length > 8
    || (run.approval !== null && recordValue(run.approval) === null)
    || !validIso(run.createdAt) || !validIso(run.updatedAt)) return null;

  const steps = run.steps.map((value): RemoteMarketingWorkflowStep | null => {
    const step = exactRecord(value, ['ordinal', 'stepKey', 'capabilityId', 'status', 'startedAt', 'completedAt']);
    if (!step || !Number.isInteger(step.ordinal) || Number(step.ordinal) < 1 || Number(step.ordinal) > 5
      || !WORKFLOW_STEP_KEYS.has(step.stepKey as RemoteMarketingWorkflowStep['stepKey'])
      || !WORKFLOW_CAPABILITY_IDS.has(step.capabilityId as RemoteMarketingWorkflowStep['capabilityId'])
      || !WORKFLOW_STEP_STATUSES.has(step.status as RemoteMarketingWorkflowStep['status'])
      || (step.startedAt !== null && !validIso(step.startedAt))
      || (step.completedAt !== null && !validIso(step.completedAt))) return null;
    return {
      ordinal: step.ordinal as number,
      stepKey: step.stepKey as RemoteMarketingWorkflowStep['stepKey'],
      capabilityId: step.capabilityId as RemoteMarketingWorkflowStep['capabilityId'],
      status: step.status as RemoteMarketingWorkflowStep['status'],
      startedAt: step.startedAt as string | null,
      completedAt: step.completedAt as string | null,
    };
  });
  if (steps.some((step) => step === null)) return null;

  const artifacts = run.artifacts.map((value): RemoteMarketingWorkflowArtifact | null => {
    const artifact = exactRecord(value, ['artifactRole', 'dayIndex', 'resource']);
    const resource = artifact ? exactRecord(artifact.resource, [
      'id', 'workspaceId', 'kind', 'status', 'revision', 'title', 'scheduledAt',
    ]) : null;
    if (!artifact || !resource || (artifact.artifactRole !== 'campaign' && artifact.artifactRole !== 'daily_content')
      || !Number.isInteger(artifact.dayIndex) || Number(artifact.dayIndex) < 0 || Number(artifact.dayIndex) > 7
      || typeof resource.id !== 'string' || !UUID_PATTERN.test(resource.id)
      || resource.workspaceId !== expectedWorkspaceId
      || !WORKFLOW_RESOURCE_KINDS.has(resource.kind as RemoteMarketingWorkflowArtifact['resource']['kind'])
      || !WORKFLOW_RESOURCE_STATUSES.has(resource.status as RemoteMarketingWorkflowArtifact['resource']['status'])
      || !Number.isSafeInteger(resource.revision) || Number(resource.revision) < 0
      || typeof resource.title !== 'string' || resource.title.length < 1 || resource.title.length > 160
      || (resource.scheduledAt !== null && !validIso(resource.scheduledAt))) return null;
    return {
      artifactRole: artifact.artifactRole as RemoteMarketingWorkflowArtifact['artifactRole'],
      dayIndex: artifact.dayIndex as number,
      resource: {
        id: resource.id as string,
        workspaceId: resource.workspaceId as string,
        kind: resource.kind as RemoteMarketingWorkflowArtifact['resource']['kind'],
        status: resource.status as RemoteMarketingWorkflowArtifact['resource']['status'],
        revision: resource.revision as number,
        title: resource.title as string,
        scheduledAt: resource.scheduledAt as string | null,
      },
    };
  });
  if (artifacts.some((artifact) => artifact === null)) return null;

  let approval: RemoteMarketingWorkflowRun['approval'] = null;
  if (run.approval !== null) {
    const candidate = exactRecord(run.approval, ['status', 'requestedAt', 'decidedAt']);
    if (!candidate || !['pending', 'approved', 'rejected'].includes(String(candidate.status))
      || !validIso(candidate.requestedAt)
      || (candidate.decidedAt !== null && !validIso(candidate.decidedAt))) return null;
    approval = candidate as RemoteMarketingWorkflowRun['approval'];
  }

  return {
    id: run.id as string,
    workspaceId: run.workspaceId as string,
    workflowKey: 'seven_day_content_v1',
    status: run.status as RemoteMarketingWorkflowRun['status'],
    revision: run.revision as number,
    objective: run.objective as string,
    channels: run.channels as CustomerChannel[],
    startsOn: run.startsOn as string,
    planSnapshot: run.planSnapshot as RemoteMarketingWorkflowRun['planSnapshot'],
    currentStep: run.currentStep as number,
    steps: steps as RemoteMarketingWorkflowStep[],
    artifacts: artifacts as RemoteMarketingWorkflowArtifact[],
    approval,
    createdAt: run.createdAt as string,
    updatedAt: run.updatedAt as string,
  };
}

function parseSevenDayWorkflowEnvelope(
  value: unknown,
  expectedWorkspaceId: string,
  expectedKeys: readonly string[],
): CustomerMarketingWorkflowState {
  const envelope = exactRecord(value, expectedKeys);
  const run = envelope ? parseSevenDayWorkflowRun(envelope.run, expectedWorkspaceId) : null;
  if (!envelope || envelope.workspaceId !== expectedWorkspaceId || !run
    || (expectedKeys.includes('duplicate') && typeof envelope.duplicate !== 'boolean')) {
    return { status: 'unavailable', run: null };
  }
  return {
    status: 'synced',
    run,
    ...(expectedKeys.includes('duplicate') ? { duplicate: envelope.duplicate as boolean } : {}),
  };
}

function parseMarketingResourceEnvelope(
  value: unknown,
  keys: readonly string[],
  expectedWorkspaceId: string,
  expectedKind: CustomerMarketingResourceKind,
  expectedResourceId?: string,
): { resource: CustomerMarketingResource; duplicate?: boolean } | null {
  const envelope = exactRecord(value, keys);
  if (!envelope || envelope.workspaceId !== expectedWorkspaceId) return null;
  const resource = parseMarketingResource(envelope.resource, expectedWorkspaceId, expectedKind, expectedResourceId);
  if (!resource) return null;
  if (keys.includes('duplicate') && typeof envelope.duplicate !== 'boolean') return null;
  return { resource, ...(keys.includes('duplicate') ? { duplicate: envelope.duplicate as boolean } : {}) };
}

function marketingFailureStatus(status?: number): Exclude<CustomerMarketingBridgeStatus, 'synced' | 'local'> {
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 429) return 'quota_exceeded';
  return 'unavailable';
}

function numberValue(raw: unknown, key: string): number {
  const value = ownValue(raw, key);
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseQuota(raw: unknown): RemoteMarketingQuota | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return {
    creditsLimit: numberValue(raw, 'credits_limit'),
    creditsUsed: numberValue(raw, 'credits_used'),
  };
}

function parseEnvelope(raw: unknown): RemoteMarketingWorkspace | null {
  const workspace = ownObject(raw, 'workspace');
  const membership = ownObject(raw, 'membership');
  if (!workspace || !membership) return null;

  const id = textValue(workspace, 'id');
  const name = textValue(workspace, 'name');
  const roleValue = textValue(membership, 'role') as CustomerRole;
  if (!UUID_PATTERN.test(id) || !name || !ROLES.has(roleValue)) return null;

  const quotaRaw = ownObject(raw, 'quota');
  return {
    id,
    name,
    role: roleValue,
    plan: textValue(workspace, 'plan') || 'free',
    quota: parseQuota(quotaRaw),
  };
}

function parseMember(raw: unknown): RemoteMarketingMember | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const userId = textValue(raw, 'userId');
  const email = textValue(raw, 'email');
  const role = textValue(raw, 'role') as CustomerRole;
  const status = textValue(raw, 'status') as CustomerWorkspaceMemberStatus;
  const joinedAt = textValue(raw, 'joinedAt');
  const updatedAt = textValue(raw, 'updatedAt');
  if (
    !UUID_PATTERN.test(userId)
    || !email
    || email.length > 320
    || !ROLES.has(role)
    || !MEMBER_STATUSES.has(status)
    || !joinedAt
    || !updatedAt
  ) return null;
  return { userId, email, role, status, joinedAt, updatedAt };
}

function isIsoDate(value: string): boolean {
  return value.length > 0 && !Number.isNaN(Date.parse(value));
}

function capabilityText(raw: unknown, key: string, maxLength: number): string | null {
  const value = ownValue(raw, key);
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maxLength
    && value.trim() === value
    ? value
    : null;
}

function parseCapability(raw: unknown): CustomerCapability | null {
  if (!hasOnlyOwnKeys(raw, CAPABILITY_PUBLIC_FIELDS)) return null;
  const id = capabilityText(raw, 'id', 64);
  const name = capabilityText(raw, 'name', 160);
  const description = capabilityText(raw, 'description', 1_000);
  const category = textValue(raw, 'category') as CustomerCapabilityCategory;
  const role = capabilityText(raw, 'role', 160);
  const source = textValue(raw, 'source') as CustomerCapability['source'];
  const minimumPlan = textValue(raw, 'minimumPlan') as CustomerMarketingPlan;
  const permission = textValue(raw, 'permission') as CustomerCapabilityPermission;
  const stability = textValue(raw, 'stability') as CustomerCapabilityStability;
  const rawExtensionId = ownValue(raw, 'extensionId');
  const extensionId = typeof rawExtensionId === 'string' ? rawExtensionId : '';
  const automationModes = parseProfileEnumList(
    ownValue(raw, 'automationModes'),
    AUTOMATION_MODES,
    AUTOMATION_MODES.size,
  );
  const requiredIntegrations = parseProfileStringList(
    ownValue(raw, 'requiredIntegrations'),
    20,
    120,
  );
  const inputs = parseProfileStringList(ownValue(raw, 'inputs'), 30, 160);
  const outputs = parseProfileStringList(ownValue(raw, 'outputs'), 30, 160);
  const creditEstimate = ownObject(raw, 'creditEstimate');
  if (!creditEstimate || !hasOnlyOwnKeys(creditEstimate, CAPABILITY_CREDIT_FIELDS)) return null;
  const minimum = creditEstimate ? ownValue(creditEstimate, 'minimum') : null;
  const maximum = creditEstimate ? ownValue(creditEstimate, 'maximum') : null;
  const unit = creditEstimate ? textValue(creditEstimate, 'unit') : '';
  if (
    !id
    || !CAPABILITY_ID_PATTERN.test(id)
    || !name
    || !description
    || !CAPABILITY_CATEGORIES.has(category)
    || !role
    || (source !== 'core' && source !== 'extension')
    || !MARKETING_PLANS.has(minimumPlan)
    || !CAPABILITY_PERMISSIONS.has(permission)
    || !CAPABILITY_STABILITIES.has(stability)
    || !automationModes
    || !requiredIntegrations
    || requiredIntegrations.some((item) => item.trim() !== item)
    || !inputs
    || !outputs
    || inputs.some((item) => item.trim() !== item)
    || outputs.some((item) => item.trim() !== item)
    || typeof minimum !== 'number'
    || !Number.isFinite(minimum)
    || minimum < 0
    || typeof maximum !== 'number'
    || !Number.isFinite(maximum)
    || maximum < minimum
    || maximum > 1_000_000
    || unit !== 'credits_per_run'
    || (source === 'extension' && !CAPABILITY_EXTENSION_ID_PATTERN.test(extensionId))
    || (source === 'core' && rawExtensionId !== undefined)
  ) return null;
  return {
    id,
    name,
    description,
    category,
    role,
    source,
    status: 'available',
    automationModes,
    requiredIntegrations,
    minimumPlan,
    permission,
    stability,
    creditEstimate: { minimum, maximum, unit },
    inputs,
    outputs,
    ...(source === 'extension' ? { extensionId } : {}),
  };
}

function parseCapabilityCatalog(
  raw: unknown,
  expectedWorkspaceId: string,
): { revision: number; capabilities: CustomerCapability[] } | null {
  if (!hasOnlyOwnKeys(raw, CAPABILITY_RESPONSE_FIELDS)) return null;
  if (textValue(raw, 'workspaceId') !== expectedWorkspaceId) return null;
  const revision = ownValue(raw, 'revision');
  const rawCapabilities = ownValue(raw, 'capabilities');
  if (
    typeof revision !== 'number'
    || !Number.isSafeInteger(revision)
    || revision <= 0
    || !Array.isArray(rawCapabilities)
  ) return null;
  if (rawCapabilities.length > 200) return null;
  const capabilities = rawCapabilities.map(parseCapability);
  if (capabilities.some((capability) => capability === null)) return null;
  const parsed = capabilities as CustomerCapability[];
  if (new Set(parsed.map((capability) => capability.id)).size !== parsed.length) return null;
  return { revision, capabilities: parsed };
}

function parseInvitation(
  raw: unknown,
  expectedEmail: string,
  expectedRole: CustomerAssignableRole,
): RemoteMarketingInvitation | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const id = textValue(raw, 'id');
  const email = textValue(raw, 'email');
  const role = textValue(raw, 'role') as CustomerAssignableRole;
  const expiresAt = textValue(raw, 'expires_at');
  const createdAt = textValue(raw, 'created_at');
  if (
    !UUID_PATTERN.test(id)
    || email !== expectedEmail
    || role !== expectedRole
    || !ASSIGNABLE_ROLES.has(role)
    || !isIsoDate(expiresAt)
    || !isIsoDate(createdAt)
  ) return null;
  return { id, email, role, expiresAt, createdAt };
}
function parseProfileText(
  raw: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | null {
  const value = ownValue(raw, key);
  if (value === undefined) return null;
  return typeof value === 'string' && value.length <= maxLength ? value : null;
}

function parseProfileTextFields<T extends Record<string, number>>(
  raw: Record<string, unknown>,
  limits: T,
): { [K in keyof T]: string } | null {
  const parsed: Record<string, string> = {};
  for (const [key, maxLength] of Object.entries(limits)) {
    const value = parseProfileText(raw, key, maxLength);
    if (value === null) return null;
    parsed[key] = value;
  }
  return parsed as { [K in keyof T]: string };
}

function parseProfileStringList(
  value: unknown,
  maxItems: number,
  itemMaxLength: number,
): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const parsed = value.filter((item): item is string => (
    typeof item === 'string'
    && item.length >= 1
    && item.length <= itemMaxLength
  ));
  if (parsed.length !== value.length || new Set(parsed).size !== parsed.length) return null;
  return [...parsed];
}

function isEmptyOrHttpUrl(value: string): boolean {
  if (value === '') return true;
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function parseProfileEnumList<T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  maxItems: number,
): T[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const parsed = value.filter((item): item is T => typeof item === 'string' && allowed.has(item as T));
  if (parsed.length !== value.length || new Set(parsed).size !== parsed.length) return null;
  return parsed;
}

function parseProfileEnvelope(raw: unknown, expectedWorkspaceId: string): RemoteMarketingProfile | null {
  if (textValue(raw, 'workspaceId') !== expectedWorkspaceId) return null;
  const profile = ownObject(raw, 'profile');
  const businessRaw = profile ? ownObject(profile, 'business') : null;
  const brandRaw = profile ? ownObject(profile, 'brand') : null;
  const audienceRaw = profile ? ownObject(profile, 'audience') : null;
  if (!profile || !businessRaw || !brandRaw || !audienceRaw) return null;

  const businessText = parseProfileTextFields(businessRaw, PROFILE_TEXT_LIMITS.business);
  const brandText = parseProfileTextFields(brandRaw, PROFILE_TEXT_LIMITS.brand);
  const audienceText = parseProfileTextFields(audienceRaw, PROFILE_TEXT_LIMITS.audience);
  const wordsToUse = parseProfileStringList(ownValue(brandRaw, 'wordsToUse'), 12, 160);
  const wordsToAvoid = parseProfileStringList(ownValue(brandRaw, 'wordsToAvoid'), 12, 160);
  const objectives = parseProfileEnumList(ownValue(profile, 'objectives'), OBJECTIVES, OBJECTIVES.size);
  const channels = parseProfileEnumList(ownValue(profile, 'channels'), CHANNELS, CHANNELS.size);
  const resources = parseProfileStringList(ownValue(profile, 'resources'), 20, 240);
  const completedStepsValue = ownValue(profile, 'completedSteps');
  const completedSteps = Array.isArray(completedStepsValue)
    && completedStepsValue.length <= 7
    && completedStepsValue.every((step) => Number.isInteger(step) && step >= 1 && step <= 7)
    && new Set(completedStepsValue).size === completedStepsValue.length
    ? [...completedStepsValue] as number[]
    : null;
  const rawAutomationMode = textValue(profile, 'automationMode');
  const automationMode = rawAutomationMode === 'guarded_autonomous'
    ? 'guardrailed_autonomous'
    : rawAutomationMode as CustomerAutomationMode;
  const completed = ownValue(profile, 'completed');
  const revision = ownValue(profile, 'revision');
  const updatedAt = textValue(profile, 'updatedAt');
  const derivedCompleted = completedSteps?.length === 7;

  if (
    !businessText
    || !brandText
    || !audienceText
    || !wordsToUse
    || !wordsToAvoid
    || !objectives
    || !channels
    || !resources
    || !completedSteps
    || !isEmptyOrHttpUrl(businessText.website)
    || !isEmptyOrHttpUrl(brandText.logoUrl)
    || !HEX_COLOR_PATTERN.test(brandText.primaryColor)
    || !HEX_COLOR_PATTERN.test(brandText.accentColor)
    || !AUTOMATION_MODES.has(automationMode)
    || typeof completed !== 'boolean'
    || completed !== derivedCompleted
    || typeof revision !== 'number'
    || !Number.isSafeInteger(revision)
    || revision < 0
    || !updatedAt
    || Number.isNaN(Date.parse(updatedAt))
  ) return null;

  return {
    workspaceId: expectedWorkspaceId,
    business: businessText as unknown as CustomerBusinessProfile,
    brand: {
      ...brandText,
      wordsToUse,
      wordsToAvoid,
    } as CustomerBrandProfile,
    audience: audienceText as unknown as CustomerAudienceProfile,
    objectives,
    channels,
    resources,
    automationMode,
    completedSteps,
    completed,
    revision,
    updatedAt,
  };
}

export class CustomerMarketingWorkspaceClient implements CustomerMarketingWorkspaceGateway {
  private readonly baseUrl: string;
  private readonly enabled: boolean;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly auth: AuthTokenProvider,
    options: ClientOptions = {},
  ) {
    this.baseUrl = (options.baseUrl ?? IZZI_API_BASE).replace(/\/$/, '');
    this.enabled = options.enabled ?? process.env.STARIZZI_CUSTOMER_MARKETING_API_ENABLED === 'true';
    this.timeoutMs = options.timeoutMs ?? 6_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getCurrent(preferredWorkspaceId?: string): Promise<CustomerMarketingWorkspaceState> {
    if (!this.enabled) return { status: 'local', workspace: null };
    const result = await this.request('/api/marketing/workspaces');
    if (!result.ok) return { status: 'unavailable', workspace: null };

    const workspaces = ownArray(result.body, 'workspaces')
      .map(parseEnvelope)
      .filter((workspace): workspace is RemoteMarketingWorkspace => workspace !== null);
    const preferredWorkspace = preferredWorkspaceId
      ? workspaces.find((item) => item.id === preferredWorkspaceId) ?? null
      : null;
    if (preferredWorkspaceId && UUID_PATTERN.test(preferredWorkspaceId) && !preferredWorkspace) {
      return { status: 'unavailable', workspace: null };
    }
    const workspace = preferredWorkspace ?? workspaces[0] ?? null;
    return { status: 'synced', workspace };
  }

  async ensureWorkspace(input: EnsureCustomerMarketingWorkspaceInput): Promise<CustomerMarketingWorkspaceState> {
    const current = await this.getCurrent(input.preferredWorkspaceId);
    if (current.status !== 'synced' || current.workspace) return current;

    const result = await this.request('/api/marketing/workspaces', {
      method: 'POST',
      body: JSON.stringify({ name: input.name, operatingMode: input.operatingMode }),
    });
    if (!result.ok) return { status: 'unavailable', workspace: null };

    const envelope = ownObject(result.body, 'workspace');
    const workspace = envelope ? parseEnvelope(envelope) : null;
    return workspace
      ? { status: 'synced', workspace }
      : { status: 'unavailable', workspace: null };
  }

  async getCapabilities(workspaceId: string): Promise<CustomerMarketingCapabilityCatalogState> {
    if (!this.enabled) return { status: 'local', revision: null, capabilities: [] };
    if (!UUID_PATTERN.test(workspaceId)) {
      return { status: 'unavailable', revision: null, capabilities: [] };
    }
    const result = await this.request(`/api/marketing/workspaces/${workspaceId}/capabilities`);
    if (!result.ok) {
      if (result.status === 403) return { status: 'forbidden', revision: null, capabilities: [] };
      if (result.status === 404) return { status: 'not_found', revision: null, capabilities: [] };
      return { status: 'unavailable', revision: null, capabilities: [] };
    }
    const catalog = parseCapabilityCatalog(result.body, workspaceId);
    return catalog
      ? { status: 'synced', ...catalog }
      : { status: 'unavailable', revision: null, capabilities: [] };
  }

  async getProfile(workspaceId: string): Promise<CustomerMarketingProfileState> {
    if (!this.enabled) return { status: 'local', profile: null };
    if (!UUID_PATTERN.test(workspaceId)) return { status: 'unavailable', profile: null };

    const result = await this.request(`/api/marketing/workspaces/${workspaceId}/profile`);
    if (!result.ok) {
      if (result.status === 403) return { status: 'forbidden', profile: null };
      if (result.status === 404) return { status: 'not_found', profile: null };
      return { status: 'unavailable', profile: null };
    }
    const profile = parseProfileEnvelope(result.body, workspaceId);
    return profile
      ? { status: 'synced', profile }
      : { status: 'unavailable', profile: null };
  }

  async updateProfile(
    input: CustomerMarketingProfileUpdateInput,
  ): Promise<CustomerMarketingProfileState> {
    if (!this.enabled) return { status: 'local', profile: null };
    if (
      !UUID_PATTERN.test(input.workspaceId)
      || !Number.isSafeInteger(input.expectedRevision)
      || input.expectedRevision < 0
    ) return { status: 'unavailable', profile: null };

    const profile = input.profile;
    const result = await this.request(
      `/api/marketing/workspaces/${input.workspaceId}/profile`,
      {
        method: 'PUT',
        body: JSON.stringify({
          expectedRevision: input.expectedRevision,
          business: profile.business,
          brand: profile.brand,
          audience: profile.audience,
          objectives: profile.objectives,
          channels: profile.channels,
          resources: profile.resources,
          automationMode: profile.automationMode === 'guardrailed_autonomous'
            ? 'guarded_autonomous'
            : profile.automationMode,
          completedSteps: profile.completedSteps,
        }),
      },
    );
    if (!result.ok) {
      if (result.status === 409 && result.code === 'profile_conflict') {
        return { status: 'conflict', profile: null };
      }
      if (result.status === 403) return { status: 'forbidden', profile: null };
      if (result.status === 404) return { status: 'not_found', profile: null };
      return { status: 'unavailable', profile: null };
    }
    const updated = parseProfileEnvelope(result.body, input.workspaceId);
    return updated
      ? { status: 'synced', profile: updated }
      : { status: 'unavailable', profile: null };
  }
  async listMembers(workspaceId: string): Promise<CustomerMarketingMembersState> {
    if (!this.enabled) return { status: 'local', members: [] };
    if (!UUID_PATTERN.test(workspaceId)) return { status: 'unavailable', members: [] };

    const result = await this.request(`/api/marketing/workspaces/${workspaceId}/members`);
    if (!result.ok) {
      return { status: result.status === 403 ? 'forbidden' : 'unavailable', members: [] };
    }
    if (textValue(result.body, 'workspaceId') !== workspaceId) {
      return { status: 'unavailable', members: [] };
    }
    const rawMembers = ownValue(result.body, 'members');
    if (!Array.isArray(rawMembers)) return { status: 'unavailable', members: [] };
    const members = rawMembers.map(parseMember);
    if (members.some((member) => member === null)) return { status: 'unavailable', members: [] };
    return {
      status: 'synced',
      members: members as RemoteMarketingMember[],
    };
  }

  async updateMemberRole(
    input: CustomerMarketingMemberRoleUpdateInput,
  ): Promise<CustomerMarketingMemberUpdateState> {
    if (!this.enabled) return { status: 'local', member: null };
    if (
      !UUID_PATTERN.test(input.workspaceId)
      || !UUID_PATTERN.test(input.memberUserId)
      || !ASSIGNABLE_ROLES.has(input.role)
    ) return { status: 'unavailable', member: null };

    const result = await this.request(
      `/api/marketing/workspaces/${input.workspaceId}/members/${input.memberUserId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ role: input.role }),
      },
    );
    if (!result.ok) {
      if (result.status === 403) return { status: 'forbidden', member: null };
      if (result.status === 404) return { status: 'not_found', member: null };
      return { status: 'unavailable', member: null };
    }

    if (textValue(result.body, 'workspaceId') !== input.workspaceId) {
      return { status: 'unavailable', member: null };
    }
    const rawMember = ownObject(result.body, 'member');
    const member = rawMember ? parseMember(rawMember) : null;
    if (!member || member.userId !== input.memberUserId || member.role !== input.role) {
      return { status: 'unavailable', member: null };
    }
    return { status: 'synced', member };
  }

  async createInvitation(
    input: CustomerMarketingInvitationCreateInput,
  ): Promise<CustomerMarketingInvitationCreateState> {
    if (!this.enabled) return { status: 'local', invitation: null, inviteToken: null };
    if (
      !UUID_PATTERN.test(input.workspaceId)
      || typeof input.email !== 'string'
      || input.email.length < 3
      || input.email.length > 320
      || !EMAIL_PATTERN.test(input.email)
      || !ASSIGNABLE_ROLES.has(input.role)
      || !INVITATION_TOKEN_PATTERN.test(input.idempotencyKey)
    ) return { status: 'unavailable', invitation: null, inviteToken: null };

    const result = await this.request(
      `/api/marketing/workspaces/${input.workspaceId}/invitations`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': input.idempotencyKey },
        body: JSON.stringify({ email: input.email, role: input.role }),
      },
    );
    if (!result.ok) {
      if (result.status === 403) return { status: 'forbidden', invitation: null, inviteToken: null };
      if (result.status === 409) return { status: 'conflict', invitation: null, inviteToken: null };
      return { status: 'unavailable', invitation: null, inviteToken: null };
    }

    const invitationRaw = ownObject(result.body, 'invitation');
    const invitation = invitationRaw
      ? parseInvitation(invitationRaw, input.email, input.role)
      : null;
    const inviteToken = textValue(result.body, 'inviteToken');
    if (!invitation || !INVITATION_TOKEN_PATTERN.test(inviteToken)) {
      return { status: 'unavailable', invitation: null, inviteToken: null };
    }
    return { status: 'created', invitation, inviteToken };
  }

  async acceptInvitation(inviteToken: string): Promise<CustomerMarketingInvitationAcceptanceState> {
    if (!this.enabled) return { status: 'local', workspaceId: null, role: null };
    if (!INVITATION_TOKEN_PATTERN.test(inviteToken)) {
      return { status: 'unavailable', workspaceId: null, role: null };
    }

    const result = await this.request('/api/marketing/workspaces/invitations/accept', {
      method: 'POST',
      body: JSON.stringify({ token: inviteToken }),
    });
    if (!result.ok) {
      if (result.status === 403) return { status: 'forbidden', workspaceId: null, role: null };
      if (result.status === 404) return { status: 'not_found', workspaceId: null, role: null };
      if (result.status === 409) return { status: 'conflict', workspaceId: null, role: null };
      if (result.status === 429) return { status: 'quota_exceeded', workspaceId: null, role: null };
      return { status: 'unavailable', workspaceId: null, role: null };
    }

    const membership = ownObject(result.body, 'membership');
    if (!membership) return { status: 'unavailable', workspaceId: null, role: null };
    const workspaceId = textValue(membership, 'workspace_id');
    const userId = textValue(membership, 'user_id');
    const role = textValue(membership, 'role') as CustomerRole;
    const status = textValue(membership, 'status');
    const joinedAt = textValue(membership, 'joined_at');
    if (
      !UUID_PATTERN.test(workspaceId)
      || !UUID_PATTERN.test(userId)
      || !ROLES.has(role)
      || status !== 'active'
      || !isIsoDate(joinedAt)
    ) return { status: 'unavailable', workspaceId: null, role: null };
    return { status: 'accepted', workspaceId, role };
  }

  async listMarketingResources(
    workspaceId: string,
    kind: CustomerMarketingResourceKind,
  ): Promise<CustomerMarketingResourceListState> {
    if (!this.enabled) return { status: 'local', resources: [] };
    if (!UUID_PATTERN.test(workspaceId) || !MARKETING_RESOURCE_KINDS.has(kind)) {
      return { status: 'unavailable', resources: [] };
    }
    const result = await this.request(
      `/api/marketing/workspaces/${workspaceId}/${MARKETING_RESOURCE_COLLECTIONS[kind]}`,
    );
    if (!result.ok) return { status: marketingFailureStatus(result.status), resources: [] };
    const resources = parseMarketingListEnvelope(result.body, workspaceId, kind);
    return resources
      ? { status: 'synced', resources }
      : { status: 'unavailable', resources: [] };
  }

  async listMarketingCalendar(
    workspaceId: string,
    input?: CustomerMarketingCalendarInput,
  ): Promise<CustomerMarketingResourceListState> {
    if (!this.enabled) return { status: 'local', resources: [] };
    const range = input === undefined ? undefined : parseMarketingCalendarInput(input);
    if (!UUID_PATTERN.test(workspaceId) || input !== undefined && !range) {
      return { status: 'unavailable', resources: [] };
    }
    const query = range
      ? `?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`
      : '';
    const result = await this.request(`/api/marketing/workspaces/${workspaceId}/calendar${query}`);
    if (!result.ok) return { status: marketingFailureStatus(result.status), resources: [] };
    const resources = parseMarketingListEnvelope(result.body, workspaceId);
    return resources
      ? { status: 'synced', resources }
      : { status: 'unavailable', resources: [] };
  }

  async getMarketingAnalytics(
    workspaceId: string,
    input: CustomerMarketingAnalyticsWindow,
  ): Promise<CustomerMarketingAnalyticsState> {
    if (!this.enabled) return { status: 'local', report: null };
    const window = parseMarketingAnalyticsWindow(input);
    if (!UUID_PATTERN.test(workspaceId) || !window) return { status: 'unavailable', report: null };
    const query = `?from=${encodeURIComponent(window.from)}&to=${encodeURIComponent(window.to)}`;
    const result = await this.request(`/api/marketing/workspaces/${workspaceId}/analytics${query}`);
    if (!result.ok) return { status: marketingFailureStatus(result.status), report: null };
    const report = parseMarketingAnalyticsEnvelope(result.body, workspaceId, window);
    return report
      ? { status: 'synced', report }
      : { status: 'unavailable', report: null };
  }

  async getMarketingResource(
    workspaceId: string,
    kind: CustomerMarketingResourceKind,
    resourceId: string,
  ): Promise<CustomerMarketingResourceState> {
    if (!this.enabled) return { status: 'local', resource: null };
    if (!UUID_PATTERN.test(workspaceId) || !MARKETING_RESOURCE_KINDS.has(kind)
      || !UUID_PATTERN.test(resourceId)) return { status: 'unavailable', resource: null };
    const result = await this.request(
      `/api/marketing/workspaces/${workspaceId}/${MARKETING_RESOURCE_COLLECTIONS[kind]}/${resourceId}`,
    );
    if (!result.ok) return { status: marketingFailureStatus(result.status), resource: null };
    const parsed = parseMarketingResourceEnvelope(
      result.body,
      ['workspaceId', 'resource'],
      workspaceId,
      kind,
      resourceId,
    );
    return parsed
      ? { status: 'synced', resource: parsed.resource }
      : { status: 'unavailable', resource: null };
  }

  async createMarketingResource(
    input: CustomerMarketingResourceGatewayCreateInput,
  ): Promise<CustomerMarketingResourceState> {
    if (!this.enabled) return { status: 'local', resource: null };
    const resource = parseMarketingResourceCreateInput(input?.resource);
    if (!UUID_PATTERN.test(input?.workspaceId) || !MARKETING_IDEMPOTENCY_PATTERN.test(input?.idempotencyKey)
      || !resource) return { status: 'unavailable', resource: null };
    const { kind, ...body } = resource;
    const result = await this.request(
      `/api/marketing/workspaces/${input.workspaceId}/${MARKETING_RESOURCE_COLLECTIONS[kind]}`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': input.idempotencyKey },
        body: JSON.stringify(body),
      },
    );
    if (!result.ok) return { status: marketingFailureStatus(result.status), resource: null };
    const parsed = parseMarketingResourceEnvelope(
      result.body,
      ['workspaceId', 'resource', 'duplicate'],
      input.workspaceId,
      kind,
    );
    return parsed
      ? { status: 'synced', resource: parsed.resource, duplicate: parsed.duplicate }
      : { status: 'unavailable', resource: null };
  }

  async updateMarketingResource(
    input: CustomerMarketingResourceGatewayUpdateInput,
  ): Promise<CustomerMarketingResourceState> {
    if (!this.enabled) return { status: 'local', resource: null };
    const parsedInput = parseMarketingResourceUpdateInput({
      kind: input?.kind,
      resourceId: input?.resourceId,
      expectedRevision: input?.expectedRevision,
      patch: input?.patch,
    });
    if (!UUID_PATTERN.test(input?.workspaceId) || !parsedInput) {
      return { status: 'unavailable', resource: null };
    }
    const result = await this.request(
      `/api/marketing/workspaces/${input.workspaceId}/${MARKETING_RESOURCE_COLLECTIONS[parsedInput.kind]}/${parsedInput.resourceId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ expectedRevision: parsedInput.expectedRevision, ...parsedInput.patch }),
      },
    );
    if (!result.ok) return { status: marketingFailureStatus(result.status), resource: null };
    const parsed = parseMarketingResourceEnvelope(
      result.body,
      ['workspaceId', 'resource'],
      input.workspaceId,
      parsedInput.kind,
      parsedInput.resourceId,
    );
    return parsed
      ? { status: 'synced', resource: parsed.resource }
      : { status: 'unavailable', resource: null };
  }

  async reviewMarketingResource(
    input: CustomerMarketingResourceGatewayReviewInput,
  ): Promise<CustomerMarketingResourceState> {
    if (!this.enabled) return { status: 'local', resource: null };
    const parsedInput = parseMarketingResourceReviewInput({
      kind: input?.kind,
      resourceId: input?.resourceId,
      action: input?.action,
      expectedRevision: input?.expectedRevision,
    });
    if (!UUID_PATTERN.test(input?.workspaceId) || !parsedInput) {
      return { status: 'unavailable', resource: null };
    }
    const result = await this.request(
      `/api/marketing/workspaces/${input.workspaceId}/${MARKETING_RESOURCE_COLLECTIONS[parsedInput.kind]}/${parsedInput.resourceId}/review`,
      {
        method: 'POST',
        body: JSON.stringify({
          action: parsedInput.action,
          expectedRevision: parsedInput.expectedRevision,
        }),
      },
    );
    if (!result.ok) return { status: marketingFailureStatus(result.status), resource: null };
    const parsed = parseMarketingResourceEnvelope(
      result.body,
      ['workspaceId', 'resource'],
      input.workspaceId,
      parsedInput.kind,
      parsedInput.resourceId,
    );
    return parsed
      ? { status: 'synced', resource: parsed.resource }
      : { status: 'unavailable', resource: null };
  }

  async archiveMarketingResource(
    input: CustomerMarketingResourceGatewayArchiveInput,
  ): Promise<CustomerMarketingResourceArchiveState> {
    if (!this.enabled) return { status: 'local', deleted: false };
    const parsedInput = parseMarketingResourceArchiveInput({
      kind: input?.kind,
      resourceId: input?.resourceId,
      expectedRevision: input?.expectedRevision,
    });
    if (!UUID_PATTERN.test(input?.workspaceId) || !parsedInput) {
      return { status: 'unavailable', deleted: false };
    }
    const result = await this.request(
      `/api/marketing/workspaces/${input.workspaceId}/${MARKETING_RESOURCE_COLLECTIONS[parsedInput.kind]}/${parsedInput.resourceId}`,
      {
        method: 'DELETE',
        body: JSON.stringify({ expectedRevision: parsedInput.expectedRevision }),
      },
    );
    if (!result.ok) return { status: marketingFailureStatus(result.status), deleted: false };
    const envelope = exactRecord(result.body, ['workspaceId', 'deleted']);
    return envelope?.workspaceId === input.workspaceId && envelope.deleted === true
      ? { status: 'synced', deleted: true }
      : { status: 'unavailable', deleted: false };
  }

  async startSevenDayWorkflow(input: CustomerMarketingWorkflowStartInput): Promise<CustomerMarketingWorkflowState> {
    if (!this.enabled) return { status: 'local', run: null };
    if (!UUID_PATTERN.test(input.workspaceId)
      || typeof input.objective !== 'string' || input.objective.trim().length < 1 || input.objective.length > 500
      || input.channels.length < 1 || input.channels.length > 7
      || input.channels.some((channel) => !CHANNELS.has(channel))
      || new Set(input.channels).size !== input.channels.length
      || !/^\d{4}-\d{2}-\d{2}$/.test(input.startsOn)
      || Number.isNaN(Date.parse(`${input.startsOn}T00:00:00Z`))
      || !/^[A-Za-z0-9._:-]{8,128}$/.test(input.idempotencyKey)) {
      return { status: 'unavailable', run: null };
    }
    const result = await this.request(
      `/api/marketing/workspaces/${input.workspaceId}/workflows/seven-day`,
      {
        method: 'POST',
        headers: { 'Idempotency-Key': input.idempotencyKey },
        body: JSON.stringify({ objective: input.objective, channels: input.channels, startsOn: input.startsOn }),
      },
    );
    if (!result.ok) return { status: marketingFailureStatus(result.status), run: null };
    return parseSevenDayWorkflowEnvelope(result.body, input.workspaceId, ['workspaceId', 'run', 'duplicate']);
  }

  async getSevenDayWorkflow(workspaceId: string, runId: string): Promise<CustomerMarketingWorkflowState> {
    if (!this.enabled) return { status: 'local', run: null };
    if (!UUID_PATTERN.test(workspaceId) || !UUID_PATTERN.test(runId)) return { status: 'unavailable', run: null };
    const result = await this.request(`/api/marketing/workspaces/${workspaceId}/workflows/${runId}`);
    if (!result.ok) return { status: marketingFailureStatus(result.status), run: null };
    return parseSevenDayWorkflowEnvelope(result.body, workspaceId, ['workspaceId', 'run']);
  }

  async resumeSevenDayWorkflow(input: CustomerMarketingWorkflowResumeInput): Promise<CustomerMarketingWorkflowState> {
    if (!this.enabled) return { status: 'local', run: null };
    if (!UUID_PATTERN.test(input.workspaceId) || !UUID_PATTERN.test(input.runId)
      || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
      return { status: 'unavailable', run: null };
    }
    const result = await this.request(
      `/api/marketing/workspaces/${input.workspaceId}/workflows/${input.runId}/resume`,
      { method: 'POST', body: JSON.stringify({ expectedRevision: input.expectedRevision }) },
    );
    if (!result.ok) return { status: marketingFailureStatus(result.status), run: null };
    return parseSevenDayWorkflowEnvelope(result.body, input.workspaceId, ['workspaceId', 'run', 'duplicate']);
  }

  async reviewSevenDayWorkflow(input: CustomerMarketingWorkflowReviewInput): Promise<CustomerMarketingWorkflowState> {
    if (!this.enabled) return { status: 'local', run: null };
    if (!UUID_PATTERN.test(input.workspaceId) || !UUID_PATTERN.test(input.runId)
      || (input.decision !== 'approve' && input.decision !== 'reject')
      || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
      return { status: 'unavailable', run: null };
    }
    const result = await this.request(
      `/api/marketing/workspaces/${input.workspaceId}/workflows/${input.runId}/review`,
      {
        method: 'POST',
        body: JSON.stringify({ decision: input.decision, expectedRevision: input.expectedRevision }),
      },
    );
    if (!result.ok) return { status: marketingFailureStatus(result.status), run: null };
    return parseSevenDayWorkflowEnvelope(result.body, input.workspaceId, ['workspaceId', 'run', 'duplicate']);
  }

  async reserveQuota(input: CustomerMarketingQuotaReservationInput): Promise<CustomerMarketingQuotaReservation> {
    if (!this.enabled) return { status: 'local', quota: null };
    if (
      !UUID_PATTERN.test(input.workspaceId)
      || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(input.capabilityId)
      || !Number.isFinite(input.units)
      || input.units <= 0
      || !/^[A-Za-z0-9._:-]{8,128}$/.test(input.idempotencyKey)
    ) {
      return { status: 'unavailable', quota: null };
    }

    const result = await this.request(
      `/api/marketing/workspaces/${input.workspaceId}/quota/reservations`,
      {
        method: 'POST',
        headers: { 'X-Marketing-Capability-Id': input.capabilityId },
        body: JSON.stringify({
          metric: input.metric,
          units: input.units,
          idempotencyKey: input.idempotencyKey,
          metadata: input.metadata ?? {},
        }),
      },
    );
    if (!result.ok) {
      if (result.status === 429 && result.code === 'quota_exceeded') {
        return { status: 'quota_exceeded', quota: null };
      }
      if (result.status === 403 && result.code === 'plan_required') {
        return { status: 'plan_required', quota: null };
      }
      if (result.status === 403) return { status: 'forbidden', quota: null };
      return { status: 'unavailable', quota: null };
    }

    const reservation = ownObject(result.body, 'reservation');
    const quota = reservation ? parseQuota(ownObject(reservation, 'quota')) : null;
    if (!reservation || !quota) return { status: 'unavailable', quota: null };
    return {
      status: 'reserved',
      duplicate: ownValue(reservation, 'duplicate') === true,
      quota,
    };
  }

  private async request(
    path: string,
    init: RequestInit = {},
  ): Promise<{ ok: true; body: unknown } | { ok: false; status?: number; code?: string }> {
    const token = await this.auth.getAccessToken();
    if (!token) return { ok: false, status: 401 };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          ...(init.headers as Record<string, string> | undefined),
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        // Invalid or empty responses fail closed below.
      }
      if (!response.ok) {
        this.logFailure(path, response.status);
        const error = ownObject(body, 'error');
        return {
          ok: false,
          status: response.status,
          code: error ? textValue(error, 'code') || undefined : undefined,
        };
      }
      if (body === null) return { ok: false, status: response.status };
      return { ok: true, body };
    } catch {
      this.logFailure(path);
      return { ok: false };
    } finally {
      clearTimeout(timer);
    }
  }

  private logFailure(path: string, status?: number): void {
    const detail = status === undefined ? 'unavailable' : `status ${status}`;
    console.warn(`[CustomerMarketingWorkspaceClient] ${path}: ${detail}`);
  }
}
