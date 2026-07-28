/**
 * Personal Office OS — trust boundaries & planes.
 *
 * Two planes, six trust zones. The control plane (IzziAPI cloud) owns identity,
 * catalog, billing and the durable audit index; the execution plane (desktop)
 * owns all sensitive data and every action. Everything between zones is a trust
 * boundary that must be crossed through an explicit, least-privilege contract.
 *
 * Pure, dependency-free module — the machine-readable twin of the trust-boundary
 * diagram in docs/architecture/personal-office-os.md.
 *
 * @module shared/personal-office/trust
 */

import type { DataClassification } from './classification';

/** The two planes of the system. */
export type Plane = 'control' | 'execution';

/** The six trust zones the design pins. */
export type TrustZone =
  | 'izziapi_control_plane'
  | 'desktop_execution_plane'
  | 'model_provider'
  | 'extension_package'
  | 'local_runtime'
  | 'browser_runtime';

export interface TrustZoneSpec {
  readonly zone: TrustZone;
  readonly plane: Plane;
  /** Is code/data in this zone trusted by default, or sandboxed/untrusted? */
  readonly trusted: boolean;
  /** May this zone hold the authoritative copy of these classes? */
  readonly mayHoldAuthoritative: readonly DataClassification[];
  readonly note: string;
}

export const TRUST_ZONES: Readonly<Record<TrustZone, TrustZoneSpec>> = Object.freeze({
  izziapi_control_plane: {
    zone: 'izziapi_control_plane',
    plane: 'control',
    trusted: true,
    mayHoldAuthoritative: ['public_metadata'],
    note: 'Cloud: identity, package/blueprint catalog, billing, audit index. Never authoritative for domain state.',
  },
  desktop_execution_plane: {
    zone: 'desktop_execution_plane',
    plane: 'execution',
    trusted: true,
    mayHoldAuthoritative: [
      'personal_graph',
      'local_files',
      'artifacts',
      'secrets',
      'audit_events',
    ],
    note: 'The user machine. Authoritative for all runs, artifacts, secrets and files.',
  },
  model_provider: {
    zone: 'model_provider',
    plane: 'execution',
    trusted: false,
    mayHoldAuthoritative: [],
    note: 'LLM/provider. A capability, not an owner — holds NO durable domain state (design constraint).',
  },
  extension_package: {
    zone: 'extension_package',
    plane: 'execution',
    trusted: false,
    mayHoldAuthoritative: [],
    note: 'Third-party .ocx/.oab code. Sandboxed; acts only through granted permissions + tool definitions.',
  },
  local_runtime: {
    zone: 'local_runtime',
    plane: 'execution',
    trusted: false,
    mayHoldAuthoritative: [],
    note: 'Managed local services (loopback-only containers/processes). Bounded by the izzi-svc- namespace.',
  },
  browser_runtime: {
    zone: 'browser_runtime',
    plane: 'execution',
    trusted: false,
    mayHoldAuthoritative: [],
    note: 'Automated browser sessions. Fully untrusted egress surface; out of scope to implement this loop.',
  },
});

/** A directed edge where data/authority crosses from one zone to another. */
export interface TrustBoundaryCrossing {
  readonly from: TrustZone;
  readonly to: TrustZone;
  /** The contract that governs the crossing (grant, ref, redacted event, etc.). */
  readonly via: string;
}

/** The sanctioned crossings. Anything not listed here is disallowed by default. */
export const TRUST_BOUNDARY_CROSSINGS: readonly TrustBoundaryCrossing[] = Object.freeze([
  {
    from: 'desktop_execution_plane',
    to: 'izziapi_control_plane',
    via: 'redacted audit metadata + public catalog sync (egress rules apply)',
  },
  {
    from: 'izziapi_control_plane',
    to: 'desktop_execution_plane',
    via: 'signed blueprint/package descriptors + identity/billing tokens (SecretRef)',
  },
  {
    from: 'desktop_execution_plane',
    to: 'model_provider',
    via: 'prompt/context payload (classification-filtered, no secrets)',
  },
  {
    from: 'desktop_execution_plane',
    to: 'extension_package',
    via: 'IntegrationGrant + ToolDefinition invocation (least privilege)',
  },
  {
    from: 'extension_package',
    to: 'local_runtime',
    via: 'managed service spec (izzi-svc- namespace, loopback bind)',
  },
  {
    from: 'extension_package',
    to: 'browser_runtime',
    via: 'browser action request (approval-gated; not implemented this loop)',
  },
]);

/** True when a crossing is explicitly sanctioned. Default-deny for everything else. */
export function isSanctionedCrossing(from: TrustZone, to: TrustZone): boolean {
  return TRUST_BOUNDARY_CROSSINGS.some((c) => c.from === from && c.to === to);
}
