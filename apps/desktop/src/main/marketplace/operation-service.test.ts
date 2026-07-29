import { describe, expect, it, vi } from 'vitest';
import {
  CAPABILITY_ADAPTER_VERSION,
  CAPABILITY_REGISTRY_SCHEMA_VERSION,
} from '../../shared/capabilities';
import {
  MARKETPLACE_CATALOG_SCHEMA_VERSION,
  MARKETPLACE_CATALOG_VERSION,
  type MarketplaceInstallPlan,
} from '../../shared/marketplace';
import { buildCapabilityRegistry } from '../capabilities/registry';
import {
  MarketplaceOperationError,
  MarketplaceOperationService,
  type MarketplaceApprovalPort,
  type MarketplaceOperationServiceOptions,
} from './operation-service';

const SIGNATURE = `sha256:${'c'.repeat(64)}`;
const PACKAGE_DIGEST = `sha256:${'d'.repeat(64)}`;
const GRANT_DIGEST = `sha256:${'e'.repeat(64)}`;
const PROVISION_DIGEST = `sha256:${'f'.repeat(64)}`;
const INSTALL_DIGEST = `sha256:${'a'.repeat(64)}`;
const NOW = '2026-07-29T23:55:00.000Z';

function registry() {
  return buildCapabilityRegistry([{
    schemaVersion: CAPABILITY_REGISTRY_SCHEMA_VERSION,
    source: {
      kind: 'ocx_extension',
      manifestName: 'reviewed-package',
      manifestVersion: '1.2.3',
      observedAt: '2026-07-29T22:00:00.000Z',
      adapterVersion: CAPABILITY_ADAPTER_VERSION,
    },
    package: {
      displayName: 'Reviewed package',
      description: 'A registry-backed package.',
      signatureDigest: SIGNATURE,
    },
    declarations: [{
      kind: 'permission',
      key: 'net.http',
      manifestPath: 'permissions[0]',
    }],
    unsupportedDeclarations: [],
  }]);
}

function metadata() {
  return {
    schemaVersion: MARKETPLACE_CATALOG_SCHEMA_VERSION,
    catalogVersion: MARKETPLACE_CATALOG_VERSION,
    generatedAt: '2026-07-29T22:05:00.000Z',
    source: 'cached',
    packages: [{
      identity: {
        sourceKind: 'ocx_extension',
        packageName: 'reviewed-package',
        packageVersion: '1.2.3',
      },
      displayName: 'Reviewed package',
      summary: 'A package whose authority comes from the host registry.',
      publisher: 'Verified publisher',
      category: 'Operations',
      minimumDesktopVersion: '1.14.0-beta.1',
    }],
  };
}

function approvalPort(
  initial: 'pending' | 'approved' | 'rejected' = 'pending',
): MarketplaceApprovalPort & { state: typeof initial } {
  let bindingDigest = '';
  const port = {
    state: initial,
    request: vi.fn(async (input: { bindingDigest: string }) => {
      bindingDigest = input.bindingDigest;
      return {
        approvalId: 'approval:marketplace-1',
        state: port.state,
        bindingDigest,
      };
    }),
    get: vi.fn(async () => ({
      approvalId: 'approval:marketplace-1',
      state: port.state,
      bindingDigest,
    })),
  };
  return port;
}

function setup(approvalState: 'pending' | 'approved' | 'rejected' = 'pending') {
  const approvals = approvalPort(approvalState);
  const options: MarketplaceOperationServiceOptions = {
    catalogAuthority: {
      load: vi.fn(async () => ({
        metadata: metadata(),
        registry: registry(),
        desktopVersion: '1.14.0-beta.3',
        connection: 'offline',
        retrievedAt: '2026-07-29T22:06:00.000Z',
      })),
    },
    identityAuthority: {
      resolveScope: vi.fn(async () => ({
        tenantId: 'tenant:account',
        userId: 'reviewer:opaque',
        workspaceInstanceId: 'personal',
      })),
    },
    packageVerifier: {
      verify: vi.fn(async () => ({
        packageKey: 'ocx_extension:reviewed-package@1.2.3',
        packageDigest: PACKAGE_DIGEST,
        publisherSignatureDigest: SIGNATURE,
        signatureVerified: true,
        packageHandle: Object.freeze({ handle: 'opaque-test-handle' }),
      })),
    },
    approvals,
    grants: {
      resolve: vi.fn(async () => ({
        status: 'resolved',
        evidenceDigest: GRANT_DIGEST,
      })),
    },
    provisioner: {
      provision: vi.fn(async () => ({
        status: 'provisioned',
        workspaceInstanceId: 'personal',
        evidenceDigest: PROVISION_DIGEST,
      })),
    },
    installer: {
      install: vi.fn(async () => ({
        status: 'installed',
        installedPackageKey: 'ocx_extension:reviewed-package@1.2.3',
        evidenceDigest: INSTALL_DIGEST,
      })),
    },
    now: () => new Date(NOW),
  };
  return { service: new MarketplaceOperationService(options), options, approvals };
}

async function plan(service: MarketplaceOperationService): Promise<MarketplaceInstallPlan> {
  return service.createPlan('ocx_extension:reviewed-package@1.2.3');
}

describe('MarketplaceOperationService', () => {
  it('loads only a host-validated catalog and derives plan scope in main', async () => {
    const { service } = setup();
    const catalog = await service.loadCatalog();
    expect(catalog.source.kind).toBe('cached');
    expect(catalog.packages[0].verification).toBe('host_verified');
    expect(await plan(service)).toMatchObject({
      scope: {
        tenantId: 'tenant:account',
        userId: 'reviewer:opaque',
        workspaceInstanceId: 'personal',
      },
      effect: 'plan_only',
    });
  });

  it('returns approval-pending truth and executes no later port', async () => {
    const { service, options } = setup('pending');
    const receipt = await service.requestInstall(await plan(service));
    expect(receipt.status).toBe('awaiting_approval');
    expect(receipt.stages.map((item) => item.stage)).toEqual([
      'plan_revalidation',
      'package_verification',
      'work_approval',
    ]);
    expect(options.grants.resolve).not.toHaveBeenCalled();
    expect(options.provisioner.provision).not.toHaveBeenCalled();
    expect(options.installer.install).not.toHaveBeenCalled();
  });

  it('resumes only after the exact approval binding is approved', async () => {
    const { service, approvals, options } = setup('pending');
    const installPlan = await plan(service);
    const first = await service.requestInstall(installPlan);
    approvals.state = 'approved';
    const receipt = await service.resumeInstall(installPlan, first.approvalId!);
    expect(receipt.status).toBe('completed');
    expect(receipt.installedPackageKey).toBe(
      'ocx_extension:reviewed-package@1.2.3',
    );
    expect(options.grants.resolve).toHaveBeenCalledTimes(1);
    expect(options.provisioner.provision).toHaveBeenCalledTimes(1);
    expect(options.installer.install).toHaveBeenCalledTimes(1);
  });

  it('rejects an approval record whose id does not match the resume request', async () => {
    const { service, approvals, options } = setup('pending');
    const installPlan = await plan(service);
    const approval = await service.requestInstall(installPlan);
    vi.mocked(approvals.get).mockResolvedValueOnce({
      approvalId: 'approval:other-operation',
      state: 'approved',
      bindingDigest: 'sha256:wrong',
    });

    const receipt = await service.resumeInstall(installPlan, approval.approvalId!);

    expect(receipt.status).toBe('failed');
    expect(receipt.stages.at(-1)).toMatchObject({
      stage: 'work_approval',
      outcome: 'failed',
      code: 'APPROVAL_BINDING_MISMATCH',
    });
    expect(options.grants.resolve).not.toHaveBeenCalled();
  });

  it('stops after a missing grant and reports no provisioning/install success', async () => {
    const { service, options } = setup('approved');
    vi.mocked(options.grants.resolve).mockResolvedValue({
      status: 'missing',
      code: 'REQUIRED_GRANT_MISSING',
    });
    const receipt = await service.requestInstall(await plan(service));
    expect(receipt.status).toBe('blocked');
    expect(receipt.stages.at(-1)).toMatchObject({
      stage: 'grant_resolution',
      outcome: 'blocked',
      code: 'REQUIRED_GRANT_MISSING',
    });
    expect(receipt.provisionedWorkspaceInstanceId).toBeUndefined();
    expect(receipt.installedPackageKey).toBeUndefined();
    expect(options.provisioner.provision).not.toHaveBeenCalled();
    expect(options.installer.install).not.toHaveBeenCalled();
  });

  it('keeps truthful partial success when installation is unavailable', async () => {
    const { service, options } = setup('approved');
    vi.mocked(options.installer.install).mockResolvedValue({
      status: 'unavailable',
      code: 'INSTALLER_NOT_REGISTERED',
    });
    const receipt = await service.requestInstall(await plan(service));
    expect(receipt.status).toBe('blocked');
    expect(receipt.provisionedWorkspaceInstanceId).toBe('personal');
    expect(receipt.installedPackageKey).toBeUndefined();
    expect(receipt.stages.at(-1)).toMatchObject({
      stage: 'package_installation',
      outcome: 'blocked',
      code: 'INSTALLER_NOT_REGISTERED',
    });
  });

  it('rejects renderer plan drift before package verification', async () => {
    const { service, options } = setup();
    const installPlan = await plan(service);
    const tampered = {
      ...installPlan,
      scope: {
        ...installPlan.scope,
        workspaceInstanceId: 'foreign-workspace',
      },
    };
    await expect(service.requestInstall(tampered)).rejects.toMatchObject<
      Partial<MarketplaceOperationError>
    >({ code: 'PLAN_DRIFT' });
    expect(options.packageVerifier.verify).not.toHaveBeenCalled();
  });

  it('fails package evidence and never requests approval', async () => {
    const { service, options, approvals } = setup();
    vi.mocked(options.packageVerifier.verify).mockResolvedValue({
      packageKey: 'ocx_extension:reviewed-package@1.2.3',
      packageDigest: PACKAGE_DIGEST,
      publisherSignatureDigest: `sha256:${'b'.repeat(64)}`,
      signatureVerified: true,
      packageHandle: {},
    });
    const receipt = await service.requestInstall(await plan(service));
    expect(receipt.status).toBe('failed');
    expect(receipt.stages.at(-1)?.stage).toBe('package_verification');
    expect(approvals.request).not.toHaveBeenCalled();
  });
});
