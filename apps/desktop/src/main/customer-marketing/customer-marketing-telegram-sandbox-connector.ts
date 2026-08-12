import { createHash } from 'node:crypto';
import type {
  CustomerMarketingConnector,
  CustomerMarketingConnectorDryRunInput,
  CustomerMarketingConnectorDryRunResult,
  CustomerMarketingConnectorExecuteInput,
  CustomerMarketingConnectorExecuteResult,
  CustomerMarketingConnectorHealthInput,
  CustomerMarketingConnectorHealthResult,
  CustomerMarketingConnectorRequestBase,
  CustomerMarketingConnectorValidateInput,
  CustomerMarketingConnectorValidateResult,
} from './customer-marketing-connector-sdk';
import {
  CustomerMarketingConnectorExecutor,
  type CustomerMarketingConnectorExecutionPolicy,
} from './customer-marketing-connector-executor';
import type { CustomerMarketingConnectorVaultAdapter } from './customer-marketing-connector-vault-adapter';

export interface CustomerMarketingTelegramSandboxResource {
  audience: 'private_sandbox';
  chatId: string;
  text: string;
}

export interface CustomerMarketingTelegramSandboxTransport {
  validateCredential(secret: string): Promise<{ ok: boolean }>;
  sendPrivateMessage(
    secret: string,
    input: Pick<CustomerMarketingTelegramSandboxResource, 'chatId' | 'text'>,
  ): Promise<{ ok: boolean }>;
}

export interface CustomerMarketingTelegramSandboxConnectorOptions {
  credentialAdapter: CustomerMarketingConnectorVaultAdapter;
  resource: unknown;
  transport: CustomerMarketingTelegramSandboxTransport;
  policy: CustomerMarketingConnectorExecutionPolicy;
  now?: () => string;
}

const RESOURCE_KEYS = ['audience', 'chatId', 'text'] as const;
const CHAT_ID_PATTERN = /^-100[1-9][0-9]{5,19}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export function parseCustomerMarketingTelegramSandboxResource(
  value: unknown,
): CustomerMarketingTelegramSandboxResource | null {
  if (!isExactPlainRecord(value, RESOURCE_KEYS)
    || value.audience !== 'private_sandbox'
    || typeof value.chatId !== 'string'
    || !CHAT_ID_PATTERN.test(value.chatId)
    || typeof value.text !== 'string'
    || value.text !== value.text.trim()
    || value.text.length < 1
    || value.text.length > 4_096
    || /[\u0000\u007f]/.test(value.text)) {
    return null;
  }
  return {
    audience: 'private_sandbox',
    chatId: value.chatId,
    text: value.text,
  };
}

export function telegramSandboxResourceDigest(value: unknown): string {
  const resource = parseCustomerMarketingTelegramSandboxResource(value);
  if (!resource) throw new Error('Invalid Telegram private sandbox resource.');
  return sha256(JSON.stringify(resource));
}

export class CustomerMarketingTelegramSandboxConnector implements CustomerMarketingConnector {
  readonly provider = 'telegram' as const;

  private readonly resource: CustomerMarketingTelegramSandboxResource;
  private readonly resourceDigest: string;
  private readonly executor: CustomerMarketingConnectorExecutor;

  constructor(private readonly options: CustomerMarketingTelegramSandboxConnectorOptions) {
    const resource = parseCustomerMarketingTelegramSandboxResource(options.resource);
    if (!resource) throw new Error('Invalid Telegram private sandbox resource.');
    this.resource = resource;
    this.resourceDigest = telegramSandboxResourceDigest(resource);
    this.executor = new CustomerMarketingConnectorExecutor({
      dryRun: async () => ({ ok: true, detail: 'telegram-private-sandbox-ready' }),
      execute: async () => ({
        ok: await options.credentialAdapter.executeWithCredential((secret) => (
          options.transport.sendPrivateMessage(secret, {
            chatId: this.resource.chatId,
            text: this.resource.text,
          })
        )),
        detail: 'telegram-private-sandbox-send',
      }),
    }, options.policy, options.now);
  }

  async health(input: CustomerMarketingConnectorHealthInput): Promise<CustomerMarketingConnectorHealthResult> {
    if (!this.isValidRequest(input)) return this.unavailableHealth('request-invalid');
    return this.options.credentialAdapter.health();
  }

  async validate(input: CustomerMarketingConnectorValidateInput): Promise<CustomerMarketingConnectorValidateResult> {
    if (!this.isValidRequest(input)) return this.forbiddenValidation('request-invalid');
    return this.options.credentialAdapter.validate(async (secret) => {
      const result = await this.options.transport.validateCredential(secret);
      return { valid: result.ok === true, detail: 'telegram-credential-validation' };
    });
  }

  async dryRun(input: CustomerMarketingConnectorDryRunInput): Promise<CustomerMarketingConnectorDryRunResult> {
    const blocked = this.preflight(input);
    if (blocked) return this.blockedDryRun(blocked);
    return this.executor.dryRun(input);
  }

  async execute(input: CustomerMarketingConnectorExecuteInput): Promise<CustomerMarketingConnectorExecuteResult> {
    const blocked = this.preflight(input);
    if (blocked) return this.blockedExecute(blocked);
    return this.executor.execute(input);
  }

  private preflight(input: CustomerMarketingConnectorRequestBase): string | null {
    if (!this.isValidRequest(input)) return 'request-invalid';
    if (input.resourceDigest !== this.resourceDigest) return 'resource-digest-mismatch';
    if (input.authority.rateLimit.remaining < 1) return 'rate-limited';
    return null;
  }

  private isValidRequest(input: CustomerMarketingConnectorRequestBase): boolean {
    return input.provider === 'telegram'
      && input.target === 'social'
      && SHA256_PATTERN.test(input.workspaceHash)
      && SHA256_PATTERN.test(input.resourceDigest)
      && SHA256_PATTERN.test(input.manifestDigest)
      && Number.isSafeInteger(input.expectedRevision)
      && input.expectedRevision >= 0;
  }

  private unavailableHealth(detail: string): CustomerMarketingConnectorHealthResult {
    return {
      ok: false,
      status: 'unavailable',
      provider: 'telegram',
      checkedAt: this.now(),
      detail,
    };
  }

  private forbiddenValidation(detail: string): CustomerMarketingConnectorValidateResult {
    return {
      ok: false,
      status: 'forbidden',
      provider: 'telegram',
      checkedAt: this.now(),
      detail,
    };
  }

  private blockedDryRun(detail: string): CustomerMarketingConnectorDryRunResult {
    return {
      ok: false,
      status: 'blocked',
      provider: 'telegram',
      externalActionPerformed: false,
      receipt: null,
      detail,
    };
  }

  private blockedExecute(detail: string): CustomerMarketingConnectorExecuteResult {
    return {
      ok: false,
      status: 'blocked',
      provider: 'telegram',
      externalActionPerformed: false,
      receipt: null,
      detail,
    };
  }

  private now(): string {
    return this.options.now?.() ?? new Date().toISOString();
  }
}

function isExactPlainRecord(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length
    && expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
