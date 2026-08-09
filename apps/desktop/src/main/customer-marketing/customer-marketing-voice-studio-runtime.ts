import type { CustomerVoiceStudioRuntimeOutcome } from '../../shared/customer-marketing-types';

interface VoiceStudioExtensionCandidate {
  id: string;
  name: string;
  state?: string;
  grantedPermissions?: string[];
  manifest?: {
    version?: unknown;
    permissions?: unknown;
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
  ensureCurrentExtension: () => Promise<void>;
  listExtensions: () => readonly VoiceStudioExtensionCandidate[];
  isDockerAvailable: () => Promise<boolean>;
  startExtension: (extensionId: string, options: { withService: true }) => Promise<void>;
  getServiceStatus: (extensionId: string) => Promise<VoiceStudioServiceStatus>;
  wait?: (durationMs: number) => Promise<void>;
}

export interface CustomerVoiceStudioExtensionEnsureDependencies {
  bundledOcxPath: string;
  bundledOcxExists: (filePath: string) => boolean;
  getExtension: () => VoiceStudioExtensionCandidate | undefined;
  installFromOcx: (
    filePath: string,
    permissions?: string[],
  ) => Promise<VoiceStudioExtensionCandidate>;
  stopExtension: (extensionId: string) => Promise<void>;
}

export const VOICE_STUDIO_EXTENSION_ID = 'ext-voice-studio';
export const VOICE_STUDIO_BUNDLED_VERSION = '0.2.0';
const VOICE_STUDIO_DECLARED_PERMISSIONS = new Set([
  'storage.local',
  'ui.notification',
  'ui.panel',
  'net.http',
]);
const READY_STABILIZATION_ATTEMPTS = 6;
const READY_STABILIZATION_DELAY_MS = 500;

function serviceIsReady(status: VoiceStudioServiceStatus): boolean {
  return status.hasService === true && status.running === true && status.healthy === true;
}

function isTrustedVoiceStudio(extension: VoiceStudioExtensionCandidate): boolean {
  const capability = extension.manifest?.customerMarketingCapability;
  const permissions = extension.manifest?.permissions;
  const hasPermissionContract = Array.isArray(permissions)
    && permissions.length === VOICE_STUDIO_DECLARED_PERMISSIONS.size
    && permissions.every((permission) => typeof permission === 'string' && VOICE_STUDIO_DECLARED_PERMISSIONS.has(permission));
  return extension.id === VOICE_STUDIO_EXTENSION_ID
    && extension.name === 'voice-studio'
    && extension.state !== 'disabled'
    && extension.manifest?.customerMarketing === true
    && capability?.id === 'voice-studio-local-preview'
    && capability.minimumPlan === 'pro'
    && capability.permission === 'execute'
    && hasPermissionContract
    && extension.manifest?.service?.projectName === 'izzi-svc-voice-studio';
}

function preserveDeclaredPermissions(extension: VoiceStudioExtensionCandidate | undefined): string[] | undefined {
  if (!Array.isArray(extension?.grantedPermissions)) return undefined;
  return extension.grantedPermissions.filter((permission) => VOICE_STUDIO_DECLARED_PERMISSIONS.has(permission));
}

function isCurrentVoiceStudio(extension: VoiceStudioExtensionCandidate): boolean {
  const grantsAreDeclared = Array.isArray(extension.grantedPermissions)
    && extension.grantedPermissions.every((permission) => VOICE_STUDIO_DECLARED_PERMISSIONS.has(permission));
  return isTrustedVoiceStudio(extension)
    && extension.manifest?.version === VOICE_STUDIO_BUNDLED_VERSION
    && grantsAreDeclared;
}

export function createCustomerVoiceStudioExtensionEnsurer(
  dependencies: CustomerVoiceStudioExtensionEnsureDependencies,
): () => Promise<void> {
  return async () => {
    const current = dependencies.getExtension();
    if (current && isCurrentVoiceStudio(current)) return;
    if (!dependencies.bundledOcxExists(dependencies.bundledOcxPath)) {
      throw new Error('Bundled Voice Studio package is unavailable');
    }

    if (current?.state === 'running') {
      await dependencies.stopExtension(VOICE_STUDIO_EXTENSION_ID);
    }

    const installed = await dependencies.installFromOcx(
      dependencies.bundledOcxPath,
      preserveDeclaredPermissions(current),
    );
    if (!isCurrentVoiceStudio(installed)) {
      throw new Error('Bundled Voice Studio package identity does not match the release contract');
    }
  };
}

export function createCustomerVoiceStudioRepair(
  dependencies: CustomerVoiceStudioRepairDependencies,
): () => Promise<CustomerVoiceStudioRuntimeOutcome> {
  let active: Promise<CustomerVoiceStudioRuntimeOutcome> | null = null;
  const wait = dependencies.wait
    ?? ((durationMs: number) => new Promise<void>((resolve) => setTimeout(resolve, durationMs)));

  const waitForStableReady = async (): Promise<boolean> => {
    let consecutiveReady = 0;
    for (let attempt = 0; attempt < READY_STABILIZATION_ATTEMPTS; attempt += 1) {
      try {
        const status = await dependencies.getServiceStatus(VOICE_STUDIO_EXTENSION_ID);
        consecutiveReady = serviceIsReady(status) ? consecutiveReady + 1 : 0;
        if (consecutiveReady >= 2) return true;
      } catch {
        consecutiveReady = 0;
      }
      if (attempt + 1 < READY_STABILIZATION_ATTEMPTS) {
        await wait(READY_STABILIZATION_DELAY_MS);
      }
    }
    return false;
  };

  const run = async (): Promise<CustomerVoiceStudioRuntimeOutcome> => {
    try {
      await dependencies.ensureCurrentExtension();
    } catch {
      return 'not_installed';
    }
    const matches = dependencies.listExtensions().filter(isTrustedVoiceStudio);
    if (matches.length !== 1) return 'not_installed';
    try {
      const current = await dependencies.getServiceStatus(VOICE_STUDIO_EXTENSION_ID);
      if (serviceIsReady(current)) return 'ready';
    } catch {
      // Continue into the bounded repair path when status cannot be read.
    }
    try {
      if (!(await dependencies.isDockerAvailable())) return 'docker_unavailable';
      await dependencies.startExtension(VOICE_STUDIO_EXTENSION_ID, { withService: true });
      return await waitForStableReady() ? 'ready' : 'unhealthy';
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
