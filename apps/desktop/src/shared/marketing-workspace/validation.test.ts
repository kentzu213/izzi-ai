import { describe, expect, it } from 'vitest';
import {
  parseMarketingWorkspaceHostEvidence,
  parseMarketingWorkspaceProvisionRequest,
} from '.';

const evidence = {
  schemaVersion: 1,
  evidenceDigest: `sha256:${'a'.repeat(64)}`,
  issuedAt: '2026-07-29T14:40:00.000Z',
  scope: {
    tenantId: 'tenant:workspace-1',
    userId: 'user-1',
    workspaceInstanceId: 'customer-marketing:workspace-1',
  },
  role: 'owner',
  installedPackage: {
    extensionId: 'ext-marketing',
    packageKey: 'ocx_extension:marketing-suite@1.2.3',
    version: '1.2.3',
    state: 'running',
  },
};

describe('marketing workspace bridge validation', () => {
  it('accepts exact host evidence and provision requests', () => {
    expect(parseMarketingWorkspaceHostEvidence(evidence)).toEqual(evidence);
    expect(parseMarketingWorkspaceProvisionRequest({ evidence })).toEqual({ evidence });
  });

  it('rejects plan metadata, unknown fields and malformed package identity', () => {
    expect(parseMarketingWorkspaceProvisionRequest({
      evidence: { ...evidence, effect: 'plan_only' },
    })).toBeNull();
    expect(parseMarketingWorkspaceHostEvidence({
      ...evidence,
      installedPackage: { ...evidence.installedPackage, packageKey: 'marketing-suite' },
    })).toBeNull();
  });
});
