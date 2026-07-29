import { describe, expect, it } from 'vitest';
import {
  CAPABILITY_ADAPTER_VERSION,
  CAPABILITY_REGISTRY_SCHEMA_VERSION,
  type CapabilityManifestEnvelope,
  type CapabilityPolicy,
} from '../../shared/capabilities';
import { DEFAULT_CAPABILITY_POLICIES } from './policy-catalog';
import {
  CapabilityRegistryError,
  buildCapabilityRegistry,
  evaluateCapabilityInvocation,
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
  it('requires an exact grant, constrained classification and approval', () => {
    const snapshot = buildCapabilityRegistry([
      manifestEnvelope('web-agent', {
        kind: 'tool',
        key: 'web',
        manifestPath: 'agent.tools[0]',
      }),
    ]);
    const capabilityId = snapshot.capabilities[0]!.tool.id;

    expect(evaluateCapabilityInvocation(snapshot, {
      capabilityId,
      grantedPermissions: ['net.*'],
      dataClassifications: ['public_metadata'],
    })).toMatchObject({ allowed: false, code: 'MISSING_PERMISSION' });

    expect(evaluateCapabilityInvocation(snapshot, {
      capabilityId,
      grantedPermissions: ['net.http'],
      dataClassifications: ['local_files'],
    })).toMatchObject({ allowed: false, code: 'CLASSIFICATION_DENIED' });

    const allowed = evaluateCapabilityInvocation(snapshot, {
      capabilityId,
      grantedPermissions: ['net.http'],
      dataClassifications: ['public_metadata'],
    });
    expect(allowed).toMatchObject({ allowed: true, requiresApproval: true });
    if (!allowed.allowed) throw new Error('expected invocation to be allowed');

    expect(buildCapabilityApprovalRequest(allowed.capability, {
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
    expect(evaluateCapabilityInvocation(tampered, {
      capabilityId: tampered.capabilities[0]!.tool.id,
      grantedPermissions: ['system.shell'],
      dataClassifications: ['public_metadata'],
    })).toMatchObject({ allowed: false, code: 'AUDIT_INVALID' });
  });
});
