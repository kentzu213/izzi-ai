import {
  DEFAULT_MODEL_ROUTE_REQUIREMENTS,
  MODEL_ROUTE_CONTRACT_VERSION,
  ModelRouteResolutionError,
  createModelRouteDecision,
  retryPolicyForEndpointClass,
  type ModelRouteDecision,
  type ModelRouteRequirements,
} from '../../shared/model-gateway';
import { getModelCreditPolicy } from '../../shared/model-credit-policy';
import type { ChatProvider } from './chat-provider';
import { CustomOpenAIProvider } from './custom-openai-provider';
import { modelSupportsTools } from './izzi-request-headers';
import type { ManagedAgentProvider } from './managed-agent-provider';
import { ProviderSettingsStore } from './provider-settings-store';
import { SecretStore } from './secret-store';

export interface ResolvedModelRoute {
  readonly provider: ChatProvider;
  readonly decision: ModelRouteDecision;
}

/**
 * ProviderResolver is the sole managed/custom route authority.
 *
 * Each resolveRoute() call returns one provider bound to one immutable route
 * decision. Explicitly enabled custom routing fails closed when its config or
 * credential is unavailable; runtime failures never trigger another resolve.
 */
export class ProviderResolver {
  private readonly settings: ProviderSettingsStore;
  private readonly secrets: SecretStore;
  private readonly managed: ManagedAgentProvider;

  constructor(
    settings: ProviderSettingsStore,
    secrets: SecretStore,
    managed: ManagedAgentProvider,
  ) {
    this.settings = settings;
    this.secrets = secrets;
    this.managed = managed;
  }

  resolveRoute(
    requirements: ModelRouteRequirements = DEFAULT_MODEL_ROUTE_REQUIREMENTS,
  ): ResolvedModelRoute {
    if (
      requirements.contractVersion !== MODEL_ROUTE_CONTRACT_VERSION
      || requirements.streaming !== 'preferred'
      || requirements.tools !== 'not-required'
    ) {
      throw new Error('Unsupported model route requirements version');
    }

    if (!this.settings.isCustomEnabled()) {
      const route = this.managed.createRequestRoute();
      const retryPolicy = retryPolicyForEndpointClass(route.endpointClass);
      const decision = createModelRouteDecision({
        contractVersion: MODEL_ROUTE_CONTRACT_VERSION,
        routeKind: 'managed',
        providerKind: 'izzi-managed',
        endpointOrigin: route.endpointOrigin,
        endpointClass: route.endpointClass,
        modelId: route.modelId,
        capabilityDecision: {
          streaming: retryPolicy === 'same-route-exact-streaming-limitation-once'
            ? 'streaming-with-same-route-nonstream-retry'
            : 'streaming-only',
          tools: modelSupportsTools(route.modelId) ? 'supported' : 'unsupported',
        },
        creditPolicyClass: getModelCreditPolicy(route.modelId),
        retryPolicy,
        reasonCode: 'custom-disabled-managed-selected',
      });

      return Object.freeze({ provider: route.provider, decision });
    }

    const validation = this.settings.getConfigValidation();
    if (!validation.ok || !validation.config || !validation.endpoint) {
      throw new ModelRouteResolutionError(validation.reasonCode ?? 'custom-config-invalid');
    }

    const apiKey = this.secrets.getKey();
    if (!apiKey) {
      throw new ModelRouteResolutionError('custom-key-missing');
    }

    const retryPolicy = retryPolicyForEndpointClass(validation.endpoint.endpointClass);
    const provider = new CustomOpenAIProvider(
      validation.config,
      apiKey,
      (text) => this.secrets.redact(text),
    );
    const decision = createModelRouteDecision({
      contractVersion: MODEL_ROUTE_CONTRACT_VERSION,
      routeKind: 'custom',
      providerKind: 'openai-compatible-custom',
      endpointOrigin: validation.endpoint.origin,
      endpointClass: validation.endpoint.endpointClass,
      modelId: validation.config.selectedModel,
      capabilityDecision: {
        streaming: retryPolicy === 'same-route-exact-streaming-limitation-once'
          ? 'streaming-with-same-route-nonstream-retry'
          : 'streaming-only',
        tools: 'unsupported',
      },
      creditPolicyClass: 'provider-native',
      retryPolicy,
      reasonCode: 'custom-enabled-valid-selected',
    });

    return Object.freeze({ provider, decision });
  }

  /** Backward-compatible provider-only view of the deterministic route. */
  resolve(): ChatProvider {
    return this.resolveRoute().provider;
  }
}
