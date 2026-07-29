import { createHash } from 'crypto';
import { canonicalJson } from '../personal-office/canonical';
import {
  MODEL_ROUTE_CONTRACT_VERSION,
  type ModelRouteDecision,
  type ModelRouteDecisionEvidence,
} from './contracts';
import { hasAsciiControlCharacter } from './validation';

function isCanonicalEndpointOrigin(value: string): boolean {
  if (
    !value
    || value !== value.trim()
    || hasAsciiControlCharacter(value)
    || value.includes('\\')
  ) {
    return false;
  }

  try {
    const url = new URL(value);
    return (
      (url.protocol === 'https:' || url.protocol === 'http:')
      && url.username === ''
      && url.password === ''
      && url.search === ''
      && url.hash === ''
      && url.pathname === '/'
      && value === url.origin
    );
  } catch {
    return false;
  }
}

export function canonicalModelRouteDecisionPayload(
  evidence: ModelRouteDecisionEvidence,
): string {
  return canonicalJson({
    capabilityDecision: evidence.capabilityDecision,
    contractVersion: evidence.contractVersion,
    creditPolicyClass: evidence.creditPolicyClass,
    endpointClass: evidence.endpointClass,
    endpointOrigin: evidence.endpointOrigin,
    modelId: evidence.modelId,
    providerKind: evidence.providerKind,
    reasonCode: evidence.reasonCode,
    retryPolicy: evidence.retryPolicy,
    routeKind: evidence.routeKind,
  });
}

export function hashModelRouteDecision(
  evidence: ModelRouteDecisionEvidence,
): `sha256:${string}` {
  const digest = createHash('sha256')
    .update(canonicalModelRouteDecisionPayload(evidence), 'utf8')
    .digest('hex');
  return `sha256:${digest}`;
}

/** Mint one immutable, secret-free route record from normalized evidence. */
export function createModelRouteDecision(
  evidence: ModelRouteDecisionEvidence,
): ModelRouteDecision {
  if (evidence.contractVersion !== MODEL_ROUTE_CONTRACT_VERSION) {
    throw new Error('Unsupported model route contract version');
  }
  if (!isCanonicalEndpointOrigin(evidence.endpointOrigin)) {
    throw new Error('Model route endpoint origin must be canonical and credential-free');
  }
  if (
    !evidence.modelId
    || evidence.modelId !== evidence.modelId.trim()
    || evidence.modelId.length > 200
    || hasAsciiControlCharacter(evidence.modelId)
  ) {
    throw new Error('Model route model id is invalid');
  }

  const capabilityDecision = Object.freeze({ ...evidence.capabilityDecision });
  const normalizedEvidence: ModelRouteDecisionEvidence = Object.freeze({
    ...evidence,
    capabilityDecision,
  });
  return Object.freeze({
    ...normalizedEvidence,
    decisionHash: hashModelRouteDecision(normalizedEvidence),
  });
}
