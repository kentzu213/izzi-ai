import {
  IntegrationGrantValidationError,
  assertExactIntegrationGrantScope,
  parseIntegrationGrant,
  parseIntegrationGrantScope,
  type IntegrationGrantScope,
  type IntegrationGrantVaultResolution,
} from '../../../shared/integration-grants';
import type {
  IntegrationGrant,
  SecretRef,
} from '../../../shared/personal-office';

export type GrantVaultResolution = IntegrationGrantVaultResolution;

export interface GrantVaultResolver {
  canResolve(
    secret: SecretRef,
    scope: IntegrationGrantScope,
  ): Promise<boolean>;
}

export interface GrantScopeAuthority {
  getScope(grantId: IntegrationGrant['id']): Promise<IntegrationGrantScope | null>;
}

export class GrantVault {
  constructor(
    private readonly resolver: GrantVaultResolver,
    private readonly scopeAuthority: GrantScopeAuthority,
  ) {}

  async check(
    grant: IntegrationGrant,
    scope: IntegrationGrantScope,
  ): Promise<GrantVaultResolution> {
    try {
      const claimedScope = parseIntegrationGrantScope(scope);
      const authorityScope = await this.scopeAuthority.getScope(grant.id);
      if (!authorityScope) {
        throw new Error('Grant scope authority has no binding for this grant.');
      }
      const exactScope = parseIntegrationGrantScope(authorityScope);
      assertExactIntegrationGrantScope(claimedScope, exactScope);
      const exactGrant = parseIntegrationGrant(grant, exactScope);
      return await this.resolver.canResolve(exactGrant.secret, exactScope)
        ? 'resolvable'
        : 'missing';
    } catch (error) {
      if (error instanceof IntegrationGrantValidationError) {
        throw error;
      }
      return 'unavailable';
    }
  }
}
