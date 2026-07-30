export const MARKETING_WORKSPACE_BRIDGE_SCHEMA_VERSION = 1 as const;

export interface MarketingWorkspaceScope {
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceInstanceId: string;
}

export interface MarketingWorkspaceInstalledPackage {
  readonly extensionId: string;
  readonly packageKey: string;
  readonly version: string;
  readonly state: string;
}

export interface MarketingWorkspaceHostEvidence {
  readonly schemaVersion: typeof MARKETING_WORKSPACE_BRIDGE_SCHEMA_VERSION;
  readonly evidenceDigest: string;
  readonly issuedAt: string;
  readonly scope: MarketingWorkspaceScope;
  readonly role: 'owner' | 'manager' | 'editor' | 'reviewer' | 'viewer';
  readonly installedPackage: MarketingWorkspaceInstalledPackage;
}

export type MarketingWorkspaceEvidenceResult =
  | { readonly ok: true; readonly evidence: MarketingWorkspaceHostEvidence }
  | {
      readonly ok: false;
      readonly reason:
        | 'not_authenticated'
        | 'workspace_unavailable'
        | 'package_not_installed'
        | 'package_not_marketing_capable';
    };

export interface MarketingWorkspaceProvisionRequest {
  readonly evidence: MarketingWorkspaceHostEvidence;
}

export type MarketingWorkspaceProvisionResult =
  | {
      readonly ok: true;
      readonly reused: boolean;
      readonly intent: {
        readonly kind: 'open_customer_marketing_workspace';
        readonly workspaceInstanceId: string;
      };
    }
  | {
      readonly ok: false;
      readonly reason:
        | 'invalid_request'
        | 'stale_evidence'
        | 'scope_mismatch'
        | 'package_not_installed'
        | 'package_not_marketing_capable'
        | 'workspace_unavailable';
    };
