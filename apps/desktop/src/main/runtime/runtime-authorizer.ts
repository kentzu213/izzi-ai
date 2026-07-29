import {
  isGrantExpired,
  parseIntegrationGrantReadModel,
  type IntegrationGrantReadModel,
  type IntegrationGrantScope,
} from '../../shared/integration-grants';
import {
  asId,
  type IntegrationGrantId,
  type WorkspaceInstanceId,
} from '../../shared/personal-office';
import {
  requiredRuntimeScope,
  type RuntimeSpec,
  validateRuntimeSpec,
} from '../../shared/runtime';

export interface RuntimeAuthorizationQuery {
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly packageId: string;
  readonly integrationId: string;
  readonly grantId: string;
  readonly runId?: string;
  readonly requiredScope: string;
  readonly evaluatedAt: string;
}

/**
 * Main-process trust boundary. Implementations must resolve package trust and
 * the live grant from authoritative stores. Renderer/package input must never
 * provide either verdict directly.
 */
export interface RuntimeAuthorizationResolver {
  isPackageTrusted(
    query: RuntimeAuthorizationQuery,
  ): boolean | Promise<boolean>;
  resolveGrant(
    query: RuntimeAuthorizationQuery,
  ): unknown | null | Promise<unknown | null>;
}

export interface AuthorizedRuntime {
  readonly query: RuntimeAuthorizationQuery;
  readonly grant: IntegrationGrantReadModel;
}

export class RuntimeAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuntimeAuthorizationError';
  }
}

export const denyAllRuntimeAuthorization: RuntimeAuthorizationResolver = Object.freeze({
  isPackageTrusted: () => false,
  resolveGrant: () => null,
});

export async function authorizeRuntimeSpec(
  input: RuntimeSpec,
  resolver: RuntimeAuthorizationResolver,
  evaluatedAt: string,
): Promise<AuthorizedRuntime> {
  const spec = validateRuntimeSpec(input);
  const query: RuntimeAuthorizationQuery = Object.freeze({
    tenantId: spec.authority.tenantId,
    userId: spec.authority.userId,
    workspaceId: spec.authority.workspaceId,
    packageId: spec.authority.packageId,
    integrationId: spec.authority.integrationId,
    grantId: spec.authority.grantId,
    ...(spec.authority.runId ? { runId: spec.authority.runId } : {}),
    requiredScope: requiredRuntimeScope(spec),
    evaluatedAt: exactTimestamp(evaluatedAt),
  });

  let trusted = false;
  try {
    trusted = await resolver.isPackageTrusted(query);
  } catch {
    trusted = false;
  }
  if (!trusted) {
    throw new RuntimeAuthorizationError('Untrusted package is denied');
  }

  let rawGrant: unknown | null = null;
  try {
    rawGrant = await resolver.resolveGrant(query);
  } catch {
    rawGrant = null;
  }
  if (!rawGrant) {
    throw new RuntimeAuthorizationError('A live exact-scope IntegrationGrant is required');
  }

  const expectedScope: IntegrationGrantScope = Object.freeze({
    tenantId: query.tenantId,
    userId: query.userId,
    workspaceInstanceId: asId<'WorkspaceInstanceId'>(
      query.workspaceId,
    ) as WorkspaceInstanceId,
    grantId: asId<'IntegrationGrantId'>(query.grantId) as IntegrationGrantId,
    integration: query.integrationId,
    scopes: Object.freeze([query.requiredScope]),
  });

  let grant: IntegrationGrantReadModel;
  try {
    grant = parseIntegrationGrantReadModel(rawGrant, expectedScope);
  } catch {
    throw new RuntimeAuthorizationError('Runtime IntegrationGrant evidence is invalid');
  }
  if (
    grant.state !== 'active'
    || grant.reasonCode !== 'active'
    || grant.vaultResolution !== 'resolvable'
    || !grant.grant
    || grant.grant.invalid
    || grant.grant.revokedAt
    || isGrantExpired(grant.grant, query.evaluatedAt)
  ) {
    throw new RuntimeAuthorizationError('Runtime IntegrationGrant is not live');
  }
  return Object.freeze({ query, grant });
}

function exactTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new RuntimeAuthorizationError('Runtime authorization time is invalid');
  }
  return value;
}
