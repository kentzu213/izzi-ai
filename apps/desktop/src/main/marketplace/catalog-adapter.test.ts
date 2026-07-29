import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_ADAPTER_VERSION,
  CAPABILITY_REGISTRY_SCHEMA_VERSION,
  type CapabilityRegistrySnapshot,
} from '../../shared/capabilities';
import {
  MARKETPLACE_CATALOG_SCHEMA_VERSION,
  MARKETPLACE_CATALOG_VERSION,
} from '../../shared/marketplace';
import { buildCapabilityRegistry } from '../capabilities/registry';
import {
  MarketplaceCatalogAdapterError,
  buildMarketplaceCatalogFromCapabilityRegistry,
} from './catalog-adapter';

const SIGNATURE = `sha256:${'c'.repeat(64)}`;

function registry(signatureDigest: string | null = SIGNATURE) {
  return buildCapabilityRegistry([{
    schemaVersion: CAPABILITY_REGISTRY_SCHEMA_VERSION,
    source: {
      kind: 'ocx_extension',
      manifestName: 'reviewed-package',
      manifestVersion: '1.2.3',
      observedAt: '2026-07-29T01:00:00.000Z',
      adapterVersion: CAPABILITY_ADAPTER_VERSION,
    },
    package: {
      displayName: 'Reviewed package',
      description: 'A registry-backed package.',
      ...(signatureDigest ? { signatureDigest } : {}),
    },
    declarations: [
      {
        kind: 'permission',
        key: 'net.http',
        manifestPath: 'permissions[0]',
      },
      {
        kind: 'permission',
        key: 'ui.panel',
        manifestPath: 'permissions[1]',
      },
    ],
    unsupportedDeclarations: [],
  }]);
}

function metadata(extra: Record<string, unknown> = {}) {
  return {
    schemaVersion: MARKETPLACE_CATALOG_SCHEMA_VERSION,
    catalogVersion: MARKETPLACE_CATALOG_VERSION,
    generatedAt: '2026-07-29T02:00:00.000Z',
    source: 'remote',
    packages: [{
      identity: {
        sourceKind: 'ocx_extension',
        packageName: 'reviewed-package',
        packageVersion: '1.2.3',
      },
      displayName: 'Reviewed package',
      summary: 'A package whose authority comes from the host registry.',
      publisher: 'Verified publisher',
      category: 'Operations',
      minimumDesktopVersion: '1.14.0-beta.1',
    }],
    ...extra,
  };
}

describe('marketplace catalog adapter', () => {
  it('copies permission and trust review only from the audited Loop 07 registry', () => {
    const snapshot = registry();
    const catalog = buildMarketplaceCatalogFromCapabilityRegistry(
      metadata(),
      snapshot,
      {
        desktopVersion: '1.14.0-beta.3',
        connection: 'online',
        retrievedAt: '2026-07-29T02:05:00.000Z',
      },
    );
    expect(catalog.source.kind).toBe('remote');
    expect(catalog.packages[0].verification).toBe('host_verified');
    expect(catalog.packages[0].capabilities.map((item) => item.requiredPermission))
      .toEqual(['net.http', 'ui.panel']);
    expect(catalog.packages[0].capabilities.every((item) => (
      item.trustZone === 'extension_package'
    ))).toBe(true);
  });

  it('rejects tampered audits and unsigned packages', () => {
    const snapshot = registry();
    const tampered = {
      ...snapshot,
      auditDigest: `sha256:${'d'.repeat(64)}`,
    } as CapabilityRegistrySnapshot;
    expect(() => buildMarketplaceCatalogFromCapabilityRegistry(
      metadata(),
      tampered,
      {
        desktopVersion: '1.14.0-beta.3',
        connection: 'online',
        retrievedAt: '2026-07-29T02:05:00.000Z',
      },
    )).toThrowError(MarketplaceCatalogAdapterError);

    expect(() => buildMarketplaceCatalogFromCapabilityRegistry(
      metadata(),
      registry(null),
      {
        desktopVersion: '1.14.0-beta.3',
        connection: 'online',
        retrievedAt: '2026-07-29T02:05:00.000Z',
      },
    )).toThrow(/no publisher digest/);
  });

  it('rejects metadata attempts to carry permissions, commands, env, or downloads', () => {
    const unsafeFields = [
      'permissions',
      'command',
      'environment',
      'downloadUrl',
    ];
    for (const field of unsafeFields) {
      const base = metadata();
      const unsafe = {
        ...base,
        packages: [{
          ...base.packages[0],
          [field]: field === 'permissions' ? ['system.shell'] : 'forbidden',
        }],
      };
      expect(() => buildMarketplaceCatalogFromCapabilityRegistry(
        unsafe,
        registry(),
        {
          desktopVersion: '1.14.0-beta.3',
          connection: 'online',
          retrievedAt: '2026-07-29T02:05:00.000Z',
        },
      )).toThrow(/not supported/);
    }
  });

  it('separates cached, offline, installed, and incompatible states', () => {
    const base = metadata({ source: 'cached' });
    const cached = {
      ...base,
      packages: [{
        ...base.packages[0],
        minimumDesktopVersion: '2.0.0',
      }],
    };
    const catalog = buildMarketplaceCatalogFromCapabilityRegistry(
      cached,
      registry(),
      {
        desktopVersion: '1.14.0-beta.3',
        connection: 'offline',
        retrievedAt: '2026-07-29T02:05:00.000Z',
        installedPackageKeys: ['ocx_extension:reviewed-package@1.2.3'],
      },
    );
    expect(catalog.source).toMatchObject({
      kind: 'cached',
      connection: 'offline',
    });
    expect(catalog.packages[0].installation.state).toBe('installed');
    expect(catalog.packages[0].compatibility.state).toBe('incompatible');
  });
});
