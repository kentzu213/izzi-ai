/**
 * Personal Office capability registry contracts.
 *
 * These records wrap the accepted Personal Office domain entities instead of
 * defining parallel package/tool models. Manifest-controlled data is kept in a
 * narrow envelope; security policy is supplied separately by the trusted host.
 */

import type {
  DataClassification,
  SkillPackage,
  ToolDefinition,
  TrustZone,
} from '../personal-office';

export const CAPABILITY_REGISTRY_SCHEMA_VERSION = 1 as const;
export type CapabilityRegistrySchemaVersion = 1;

export const CAPABILITY_REGISTRY_VERSION = '1.0.0' as const;
export const CAPABILITY_ADAPTER_VERSION = '1.0.0' as const;

export type CapabilityManifestSourceKind = 'agent_bundle' | 'ocx_extension';
export type CapabilityDeclarationKind = 'tool' | 'permission' | 'runtime';

export interface CapabilityManifestSource {
  readonly kind: CapabilityManifestSourceKind;
  readonly manifestName: string;
  readonly manifestVersion: string;
  /**
   * Install/observation time supplied by the caller. Adapters never call the
   * clock, so the same manifest + context produces byte-identical output.
   */
  readonly observedAt: string;
  readonly adapterVersion: typeof CAPABILITY_ADAPTER_VERSION;
}

export interface CapabilityManifestPackage {
  readonly displayName: string;
  readonly description: string;
  /** Publisher digest only; never a signature, token or credential value. */
  readonly signatureDigest?: string;
}

export interface CapabilityManifestDeclaration {
  readonly kind: CapabilityDeclarationKind;
  /**
   * Untrusted manifest declaration key. It gains no authority until an exact
   * trusted policy entry matches source kind + declaration kind + key.
   */
  readonly key: string;
  readonly manifestPath: string;
}

export interface UnsupportedCapabilityDeclaration {
  readonly manifestPath: string;
  readonly reason: string;
}

/**
 * Versioned adapter boundary. It contains no permissions, classifications,
 * trust decisions or side-effect claims controlled by the package.
 */
export interface CapabilityManifestEnvelope {
  readonly schemaVersion: CapabilityRegistrySchemaVersion;
  readonly source: CapabilityManifestSource;
  readonly package: CapabilityManifestPackage;
  readonly declarations: readonly CapabilityManifestDeclaration[];
  readonly unsupportedDeclarations: readonly UnsupportedCapabilityDeclaration[];
}

export type CapabilityPermissionRisk = 'low' | 'medium' | 'high';

export type CapabilitySideEffect =
  | 'local_read'
  | 'local_write'
  | 'network_egress'
  | 'external_action'
  | 'process_execution'
  | 'secret_access'
  | 'ui_mutation';

export type CapabilityPolicyStatus = 'allowed' | 'blocked';

/**
 * Trusted host policy for exactly one manifest declaration. This is the only
 * place where authority is assigned.
 */
export interface CapabilityPolicy {
  readonly schemaVersion: CapabilityRegistrySchemaVersion;
  readonly policyVersion: string;
  readonly sourceKind: CapabilityManifestSourceKind;
  readonly declarationKind: CapabilityDeclarationKind;
  readonly declarationKey: string;
  readonly requiredPermission: string;
  readonly trustZone: Extract<TrustZone, 'extension_package'>;
  readonly dataClassifications: readonly DataClassification[];
  readonly sideEffects: readonly CapabilitySideEffect[];
  readonly permissionRisk: CapabilityPermissionRisk;
  readonly description: string;
  readonly status: CapabilityPolicyStatus;
  readonly blockedReason?: string;
}

export interface CapabilityPackageRecord {
  readonly source: CapabilityManifestSource;
  /** Accepted domain entity; not redefined by the registry. */
  readonly skillPackage: SkillPackage;
  readonly capabilityIds: readonly string[];
}

export interface RegisteredCapability {
  readonly registrySchemaVersion: CapabilityRegistrySchemaVersion;
  readonly registryVersion: typeof CAPABILITY_REGISTRY_VERSION;
  readonly packageId: string;
  /** Accepted domain entity; permission + external-effect semantics live here. */
  readonly tool: ToolDefinition;
  readonly trustZone: Extract<TrustZone, 'extension_package'>;
  readonly dataClassifications: readonly DataClassification[];
  /** Empty means no side effect. */
  readonly sideEffects: readonly CapabilitySideEffect[];
  readonly permissionRisk: CapabilityPermissionRisk;
  readonly policyVersion: string;
  readonly sourceDeclaration: CapabilityManifestDeclaration;
  /** sha256 over the canonical capability record without this field. */
  readonly auditFingerprint: string;
}

export interface CapabilityRegistrySnapshot {
  readonly schemaVersion: CapabilityRegistrySchemaVersion;
  readonly registryVersion: typeof CAPABILITY_REGISTRY_VERSION;
  readonly packages: readonly CapabilityPackageRecord[];
  readonly capabilities: readonly RegisteredCapability[];
  /** sha256 over the canonical snapshot without this field. */
  readonly auditDigest: string;
}

export type CapabilityDenialCode =
  | 'AUDIT_INVALID'
  | 'UNKNOWN_CAPABILITY'
  | 'MISSING_PERMISSION'
  | 'CLASSIFICATION_DENIED'
  | 'EGRESS_DENIED';

export type CapabilityInvocationDecision =
  | {
      readonly allowed: true;
      readonly capability: RegisteredCapability;
      readonly requiresApproval: boolean;
    }
  | {
      readonly allowed: false;
      readonly code: CapabilityDenialCode;
      readonly reason: string;
    };
