import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_MARKETING_CONNECTOR_PROVIDERS,
  CUSTOMER_MARKETING_CONNECTOR_CAPABILITIES,
  parseCustomerMarketingConnectorRequest,
  type CustomerMarketingConnectorErrorCode,
  type CustomerMarketingConnector,
  type CustomerMarketingConnectorExecuteInput,
  type CustomerMarketingConnectorHealthInput,
  type CustomerMarketingConnectorValidateInput,
} from './customer-marketing-connector-sdk';

const WORKSPACE_HASH = 'a'.repeat(64);
const RESOURCE_DIGEST = 'b'.repeat(64);
const APPROVAL_DIGEST = 'c'.repeat(64);
const NOW = new Date().toISOString();
const FUTURE = new Date(Date.now() + 5 * 60 * 1000).toISOString();
const APPROVAL_FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();

const authority = {
  role: 'owner' as const,
  plan: 'pro' as const,
  permission: 'execute' as const,
  rateLimit: { remaining: 3, resetAt: FUTURE },
};

const base = {
  workspaceHash: WORKSPACE_HASH,
  provider: 'telegram' as const,
  target: 'social' as const,
  resourceDigest: RESOURCE_DIGEST,
  expectedRevision: 2,
  idempotencyKey: 'cmr-219-001',
  authority,
};

describe('CustomerMarketingConnector SDK contract', () => {
  it('exposes the allowlisted provider set and rejects unknown providers', () => {
    expect(CUSTOMER_MARKETING_CONNECTOR_PROVIDERS).toContain('telegram');
    expect(parseCustomerMarketingConnectorRequest({
      ...base,
      operation: 'health',
    })).toMatchObject({ provider: 'telegram', operation: 'health' });
    expect(parseCustomerMarketingConnectorRequest({
      ...base,
      provider: 'unknown',
      operation: 'health',
    })).toBeNull();
  });

  it('rejects raw secrets, workspace IDs, paths and unknown fields at the boundary', () => {
    expect(parseCustomerMarketingConnectorRequest({
      ...base,
      operation: 'validate',
      secret: 'must-never-cross-the-contract',
    })).toBeNull();
    expect(parseCustomerMarketingConnectorRequest({
      ...base,
      operation: 'validate',
      workspaceId: '11111111-1111-4111-8111-111111111111',
    })).toBeNull();
    expect(parseCustomerMarketingConnectorRequest({
      ...base,
      operation: 'validate',
      path: 'C:\\customer-data',
    })).toBeNull();
    expect(parseCustomerMarketingConnectorRequest({
      ...base,
      operation: 'validate',
      authority: { ...authority, tenantId: 'forbidden' },
    })).toBeNull();
    expect(parseCustomerMarketingConnectorRequest({
      ...base,
      operation: 'validate',
      approval: undefined,
    })).not.toBeNull();
  });

  it('requires a valid digest, revision, idempotency key and future rate-limit reset', () => {
    expect(parseCustomerMarketingConnectorRequest({ ...base, operation: 'validate' })).not.toBeNull();
    expect(parseCustomerMarketingConnectorRequest({ ...base, operation: 'validate', resourceDigest: 'bad' })).toBeNull();
    expect(parseCustomerMarketingConnectorRequest({ ...base, operation: 'validate', expectedRevision: -1 })).toBeNull();
    expect(parseCustomerMarketingConnectorRequest({ ...base, operation: 'validate', idempotencyKey: 'short' })).toBeNull();
    expect(parseCustomerMarketingConnectorRequest({
      ...base,
      operation: 'validate',
      authority: { ...authority, rateLimit: { remaining: 0, resetAt: NOW } },
    })).toBeNull();
  });

  it('requires approval and a main-process credential only for execute', () => {
    const health = parseCustomerMarketingConnectorRequest({ ...base, operation: 'health' });
    const validate = parseCustomerMarketingConnectorRequest({ ...base, operation: 'validate' });
    const dryRun = parseCustomerMarketingConnectorRequest({ ...base, operation: 'dry_run' });
    expect(health?.operation).toBe('health');
    expect(validate?.operation).toBe('validate');
    expect(dryRun?.operation).toBe('dry_run');
    expect(parseCustomerMarketingConnectorRequest({
      ...base,
      operation: 'execute',
    })).toBeNull();
    const approvedExecute = parseCustomerMarketingConnectorRequest({
      ...base,
      operation: 'execute',
      approval: {
        approvalId: 'approval-1',
        manifestDigest: APPROVAL_DIGEST,
        expiresAt: APPROVAL_FUTURE,
      },
    });
    expect(approvedExecute).toMatchObject({ operation: 'execute', provider: 'telegram' });
    expect(JSON.stringify(approvedExecute)).not.toContain('secret');
  });

  it('publishes a closed capability matrix and typed fail-closed error taxonomy', () => {
    expect(CUSTOMER_MARKETING_CONNECTOR_CAPABILITIES.telegram).toEqual({
      target: 'social',
      operations: ['health', 'validate', 'dry_run', 'execute'],
      sandboxOnly: true,
    });
    expect(CUSTOMER_MARKETING_CONNECTOR_CAPABILITIES.google.operations)
      .not.toContain('execute');
    const codes: CustomerMarketingConnectorErrorCode[] = [
      'invalid_request',
      'provider_unavailable',
      'authority_unavailable',
      'permission_denied',
      'plan_required',
      'rate_limited',
      'approval_required',
      'duplicate_request',
      'external_action_disabled',
      'credential_unavailable',
    ];
    expect(codes).toHaveLength(10);
  });

  it('keeps connector methods typed by operation and requires a redacted receipt shape', () => {
    const connector: CustomerMarketingConnector = {
      provider: 'telegram',
      health: async (_input: CustomerMarketingConnectorHealthInput) => ({
        ok: true,
        status: 'ready',
        provider: 'telegram',
        checkedAt: NOW,
        detail: 'sandbox-ready',
      }),
      validate: async (_input: CustomerMarketingConnectorValidateInput) => ({
        ok: true,
        status: 'valid',
        provider: 'telegram',
        checkedAt: NOW,
        detail: 'request-valid',
      }),
      dryRun: async () => ({
        ok: true,
        status: 'ready',
        provider: 'telegram',
        externalActionPerformed: false,
        receipt: null,
        detail: 'no-send',
      }),
      execute: async (input: CustomerMarketingConnectorExecuteInput) => ({
        ok: true,
        status: 'executed',
        provider: input.provider,
        externalActionPerformed: true,
        receipt: {
          id: 'receipt-1',
          provider: input.provider,
          operation: 'execute' as const,
          workspaceHash: input.workspaceHash,
          idempotencyKey: input.idempotencyKey,
          resourceDigest: input.resourceDigest,
          externalActionPerformed: true,
          createdAt: NOW,
          receiptDigest: 'd'.repeat(64),
        },
        detail: 'sandbox-sent',
      }),
    };

    expect(connector.provider).toBe('telegram');
  });
});
