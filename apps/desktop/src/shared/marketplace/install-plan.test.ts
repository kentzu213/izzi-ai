import { describe, expect, it } from 'vitest';
import {
  MarketplaceValidationError,
  createMarketplaceDemoCatalog,
  createMarketplaceInstallPlan,
  markMarketplaceDemoInstalled,
  parseMarketplaceCatalog,
  parseMarketplaceInstallPlan,
  readInstalledOcxExtensionPackageKeys,
} from '.';

const DIGEST = `sha256:${'a'.repeat(64)}`;
const FINGERPRINT = `sha256:${'b'.repeat(64)}`;

function trustedCatalog() {
  return parseMarketplaceCatalog({
    schemaVersion: 1,
    catalogVersion: '1.0.0',
    generatedAt: '2026-07-29T01:00:00.000Z',
    source: {
      kind: 'remote',
      connection: 'online',
      retrievedAt: '2026-07-29T01:00:00.000Z',
    },
    packages: [{
      identity: {
        sourceKind: 'ocx_extension',
        packageName: 'reviewed-package',
        packageVersion: '1.2.3',
        packageKey: 'ocx_extension:reviewed-package@1.2.3',
      },
      displayName: 'Reviewed package',
      summary: 'A validated package for install planning tests.',
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
      capabilities: [
        {
          capabilityId: 'tool:reviewed:storage.local',
          name: 'reviewed-package:storage.local',
          description: 'Write extension-scoped local storage.',
          requiredPermission: 'storage.local',
          trustZone: 'extension_package',
          dataClassifications: ['local_files'],
          sideEffects: ['local_write'],
          permissionRisk: 'low',
          policyVersion: '1.0.0',
          policyFingerprint: FINGERPRINT,
          auditFingerprint: DIGEST,
        },
        {
          capabilityId: 'tool:reviewed:net.http',
          name: 'reviewed-package:net.http',
          description: 'Use public metadata for host-mediated network requests.',
          requiredPermission: 'net.http',
          trustZone: 'extension_package',
          dataClassifications: ['public_metadata'],
          sideEffects: ['external_action', 'network_egress'],
          permissionRisk: 'medium',
          policyVersion: '1.0.0',
          policyFingerprint: DIGEST,
          auditFingerprint: FINGERPRINT,
        },
      ],
    }],
  }, {
    boundary: 'host_validated',
    expectedRegistryDigest: DIGEST,
  });
}

describe('marketplace install plan', () => {
  it('does not mark a different installed version as installed', () => {
    const demo = createMarketplaceDemoCatalog('offline', 'Offline demo');
    const installedPackageKeys = readInstalledOcxExtensionPackageKeys([{
      id: 'ext-social-auto-poster',
      name: 'social-auto-poster',
      version: '0.2.0',
    }]);

    expect(installedPackageKeys).toEqual([
      'ocx_extension:social-auto-poster@0.2.0',
    ]);
    expect(
      markMarketplaceDemoInstalled(demo, installedPackageKeys)
        .packages[0].installation,
    ).toEqual({ state: 'not_installed' });
  });

  it('ignores id/name collisions and uses the authoritative name and version', () => {
    const demo = createMarketplaceDemoCatalog('offline', 'Offline demo');
    const installedPackageKeys = readInstalledOcxExtensionPackageKeys([{
      id: 'social-auto-poster',
      name: 'voice-studio',
      version: '0.1.0',
    }]);
    const marked = markMarketplaceDemoInstalled(demo, installedPackageKeys);

    expect(installedPackageKeys).toEqual([
      'ocx_extension:voice-studio@0.1.0',
    ]);
    expect(marked.packages[0].installation).toEqual({
      state: 'not_installed',
    });
    expect(marked.packages[1].installation).toEqual({
      state: 'installed',
      installedVersion: '0.1.0',
    });
  });

  it('ignores incomplete or invalid installed extension records', () => {
    const demo = createMarketplaceDemoCatalog('offline', 'Offline demo');
    const installedPackageKeys = readInstalledOcxExtensionPackageKeys([
      { id: 'voice-studio', version: '0.1.0' },
      { name: 'voice-studio' },
      { name: 'Voice Studio', version: '0.1.0' },
      { name: 'voice-studio', version: 'latest' },
      null,
    ]);

    expect(installedPackageKeys).toEqual([]);
    expect(
      markMarketplaceDemoInstalled(demo, installedPackageKeys)
        .packages.map((packageRecord) => packageRecord.installation),
    ).toEqual([
      { state: 'not_installed' },
      { state: 'not_installed' },
    ]);
  });

  it('is deterministic and derives exact authority from the reviewed capabilities', () => {
    const catalog = trustedCatalog();
    const scope = {
      tenantId: 'tenant:primary',
      userId: 'user:owner',
      workspaceInstanceId: 'workspace:personal-office',
    };
    const first = createMarketplaceInstallPlan(
      catalog,
      catalog.packages[0].identity.packageKey,
      scope,
      '2026-07-29T02:00:00.000Z',
    );
    const second = createMarketplaceInstallPlan(
      catalog,
      catalog.packages[0].identity.packageKey,
      scope,
      '2026-07-29T02:00:00.000Z',
    );
    expect(first).toEqual(second);
    expect(first.effect).toBe('plan_only');
    expect(first.requestedPermissions).toEqual(['net.http', 'storage.local']);
    expect(first.sideEffects).toEqual([
      'external_action',
      'local_write',
      'network_egress',
    ]);
    expect(first.requiresApproval).toBe(true);
  });

  it('rejects demo, installed, incompatible, and ambiguous scope inputs', () => {
    const demo = createMarketplaceDemoCatalog('offline', 'Offline demo');
    expect(() => createMarketplaceInstallPlan(
      demo,
      demo.packages[0].identity.packageKey,
      {
        tenantId: 'tenant',
        userId: 'user',
        workspaceInstanceId: 'workspace',
      },
      '2026-07-29T02:00:00.000Z',
    )).toThrowError(MarketplaceValidationError);

    const catalog = trustedCatalog();
    expect(() => createMarketplaceInstallPlan(
      catalog,
      catalog.packages[0].identity.packageKey,
      {
        tenantId: '*',
        userId: 'user',
        workspaceInstanceId: 'workspace',
      },
      '2026-07-29T02:00:00.000Z',
    )).toThrow(/non-wildcard/);
  });

  it('rejects command, environment, download, and success fields on a plan', () => {
    const catalog = trustedCatalog();
    const plan = createMarketplaceInstallPlan(
      catalog,
      catalog.packages[0].identity.packageKey,
      {
        tenantId: 'tenant',
        userId: 'user',
        workspaceInstanceId: 'workspace',
      },
      '2026-07-29T02:00:00.000Z',
    );
    for (const field of ['command', 'environment', 'downloadUrl', 'installed']) {
      expect(() => parseMarketplaceInstallPlan({
        ...plan,
        [field]: field === 'installed' ? true : 'forbidden',
      })).toThrow(/not supported/);
    }
  });

  it('rejects a serialized plan whose derived authority or identity is inconsistent', () => {
    const catalog = trustedCatalog();
    const plan = createMarketplaceInstallPlan(
      catalog,
      catalog.packages[0].identity.packageKey,
      {
        tenantId: 'tenant',
        userId: 'user',
        workspaceInstanceId: 'workspace',
      },
      '2026-07-29T02:00:00.000Z',
    );
    const mutations = [
      { requestedPermissions: ['*'] },
      { requestedPermissions: ['net.http'] },
      { dataClassifications: ['public_metadata'] },
      { sideEffects: ['network_egress'] },
      { requiresApproval: false },
      { planId: `${plan.planId}:tampered` },
      { packageId: 'skill-package:ocx_extension:other@1.0.0' },
      { registryVersion: '1.0.0' },
      { capabilities: [] },
    ];
    for (const mutation of mutations) {
      expect(() => parseMarketplaceInstallPlan({
        ...plan,
        ...mutation,
      })).toThrowError(MarketplaceValidationError);
    }
  });
});
