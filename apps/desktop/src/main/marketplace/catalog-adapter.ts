import type { CapabilityRegistrySnapshot } from '../../shared/capabilities';
import {
  MARKETPLACE_CATALOG_SCHEMA_VERSION,
  MARKETPLACE_CATALOG_VERSION,
  evaluateMarketplaceCompatibility,
  marketplacePackageKey,
  parseMarketplaceCatalog,
  parseMarketplaceCatalogMetadata,
  type MarketplaceCatalog,
  type MarketplaceConnectionState,
} from '../../shared/marketplace';
import { verifyCapabilityRegistryAudit } from '../capabilities/registry';

export type MarketplaceCatalogAdapterErrorCode =
  | 'AUDIT_INVALID'
  | 'PACKAGE_NOT_REGISTERED'
  | 'UNSIGNED_PACKAGE'
  | 'EMPTY_CAPABILITY_REVIEW'
  | 'INVALID_SOURCE_STATE';

export class MarketplaceCatalogAdapterError extends Error {
  constructor(
    readonly code: MarketplaceCatalogAdapterErrorCode,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = Object.freeze({}),
  ) {
    super(message);
    this.name = 'MarketplaceCatalogAdapterError';
  }
}

export interface MarketplaceCatalogAdapterOptions {
  readonly desktopVersion: string;
  readonly connection: MarketplaceConnectionState;
  readonly retrievedAt: string;
  readonly installedPackageKeys?: readonly string[];
  readonly notice?: string;
}

/**
 * Convert strict public catalog metadata into a renderer-safe review catalog.
 *
 * Authority-bearing fields are copied only from a Loop 07 snapshot after its
 * trusted-policy audit passes. The remote/cached metadata cannot provide
 * permissions, classifications, trust, side effects, commands, environment
 * variables, download URLs, grants, activation state, or install success.
 */
export function buildMarketplaceCatalogFromCapabilityRegistry(
  metadataInput: unknown,
  snapshot: CapabilityRegistrySnapshot,
  options: MarketplaceCatalogAdapterOptions,
): MarketplaceCatalog {
  if (!verifyCapabilityRegistryAudit(snapshot)) {
    throw new MarketplaceCatalogAdapterError(
      'AUDIT_INVALID',
      'Capability registry audit failed',
    );
  }

  const metadata = parseMarketplaceCatalogMetadata(metadataInput);
  if (metadata.source === 'remote' && options.connection !== 'online') {
    throw new MarketplaceCatalogAdapterError(
      'INVALID_SOURCE_STATE',
      'Remote catalog metadata cannot be presented as offline',
    );
  }

  const installedPackageKeys = new Set(options.installedPackageKeys ?? []);
  const packages = metadata.packages.map((metadataPackage) => {
    const packageKey = marketplacePackageKey(
      metadataPackage.identity.sourceKind,
      metadataPackage.identity.packageName,
      metadataPackage.identity.packageVersion,
    );
    const packageRecord = snapshot.packages.find((candidate) => (
      candidate.source.kind === metadataPackage.identity.sourceKind
      && candidate.source.manifestName === metadataPackage.identity.packageName
      && candidate.source.manifestVersion === metadataPackage.identity.packageVersion
    ));
    if (!packageRecord) {
      throw new MarketplaceCatalogAdapterError(
        'PACKAGE_NOT_REGISTERED',
        `Catalog package is absent from the audited registry: ${packageKey}`,
        { packageKey },
      );
    }
    if (!packageRecord.skillPackage.signatureDigest) {
      throw new MarketplaceCatalogAdapterError(
        'UNSIGNED_PACKAGE',
        `Catalog package has no publisher digest: ${packageKey}`,
        { packageKey },
      );
    }
    const capabilities = snapshot.capabilities
      .filter((capability) => capability.packageId === packageRecord.skillPackage.id)
      .map((capability) => Object.freeze({
        capabilityId: capability.tool.id,
        name: capability.tool.name,
        description: capability.tool.description,
        requiredPermission: capability.tool.requiredPermission,
        trustZone: capability.trustZone,
        dataClassifications: capability.dataClassifications,
        sideEffects: capability.sideEffects,
        permissionRisk: capability.permissionRisk,
        policyVersion: capability.policyVersion,
        policyFingerprint: capability.policyFingerprint,
        auditFingerprint: capability.auditFingerprint,
      }));
    if (capabilities.length === 0) {
      throw new MarketplaceCatalogAdapterError(
        'EMPTY_CAPABILITY_REVIEW',
        `Catalog package has no audited capabilities: ${packageKey}`,
        { packageKey },
      );
    }
    const installed = installedPackageKeys.has(packageKey);
    return Object.freeze({
      identity: Object.freeze({
        ...metadataPackage.identity,
        packageKey,
      }),
      displayName: metadataPackage.displayName,
      summary: metadataPackage.summary,
      publisher: metadataPackage.publisher,
      category: metadataPackage.category,
      signatureDigest: packageRecord.skillPackage.signatureDigest,
      verification: 'host_verified' as const,
      registrySchemaVersion: snapshot.schemaVersion,
      registryVersion: snapshot.registryVersion,
      registryDigest: snapshot.auditDigest,
      packageId: packageRecord.skillPackage.id,
      compatibility: evaluateMarketplaceCompatibility(
        options.desktopVersion,
        metadataPackage.minimumDesktopVersion,
        metadataPackage.maximumDesktopVersion,
      ),
      installation: installed
        ? Object.freeze({
            state: 'installed' as const,
            installedVersion: metadataPackage.identity.packageVersion,
          })
        : Object.freeze({
            state: 'not_installed' as const,
          }),
      capabilities: Object.freeze(
        [...capabilities].sort((left, right) => (
          left.capabilityId.localeCompare(right.capabilityId)
        )),
      ),
    });
  });

  return parseMarketplaceCatalog({
    schemaVersion: MARKETPLACE_CATALOG_SCHEMA_VERSION,
    catalogVersion: MARKETPLACE_CATALOG_VERSION,
    generatedAt: metadata.generatedAt,
    source: {
      kind: metadata.source,
      connection: options.connection,
      retrievedAt: options.retrievedAt,
      ...(options.notice ? { notice: options.notice } : {}),
    },
    packages,
  }, {
    boundary: 'host_validated',
    expectedRegistryDigest: snapshot.auditDigest,
  });
}
