import { beforeEach, describe, expect, it } from 'vitest';
import {
  createMarketplaceInstallPlan,
  parseMarketplaceCatalog,
  type MarketplaceCatalog,
} from '../../shared/marketplace';
import { useMarketplacePersonalOfficeStore } from './marketplacePersonalOffice';

const DIGEST = `sha256:${'a'.repeat(64)}`;

function trustedCatalog(): MarketplaceCatalog {
  return parseMarketplaceCatalog({
    schemaVersion: 1,
    catalogVersion: '1.0.0',
    generatedAt: '2026-07-29T02:00:00.000Z',
    source: {
      kind: 'cached',
      connection: 'offline',
      retrievedAt: '2026-07-29T02:05:00.000Z',
    },
    packages: [{
      identity: {
        sourceKind: 'ocx_extension',
        packageName: 'reviewed-package',
        packageVersion: '1.2.3',
        packageKey: 'ocx_extension:reviewed-package@1.2.3',
      },
      displayName: 'Reviewed package',
      summary: 'A cached host-validated package.',
      publisher: 'Verified publisher',
      category: 'Operations',
      signatureDigest: DIGEST,
      verification: 'host_verified',
      registrySchemaVersion: 1,
      registryVersion: '1.1.0',
      registryDigest: DIGEST,
      packageId: 'skill-package:ocx_extension:reviewed-package@1.2.3',
      compatibility: {
        state: 'compatible',
        desktopVersion: '1.14.0-beta.3',
        minimumDesktopVersion: '1.0.0',
      },
      installation: {
        state: 'not_installed',
      },
      capabilities: [{
        capabilityId: 'tool:reviewed:ui.panel',
        name: 'reviewed-package:ui.panel',
        description: 'Register an extension panel through the host UI boundary.',
        requiredPermission: 'ui.panel',
        trustZone: 'extension_package',
        dataClassifications: ['public_metadata'],
        sideEffects: ['ui_mutation'],
        permissionRisk: 'low',
        policyVersion: '1.0.0',
        policyFingerprint: DIGEST,
        auditFingerprint: DIGEST,
      }],
    }],
  }, {
    boundary: 'host_validated',
    expectedRegistryDigest: DIGEST,
  });
}

describe('marketplace personal office store', () => {
  beforeEach(() => {
    useMarketplacePersonalOfficeStore.getState().reset();
  });

  it('records cancellation without creating a plan', () => {
    const catalog = trustedCatalog();
    const store = useMarketplacePersonalOfficeStore.getState();
    store.setCatalog(catalog);
    useMarketplacePersonalOfficeStore.getState().openReview(
      catalog.packages[0].identity.packageKey,
    );
    useMarketplacePersonalOfficeStore.getState().cancelReview();
    expect(useMarketplacePersonalOfficeStore.getState()).toMatchObject({
      reviewState: 'canceled',
      plan: null,
    });
  });

  it('accepts only a plan returned by the host bridge', () => {
    const catalog = trustedCatalog();
    useMarketplacePersonalOfficeStore.getState().setCatalog(catalog);
    useMarketplacePersonalOfficeStore.getState().openReview(
      catalog.packages[0].identity.packageKey,
    );
    const plan = createMarketplaceInstallPlan(
      catalog,
      catalog.packages[0].identity.packageKey,
      {
        tenantId: 'tenant:primary',
        userId: 'user:owner',
        workspaceInstanceId: 'workspace:personal-office',
      },
      '2026-07-29T03:00:00.000Z',
    );
    useMarketplacePersonalOfficeStore.getState().acceptPlan(plan);
    expect(plan).toMatchObject({
      effect: 'plan_only',
      requestedPermissions: ['ui.panel'],
    });
    expect(useMarketplacePersonalOfficeStore.getState().reviewState).toBe('planned');
  });
});
