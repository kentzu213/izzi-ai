import { describe, expect, it } from 'vitest';
import {
  PERSONAL_OFFICE_SCHEMA_VERSION,
  asId,
  secretRef,
  type IntegrationGrant,
  type IntegrationGrantId,
  type WorkspaceInstanceId,
} from '../personal-office';
import {
  canonicalRevocationPlan,
  createIntegrationGrantRevocationPlan,
  createIntegrationGrantRevocationResult,
  deriveIntegrationGrantReadModel,
  parseIntegrationGrant,
  parseIntegrationGrantReadModel,
  parseIntegrationGrantScope,
  type IntegrationGrantScope,
  type LegacyIntegrationGrantEvidence,
} from '.';

const NOW = '2026-07-29T12:00:00.000Z';

function scope(): IntegrationGrantScope {
  return {
    tenantId: 'tenant:izzi',
    userId: 'user:operator',
    workspaceInstanceId: asId<'WorkspaceInstanceId'>(
      'workspace:personal-office',
    ) as WorkspaceInstanceId,
    grantId: asId<'IntegrationGrantId'>(
      'grant:google-drive',
    ) as IntegrationGrantId,
    integration: 'google-drive',
    scopes: ['documents.read', 'documents.write'],
  };
}

function grant(overrides: Partial<IntegrationGrant> = {}): IntegrationGrant {
  const exactScope = scope();
  return {
    schemaVersion: PERSONAL_OFFICE_SCHEMA_VERSION,
    id: exactScope.grantId,
    workspaceInstanceId: exactScope.workspaceInstanceId,
    integration: exactScope.integration,
    scopes: exactScope.scopes,
    secret: secretRef(
      'integration_vault',
      'integration/google-drive/operator',
      exactScope.scopes,
    ),
    createdAt: '2026-07-29T10:00:00.000Z',
    updatedAt: '2026-07-29T11:00:00.000Z',
    ...overrides,
  };
}

function evidence(
  overrides: Partial<LegacyIntegrationGrantEvidence> = {},
): LegacyIntegrationGrantEvidence {
  return {
    status: 'connected',
    observedAt: NOW,
    scope: scope(),
    grant: grant(),
    vaultState: 'ready',
    secretResolvable: true,
    ...overrides,
  };
}

function derive(
  overrides: Partial<LegacyIntegrationGrantEvidence> = {},
) {
  return deriveIntegrationGrantReadModel(evidence(overrides), scope());
}

describe('integration-grant strict validation', () => {
  it('normalizes exact scope and rejects wildcards or credential-shaped ids', () => {
    expect(parseIntegrationGrantScope(scope()).scopes).toEqual([
      'documents.read',
      'documents.write',
    ]);
    expect(() => parseIntegrationGrantScope({
      ...scope(),
      tenantId: '*',
    })).toThrow(/non-wildcard/);
    expect(() => parseIntegrationGrantScope({
      ...scope(),
      userId: `sk-${'x'.repeat(24)}`,
    })).toThrow(/credential/);
  });

  it('rejects raw secret material, unknown fields and scope substitution', () => {
    expect(() => parseIntegrationGrant({
      ...grant(),
      secret: `sk-${'x'.repeat(24)}`,
    }, scope())).toThrow(/SecretRef|plain object/);
    expect(() => parseIntegrationGrant({
      ...grant(),
      token: 'not-allowed',
    }, scope())).toThrow(/not supported/);
    expect(() => parseIntegrationGrant({
      ...grant(),
      workspaceInstanceId: 'workspace:other',
    }, scope())).toThrow(/exact requested scope/);
    expect(() => parseIntegrationGrant({
      ...grant(),
      scopes: ['documents.read'],
      secret: secretRef(
        'integration_vault',
        'integration/google-drive/operator',
        ['documents.read'],
      ),
    }, scope())).toThrow(/exact requested scope/);
    expect(() => parseIntegrationGrant({
      ...grant(),
      secret: secretRef(
        'env',
        'INTEGRATION_TOKEN',
        scope().scopes,
      ),
    }, scope())).toThrow(/supported SecretRef/);
  });
});

describe('legacy mapping', () => {
  it('derives active only from a live exact grant and resolvable secret reference', () => {
    const active = derive();
    expect(active.state).toBe('active');
    expect(active.vaultResolution).toBe('resolvable');

    const missing = derive({ secretResolvable: false });
    expect(missing).toMatchObject({
      state: 'invalid',
      reasonCode: 'vault_secret_missing',
      vaultResolution: 'missing',
    });
  });

  it('maps disconnected, pending, locked, invalid and error deterministically', () => {
    expect(derive({
      status: 'disconnected',
      grant: undefined,
      secretResolvable: false,
    }).reasonCode).toBe('disconnected_absent');
    expect(derive({
      status: 'disconnected',
      grant: grant({ revokedAt: NOW }),
      secretResolvable: false,
    }).reasonCode).toBe('disconnected_revoked');
    expect(derive({
      status: 'pending',
      grant: undefined,
      requestedAt: NOW,
      secretResolvable: false,
    }).state).toBe('pending');
    expect(derive({
      status: 'locked',
      vaultState: 'locked',
      secretResolvable: false,
    })).toMatchObject({ state: 'locked', vaultResolution: 'unavailable' });
    expect(derive({
      status: 'invalid',
      grant: grant({ invalid: true }),
    }).reasonCode).toBe('grant_invalid');
    expect(derive({
      status: 'error',
      lastErrorAt: NOW,
    })).toMatchObject({
      state: 'error',
      reasonCode: 'legacy_error_redacted',
      lastErrorAt: NOW,
    });
  });

  it('fails closed for expired, missing and scope-inconsistent connected evidence', () => {
    expect(derive({
      grant: grant({ expiresAt: '2026-07-29T11:59:59.000Z' }),
    }).reasonCode).toBe('grant_expired');
    expect(derive({
      grant: undefined,
    }).reasonCode).toBe('grant_missing');
    expect(() => deriveIntegrationGrantReadModel(evidence({
      scope: { ...scope(), integration: 'telegram' },
    }), scope())).toThrow(/trusted tenant\/user\/workspace grant scope/);
    expect(() => deriveIntegrationGrantReadModel(evidence({
      scope: { ...scope(), userId: 'user:other' },
    }), scope())).toThrow(/trusted tenant\/user\/workspace grant scope/);
  });
});

describe('serialization and tamper revalidation', () => {
  it('round-trips a canonical model and rejects unknown success fields', () => {
    const model = derive();
    expect(parseIntegrationGrantReadModel(
      JSON.parse(JSON.stringify(model)),
      scope(),
    )).toEqual(model);
    expect(() => parseIntegrationGrantReadModel({
      ...model,
      connected: true,
    }, scope())).toThrow(/not supported/);
  });

  it('rejects workspace substitution and forged active state', () => {
    const model = derive();
    expect(() => parseIntegrationGrantReadModel({
      ...model,
      scope: { ...model.scope, workspaceInstanceId: 'workspace:other' },
    }, scope())).toThrow(/trusted tenant\/user\/workspace grant scope/);
    expect(() => parseIntegrationGrantReadModel({
      ...model,
      vaultResolution: 'missing',
    }, scope())).toThrow(/live resolvable grant/);
    expect(() => parseIntegrationGrantReadModel({
      ...model,
      grant: { ...model.grant!, revokedAt: NOW },
    }, scope())).toThrow(/live resolvable grant/);
    expect(() => parseIntegrationGrantReadModel({
      ...model,
      state: 'disconnected',
    }, scope())).toThrow(/absent or revoked evidence/);
  });
});

describe('revocation plan-only contract', () => {
  it('creates deterministic plan/result without executing a side effect', () => {
    const plan = createIntegrationGrantRevocationPlan(
      derive(),
      scope(),
      {
        planId: 'plan:revoke-google-drive',
        idempotencyKey: 'idem:revoke-google-drive',
        requestedAt: NOW,
      },
    );
    expect(plan.effect).toBe('plan_only');
    expect(canonicalRevocationPlan(plan)).not.toContain('token');
    expect(createIntegrationGrantRevocationResult(plan, NOW)).toMatchObject({
      status: 'planned',
      reasonCode: 'revocation_planned',
    });
  });
});
