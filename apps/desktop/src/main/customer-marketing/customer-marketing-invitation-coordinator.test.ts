import { describe, expect, it, vi } from 'vitest';
import type { CustomerWorkspaceInvitationAcceptanceResult } from '../../shared/customer-marketing-types';
import { buildCustomerMarketingInvitationLink } from './customer-marketing-invitation-link';
import {
  CustomerMarketingInvitationCoordinator,
  type CustomerMarketingInvitationCoordinatorDependencies,
} from './customer-marketing-invitation-coordinator';

const FIRST_TOKEN = 'FirstInviteToken_0123456789';
const LATEST_TOKEN = 'LatestInviteToken_9876543210';
const FIRST_LINK = buildCustomerMarketingInvitationLink(FIRST_TOKEN);
const LATEST_LINK = buildCustomerMarketingInvitationLink(LATEST_TOKEN);
const PENDING_TTL_MS = 10 * 60 * 1000;
const PENDING_EXPIRED_ERROR = 'This invitation link expired before sign-in. Open it again.';

function createHarness(options: {
  authenticated?: boolean;
  acceptanceResult?: CustomerWorkspaceInvitationAcceptanceResult;
} = {}) {
  let authenticated = options.authenticated ?? false;
  let currentTime = 1_700_000_000_000;
  const isAuthenticated = vi.fn(async () => authenticated);
  const acceptInvitation = vi.fn(async () => options.acceptanceResult ?? ({
    ok: true,
    workspaceId: 'workspace-123',
    role: 'editor',
  }));
  const notify = vi.fn();
  const dependencies: CustomerMarketingInvitationCoordinatorDependencies = {
    isAuthenticated,
    acceptInvitation,
    notify,
    now: () => currentTime,
  };

  return {
    coordinator: new CustomerMarketingInvitationCoordinator(dependencies),
    isAuthenticated,
    acceptInvitation,
    notify,
    setAuthenticated(value: boolean) {
      authenticated = value;
    },
    advanceTime(milliseconds: number) {
      currentTime += milliseconds;
    },
  };
}

describe('CustomerMarketingInvitationCoordinator', () => {
  it.each([
    '',
    'https://example.test/invitations/accept',
    'openclaw://marketing/invitations/accept?token=not-customer-marketing',
    'openclaw://customer-marketing/invitations/accept?token=short',
  ])('ignores invalid or non-customer-marketing links without consulting dependencies: %s', async (link) => {
    const harness = createHarness({ authenticated: true });

    const status = await harness.coordinator.handleLink(link);

    expect(status).toBe('ignored');
    expect(harness.isAuthenticated).not.toHaveBeenCalled();
    expect(harness.acceptInvitation).not.toHaveBeenCalled();
    expect(harness.notify).not.toHaveBeenCalled();
  });

  it('keeps a valid logged-out invitation pending and emits a token-free result', async () => {
    const harness = createHarness();

    const status = await harness.coordinator.handleLink(FIRST_LINK);

    expect(status).toBe('pending');
    expect(harness.isAuthenticated).toHaveBeenCalledOnce();
    expect(harness.acceptInvitation).not.toHaveBeenCalled();
    expect(harness.notify).toHaveBeenCalledWith({
      ok: false,
      pending: true,
      error: 'Sign in to accept this invitation.',
    });
    expect(JSON.stringify({ status, emitted: harness.notify.mock.calls })).not.toContain(FIRST_TOKEN);
    expect(JSON.stringify({ status, emitted: harness.notify.mock.calls })).not.toContain(FIRST_LINK);
  });

  it('de-duplicates the same pending invitation', async () => {
    const harness = createHarness();

    await expect(harness.coordinator.handleLink(FIRST_LINK)).resolves.toBe('pending');
    await expect(harness.coordinator.handleLink(FIRST_LINK)).resolves.toBe('pending');

    expect(harness.isAuthenticated).toHaveBeenCalledOnce();
    expect(harness.acceptInvitation).not.toHaveBeenCalled();
    expect(harness.notify).toHaveBeenCalledOnce();
  });

  it('retains only the latest logged-out invitation', async () => {
    const harness = createHarness();

    await harness.coordinator.handleLink(FIRST_LINK);
    await harness.coordinator.handleLink(LATEST_LINK);
    harness.setAuthenticated(true);

    await expect(harness.coordinator.flushPending()).resolves.toBe('handled');
    expect(harness.acceptInvitation).toHaveBeenCalledOnce();
    expect(harness.acceptInvitation).toHaveBeenCalledWith(LATEST_TOKEN);
    expect(harness.acceptInvitation).not.toHaveBeenCalledWith(FIRST_TOKEN);
  });

  it('accepts an authenticated invitation once and emits only the public acceptance result', async () => {
    const acceptanceResult: CustomerWorkspaceInvitationAcceptanceResult = {
      ok: true,
      workspaceId: 'workspace-456',
      role: 'manager',
    };
    const harness = createHarness({ authenticated: true, acceptanceResult });

    const status = await harness.coordinator.handleLink(FIRST_LINK);

    expect(status).toBe('handled');
    expect(harness.acceptInvitation).toHaveBeenCalledOnce();
    expect(harness.acceptInvitation).toHaveBeenCalledWith(FIRST_TOKEN);
    expect(harness.notify).toHaveBeenCalledOnce();
    expect(harness.notify).toHaveBeenCalledWith(acceptanceResult);
    expect(JSON.stringify({ status, emitted: harness.notify.mock.calls })).not.toContain(FIRST_TOKEN);
    expect(JSON.stringify({ status, emitted: harness.notify.mock.calls })).not.toContain(FIRST_LINK);
  });

  it('strips undeclared secret fields and redacts an error containing the raw token', async () => {
    const harness = createHarness({ authenticated: true });
    harness.acceptInvitation.mockResolvedValueOnce({
      ok: false,
      error: `Invitation ${FIRST_TOKEN} failed`,
      token: FIRST_TOKEN,
      link: FIRST_LINK,
    } as CustomerWorkspaceInvitationAcceptanceResult);

    const status = await harness.coordinator.handleLink(FIRST_LINK);
    const serialized = JSON.stringify({ status, emitted: harness.notify.mock.calls });

    expect(harness.notify).toHaveBeenCalledWith({
      ok: false,
      error: 'Unable to accept this invitation.',
    });
    expect(serialized).not.toContain(FIRST_TOKEN);
    expect(serialized).not.toContain(FIRST_LINK);
  });

  it('turns a rejected acceptance into a token-free notification', async () => {
    const harness = createHarness({ authenticated: true });
    harness.acceptInvitation.mockRejectedValueOnce(new Error(`Rejected ${FIRST_LINK}`));

    const status = await harness.coordinator.handleLink(FIRST_LINK);

    expect(status).toBe('handled');
    expect(harness.acceptInvitation).toHaveBeenCalledOnce();
    expect(harness.notify).toHaveBeenCalledWith({
      ok: false,
      error: 'Unable to accept this invitation.',
    });
    expect(JSON.stringify({ status, emitted: harness.notify.mock.calls })).not.toContain(FIRST_TOKEN);
    expect(JSON.stringify({ status, emitted: harness.notify.mock.calls })).not.toContain(FIRST_LINK);
  });

  it('does not consult authentication when there is no pending invitation', async () => {
    const harness = createHarness({ authenticated: true });

    await expect(harness.coordinator.flushPending()).resolves.toBe('ignored');

    expect(harness.isAuthenticated).not.toHaveBeenCalled();
    expect(harness.acceptInvitation).not.toHaveBeenCalled();
    expect(harness.notify).not.toHaveBeenCalled();
  });

  it('keeps a pending invitation for retry until authentication succeeds', async () => {
    const harness = createHarness();

    await harness.coordinator.handleLink(FIRST_LINK);
    await expect(harness.coordinator.flushPending()).resolves.toBe('pending');
    expect(harness.acceptInvitation).not.toHaveBeenCalled();

    harness.setAuthenticated(true);
    await expect(harness.coordinator.flushPending()).resolves.toBe('handled');
    await expect(harness.coordinator.flushPending()).resolves.toBe('ignored');

    expect(harness.acceptInvitation).toHaveBeenCalledOnce();
    expect(harness.acceptInvitation).toHaveBeenCalledWith(FIRST_TOKEN);
    expect(harness.notify).toHaveBeenCalledTimes(2);
    const serialized = JSON.stringify(harness.notify.mock.calls);
    expect(serialized).not.toContain(FIRST_TOKEN);
    expect(serialized).not.toContain(FIRST_LINK);
  });

  it('consumes a pending token once across concurrent flushes', async () => {
    const harness = createHarness();
    await harness.coordinator.handleLink(FIRST_LINK);
    harness.setAuthenticated(true);

    const statuses = await Promise.all([
      harness.coordinator.flushPending(),
      harness.coordinator.flushPending(),
    ]);

    expect(statuses.sort()).toEqual(['handled', 'ignored']);
    expect(harness.acceptInvitation).toHaveBeenCalledOnce();
  });

  it('drops a pending invitation when the session is cleared on sign-out', async () => {
    const harness = createHarness();

    await expect(harness.coordinator.handleLink(FIRST_LINK)).resolves.toBe('pending');
    harness.coordinator.clearPending();
    harness.setAuthenticated(true);

    await expect(harness.coordinator.flushPending()).resolves.toBe('ignored');
    expect(harness.acceptInvitation).not.toHaveBeenCalled();
    expect(harness.isAuthenticated).toHaveBeenCalledOnce();
    expect(harness.notify).toHaveBeenCalledOnce();
  });

  it('expires a pending invitation that outlives the sign-in window', async () => {
    const harness = createHarness();

    await harness.coordinator.handleLink(FIRST_LINK);
    harness.setAuthenticated(true);
    harness.advanceTime(PENDING_TTL_MS);

    await expect(harness.coordinator.flushPending()).resolves.toBe('ignored');
    expect(harness.acceptInvitation).not.toHaveBeenCalled();
    expect(harness.isAuthenticated).toHaveBeenCalledOnce();
    expect(harness.notify).toHaveBeenLastCalledWith({
      ok: false,
      error: PENDING_EXPIRED_ERROR,
    });

    await expect(harness.coordinator.flushPending()).resolves.toBe('ignored');
    expect(harness.notify).toHaveBeenCalledTimes(2);
    const serialized = JSON.stringify(harness.notify.mock.calls);
    expect(serialized).not.toContain(FIRST_TOKEN);
    expect(serialized).not.toContain(FIRST_LINK);
  });

  it('re-arms an expired invitation only when the link is opened again', async () => {
    const harness = createHarness();

    await harness.coordinator.handleLink(FIRST_LINK);
    harness.advanceTime(PENDING_TTL_MS);

    await expect(harness.coordinator.handleLink(FIRST_LINK)).resolves.toBe('pending');
    expect(harness.isAuthenticated).toHaveBeenCalledTimes(2);

    harness.setAuthenticated(true);
    await expect(harness.coordinator.flushPending()).resolves.toBe('handled');
    expect(harness.acceptInvitation).toHaveBeenCalledOnce();
    expect(harness.acceptInvitation).toHaveBeenCalledWith(FIRST_TOKEN);
  });

  it('accepts a duplicated authenticated deep link only once', async () => {
    const harness = createHarness({ authenticated: true });
    let release: () => void = () => {};
    harness.acceptInvitation.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return {
        ok: true,
        workspaceId: 'workspace-123',
        role: 'editor',
      } as CustomerWorkspaceInvitationAcceptanceResult;
    });

    const first = harness.coordinator.handleLink(FIRST_LINK);
    await vi.waitFor(() => expect(harness.acceptInvitation).toHaveBeenCalledOnce());
    const second = harness.coordinator.handleLink(FIRST_LINK);

    await expect(second).resolves.toBe('pending');
    release();
    await expect(first).resolves.toBe('handled');

    expect(harness.acceptInvitation).toHaveBeenCalledOnce();
    expect(harness.notify).toHaveBeenCalledOnce();
  });

  it('does not re-accept a link that already succeeded', async () => {
    const harness = createHarness({ authenticated: true });

    await expect(harness.coordinator.handleLink(FIRST_LINK)).resolves.toBe('handled');
    await expect(harness.coordinator.handleLink(FIRST_LINK)).resolves.toBe('handled');

    expect(harness.acceptInvitation).toHaveBeenCalledOnce();
    expect(harness.notify).toHaveBeenCalledOnce();
  });

  it('still retries a link whose acceptance failed', async () => {
    const harness = createHarness({
      authenticated: true,
      acceptanceResult: { ok: false, error: 'Unable to accept this invitation.' },
    });

    await expect(harness.coordinator.handleLink(FIRST_LINK)).resolves.toBe('handled');
    await expect(harness.coordinator.handleLink(FIRST_LINK)).resolves.toBe('handled');

    expect(harness.acceptInvitation).toHaveBeenCalledTimes(2);
    expect(harness.notify).toHaveBeenCalledTimes(2);
  });

  it('re-evaluates a previously accepted link after the session is cleared', async () => {
    const harness = createHarness({ authenticated: true });

    await expect(harness.coordinator.handleLink(FIRST_LINK)).resolves.toBe('handled');
    harness.coordinator.clearPending();

    await expect(harness.coordinator.handleLink(FIRST_LINK)).resolves.toBe('handled');
    expect(harness.acceptInvitation).toHaveBeenCalledTimes(2);
  });
});
