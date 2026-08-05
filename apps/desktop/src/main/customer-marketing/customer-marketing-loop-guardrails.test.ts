import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { CustomerMarketingActionGateRequest } from '../../shared/customer-marketing-action-gate-types';
import {
  CUSTOMER_MARKETING_GUARDRAIL_DEFAULT_POLICY,
  createCustomerMarketingGuardrailStateReader,
  evaluateCustomerMarketingKillSwitch,
  evaluateCustomerMarketingSpendAndVolumeCaps,
  readCustomerMarketingGuardrailPolicy,
  readCustomerMarketingKillSwitch,
  type CustomerMarketingGuardrailState,
} from './customer-marketing-loop-guardrails';

const scratch = mkdtempSync(join(tmpdir(), 'cmr222-'));

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

function request(
  overrides: Partial<CustomerMarketingActionGateRequest> = {},
): CustomerMarketingActionGateRequest {
  return {
    action: 'publish',
    target: 'social',
    workflowId: 'cmr306-social-workflow-1',
    approvalId: 'cmr306-social-workflow-1-approval',
    manifestDigest: 'a'.repeat(64),
    provider: 'facebook',
    metadata: { itemCount: 1, recipientCount: 0, spendVnd: 0 },
    ...overrides,
  };
}

function state(
  overrides: Partial<CustomerMarketingGuardrailState> = {},
): CustomerMarketingGuardrailState {
  return {
    killSwitch: { engaged: false, source: 'none' },
    policy: CUSTOMER_MARKETING_GUARDRAIL_DEFAULT_POLICY,
    spendVndUsedInWindow: 0,
    ...overrides,
  };
}

describe('CMR-222 operator halt', () => {
  it('allows the pipeline to continue when no halt is engaged', () => {
    expect(evaluateCustomerMarketingKillSwitch(state())).toBeNull();
  });

  it('denies while engaged, whatever the source', () => {
    for (const source of ['env', 'file', 'read_error'] as const) {
      expect(evaluateCustomerMarketingKillSwitch(state({ killSwitch: { engaged: true, source } })))
        .toEqual({ allowed: false, executed: false, denialReason: 'kill_switch_engaged' });
    }
  });

  it('engages on any non-empty environment value that is not an explicit off value', () => {
    for (const raw of ['1', 'true', 'yes', 'on', 'engaged', 'STOP', 'halt', '2', 'y']) {
      expect(readCustomerMarketingKillSwitch({ env: { IZZI_MARKETING_KILL_SWITCH: raw } }))
        .toEqual({ engaged: true, source: 'env' });
    }
  });

  it('stays off only for explicit off values', () => {
    for (const raw of ['0', 'false', 'no', 'off', 'OFF', ' No ']) {
      expect(readCustomerMarketingKillSwitch({ env: { IZZI_MARKETING_KILL_SWITCH: raw } }).engaged)
        .toBe(false);
    }
    expect(readCustomerMarketingKillSwitch({ env: {} }))
      .toEqual({ engaged: false, source: 'none' });
  });

  it('treats a set-but-empty variable as intent to halt', () => {
    for (const raw of ['', '   ']) {
      expect(readCustomerMarketingKillSwitch({ env: { IZZI_MARKETING_KILL_SWITCH: raw } }))
        .toEqual({ engaged: true, source: 'env' });
    }
  });

  it('engages from a flag file on disk and clears when it is absent', () => {
    const present = join(scratch, 'engaged-flag');
    writeFileSync(present, '', 'utf8');
    expect(readCustomerMarketingKillSwitch({ env: {}, killSwitchFilePath: present }))
      .toEqual({ engaged: true, source: 'file' });
    expect(readCustomerMarketingKillSwitch({
      env: {},
      killSwitchFilePath: join(scratch, 'missing-flag'),
    })).toEqual({ engaged: false, source: 'none' });
  });

  it('fails closed when the flag file cannot be read', () => {
    expect(readCustomerMarketingKillSwitch({
      env: {},
      killSwitchFilePath: join(scratch, 'any-flag'),
      probeFile: () => 'error',
    })).toEqual({ engaged: true, source: 'read_error' });
    expect(readCustomerMarketingKillSwitch({
      env: {},
      killSwitchFilePath: join(scratch, 'any-flag'),
      probeFile: () => { throw new Error('probe failed'); },
    })).toEqual({ engaged: true, source: 'read_error' });
  });

  it('reports no halt when no file path is configured, so the env flag is the only control', () => {
    expect(readCustomerMarketingKillSwitch({ env: {} }).source).toBe('none');
  });
});

describe('CMR-222 spend and volume caps', () => {
  it('passes a within-policy request', () => {
    expect(evaluateCustomerMarketingSpendAndVolumeCaps(request(), state())).toBeNull();
  });

  it('denies a single run above the per-run spend cap', () => {
    expect(evaluateCustomerMarketingSpendAndVolumeCaps(
      request({
        action: 'spend',
        metadata: {
          itemCount: 0,
          recipientCount: 0,
          spendVnd: CUSTOMER_MARKETING_GUARDRAIL_DEFAULT_POLICY.maxSpendVndPerRun + 1,
        },
      }),
      state(),
    )).toEqual({ allowed: false, executed: false, denialReason: 'policy_denied' });
  });

  it('denies a within-run amount that would cross the window ceiling', () => {
    const policy = CUSTOMER_MARKETING_GUARDRAIL_DEFAULT_POLICY;
    const remaining = policy.maxSpendVndPerDay - policy.maxSpendVndPerRun;
    const spend = request({
      action: 'spend',
      metadata: { itemCount: 0, recipientCount: 0, spendVnd: policy.maxSpendVndPerRun },
    });
    expect(evaluateCustomerMarketingSpendAndVolumeCaps(
      spend,
      state({ spendVndUsedInWindow: remaining + 1 }),
    )?.denialReason).toBe('policy_denied');
    expect(evaluateCustomerMarketingSpendAndVolumeCaps(
      spend,
      state({ spendVndUsedInWindow: remaining }),
    )).toBeNull();
  });

  it('refuses spend when no usable window figure exists instead of assuming zero', () => {
    for (const used of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5]) {
      expect(evaluateCustomerMarketingSpendAndVolumeCaps(
        request({ action: 'spend', metadata: { itemCount: 0, recipientCount: 0, spendVnd: 1 } }),
        state({ spendVndUsedInWindow: used }),
      )?.denialReason).toBe('policy_denied');
    }
  });

  it('does not require a window figure for actions that spend nothing', () => {
    expect(evaluateCustomerMarketingSpendAndVolumeCaps(
      request(),
      state({ spendVndUsedInWindow: Number.NaN }),
    )).toBeNull();
  });

  it('denies recipient and item volumes above the per-run caps', () => {
    const policy = CUSTOMER_MARKETING_GUARDRAIL_DEFAULT_POLICY;
    expect(evaluateCustomerMarketingSpendAndVolumeCaps(
      request({
        action: 'bulk_email',
        target: 'email',
        provider: 'email',
        metadata: { itemCount: 1, recipientCount: policy.maxRecipientsPerRun + 1, spendVnd: 0 },
      }),
      state(),
    )).toEqual({ allowed: false, executed: false, denialReason: 'policy_denied' });
    expect(evaluateCustomerMarketingSpendAndVolumeCaps(
      request({ metadata: { itemCount: policy.maxItemsPerRun + 1, recipientCount: 0, spendVnd: 0 } }),
      state(),
    )?.denialReason).toBe('policy_denied');
  });

  it('denies metadata that is not a usable count, even though the parser should have caught it', () => {
    for (const metadata of [
      { itemCount: Number.NaN, recipientCount: 0, spendVnd: 0 },
      { itemCount: 1, recipientCount: Number.NaN, spendVnd: 0 },
      { itemCount: 1, recipientCount: 0, spendVnd: Number.NaN },
      { itemCount: 1.5, recipientCount: 0, spendVnd: 0 },
      { itemCount: -1, recipientCount: 0, spendVnd: 0 },
    ]) {
      expect(evaluateCustomerMarketingSpendAndVolumeCaps(
        request({ metadata: metadata as never }),
        state(),
      )?.denialReason).toBe('policy_denied');
    }
  });
});

describe('CMR-222 policy reader', () => {
  it('uses the safe defaults when no override is present', () => {
    expect(readCustomerMarketingGuardrailPolicy({}))
      .toEqual(CUSTOMER_MARKETING_GUARDRAIL_DEFAULT_POLICY);
  });

  it('accepts a lower operator override', () => {
    expect(readCustomerMarketingGuardrailPolicy({
      IZZI_MARKETING_MAX_SPEND_VND_PER_RUN: '1000',
      IZZI_MARKETING_MAX_SPEND_VND_PER_DAY: '5000',
      IZZI_MARKETING_MAX_RECIPIENTS_PER_RUN: '10',
      IZZI_MARKETING_MAX_ITEMS_PER_RUN: '2',
    })).toEqual({
      maxSpendVndPerRun: 1000,
      maxSpendVndPerDay: 5000,
      maxRecipientsPerRun: 10,
      maxItemsPerRun: 2,
    });
  });

  it.each(['0', '-5', 'abc', '1.5', '', '999999999999'])(
    'falls back to the default for an unusable override %s',
    (raw) => {
      expect(readCustomerMarketingGuardrailPolicy({ IZZI_MARKETING_MAX_SPEND_VND_PER_RUN: raw })
        .maxSpendVndPerRun).toBe(CUSTOMER_MARKETING_GUARDRAIL_DEFAULT_POLICY.maxSpendVndPerRun);
    },
  );

  it('never lets a per-run cap exceed the window ceiling', () => {
    const policy = readCustomerMarketingGuardrailPolicy({
      IZZI_MARKETING_MAX_SPEND_VND_PER_RUN: '900000',
      IZZI_MARKETING_MAX_SPEND_VND_PER_DAY: '100000',
    });
    expect(policy.maxSpendVndPerRun).toBeLessThanOrEqual(policy.maxSpendVndPerDay);
  });
});

describe('CMR-222 state reader', () => {
  it('refuses spend by default because no ledger is wired yet', () => {
    const read = createCustomerMarketingGuardrailStateReader({ env: {} });
    const readState = read();
    expect(readState.killSwitch).toEqual({ engaged: false, source: 'none' });
    expect(readState.policy).toEqual(CUSTOMER_MARKETING_GUARDRAIL_DEFAULT_POLICY);
    expect(Number.isNaN(readState.spendVndUsedInWindow)).toBe(true);
    expect(evaluateCustomerMarketingSpendAndVolumeCaps(
      request({ action: 'spend', metadata: { itemCount: 0, recipientCount: 0, spendVnd: 1 } }),
      readState,
    )?.denialReason).toBe('policy_denied');
  });

  it('uses a wired ledger when one is supplied', () => {
    const read = createCustomerMarketingGuardrailStateReader({
      env: {},
      spendVndUsedInWindow: () => 250_000,
    });
    expect(read().spendVndUsedInWindow).toBe(250_000);
  });

  it('fails closed when the ledger throws', () => {
    const read = createCustomerMarketingGuardrailStateReader({
      env: {},
      spendVndUsedInWindow: () => { throw new Error('ledger unavailable'); },
    });
    expect(Number.isNaN(read().spendVndUsedInWindow)).toBe(true);
  });

  it('re-reads the halt on every call so a stop takes effect without a restart', () => {
    let engaged = false;
    const read = createCustomerMarketingGuardrailStateReader({
      env: {},
      killSwitchFilePath: join(scratch, 'toggle-flag'),
      probeFile: () => (engaged ? 'present' : 'absent'),
    });
    expect(read().killSwitch.engaged).toBe(false);
    engaged = true;
    expect(read().killSwitch.engaged).toBe(true);
  });
});
