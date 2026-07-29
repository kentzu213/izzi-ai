import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_ADAPTER_VERSION,
  CAPABILITY_REGISTRY_SCHEMA_VERSION,
  CAPABILITY_REGISTRY_VERSION,
  canonicalCapabilityPayload,
  canonicalCapabilityRegistryPayload,
  type CapabilityManifestEnvelope,
  type CapabilityPolicy,
  type CapabilityRegistrySnapshot,
} from '../../shared/capabilities';
import {
  asId,
  canonicalJson,
  secretRef,
  type IntegrationGrant,
} from '../../shared/personal-office';
import { evaluateApprovalValidity } from '../work/work-approvals';
import { computeActionHash } from '../work/work-hash';
import type {
  WorkActionBinding,
  WorkApproval,
} from '../work/work-types';
import { DEFAULT_CAPABILITY_POLICIES } from './policy-catalog';
import {
  CapabilityRegistryError,
  buildCapabilityRegistry,
  capabilityGrantScopes,
  evaluateCapabilityInvocation,
  type CapabilityGrantResolver,
  type CapabilityGrantScope,
  type CapabilityInvocationRequest,
  verifyCapabilityRegistryAudit,
} from './registry';
import { buildCapabilityApprovalRequest } from './work-approval-adapter';

function manifestEnvelope(
  name: string,
  declaration: CapabilityManifestEnvelope['declarations'][number],
): CapabilityManifestEnvelope {
  return {
    schemaVersion: CAPABILITY_REGISTRY_SCHEMA_VERSION,
    source: {
      kind: declaration.kind === 'tool' ? 'agent_bundle' : 'ocx_extension',
      manifestName: name,
      manifestVersion: '1.0.0',
      observedAt: '2026-07-29T08:00:00.000Z',
      adapterVersion: CAPABILITY_ADAPTER_VERSION,
    },
    package: {
      displayName: name,
      description: `${name} capability package.`,
    },
    declarations: [declaration],
    unsupportedDeclarations: [],
  };
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function recomputePublicAuditHashes(
  snapshot: CapabilityRegistrySnapshot,
): CapabilityRegistrySnapshot {
  const mutable = snapshot as unknown as {
    auditDigest: string;
    capabilities: Array<Record<string, unknown> & { auditFingerprint: string }>;
  };
  for (const capability of mutable.capabilities) {
    const { auditFingerprint: _ignored, ...unsignedCapability } = capability;
    capability.auditFingerprint = sha256(canonicalCapabilityPayload(
      unsignedCapability as Parameters<typeof canonicalCapabilityPayload>[0],
    ));
  }
  const { auditDigest: _ignored, ...unsignedSnapshot } = mutable;
  mutable.auditDigest = sha256(canonicalCapabilityRegistryPayload(
    unsignedSnapshot as Parameters<typeof canonicalCapabilityRegistryPayload>[0],
  ));
  return snapshot;
}

const EVALUATED_AT = '2026-07-29T08:00:00.000Z';

function invocationRequest(
  capabilityId: string,
  overrides: Partial<CapabilityInvocationRequest> = {},
): CapabilityInvocationRequest {
  return {
    capabilityId,
    tenantId: 'tenant-acme',
    userId: 'user-owner',
    workspaceInstanceId: 'workspace-primary',
    evaluatedAt: EVALUATED_AT,
    dataClassifications: ['public_metadata'],
    ...overrides,
  };
}

function acceptedGrant(
  scope: CapabilityGrantScope,
  overrides: Partial<IntegrationGrant> = {},
): IntegrationGrant {
  const scopes = capabilityGrantScopes(scope);
  return {
    schemaVersion: 1,
    id: asId<'IntegrationGrantId'>('grant-web-agent'),
    workspaceInstanceId: asId<'WorkspaceInstanceId'>(scope.workspaceInstanceId),
    integration: scope.packageId,
    scopes,
    secret: secretRef(
      'integration_vault',
      'integration/web-agent/credential',
      scopes,
    ),
    createdAt: '2026-07-29T07:00:00.000Z',
    updatedAt: '2026-07-29T07:00:00.000Z',
    expiresAt: '2026-07-29T09:00:00.000Z',
    ...overrides,
  };
}

function approvalBinding(
  request: ReturnType<typeof buildCapabilityApprovalRequest>,
): WorkActionBinding {
  return {
    target: request.target,
    input: request.input,
    artifactId: null,
    artifactVersion: null,
    estimatedSideEffect: request.estimatedSideEffect,
    idempotencyKey: request.idempotencyKey ?? 'approval-idempotency',
    expiresAt: '2026-07-29T09:00:00.000Z',
    planHash: 'plan-hash',
    contextSnapshotId: null,
  };
}

describe('capability registry determinism and audit', () => {
  it('produces the same sorted snapshot and digest regardless of input order', () => {
    const web = manifestEnvelope('web-agent', {
      kind: 'tool',
      key: 'web',
      manifestPath: 'agent.tools[0]',
    });
    const panel = manifestEnvelope('panel-app', {
      kind: 'permission',
      key: 'ui.panel',
      manifestPath: 'permissions[0]',
    });

    const left = buildCapabilityRegistry([web, panel]);
    const right = buildCapabilityRegistry([panel, web]);

    expect(left).toEqual(right);
    expect(left.auditDigest).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(left.capabilities.every((item) => (
      /^sha256:[a-f0-9]{64}$/.test(item.auditFingerprint)
    ))).toBe(true);
    expect(left.capabilities.map((item) => item.tool.id)).toEqual(
      [...left.capabilities.map((item) => item.tool.id)].sort(),
    );
    expect(Object.isFrozen(left)).toBe(true);
    expect(verifyCapabilityRegistryAudit(left)).toBe(true);
  });

  it('composes accepted SkillPackage and ToolDefinition entities', () => {
    const snapshot = buildCapabilityRegistry([
      manifestEnvelope('web-agent', {
        kind: 'tool',
        key: 'web',
        manifestPath: 'agent.tools[0]',
      }),
    ]);

    expect(snapshot.packages[0]?.skillPackage).toMatchObject({
      schemaVersion: 1,
      name: 'web-agent',
      packageVersion: '1.0.0',
      requestedPermissions: ['net.http'],
      classification: 'public_metadata',
    });
    expect(snapshot.capabilities[0]).toMatchObject({
      trustZone: 'extension_package',
      dataClassifications: ['public_metadata'],
      sideEffects: ['external_action', 'network_egress'],
      tool: {
        schemaVersion: 1,
        requiredPermission: 'net.http',
        hasExternalEffect: true,
        classification: 'public_metadata',
      },
    });
  });
});

describe('capability registry fail-closed behavior', () => {
  it('rejects unknown, blocked and unsupported declarations', () => {
    expect(() => buildCapabilityRegistry([
      manifestEnvelope('unknown-agent', {
        kind: 'tool',
        key: 'world-control',
        manifestPath: 'agent.tools[0]',
      }),
    ])).toThrowError(CapabilityRegistryError);

    expect(() => buildCapabilityRegistry([
      manifestEnvelope('terminal-agent', {
        kind: 'tool',
        key: 'terminal',
        manifestPath: 'agent.tools[0]',
      }),
    ])).toThrow(/lacks command, path and environment scopes/);

    expect(() => buildCapabilityRegistry([{
      ...manifestEnvelope('scheduled-agent', {
        kind: 'tool',
        key: 'web',
        manifestPath: 'agent.tools[0]',
      }),
      unsupportedDeclarations: [{
        manifestPath: 'automation.cronJobs[0]',
        reason: 'No scheduled-execution policy.',
      }],
    }])).toThrow(/unsupported capability declarations/);
  });

  it('rejects duplicate packages and wildcard trusted policies', () => {
    const web = manifestEnvelope('web-agent', {
      kind: 'tool',
      key: 'web',
      manifestPath: 'agent.tools[0]',
    });
    expect(() => buildCapabilityRegistry([web, web])).toThrow(/Duplicate package/);

    const wildcardPolicy: CapabilityPolicy = {
      ...DEFAULT_CAPABILITY_POLICIES[0]!,
      requiredPermission: 'net.*',
    };
    expect(() => buildCapabilityRegistry([web], [wildcardPolicy])).toThrow(/non-wildcard/);
  });
});

describe('capability invocation and Loop 03 approval adapter', () => {
  it('requires an accepted exact-scope grant, constrained classification and approval', () => {
    const snapshot = buildCapabilityRegistry([
      manifestEnvelope('web-agent', {
        kind: 'tool',
        key: 'web',
        manifestPath: 'agent.tools[0]',
      }),
    ]);
    const capability = snapshot.capabilities[0]!;
    const request = invocationRequest(capability.tool.id);
    const grantScope: CapabilityGrantScope = {
      tenantId: request.tenantId,
      userId: request.userId,
      workspaceInstanceId: request.workspaceInstanceId,
      packageId: capability.packageId,
      capabilityId: capability.tool.id,
      requiredPermission: capability.tool.requiredPermission,
    };
    const grant = acceptedGrant(grantScope);
    const wildcardGrant = {
      ...grant,
      scopes: [
        ...grant.scopes.filter((scope) => !scope.startsWith('capability.permission:')),
        'capability.permission:*',
      ],
    };

    expect(evaluateCapabilityInvocation(
      snapshot,
      request,
      () => wildcardGrant,
    )).toMatchObject({ allowed: false, code: 'GRANT_DENIED' });

    expect(evaluateCapabilityInvocation(
      snapshot,
      invocationRequest(capability.tool.id, {
        dataClassifications: ['local_files'],
      }),
      () => grant,
    )).toMatchObject({ allowed: false, code: 'CLASSIFICATION_DENIED' });

    const allowed = evaluateCapabilityInvocation(snapshot, request, () => grant);
    expect(allowed).toMatchObject({ allowed: true, requiresApproval: true });
    if (!allowed.allowed) throw new Error('expected invocation to be allowed');

    expect(buildCapabilityApprovalRequest(snapshot, allowed.capability, {
      runId: 'run-1',
      target: 'https://api.example.test/items',
      input: { method: 'POST' },
      idempotencyKey: 'run-1:web-agent:post',
    })).toMatchObject({
      runId: 'run-1',
      kind: 'host_action',
      risk: 'medium',
      idempotencyKey: 'run-1:web-agent:post',
      blockRun: true,
    });
  });

  it('denies a registry snapshot whose audited authority was changed', () => {
    const snapshot = buildCapabilityRegistry([
      manifestEnvelope('web-agent', {
        kind: 'tool',
        key: 'web',
        manifestPath: 'agent.tools[0]',
      }),
    ]);
    const tampered = structuredClone(snapshot);
    (tampered.capabilities[0]!.tool as { requiredPermission: string })
      .requiredPermission = 'system.shell';

    expect(verifyCapabilityRegistryAudit(tampered)).toBe(false);
    expect(evaluateCapabilityInvocation(
      tampered,
      invocationRequest(tampered.capabilities[0]!.tool.id),
      () => null,
    )).toMatchObject({ allowed: false, code: 'AUDIT_INVALID' });
  });

  it('rejects policy tampering even when every public audit hash is recomputed', () => {
    const snapshot = buildCapabilityRegistry([
      manifestEnvelope('web-agent', {
        kind: 'tool',
        key: 'web',
        manifestPath: 'agent.tools[0]',
      }),
    ]);
    const tampered = structuredClone(snapshot);
    (tampered.capabilities[0]!.tool as { requiredPermission: string })
      .requiredPermission = 'system.shell';
    recomputePublicAuditHashes(tampered);

    const tamperedPolicyIdentity = structuredClone(snapshot);
    (tamperedPolicyIdentity.capabilities[0] as unknown as {
      policyVersion: string;
    }).policyVersion = '2.0.0';
    (tamperedPolicyIdentity.capabilities[0] as unknown as {
      policyFingerprint: string;
    }).policyFingerprint = sha256('forged-policy');
    recomputePublicAuditHashes(tamperedPolicyIdentity);

    expect(verifyCapabilityRegistryAudit(tampered)).toBe(false);
    expect(verifyCapabilityRegistryAudit(tamperedPolicyIdentity)).toBe(false);
    expect(evaluateCapabilityInvocation(
      tampered,
      invocationRequest(tampered.capabilities[0]!.tool.id),
      () => null,
    )).toMatchObject({ allowed: false, code: 'AUDIT_INVALID' });
  });

  it('rejects unsupported registry versions even when every public hash is recomputed', () => {
    const snapshot = buildCapabilityRegistry([
      manifestEnvelope('web-agent', {
        kind: 'tool',
        key: 'web',
        manifestPath: 'agent.tools[0]',
      }),
    ]);
    const tamperedSchema = structuredClone(snapshot);
    (tamperedSchema as unknown as { schemaVersion: number }).schemaVersion = 99;
    (tamperedSchema.capabilities[0] as unknown as { registrySchemaVersion: number })
      .registrySchemaVersion = 99;
    recomputePublicAuditHashes(tamperedSchema);

    const tamperedRegistry = structuredClone(snapshot);
    (tamperedRegistry as unknown as { registryVersion: string }).registryVersion = '99.0.0';
    (tamperedRegistry.capabilities[0] as unknown as { registryVersion: string })
      .registryVersion = '99.0.0';
    recomputePublicAuditHashes(tamperedRegistry);

    expect(CAPABILITY_REGISTRY_VERSION).toBe('1.1.0');
    expect(verifyCapabilityRegistryAudit(tamperedSchema)).toBe(false);
    expect(verifyCapabilityRegistryAudit(tamperedRegistry)).toBe(false);
  });

  it('never authorizes caller-supplied permission strings without a scoped grant', () => {
    const snapshot = buildCapabilityRegistry([
      manifestEnvelope('web-agent', {
        kind: 'tool',
        key: 'web',
        manifestPath: 'agent.tools[0]',
      }),
    ]);

    expect(evaluateCapabilityInvocation(
      snapshot,
      {
        capabilityId: snapshot.capabilities[0]!.tool.id,
        grantedPermissions: ['net.http'],
        dataClassifications: ['public_metadata'],
      } as unknown as CapabilityInvocationRequest,
      undefined as unknown as CapabilityGrantResolver,
    )).toMatchObject({ allowed: false, code: 'GRANT_DENIED' });
  });

  it('denies cross-workspace, cross-tenant and forged grants', () => {
    const snapshot = buildCapabilityRegistry([
      manifestEnvelope('web-agent', {
        kind: 'tool',
        key: 'web',
        manifestPath: 'agent.tools[0]',
      }),
    ]);
    const capability = snapshot.capabilities[0]!;
    const request = invocationRequest(capability.tool.id);
    const scope: CapabilityGrantScope = {
      tenantId: request.tenantId,
      userId: request.userId,
      workspaceInstanceId: request.workspaceInstanceId,
      packageId: capability.packageId,
      capabilityId: capability.tool.id,
      requiredPermission: capability.tool.requiredPermission,
    };
    const grant = acceptedGrant(scope);

    expect(evaluateCapabilityInvocation(
      snapshot,
      invocationRequest(capability.tool.id, {
        workspaceInstanceId: 'workspace-other',
      }),
      () => grant,
    )).toMatchObject({ allowed: false, code: 'GRANT_DENIED' });
    expect(evaluateCapabilityInvocation(
      snapshot,
      invocationRequest(capability.tool.id, {
        tenantId: 'tenant-other',
      }),
      () => grant,
    )).toMatchObject({ allowed: false, code: 'GRANT_DENIED' });
    expect(evaluateCapabilityInvocation(
      snapshot,
      request,
      () => ({
        ...grant,
        schemaVersion: 99,
      } as unknown as IntegrationGrant),
    )).toMatchObject({ allowed: false, code: 'GRANT_DENIED' });
    expect(evaluateCapabilityInvocation(
      snapshot,
      request,
      () => ({
        ...grant,
        integration: 'skill-package:agent_bundle:forged@1.0.0',
      }),
    )).toMatchObject({ allowed: false, code: 'GRANT_DENIED' });
    expect(evaluateCapabilityInvocation(
      snapshot,
      request,
      () => ({
        ...grant,
        secret: 'not-a-secret-reference',
      } as unknown as IntegrationGrant),
    )).toMatchObject({ allowed: false, code: 'GRANT_DENIED' });
  });

  it('binds capability, policy and registry identity into the Loop 03 action hash', () => {
    const snapshot = buildCapabilityRegistry([
      manifestEnvelope('web-agent', {
        kind: 'tool',
        key: 'web',
        manifestPath: 'agent.tools[0]',
      }),
    ]);
    const capability = snapshot.capabilities[0]!;
    const request = buildCapabilityApprovalRequest(snapshot, capability, {
      runId: 'run-1',
      target: 'https://api.example.test/items',
      input: { method: 'POST' },
      idempotencyKey: 'run-1:web-agent:post',
    });

    expect(request.input).toMatchObject({
      capabilityAuthorization: {
        capabilityId: capability.tool.id,
        capabilityFingerprint: capability.auditFingerprint,
        packageId: capability.packageId,
        requiredPermission: capability.tool.requiredPermission,
        policyVersion: capability.policyVersion,
        policyFingerprint: capability.policyFingerprint,
        registryDigest: snapshot.auditDigest,
      },
      invocationInput: { method: 'POST' },
    });

    const originalBinding = approvalBinding(request);
    const originalHash = computeActionHash(originalBinding);
    const changes = {
      capabilityId: 'tool:agent_bundle:web-agent@1.0.0:tool:other',
      requiredPermission: 'system.shell',
      policyVersion: '2.0.0',
      policyFingerprint: sha256('changed-policy'),
      registryDigest: sha256('changed-registry'),
    };
    for (const [field, value] of Object.entries(changes)) {
      const changedRequest = structuredClone(request);
      const changedInput = changedRequest.input as {
        capabilityAuthorization: Record<string, unknown>;
        invocationInput: unknown;
      };
      changedInput.capabilityAuthorization[field] = value;
      changedRequest.estimatedSideEffect = canonicalJson({
        capabilityAuthorization: changedInput.capabilityAuthorization,
        sideEffects: capability.sideEffects,
      });
      const changedBinding = approvalBinding(changedRequest);

      expect(computeActionHash(changedBinding), field).not.toBe(originalHash);
      expect(evaluateApprovalValidity({
        binding: changedBinding,
        actionHash: originalHash,
        expiresAt: changedBinding.expiresAt,
      } as WorkApproval, {
        now: EVALUATED_AT,
        planHash: changedBinding.planHash,
        contextSnapshotId: null,
      }), field).toEqual({ valid: false, reason: 'binding-tampered' });
    }
  });
});
