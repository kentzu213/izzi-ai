import { describe, expect, it, vi } from 'vitest';
import {
  CustomerMarketingTelegramCanarySendLedger,
  CustomerMarketingTelegramCanarySendCoordinator,
} from './customer-marketing-telegram-canary-send';

const BINDING_DIGEST = 'a'.repeat(64);
const RESOURCE_DIGEST = 'b'.repeat(64);
const WORKSPACE_HASH = 'c'.repeat(64);

class FakeSettings {
  readonly values = new Map<string, string>();
  getSetting(key: string): string | null { return this.values.get(key) ?? null; }
  setSetting(key: string, value: string): void { this.values.set(key, value); }
  setSettingIfAbsent(key: string, value: string): boolean {
    if (this.values.has(key)) return false;
    this.values.set(key, value);
    return true;
  }
}

function durableLedger(settings = new FakeSettings()) {
  return new CustomerMarketingTelegramCanarySendLedger(settings);
}

function sendInput() {
  return {
    workspaceHash: WORKSPACE_HASH,
    bindingDigest: BINDING_DIGEST,
    resourceDigest: RESOURCE_DIGEST,
    text: 'Private canary message',
  };
}

describe('CustomerMarketingTelegramCanarySendCoordinator', () => {
  it('cancels before reserving an attempt or invoking the transport', async () => {
    const confirm = vi.fn(async () => false);
    const execute = vi.fn();
    const coordinator = new CustomerMarketingTelegramCanarySendCoordinator({ ledger: durableLedger() });

    await expect(coordinator.send(sendInput(), {
      confirm, reauthorize: vi.fn(async () => true), execute,
    })).resolves.toMatchObject({
      ok: false,
      outcome: 'not_performed',
      receipt: null,
      detail: 'operator-cancelled',
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('allows one confirmed attempt and blocks replay with a redacted receipt', async () => {
    const execute = vi.fn(async () => ({ outcome: 'performed' as const }));
    const coordinator = new CustomerMarketingTelegramCanarySendCoordinator({
      now: () => '2026-08-13T08:00:00.000Z',
      id: () => 'canary-send-attempt-1',
      ledger: durableLedger(),
    });
    const input = sendInput();

    const handlers = { confirm: vi.fn(async () => true), reauthorize: vi.fn(async () => true), execute };
    const first = await coordinator.send(input, handlers);
    const replay = await coordinator.send(input, handlers);

    expect(first).toMatchObject({
      ok: true,
      outcome: 'performed',
      receipt: {
        attemptId: 'canary-send-attempt-1',
        bindingDigest: BINDING_DIGEST,
        resourceDigest: RESOURCE_DIGEST,
        createdAt: '2026-08-13T08:00:00.000Z',
        receiptDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(JSON.stringify(first)).not.toContain('Private canary message');
    expect(replay).toMatchObject({ ok: false, outcome: 'not_performed', detail: 'attempt-already-consumed' });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('marks a failed network attempt unknown and never permits retry', async () => {
    const execute = vi.fn(async () => ({ outcome: 'unknown' as const }));
    const coordinator = new CustomerMarketingTelegramCanarySendCoordinator({ ledger: durableLedger() });
    const handlers = { confirm: vi.fn(async () => true), reauthorize: vi.fn(async () => true), execute };
    const input = sendInput();

    await expect(coordinator.send(input, handlers)).resolves.toMatchObject({
      ok: false,
      outcome: 'unknown',
      receipt: { receiptDigest: expect.stringMatching(/^[a-f0-9]{64}$/) },
      detail: 'external-outcome-unknown',
    });
    await expect(coordinator.send(input, handlers)).resolves.toMatchObject({
      ok: false,
      outcome: 'not_performed',
      detail: 'attempt-already-consumed',
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('records no external receipt when main preflight changes after confirmation', async () => {
    const execute = vi.fn(async () => ({
      outcome: 'not_performed' as const,
      detail: 'source-changed-after-confirmation',
    }));
    const coordinator = new CustomerMarketingTelegramCanarySendCoordinator({ ledger: durableLedger() });
    const handlers = { confirm: vi.fn(async () => true), reauthorize: vi.fn(async () => true), execute };
    const input = sendInput();

    await expect(coordinator.send(input, handlers)).resolves.toEqual({
      ok: false,
      outcome: 'not_performed',
      receipt: null,
      detail: 'source-changed-after-confirmation',
    });
    await expect(coordinator.send(input, handlers)).resolves.toMatchObject({
      detail: 'attempt-already-consumed',
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('reserves before execute so concurrent requests cannot send twice', async () => {
    let release!: () => void;
    const execute = vi.fn(() => new Promise<{ outcome: 'performed' }>((resolve) => {
      release = () => resolve({ outcome: 'performed' });
    }));
    const coordinator = new CustomerMarketingTelegramCanarySendCoordinator({ ledger: durableLedger() });
    const handlers = { confirm: vi.fn(async () => true), reauthorize: vi.fn(async () => true), execute };
    const input = sendInput();

    const first = coordinator.send(input, handlers);
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    await expect(coordinator.send(input, handlers)).resolves.toMatchObject({
      ok: false,
      outcome: 'not_performed',
      detail: 'attempt-already-consumed',
    });
    release();
    await expect(first).resolves.toMatchObject({ ok: true, outcome: 'performed' });
  });

  it('persists the reservation before execute and blocks replay after restart', async () => {
    const settings = new FakeSettings();
    const first = new CustomerMarketingTelegramCanarySendCoordinator({
      ledger: new CustomerMarketingTelegramCanarySendLedger(settings),
      id: () => 'canary-send-persistent-1',
    });
    const execute = vi.fn(async () => ({ outcome: 'unknown' as const }));

    await expect(first.send(sendInput(), {
      confirm: vi.fn(async () => true), reauthorize: vi.fn(async () => true), execute,
    })).resolves.toMatchObject({ outcome: 'unknown' });

    const afterRestart = new CustomerMarketingTelegramCanarySendCoordinator({
      ledger: new CustomerMarketingTelegramCanarySendLedger(settings),
    });
    await expect(afterRestart.send(sendInput(), {
      confirm: vi.fn(async () => true), reauthorize: vi.fn(async () => true), execute,
    })).resolves.toMatchObject({
      outcome: 'not_performed',
      detail: 'attempt-already-consumed',
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('does not execute when the durable reservation cannot be written', async () => {
    const settings = new FakeSettings();
    settings.setSettingIfAbsent = () => { throw new Error('disk unavailable'); };
    const coordinator = new CustomerMarketingTelegramCanarySendCoordinator({
      ledger: new CustomerMarketingTelegramCanarySendLedger(settings),
    });
    const execute = vi.fn();

    await expect(coordinator.send(sendInput(), {
      confirm: vi.fn(async () => true), reauthorize: vi.fn(async () => true), execute,
    })).resolves.toMatchObject({
      outcome: 'not_performed',
      detail: 'attempt-ledger-unavailable',
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('records a thrown transport attempt as unknown and blocks replay', async () => {
    const settings = new FakeSettings();
    const coordinator = new CustomerMarketingTelegramCanarySendCoordinator({
      ledger: new CustomerMarketingTelegramCanarySendLedger(settings),
      id: () => 'canary-send-thrown-1',
    });
    const execute = vi.fn(async () => { throw new Error('socket reset'); });
    const handlers = { confirm: vi.fn(async () => true), reauthorize: vi.fn(async () => true), execute };

    await expect(coordinator.send(sendInput(), handlers)).resolves.toMatchObject({
      ok: false,
      outcome: 'unknown',
      detail: 'external-outcome-unknown',
      receipt: { attemptId: 'canary-send-thrown-1', outcome: 'unknown' },
    });
    await expect(coordinator.send(sendInput(), handlers)).resolves.toMatchObject({
      outcome: 'not_performed', detail: 'attempt-already-consumed',
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('requires a durable ledger instead of falling back to process memory', () => {
    expect(() => new CustomerMarketingTelegramCanarySendCoordinator({ ledger: undefined as never }))
      .toThrow('durable ledger');
  });

  it('freezes the validated snapshot before confirmation and ignores caller mutation', async () => {
    const mutable = sendInput();
    const execute = vi.fn(async (received: ReturnType<typeof sendInput> & { attemptId: string }) => {
      expect(Object.isFrozen(received)).toBe(true);
      expect(received.resourceDigest).toBe(RESOURCE_DIGEST);
      expect(received.text).toBe('Private canary message');
      return { outcome: 'performed' as const };
    });
    const coordinator = new CustomerMarketingTelegramCanarySendCoordinator({ ledger: durableLedger() });

    await expect(coordinator.send(mutable, {
      confirm: vi.fn(async () => {
        mutable.resourceDigest = 'e'.repeat(64);
        mutable.text = 'mutated after confirmation';
        return true;
      }),
      reauthorize: vi.fn(async (received) => (
        received.resourceDigest === RESOURCE_DIGEST && received.text === 'Private canary message'
      )),
      execute,
    })).resolves.toMatchObject({ outcome: 'performed' });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('requires a repeated authority decision after confirmation', async () => {
    const execute = vi.fn();
    const coordinator = new CustomerMarketingTelegramCanarySendCoordinator({ ledger: durableLedger() });
    await expect(coordinator.send(sendInput(), {
      confirm: vi.fn(async () => true),
      reauthorize: vi.fn(async () => false),
      execute,
    })).resolves.toMatchObject({ outcome: 'not_performed', detail: 'authority-changed-after-confirmation' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('uses the atomic insert primitive and never falls back to get-set-get reservation', () => {
    const settings = new FakeSettings();
    settings.getSetting = () => { throw new Error('non-atomic read forbidden'); };
    settings.setSetting = () => { throw new Error('non-atomic write forbidden'); };
    const ledger = new CustomerMarketingTelegramCanarySendLedger(settings);
    expect(ledger.reserve({
      workspaceHash: WORKSPACE_HASH,
      bindingDigest: BINDING_DIGEST,
      resourceDigest: RESOURCE_DIGEST,
      attemptId: 'canary-send-atomic-1',
      reservedAt: '2026-08-13T08:00:00.000Z',
    })).toBe('reserved');
  });

  it('verifies only the exact durable reservation bound to the attempt', () => {
    const ledger = durableLedger();
    const stored = {
      workspaceHash: WORKSPACE_HASH,
      bindingDigest: BINDING_DIGEST,
      resourceDigest: RESOURCE_DIGEST,
      attemptId: 'canary-send-verify-1',
      reservedAt: '2026-08-13T08:00:00.000Z',
    };
    expect(ledger.reserve(stored)).toBe('reserved');
    expect(ledger.verifyReservation(stored)).toBe(true);
    expect(ledger.verifyReservation({ ...stored, attemptId: 'canary-send-verify-2' })).toBe(false);
    expect(ledger.verifyReservation({ ...stored, bindingDigest: 'e'.repeat(64) })).toBe(false);
  });

  it('redacts arbitrary connector diagnostics before returning to the caller', async () => {
    const execute = vi.fn(async () => ({
      outcome: 'unknown' as const,
      detail: 'https://api.telegram.org/botSECRET/sendMessage?chat_id=private',
    }));
    const coordinator = new CustomerMarketingTelegramCanarySendCoordinator({ ledger: durableLedger() });
    const result = await coordinator.send(sendInput(), {
      confirm: vi.fn(async () => true), reauthorize: vi.fn(async () => true), execute,
    });
    expect(result.detail).toBe('external-outcome-unknown');
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(JSON.stringify(result)).not.toContain('chat_id');
  });
});
