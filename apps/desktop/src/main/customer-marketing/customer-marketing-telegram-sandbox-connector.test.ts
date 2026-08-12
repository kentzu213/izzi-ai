import { describe, expect, it } from 'vitest';
import type { CustomerMarketingConnectorRequestBase } from './customer-marketing-connector-sdk';
import {
  CustomerMarketingConnectorVaultAdapter,
  type CustomerMarketingConnectorCredentialSource,
} from './customer-marketing-connector-vault-adapter';
import {
  CustomerMarketingTelegramSandboxConnector,
  parseCustomerMarketingTelegramSandboxResource,
  telegramSandboxResourceDigest,
  type CustomerMarketingTelegramSandboxTransport,
} from './customer-marketing-telegram-sandbox-connector';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_HASH = 'a'.repeat(64);
const MANIFEST_DIGEST = 'b'.repeat(64);
const SECRET = 'synthetic-telegram-token-never-export';
const CHAT_ID = '-1001234567890';
const TEXT = 'IzziAPI private sandbox message';
const NOW = '2026-08-12T15:00:00.000Z';
const FUTURE = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const resource = {
  audience: 'private_sandbox' as const,
  chatId: CHAT_ID,
  text: TEXT,
};
const RESOURCE_DIGEST = telegramSandboxResourceDigest(resource);

class FakeVault implements CustomerMarketingConnectorCredentialSource {
  state: 'connected' | 'disconnected' | 'locked' | 'invalid' = 'connected';

  getCredential(workspaceId: string, provider: 'telegram'): string | null {
    return workspaceId === WORKSPACE_ID && provider === 'telegram' && this.state === 'connected'
      ? SECRET
      : null;
  }

  listStatuses() {
    return {
      vaultState: 'ready' as const,
      credentials: [{ provider: 'telegram' as const, state: this.state, updatedAt: null }],
    };
  }
}

class FakeTransport implements CustomerMarketingTelegramSandboxTransport {
  validateCalls = 0;
  sendCalls: Array<{ secret: string; chatId: string; text: string }> = [];

  async validateCredential(secret: string) {
    this.validateCalls += 1;
    return { ok: secret === SECRET };
  }

  async sendPrivateMessage(secret: string, input: { chatId: string; text: string }) {
    this.sendCalls.push({ secret, ...input });
    return { ok: secret === SECRET };
  }
}

function request(
  overrides: Partial<CustomerMarketingConnectorRequestBase> = {},
): CustomerMarketingConnectorRequestBase {
  return {
    workspaceHash: WORKSPACE_HASH,
    provider: 'telegram',
    target: 'social',
    resourceDigest: RESOURCE_DIGEST,
    manifestDigest: MANIFEST_DIGEST,
    expectedRevision: 1,
    idempotencyKey: 'cmr-228a-telegram-001',
    authority: {
      role: 'owner',
      plan: 'pro',
      permission: 'execute',
      rateLimit: { remaining: 3, resetAt: FUTURE },
    },
    ...overrides,
  };
}

function connector(vault = new FakeVault(), transport = new FakeTransport()) {
  const credentialAdapter = new CustomerMarketingConnectorVaultAdapter(
    vault,
    WORKSPACE_ID,
    'telegram',
    () => NOW,
  );
  return {
    connector: new CustomerMarketingTelegramSandboxConnector({
      credentialAdapter,
      resource,
      transport,
      policy: { executeEnabled: true, killSwitch: false, sandboxOnly: true },
      now: () => NOW,
    }),
    vault,
    transport,
  };
}

describe('Customer Marketing Telegram private sandbox connector', () => {
  it('accepts only an exact bounded private-sandbox resource and creates a deterministic digest', () => {
    expect(parseCustomerMarketingTelegramSandboxResource(resource)).toEqual(resource);
    expect(RESOURCE_DIGEST).toMatch(/^[a-f0-9]{64}$/);
    expect(telegramSandboxResourceDigest({ ...resource })).toBe(RESOURCE_DIGEST);

    const rejected = [
      { ...resource, audience: 'public' },
      { ...resource, chatId: 'not-a-chat' },
      { ...resource, text: '' },
      { ...resource, text: 'x'.repeat(4_097) },
      { ...resource, secret: SECRET },
      { ...resource, path: 'C:\\customer-data' },
      { ...resource, workspaceId: WORKSPACE_ID },
    ];
    rejected.forEach((value) => {
      expect(parseCustomerMarketingTelegramSandboxResource(value)).toBeNull();
    });
  });

  it('reports health and validates credentials without exposing token or target data', async () => {
    const setup = connector();
    const base = request();
    const health = await setup.connector.health({ ...base, operation: 'health' });
    const validation = await setup.connector.validate({ ...base, operation: 'validate' });

    expect(health).toMatchObject({ ok: true, status: 'ready', provider: 'telegram' });
    expect(validation).toMatchObject({ ok: true, status: 'valid', provider: 'telegram' });
    expect(setup.transport.validateCalls).toBe(1);
    expect(JSON.stringify([health, validation])).not.toContain(SECRET);
    expect(JSON.stringify([health, validation])).not.toContain(CHAT_ID);
    expect(JSON.stringify([health, validation])).not.toContain(TEXT);
  });

  it('dry-runs without reading the token or invoking the send transport', async () => {
    const setup = connector();
    const result = await setup.connector.dryRun({ ...request(), operation: 'dry_run' });

    expect(result).toMatchObject({
      ok: true,
      status: 'ready',
      provider: 'telegram',
      externalActionPerformed: false,
      receipt: null,
    });
    expect(setup.transport.validateCalls).toBe(0);
    expect(setup.transport.sendCalls).toEqual([]);
  });

  it('sends once to the configured private sandbox and redacts the receipt on replay', async () => {
    const setup = connector();
    const input = {
      ...request(),
      operation: 'execute' as const,
      approval: {
        approvalId: 'approval-cmr-228a',
        manifestDigest: MANIFEST_DIGEST,
        expiresAt: FUTURE,
      },
    };

    const first = await setup.connector.execute(input);
    const replay = await setup.connector.execute(input);

    expect(first).toMatchObject({ ok: true, status: 'executed', externalActionPerformed: true });
    expect(replay).toMatchObject({ ok: true, status: 'duplicate', externalActionPerformed: false });
    expect(setup.transport.sendCalls).toEqual([{ secret: SECRET, chatId: CHAT_ID, text: TEXT }]);
    expect(JSON.stringify([first, replay])).not.toContain(SECRET);
    expect(JSON.stringify([first, replay])).not.toContain(CHAT_ID);
    expect(JSON.stringify([first, replay])).not.toContain(TEXT);
  });

  it('blocks rate-limited or digest-mismatched requests before credential or transport access', async () => {
    const setup = connector();
    const approval = {
      approvalId: 'approval-cmr-228a',
      manifestDigest: MANIFEST_DIGEST,
      expiresAt: FUTURE,
    };
    const rateLimited = request({
      authority: { ...request().authority, rateLimit: { remaining: 0, resetAt: FUTURE } },
    });

    expect(await setup.connector.execute({ ...rateLimited, operation: 'execute', approval }))
      .toMatchObject({ ok: false, status: 'blocked', detail: 'rate-limited' });
    expect(await setup.connector.execute({
      ...request({ resourceDigest: 'c'.repeat(64) }),
      operation: 'execute',
      approval,
    })).toMatchObject({ ok: false, status: 'blocked', detail: 'resource-digest-mismatch' });
    expect(setup.transport.validateCalls).toBe(0);
    expect(setup.transport.sendCalls).toEqual([]);
  });

  it('fails closed after credential revocation and never invokes the send transport', async () => {
    const setup = connector();
    setup.vault.state = 'disconnected';
    const base = request();
    const approval = {
      approvalId: 'approval-cmr-228a',
      manifestDigest: MANIFEST_DIGEST,
      expiresAt: FUTURE,
    };

    expect(await setup.connector.health({ ...base, operation: 'health' }))
      .toMatchObject({ ok: false, status: 'unavailable' });
    expect(await setup.connector.validate({ ...base, operation: 'validate' }))
      .toMatchObject({ ok: false, status: 'forbidden' });
    expect(await setup.connector.execute({ ...base, operation: 'execute', approval }))
      .toMatchObject({ ok: false, status: 'blocked', externalActionPerformed: false });
    expect(setup.transport.sendCalls).toEqual([]);
  });
});
