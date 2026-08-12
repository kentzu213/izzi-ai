import { describe, expect, it } from 'vitest';
import {
  CustomerMarketingCanaryController,
  parseCustomerMarketingCanaryBinding,
} from './customer-marketing-canary-controller';

const MANIFEST_DIGEST = 'a'.repeat(64);
const RESOURCE_DIGEST = 'b'.repeat(64);
const NOW = '2026-08-12T15:00:00.000Z';
const FUTURE = '2026-08-12T16:00:00.000Z';
const binding = {
  provider: 'telegram' as const,
  operation: 'private_sandbox_send' as const,
  manifestDigest: MANIFEST_DIGEST,
  resourceDigest: RESOURCE_DIGEST,
  expectedRevision: 2,
  approval: {
    approvalId: 'approval-cmr-230a',
    reviewer: 'Nguyen Nghia',
    manifestDigest: MANIFEST_DIGEST,
    expiresAt: FUTURE,
  },
};

describe('Customer Marketing canary controller', () => {
  it('parses only an exact Telegram private-sandbox canary binding', () => {
    expect(parseCustomerMarketingCanaryBinding(binding, () => NOW)).toEqual(binding);
    const rejected = [
      { ...binding, provider: 'x' },
      { ...binding, operation: 'public_send' },
      { ...binding, manifestDigest: 'bad' },
      { ...binding, expectedRevision: -1 },
      { ...binding, approval: { ...binding.approval, manifestDigest: 'c'.repeat(64) } },
      { ...binding, approval: { ...binding.approval, expiresAt: NOW } },
      { ...binding, credential: 'forbidden' },
      { ...binding, workspaceId: '11111111-1111-4111-8111-111111111111' },
      { ...binding, path: 'C:\\customer-data' },
    ];
    rejected.forEach((value) => expect(parseCustomerMarketingCanaryBinding(value, () => NOW)).toBeNull());
  });

  it('starts disabled and denies execution before an explicit enable', () => {
    const controller = new CustomerMarketingCanaryController(() => NOW);

    expect(controller.status()).toEqual({
      enabled: false,
      killSwitch: false,
      bindingDigest: null,
      stateRevision: 0,
    });
    expect(controller.authorize({
      provider: 'telegram',
      operation: 'private_sandbox_send',
      manifestDigest: MANIFEST_DIGEST,
      resourceDigest: RESOURCE_DIGEST,
      expectedRevision: 2,
    })).toMatchObject({ authorized: false, reason: 'canary-disabled', externalActionPerformed: false });
  });

  it('enables exactly one binding and authorizes only an exact matching intent', () => {
    const controller = new CustomerMarketingCanaryController(() => NOW);
    const receipt = controller.enable(binding, 0);

    expect(receipt).toMatchObject({ action: 'enabled', stateRevision: 1, externalActionPerformed: false });
    expect(receipt.receiptDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(controller.authorize({
      provider: 'telegram',
      operation: 'private_sandbox_send',
      manifestDigest: MANIFEST_DIGEST,
      resourceDigest: RESOURCE_DIGEST,
      expectedRevision: 2,
    })).toMatchObject({ authorized: true, reason: 'canary-authorized', externalActionPerformed: false });
    expect(controller.authorize({
      provider: 'telegram',
      operation: 'private_sandbox_send',
      manifestDigest: MANIFEST_DIGEST,
      resourceDigest: 'c'.repeat(64),
      expectedRevision: 2,
    })).toMatchObject({ authorized: false, reason: 'binding-mismatch' });
  });

  it('rejects stale state revisions and a second binding while enabled', () => {
    const controller = new CustomerMarketingCanaryController(() => NOW);
    controller.enable(binding, 0);

    expect(() => controller.enable(binding, 0)).toThrow('Canary state revision conflict.');
    expect(() => controller.enable({ ...binding, resourceDigest: 'c'.repeat(64) }, 1))
      .toThrow('Canary is already enabled.');
  });

  it('kill switch takes precedence and rollback disables the binding with a durable receipt', () => {
    const controller = new CustomerMarketingCanaryController(() => NOW);
    controller.enable(binding, 0);
    const killed = controller.setKillSwitch(true, 1);

    expect(killed).toMatchObject({ action: 'kill_switch_enabled', stateRevision: 2 });
    expect(controller.authorize({
      provider: 'telegram',
      operation: 'private_sandbox_send',
      manifestDigest: MANIFEST_DIGEST,
      resourceDigest: RESOURCE_DIGEST,
      expectedRevision: 2,
    })).toMatchObject({ authorized: false, reason: 'kill-switch-enabled' });

    const rollback = controller.rollback('operator-rehearsal', 2);
    expect(rollback).toMatchObject({
      action: 'rolled_back',
      reason: 'operator-rehearsal',
      stateRevision: 3,
      externalActionPerformed: false,
    });
    expect(controller.status()).toEqual({
      enabled: false,
      killSwitch: true,
      bindingDigest: null,
      stateRevision: 3,
    });
  });

  it('fails closed after approval expiry even when the canary was previously enabled', () => {
    let now = NOW;
    const controller = new CustomerMarketingCanaryController(() => now);
    controller.enable(binding, 0);
    now = FUTURE;

    expect(controller.authorize({
      provider: 'telegram',
      operation: 'private_sandbox_send',
      manifestDigest: MANIFEST_DIGEST,
      resourceDigest: RESOURCE_DIGEST,
      expectedRevision: 2,
    })).toMatchObject({ authorized: false, reason: 'approval-expired' });
  });
});
