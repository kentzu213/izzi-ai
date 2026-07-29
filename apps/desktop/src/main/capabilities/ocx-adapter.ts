import {
  CAPABILITY_ADAPTER_VERSION,
  CAPABILITY_REGISTRY_SCHEMA_VERSION,
  type CapabilityManifestEnvelope,
} from '../../shared/capabilities';
import {
  validateManifest,
  type OcxManifest,
} from '../extensions/ocx-manifest';
import { validatePermissions } from '../extensions/permissions';

export interface OcxCapabilityAdapterContext {
  readonly observedAt: string;
  readonly signatureDigest?: string;
}

export type OcxCapabilityAdapterErrorCode =
  | 'INVALID_MANIFEST'
  | 'INVALID_CONTEXT'
  | 'DUPLICATE_PERMISSION'
  | 'UNKNOWN_PERMISSION'
  | 'OVER_PRIVILEGED_PERMISSION'
  | 'MISSING_REQUIRED_PERMISSION';

export class OcxCapabilityAdapterError extends Error {
  constructor(
    readonly code: OcxCapabilityAdapterErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'OcxCapabilityAdapterError';
  }
}

function assertContext(context: OcxCapabilityAdapterContext): void {
  const parsed = new Date(context.observedAt);
  if (
    Number.isNaN(parsed.getTime())
    || parsed.toISOString() !== context.observedAt
  ) {
    throw new OcxCapabilityAdapterError(
      'INVALID_CONTEXT',
      'observedAt must be an exact ISO-8601 UTC timestamp',
    );
  }
}

function findDuplicate(values: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return null;
}

/** Adapt an .ocx manifest without granting any permission named by it. */
export function adaptOcxManifestToCapabilityEnvelope(
  manifest: OcxManifest,
  context: OcxCapabilityAdapterContext,
): CapabilityManifestEnvelope {
  assertContext(context);
  const validation = validateManifest(manifest);
  if (!validation.valid) {
    throw new OcxCapabilityAdapterError(
      'INVALID_MANIFEST',
      validation.errors.join('; '),
    );
  }
  if (!manifest.permissions.every((permission) => typeof permission === 'string')) {
    throw new OcxCapabilityAdapterError(
      'INVALID_MANIFEST',
      'Every permission must be a string',
    );
  }

  const duplicatePermission = findDuplicate(manifest.permissions);
  if (duplicatePermission) {
    throw new OcxCapabilityAdapterError(
      'DUPLICATE_PERMISSION',
      `Duplicate permission: ${duplicatePermission}`,
    );
  }
  const wildcard = manifest.permissions.find((permission) => permission.includes('*'));
  if (wildcard) {
    throw new OcxCapabilityAdapterError(
      'OVER_PRIVILEGED_PERMISSION',
      `Wildcard permission is forbidden: ${wildcard}`,
    );
  }
  const permissionValidation = validatePermissions(manifest.permissions);
  if (!permissionValidation.valid) {
    throw new OcxCapabilityAdapterError(
      'UNKNOWN_PERMISSION',
      `Unknown permissions: ${permissionValidation.unknown.sort().join(', ')}`,
    );
  }

  if (
    (manifest.contributes.panels?.length ?? 0) > 0
    && !manifest.permissions.includes('ui.panel')
  ) {
    throw new OcxCapabilityAdapterError(
      'MISSING_REQUIRED_PERMISSION',
      'contributes.panels requires ui.panel',
    );
  }
  if (manifest.service && !manifest.permissions.includes('net.http')) {
    throw new OcxCapabilityAdapterError(
      'MISSING_REQUIRED_PERMISSION',
      'A managed local service requires net.http for host-mediated loopback access',
    );
  }

  const declarations: CapabilityManifestEnvelope['declarations'][number][] =
    manifest.permissions.map((permission, index) => Object.freeze({
      kind: 'permission',
      key: permission,
      manifestPath: `permissions[${index}]`,
    }));
  if (manifest.service) {
    declarations.push(Object.freeze({
      kind: 'runtime',
      key: 'managed_local_service',
      manifestPath: 'service',
    }));
  }
  declarations.sort((left, right) => (
    `${left.kind}\0${left.key}\0${left.manifestPath}`
      .localeCompare(`${right.kind}\0${right.key}\0${right.manifestPath}`)
  ));

  return Object.freeze({
    schemaVersion: CAPABILITY_REGISTRY_SCHEMA_VERSION,
    source: Object.freeze({
      kind: 'ocx_extension',
      manifestName: manifest.name,
      manifestVersion: manifest.version,
      observedAt: context.observedAt,
      adapterVersion: CAPABILITY_ADAPTER_VERSION,
    }),
    package: Object.freeze({
      displayName: manifest.displayName,
      description: manifest.description,
      ...(context.signatureDigest
        ? { signatureDigest: context.signatureDigest }
        : {}),
    }),
    declarations: Object.freeze(declarations),
    unsupportedDeclarations: Object.freeze([]),
  });
}
