import {
  isCustomerMarketingIntegrationProvider,
  type CustomerMarketingCredentialConnectionState,
  type CustomerMarketingIntegrationProvider,
} from '../../shared/customer-marketing-credential-types';
import {
  type CustomerMarketingConnectorHealthResult,
  type CustomerMarketingConnectorValidateResult,
} from './customer-marketing-connector-sdk';

export interface CustomerMarketingConnectorCredentialSource {
  getCredential(workspaceId: string, provider: CustomerMarketingIntegrationProvider): string | null;
  listStatuses(workspaceId: string): {
    vaultState: 'ready' | 'locked';
    credentials: Array<{
      provider: CustomerMarketingIntegrationProvider;
      state: CustomerMarketingCredentialConnectionState;
      updatedAt: string | null;
    }>;
  };
}

export interface CustomerMarketingConnectorCredentialValidation {
  valid: boolean;
  detail: string;
}

export interface CustomerMarketingConnectorCredentialOperationResult {
  ok: boolean;
}

const WORKSPACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validWorkspaceId(value: string): boolean {
  return WORKSPACE_ID_PATTERN.test(value);
}

export class CustomerMarketingConnectorVaultAdapter {
  constructor(
    private readonly vault: CustomerMarketingConnectorCredentialSource,
    private readonly workspaceId: string,
    private readonly provider: CustomerMarketingIntegrationProvider,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    if (!validWorkspaceId(workspaceId)) throw new Error('Invalid customer marketing workspace.');
    if (!isCustomerMarketingIntegrationProvider(provider)) {
      throw new Error('Invalid customer marketing integration provider.');
    }
  }

  async health(): Promise<CustomerMarketingConnectorHealthResult> {
    const status = this.status();
    return {
      ok: status === 'connected',
      status: status === 'connected' ? 'ready' : 'unavailable',
      provider: this.provider,
      checkedAt: this.now(),
      detail: status === 'connected' ? 'credential-ready' : 'credential-unavailable',
    };
  }

  async validate(
    useCredential: (
      secret: string,
    ) => CustomerMarketingConnectorCredentialValidation | Promise<CustomerMarketingConnectorCredentialValidation>,
  ): Promise<CustomerMarketingConnectorValidateResult> {
    const status = this.status();
    if (status !== 'connected') {
      return {
        ok: false,
        status: 'forbidden',
        provider: this.provider,
        checkedAt: this.now(),
        detail: 'credential-unavailable',
      };
    }
    const secret = this.vault.getCredential(this.workspaceId, this.provider);
    if (!secret) {
      return {
        ok: false,
        status: 'forbidden',
        provider: this.provider,
        checkedAt: this.now(),
        detail: 'credential-unavailable',
      };
    }
    let validation: CustomerMarketingConnectorCredentialValidation;
    try {
      const candidate = await useCredential(secret);
      validation = candidate
        && typeof candidate.valid === 'boolean'
        && typeof candidate.detail === 'string'
        ? candidate
        : { valid: false, detail: 'credential-validation-failed' };
    } catch {
      validation = { valid: false, detail: 'credential-validation-failed' };
    }
    return {
      ok: validation.valid,
      status: validation.valid ? 'valid' : 'invalid',
      provider: this.provider,
      checkedAt: this.now(),
      detail: validation.valid ? 'credential-valid' : 'credential-invalid',
    };
  }

  async executeWithCredential(
    operation: (
      secret: string,
    ) => CustomerMarketingConnectorCredentialOperationResult | Promise<CustomerMarketingConnectorCredentialOperationResult>,
  ): Promise<boolean> {
    if (this.status() !== 'connected') return false;
    const secret = this.vault.getCredential(this.workspaceId, this.provider);
    if (!secret) return false;
    try {
      return (await operation(secret)).ok === true;
    } catch {
      return false;
    }
  }

  private status(): CustomerMarketingCredentialConnectionState | 'missing' {
    const snapshot = this.vault.listStatuses(this.workspaceId);
    if (snapshot.vaultState !== 'ready') return 'locked';
    return snapshot.credentials.find((credential) => credential.provider === this.provider)?.state ?? 'missing';
  }
}
