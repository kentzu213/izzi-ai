import type { ModelCreditPolicy } from '../model-credit-policy';

export const MODEL_ROUTE_CONTRACT_VERSION = 1 as const;

export type ModelRouteKind = 'managed' | 'custom';
export type ModelProviderKind = 'izzi-managed' | 'openai-compatible-custom';
export type ModelEndpointClass =
  | 'official-izzi-https'
  | 'custom-https'
  | 'loopback-http';
export type ModelRouteRetryPolicy =
  | 'none'
  | 'same-route-exact-streaming-limitation-once';
export type ModelRouteCreditPolicyClass = ModelCreditPolicy | 'provider-native';
export type ModelRouteReasonCode =
  | 'custom-disabled-managed-selected'
  | 'custom-enabled-valid-selected';
export type ModelRouteFailureReasonCode =
  | 'custom-config-missing'
  | 'custom-config-invalid'
  | 'custom-key-missing'
  | 'managed-config-invalid'
  | 'managed-endpoint-invalid'
  | 'managed-model-invalid';

export interface ModelRouteRequirements {
  readonly contractVersion: typeof MODEL_ROUTE_CONTRACT_VERSION;
  readonly streaming: 'preferred';
  readonly tools: 'not-required';
}

export const DEFAULT_MODEL_ROUTE_REQUIREMENTS: ModelRouteRequirements = Object.freeze({
  contractVersion: MODEL_ROUTE_CONTRACT_VERSION,
  streaming: 'preferred',
  tools: 'not-required',
});

export interface ModelRouteCapabilityDecision {
  readonly streaming:
    | 'streaming-only'
    | 'streaming-with-same-route-nonstream-retry';
  readonly tools: 'supported' | 'unsupported';
}

export interface ModelRouteDecisionEvidence {
  readonly contractVersion: typeof MODEL_ROUTE_CONTRACT_VERSION;
  readonly routeKind: ModelRouteKind;
  readonly providerKind: ModelProviderKind;
  /** Origin only. Never a path, query, fragment, userinfo, or credential. */
  readonly endpointOrigin: string;
  readonly endpointClass: ModelEndpointClass;
  readonly modelId: string;
  readonly capabilityDecision: ModelRouteCapabilityDecision;
  readonly creditPolicyClass: ModelRouteCreditPolicyClass;
  readonly retryPolicy: ModelRouteRetryPolicy;
  readonly reasonCode: ModelRouteReasonCode;
}

export interface ModelRouteDecision extends ModelRouteDecisionEvidence {
  readonly decisionHash: `sha256:${string}`;
}

const FAILURE_MESSAGES: Record<ModelRouteFailureReasonCode, string> = {
  'custom-config-missing': 'Custom provider is enabled but its configuration is missing.',
  'custom-config-invalid': 'Custom provider is enabled but its configuration is invalid.',
  'custom-key-missing': 'Custom provider is enabled but its credential is unavailable.',
  'managed-config-invalid': 'Managed provider configuration is unreadable or invalid.',
  'managed-endpoint-invalid': 'Managed provider configuration does not target an official Izzi HTTPS endpoint.',
  'managed-model-invalid': 'Managed provider model configuration is invalid.',
};

/** Typed, secret-free route rejection. No config value is copied into the error. */
export class ModelRouteResolutionError extends Error {
  readonly code = 'MODEL_ROUTE_REJECTED';
  readonly reasonCode: ModelRouteFailureReasonCode;

  constructor(reasonCode: ModelRouteFailureReasonCode) {
    super(FAILURE_MESSAGES[reasonCode]);
    this.name = 'ModelRouteResolutionError';
    this.reasonCode = reasonCode;
  }

  toJSON(): {
    name: string;
    code: string;
    reasonCode: ModelRouteFailureReasonCode;
    message: string;
  } {
    return {
      name: this.name,
      code: this.code,
      reasonCode: this.reasonCode,
      message: this.message,
    };
  }
}
