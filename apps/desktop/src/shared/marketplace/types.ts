import type {
  CapabilityManifestSourceKind,
  CapabilityPermissionRisk,
  CapabilitySideEffect,
} from '../capabilities';
import type { DataClassification, TrustZone } from '../personal-office';

export const MARKETPLACE_CATALOG_SCHEMA_VERSION = 1 as const;
export const MARKETPLACE_CATALOG_VERSION = '1.0.0' as const;
export const MARKETPLACE_INSTALL_PLAN_SCHEMA_VERSION = 1 as const;
export const MARKETPLACE_INSTALL_PLAN_VERSION = '1.0.0' as const;

export type MarketplaceCatalogSourceKind = 'remote' | 'cached' | 'demo';
export type MarketplaceConnectionState = 'online' | 'offline';
export type MarketplaceCompatibilityState = 'compatible' | 'incompatible';
export type MarketplaceInstallationState = 'not_installed' | 'installed';
export type MarketplaceVerificationState = 'host_verified' | 'demo_unverified';

export interface MarketplacePackageIdentity {
  readonly sourceKind: CapabilityManifestSourceKind;
  readonly packageName: string;
  readonly packageVersion: string;
  readonly packageKey: string;
}

export interface MarketplaceCapabilityReview {
  readonly capabilityId: string;
  readonly name: string;
  readonly description: string;
  readonly requiredPermission: string;
  readonly trustZone: Extract<TrustZone, 'extension_package'>;
  readonly dataClassifications: readonly DataClassification[];
  readonly sideEffects: readonly CapabilitySideEffect[];
  readonly permissionRisk: CapabilityPermissionRisk;
  readonly policyVersion: string;
  readonly policyFingerprint: string;
  readonly auditFingerprint: string;
}

export interface MarketplacePackageCompatibility {
  readonly state: MarketplaceCompatibilityState;
  readonly desktopVersion: string;
  readonly minimumDesktopVersion: string;
  readonly maximumDesktopVersion?: string;
  readonly reason?: string;
}

export interface MarketplacePackageInstallation {
  readonly state: MarketplaceInstallationState;
  readonly installedVersion?: string;
}

export interface MarketplacePackage {
  readonly identity: MarketplacePackageIdentity;
  readonly displayName: string;
  readonly summary: string;
  readonly publisher: string;
  readonly category: string;
  readonly signatureDigest?: string;
  readonly verification: MarketplaceVerificationState;
  readonly registrySchemaVersion: number;
  readonly registryVersion: string;
  readonly registryDigest: string;
  readonly packageId: string;
  readonly compatibility: MarketplacePackageCompatibility;
  readonly installation: MarketplacePackageInstallation;
  readonly capabilities: readonly MarketplaceCapabilityReview[];
}

export interface MarketplaceCatalogSource {
  readonly kind: MarketplaceCatalogSourceKind;
  readonly connection: MarketplaceConnectionState;
  readonly retrievedAt: string;
  readonly notice?: string;
}

export interface MarketplaceCatalog {
  readonly schemaVersion: typeof MARKETPLACE_CATALOG_SCHEMA_VERSION;
  readonly catalogVersion: typeof MARKETPLACE_CATALOG_VERSION;
  readonly generatedAt: string;
  readonly source: MarketplaceCatalogSource;
  readonly packages: readonly MarketplacePackage[];
}

export interface MarketplaceCatalogMetadataPackage {
  readonly identity: Omit<MarketplacePackageIdentity, 'packageKey'>;
  readonly displayName: string;
  readonly summary: string;
  readonly publisher: string;
  readonly category: string;
  readonly minimumDesktopVersion: string;
  readonly maximumDesktopVersion?: string;
}

export interface MarketplaceCatalogMetadataEnvelope {
  readonly schemaVersion: typeof MARKETPLACE_CATALOG_SCHEMA_VERSION;
  readonly catalogVersion: typeof MARKETPLACE_CATALOG_VERSION;
  readonly generatedAt: string;
  readonly source: Extract<MarketplaceCatalogSourceKind, 'remote' | 'cached'>;
  readonly packages: readonly MarketplaceCatalogMetadataPackage[];
}

export interface MarketplaceInstallScope {
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceInstanceId: string;
}

export interface MarketplaceInstallPlanCapability {
  readonly capabilityId: string;
  readonly requiredPermission: string;
  readonly trustZone: Extract<TrustZone, 'extension_package'>;
  readonly dataClassifications: readonly DataClassification[];
  readonly sideEffects: readonly CapabilitySideEffect[];
  readonly permissionRisk: CapabilityPermissionRisk;
}

export interface MarketplaceInstallPlan {
  readonly schemaVersion: typeof MARKETPLACE_INSTALL_PLAN_SCHEMA_VERSION;
  readonly planVersion: typeof MARKETPLACE_INSTALL_PLAN_VERSION;
  readonly planId: string;
  readonly plannedAt: string;
  readonly packageIdentity: MarketplacePackageIdentity;
  readonly packageId: string;
  readonly registryVersion: string;
  readonly registryDigest: string;
  readonly scope: MarketplaceInstallScope;
  readonly requestedPermissions: readonly string[];
  readonly dataClassifications: readonly DataClassification[];
  readonly sideEffects: readonly CapabilitySideEffect[];
  readonly capabilities: readonly MarketplaceInstallPlanCapability[];
  readonly requiresApproval: boolean;
  readonly effect: 'plan_only';
}

export type MarketplaceCatalogProvenance =
  | {
      readonly boundary: 'host_validated';
      readonly expectedRegistryDigest: string;
    }
  | {
      readonly boundary: 'demo';
    };

export type MarketplaceValidationCode =
  | 'INVALID_CATALOG'
  | 'INVALID_INSTALL_PLAN'
  | 'INVALID_VALUE'
  | 'UNKNOWN_FIELD'
  | 'UNSUPPORTED_VERSION'
  | 'DUPLICATE_PACKAGE'
  | 'DUPLICATE_CAPABILITY'
  | 'RAW_SECRET'
  | 'UNTRUSTED_METADATA'
  | 'UNSIGNED_PACKAGE'
  | 'INCOMPATIBLE_PACKAGE'
  | 'ALREADY_INSTALLED'
  | 'AMBIGUOUS_SCOPE'
  | 'PERMISSION_WIDENING';

export interface MarketplaceValidationIssue {
  readonly code: MarketplaceValidationCode;
  readonly path: string;
  readonly message: string;
}

export class MarketplaceValidationError extends Error {
  constructor(readonly issues: readonly MarketplaceValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join('; '));
    this.name = 'MarketplaceValidationError';
  }
}
