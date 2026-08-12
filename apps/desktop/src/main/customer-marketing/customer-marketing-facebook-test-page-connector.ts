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

export interface CustomerMarketingFacebookTestPageResource {
  audience: 'test_page';
  pageId: string;
  message: string;
}

export interface CustomerMarketingFacebookTestPageTransport {
  validateCredential(secret: string): Promise<{ ok: boolean }>;
  createTestPagePost(
    secret: string,
    input: Pick<CustomerMarketingFacebookTestPageResource, 'pageId' | 'message'>,
  ): Promise<{ ok: boolean }>;
}

export interface CustomerMarketingFacebookTestPageConnectorOptions {
  credentialAdapter: CustomerMarketingConnectorVaultAdapter;
  resource: unknown;
  configuredTestPageHash: string;
  transport: CustomerMarketingFacebookTestPageTransport;
  policy: CustomerMarketingConnectorExecutionPolicy;
  now?: () => string;
}

const RESOURCE_KEYS = ['audience', 'pageId', 'message'] as const;
const PAGE_ID_PATTERN = /^[1-9][0-9]{4,24}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export function parseCustomerMarketingFacebookTestPageResource(
  value: unknown,
): CustomerMarketingFacebookTestPageResource | null {
  if (!isExactPlainRecord(value, RESOURCE_KEYS)
    || value.audience !== 'test_page'
    || typeof value.pageId !== 'string'
    || !PAGE_ID_PATTERN.test(value.pageId)
    || typeof value.message !== 'string'
    || value.message !== value.message.trim()
    || value.message.length < 1
    || value.message.length > 5_000
    || /[\u0000\u007f]/.test(value.message)) {
    return null;
  }
  return {
    audience: 'test_page',
    pageId: value.pageId,
    message: value.message,
  };
}

export function facebookTestPageResourceDigest(value: unknown): string {
  const resource = parseCustomerMarketingFacebookTestPageResource(value);
  if (!resource) throw new Error('Invalid Facebook test-page resource.');
  return sha256(JSON.stringify(resource));
}

export class CustomerMarketingFacebookTestPageConnector implements CustomerMarketingConnector {
  readonly provider = 'facebook' as const;

  private readonly resource: CustomerMarketingFacebookTestPageResource;
  private readonly resourceDigest: string;
  private readonly executor: CustomerMarketingConnectorExecutor;

  constructor(private readonly options: CustomerMarketingFacebookTestPageConnectorOptions) {
    const resource = parseCustomerMarketingFacebookTestPageResource(options.resource);
    if (!resource) throw new Error('Invalid Facebook test-page resource.');
    if (!SHA256_PATTERN.test(options.configuredTestPageHash)
      || sha256(resource.pageId) !== options.configuredTestPageHash) {
      throw new Error('Facebook resource is not bound to the configured test page.');
    }
    this.resource = resource;
    this.resourceDigest = facebookTestPageResourceDigest(resource);
    this.executor = new CustomerMarketingConnectorExecutor({
      dryRun: async () => ({ ok: true, detail: 'facebook-test-page-ready' }),
      execute: async () => ({
        ok: await options.credentialAdapter.executeWithCredential((secret) => (
          options.transport.createTestPagePost(secret, {
            pageId: this.resource.pageId,
            message: this.resource.message,
          })
        )),
        detail: 'facebook-test-page-post',
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
      return { valid: result.ok === true, detail: 'facebook-credential-validation' };
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
    return input.provider === 'facebook'
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
      provider: 'facebook',
      checkedAt: this.now(),
      detail,
    };
  }

  private forbiddenValidation(detail: string): CustomerMarketingConnectorValidateResult {
    return {
      ok: false,
      status: 'forbidden',
      provider: 'facebook',
      checkedAt: this.now(),
      detail,
    };
  }

  private blockedDryRun(detail: string): CustomerMarketingConnectorDryRunResult {
    return {
      ok: false,
      status: 'blocked',
      provider: 'facebook',
      externalActionPerformed: false,
      receipt: null,
      detail,
    };
  }

  private blockedExecute(detail: string): CustomerMarketingConnectorExecuteResult {
    return {
      ok: false,
      status: 'blocked',
      provider: 'facebook',
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
