/**
 * Live.md shared contract and pure mutation rules.
 *
 * The accepted Personal Office contract defines LiveProfile as mutable and
 * revisioned. This module defines the human-readable Live.md payload beneath
 * that aggregate without changing the contract of record.
 */

import {
  PERSONAL_OFFICE_SCHEMA_VERSION,
  isSecretRef,
  looksLikeRawSecret,
  type DataClassification,
  type SecretRef,
} from './personal-office';

export const LIVE_MARKDOWN_FORMAT_VERSION = 1 as const;
export const LIVE_PROFILE_FENCE = 'live-profile';
export const LIVE_CONTEXT_PRECEDENCE = Object.freeze([
  'safety-system',
  'current-user-request',
  'workspace-policy',
  'global-live-profile',
  'learned-preference',
  'model-default',
] as const);

const MAX_MARKDOWN_BYTES = 512 * 1024;
const MAX_DIRECTIVES = 500;
const MAX_PROPOSALS = 500;
const MAX_VALUE_LENGTH = 8_000;
const MAX_REASON_LENGTH = 2_000;
const MAX_IDENTIFIER_LENGTH = 160;

export interface LiveProfileScope {
  readonly workspaceId: string;
  readonly ownerId: string;
}

export type LiveDirectiveKind = 'preference' | 'rule';
export type LiveDirectiveSource = 'workspace-default' | 'accepted-proposal' | 'user';
export type LiveProposalStatus = 'pending' | 'accepted' | 'rejected';
export type LiveLearningSource = 'email' | 'browser' | 'chat' | 'file';
export type LiveLearningConsent = Readonly<Record<LiveLearningSource, boolean>>;
export type LiveActor = {
  readonly kind: 'user' | 'agent' | 'system';
  readonly id: string;
};

export interface LiveDirective {
  readonly id: string;
  readonly kind: LiveDirectiveKind;
  readonly key: string;
  readonly value: string;
  readonly source: LiveDirectiveSource;
  readonly authoredBy: string;
  readonly proposalId?: string;
  readonly supersedesDirectiveId?: string;
  readonly sourceType?: LiveLearningSource;
  readonly sourceRef?: string;
  readonly expiresAt?: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LiveDirectiveProposal {
  readonly id: string;
  readonly kind: LiveDirectiveKind;
  readonly key: string;
  readonly value: string;
  readonly reason: string;
  readonly proposedBy: string;
  readonly baseDirectiveId: string | null;
  readonly baseDirectiveRevision: number;
  readonly status: LiveProposalStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly decidedBy?: string;
  readonly decidedAt?: string;
  readonly acceptedDirectiveId?: string;
  readonly sourceType?: LiveLearningSource;
  readonly sourceRef?: string;
  readonly expiresAt?: string;
}

export interface LiveProfileDocument {
  readonly schemaVersion: number;
  readonly formatVersion: typeof LIVE_MARKDOWN_FORMAT_VERSION;
  readonly profileId: string;
  readonly scope: LiveProfileScope;
  readonly documentRef: string;
  readonly classification: Extract<DataClassification, 'personal_graph' | 'local_files'>;
  readonly revision: number;
  readonly learningConsent: LiveLearningConsent;
  readonly directives: readonly LiveDirective[];
  readonly proposals: readonly LiveDirectiveProposal[];
  readonly secretRefs: readonly SecretRef[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export class LiveProfileValidationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'LiveProfileValidationError';
    this.code = code;
  }
}

export class LiveProfileConflictError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'LiveProfileConflictError';
    this.code = code;
  }
}

export interface CreateLiveProfileInput {
  readonly scope: LiveProfileScope;
  readonly documentRef: string;
  readonly now: string;
  readonly profileId?: string;
  readonly classification?: Extract<DataClassification, 'personal_graph' | 'local_files'>;
  readonly defaults?: ReadonlyArray<{
    readonly id: string;
    readonly kind: LiveDirectiveKind;
    readonly key: string;
    readonly value: string;
  }>;
  readonly secretRefs?: readonly SecretRef[];
}

export interface ApplyUserDirectiveInput {
  readonly expectedRevision: number;
  readonly actor: LiveActor;
  readonly id: string;
  readonly kind: LiveDirectiveKind;
  readonly key: string;
  readonly value: string;
  readonly expiresAt?: string;
  readonly now: string;
}

export interface ProposeLiveDirectiveInput {
  readonly expectedRevision: number;
  readonly actor: LiveActor;
  readonly id: string;
  readonly kind: LiveDirectiveKind;
  readonly key: string;
  readonly value: string;
  readonly reason: string;
  readonly sourceType?: LiveLearningSource;
  readonly sourceRef?: string;
  readonly expiresAt?: string;
  readonly now: string;
}

export interface SetLiveLearningConsentInput {
  readonly expectedRevision: number;
  readonly actor: LiveActor;
  readonly source: LiveLearningSource;
  readonly enabled: boolean;
  readonly now: string;
}

export interface DecideLiveProposalInput {
  readonly expectedRevision: number;
  readonly actor: LiveActor;
  readonly proposalId: string;
  readonly decision: 'accept' | 'reject';
  readonly now: string;
}

const SOURCE_PRECEDENCE: Readonly<Record<LiveDirectiveSource, number>> = Object.freeze({
  'workspace-default': 1,
  'accepted-proposal': 2,
  user: 3,
});

const DEFAULT_LEARNING_CONSENT: LiveLearningConsent = Object.freeze({
  email: false,
  browser: false,
  chat: false,
  file: false,
});

const RAW_SECRET_PATTERNS: readonly RegExp[] = Object.freeze([
  /\bsk-[A-Za-z0-9_-]{12,}\b/,
  /\bizzi-[A-Za-z0-9_-]{12,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{16,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{12,}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{12,}={0,2}\b/i,
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
]);

function plainRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new LiveProfileValidationError('invalid-shape', `${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const allow = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype' || !allow.has(key)) {
      throw new LiveProfileValidationError(
        'unknown-field',
        `${label} contains an unsupported field '${key}'.`,
      );
    }
  }
}

function boundedString(
  value: unknown,
  label: string,
  maxLength = MAX_IDENTIFIER_LENGTH,
): string {
  if (typeof value !== 'string') {
    throw new LiveProfileValidationError('invalid-string', `${label} must be a string.`);
  }
  const normalized = value.normalize('NFC').trim();
  if (!normalized || normalized.length > maxLength || hasControlCharacter(normalized)) {
    throw new LiveProfileValidationError('invalid-string', `${label} is empty or invalid.`);
  }
  return normalized;
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) return true;
    if (code === 127) return true;
  }
  return false;
}

function positiveInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new LiveProfileValidationError('invalid-revision', `${label} must be a positive integer.`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new LiveProfileValidationError(
      'invalid-revision',
      `${label} must be a non-negative integer.`,
    );
  }
  return value;
}

function isoTimestamp(value: unknown, label: string): string {
  const timestamp = boundedString(value, label, 64);
  if (Number.isNaN(Date.parse(timestamp))) {
    throw new LiveProfileValidationError('invalid-timestamp', `${label} must be an ISO timestamp.`);
  }
  return timestamp;
}

function directiveKind(value: unknown, label: string): LiveDirectiveKind {
  if (value !== 'preference' && value !== 'rule') {
    throw new LiveProfileValidationError('invalid-kind', `${label} is invalid.`);
  }
  return value;
}

function directiveSource(value: unknown, label: string): LiveDirectiveSource {
  if (value !== 'workspace-default' && value !== 'accepted-proposal' && value !== 'user') {
    throw new LiveProfileValidationError('invalid-source', `${label} is invalid.`);
  }
  return value;
}

function proposalStatus(value: unknown, label: string): LiveProposalStatus {
  if (value !== 'pending' && value !== 'accepted' && value !== 'rejected') {
    throw new LiveProfileValidationError('invalid-status', `${label} is invalid.`);
  }
  return value;
}

function learningSource(value: unknown, label: string): LiveLearningSource {
  if (value !== 'email' && value !== 'browser' && value !== 'chat' && value !== 'file') {
    throw new LiveProfileValidationError('invalid-learning-source', `${label} is invalid.`);
  }
  return value;
}

function validateLearningConsent(raw: unknown): LiveLearningConsent {
  const value = plainRecord(raw, 'learningConsent');
  assertAllowedKeys(value, ['email', 'browser', 'chat', 'file'], 'learningConsent');
  for (const source of Object.keys(DEFAULT_LEARNING_CONSENT) as LiveLearningSource[]) {
    if (typeof value[source] !== 'boolean') {
      throw new LiveProfileValidationError(
        'invalid-learning-consent',
        `learningConsent.${source} must be a boolean.`,
      );
    }
  }
  return {
    email: value.email as boolean,
    browser: value.browser as boolean,
    chat: value.chat as boolean,
    file: value.file as boolean,
  };
}

function assertSafeText(value: string, label: string): void {
  if (looksLikeRawSecret(value) || RAW_SECRET_PATTERNS.some((pattern) => pattern.test(value))) {
    throw new LiveProfileValidationError(
      'raw-secret',
      `${label} contains credential-shaped material. Store a SecretRef instead.`,
    );
  }
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function assertSafeMarkdown(markdown: string): void {
  assertSafeText(markdown, 'Live.md');
}

function validateScope(raw: unknown): LiveProfileScope {
  const scope = plainRecord(raw, 'scope');
  assertAllowedKeys(scope, ['workspaceId', 'ownerId'], 'scope');
  return {
    workspaceId: boundedString(scope.workspaceId, 'scope.workspaceId'),
    ownerId: boundedString(scope.ownerId, 'scope.ownerId'),
  };
}

function validateDirective(raw: unknown, label: string): LiveDirective {
  const value = plainRecord(raw, label);
  assertAllowedKeys(
    value,
    [
      'id',
      'kind',
      'key',
      'value',
      'source',
      'authoredBy',
      'proposalId',
      'supersedesDirectiveId',
      'sourceType',
      'sourceRef',
      'expiresAt',
      'revision',
      'createdAt',
      'updatedAt',
    ],
    label,
  );
  const directive: LiveDirective = {
    id: boundedString(value.id, `${label}.id`),
    kind: directiveKind(value.kind, `${label}.kind`),
    key: boundedString(value.key, `${label}.key`),
    value: boundedString(value.value, `${label}.value`, MAX_VALUE_LENGTH),
    source: directiveSource(value.source, `${label}.source`),
    authoredBy: boundedString(value.authoredBy, `${label}.authoredBy`),
    revision: positiveInteger(value.revision, `${label}.revision`),
    createdAt: isoTimestamp(value.createdAt, `${label}.createdAt`),
    updatedAt: isoTimestamp(value.updatedAt, `${label}.updatedAt`),
    ...(value.proposalId === undefined
      ? {}
      : { proposalId: boundedString(value.proposalId, `${label}.proposalId`) }),
    ...(value.supersedesDirectiveId === undefined
      ? {}
      : {
          supersedesDirectiveId: boundedString(
            value.supersedesDirectiveId,
            `${label}.supersedesDirectiveId`,
          ),
        }),
    ...(value.sourceType === undefined
      ? {}
      : { sourceType: learningSource(value.sourceType, `${label}.sourceType`) }),
    ...(value.sourceRef === undefined
      ? {}
      : { sourceRef: boundedString(value.sourceRef, `${label}.sourceRef`, 240) }),
    ...(value.expiresAt === undefined
      ? {}
      : { expiresAt: isoTimestamp(value.expiresAt, `${label}.expiresAt`) }),
  };
  if ((directive.sourceType === undefined) !== (directive.sourceRef === undefined)) {
    throw new LiveProfileValidationError(
      'incomplete-provenance',
      `${label}.sourceType and sourceRef must be supplied together.`,
    );
  }
  if (
    directive.expiresAt !== undefined &&
    Date.parse(directive.expiresAt) <= Date.parse(directive.createdAt)
  ) {
    throw new LiveProfileValidationError(
      'invalid-expiry',
      `${label}.expiresAt must be later than createdAt.`,
    );
  }
  assertSafeText(directive.value, `${label}.value`);
  if (directive.sourceRef !== undefined) {
    assertSafeText(directive.sourceRef, `${label}.sourceRef`);
  }
  return directive;
}

function validateProposal(raw: unknown, label: string): LiveDirectiveProposal {
  const value = plainRecord(raw, label);
  assertAllowedKeys(
    value,
    [
      'id',
      'kind',
      'key',
      'value',
      'reason',
      'proposedBy',
      'baseDirectiveId',
      'baseDirectiveRevision',
      'status',
      'createdAt',
      'updatedAt',
      'decidedBy',
      'decidedAt',
      'acceptedDirectiveId',
      'sourceType',
      'sourceRef',
      'expiresAt',
    ],
    label,
  );
  if (value.baseDirectiveId !== null && typeof value.baseDirectiveId !== 'string') {
    throw new LiveProfileValidationError(
      'invalid-base',
      `${label}.baseDirectiveId must be a string or null.`,
    );
  }
  const proposal: LiveDirectiveProposal = {
    id: boundedString(value.id, `${label}.id`),
    kind: directiveKind(value.kind, `${label}.kind`),
    key: boundedString(value.key, `${label}.key`),
    value: boundedString(value.value, `${label}.value`, MAX_VALUE_LENGTH),
    reason: boundedString(value.reason, `${label}.reason`, MAX_REASON_LENGTH),
    proposedBy: boundedString(value.proposedBy, `${label}.proposedBy`),
    baseDirectiveId:
      value.baseDirectiveId === null
        ? null
        : boundedString(value.baseDirectiveId, `${label}.baseDirectiveId`),
    baseDirectiveRevision: nonNegativeInteger(
      value.baseDirectiveRevision,
      `${label}.baseDirectiveRevision`,
    ),
    status: proposalStatus(value.status, `${label}.status`),
    createdAt: isoTimestamp(value.createdAt, `${label}.createdAt`),
    updatedAt: isoTimestamp(value.updatedAt, `${label}.updatedAt`),
    ...(value.decidedBy === undefined
      ? {}
      : { decidedBy: boundedString(value.decidedBy, `${label}.decidedBy`) }),
    ...(value.decidedAt === undefined
      ? {}
      : { decidedAt: isoTimestamp(value.decidedAt, `${label}.decidedAt`) }),
    ...(value.acceptedDirectiveId === undefined
      ? {}
      : {
          acceptedDirectiveId: boundedString(
            value.acceptedDirectiveId,
            `${label}.acceptedDirectiveId`,
          ),
        }),
    ...(value.sourceType === undefined
      ? {}
      : { sourceType: learningSource(value.sourceType, `${label}.sourceType`) }),
    ...(value.sourceRef === undefined
      ? {}
      : { sourceRef: boundedString(value.sourceRef, `${label}.sourceRef`, 240) }),
    ...(value.expiresAt === undefined
      ? {}
      : { expiresAt: isoTimestamp(value.expiresAt, `${label}.expiresAt`) }),
  };
  if ((proposal.sourceType === undefined) !== (proposal.sourceRef === undefined)) {
    throw new LiveProfileValidationError(
      'incomplete-provenance',
      `${label}.sourceType and sourceRef must be supplied together.`,
    );
  }
  if (
    proposal.expiresAt !== undefined &&
    Date.parse(proposal.expiresAt) <= Date.parse(proposal.createdAt)
  ) {
    throw new LiveProfileValidationError(
      'invalid-expiry',
      `${label}.expiresAt must be later than createdAt.`,
    );
  }
  assertSafeText(proposal.value, `${label}.value`);
  assertSafeText(proposal.reason, `${label}.reason`);
  if (proposal.sourceRef !== undefined) {
    assertSafeText(proposal.sourceRef, `${label}.sourceRef`);
  }
  return proposal;
}

function validateSecretRef(raw: unknown, label: string): SecretRef {
  if (!isSecretRef(raw)) {
    throw new LiveProfileValidationError('invalid-secret-ref', `${label} must be a SecretRef.`);
  }
  const value = plainRecord(raw, label);
  assertAllowedKeys(value, ['kind', 'store', 'ref', 'scopes'], label);
  const ref = boundedString(raw.ref, `${label}.ref`, 240);
  assertSafeText(ref, `${label}.ref`);
  const scopes =
    raw.scopes === undefined
      ? undefined
      : raw.scopes.map((scope, index) =>
          boundedString(scope, `${label}.scopes[${index}]`, MAX_IDENTIFIER_LENGTH),
        );
  return {
    kind: 'secret-ref',
    store: raw.store,
    ref,
    ...(scopes ? { scopes } : {}),
  };
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new LiveProfileValidationError('duplicate-id', `${label} contains duplicate values.`);
  }
}

export function sameLiveProfileScope(a: LiveProfileScope, b: LiveProfileScope): boolean {
  return a.workspaceId === b.workspaceId && a.ownerId === b.ownerId;
}

export function validateLiveProfileDocument(raw: unknown): LiveProfileDocument {
  const value = plainRecord(raw, 'Live.md document');
  assertAllowedKeys(
    value,
    [
      'schemaVersion',
      'formatVersion',
      'profileId',
      'scope',
      'documentRef',
      'classification',
      'revision',
      'learningConsent',
      'directives',
      'proposals',
      'secretRefs',
      'createdAt',
      'updatedAt',
    ],
    'Live.md document',
  );
  if (value.schemaVersion !== PERSONAL_OFFICE_SCHEMA_VERSION) {
    throw new LiveProfileValidationError(
      'schema-version',
      `Unsupported Personal Office schema version '${String(value.schemaVersion)}'.`,
    );
  }
  if (value.formatVersion !== LIVE_MARKDOWN_FORMAT_VERSION) {
    throw new LiveProfileValidationError(
      'format-version',
      `Unsupported Live.md format version '${String(value.formatVersion)}'.`,
    );
  }
  if (value.classification !== 'personal_graph' && value.classification !== 'local_files') {
    throw new LiveProfileValidationError(
      'classification',
      'Live.md classification must be personal_graph or local_files.',
    );
  }
  if (!Array.isArray(value.directives) || value.directives.length > MAX_DIRECTIVES) {
    throw new LiveProfileValidationError('directives', 'Live.md directives are invalid or too large.');
  }
  if (!Array.isArray(value.proposals) || value.proposals.length > MAX_PROPOSALS) {
    throw new LiveProfileValidationError('proposals', 'Live.md proposals are invalid or too large.');
  }
  if (!Array.isArray(value.secretRefs)) {
    throw new LiveProfileValidationError('secret-refs', 'Live.md secretRefs must be an array.');
  }

  const document: LiveProfileDocument = {
    schemaVersion: PERSONAL_OFFICE_SCHEMA_VERSION,
    formatVersion: LIVE_MARKDOWN_FORMAT_VERSION,
    profileId: boundedString(value.profileId, 'profileId'),
    scope: validateScope(value.scope),
    documentRef: boundedString(value.documentRef, 'documentRef', 240),
    classification: value.classification,
    revision: positiveInteger(value.revision, 'revision'),
    learningConsent: validateLearningConsent(value.learningConsent),
    directives: value.directives.map((directive, index) =>
      validateDirective(directive, `directives[${index}]`),
    ),
    proposals: value.proposals.map((proposal, index) =>
      validateProposal(proposal, `proposals[${index}]`),
    ),
    secretRefs: value.secretRefs.map((ref, index) =>
      validateSecretRef(ref, `secretRefs[${index}]`),
    ),
    createdAt: isoTimestamp(value.createdAt, 'createdAt'),
    updatedAt: isoTimestamp(value.updatedAt, 'updatedAt'),
  };

  assertUnique(document.directives.map((directive) => directive.id), 'directive ids');
  assertUnique(document.proposals.map((proposal) => proposal.id), 'proposal ids');
  assertUnique(
    document.secretRefs.map((ref) => `${ref.store}:${ref.ref}`),
    'secret references',
  );

  const directiveIds = new Set(document.directives.map((directive) => directive.id));
  for (const directive of document.directives) {
    if (
      directive.supersedesDirectiveId !== undefined &&
      !directiveIds.has(directive.supersedesDirectiveId)
    ) {
      throw new LiveProfileValidationError(
        'missing-superseded-directive',
        `Directive '${directive.id}' supersedes an unknown directive.`,
      );
    }
    if (directive.revision > document.revision) {
      throw new LiveProfileValidationError(
        'future-directive',
        `Directive '${directive.id}' has a future revision.`,
      );
    }
  }
  for (const proposal of document.proposals) {
    if (
      proposal.baseDirectiveId !== null &&
      !directiveIds.has(proposal.baseDirectiveId)
    ) {
      throw new LiveProfileValidationError(
        'missing-base-directive',
        `Proposal '${proposal.id}' references an unknown base directive.`,
      );
    }
  }

  return document;
}

export function createLiveProfileDocument(input: CreateLiveProfileInput): LiveProfileDocument {
  const now = isoTimestamp(input.now, 'now');
  const scope = validateScope(input.scope);
  const revision = 1;
  const document: LiveProfileDocument = {
    schemaVersion: PERSONAL_OFFICE_SCHEMA_VERSION,
    formatVersion: LIVE_MARKDOWN_FORMAT_VERSION,
    profileId: input.profileId ?? `live:${scope.workspaceId}`,
    scope,
    documentRef: input.documentRef,
    classification: input.classification ?? 'personal_graph',
    revision,
    learningConsent: { ...DEFAULT_LEARNING_CONSENT },
    directives: (input.defaults ?? []).map((directive) => ({
      id: directive.id,
      kind: directive.kind,
      key: directive.key,
      value: directive.value,
      source: 'workspace-default',
      authoredBy: 'system:workspace-default',
      revision,
      createdAt: now,
      updatedAt: now,
    })),
    proposals: [],
    secretRefs: input.secretRefs ?? [],
    createdAt: now,
    updatedAt: now,
  };
  return validateLiveProfileDocument(document);
}

function directiveKey(directive: Pick<LiveDirective, 'kind' | 'key'>): string {
  return `${directive.kind}:${directive.key.toLocaleLowerCase()}`;
}

function compareDirectivePrecedence(a: LiveDirective, b: LiveDirective): number {
  const precedence = SOURCE_PRECEDENCE[a.source] - SOURCE_PRECEDENCE[b.source];
  if (precedence !== 0) return precedence;
  if (a.revision !== b.revision) return a.revision - b.revision;
  return a.id.localeCompare(b.id);
}

/**
 * Resolve current truth deterministically.
 *
 * Explicit supersession removes an older directive regardless of source. For
 * independent layers, user > accepted proposal > workspace default. Pending
 * proposals never participate.
 */
export function effectiveLiveDirectives(
  document: LiveProfileDocument,
  at?: string,
): LiveDirective[] {
  const validated = validateLiveProfileDocument(document);
  const requestedTime = at === undefined ? undefined : Date.parse(isoTimestamp(at, 'at'));
  const eligible = validated.directives.filter(
    (directive) =>
      requestedTime === undefined ||
      directive.expiresAt === undefined ||
      Date.parse(directive.expiresAt) > requestedTime,
  );
  const superseded = new Set(
    eligible.flatMap((directive) =>
      directive.supersedesDirectiveId ? [directive.supersedesDirectiveId] : [],
    ),
  );
  const selected = new Map<string, LiveDirective>();
  for (const directive of eligible) {
    if (superseded.has(directive.id)) continue;
    const key = directiveKey(directive);
    const current = selected.get(key);
    if (!current || compareDirectivePrecedence(directive, current) > 0) {
      selected.set(key, directive);
    }
  }
  return [...selected.values()].sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key),
  );
}

function requireRevision(document: LiveProfileDocument, expectedRevision: number): void {
  if (document.revision !== expectedRevision) {
    throw new LiveProfileConflictError(
      'revision-conflict',
      `Live.md revision changed from ${expectedRevision} to ${document.revision}. Reload before writing.`,
    );
  }
}

function requireActor(actor: LiveActor, kind: LiveActor['kind']): LiveActor {
  if (actor.kind !== kind) {
    throw new LiveProfileValidationError(
      'actor-not-authorized',
      `This operation requires a ${kind} actor.`,
    );
  }
  boundedString(actor.id, 'actor.id');
  return actor;
}

function requireProfileOwner(document: LiveProfileDocument, actor: LiveActor): LiveActor {
  requireActor(actor, 'user');
  if (actor.id !== document.scope.ownerId) {
    throw new LiveProfileValidationError(
      'actor-not-authorized',
      'Only the profile owner may change Live.md truth or learning consent.',
    );
  }
  return actor;
}

function currentDirective(
  document: LiveProfileDocument,
  kind: LiveDirectiveKind,
  key: string,
): LiveDirective | undefined {
  const normalizedKey = key.toLocaleLowerCase();
  return effectiveLiveDirectives(document).find(
    (directive) =>
      directive.kind === kind && directive.key.toLocaleLowerCase() === normalizedKey,
  );
}

export function applyUserDirective(
  document: LiveProfileDocument,
  input: ApplyUserDirectiveInput,
): LiveProfileDocument {
  const validated = validateLiveProfileDocument(document);
  requireRevision(validated, input.expectedRevision);
  requireProfileOwner(validated, input.actor);
  if (validated.directives.some((directive) => directive.id === input.id)) {
    throw new LiveProfileConflictError('duplicate-directive', `Directive '${input.id}' already exists.`);
  }
  const kind = directiveKind(input.kind, 'directive.kind');
  const key = boundedString(input.key, 'directive.key');
  const value = boundedString(input.value, 'directive.value', MAX_VALUE_LENGTH);
  assertSafeText(value, 'directive.value');
  const now = isoTimestamp(input.now, 'now');
  const previous = currentDirective(validated, kind, key);
  const revision = validated.revision + 1;
  return validateLiveProfileDocument({
    ...validated,
    revision,
    updatedAt: now,
    directives: [
      ...validated.directives,
      {
        id: boundedString(input.id, 'directive.id'),
        kind,
        key,
        value,
        source: 'user',
        authoredBy: input.actor.id,
        ...(previous ? { supersedesDirectiveId: previous.id } : {}),
        ...(input.expiresAt === undefined
          ? {}
          : { expiresAt: isoTimestamp(input.expiresAt, 'directive.expiresAt') }),
        revision,
        createdAt: now,
        updatedAt: now,
      },
    ],
  });
}

export function proposeLiveDirective(
  document: LiveProfileDocument,
  input: ProposeLiveDirectiveInput,
): LiveProfileDocument {
  const validated = validateLiveProfileDocument(document);
  requireRevision(validated, input.expectedRevision);
  requireActor(input.actor, 'agent');
  if (validated.proposals.some((proposal) => proposal.id === input.id)) {
    throw new LiveProfileConflictError('duplicate-proposal', `Proposal '${input.id}' already exists.`);
  }
  const kind = directiveKind(input.kind, 'proposal.kind');
  const key = boundedString(input.key, 'proposal.key');
  const value = boundedString(input.value, 'proposal.value', MAX_VALUE_LENGTH);
  const reason = boundedString(input.reason, 'proposal.reason', MAX_REASON_LENGTH);
  const sourceType =
    input.sourceType === undefined ? undefined : learningSource(input.sourceType, 'proposal.sourceType');
  const sourceRef =
    input.sourceRef === undefined
      ? undefined
      : boundedString(input.sourceRef, 'proposal.sourceRef', 240);
  if ((sourceType === undefined) !== (sourceRef === undefined)) {
    throw new LiveProfileValidationError(
      'incomplete-provenance',
      'proposal.sourceType and sourceRef must be supplied together.',
    );
  }
  if (sourceType !== undefined && !validated.learningConsent[sourceType]) {
    throw new LiveProfileValidationError(
      'learning-consent-required',
      `Learning from ${sourceType} requires explicit user consent.`,
    );
  }
  assertSafeText(value, 'proposal.value');
  assertSafeText(reason, 'proposal.reason');
  if (sourceRef !== undefined) assertSafeText(sourceRef, 'proposal.sourceRef');
  const now = isoTimestamp(input.now, 'now');
  const base = currentDirective(validated, kind, key);
  const revision = validated.revision + 1;
  return validateLiveProfileDocument({
    ...validated,
    revision,
    updatedAt: now,
    proposals: [
      ...validated.proposals,
      {
        id: boundedString(input.id, 'proposal.id'),
        kind,
        key,
        value,
        reason,
        proposedBy: input.actor.id,
        ...(sourceType === undefined ? {} : { sourceType, sourceRef }),
        ...(input.expiresAt === undefined
          ? {}
          : { expiresAt: isoTimestamp(input.expiresAt, 'proposal.expiresAt') }),
        baseDirectiveId: base?.id ?? null,
        baseDirectiveRevision: base?.revision ?? 0,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
      },
    ],
  });
}

export function decideLiveProposal(
  document: LiveProfileDocument,
  input: DecideLiveProposalInput,
): LiveProfileDocument {
  const validated = validateLiveProfileDocument(document);
  requireRevision(validated, input.expectedRevision);
  requireProfileOwner(validated, input.actor);
  const proposalIndex = validated.proposals.findIndex(
    (proposal) => proposal.id === input.proposalId,
  );
  const proposal = validated.proposals[proposalIndex];
  if (!proposal) {
    throw new LiveProfileValidationError(
      'proposal-not-found',
      `Proposal '${input.proposalId}' was not found.`,
    );
  }
  if (proposal.status !== 'pending') {
    throw new LiveProfileConflictError(
      'proposal-decided',
      `Proposal '${input.proposalId}' was already decided.`,
    );
  }

  const now = isoTimestamp(input.now, 'now');
  const revision = validated.revision + 1;
  if (input.decision === 'reject') {
    const proposals = [...validated.proposals];
    proposals[proposalIndex] = {
      ...proposal,
      status: 'rejected',
      decidedBy: input.actor.id,
      decidedAt: now,
      updatedAt: now,
    };
    return validateLiveProfileDocument({
      ...validated,
      revision,
      updatedAt: now,
      proposals,
    });
  }

  const current = currentDirective(validated, proposal.kind, proposal.key);
  const currentId = current?.id ?? null;
  const currentRevision = current?.revision ?? 0;
  if (
    currentId !== proposal.baseDirectiveId ||
    currentRevision !== proposal.baseDirectiveRevision
  ) {
    throw new LiveProfileConflictError(
      'stale-proposal',
      `Proposal '${proposal.id}' is based on an older directive revision.`,
    );
  }

  const acceptedDirectiveId = `${proposal.id}:accepted`;
  if (validated.directives.some((directive) => directive.id === acceptedDirectiveId)) {
    throw new LiveProfileConflictError(
      'duplicate-directive',
      `Accepted directive '${acceptedDirectiveId}' already exists.`,
    );
  }
  const directives: LiveDirective[] = [
    ...validated.directives,
    {
      id: acceptedDirectiveId,
      kind: proposal.kind,
      key: proposal.key,
      value: proposal.value,
      source: 'accepted-proposal',
      authoredBy: input.actor.id,
      proposalId: proposal.id,
      ...(current ? { supersedesDirectiveId: current.id } : {}),
      ...(proposal.sourceType === undefined
        ? {}
        : { sourceType: proposal.sourceType, sourceRef: proposal.sourceRef }),
      ...(proposal.expiresAt === undefined ? {} : { expiresAt: proposal.expiresAt }),
      revision,
      createdAt: now,
      updatedAt: now,
    },
  ];
  const proposals = [...validated.proposals];
  proposals[proposalIndex] = {
    ...proposal,
    status: 'accepted',
    decidedBy: input.actor.id,
    decidedAt: now,
    acceptedDirectiveId,
    updatedAt: now,
  };
  return validateLiveProfileDocument({
    ...validated,
    revision,
    updatedAt: now,
    directives,
    proposals,
  });
}

export function setLiveLearningConsent(
  document: LiveProfileDocument,
  input: SetLiveLearningConsentInput,
): LiveProfileDocument {
  const validated = validateLiveProfileDocument(document);
  requireRevision(validated, input.expectedRevision);
  requireProfileOwner(validated, input.actor);
  const source = learningSource(input.source, 'learningConsent.source');
  if (typeof input.enabled !== 'boolean') {
    throw new LiveProfileValidationError(
      'invalid-learning-consent',
      'learningConsent.enabled must be a boolean.',
    );
  }
  const now = isoTimestamp(input.now, 'now');
  return validateLiveProfileDocument({
    ...validated,
    revision: validated.revision + 1,
    learningConsent: {
      ...validated.learningConsent,
      [source]: input.enabled,
    },
    updatedAt: now,
  });
}

export function serializeLiveProfileMarkdown(document: LiveProfileDocument): string {
  const validated = validateLiveProfileDocument(document);
  const payload = JSON.stringify(validated, null, 2);
  const markdown = [
    '# Live',
    '',
    '> Personal work preferences and rules. Credential values are not allowed; use SecretRef entries.',
    '',
    `\`\`\`${LIVE_PROFILE_FENCE}`,
    payload,
    '```',
    '',
  ].join('\n');
  assertSafeMarkdown(markdown);
  if (utf8ByteLength(markdown) > MAX_MARKDOWN_BYTES) {
    throw new LiveProfileValidationError('document-too-large', 'Live.md exceeds the size limit.');
  }
  return markdown;
}

interface LiveProfileFenceSpan {
  readonly payloadStart: number;
  readonly payloadEnd: number;
}

function locateLiveProfileFence(markdown: string): LiveProfileFenceSpan {
  const marker = `\`\`\`${LIVE_PROFILE_FENCE}`;
  const start = markdown.indexOf(marker);
  if (start < 0 || markdown.indexOf(marker, start + marker.length) >= 0) {
    throw new LiveProfileValidationError(
      'profile-fence',
      'Live.md must contain exactly one live-profile fence.',
    );
  }
  const payloadStart = markdown.indexOf('\n', start + marker.length);
  if (payloadStart < 0) {
    throw new LiveProfileValidationError('profile-fence', 'Live.md profile fence is malformed.');
  }
  const payloadEnd = markdown.indexOf('\n```', payloadStart + 1);
  if (payloadEnd < 0) {
    throw new LiveProfileValidationError('profile-fence', 'Live.md profile fence is not closed.');
  }
  return { payloadStart, payloadEnd };
}

export function parseLiveProfileMarkdown(
  markdown: string,
  expectedScope?: LiveProfileScope,
): LiveProfileDocument {
  if (typeof markdown !== 'string' || utf8ByteLength(markdown) > MAX_MARKDOWN_BYTES) {
    throw new LiveProfileValidationError('document-too-large', 'Live.md is missing or too large.');
  }
  assertSafeMarkdown(markdown);
  const span = locateLiveProfileFence(markdown);
  const payload = markdown.slice(span.payloadStart + 1, span.payloadEnd).trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new LiveProfileValidationError('invalid-json', 'Live.md profile payload is not valid JSON.');
  }
  const document = validateLiveProfileDocument(parsed);
  if (expectedScope && !sameLiveProfileScope(document.scope, validateScope(expectedScope))) {
    throw new LiveProfileValidationError(
      'scope-mismatch',
      'Live.md does not belong to the requested workspace and owner.',
    );
  }
  return document;
}

/**
 * Replace only the JSON payload while preserving every user-authored byte
 * outside the live-profile fence.
 */
export function replaceLiveProfileMarkdownDocument(
  markdown: string,
  nextDocument: LiveProfileDocument,
  expectedScope?: LiveProfileScope,
): string {
  const current = parseLiveProfileMarkdown(markdown, expectedScope);
  const next = validateLiveProfileDocument(nextDocument);
  if (!sameLiveProfileScope(current.scope, next.scope)) {
    throw new LiveProfileValidationError(
      'scope-mismatch',
      'A Live.md update cannot change workspace or owner scope.',
    );
  }
  if (current.documentRef !== next.documentRef) {
    throw new LiveProfileValidationError(
      'document-ref-mismatch',
      'A Live.md update cannot change its document reference.',
    );
  }
  const span = locateLiveProfileFence(markdown);
  const payload = JSON.stringify(next, null, 2);
  const updated =
    markdown.slice(0, span.payloadStart + 1) + payload + markdown.slice(span.payloadEnd);
  assertSafeMarkdown(updated);
  if (utf8ByteLength(updated) > MAX_MARKDOWN_BYTES) {
    throw new LiveProfileValidationError('document-too-large', 'Live.md exceeds the size limit.');
  }
  return updated;
}
