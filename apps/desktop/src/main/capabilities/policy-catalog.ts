import {
  CAPABILITY_REGISTRY_SCHEMA_VERSION,
  type CapabilityManifestSourceKind,
  type CapabilityPolicy,
  type CapabilitySideEffect,
  type CapabilityDeclarationKind,
  type CapabilityPermissionRisk,
} from '../../shared/capabilities';
import type { DataClassification } from '../../shared/personal-office';

const POLICY_VERSION = '1.0.0';

interface PolicyInput {
  readonly sourceKind: CapabilityManifestSourceKind;
  readonly declarationKind: CapabilityDeclarationKind;
  readonly declarationKey: string;
  readonly requiredPermission: string;
  readonly dataClassifications: readonly DataClassification[];
  readonly sideEffects: readonly CapabilitySideEffect[];
  readonly permissionRisk: CapabilityPermissionRisk;
  readonly description: string;
  readonly status?: 'allowed' | 'blocked';
  readonly blockedReason?: string;
}

function policy(input: PolicyInput): CapabilityPolicy {
  return Object.freeze({
    schemaVersion: CAPABILITY_REGISTRY_SCHEMA_VERSION,
    policyVersion: POLICY_VERSION,
    sourceKind: input.sourceKind,
    declarationKind: input.declarationKind,
    declarationKey: input.declarationKey,
    requiredPermission: input.requiredPermission,
    trustZone: 'extension_package',
    dataClassifications: Object.freeze([...input.dataClassifications].sort()),
    sideEffects: Object.freeze([...input.sideEffects].sort()),
    permissionRisk: input.permissionRisk,
    description: input.description,
    status: input.status ?? 'allowed',
    ...(input.blockedReason ? { blockedReason: input.blockedReason } : {}),
  });
}

/**
 * Built-in host policy. Exact keys only; manifest wildcards never reach this
 * catalog. High-ambient-authority declarations remain visible but blocked so
 * audits distinguish "known unsafe" from "unknown".
 */
export const DEFAULT_CAPABILITY_POLICIES: readonly CapabilityPolicy[] = Object.freeze([
  policy({
    sourceKind: 'agent_bundle',
    declarationKind: 'tool',
    declarationKey: 'web',
    requiredPermission: 'net.http',
    dataClassifications: ['public_metadata'],
    sideEffects: ['external_action', 'network_egress'],
    permissionRisk: 'medium',
    description: 'Make host-mediated HTTP requests using public metadata only.',
  }),
  policy({
    sourceKind: 'agent_bundle',
    declarationKind: 'tool',
    declarationKey: 'browser',
    requiredPermission: 'browser.automation',
    dataClassifications: ['public_metadata'],
    sideEffects: ['external_action', 'network_egress'],
    permissionRisk: 'high',
    description: 'Drive an automated browser runtime.',
    status: 'blocked',
    blockedReason: 'Browser automation is declared but not implemented by ADR-PO-004.',
  }),
  policy({
    sourceKind: 'agent_bundle',
    declarationKind: 'tool',
    declarationKey: 'terminal',
    requiredPermission: 'system.shell',
    dataClassifications: ['local_files', 'secrets'],
    sideEffects: ['local_read', 'local_write', 'process_execution', 'secret_access'],
    permissionRisk: 'high',
    description: 'Execute arbitrary shell commands.',
    status: 'blocked',
    blockedReason: 'The broad terminal declaration lacks command, path and environment scopes.',
  }),
  policy({
    sourceKind: 'ocx_extension',
    declarationKind: 'permission',
    declarationKey: 'net.http',
    requiredPermission: 'net.http',
    dataClassifications: ['public_metadata'],
    sideEffects: ['external_action', 'network_egress'],
    permissionRisk: 'medium',
    description: 'Make host-mediated HTTP requests using public metadata only.',
  }),
  policy({
    sourceKind: 'ocx_extension',
    declarationKind: 'permission',
    declarationKey: 'net.websocket',
    requiredPermission: 'net.websocket',
    dataClassifications: ['public_metadata'],
    sideEffects: ['external_action', 'network_egress'],
    permissionRisk: 'medium',
    description: 'Open host-mediated WebSocket connections using public metadata only.',
  }),
  policy({
    sourceKind: 'ocx_extension',
    declarationKind: 'permission',
    declarationKey: 'storage.local',
    requiredPermission: 'storage.local',
    dataClassifications: ['local_files'],
    sideEffects: ['local_write'],
    permissionRisk: 'low',
    description: 'Write extension-scoped local storage.',
  }),
  policy({
    sourceKind: 'ocx_extension',
    declarationKind: 'permission',
    declarationKey: 'ui.dialog',
    requiredPermission: 'ui.dialog',
    dataClassifications: ['public_metadata'],
    sideEffects: ['ui_mutation'],
    permissionRisk: 'low',
    description: 'Present a host-owned dialog.',
  }),
  policy({
    sourceKind: 'ocx_extension',
    declarationKind: 'permission',
    declarationKey: 'ui.notification',
    requiredPermission: 'ui.notification',
    dataClassifications: ['public_metadata'],
    sideEffects: ['ui_mutation'],
    permissionRisk: 'low',
    description: 'Present a host-owned notification.',
  }),
  policy({
    sourceKind: 'ocx_extension',
    declarationKind: 'permission',
    declarationKey: 'ui.panel',
    requiredPermission: 'ui.panel',
    dataClassifications: ['public_metadata'],
    sideEffects: ['ui_mutation'],
    permissionRisk: 'low',
    description: 'Register an extension panel through the host UI boundary.',
  }),
  policy({
    sourceKind: 'ocx_extension',
    declarationKind: 'runtime',
    declarationKey: 'managed_local_service',
    requiredPermission: 'runtime.local_service',
    dataClassifications: ['local_files', 'secrets'],
    sideEffects: ['local_write', 'process_execution', 'secret_access'],
    permissionRisk: 'high',
    description: 'Start a validated loopback-only managed local service.',
  }),
  policy({
    sourceKind: 'ocx_extension',
    declarationKind: 'permission',
    declarationKey: 'fs.read',
    requiredPermission: 'fs.read',
    dataClassifications: ['local_files'],
    sideEffects: ['local_read'],
    permissionRisk: 'medium',
    description: 'Read files from the user machine.',
    status: 'blocked',
    blockedReason: 'The manifest permission has no path scope.',
  }),
  policy({
    sourceKind: 'ocx_extension',
    declarationKind: 'permission',
    declarationKey: 'fs.write',
    requiredPermission: 'fs.write',
    dataClassifications: ['local_files'],
    sideEffects: ['local_write'],
    permissionRisk: 'high',
    description: 'Write files on the user machine.',
    status: 'blocked',
    blockedReason: 'The manifest permission has no path scope.',
  }),
  policy({
    sourceKind: 'ocx_extension',
    declarationKind: 'permission',
    declarationKey: 'clipboard.read',
    requiredPermission: 'clipboard.read',
    dataClassifications: ['local_files', 'secrets'],
    sideEffects: ['local_read', 'secret_access'],
    permissionRisk: 'high',
    description: 'Read unclassified clipboard content.',
    status: 'blocked',
    blockedReason: 'Clipboard data has no enforceable classification boundary.',
  }),
  policy({
    sourceKind: 'ocx_extension',
    declarationKind: 'permission',
    declarationKey: 'clipboard.write',
    requiredPermission: 'clipboard.write',
    dataClassifications: ['local_files'],
    sideEffects: ['local_write'],
    permissionRisk: 'medium',
    description: 'Write clipboard content.',
    status: 'blocked',
    blockedReason: 'Clipboard writes need an explicit user-action scope.',
  }),
  policy({
    sourceKind: 'ocx_extension',
    declarationKind: 'permission',
    declarationKey: 'storage.secrets',
    requiredPermission: 'storage.secrets',
    dataClassifications: ['secrets'],
    sideEffects: ['local_write', 'secret_access'],
    permissionRisk: 'medium',
    description: 'Access host-managed secret storage.',
    status: 'blocked',
    blockedReason: 'Packages must use IntegrationGrant + SecretRef instead of ambient secret access.',
  }),
  policy({
    sourceKind: 'ocx_extension',
    declarationKind: 'permission',
    declarationKey: 'system.env',
    requiredPermission: 'system.env',
    dataClassifications: ['secrets'],
    sideEffects: ['secret_access'],
    permissionRisk: 'high',
    description: 'Read process environment variables.',
    status: 'blocked',
    blockedReason: 'Ambient environment access can expose unrelated credentials.',
  }),
  policy({
    sourceKind: 'ocx_extension',
    declarationKind: 'permission',
    declarationKey: 'system.shell',
    requiredPermission: 'system.shell',
    dataClassifications: ['local_files', 'secrets'],
    sideEffects: ['local_read', 'local_write', 'process_execution', 'secret_access'],
    permissionRisk: 'high',
    description: 'Execute shell commands.',
    status: 'blocked',
    blockedReason: 'The manifest permission has no command, path or environment scope.',
  }),
]);
