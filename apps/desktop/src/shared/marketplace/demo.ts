import {
  CAPABILITY_REGISTRY_SCHEMA_VERSION,
  CAPABILITY_REGISTRY_VERSION,
} from '../capabilities';
import {
  MARKETPLACE_CATALOG_SCHEMA_VERSION,
  MARKETPLACE_CATALOG_VERSION,
  type MarketplaceCatalog,
  type MarketplaceConnectionState,
} from './types';
import {
  marketplacePackageKey,
  parseMarketplaceCatalog,
} from './validation';

const ZERO_DIGEST = `sha256:${'0'.repeat(64)}`;
const ONE_DIGEST = `sha256:${'1'.repeat(64)}`;
const OCX_EXTENSION_NAME_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const MARKETPLACE_SEMVER_REGEX = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function readInstalledOcxExtensionPackageKeys(
  value: unknown,
): readonly string[] {
  if (!Array.isArray(value)) return Object.freeze([]);

  const packageKeys = new Set<string>();
  for (const candidate of value) {
    if (!isPlainRecord(candidate)) continue;

    const packageName = candidate.name;
    const packageVersion = candidate.version;
    if (
      typeof packageName !== 'string'
      || packageName.length < 3
      || packageName.length > 64
      || !OCX_EXTENSION_NAME_REGEX.test(packageName)
      || typeof packageVersion !== 'string'
      || packageVersion.length > 64
      || !MARKETPLACE_SEMVER_REGEX.test(packageVersion)
    ) {
      continue;
    }

    packageKeys.add(marketplacePackageKey(
      'ocx_extension',
      packageName,
      packageVersion,
    ));
  }

  return Object.freeze([...packageKeys].sort());
}

export function createMarketplaceDemoCatalog(
  connection: MarketplaceConnectionState,
  notice: string,
): MarketplaceCatalog {
  return parseMarketplaceCatalog({
    schemaVersion: MARKETPLACE_CATALOG_SCHEMA_VERSION,
    catalogVersion: MARKETPLACE_CATALOG_VERSION,
    generatedAt: '2026-07-29T00:00:00.000Z',
    source: {
      kind: 'demo',
      connection,
      retrievedAt: '2026-07-29T00:00:00.000Z',
      notice,
    },
    packages: [
      {
        identity: {
          sourceKind: 'ocx_extension',
          packageName: 'social-auto-poster',
          packageVersion: '0.3.0',
          packageKey: marketplacePackageKey(
            'ocx_extension',
            'social-auto-poster',
            '0.3.0',
          ),
        },
        displayName: 'Social Auto Poster',
        summary: 'Preview how a marketing extension would request network, panel, and local storage access.',
        publisher: 'Izzi AI',
        category: 'Marketing',
        verification: 'demo_unverified',
        registrySchemaVersion: CAPABILITY_REGISTRY_SCHEMA_VERSION,
        registryVersion: CAPABILITY_REGISTRY_VERSION,
        registryDigest: ZERO_DIGEST,
        packageId: 'skill-package:ocx_extension:social-auto-poster@0.3.0',
        compatibility: {
          state: 'compatible',
          desktopVersion: '1.14.0-beta.3',
          minimumDesktopVersion: '1.14.0-beta.1',
        },
        installation: {
          state: 'not_installed',
        },
        capabilities: [
          {
            capabilityId: 'tool:demo:social-auto-poster:net.http',
            name: 'social-auto-poster:net.http',
            description: 'Make host-mediated HTTP requests using public metadata only.',
            requiredPermission: 'net.http',
            trustZone: 'extension_package',
            dataClassifications: ['public_metadata'],
            sideEffects: ['external_action', 'network_egress'],
            permissionRisk: 'medium',
            policyVersion: '1.0.0',
            policyFingerprint: ZERO_DIGEST,
            auditFingerprint: ONE_DIGEST,
          },
          {
            capabilityId: 'tool:demo:social-auto-poster:storage.local',
            name: 'social-auto-poster:storage.local',
            description: 'Write extension-scoped local storage.',
            requiredPermission: 'storage.local',
            trustZone: 'extension_package',
            dataClassifications: ['local_files'],
            sideEffects: ['local_write'],
            permissionRisk: 'low',
            policyVersion: '1.0.0',
            policyFingerprint: ONE_DIGEST,
            auditFingerprint: ZERO_DIGEST,
          },
          {
            capabilityId: 'tool:demo:social-auto-poster:ui.panel',
            name: 'social-auto-poster:ui.panel',
            description: 'Register an extension panel through the host UI boundary.',
            requiredPermission: 'ui.panel',
            trustZone: 'extension_package',
            dataClassifications: ['public_metadata'],
            sideEffects: ['ui_mutation'],
            permissionRisk: 'low',
            policyVersion: '1.0.0',
            policyFingerprint: ZERO_DIGEST,
            auditFingerprint: ONE_DIGEST,
          },
        ],
      },
      {
        identity: {
          sourceKind: 'ocx_extension',
          packageName: 'voice-studio',
          packageVersion: '0.1.0',
          packageKey: marketplacePackageKey(
            'ocx_extension',
            'voice-studio',
            '0.1.0',
          ),
        },
        displayName: 'Voice Studio',
        summary: 'Preview a local voice workspace with a managed service and extension panel.',
        publisher: 'Izzi AI',
        category: 'Voice',
        verification: 'demo_unverified',
        registrySchemaVersion: CAPABILITY_REGISTRY_SCHEMA_VERSION,
        registryVersion: CAPABILITY_REGISTRY_VERSION,
        registryDigest: ZERO_DIGEST,
        packageId: 'skill-package:ocx_extension:voice-studio@0.1.0',
        compatibility: {
          state: 'incompatible',
          desktopVersion: '1.14.0-beta.3',
          minimumDesktopVersion: '2.0.0',
          reason: 'Requires desktop 2.0.0 or newer.',
        },
        installation: {
          state: 'not_installed',
        },
        capabilities: [
          {
            capabilityId: 'tool:demo:voice-studio:managed_local_service',
            name: 'voice-studio:managed_local_service',
            description: 'Start a validated loopback-only managed local service.',
            requiredPermission: 'runtime.local_service',
            trustZone: 'extension_package',
            dataClassifications: ['local_files', 'secrets'],
            sideEffects: ['local_write', 'process_execution', 'secret_access'],
            permissionRisk: 'high',
            policyVersion: '1.0.0',
            policyFingerprint: ONE_DIGEST,
            auditFingerprint: ZERO_DIGEST,
          },
          {
            capabilityId: 'tool:demo:voice-studio:ui.panel',
            name: 'voice-studio:ui.panel',
            description: 'Register an extension panel through the host UI boundary.',
            requiredPermission: 'ui.panel',
            trustZone: 'extension_package',
            dataClassifications: ['public_metadata'],
            sideEffects: ['ui_mutation'],
            permissionRisk: 'low',
            policyVersion: '1.0.0',
            policyFingerprint: ZERO_DIGEST,
            auditFingerprint: ONE_DIGEST,
          },
        ],
      },
    ],
  }, { boundary: 'demo' });
}

export function markMarketplaceDemoInstalled(
  catalog: MarketplaceCatalog,
  installedPackageKeys: readonly string[],
): MarketplaceCatalog {
  const installed = new Set(installedPackageKeys);
  return parseMarketplaceCatalog({
    ...catalog,
    packages: catalog.packages.map((packageRecord) => (
      installed.has(packageRecord.identity.packageKey)
        ? {
            ...packageRecord,
            installation: {
              state: 'installed',
              installedVersion: packageRecord.identity.packageVersion,
            },
          }
        : packageRecord
    )),
  }, { boundary: 'demo' });
}
