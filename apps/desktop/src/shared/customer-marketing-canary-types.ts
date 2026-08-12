import type { CustomerMarketingBridgeStatus } from './customer-marketing-types';
import type { CustomerMarketingCredentialConnectionState } from './customer-marketing-credential-types';

export interface CustomerMarketingCanaryReadinessResult {
  ok: boolean;
  status: CustomerMarketingBridgeStatus;
  provider: 'telegram';
  controlPlane: {
    enabled: boolean;
    killSwitch: boolean;
    bindingDigest: string | null;
    stateRevision: number;
  } | null;
  credentialState: CustomerMarketingCredentialConnectionState | 'missing';
  liveReady: boolean;
  missingRequirements: Array<'credential' | 'private_sandbox_chat' | 'named_approval' | 'canary_enablement'>;
  externalActionPerformed: false;
  error?: string;
}
