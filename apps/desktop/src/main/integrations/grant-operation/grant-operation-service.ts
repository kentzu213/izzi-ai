import { createHash } from 'node:crypto';
import {
  IntegrationGrantValidationError,
  parseIntegrationGrant,
  parseIntegrationGrantScope,
  type IntegrationGrantScope,
} from '../../../shared/integration-grants';
import {
  PERSONAL_OFFICE_SCHEMA_VERSION,
  canonicalJson,
  isSecretRef,
  looksLikeRawSecret,
  type IntegrationGrant,
  type IntegrationGrantId,
  type SecretRef,
} from '../../../shared/personal-office';
import type { GrantVault } from '../grant-vault';

export type IntegrationGrantOperationStatus =
  | 'pending_approval'
  | 'rejected'
  | 'connected'
  | 'revoked'
  | 'failed';

export type IntegrationGrantOperationCode =
  | 'AUTHORITY_UNAVAILABLE'
  | 'APPROVAL_BINDING_MISMATCH'
  | 'APPROVAL_PENDING'
  | 'APPROVAL_REJECTED'
  | 'CONNECTOR_UNAVAILABLE'
  | 'CONNECTOR_FAILED'
  | 'SECRET_REFERENCE_INVALID'
  | 'VAULT_UNRESOLVABLE'
  | 'GRANT_NOT_FOUND'
  | 'REMOTE_REVOCATION_FAILED'
  | 'VAULT_REVOCATION_FAILED'
  | 'GRANT_PERSISTENCE_FAILED'
  | 'EVIDENCE_RECORDING_FAILED'
  | 'EVIDENCE_COMPENSATION_FAILED'
  | 'EVIDENCE_REVOCATION_FAILED'
  | 'CONNECTED'
  | 'REVOKED';

export interface IntegrationGrantOperationReceipt {
  readonly operationId: string;
  readonly status: IntegrationGrantOperationStatus;
  readonly code: IntegrationGrantOperationCode;
  readonly observedAt: string;
  readonly tenantId?: IntegrationGrantScope['tenantId'];
  readonly userId?: IntegrationGrantScope['userId'];
  readonly integration?: string;
  readonly grantId?: IntegrationGrantId;
  readonly workspaceInstanceId?: IntegrationGrantScope['workspaceInstanceId'];
  readonly scopes?: readonly string[];
  readonly approvalId?: string;
  readonly evidenceDigest?: string;
}

export interface IntegrationGrantIdentityAuthorityPort {
  resolveConnectScope(input: {
    readonly integration: string;
    readonly scopes: readonly string[];
  }): Promise<IntegrationGrantScope | null>;
  resolveExistingScope(grantId: IntegrationGrantId): Promise<IntegrationGrantScope | null>;
}

export interface IntegrationGrantApprovalPort {
  request(input: {
    readonly operationId: string;
    readonly action: 'connect' | 'revoke';
    readonly scope: IntegrationGrantScope;
    readonly bindingDigest: string;
  }): Promise<{
    readonly approvalId: string;
    readonly state: 'pending' | 'approved' | 'rejected' | 'expired' | 'invalidated';
    readonly bindingDigest: string;
  }>;
}

export interface IntegrationGrantConnectorPort {
  connect(input: {
    readonly operationId: string;
    readonly scope: IntegrationGrantScope;
    readonly bindingDigest: string;
  }): Promise<{
    readonly status: 'connected' | 'unavailable' | 'failed';
    readonly secret?: unknown;
    readonly expiresAt?: string;
    readonly evidenceDigest?: string;
  }>;
  revoke(input: {
    readonly operationId: string;
    readonly grant: IntegrationGrant;
    readonly scope: IntegrationGrantScope;
    readonly bindingDigest: string;
  }): Promise<{
    readonly status: 'revoked' | 'unavailable' | 'failed';
    readonly evidenceDigest?: string;
  }>;
}

export interface IntegrationGrantCredentialStorePort {
  revoke(secret: SecretRef, scope: IntegrationGrantScope): Promise<boolean>;
}

export interface IntegrationGrantRepositoryPort {
  get(grantId: IntegrationGrantId): Promise<IntegrationGrant | null>;
  upsert(grant: IntegrationGrant, scope: IntegrationGrantScope): Promise<void>;
  markRevoked(grantId: IntegrationGrantId, revokedAt: string): Promise<void>;
  markInvalid(grantId: IntegrationGrantId, observedAt: string): Promise<void>;
}

export interface IntegrationGrantOperationalEvidenceSink {
  recordConnected(receipt: IntegrationGrantOperationReceipt): Promise<void>;
  beginRevocation(input: {
    readonly operationId: string;
    readonly scope: IntegrationGrantScope;
    readonly observedAt: string;
  }): Promise<void>;
}

export interface IntegrationGrantOperationServiceOptions {
  readonly identity: IntegrationGrantIdentityAuthorityPort;
  readonly approvals: IntegrationGrantApprovalPort;
  readonly connector: IntegrationGrantConnectorPort;
  readonly credentials: IntegrationGrantCredentialStorePort;
  readonly repository: IntegrationGrantRepositoryPort;
  readonly vault: GrantVault;
  readonly operationalEvidence?: IntegrationGrantOperationalEvidenceSink;
  readonly now?: () => Date;
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function exactText(value: string, path: string): string {
  const normalized = value.trim();
  if (
    !normalized
    || normalized !== value
    || normalized.length > 256
    || /[\0\r\n*]/.test(normalized)
  ) {
    throw new Error(`${path}: must be exact non-wildcard text`);
  }
  return normalized;
}

function uniqueScopes(scopes: readonly string[]): readonly string[] {
  const parsed = [...new Set(scopes.map((scope) => exactText(scope, 'scopes[]')))].sort();
  if (parsed.length === 0) {
    throw new Error('scopes: at least one exact scope is required');
  }
  return Object.freeze(parsed);
}

function validApprovalId(value: string): boolean {
  return Boolean(
    value
    && value === value.trim()
    && value.length <= 256
    && !/[\0\r\n]/.test(value)
    && !looksLikeRawSecret(value),
  );
}

function safeEvidenceDigest(value: string | undefined): string | undefined {
  return value && /^sha256:[a-f0-9]{64}$/.test(value) ? value : undefined;
}

function bindingDigest(
  action: 'connect' | 'revoke',
  operationId: string,
  scope: IntegrationGrantScope,
): string {
  return sha256(canonicalJson({
    action,
    operationId,
    scope,
  }));
}

function operationId(
  action: 'connect' | 'revoke',
  scope: IntegrationGrantScope,
  idempotencyKey: string,
): string {
  return sha256(canonicalJson({
    action,
    idempotencyKey: exactText(idempotencyKey, 'idempotencyKey'),
    scope,
  }));
}

function receipt(
  observedAt: string,
  operationIdValue: string,
  status: IntegrationGrantOperationStatus,
  code: IntegrationGrantOperationCode,
  scope?: IntegrationGrantScope,
  approvalId?: string,
  evidenceDigest?: string,
): IntegrationGrantOperationReceipt {
  return Object.freeze({
    operationId: operationIdValue,
    status,
    code,
    observedAt,
    ...(scope ? {
      tenantId: scope.tenantId,
      userId: scope.userId,
      integration: scope.integration,
      grantId: scope.grantId,
      workspaceInstanceId: scope.workspaceInstanceId,
      scopes: scope.scopes,
    } : {}),
    ...(approvalId ? { approvalId } : {}),
    ...(safeEvidenceDigest(evidenceDigest)
      ? { evidenceDigest: safeEvidenceDigest(evidenceDigest) }
      : {}),
  });
}

export class IntegrationGrantOperationService {
  private readonly now: () => Date;

  constructor(private readonly options: IntegrationGrantOperationServiceOptions) {
    this.now = options.now ?? (() => new Date());
  }

  private async compensateConnectedGrant(
    operationIdValue: string,
    grant: IntegrationGrant,
    scope: IntegrationGrantScope,
    digest: string,
  ): Promise<{
    readonly remoteRevoked: boolean;
    readonly credentialRevoked: boolean;
  }> {
    const remote = await this.options.connector.revoke({
      operationId: operationIdValue,
      grant,
      scope,
      bindingDigest: digest,
    }).catch(() => ({ status: 'failed' as const }));
    const credentialRevoked = await this.options.credentials
      .revoke(grant.secret, scope)
      .catch(() => false);
    return {
      remoteRevoked: remote.status === 'revoked',
      credentialRevoked,
    };
  }

  async connect(input: {
    readonly integration: string;
    readonly scopes: readonly string[];
    readonly idempotencyKey: string;
  }): Promise<IntegrationGrantOperationReceipt> {
    const observedAt = this.now().toISOString();
    const integration = exactText(input.integration, 'integration');
    const scopes = uniqueScopes(input.scopes);
    const resolved = await this.options.identity
      .resolveConnectScope({ integration, scopes })
      .catch(() => null);
    if (!resolved) {
      return receipt(
        observedAt,
        sha256(canonicalJson({ action: 'connect', integration, scopes })),
        'failed',
        'AUTHORITY_UNAVAILABLE',
      );
    }
    const scope = parseIntegrationGrantScope(resolved);
    if (scope.integration !== integration || canonicalJson(scope.scopes) !== canonicalJson(scopes)) {
      return receipt(
        observedAt,
        sha256(canonicalJson({ action: 'connect', integration, scopes })),
        'failed',
        'AUTHORITY_UNAVAILABLE',
      );
    }
    const operationIdValue = operationId('connect', scope, input.idempotencyKey);
    const digest = bindingDigest('connect', operationIdValue, scope);
    const approval = await this.options.approvals.request({
      operationId: operationIdValue,
      action: 'connect',
      scope,
      bindingDigest: digest,
    }).catch(() => null);
    if (!approval) {
      return receipt(
        observedAt,
        operationIdValue,
        'failed',
        'APPROVAL_REJECTED',
        scope,
      );
    }
    if (!validApprovalId(approval.approvalId) || approval.bindingDigest !== digest) {
      return receipt(
        observedAt,
        operationIdValue,
        'failed',
        'APPROVAL_BINDING_MISMATCH',
        scope,
      );
    }
    if (approval.state === 'pending') {
      return receipt(
        observedAt,
        operationIdValue,
        'pending_approval',
        'APPROVAL_PENDING',
        scope,
        approval.approvalId,
      );
    }
    if (approval.state !== 'approved') {
      return receipt(
        observedAt,
        operationIdValue,
        'rejected',
        'APPROVAL_REJECTED',
        scope,
        approval.approvalId,
      );
    }
    if (!this.options.operationalEvidence) {
      return receipt(
        observedAt,
        operationIdValue,
        'failed',
        'EVIDENCE_RECORDING_FAILED',
        scope,
        approval.approvalId,
      );
    }

    const connected = await this.options.connector.connect({
      operationId: operationIdValue,
      scope,
      bindingDigest: digest,
    }).catch(() => ({
      status: 'unavailable' as const,
      evidenceDigest: undefined,
    }));
    if (connected.status !== 'connected') {
      return receipt(
        observedAt,
        operationIdValue,
        'failed',
        connected.status === 'unavailable' ? 'CONNECTOR_UNAVAILABLE' : 'CONNECTOR_FAILED',
        scope,
        approval.approvalId,
        connected.evidenceDigest,
      );
    }
    if (!isSecretRef(connected.secret) || connected.secret.store !== 'integration_vault') {
      return receipt(
        observedAt,
        operationIdValue,
        'failed',
        'SECRET_REFERENCE_INVALID',
        scope,
        approval.approvalId,
      );
    }

    let grant: IntegrationGrant;
    try {
      grant = parseIntegrationGrant({
        schemaVersion: PERSONAL_OFFICE_SCHEMA_VERSION,
        id: scope.grantId,
        workspaceInstanceId: scope.workspaceInstanceId,
        integration: scope.integration,
        scopes: scope.scopes,
        secret: connected.secret,
        ...(connected.expiresAt ? { expiresAt: connected.expiresAt } : {}),
        createdAt: observedAt,
        updatedAt: observedAt,
      }, scope);
    } catch {
      return receipt(
        observedAt,
        operationIdValue,
        'failed',
        'SECRET_REFERENCE_INVALID',
        scope,
        approval.approvalId,
      );
    }
    const vaultResolution = await this.options.vault
      .check(grant, scope)
      .catch(() => 'unavailable' as const);
    if (vaultResolution !== 'resolvable') {
      await this.compensateConnectedGrant(operationIdValue, grant, scope, digest);
      return receipt(
        observedAt,
        operationIdValue,
        'failed',
        'VAULT_UNRESOLVABLE',
        scope,
        approval.approvalId,
      );
    }
    try {
      await this.options.repository.upsert(grant, scope);
    } catch {
      await this.compensateConnectedGrant(operationIdValue, grant, scope, digest);
      return receipt(
        observedAt,
        operationIdValue,
        'failed',
        'GRANT_PERSISTENCE_FAILED',
        scope,
        approval.approvalId,
      );
    }
    const connectedReceipt = receipt(
      observedAt,
      operationIdValue,
      'connected',
      'CONNECTED',
      scope,
      approval.approvalId,
      connected.evidenceDigest,
    );
    try {
      await this.options.operationalEvidence.recordConnected(connectedReceipt);
    } catch {
      let tombstoneRecorded = false;
      try {
        await this.options.operationalEvidence.beginRevocation({
          operationId: operationIdValue,
          scope,
          observedAt,
        });
        tombstoneRecorded = true;
      } catch {
        tombstoneRecorded = false;
      }
      const compensation = await this.compensateConnectedGrant(
        operationIdValue,
        grant,
        scope,
        digest,
      );
      const invalidated = await this.options.repository
        .markInvalid(scope.grantId, observedAt)
        .then(() => true)
        .catch(() => false);
      return receipt(
        observedAt,
        operationIdValue,
        'failed',
        tombstoneRecorded
          && compensation.remoteRevoked
          && compensation.credentialRevoked
          && invalidated
          ? 'EVIDENCE_RECORDING_FAILED'
          : 'EVIDENCE_COMPENSATION_FAILED',
        scope,
        approval.approvalId,
      );
    }
    return connectedReceipt;
  }

  async revoke(input: {
    readonly grantId: IntegrationGrantId;
    readonly idempotencyKey: string;
  }): Promise<IntegrationGrantOperationReceipt> {
    const observedAt = this.now().toISOString();
    const resolved = await this.options.identity
      .resolveExistingScope(input.grantId)
      .catch(() => null);
    if (!resolved) {
      return receipt(
        observedAt,
        sha256(canonicalJson({ action: 'revoke', grantId: input.grantId })),
        'failed',
        'AUTHORITY_UNAVAILABLE',
      );
    }
    const scope = parseIntegrationGrantScope(resolved);
    if (scope.grantId !== input.grantId) {
      return receipt(
        observedAt,
        sha256(canonicalJson({ action: 'revoke', grantId: input.grantId })),
        'failed',
        'AUTHORITY_UNAVAILABLE',
      );
    }
    const operationIdValue = operationId('revoke', scope, input.idempotencyKey);
    const grantInput = await this.options.repository.get(scope.grantId).catch(() => null);
    if (!grantInput) {
      return receipt(
        observedAt,
        operationIdValue,
        'failed',
        'GRANT_NOT_FOUND',
        scope,
      );
    }

    let grant: IntegrationGrant;
    try {
      grant = parseIntegrationGrant(grantInput, scope);
    } catch (error) {
      if (error instanceof IntegrationGrantValidationError) {
        await this.options.repository.markInvalid(scope.grantId, observedAt).catch(() => undefined);
      }
      return receipt(
        observedAt,
        operationIdValue,
        'failed',
        'GRANT_NOT_FOUND',
        scope,
      );
    }

    const digest = bindingDigest('revoke', operationIdValue, scope);
    const approval = await this.options.approvals.request({
      operationId: operationIdValue,
      action: 'revoke',
      scope,
      bindingDigest: digest,
    }).catch(() => null);
    if (!approval) {
      return receipt(
        observedAt,
        operationIdValue,
        'failed',
        'APPROVAL_REJECTED',
        scope,
      );
    }
    if (!validApprovalId(approval.approvalId) || approval.bindingDigest !== digest) {
      return receipt(
        observedAt,
        operationIdValue,
        'failed',
        'APPROVAL_BINDING_MISMATCH',
        scope,
      );
    }
    if (approval.state === 'pending') {
      return receipt(
        observedAt,
        operationIdValue,
        'pending_approval',
        'APPROVAL_PENDING',
        scope,
        approval.approvalId,
      );
    }
    if (approval.state !== 'approved') {
      return receipt(
        observedAt,
        operationIdValue,
        'rejected',
        'APPROVAL_REJECTED',
        scope,
        approval.approvalId,
      );
    }
    if (!this.options.operationalEvidence) {
      return receipt(
        observedAt,
        operationIdValue,
        'failed',
        'EVIDENCE_REVOCATION_FAILED',
        scope,
        approval.approvalId,
      );
    }

    try {
      await this.options.operationalEvidence.beginRevocation({
        operationId: operationIdValue,
        scope,
        observedAt,
      });
    } catch {
      return receipt(
        observedAt,
        operationIdValue,
        'failed',
        'EVIDENCE_REVOCATION_FAILED',
        scope,
        approval.approvalId,
      );
    }

    const remote = await this.options.connector.revoke({
      operationId: operationIdValue,
      grant,
      scope,
      bindingDigest: digest,
    }).catch(() => ({
      status: 'unavailable' as const,
      evidenceDigest: undefined,
    }));
    if (remote.status !== 'revoked') {
      return receipt(
        observedAt,
        operationIdValue,
        'failed',
        'REMOTE_REVOCATION_FAILED',
        scope,
        approval.approvalId,
        remote.evidenceDigest,
      );
    }
    if (!(await this.options.credentials.revoke(grant.secret, scope).catch(() => false))) {
      await this.options.repository.markInvalid(scope.grantId, observedAt).catch(() => undefined);
      return receipt(
        observedAt,
        operationIdValue,
        'failed',
        'VAULT_REVOCATION_FAILED',
        scope,
        approval.approvalId,
        remote.evidenceDigest,
      );
    }
    try {
      await this.options.repository.markRevoked(scope.grantId, observedAt);
    } catch {
      await this.options.repository.markInvalid(scope.grantId, observedAt).catch(() => undefined);
      return receipt(
        observedAt,
        operationIdValue,
        'failed',
        'GRANT_PERSISTENCE_FAILED',
        scope,
        approval.approvalId,
        remote.evidenceDigest,
      );
    }
    return receipt(
      observedAt,
      operationIdValue,
      'revoked',
      'REVOKED',
      scope,
      approval.approvalId,
      remote.evidenceDigest,
    );
  }
}
