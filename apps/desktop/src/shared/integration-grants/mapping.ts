import {
  INTEGRATION_GRANT_READ_MODEL_SCHEMA_VERSION,
  INTEGRATION_GRANT_READ_MODEL_VERSION,
  type IntegrationGrantReadModel,
  type LegacyIntegrationGrantEvidence,
} from './types';
import {
  assertExactGrantScope,
  isGrantExpired,
  parseIntegrationGrant,
  parseIntegrationGrantScope,
  parseLegacyIntegrationGrantEvidence,
  parseOptionalTimestamp,
} from './validation';

function result(
  evidence: LegacyIntegrationGrantEvidence,
  state: IntegrationGrantReadModel['state'],
  reasonCode: IntegrationGrantReadModel['reasonCode'],
  options: {
    readonly includeGrant?: boolean;
    readonly requestedAt?: string;
    readonly lastErrorAt?: string;
    readonly vaultResolution?: IntegrationGrantReadModel['vaultResolution'];
  } = {},
): IntegrationGrantReadModel {
  const scope = parseIntegrationGrantScope(evidence.scope);
  const grant = evidence.grant === undefined
    ? undefined
    : parseIntegrationGrant(evidence.grant, scope);
  return Object.freeze({
    schemaVersion: INTEGRATION_GRANT_READ_MODEL_SCHEMA_VERSION,
    modelVersion: INTEGRATION_GRANT_READ_MODEL_VERSION,
    observedAt: parseOptionalTimestamp(evidence.observedAt, 'evidence.observedAt')!,
    state,
    reasonCode,
    vaultResolution: options.vaultResolution
      ?? (evidence.vaultState === 'locked'
        ? 'unavailable'
        : evidence.secretResolvable
          ? 'resolvable'
          : 'missing'),
    scope,
    ...(options.includeGrant && grant ? { grant } : {}),
    ...(options.requestedAt ? { requestedAt: options.requestedAt } : {}),
    ...(options.lastErrorAt ? { lastErrorAt: options.lastErrorAt } : {}),
  });
}

export function deriveIntegrationGrantReadModel(
  evidence: LegacyIntegrationGrantEvidence,
  expectedScope: LegacyIntegrationGrantEvidence['scope'],
): IntegrationGrantReadModel {
  const parsedEvidence = parseLegacyIntegrationGrantEvidence(evidence, expectedScope);
  const observedAt = parsedEvidence.observedAt;
  const requestedAt = parsedEvidence.requestedAt;
  const lastErrorAt = parsedEvidence.lastErrorAt;
  const grant = parsedEvidence.grant;

  if (parsedEvidence.vaultState === 'locked' || parsedEvidence.status === 'locked') {
    return result(parsedEvidence, 'locked', 'vault_locked', {
      includeGrant: Boolean(grant),
      vaultResolution: 'unavailable',
    });
  }
  if (parsedEvidence.status === 'disconnected') {
    if (!grant) {
      return result(parsedEvidence, 'disconnected', 'disconnected_absent', {
        vaultResolution: 'missing',
      });
    }
    assertExactGrantScope(grant, parsedEvidence.scope);
    return grant.revokedAt
      ? result(parsedEvidence, 'disconnected', 'disconnected_revoked', {
          includeGrant: true,
          vaultResolution: 'missing',
        })
      : result(parsedEvidence, 'invalid', 'legacy_status_inconsistent', {
          includeGrant: true,
        });
  }
  if (parsedEvidence.status === 'pending') {
    return result(parsedEvidence, 'pending', 'pending_activation', {
      includeGrant: Boolean(grant),
      requestedAt: requestedAt ?? observedAt,
    });
  }
  if (!grant) {
    return result(parsedEvidence, 'invalid', 'grant_missing');
  }
  assertExactGrantScope(grant, parsedEvidence.scope);
  if (grant.invalid || parsedEvidence.status === 'invalid') {
    return result(parsedEvidence, 'invalid', 'grant_invalid', { includeGrant: true });
  }
  if (isGrantExpired(grant, observedAt)) {
    return result(parsedEvidence, 'invalid', 'grant_expired', { includeGrant: true });
  }
  if (grant.revokedAt) {
    return result(parsedEvidence, 'disconnected', 'disconnected_revoked', {
      includeGrant: true,
      vaultResolution: 'missing',
    });
  }
  if (parsedEvidence.status === 'error') {
    return result(parsedEvidence, 'error', 'legacy_error_redacted', {
      includeGrant: true,
      lastErrorAt: lastErrorAt ?? grant.lastErrorAt ?? observedAt,
    });
  }
  if (!parsedEvidence.secretResolvable) {
    return result(parsedEvidence, 'invalid', 'vault_secret_missing', { includeGrant: true });
  }
  return result(parsedEvidence, 'active', 'active', { includeGrant: true });
}
