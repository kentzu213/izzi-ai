import { canonicalJson } from '../personal-office';
import type {
  CapabilityPolicy,
  CapabilityRegistrySnapshot,
  RegisteredCapability,
} from './types';

export function canonicalCapabilityPolicyPayload(
  policy: CapabilityPolicy,
): string {
  return canonicalJson(policy);
}

export function canonicalCapabilityPayload(
  capability: Omit<RegisteredCapability, 'auditFingerprint'>,
): string {
  return canonicalJson(capability);
}

export function canonicalCapabilityRegistryPayload(
  snapshot: Omit<CapabilityRegistrySnapshot, 'auditDigest'>,
): string {
  return canonicalJson(snapshot);
}
