import { describe, expect, it } from 'vitest';
import {
  FIXED_PRICE_STREAMING_LIMITATION,
  MODEL_ROUTE_CONTRACT_VERSION,
  ModelRouteResolutionError,
  canonicalModelRouteDecisionPayload,
  createModelRouteDecision,
  createNonStreamingRetryPayload,
  isExactStreamingLimitation,
  retryPolicyForEndpointClass,
  type ModelRouteDecisionEvidence,
} from '.';

const EVIDENCE: ModelRouteDecisionEvidence = {
  contractVersion: MODEL_ROUTE_CONTRACT_VERSION,
  routeKind: 'managed',
  providerKind: 'izzi-managed',
  endpointOrigin: 'https://api.izziapi.com',
  endpointClass: 'official-izzi-https',
  modelId: 'gpt-5.6-sol',
  capabilityDecision: {
    streaming: 'streaming-with-same-route-nonstream-retry',
    tools: 'unsupported',
  },
  creditPolicyClass: 'paid-balance-required',
  retryPolicy: 'same-route-exact-streaming-limitation-once',
  reasonCode: 'custom-disabled-managed-selected',
};

describe('model route decision contract', () => {
  it('is stable across insertion order and changes on routing evidence changes', () => {
    const reordered: ModelRouteDecisionEvidence = {
      reasonCode: EVIDENCE.reasonCode,
      retryPolicy: EVIDENCE.retryPolicy,
      creditPolicyClass: EVIDENCE.creditPolicyClass,
      capabilityDecision: {
        tools: EVIDENCE.capabilityDecision.tools,
        streaming: EVIDENCE.capabilityDecision.streaming,
      },
      modelId: EVIDENCE.modelId,
      endpointClass: EVIDENCE.endpointClass,
      endpointOrigin: EVIDENCE.endpointOrigin,
      providerKind: EVIDENCE.providerKind,
      routeKind: EVIDENCE.routeKind,
      contractVersion: EVIDENCE.contractVersion,
    };

    expect(canonicalModelRouteDecisionPayload(reordered)).toBe(
      canonicalModelRouteDecisionPayload(EVIDENCE),
    );
    expect(createModelRouteDecision(reordered).decisionHash).toBe(
      createModelRouteDecision(EVIDENCE).decisionHash,
    );
    expect(createModelRouteDecision(EVIDENCE).decisionHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(
      createModelRouteDecision({ ...EVIDENCE, modelId: 'gpt-5.6-terra' }).decisionHash,
    ).not.toBe(createModelRouteDecision(EVIDENCE).decisionHash);
  });

  it('serializes only secret-free evidence and freezes nested capability evidence', () => {
    const decision = createModelRouteDecision(EVIDENCE);
    const serialized = JSON.stringify(decision);

    expect(Object.isFrozen(decision)).toBe(true);
    expect(Object.isFrozen(decision.capabilityDecision)).toBe(true);
    expect(serialized).not.toContain('apiKey');
    expect(serialized).not.toContain('Authorization');
    expect(serialized).not.toContain('query');
    expect(serialized).not.toContain('fragment');
  });

  it('returns a typed, secret-free failure payload', () => {
    const error = new ModelRouteResolutionError('custom-key-missing');
    expect(error.reasonCode).toBe('custom-key-missing');
    expect(JSON.stringify(error)).toBe(
      JSON.stringify({
        name: 'ModelRouteResolutionError',
        code: 'MODEL_ROUTE_REJECTED',
        reasonCode: 'custom-key-missing',
        message: 'Custom provider is enabled but its credential is unavailable.',
      }),
    );
  });

  it('rejects non-origin endpoint evidence and non-canonical model ids', () => {
    expect(() => createModelRouteDecision({
      ...EVIDENCE,
      endpointOrigin: 'https://api.izziapi.com/v1',
    })).toThrow(/endpoint origin/i);
    expect(() => createModelRouteDecision({
      ...EVIDENCE,
      endpointOrigin: 'https://user:secret@api.izziapi.com',
    })).toThrow(/endpoint origin/i);
    expect(() => createModelRouteDecision({
      ...EVIDENCE,
      modelId: ' gpt-5.6-sol ',
    })).toThrow(/model id/i);
  });
});

describe('same-route retry contract', () => {
  it('matches only exact known JSON HTTP 400 messages', () => {
    const exact = JSON.stringify({ error: { message: FIXED_PRICE_STREAMING_LIMITATION } });
    expect(isExactStreamingLimitation(400, exact)).toBe(true);
    expect(isExactStreamingLimitation(500, exact)).toBe(false);
    expect(isExactStreamingLimitation(400, JSON.stringify({
      error: { message: `${FIXED_PRICE_STREAMING_LIMITATION} extra` },
    }))).toBe(false);
    expect(isExactStreamingLimitation(400, 'not json')).toBe(false);
    expect(isExactStreamingLimitation(400, JSON.stringify({
      error: { message: 'model is not supported' },
    }))).toBe(false);
  });

  it('changes only stream while preserving endpoint payload field identities', () => {
    const messages = [{ role: 'user', content: 'hi' }];
    const tools = [{ type: 'function', function: { name: 'lookup' } }];
    const original = {
      model: 'gpt-5.6-sol',
      messages,
      tools,
      temperature: 0.2,
      stream: true,
    };
    const retry = createNonStreamingRetryPayload(original);

    expect(retry).toEqual({ ...original, stream: false });
    expect(retry?.messages).toBe(messages);
    expect(retry?.tools).toBe(tools);
    expect(createNonStreamingRetryPayload({ ...original, stream: false })).toBeNull();
  });

  it('permits retry only on exact official Izzi HTTPS routes', () => {
    expect(retryPolicyForEndpointClass('official-izzi-https')).toBe(
      'same-route-exact-streaming-limitation-once',
    );
    expect(retryPolicyForEndpointClass('custom-https')).toBe('none');
    expect(retryPolicyForEndpointClass('loopback-http')).toBe('none');
  });
});
