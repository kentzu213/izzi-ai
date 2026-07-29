import type {
  CapabilitySideEffect,
} from '../capabilities';
import type { DataClassification } from '../personal-office';
import {
  MARKETPLACE_INSTALL_PLAN_SCHEMA_VERSION,
  MARKETPLACE_INSTALL_PLAN_VERSION,
  MarketplaceValidationError,
  type MarketplaceCatalog,
  type MarketplaceInstallPlan,
  type MarketplaceInstallScope,
  type MarketplacePackage,
} from './types';
import {
  marketplaceInstallPlanId,
  parseMarketplaceInstallPlan,
  parseMarketplaceInstallScope,
} from './validation';

const APPROVAL_SIDE_EFFECTS = new Set<CapabilitySideEffect>([
  'external_action',
  'local_write',
  'network_egress',
  'process_execution',
  'secret_access',
]);

function uniqueSorted<T extends string>(values: readonly T[]): readonly T[] {
  return Object.freeze([...new Set(values)].sort()) as readonly T[];
}

function assertPlanEligible(
  catalog: MarketplaceCatalog,
  packageRecord: MarketplacePackage,
): void {
  if (catalog.source.kind === 'demo' || packageRecord.verification !== 'host_verified') {
    throw new MarketplaceValidationError([{
      code: 'UNTRUSTED_METADATA',
      path: 'package.verification',
      message: 'demo or unverified metadata cannot create an install plan',
    }]);
  }
  if (packageRecord.compatibility.state !== 'compatible') {
    throw new MarketplaceValidationError([{
      code: 'INCOMPATIBLE_PACKAGE',
      path: 'package.compatibility',
      message: packageRecord.compatibility.reason ?? 'package is incompatible',
    }]);
  }
  if (packageRecord.installation.state === 'installed') {
    throw new MarketplaceValidationError([{
      code: 'ALREADY_INSTALLED',
      path: 'package.installation',
      message: 'installed packages cannot create a new install plan',
    }]);
  }
  if (!packageRecord.signatureDigest) {
    throw new MarketplaceValidationError([{
      code: 'UNSIGNED_PACKAGE',
      path: 'package.signatureDigest',
      message: 'a publisher digest is required before planning installation',
    }]);
  }
}

export function createMarketplaceInstallPlan(
  catalog: MarketplaceCatalog,
  packageKey: string,
  scopeInput: MarketplaceInstallScope,
  plannedAt: string,
): MarketplaceInstallPlan {
  const packageRecord = catalog.packages.find((item) => (
    item.identity.packageKey === packageKey
  ));
  if (!packageRecord) {
    throw new MarketplaceValidationError([{
      code: 'INVALID_INSTALL_PLAN',
      path: 'packageKey',
      message: 'does not identify a package in this catalog',
    }]);
  }
  assertPlanEligible(catalog, packageRecord);
  const scope = parseMarketplaceInstallScope(scopeInput);
  const capabilities = packageRecord.capabilities.map((capability) => Object.freeze({
    capabilityId: capability.capabilityId,
    requiredPermission: capability.requiredPermission,
    trustZone: capability.trustZone,
    dataClassifications: capability.dataClassifications,
    sideEffects: capability.sideEffects,
    permissionRisk: capability.permissionRisk,
  }));
  const requestedPermissions = uniqueSorted(
    capabilities.map((capability) => capability.requiredPermission),
  );
  const dataClassifications = uniqueSorted(
    capabilities.flatMap((capability) => capability.dataClassifications),
  ) as readonly DataClassification[];
  const sideEffects = uniqueSorted(
    capabilities.flatMap((capability) => capability.sideEffects),
  ) as readonly CapabilitySideEffect[];
  const planId = marketplaceInstallPlanId(
    packageRecord.identity.packageKey,
    scope,
    packageRecord.registryDigest,
  );

  return parseMarketplaceInstallPlan({
    schemaVersion: MARKETPLACE_INSTALL_PLAN_SCHEMA_VERSION,
    planVersion: MARKETPLACE_INSTALL_PLAN_VERSION,
    planId,
    plannedAt,
    packageIdentity: packageRecord.identity,
    packageId: packageRecord.packageId,
    registryVersion: packageRecord.registryVersion,
    registryDigest: packageRecord.registryDigest,
    scope,
    requestedPermissions,
    dataClassifications,
    sideEffects,
    capabilities,
    requiresApproval: sideEffects.some((effect) => APPROVAL_SIDE_EFFECTS.has(effect)),
    effect: 'plan_only',
  });
}

export function canCreateMarketplaceInstallPlan(
  catalog: MarketplaceCatalog,
  packageRecord: MarketplacePackage,
): boolean {
  try {
    assertPlanEligible(catalog, packageRecord);
    return true;
  } catch {
    return false;
  }
}
