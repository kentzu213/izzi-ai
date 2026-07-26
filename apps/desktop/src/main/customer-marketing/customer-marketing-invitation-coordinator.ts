import type {
  CustomerRole,
  CustomerWorkspaceInvitationAcceptanceResult,
} from '../../shared/customer-marketing-types';
import { parseCustomerMarketingInvitationLink } from './customer-marketing-invitation-link';

export type CustomerMarketingInvitationCoordinatorStatus = 'ignored' | 'pending' | 'handled';

export interface CustomerMarketingInvitationCoordinatorDependencies {
  isAuthenticated(): Promise<boolean>;
  acceptInvitation(token: string): Promise<CustomerWorkspaceInvitationAcceptanceResult>;
  notify(result: CustomerWorkspaceInvitationAcceptanceResult): void;
  now?(): number;
}

const AUTHENTICATION_REQUIRED_ERROR = 'Sign in to accept this invitation.';
const ACCEPTANCE_FAILED_ERROR = 'Unable to accept this invitation.';
const PENDING_EXPIRED_ERROR = 'This invitation link expired before sign-in. Open it again.';
const PENDING_INVITATION_TTL_MS = 10 * 60 * 1000;
const CUSTOMER_ROLES = new Set<CustomerRole>([
  'owner',
  'manager',
  'editor',
  'reviewer',
  'viewer',
]);

interface PendingInvitation {
  token: string;
  expiresAt: number;
}

function isTokenFreeString(value: unknown, token: string): value is string {
  return typeof value === 'string' && !value.includes(token);
}

function toTokenFreeResult(
  result: CustomerWorkspaceInvitationAcceptanceResult,
  token: string,
): CustomerWorkspaceInvitationAcceptanceResult {
  const tokenFreeResult: CustomerWorkspaceInvitationAcceptanceResult = {
    ok: result?.ok === true,
  };

  if (isTokenFreeString(result?.workspaceId, token)) {
    tokenFreeResult.workspaceId = result.workspaceId;
  }
  if (
    isTokenFreeString(result?.role, token)
    && CUSTOMER_ROLES.has(result.role as CustomerRole)
  ) {
    tokenFreeResult.role = result.role as CustomerRole;
  }
  if (typeof result?.pending === 'boolean') {
    tokenFreeResult.pending = result.pending;
  }
  if (typeof result?.error === 'string') {
    tokenFreeResult.error = isTokenFreeString(result.error, token)
      ? result.error
      : ACCEPTANCE_FAILED_ERROR;
  }

  return tokenFreeResult;
}

export class CustomerMarketingInvitationCoordinator {
  private pending: PendingInvitation | null = null;

  private readonly inFlightTokens = new Set<string>();

  private acceptedToken: string | null = null;

  constructor(
    private readonly dependencies: CustomerMarketingInvitationCoordinatorDependencies,
  ) {}

  async handleLink(link: string): Promise<CustomerMarketingInvitationCoordinatorStatus> {
    const token = parseCustomerMarketingInvitationLink(link);
    if (token === null) {
      return 'ignored';
    }

    if (token === this.acceptedToken) {
      return 'handled';
    }

    if (this.readPending()?.token === token) {
      return 'pending';
    }

    if (!await this.isAuthenticated()) {
      this.pending = { token, expiresAt: this.now() + PENDING_INVITATION_TTL_MS };
      this.dependencies.notify({
        ok: false,
        pending: true,
        error: AUTHENTICATION_REQUIRED_ERROR,
      });
      return 'pending';
    }

    return await this.acceptAndNotify(token) ? 'handled' : 'pending';
  }

  async flushPending(): Promise<CustomerMarketingInvitationCoordinatorStatus> {
    const pending = this.pending;
    if (pending === null) {
      return 'ignored';
    }
    if (pending.expiresAt <= this.now()) {
      this.pending = null;
      this.dependencies.notify({ ok: false, error: PENDING_EXPIRED_ERROR });
      return 'ignored';
    }

    if (!await this.isAuthenticated()) {
      return 'pending';
    }

    if (this.pending !== pending) {
      return this.pending === null ? 'ignored' : 'pending';
    }

    this.pending = null;
    return await this.acceptAndNotify(pending.token) ? 'handled' : 'pending';
  }

  clearPending(): void {
    this.pending = null;
    this.acceptedToken = null;
  }

  private now(): number {
    return this.dependencies.now?.() ?? Date.now();
  }

  private readPending(): PendingInvitation | null {
    const pending = this.pending;
    if (pending === null) {
      return null;
    }
    if (pending.expiresAt <= this.now()) {
      this.pending = null;
      return null;
    }
    return pending;
  }

  private async isAuthenticated(): Promise<boolean> {
    try {
      return await this.dependencies.isAuthenticated();
    } catch {
      return false;
    }
  }

  private async acceptAndNotify(token: string): Promise<boolean> {
    if (this.inFlightTokens.has(token)) {
      return false;
    }
    this.inFlightTokens.add(token);

    let result: CustomerWorkspaceInvitationAcceptanceResult;
    try {
      result = await this.dependencies.acceptInvitation(token);
    } catch {
      result = { ok: false, error: ACCEPTANCE_FAILED_ERROR };
    } finally {
      this.inFlightTokens.delete(token);
    }

    const tokenFreeResult = toTokenFreeResult(result, token);
    if (tokenFreeResult.ok) {
      this.acceptedToken = token;
    }
    this.dependencies.notify(tokenFreeResult);
    return true;
  }
}
