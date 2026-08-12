import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CustomerMarketingConnectorRequestBase } from './customer-marketing-connector-sdk';
import {
  CustomerMarketingConnectorVaultAdapter,
  type CustomerMarketingConnectorCredentialSource,
} from './customer-marketing-connector-vault-adapter';
import {
  CustomerMarketingXSandboxConnector,
  parseCustomerMarketingXSandboxResource,
  xSandboxResourceDigest,
  type CustomerMarketingXSandboxTransport,
} from './customer-marketing-x-sandbox-connector';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_HASH = 'a'.repeat(64);
const MANIFEST_DIGEST = 'b'.repeat(64);
const SECRET = 'synthetic-x-token-never-export';
const ACCOUNT_ID = '1234567890123456789';
const ACCOUNT_HASH = createHash('sha256').update(ACCOUNT_ID, 'utf8').digest('hex');
const TEXT = 'IzziAPI X sandbox post';
const NOW = '2026-08-12T15:00:00.000Z';
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const resource = {
  audience: 'sandbox_account' as const,
  accountId: ACCOUNT_ID,
  text: TEXT,
};
const RESOURCE_DIGEST = xSandboxResourceDigest(resource);

class FakeVault implements CustomerMarketingConnectorCredentialSource {
  state: 'connected' | 'disconnected' | 'locked' | 'invalid' = 'connected';

  getCredential(workspaceId: string, provider: 'x'): string | null {
    return workspaceId === WORKSPACE_ID && provider === 'x' && this.state === 'connected'
      ? SECRET
      : null;
  }

  listStatuses() {
    return {
      vaultState: 'ready' as const,
      credentials: [{ provider: 'x' as const, state: this.state, updatedAt: null }],
    };
  }
}

class FakeTransport implements CustomerMarketingXSandboxTransport {
  validateCalls = 0;
  postCalls: Array<{ secret: string; accountId: string; text: string }> = [];

  async validateCredential(secret: string) {
    this.validateCalls += 1;
    return { ok: secret === SECRET };
  }

  async createSandboxPost(secret: string, input: { accountId: string; text: string }) {
    this.postCalls.push({ secret, ...input });
    return { ok: secret === SECRET };
  }
}

function request(
  overrides: Partial<CustomerMarketingConnectorRequestBase> = {},
): CustomerMarketingConnectorRequestBase {
  return {
    workspaceHash: WORKSPACE_HASH,
    provider: 'x',
    target: 'social',
    resourceDigest: RESOURCE_DIGEST,
    manifestDigest: MANIFEST_DIGEST,
    expectedRevision: 1,
    idempotencyKey: 'cmr-228b-x-001',
    authority: {
      role: 'owner',
      plan: 'pro',
      permission: 'execute',
      rateLimit: { remaining: 2, resetAt: FUTURE },
    },
    ...overrides,
  };
}

function setup(vault = new FakeVault(), transport = new FakeTransport()) {
  const credentialAdapter = new CustomerMarketingConnectorVaultAdapter(
    vault,
    WORKSPACE_ID,
    'x',
    () => NOW,
  );
  return {
    connector: new CustomerMarketingXSandboxConnector({
      credentialAdapter,
      resource,
      configuredSandboxAccountHash: ACCOUNT_HASH,
      transport,
      policy: { executeEnabled: true, killSwitch: false, sandboxOnly: true },
      now: () => NOW,
    }),
    vault,
    transport,
  };
}

describe('Customer Marketing X sandbox connector', () => {
  it('accepts only an exact bounded sandbox-account post and creates a deterministic digest', () => {
    expect(parseCustomerMarketingXSandboxResource(resource)).toEqual(resource);
    expect(RESOURCE_DIGEST).toMatch(/^[a-f0-9]{64}$/);
    expect(xSandboxResourceDigest({ ...resource })).toBe(RESOURCE_DIGEST);

    const rejected = [
      { ...resource, audience: 'public' },
      { ...resource, accountId: 'not-an-id' },
      { ...resource, text: '' },
      { ...resource, text: 'x'.repeat(281) },
      { ...resource, token: SECRET },
      { ...resource, workspaceId: WORKSPACE_ID },
      { ...resource, path: 'C:\\customer-data' },
    ];
    rejected.forEach((value) => expect(parseCustomerMarketingXSandboxResource(value)).toBeNull());
  });

  it('requires the resource account to match the independently configured sandbox account hash', () => {
    const vault = new FakeVault();
    const credentialAdapter = new CustomerMarketingConnectorVaultAdapter(vault, WORKSPACE_ID, 'x');

    expect(() => new CustomerMarketingXSandboxConnector({
      credentialAdapter,
      resource,
      configuredSandboxAccountHash: 'f'.repeat(64),
      transport: new FakeTransport(),
      policy: { executeEnabled: true, killSwitch: false, sandboxOnly: true },
    })).toThrow('X resource is not bound to the configured sandbox account.');
  });

  it('health and validation use the X credential boundary without exposing sensitive data', async () => {
    const current = setup();
    const base = request();
    const health = await current.connector.health({ ...base, operation: 'health' });
    const validation = await current.connector.validate({ ...base, operation: 'validate' });

    expect(health).toMatchObject({ ok: true, status: 'ready', provider: 'x' });
    expect(validation).toMatchObject({ ok: true, status: 'valid', provider: 'x' });
    expect(current.transport.validateCalls).toBe(1);
    expect(JSON.stringify([health, validation])).not.toContain(SECRET);
    expect(JSON.stringify([health, validation])).not.toContain(ACCOUNT_ID);
    expect(JSON.stringify([health, validation])).not.toContain(TEXT);
  });

  it('dry-runs without reading the token or invoking the post transport', async () => {
    const current = setup();
    const result = await current.connector.dryRun({ ...request(), operation: 'dry_run' });

    expect(result).toMatchObject({
      ok: true,
      status: 'ready',
      provider: 'x',
      externalActionPerformed: false,
      receipt: null,
    });
    expect(current.transport.validateCalls).toBe(0);
    expect(current.transport.postCalls).toEqual([]);
  });

  it('posts once to the configured sandbox account and returns a redacted replay receipt', async () => {
    const current = setup();
    const input = {
      ...request(),
      operation: 'execute' as const,
      approval: {
        approvalId: 'approval-cmr-228b',
        manifestDigest: MANIFEST_DIGEST,
        expiresAt: FUTURE,
      },
    };

    const first = await current.connector.execute(input);
    const replay = await current.connector.execute(input);

    expect(first).toMatchObject({ ok: true, status: 'executed', externalActionPerformed: true });
    expect(replay).toMatchObject({ ok: true, status: 'duplicate', externalActionPerformed: false });
    expect(current.transport.postCalls).toEqual([{ secret: SECRET, accountId: ACCOUNT_ID, text: TEXT }]);
    expect(JSON.stringify([first, replay])).not.toContain(SECRET);
    expect(JSON.stringify([first, replay])).not.toContain(ACCOUNT_ID);
    expect(JSON.stringify([first, replay])).not.toContain(TEXT);
  });

  it('blocks rate limit and digest mismatch before credential access', async () => {
    const current = setup();
    const approval = {
      approvalId: 'approval-cmr-228b',
      manifestDigest: MANIFEST_DIGEST,
      expiresAt: FUTURE,
    };
    const rateLimited = request({
      authority: { ...request().authority, rateLimit: { remaining: 0, resetAt: FUTURE } },
    });

    expect(await current.connector.execute({ ...rateLimited, operation: 'execute', approval }))
      .toMatchObject({ ok: false, status: 'blocked', detail: 'rate-limited' });
    expect(await current.connector.execute({
      ...request({ resourceDigest: 'c'.repeat(64) }),
      operation: 'execute',
      approval,
    })).toMatchObject({ ok: false, status: 'blocked', detail: 'resource-digest-mismatch' });
    expect(current.transport.validateCalls).toBe(0);
    expect(current.transport.postCalls).toEqual([]);
  });

  it('fails closed after X credential revocation', async () => {
    const current = setup();
    current.vault.state = 'disconnected';
    const base = request();
    const approval = {
      approvalId: 'approval-cmr-228b',
      manifestDigest: MANIFEST_DIGEST,
      expiresAt: FUTURE,
    };

    expect(await current.connector.health({ ...base, operation: 'health' }))
      .toMatchObject({ ok: false, status: 'unavailable' });
    expect(await current.connector.validate({ ...base, operation: 'validate' }))
      .toMatchObject({ ok: false, status: 'forbidden' });
    expect(await current.connector.execute({ ...base, operation: 'execute', approval }))
      .toMatchObject({ ok: false, status: 'blocked', externalActionPerformed: false });
    expect(current.transport.postCalls).toEqual([]);
  });
});
