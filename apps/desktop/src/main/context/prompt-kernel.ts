import {
  PERSONAL_OFFICE_SCHEMA_VERSION,
  canonicalJson,
  isSecretRef,
  type DataClassification,
} from '../../shared/personal-office';
import {
  PERSONAL_OFFICE_CONTEXT_ARTIFACT_KIND,
  PERSONAL_OFFICE_CONTEXT_HASH_PREFIX,
  PERSONAL_OFFICE_CONTEXT_LIMITS,
  type CompiledContextItem,
  type CompiledWorkspaceContext,
  type ContextKernelInput,
  type ContextLayer,
  type ContextMessageRole,
  type ContextProvenance,
} from '../../shared/context';
import type { AgentHistoryMessage } from '../agent/types';
import { sha256Hex } from '../work/work-hash';
import {
  buildCanonicalContextSystemSegment,
  compiledWorkspaceContextCanonicalPayload,
} from './compiler';
import {
  containsUnsafeControlCharacter,
  ContextCompilationError,
} from './context-error';
import { assertSafeContextMetadata } from './metadata-guard';

const PRECEDENCE: readonly ContextLayer[] = Object.freeze([
  'safety-system',
  'current-user-request',
  'workspace-policy',
  'global-live-profile',
  'learned-preference',
  'model-default',
]);
const ROLE_BY_LAYER: Readonly<Record<ContextLayer, ContextMessageRole>> = Object.freeze({
  'safety-system': 'system',
  'current-user-request': 'user',
  'workspace-policy': 'system',
  'global-live-profile': 'system',
  'learned-preference': 'system',
  'model-default': 'system',
});
const ALLOWED_CLASSIFICATIONS = new Set<DataClassification>([
  'public_metadata',
  'personal_graph',
]);
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const DECISION_STATUSES = new Set([
  'included',
  'expired',
  'not-effective',
  'item-budget',
  'byte-budget',
]);
const PROVENANCE_SOURCE_TYPES = new Set<ContextProvenance['sourceType']>([
  'base-system',
  'current-request',
  'workspace-policy',
  'live-profile',
  'model-default',
]);
const PROVENANCE_TYPE_BY_LAYER: Readonly<
  Record<ContextLayer, ContextProvenance['sourceType']>
> = Object.freeze({
  'safety-system': 'base-system',
  'current-user-request': 'current-request',
  'workspace-policy': 'workspace-policy',
  'global-live-profile': 'live-profile',
  'learned-preference': 'live-profile',
  'model-default': 'model-default',
});
const REDACTION_KINDS = new Set([
  'secret-key-name',
  'jwt',
  'openai-key',
  'izzi-key',
  'bearer',
  'github-token',
  'aws-access-key',
  'private-key-block',
  'email',
  'phone',
]);

function fail(code: string, message: string): never {
  throw new ContextCompilationError(code, message);
}

function plainRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    fail('invalid-context-package', `${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (
      key === '__proto__' ||
      key === 'constructor' ||
      key === 'prototype' ||
      !allowedKeys.has(key)
    ) {
      fail('invalid-context-package', `${label} contains unsupported field '${key}'.`);
    }
  }
}

function boundedString(value: unknown, label: string, max = 240): string {
  if (typeof value !== 'string') fail('invalid-context-package', `${label} must be a string.`);
  const normalized = value.normalize('NFC').trim();
  if (
    !normalized ||
    normalized.length > max ||
    containsUnsafeControlCharacter(normalized)
  ) {
    fail('invalid-context-package', `${label} is empty or invalid.`);
  }
  return normalized;
}

function renderedMetadataString(
  value: unknown,
  label: string,
  max = 240,
): string {
  const normalized = boundedString(value, label, max);
  assertSafeContextMetadata(normalized, label);
  return normalized;
}

function exactTimestamp(value: unknown, label: string): string {
  const timestamp = boundedString(value, label, 64);
  const parsed = Date.parse(timestamp);
  if (Number.isNaN(parsed) || new Date(parsed).toISOString() !== timestamp) {
    fail('invalid-context-package', `${label} must be an exact ISO UTC timestamp.`);
  }
  return timestamp;
}

function layerIndex(layer: ContextLayer): number {
  return PRECEDENCE.indexOf(layer);
}

function compareCanonicalText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function compareItems(a: CompiledContextItem, b: CompiledContextItem): number {
  return (
    layerIndex(a.layer) - layerIndex(b.layer) ||
    compareCanonicalText(a.id, b.id)
  );
}

function expectedHash(content: string): string {
  return `${PERSONAL_OFFICE_CONTEXT_HASH_PREFIX}${sha256Hex(content.normalize('NFC').trim())}`;
}

function expectedExactCurrentRequestHash(content: string): string {
  return `${PERSONAL_OFFICE_CONTEXT_HASH_PREFIX}${sha256Hex(canonicalJson(content))}`;
}

function unsigned(value: CompiledWorkspaceContext) {
  const { contentHash: _contentHash, ...payload } = value;
  return payload;
}

function validateCompiledItem(
  raw: unknown,
  index: number,
  scope: { workspaceId: string; ownerId: string },
): CompiledContextItem {
  const label = `compiled.items[${index}]`;
  const value = plainRecord(raw, label);
  assertAllowedKeys(
    value,
    [
      'id',
      'layer',
      'role',
      'scope',
      'classification',
      'contentHash',
      'content',
      'provenance',
      'expiresAt',
      'secretRefs',
      'redactions',
      'renderedInSystemSegment',
    ],
    label,
  );
  const id = renderedMetadataString(value.id, `${label}.id`);
  if (typeof value.layer !== 'string' || !PRECEDENCE.includes(value.layer as ContextLayer)) {
    fail('invalid-context-package', `${label}.layer is invalid.`);
  }
  const layer = value.layer as ContextLayer;
  if (value.role !== ROLE_BY_LAYER[layer]) {
    fail('prompt-role-injection', `${label}.role does not match the protected layer role.`);
  }
  const exactRole = value.role as ContextMessageRole;
  const itemScope = plainRecord(value.scope, `${label}.scope`);
  assertAllowedKeys(itemScope, ['workspaceId', 'ownerId'], `${label}.scope`);
  const exactItemScope = {
    workspaceId: renderedMetadataString(
      itemScope.workspaceId,
      `${label}.scope.workspaceId`,
      160,
    ),
    ownerId: renderedMetadataString(
      itemScope.ownerId,
      `${label}.scope.ownerId`,
      160,
    ),
  };
  if (
    exactItemScope.workspaceId !== scope.workspaceId ||
    exactItemScope.ownerId !== scope.ownerId
  ) {
    fail('scope-mismatch', `${label} does not match the compiled context scope.`);
  }
  if (
    typeof value.classification !== 'string' ||
    !ALLOWED_CLASSIFICATIONS.has(value.classification as DataClassification)
  ) {
    fail('invalid-classification', `${label}.classification cannot enter model context.`);
  }
  const exactClassification = value.classification as DataClassification;
  if (typeof value.contentHash !== 'string' || !HASH_PATTERN.test(value.contentHash)) {
    fail('invalid-context-package', `${label}.contentHash is invalid.`);
  }
  const contentHash = value.contentHash;
  if (typeof value.renderedInSystemSegment !== 'boolean') {
    fail('invalid-context-package', `${label}.renderedInSystemSegment must be boolean.`);
  }
  const renderedInSystemSegment = value.renderedInSystemSegment;
  const protectedLayer = layer === 'safety-system' || layer === 'current-user-request';
  let content: string | undefined;
  if (protectedLayer) {
    if (renderedInSystemSegment || value.content !== undefined) {
      fail(
        'protected-layer-rendered',
        `${label} cannot render protected safety or current-request content.`,
      );
    }
  } else {
    if (!renderedInSystemSegment || typeof value.content !== 'string') {
      fail('context-item-not-rendered', `${label} must render exactly once in the system segment.`);
    }
    content = boundedString(
      value.content,
      `${label}.content`,
      PERSONAL_OFFICE_CONTEXT_LIMITS.maxSourceBytes,
    );
    if (contentHash !== expectedHash(content)) {
      fail('context-item-hash-mismatch', `${label}.contentHash does not match rendered content.`);
    }
  }
  const provenance = plainRecord(value.provenance, `${label}.provenance`);
  assertAllowedKeys(
    provenance,
    ['sourceType', 'sourceId', 'sourceRef', 'authoredBy', 'revision'],
    `${label}.provenance`,
  );
  if (
    typeof provenance.sourceType !== 'string' ||
    !PROVENANCE_SOURCE_TYPES.has(
      provenance.sourceType as ContextProvenance['sourceType'],
    )
  ) {
    fail('invalid-context-package', `${label}.provenance.sourceType is invalid.`);
  }
  const exactProvenance: ContextProvenance = {
    sourceType: provenance.sourceType as ContextProvenance['sourceType'],
    sourceId: renderedMetadataString(
      provenance.sourceId,
      `${label}.provenance.sourceId`,
    ),
    ...(provenance.sourceRef === undefined
      ? {}
      : {
          sourceRef: renderedMetadataString(
            provenance.sourceRef,
            `${label}.provenance.sourceRef`,
          ),
        }),
    ...(provenance.authoredBy === undefined
      ? {}
      : {
          authoredBy: renderedMetadataString(
            provenance.authoredBy,
            `${label}.provenance.authoredBy`,
          ),
        }),
    ...(provenance.revision === undefined
      ? {}
      : { revision: provenance.revision as number }),
  };
  if (exactProvenance.sourceType !== PROVENANCE_TYPE_BY_LAYER[layer]) {
    fail(
      'invalid-context-package',
      `${label}.provenance.sourceType does not match ${layer}.`,
    );
  }
  if (
    provenance.revision !== undefined &&
    (!Number.isSafeInteger(provenance.revision) || (provenance.revision as number) < 1)
  ) {
    fail('invalid-context-package', `${label}.provenance.revision is invalid.`);
  }
  const expiresAt =
    value.expiresAt === undefined
      ? undefined
      : exactTimestamp(value.expiresAt, `${label}.expiresAt`);
  if (!Array.isArray(value.secretRefs)) {
    fail('invalid-secret-ref', `${label}.secretRefs must be an array.`);
  }
  const exactSecretRefs = value.secretRefs.map((secret, secretIndex) => {
    const ref = plainRecord(secret, `${label}.secretRefs[${secretIndex}]`);
    assertAllowedKeys(
      ref,
      ['kind', 'store', 'ref', 'scopes'],
      `${label}.secretRefs[${secretIndex}]`,
    );
    if (!isSecretRef(secret)) {
      fail('invalid-secret-ref', `${label}.secretRefs[${secretIndex}] is invalid.`);
    }
    return {
      kind: 'secret-ref' as const,
      store: secret.store,
      ref: boundedString(
        secret.ref,
        `${label}.secretRefs[${secretIndex}].ref`,
      ),
      ...(secret.scopes === undefined
        ? {}
        : {
            scopes: secret.scopes.map((entry, scopeIndex) =>
              boundedString(
                entry,
                `${label}.secretRefs[${secretIndex}].scopes[${scopeIndex}]`,
                160,
              ),
            ),
          }),
    };
  });
  if (
    !Array.isArray(value.redactions) ||
    value.redactions.length > REDACTION_KINDS.size ||
    value.redactions.some(
      (entry) => typeof entry !== 'string' || !REDACTION_KINDS.has(entry),
    ) ||
    new Set(value.redactions).size !== value.redactions.length
  ) {
    fail('invalid-context-package', `${label}.redactions must be a string array.`);
  }
  const redactions = value.redactions.map((entry, redactionIndex) =>
    boundedString(entry, `${label}.redactions[${redactionIndex}]`, 64),
  );
  return {
    id,
    layer,
    role: exactRole,
    scope: exactItemScope,
    classification: exactClassification,
    contentHash,
    ...(content === undefined ? {} : { content }),
    provenance: exactProvenance,
    ...(expiresAt === undefined ? {} : { expiresAt }),
    secretRefs: exactSecretRefs,
    redactions,
    renderedInSystemSegment,
  };
}

export function verifyCompiledWorkspaceContext(
  raw: CompiledWorkspaceContext | unknown,
): asserts raw is CompiledWorkspaceContext {
  const value = plainRecord(raw, 'compiled context');
  assertAllowedKeys(
    value,
    [
      'schemaVersion',
      'artifactKind',
      'scope',
      'compiledAt',
      'precedence',
      'items',
      'decisions',
      'budget',
      'systemSegment',
      'contentHash',
    ],
    'compiled context',
  );
  if (
    value.schemaVersion !== PERSONAL_OFFICE_SCHEMA_VERSION ||
    value.artifactKind !== PERSONAL_OFFICE_CONTEXT_ARTIFACT_KIND
  ) {
    fail('invalid-context-package', 'Compiled context package is invalid.');
  }
  const scope = plainRecord(value.scope, 'compiled context.scope');
  assertAllowedKeys(scope, ['workspaceId', 'ownerId'], 'compiled context.scope');
  const exactScope = {
    workspaceId: renderedMetadataString(
      scope.workspaceId,
      'compiled context.scope.workspaceId',
      160,
    ),
    ownerId: renderedMetadataString(
      scope.ownerId,
      'compiled context.scope.ownerId',
      160,
    ),
  };
  exactTimestamp(value.compiledAt, 'compiled context.compiledAt');
  if (canonicalJson(value.precedence) !== canonicalJson(PRECEDENCE)) {
    fail('context-precedence', 'Compiled context precedence is invalid.');
  }
  if (
    !Array.isArray(value.items) ||
    value.items.length > PERSONAL_OFFICE_CONTEXT_LIMITS.maxPackageItems
  ) {
    fail(
      'invalid-context-package',
      `Compiled context items must be an array with at most ${PERSONAL_OFFICE_CONTEXT_LIMITS.maxPackageItems} entries.`,
    );
  }
  const items = value.items.map((item, index) =>
    validateCompiledItem(item, index, exactScope),
  );
  const itemIds = items.map((item) => item.id);
  if (new Set(itemIds).size !== itemIds.length) {
    fail('duplicate-id', 'Compiled context item ids must be unique.');
  }
  if (canonicalJson(items) !== canonicalJson([...items].sort(compareItems))) {
    fail('context-item-order', 'Compiled context items are not in canonical precedence order.');
  }
  const safety = items.filter((item) => item.layer === 'safety-system');
  const request = items.filter((item) => item.layer === 'current-user-request');
  if (safety.length !== 1 || request.length !== 1) {
    fail(
      'protected-layer-count',
      'Compiled context must bind exactly one safety system and one current request.',
    );
  }
  if (
    !Array.isArray(value.decisions) ||
    value.decisions.length > PERSONAL_OFFICE_CONTEXT_LIMITS.maxDecisions
  ) {
    fail(
      'invalid-context-package',
      `Compiled context decisions must be an array with at most ${PERSONAL_OFFICE_CONTEXT_LIMITS.maxDecisions} entries.`,
    );
  }
  const decisionIds = new Set<string>();
  const includedDecisionIds = new Set<string>();
  const truncatedDecisionIds = new Set<string>();
  for (const [index, rawDecision] of value.decisions.entries()) {
    const decision = plainRecord(rawDecision, `compiled.decisions[${index}]`);
    assertAllowedKeys(
      decision,
      ['id', 'layer', 'status', 'expiresAt'],
      `compiled.decisions[${index}]`,
    );
    const id = renderedMetadataString(
      decision.id,
      `compiled.decisions[${index}].id`,
    );
    if (decisionIds.has(id)) fail('duplicate-id', 'Compiled context decision ids must be unique.');
    decisionIds.add(id);
    if (typeof decision.layer !== 'string' || !PRECEDENCE.includes(decision.layer as ContextLayer)) {
      fail('invalid-context-package', `compiled.decisions[${index}].layer is invalid.`);
    }
    if (typeof decision.status !== 'string' || !DECISION_STATUSES.has(decision.status)) {
      fail('invalid-context-package', `compiled.decisions[${index}].status is invalid.`);
    }
    if (decision.expiresAt !== undefined) {
      exactTimestamp(decision.expiresAt, `compiled.decisions[${index}].expiresAt`);
    }
    if (decision.status === 'included') includedDecisionIds.add(id);
    if (decision.status === 'item-budget' || decision.status === 'byte-budget') {
      truncatedDecisionIds.add(id);
    }
  }
  const renderedIds = new Set(
    items.filter((item) => item.renderedInSystemSegment).map((item) => item.id),
  );
  if (
    canonicalJson([...renderedIds].sort()) !==
    canonicalJson([...includedDecisionIds].sort())
  ) {
    fail('context-decision-mismatch', 'Included decisions do not match rendered context items.');
  }
  const budget = plainRecord(value.budget, 'compiled context.budget');
  assertAllowedKeys(
    budget,
    ['maxItems', 'maxBytes', 'usedItems', 'usedBytes', 'truncatedItemIds'],
    'compiled context.budget',
  );
  for (const key of ['maxItems', 'maxBytes', 'usedItems', 'usedBytes'] as const) {
    if (!Number.isSafeInteger(budget[key]) || (budget[key] as number) < 0) {
      fail('context-budget-mismatch', `compiled context.budget.${key} is invalid.`);
    }
  }
  if (
    (budget.maxItems as number) < 1 ||
    (budget.maxItems as number) >
      PERSONAL_OFFICE_CONTEXT_LIMITS.maxRenderedItems ||
    (budget.maxBytes as number) < PERSONAL_OFFICE_CONTEXT_LIMITS.minBytes ||
    (budget.maxBytes as number) > PERSONAL_OFFICE_CONTEXT_LIMITS.maxBytes ||
    (budget.usedItems as number) > (budget.maxItems as number) ||
    (budget.usedItems as number) !== renderedIds.size
  ) {
    fail('context-budget-mismatch', 'Compiled context item budget verification failed.');
  }
  if (
    !Array.isArray(budget.truncatedItemIds) ||
    budget.truncatedItemIds.some((id) => typeof id !== 'string') ||
    new Set(budget.truncatedItemIds as string[]).size !==
      (budget.truncatedItemIds as string[]).length ||
    canonicalJson([...(budget.truncatedItemIds as string[])].sort()) !==
      canonicalJson([...truncatedDecisionIds].sort())
  ) {
    fail('context-budget-mismatch', 'Compiled context truncation evidence is invalid.');
  }
  if (typeof value.systemSegment !== 'string') {
    fail('context-delimiter', 'Compiled context segment is invalid.');
  }
  const expectedSegment = buildCanonicalContextSystemSegment({
    schemaVersion: PERSONAL_OFFICE_SCHEMA_VERSION,
    scope: exactScope,
    compiledAt: value.compiledAt as string,
    items,
  });
  if (value.systemSegment !== expectedSegment) {
    fail(
      'context-segment-derivation',
      'Compiled context segment is not the canonical rendering of its validated items.',
    );
  }
  const usedBytes = Buffer.byteLength(value.systemSegment, 'utf8');
  if (
    usedBytes !== budget.usedBytes ||
    usedBytes > (budget.maxBytes as number)
  ) {
    fail('context-budget-mismatch', 'Compiled context budget verification failed.');
  }
  if (typeof value.contentHash !== 'string' || !HASH_PATTERN.test(value.contentHash)) {
    fail('context-hash-mismatch', 'Compiled context content hash is invalid.');
  }
  const actualHash = `${PERSONAL_OFFICE_CONTEXT_HASH_PREFIX}${sha256Hex(
    compiledWorkspaceContextCanonicalPayload(unsigned(value as unknown as CompiledWorkspaceContext)),
  )}`;
  if (actualHash !== value.contentHash) {
    fail('context-hash-mismatch', 'Compiled context hash verification failed.');
  }
}

export function verifyContextKernelInput(
  input: ContextKernelInput,
  safetySystemContent: string,
  currentUserRequest: string,
): void {
  verifyCompiledWorkspaceContext(input.compiled);
  if (
    input.scope.workspaceId !== input.compiled.scope.workspaceId ||
    input.scope.ownerId !== input.compiled.scope.ownerId
  ) {
    fail('scope-mismatch', 'Compiled context does not match the requested workspace and owner.');
  }
  const safety = input.compiled.items.filter((item) => item.layer === 'safety-system');
  const request = input.compiled.items.filter(
    (item) => item.layer === 'current-user-request',
  );
  if (safety.length !== 1 || safety[0].role !== 'system') {
    fail('protected-layer-count', 'Compiled context must bind exactly one safety system item.');
  }
  if (request.length !== 1 || request[0].role !== 'user') {
    fail('protected-layer-count', 'Compiled context must bind exactly one current user request.');
  }
  if (safety[0].contentHash !== expectedHash(safetySystemContent)) {
    fail('safety-system-mismatch', 'Compiled context does not match the base safety system prompt.');
  }
  if (
    request[0].contentHash !==
    expectedExactCurrentRequestHash(currentUserRequest)
  ) {
    fail('current-request-mismatch', 'Compiled context does not match the current user request.');
  }
}

export function appendCompiledContextToSystemPrompt(
  baseSystemPrompt: string,
  currentUserRequest: string,
  input?: ContextKernelInput,
): string {
  if (!input) return baseSystemPrompt;
  verifyContextKernelInput(input, baseSystemPrompt, currentUserRequest);
  return `${baseSystemPrompt}\n\n${input.compiled.systemSegment}`;
}

export function appendCompiledContextToHistory(
  history: readonly AgentHistoryMessage[],
  currentUserRequest: string,
  input?: ContextKernelInput,
): AgentHistoryMessage[] {
  const copy = history.map((message) => ({ ...message }));
  if (!input) return copy;
  verifyCompiledWorkspaceContext(input.compiled);
  if (
    input.scope.workspaceId !== input.compiled.scope.workspaceId ||
    input.scope.ownerId !== input.compiled.scope.ownerId
  ) {
    fail('scope-mismatch', 'Compiled context does not match the requested workspace and owner.');
  }
  const safetyHash = input.compiled.items.find(
    (item) => item.layer === 'safety-system',
  )?.contentHash;
  const matchingSafety = copy.find(
    (message) =>
      message.role === 'system' &&
      safetyHash !== undefined &&
      expectedHash(message.content) === safetyHash,
  );
  if (!matchingSafety) {
    fail(
      'safety-system-missing',
      'Agent history must contain the safety system prompt bound by the compiled context.',
    );
  }
  verifyContextKernelInput(input, matchingSafety.content, currentUserRequest);
  copy.push({ role: 'system', content: input.compiled.systemSegment });
  return copy;
}
