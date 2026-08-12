import { createHash } from 'node:crypto';

export interface CustomerMarketingCanaryApproval {
  approvalId: string;
  reviewer: string;
  manifestDigest: string;
  expiresAt: string;
}

export interface CustomerMarketingCanaryBinding {
  provider: 'telegram';
  operation: 'private_sandbox_send';
  manifestDigest: string;
  resourceDigest: string;
  expectedRevision: number;
  approval: CustomerMarketingCanaryApproval;
}

export interface CustomerMarketingCanaryIntent {
  provider: 'telegram';
  operation: 'private_sandbox_send';
  manifestDigest: string;
  resourceDigest: string;
  expectedRevision: number;
}

export interface CustomerMarketingCanaryStatus {
  enabled: boolean;
  killSwitch: boolean;
  bindingDigest: string | null;
  stateRevision: number;
}

export interface CustomerMarketingCanaryDecision {
  authorized: boolean;
  reason: 'canary-disabled' | 'kill-switch-enabled' | 'approval-expired' | 'binding-mismatch' | 'canary-authorized';
  externalActionPerformed: false;
}

export interface CustomerMarketingCanaryReceipt {
  action: 'enabled' | 'kill_switch_enabled' | 'kill_switch_disabled' | 'rolled_back';
  reason: string;
  bindingDigest: string | null;
  stateRevision: number;
  createdAt: string;
  externalActionPerformed: false;
  receiptDigest: string;
}

const BINDING_KEYS = [
  'provider', 'operation', 'manifestDigest', 'resourceDigest', 'expectedRevision', 'approval',
] as const;
const APPROVAL_KEYS = ['approvalId', 'reviewer', 'manifestDigest', 'expiresAt'] as const;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export function parseCustomerMarketingCanaryBinding(
  value: unknown,
  now: () => string = () => new Date().toISOString(),
): CustomerMarketingCanaryBinding | null {
  if (!isExactPlainRecord(value, BINDING_KEYS)
    || !isExactPlainRecord(value.approval, APPROVAL_KEYS)
    || value.provider !== 'telegram'
    || value.operation !== 'private_sandbox_send'
    || typeof value.manifestDigest !== 'string'
    || !SHA256_PATTERN.test(value.manifestDigest)
    || typeof value.resourceDigest !== 'string'
    || !SHA256_PATTERN.test(value.resourceDigest)
    || typeof value.expectedRevision !== 'number'
    || !Number.isSafeInteger(value.expectedRevision)
    || value.expectedRevision < 0
    || typeof value.approval.approvalId !== 'string'
    || !IDENTIFIER_PATTERN.test(value.approval.approvalId)
    || typeof value.approval.reviewer !== 'string'
    || value.approval.reviewer !== value.approval.reviewer.trim()
    || value.approval.reviewer.length < 1
    || value.approval.reviewer.length > 120
    || typeof value.approval.manifestDigest !== 'string'
    || value.approval.manifestDigest !== value.manifestDigest
    || !isCanonicalIsoTimestamp(value.approval.expiresAt)
    || !isCanonicalIsoTimestamp(now())
    || Date.parse(value.approval.expiresAt) <= Date.parse(now())) return null;

  return value as unknown as CustomerMarketingCanaryBinding;
}

export class CustomerMarketingCanaryController {
  private binding: CustomerMarketingCanaryBinding | null = null;
  private killSwitch = false;
  private stateRevision = 0;

  constructor(private readonly now: () => string = () => new Date().toISOString()) {}

  status(): CustomerMarketingCanaryStatus {
    return {
      enabled: this.binding !== null,
      killSwitch: this.killSwitch,
      bindingDigest: this.binding ? bindingDigest(this.binding) : null,
      stateRevision: this.stateRevision,
    };
  }

  enable(
    value: unknown,
    expectedStateRevision: number,
  ): CustomerMarketingCanaryReceipt & { action: 'enabled' } {
    this.assertStateRevision(expectedStateRevision);
    if (this.binding) throw new Error('Canary is already enabled.');
    if (this.killSwitch) throw new Error('Canary kill switch is enabled.');
    const binding = parseCustomerMarketingCanaryBinding(value, this.now);
    if (!binding) throw new Error('Invalid canary binding.');
    this.binding = binding;
    this.stateRevision += 1;
    return this.receipt('enabled', 'named-approval-bound');
  }

  authorize(intent: CustomerMarketingCanaryIntent): CustomerMarketingCanaryDecision {
    if (!this.binding) return this.decision(false, 'canary-disabled');
    if (this.killSwitch) return this.decision(false, 'kill-switch-enabled');
    if (Date.parse(this.binding.approval.expiresAt) <= Date.parse(this.now())) {
      return this.decision(false, 'approval-expired');
    }
    if (intent.provider !== this.binding.provider
      || intent.operation !== this.binding.operation
      || intent.manifestDigest !== this.binding.manifestDigest
      || intent.resourceDigest !== this.binding.resourceDigest
      || intent.expectedRevision !== this.binding.expectedRevision) {
      return this.decision(false, 'binding-mismatch');
    }
    return this.decision(true, 'canary-authorized');
  }

  setKillSwitch(enabled: boolean, expectedStateRevision: number): CustomerMarketingCanaryReceipt {
    this.assertStateRevision(expectedStateRevision);
    if (this.killSwitch === enabled) throw new Error('Canary kill switch state is unchanged.');
    this.killSwitch = enabled;
    this.stateRevision += 1;
    return this.receipt(
      enabled ? 'kill_switch_enabled' : 'kill_switch_disabled',
      enabled ? 'operator-stop' : 'operator-reset',
    );
  }

  rollback(reason: string, expectedStateRevision: number): CustomerMarketingCanaryReceipt {
    this.assertStateRevision(expectedStateRevision);
    if (!this.binding) throw new Error('Canary is not enabled.');
    if (typeof reason !== 'string'
      || reason !== reason.trim()
      || reason.length < 3
      || reason.length > 200) throw new Error('Invalid canary rollback reason.');
    const previousBindingDigest = bindingDigest(this.binding);
    this.binding = null;
    this.stateRevision += 1;
    return this.receipt('rolled_back', reason, previousBindingDigest);
  }

  private assertStateRevision(expectedStateRevision: number): void {
    if (!Number.isSafeInteger(expectedStateRevision)
      || expectedStateRevision < 0
      || expectedStateRevision !== this.stateRevision) {
      throw new Error('Canary state revision conflict.');
    }
  }

  private decision(
    authorized: boolean,
    reason: CustomerMarketingCanaryDecision['reason'],
  ): CustomerMarketingCanaryDecision {
    return { authorized, reason, externalActionPerformed: false };
  }

  private receipt<TAction extends CustomerMarketingCanaryReceipt['action']>(
    action: TAction,
    reason: string,
    previousBindingDigest?: string,
  ): CustomerMarketingCanaryReceipt & { action: TAction } {
    const canonical = {
      action,
      reason,
      bindingDigest: previousBindingDigest ?? (this.binding ? bindingDigest(this.binding) : null),
      stateRevision: this.stateRevision,
      createdAt: this.now(),
      externalActionPerformed: false as const,
    };
    return { ...canonical, receiptDigest: sha256(JSON.stringify(canonical)) };
  }
}

function bindingDigest(binding: CustomerMarketingCanaryBinding): string {
  return sha256(JSON.stringify(binding));
}

function isCanonicalIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string'
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function isExactPlainRecord(
  value: unknown,
  expectedKeys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length
    && expectedKeys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
