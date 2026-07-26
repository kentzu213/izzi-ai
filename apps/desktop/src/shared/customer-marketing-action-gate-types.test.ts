import { describe, expect, it } from 'vitest';
import { CUSTOMER_MARKETING_INTEGRATION_PROVIDERS } from './customer-marketing-credential-types';
import type { CustomerMarketingWorkflowTarget } from './customer-marketing-types';
import {
  CUSTOMER_MARKETING_ACTION_GATE_ACTIONS,
  CUSTOMER_MARKETING_ACTION_GATE_METADATA_MAXIMA,
  CUSTOMER_MARKETING_ACTION_GATE_PUBLIC_DENIAL_REASONS,
  parseCustomerMarketingActionGateRequest,
  type CustomerMarketingActionGatePublicDenialReason,
  type CustomerMarketingActionGateRequest,
  type CustomerMarketingActionGateResult,
} from './customer-marketing-action-gate-types';

const TARGETS = ['social', 'seo', 'email', 'crm'] as const satisfies readonly CustomerMarketingWorkflowTarget[];
const DIGEST = 'a'.repeat(64);

function validRequest(): CustomerMarketingActionGateRequest {
  return {
    action: 'publish',
    target: 'social',
    workflowId: 'workflow-123',
    approvalId: 'approval-456',
    manifestDigest: DIGEST,
    provider: 'facebook',
    metadata: {
      itemCount: 1,
      recipientCount: 0,
      spendVnd: 0,
    },
  };
}

describe('parseCustomerMarketingActionGateRequest', () => {
  it('accepts every action, provider, and workflow target', () => {
    for (const action of CUSTOMER_MARKETING_ACTION_GATE_ACTIONS) {
      for (const provider of CUSTOMER_MARKETING_INTEGRATION_PROVIDERS) {
        for (const target of TARGETS) {
          const input = {
            ...validRequest(),
            action,
            provider,
            target,
          };

          expect(parseCustomerMarketingActionGateRequest(input)).toEqual(input);
        }
      }
    }
  });

  it('returns fresh normalized request and metadata objects', () => {
    const input = validRequest();
    const first = parseCustomerMarketingActionGateRequest(input);
    const second = parseCustomerMarketingActionGateRequest(input);

    expect(first).toEqual(input);
    expect(first).not.toBe(input);
    expect(first?.metadata).not.toBe(input.metadata);
    expect(second).not.toBe(first);
    expect(second?.metadata).not.toBe(first?.metadata);
  });

  it('accepts each metadata maximum', () => {
    const input = validRequest();
    input.metadata = { ...CUSTOMER_MARKETING_ACTION_GATE_METADATA_MAXIMA };

    expect(parseCustomerMarketingActionGateRequest(input)).toEqual(input);
  });

  it('rejects missing request keys', () => {
    for (const key of Object.keys(validRequest())) {
      const input = { ...validRequest() } as Record<string, unknown>;
      delete input[key];

      expect(parseCustomerMarketingActionGateRequest(input)).toBeNull();
    }
  });

  it.each([
    'workspaceId',
    'actorId',
    'token',
    'secret',
    'path',
    'contacts',
    'approvedBy',
  ])('rejects the malicious request key %s', (key) => {
    expect(parseCustomerMarketingActionGateRequest({
      ...validRequest(),
      [key]: key === 'contacts' ? ['person@example.invalid'] : 'sensitive',
    })).toBeNull();
  });

  it('rejects hidden, symbol, and prototype-pollution request keys', () => {
    const hidden = validRequest() as CustomerMarketingActionGateRequest & { token?: string };
    Object.defineProperty(hidden, 'token', { value: 'hidden' });

    const symbolKeyed = validRequest() as CustomerMarketingActionGateRequest & Record<symbol, string>;
    symbolKeyed[Symbol('secret')] = 'hidden';

    const protoKeyed = JSON.parse(JSON.stringify(validRequest())) as Record<string, unknown>;
    Object.defineProperty(protoKeyed, '__proto__', {
      configurable: true,
      enumerable: true,
      value: { approvedBy: 'attacker' },
      writable: true,
    });

    expect(parseCustomerMarketingActionGateRequest(hidden)).toBeNull();
    expect(parseCustomerMarketingActionGateRequest(symbolKeyed)).toBeNull();
    expect(parseCustomerMarketingActionGateRequest(protoKeyed)).toBeNull();
  });

  it.each([
    '',
    ' ',
    ' workflow-123',
    'workflow-123 ',
    'workflow\u0000id',
    'x'.repeat(257),
    123,
    null,
  ])('rejects an invalid workflow identifier %#', (workflowId) => {
    expect(parseCustomerMarketingActionGateRequest({
      ...validRequest(),
      workflowId,
    })).toBeNull();
  });

  it.each([
    '',
    '\tapproval-456',
    'approval-456\n',
    'approval\u007fid',
    'x'.repeat(257),
    false,
    undefined,
  ])('rejects an invalid approval identifier %#', (approvalId) => {
    expect(parseCustomerMarketingActionGateRequest({
      ...validRequest(),
      approvalId,
    })).toBeNull();
  });

  it.each([
    'a'.repeat(63),
    'a'.repeat(65),
    'A'.repeat(64),
    'g'.repeat(64),
    ` ${DIGEST}`,
    `${DIGEST} `,
    123,
    null,
  ])('rejects an invalid manifest digest %#', (manifestDigest) => {
    expect(parseCustomerMarketingActionGateRequest({
      ...validRequest(),
      manifestDigest,
    })).toBeNull();
  });

  it.each([
    ['itemCount', -1],
    ['itemCount', 1.5],
    ['itemCount', Number.NaN],
    ['itemCount', CUSTOMER_MARKETING_ACTION_GATE_METADATA_MAXIMA.itemCount + 1],
    ['recipientCount', Number.POSITIVE_INFINITY],
    ['recipientCount', Number.MAX_SAFE_INTEGER + 1],
    ['recipientCount', CUSTOMER_MARKETING_ACTION_GATE_METADATA_MAXIMA.recipientCount + 1],
    ['spendVnd', -1],
    ['spendVnd', '1000'],
    ['spendVnd', CUSTOMER_MARKETING_ACTION_GATE_METADATA_MAXIMA.spendVnd + 1],
  ])('rejects invalid metadata %s=%#', (key, value) => {
    expect(parseCustomerMarketingActionGateRequest({
      ...validRequest(),
      metadata: {
        ...validRequest().metadata,
        [key]: value,
      },
    })).toBeNull();
  });

  it('rejects missing and extra metadata keys', () => {
    for (const key of Object.keys(validRequest().metadata)) {
      const metadata = { ...validRequest().metadata } as Record<string, unknown>;
      delete metadata[key];

      expect(parseCustomerMarketingActionGateRequest({
        ...validRequest(),
        metadata,
      })).toBeNull();
    }

    expect(parseCustomerMarketingActionGateRequest({
      ...validRequest(),
      metadata: {
        ...validRequest().metadata,
        contacts: ['person@example.invalid'],
      },
    })).toBeNull();
  });

  it.each([null, [], new Date(0)])('rejects non-plain request objects %#', (input) => {
    expect(parseCustomerMarketingActionGateRequest(input)).toBeNull();
  });

  it('rejects request and metadata objects with custom or null prototypes', () => {
    const customRequest = Object.assign(Object.create({ actorId: 'attacker' }), validRequest());
    const nullPrototypeRequest = Object.assign(Object.create(null), validRequest());
    const customMetadata = Object.assign(Object.create({ token: 'hidden' }), validRequest().metadata);
    const nullPrototypeMetadata = Object.assign(Object.create(null), validRequest().metadata);

    expect(parseCustomerMarketingActionGateRequest(customRequest)).toBeNull();
    expect(parseCustomerMarketingActionGateRequest(nullPrototypeRequest)).toBeNull();
    expect(parseCustomerMarketingActionGateRequest({
      ...validRequest(),
      metadata: customMetadata,
    })).toBeNull();
    expect(parseCustomerMarketingActionGateRequest({
      ...validRequest(),
      metadata: nullPrototypeMetadata,
    })).toBeNull();
  });

  it('rejects class instances and accessor-backed fields', () => {
    class RequestInstance {
      action = 'publish';
      target = 'social';
      workflowId = 'workflow-123';
      approvalId = 'approval-456';
      manifestDigest = DIGEST;
      provider = 'facebook';
      metadata = validRequest().metadata;
    }

    const accessorRequest = validRequest();
    Object.defineProperty(accessorRequest, 'workflowId', {
      enumerable: true,
      get: () => 'workflow-123',
    });

    expect(parseCustomerMarketingActionGateRequest(new RequestInstance())).toBeNull();
    expect(parseCustomerMarketingActionGateRequest(accessorRequest)).toBeNull();
  });

  it('fails closed instead of throwing when object inspection throws', () => {
    const hostile = new Proxy(validRequest(), {
      getPrototypeOf: () => {
        throw new Error('hostile prototype trap');
      },
    });

    expect(() => parseCustomerMarketingActionGateRequest(hostile)).not.toThrow();
    expect(parseCustomerMarketingActionGateRequest(hostile)).toBeNull();
  });

  it.each([
    ['action', 'send'],
    ['action', 'Publish'],
    ['target', 'ads'],
    ['provider', 'seo'],
  ])('rejects an unknown %s', (key, value) => {
    expect(parseCustomerMarketingActionGateRequest({
      ...validRequest(),
      [key]: value,
    })).toBeNull();
  });
});

describe('CustomerMarketingActionGateResult', () => {
  it('exposes only bounded public denial reasons and fail-closed booleans', () => {
    const reasons: readonly CustomerMarketingActionGatePublicDenialReason[] =
      CUSTOMER_MARKETING_ACTION_GATE_PUBLIC_DENIAL_REASONS;

    for (const denialReason of reasons) {
      const result: CustomerMarketingActionGateResult = {
        allowed: false,
        executed: false,
        denialReason,
      };

      expect(result).toEqual({ allowed: false, executed: false, denialReason });
    }
  });
});
