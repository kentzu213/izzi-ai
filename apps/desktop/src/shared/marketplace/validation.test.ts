import { describe, expect, it } from 'vitest';
import {
  MARKETPLACE_CATALOG_SCHEMA_VERSION,
  MARKETPLACE_CATALOG_VERSION,
  MarketplaceValidationError,
  createMarketplaceDemoCatalog,
  parseMarketplaceCatalog,
  parseMarketplaceCatalogMetadata,
} from '.';

describe('marketplace catalog validation', () => {
  it('rejects unknown metadata fields that could smuggle execution instructions', () => {
    expect(() => parseMarketplaceCatalogMetadata({
      schemaVersion: MARKETPLACE_CATALOG_SCHEMA_VERSION,
      catalogVersion: MARKETPLACE_CATALOG_VERSION,
      generatedAt: '2026-07-29T00:00:00.000Z',
      source: 'remote',
      packages: [],
      command: 'run-me',
    })).toThrowError(MarketplaceValidationError);
  });

  it('rejects unsupported versions and credential-shaped public metadata', () => {
    expect(() => parseMarketplaceCatalogMetadata({
      schemaVersion: 2,
      catalogVersion: MARKETPLACE_CATALOG_VERSION,
      generatedAt: '2026-07-29T00:00:00.000Z',
      source: 'remote',
      packages: [],
    })).toThrow(/schemaVersion/);

    expect(() => parseMarketplaceCatalogMetadata({
      schemaVersion: MARKETPLACE_CATALOG_SCHEMA_VERSION,
      catalogVersion: MARKETPLACE_CATALOG_VERSION,
      generatedAt: '2026-07-29T00:00:00.000Z',
      source: 'remote',
      packages: [{
        identity: {
          sourceKind: 'ocx_extension',
          packageName: 'unsafe-package',
          packageVersion: '1.0.0',
        },
        displayName: 'Unsafe package',
        summary: 'Token sk-proj-12345678901234567890',
        publisher: 'Example',
        category: 'Test',
        minimumDesktopVersion: '1.0.0',
      }],
    })).toThrow(/credential-shaped/);
  });

  it('keeps demo metadata explicitly unverified and non-host-validated', () => {
    const demo = createMarketplaceDemoCatalog('offline', 'Offline demo');
    expect(demo.source.kind).toBe('demo');
    expect(demo.packages.every((item) => item.verification === 'demo_unverified')).toBe(true);

    expect(() => parseMarketplaceCatalog(demo, {
      boundary: 'host_validated',
      expectedRegistryDigest: demo.packages[0].registryDigest,
    })).toThrow(/must be remote or cached/);
  });

  it('rejects permission widening even in demo-shaped data', () => {
    const demo = createMarketplaceDemoCatalog('online', 'Demo');
    const widened = {
      ...demo,
      packages: [{
        ...demo.packages[0],
        capabilities: [{
          ...demo.packages[0].capabilities[0],
          requiredPermission: '*',
        }],
      }],
    };
    expect(() => parseMarketplaceCatalog(widened, { boundary: 'demo' }))
      .toThrow(/non-wildcard permission/);
  });
});
