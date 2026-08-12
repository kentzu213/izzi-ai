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

export interface CustomerMarketingXSandboxResource {
  audience: 'sandbox_account';
  accountId: string;
  text: string;
}

export interface CustomerMarketingXSandboxTransport {
  validateCredential(secret: string): Promise<{ ok: boolean }>;
  createSandboxPost(
    secret: string,
    input: Pick<CustomerMarketingXSandboxResource, 'accountId' | 'text'>,
  ): Promise<{ ok: boolean }>;
}

export interface CustomerMarketingXSandboxConnectorOptions {
  credentialAdapter: CustomerMarketingConnectorVaultAdapter;
  resource: unknown;
  configuredSandboxAccountHash: string;
  transport: CustomerMarketingXSandboxTransport;
  policy: CustomerMarketingConnectorExecutionPolicy;
  now?: () => string;
}

const RESOURCE_KEYS = ['audience', 'accountId', 'text'] as const;
const ACCOUNT_ID_PATTERN = /^[1-9][0-9]{4,24}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export function parseCustomerMarketingXSandboxResource(
  value: unknown,
): CustomerMarketingXSandboxResource | null {
  if (!isExactPlainRecord(value, RESOURCE_KEYS)
    || value.audience !== 'sandbox_account'
    || typeof value.accountId !== 'string'
    || !ACCOUNT_ID_PATTERN.test(value.accountId)
    || typeof value.text !== 'string'
    || value.text !== value.text.trim()
    || value.text.length < 1
    || value.text.length > 280
    || /[\u0000\u007f]/.test(value.text)) {
    return null;
  }
  return {
    audience: 'sandbox_account',
    accountId: value.accountId,
    text: value.text,
  };
}

export function xSandboxResourceDigest(value: unknown): string {
  const resource = parseCustomerMarketingXSandboxResource(value);
  if (!resource) throw new Error('Invalid X sandbox resource.');
  return sha256(JSON.stringify(resource));
}

export class CustomerMarketingXSandboxConnector implements CustomerMarketingConnector {
  readonly provider = 'x' as const;

  private readonly resource: CustomerMarketingXSandboxResource;
  private readonly resourceDigest: string;
  private readonly executor: CustomerMarketingConnectorExecutor;

  constructor(private readonly options: CustomerMarketingXSandboxConnectorOptions) {
    const resource = parseCustomerMarketingXSandboxResource(options.resource);
    if (!resource) throw new Error('Invalid X sandbox resource.');
    if (!SHA256_PATTERN.test(options.configuredSandboxAccountHash)
      || sha256(resource.accountId) !== options.configuredSandboxAccountHash) {
      throw new Error('X resource is not bound to the configured sandbox account.');
    }
    this.resource = resource;
    this.resourceDigest = xSandboxResourceDigest(resource);
    this.executor = new CustomerMarketingConnectorExecutor({
      dryRun: async () => ({ ok: true, detail: 'x-sandbox-ready' }),
      execute: async () => ({
        ok: await options.credentialAdapter.executeWithCredential((secret) => (
          options.transport.createSandboxPost(secret, {
            accountId: this.resource.accountId,
            text: this.resource.text,
          })
        )),
        detail: 'x-sandbox-post',
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
      return { valid: result.ok === true, detail: 'x-credential-validation' };
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
    return input.provider === 'x'
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
      provider: 'x',
      checkedAt: this.now(),
      detail,
    };
  }

  private forbiddenValidation(detail: string): CustomerMarketingConnectorValidateResult {
    return {
      ok: false,
      status: 'forbidden',
      provider: 'x',
      checkedAt: this.now(),
      detail,
    };
  }

  private blockedDryRun(detail: string): CustomerMarketingConnectorDryRunResult {
    return {
      ok: false,
      status: 'blocked',
      provider: 'x',
      externalActionPerformed: false,
      receipt: null,
      detail,
    };
  }

  private blockedExecute(detail: string): CustomerMarketingConnectorExecuteResult {
    return {
      ok: false,
      status: 'blocked',
      provider: 'x',
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
