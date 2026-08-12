import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CustomerMarketingConnectorRequestBase } from './customer-marketing-connector-sdk';
import {
  CustomerMarketingConnectorVaultAdapter,
  type CustomerMarketingConnectorCredentialSource,
} from './customer-marketing-connector-vault-adapter';
import {
  CustomerMarketingFacebookTestPageConnector,
  facebookTestPageResourceDigest,
  parseCustomerMarketingFacebookTestPageResource,
  type CustomerMarketingFacebookTestPageTransport,
} from './customer-marketing-facebook-test-page-connector';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_HASH = 'a'.repeat(64);
const MANIFEST_DIGEST = 'b'.repeat(64);
const SECRET = 'synthetic-facebook-token-never-export';
const PAGE_ID = '123456789012345';
const PAGE_HASH = createHash('sha256').update(PAGE_ID, 'utf8').digest('hex');
const MESSAGE = 'IzziAPI Facebook test-page post';
const NOW = '2026-08-12T15:00:00.000Z';
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const resource = {
  audience: 'test_page' as const,
  pageId: PAGE_ID,
  message: MESSAGE,
};
const RESOURCE_DIGEST = facebookTestPageResourceDigest(resource);

class FakeVault implements CustomerMarketingConnectorCredentialSource {
  state: 'connected' | 'disconnected' | 'locked' | 'invalid' = 'connected';

  getCredential(workspaceId: string, provider: 'facebook'): string | null {
    return workspaceId === WORKSPACE_ID && provider === 'facebook' && this.state === 'connected'
      ? SECRET
      : null;
  }

  listStatuses() {
    return {
      vaultState: 'ready' as const,
      credentials: [{ provider: 'facebook' as const, state: this.state, updatedAt: null }],
    };
  }
}

class FakeTransport implements CustomerMarketingFacebookTestPageTransport {
  validateCalls = 0;
  postCalls: Array<{ secret: string; pageId: string; message: string }> = [];

  async validateCredential(secret: string) {
    this.validateCalls += 1;
    return { ok: secret === SECRET };
  }

  async createTestPagePost(secret: string, input: { pageId: string; message: string }) {
    this.postCalls.push({ secret, ...input });
    return { ok: secret === SECRET };
  }
}

function request(
  overrides: Partial<CustomerMarketingConnectorRequestBase> = {},
): CustomerMarketingConnectorRequestBase {
  return {
    workspaceHash: WORKSPACE_HASH,
    provider: 'facebook',
    target: 'social',
    resourceDigest: RESOURCE_DIGEST,
    manifestDigest: MANIFEST_DIGEST,
    expectedRevision: 1,
    idempotencyKey: 'cmr-228c-facebook-001',
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
    'facebook',
    () => NOW,
  );
  return {
    connector: new CustomerMarketingFacebookTestPageConnector({
      credentialAdapter,
      resource,
      configuredTestPageHash: PAGE_HASH,
      transport,
      policy: { executeEnabled: true, killSwitch: false, sandboxOnly: true },
      now: () => NOW,
    }),
    vault,
    transport,
  };
}

describe('Customer Marketing Facebook test-page connector', () => {
  it('accepts only an exact bounded test-page post and creates a deterministic digest', () => {
    expect(parseCustomerMarketingFacebookTestPageResource(resource)).toEqual(resource);
    expect(RESOURCE_DIGEST).toMatch(/^[a-f0-9]{64}$/);
    expect(facebookTestPageResourceDigest({ ...resource })).toBe(RESOURCE_DIGEST);

    const rejected = [
      { ...resource, audience: 'public_page' },
      { ...resource, pageId: 'not-a-page' },
      { ...resource, message: '' },
      { ...resource, message: 'x'.repeat(5_001) },
      { ...resource, token: SECRET },
      { ...resource, workspaceId: WORKSPACE_ID },
      { ...resource, path: 'C:\\customer-data' },
    ];
    rejected.forEach((value) => expect(parseCustomerMarketingFacebookTestPageResource(value)).toBeNull());
  });

  it('requires the resource page to match the independently configured test-page hash', () => {
    const credentialAdapter = new CustomerMarketingConnectorVaultAdapter(
      new FakeVault(),
      WORKSPACE_ID,
      'facebook',
    );

    expect(() => new CustomerMarketingFacebookTestPageConnector({
      credentialAdapter,
      resource,
      configuredTestPageHash: 'f'.repeat(64),
      transport: new FakeTransport(),
      policy: { executeEnabled: true, killSwitch: false, sandboxOnly: true },
    })).toThrow('Facebook resource is not bound to the configured test page.');
  });

  it('health and validation stay inside the Facebook credential boundary', async () => {
    const current = setup();
    const base = request();
    const health = await current.connector.health({ ...base, operation: 'health' });
    const validation = await current.connector.validate({ ...base, operation: 'validate' });

    expect(health).toMatchObject({ ok: true, status: 'ready', provider: 'facebook' });
    expect(validation).toMatchObject({ ok: true, status: 'valid', provider: 'facebook' });
    expect(current.transport.validateCalls).toBe(1);
    expect(JSON.stringify([health, validation])).not.toContain(SECRET);
    expect(JSON.stringify([health, validation])).not.toContain(PAGE_ID);
    expect(JSON.stringify([health, validation])).not.toContain(MESSAGE);
  });

  it('dry-runs without reading the token or invoking the page transport', async () => {
    const current = setup();
    const result = await current.connector.dryRun({ ...request(), operation: 'dry_run' });

    expect(result).toMatchObject({
      ok: true,
      status: 'ready',
      provider: 'facebook',
      externalActionPerformed: false,
      receipt: null,
    });
    expect(current.transport.validateCalls).toBe(0);
    expect(current.transport.postCalls).toEqual([]);
  });

  it('posts once to the configured test page and returns a redacted replay receipt', async () => {
    const current = setup();
    const input = {
      ...request(),
      operation: 'execute' as const,
      approval: {
        approvalId: 'approval-cmr-228c',
        manifestDigest: MANIFEST_DIGEST,
        expiresAt: FUTURE,
      },
    };

    const first = await current.connector.execute(input);
    const replay = await current.connector.execute(input);

    expect(first).toMatchObject({ ok: true, status: 'executed', externalActionPerformed: true });
    expect(replay).toMatchObject({ ok: true, status: 'duplicate', externalActionPerformed: false });
    expect(current.transport.postCalls).toEqual([{ secret: SECRET, pageId: PAGE_ID, message: MESSAGE }]);
    expect(JSON.stringify([first, replay])).not.toContain(SECRET);
    expect(JSON.stringify([first, replay])).not.toContain(PAGE_ID);
    expect(JSON.stringify([first, replay])).not.toContain(MESSAGE);
  });

  it('blocks rate limit and digest mismatch before credential access', async () => {
    const current = setup();
    const approval = {
      approvalId: 'approval-cmr-228c',
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

  it('fails closed after Facebook credential revocation', async () => {
    const current = setup();
    current.vault.state = 'disconnected';
    const base = request();
    const approval = {
      approvalId: 'approval-cmr-228c',
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
