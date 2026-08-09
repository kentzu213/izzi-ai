import type { CustomerVoiceStudioRuntimeOutcome } from '../../shared/customer-marketing-types';

interface VoiceStudioExtensionCandidate {
  id: string;
  name: string;
  state?: string;
  manifest?: {
    customerMarketing?: unknown;
    customerMarketingCapability?: {
      id?: unknown;
      minimumPlan?: unknown;
      permission?: unknown;
    };
    service?: { projectName?: unknown };
  };
}

interface VoiceStudioServiceStatus {
  hasService?: boolean;
  running?: boolean;
  healthy?: boolean;
}

export interface CustomerVoiceStudioRepairDependencies {
  listExtensions: () => readonly VoiceStudioExtensionCandidate[];
  isDockerAvailable: () => Promise<boolean>;
  startExtension: (extensionId: string, options: { withService: true }) => Promise<void>;
  getServiceStatus: (extensionId: string) => Promise<VoiceStudioServiceStatus>;
}

const VOICE_STUDIO_EXTENSION_ID = 'ext-voice-studio';

function isTrustedVoiceStudio(extension: VoiceStudioExtensionCandidate): boolean {
  const capability = extension.manifest?.customerMarketingCapability;
  return extension.id === VOICE_STUDIO_EXTENSION_ID
    && extension.name === 'voice-studio'
    && extension.state !== 'disabled'
    && extension.manifest?.customerMarketing === true
    && capability?.id === 'voice-studio-local-preview'
    && capability.minimumPlan === 'pro'
    && capability.permission === 'execute'
    && extension.manifest?.service?.projectName === 'izzi-svc-voice-studio';
}

export function createCustomerVoiceStudioRepair(
  dependencies: CustomerVoiceStudioRepairDependencies,
): () => Promise<CustomerVoiceStudioRuntimeOutcome> {
  let active: Promise<CustomerVoiceStudioRuntimeOutcome> | null = null;

  const run = async (): Promise<CustomerVoiceStudioRuntimeOutcome> => {
    const matches = dependencies.listExtensions().filter(isTrustedVoiceStudio);
    if (matches.length !== 1) return 'not_installed';
    try {
      const current = await dependencies.getServiceStatus(VOICE_STUDIO_EXTENSION_ID);
      if (current.hasService === true && current.running === true && current.healthy === true) {
        return 'ready';
      }
    } catch {
      // Continue into the bounded repair path when status cannot be read.
    }
    try {
      if (!(await dependencies.isDockerAvailable())) return 'docker_unavailable';
      await dependencies.startExtension(VOICE_STUDIO_EXTENSION_ID, { withService: true });
      const status = await dependencies.getServiceStatus(VOICE_STUDIO_EXTENSION_ID);
      return status.hasService === true && status.running === true && status.healthy === true
        ? 'ready'
        : 'unhealthy';
    } catch {
      return 'unhealthy';
    }
  };

  return () => {
    if (active) return active;
    const current = run().finally(() => {
      if (active === current) active = null;
    });
    active = current;
    return current;
  };
}
