import { canonicalJson, looksLikeRawSecret } from '../personal-office';
import {
  INTEGRATION_GRANT_READ_MODEL_SCHEMA_VERSION,
  INTEGRATION_GRANT_READ_MODEL_VERSION,
  type IntegrationGrantReadModel,
  type IntegrationGrantRevocationPlan,
  type IntegrationGrantRevocationResult,
  type IntegrationGrantScope,
} from './types';
import { parseIntegrationGrantReadModel, parseOptionalTimestamp } from './validation';

function exactPlanText(value: string, path: string): string {
  if (
    value.length === 0
    || value.length > 256
    || value !== value.trim()
    || /[\0\r\n*]/.test(value)
    || looksLikeRawSecret(value)
    || /(?:AKIA|ASIA)[A-Z0-9]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./i.test(value)
  ) {
    throw new Error(`${path}: must be exact non-wildcard, non-credential text`);
  }
  return value;
}

export function createIntegrationGrantRevocationPlan(
  readModel: IntegrationGrantReadModel,
  expectedScope: IntegrationGrantScope,
  input: {
    readonly planId: string;
    readonly idempotencyKey: string;
    readonly requestedAt: string;
  },
): IntegrationGrantRevocationPlan {
  const parsed = parseIntegrationGrantReadModel(readModel, expectedScope);
  if (parsed.state === 'disconnected') {
    throw new Error('readModel.state: grant is already disconnected');
  }
  return Object.freeze({
    schemaVersion: INTEGRATION_GRANT_READ_MODEL_SCHEMA_VERSION,
    planVersion: INTEGRATION_GRANT_READ_MODEL_VERSION,
    planId: exactPlanText(input.planId, 'planId'),
    idempotencyKey: exactPlanText(input.idempotencyKey, 'idempotencyKey'),
    requestedAt: parseOptionalTimestamp(input.requestedAt, 'requestedAt')!,
    scope: parsed.scope,
    effect: 'plan_only',
  });
}

export function canonicalRevocationPlan(plan: IntegrationGrantRevocationPlan): string {
  return canonicalJson(plan);
}

export function createIntegrationGrantRevocationResult(
  plan: IntegrationGrantRevocationPlan,
  observedAt: string,
): IntegrationGrantRevocationResult {
  return Object.freeze({
    schemaVersion: INTEGRATION_GRANT_READ_MODEL_SCHEMA_VERSION,
    planId: plan.planId,
    status: 'planned',
    reasonCode: 'revocation_planned',
    observedAt: parseOptionalTimestamp(observedAt, 'observedAt')!,
  });
}
