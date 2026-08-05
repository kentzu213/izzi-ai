import * as fs from 'node:fs';
import {
  CUSTOMER_MARKETING_ACTION_GATE_METADATA_MAXIMA,
  type CustomerMarketingActionGateRequest,
  type CustomerMarketingActionGateResult,
} from '../../shared/customer-marketing-action-gate-types';

// CMR-222 loop guardrails. Every action reaching the external action gate is a
// gated action: publish, spend, bulk email, or destructive.
//
// Two separate checks with deliberately different placement:
//
// - The operator halt runs before anything else, including request preflight, so
//   an incident stop is unambiguous and costs no I/O.
// - The spend and volume caps run after the caller's authority is established,
//   because a pre-authority cap check would let an unauthenticated caller bisect
//   the configured numbers. They deny with the gate's existing `policy_denied`
//   reason so the response adds no new signal about how the caps are set.
//
// Both only ever deny. Every unreadable input denies as well: an unreadable halt
// flag engages the halt, and a spend with no usable window figure is refused
// rather than treated as zero spend.

export interface CustomerMarketingGuardrailPolicy {
  maxSpendVndPerRun: number;
  maxSpendVndPerDay: number;
  maxRecipientsPerRun: number;
  maxItemsPerRun: number;
}

export type CustomerMarketingKillSwitchSource = 'none' | 'env' | 'file' | 'read_error';

export interface CustomerMarketingKillSwitchState {
  engaged: boolean;
  source: CustomerMarketingKillSwitchSource;
}

export interface CustomerMarketingGuardrailState {
  killSwitch: CustomerMarketingKillSwitchState;
  policy: CustomerMarketingGuardrailPolicy;
  // Spend already recorded inside the current window. `Number.NaN` means no
  // usable ledger, which refuses spend rather than reading as zero.
  spendVndUsedInWindow: number;
}

export type CustomerMarketingKillSwitchFileProbe = (path: string) => 'present' | 'absent' | 'error';

export interface CustomerMarketingKillSwitchOptions {
  env?: NodeJS.ProcessEnv;
  killSwitchFilePath?: string;
  probeFile?: CustomerMarketingKillSwitchFileProbe;
}

export interface CustomerMarketingGuardrailStateReaderOptions
  extends CustomerMarketingKillSwitchOptions {
  // Optional today. While no ledger exists, spend actions are refused by the
  // window check instead of passing with an assumed zero.
  spendVndUsedInWindow?: () => number;
}

// Conservative product defaults, far below the parser maxima on purpose: the
// parser bounds what is structurally acceptable, this policy bounds what the
// product is willing to do in one run or one window.
export const CUSTOMER_MARKETING_GUARDRAIL_DEFAULT_POLICY: CustomerMarketingGuardrailPolicy =
  Object.freeze({
    maxSpendVndPerRun: 500_000,
    maxSpendVndPerDay: 2_000_000,
    maxRecipientsPerRun: 500,
    maxItemsPerRun: 50,
  });

const KILL_SWITCH_ENV_KEY = 'IZZI_MARKETING_KILL_SWITCH';
// A halt control must not ignore plausible operator input. Any non-empty value
// engages the halt unless it is an explicit off value.
const KILL_SWITCH_OFF_VALUES = new Set(['0', 'false', 'no', 'off']);

const POLICY_ENV_KEYS: Readonly<Record<keyof CustomerMarketingGuardrailPolicy, string>> =
  Object.freeze({
    maxSpendVndPerRun: 'IZZI_MARKETING_MAX_SPEND_VND_PER_RUN',
    maxSpendVndPerDay: 'IZZI_MARKETING_MAX_SPEND_VND_PER_DAY',
    maxRecipientsPerRun: 'IZZI_MARKETING_MAX_RECIPIENTS_PER_RUN',
    maxItemsPerRun: 'IZZI_MARKETING_MAX_ITEMS_PER_RUN',
  });

const POLICY_CEILINGS: Readonly<Record<keyof CustomerMarketingGuardrailPolicy, number>> =
  Object.freeze({
    maxSpendVndPerRun: CUSTOMER_MARKETING_ACTION_GATE_METADATA_MAXIMA.spendVnd,
    maxSpendVndPerDay: CUSTOMER_MARKETING_ACTION_GATE_METADATA_MAXIMA.spendVnd,
    maxRecipientsPerRun: CUSTOMER_MARKETING_ACTION_GATE_METADATA_MAXIMA.recipientCount,
    maxItemsPerRun: CUSTOMER_MARKETING_ACTION_GATE_METADATA_MAXIMA.itemCount,
  });

function denied(
  denialReason: CustomerMarketingActionGateResult['denialReason'],
): CustomerMarketingActionGateResult {
  return { allowed: false, executed: false, denialReason };
}

function isUsableCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function probeWithFileSystem(path: string): 'present' | 'absent' | 'error' {
  try {
    fs.statSync(path);
    return 'present';
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | null)?.code;
    return code === 'ENOENT' ? 'absent' : 'error';
  }
}

export function readCustomerMarketingKillSwitch(
  options: CustomerMarketingKillSwitchOptions = {},
): CustomerMarketingKillSwitchState {
  const env = options.env ?? process.env;
  const flag = env[KILL_SWITCH_ENV_KEY];
  if (typeof flag === 'string') {
    const normalized = flag.trim().toLowerCase();
    if (normalized.length > 0 && !KILL_SWITCH_OFF_VALUES.has(normalized)) {
      return { engaged: true, source: 'env' };
    }
  }

  const filePath = options.killSwitchFilePath;
  if (!filePath) return { engaged: false, source: 'none' };

  const probe = options.probeFile ?? probeWithFileSystem;
  let outcome: 'present' | 'absent' | 'error';
  try {
    outcome = probe(filePath);
  } catch {
    outcome = 'error';
  }
  if (outcome === 'present') return { engaged: true, source: 'file' };
  if (outcome === 'error') return { engaged: true, source: 'read_error' };
  return { engaged: false, source: 'none' };
}

export function readCustomerMarketingGuardrailPolicy(
  env: NodeJS.ProcessEnv = process.env,
): CustomerMarketingGuardrailPolicy {
  const policy: CustomerMarketingGuardrailPolicy = { ...CUSTOMER_MARKETING_GUARDRAIL_DEFAULT_POLICY };
  for (const field of Object.keys(POLICY_ENV_KEYS) as Array<keyof CustomerMarketingGuardrailPolicy>) {
    const raw = env[POLICY_ENV_KEYS[field]];
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!/^[0-9]+$/.test(trimmed)) continue;
    const parsed = Number(trimmed);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > POLICY_CEILINGS[field]) continue;
    policy[field] = parsed;
  }
  // A per-run cap above the window ceiling would make the window meaningless.
  if (policy.maxSpendVndPerRun > policy.maxSpendVndPerDay) {
    policy.maxSpendVndPerRun = policy.maxSpendVndPerDay;
  }
  return policy;
}

export function createCustomerMarketingGuardrailStateReader(
  options: CustomerMarketingGuardrailStateReaderOptions = {},
): () => CustomerMarketingGuardrailState {
  // Caps come from the process environment, so they are fixed for the life of
  // this process. Only the halt and the window figure are re-read per call.
  const policy = readCustomerMarketingGuardrailPolicy(options.env ?? process.env);
  const readWindowUsage = options.spendVndUsedInWindow;
  return () => {
    let spendVndUsedInWindow: number;
    if (!readWindowUsage) {
      // No ledger is wired. Refuse spend instead of assuming nothing was spent.
      spendVndUsedInWindow = Number.NaN;
    } else {
      try {
        spendVndUsedInWindow = readWindowUsage();
      } catch {
        spendVndUsedInWindow = Number.NaN;
      }
    }
    return {
      killSwitch: readCustomerMarketingKillSwitch(options),
      policy,
      spendVndUsedInWindow,
    };
  };
}

/**
 * Runs before request preflight and before any authority lookup, so an operator
 * halt is unambiguous and costs no database or gateway access.
 */
export function evaluateCustomerMarketingKillSwitch(
  state: Pick<CustomerMarketingGuardrailState, 'killSwitch'>,
): CustomerMarketingActionGateResult | null {
  return state.killSwitch.engaged ? denied('kill_switch_engaged') : null;
}

/**
 * Runs after the caller's authority is established. Denies with the gate's
 * existing `policy_denied` reason so a caller cannot use the response to read
 * back how the caps are configured.
 */
export function evaluateCustomerMarketingSpendAndVolumeCaps(
  request: CustomerMarketingActionGateRequest,
  state: Pick<CustomerMarketingGuardrailState, 'policy' | 'spendVndUsedInWindow'>,
): CustomerMarketingActionGateResult | null {
  const { policy } = state;
  const { itemCount, recipientCount, spendVnd } = request.metadata;

  if (!isUsableCount(itemCount) || !isUsableCount(recipientCount) || !isUsableCount(spendVnd)) {
    return denied('policy_denied');
  }

  if (spendVnd > 0 || request.action === 'spend') {
    if (!isUsableCount(state.spendVndUsedInWindow)) return denied('policy_denied');
    if (spendVnd > policy.maxSpendVndPerRun) return denied('policy_denied');
    if (state.spendVndUsedInWindow + spendVnd > policy.maxSpendVndPerDay) {
      return denied('policy_denied');
    }
  }

  if (recipientCount > policy.maxRecipientsPerRun || itemCount > policy.maxItemsPerRun) {
    return denied('policy_denied');
  }
  return null;
}
