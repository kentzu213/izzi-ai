import type { SecretRef } from '../personal-office';

export const RUNTIME_CONTRACT_VERSION = 1 as const;

export type RuntimeKind = 'docker-compose' | 'node' | 'binary' | 'browser' | 'remote';
export type RuntimeLifecycle =
  | 'pending'
  | 'provisioning'
  | 'ready'
  | 'deprovisioning'
  | 'released'
  | 'failed';

export interface RuntimeAuthority {
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly packageId: string;
  readonly integrationId: string;
  readonly grantId: string;
  readonly runId?: string;
}

export interface RuntimeBudget {
  readonly cpuPercent: number;
  readonly memoryMb: number;
  readonly diskMb: number;
  readonly timeoutMs: number;
}

export interface RuntimePaths {
  readonly workDir: string;
  readonly tempDir: string;
  readonly uploadDir: string;
  readonly downloadDir: string;
  readonly allowedRoots: readonly string[];
}

export interface RuntimeNetworkPolicy {
  readonly mode: 'deny' | 'allowlist';
  readonly bindHost: string;
  readonly allowedOrigins: readonly string[];
  readonly allowedPorts: readonly number[];
}

export interface RuntimeEnvBinding {
  readonly name: string;
  readonly secret: SecretRef;
}

export interface RuntimeBaseSpec {
  readonly schemaVersion: typeof RUNTIME_CONTRACT_VERSION;
  readonly id: string;
  readonly kind: RuntimeKind;
  readonly authority: RuntimeAuthority;
  readonly paths: RuntimePaths;
  readonly network: RuntimeNetworkPolicy;
  readonly budget: RuntimeBudget;
  readonly env: readonly RuntimeEnvBinding[];
}

export interface NativeRuntimeSpec extends RuntimeBaseSpec {
  readonly kind: 'node' | 'binary';
  readonly executable: string;
  readonly args: readonly string[];
  readonly executableSha256: string;
}

export interface DockerComposeAttestation {
  readonly explicitEnvironmentOnly: boolean;
  readonly loopbackOnly: boolean;
  readonly denyDefaultEgress: boolean;
  readonly encryptedSecretStorage: boolean;
}

export interface DockerComposeRuntimeSpec extends RuntimeBaseSpec {
  readonly kind: 'docker-compose';
  readonly extensionId: string;
  readonly serviceProject: string;
  readonly attestation: DockerComposeAttestation;
}

export interface BrowserRuntimeSpec extends RuntimeBaseSpec {
  readonly kind: 'browser';
  readonly visibleReviewMode: boolean;
  readonly storageStateRef: SecretRef;
}

export interface RemoteRuntimeSpec extends RuntimeBaseSpec {
  readonly kind: 'remote';
  readonly adapterId: string;
}

export type RuntimeSpec =
  | NativeRuntimeSpec
  | DockerComposeRuntimeSpec
  | BrowserRuntimeSpec
  | RemoteRuntimeSpec;

export interface RuntimeHealthSnapshot {
  readonly schemaVersion: typeof RUNTIME_CONTRACT_VERSION;
  readonly runtimeId: string;
  readonly kind: RuntimeKind;
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly packageId: string;
  readonly lifecycle: RuntimeLifecycle;
  readonly healthy: boolean;
  readonly detail?: string;
  readonly startedAt?: string;
  readonly updatedAt: string;
}

export interface RuntimeEffectReceipt {
  readonly schemaVersion: typeof RUNTIME_CONTRACT_VERSION;
  readonly claimId: string;
  readonly approvalId: string;
  readonly actionHash: string;
  readonly idempotencyKey: string;
  readonly workspaceId: string;
  readonly runId: string;
  readonly target: string;
  readonly responseDigest: string;
  readonly externalActionPerformed: true;
  readonly performedAt: string;
}
