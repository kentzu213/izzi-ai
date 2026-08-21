interface AutopostExtensionCandidate {
  id: string;
  name: string;
  state?: string;
  grantedPermissions?: string[];
  manifest?: {
    version?: unknown;
    permissions?: unknown;
    service?: { projectName?: unknown };
  };
}

export interface AutopostExtensionEnsureDependencies {
  bundledOcxPath: string;
  bundledOcxExists: (filePath: string) => boolean;
  getExtension: () => AutopostExtensionCandidate | undefined;
  installFromOcx: (
    filePath: string,
    permissions?: string[],
  ) => Promise<AutopostExtensionCandidate>;
  stopExtension: (extensionId: string) => Promise<void>;
}

export const AUTOPOST_EXTENSION_ID = 'ext-social-auto-poster';
export const AUTOPOST_BUNDLED_VERSION = '0.3.0';

const AUTOPOST_DECLARED_PERMISSIONS = new Set([
  'storage.local',
  'ui.notification',
  'ui.panel',
  'net.http',
]);

function isTrustedAutopostExtension(extension: AutopostExtensionCandidate): boolean {
  const permissions = extension.manifest?.permissions;
  const hasPermissionContract = Array.isArray(permissions)
    && permissions.length === AUTOPOST_DECLARED_PERMISSIONS.size
    && permissions.every((permission) => (
      typeof permission === 'string' && AUTOPOST_DECLARED_PERMISSIONS.has(permission)
    ));
  return extension.id === AUTOPOST_EXTENSION_ID
    && extension.name === 'social-auto-poster'
    && hasPermissionContract
    && extension.manifest?.service?.projectName === 'izzi-svc-social-auto-poster';
}

function preserveDeclaredPermissions(
  extension: AutopostExtensionCandidate | undefined,
): string[] | undefined {
  if (!Array.isArray(extension?.grantedPermissions)) return undefined;
  return extension.grantedPermissions.filter((permission) => (
    AUTOPOST_DECLARED_PERMISSIONS.has(permission)
  ));
}

function isCurrentAutopostExtension(extension: AutopostExtensionCandidate): boolean {
  const grantsAreDeclared = Array.isArray(extension.grantedPermissions)
    && extension.grantedPermissions.every((permission) => (
      AUTOPOST_DECLARED_PERMISSIONS.has(permission)
    ));
  return isTrustedAutopostExtension(extension)
    && extension.manifest?.version === AUTOPOST_BUNDLED_VERSION
    && grantsAreDeclared;
}

export function createAutopostExtensionEnsurer(
  dependencies: AutopostExtensionEnsureDependencies,
): () => Promise<void> {
  return async () => {
    const current = dependencies.getExtension();
    if (current && isCurrentAutopostExtension(current)) return;
    if (!dependencies.bundledOcxExists(dependencies.bundledOcxPath)) {
      throw new Error('Bundled Auto Post package is unavailable');
    }

    if (current?.state === 'running') {
      await dependencies.stopExtension(AUTOPOST_EXTENSION_ID);
    }

    const installed = await dependencies.installFromOcx(
      dependencies.bundledOcxPath,
      preserveDeclaredPermissions(current),
    );
    if (!isCurrentAutopostExtension(installed)) {
      throw new Error('Bundled Auto Post package identity does not match the release contract');
    }
  };
}
