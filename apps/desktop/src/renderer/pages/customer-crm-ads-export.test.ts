import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type {
  CustomerCareCrmConsent,
  CustomerCareCrmIdentity,
  CustomerCareCrmListInput,
  CustomerCareCrmListResult,
  CustomerCareCrmProfileInput,
  CustomerCareCrmRow,
} from '../../shared/customer-care-types';
import { crmDraftProfiles, crmFreshAdsExport } from './customer-crm-ads-export';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const NOW_ISO = '2026-11-25T02:00:00.000Z';
const sha = (phone: string) => createHash('sha256').update(phone, 'utf8').digest('hex');

const PROFILE: CustomerCareCrmProfileInput = {
  stage: 'consulting',
  ownerUserId: null,
  addressForm: null,
  occasion: null,
  neededBy: null,
  productFactIds: [],
  nextStep: null,
  nextStepDueAt: null,
  lostReason: null,
  purchasedAt: null,
  note: null,
};

function identity(consent: Partial<CustomerCareCrmConsent> = {}): CustomerCareCrmIdentity {
  return {
    version: NOW_ISO,
    lastRunAt: NOW_ISO,
    consent: { state: 'granted', at: NOW_ISO, noMarketing: false, canAsk: false, eraseRequestedAt: null, ...consent },
    occasion: null,
    timeline: null,
    productFactIds: null,
    addressForm: null,
    ageBand: null,
    family: null,
    interests: null,
    persona: null,
  };
}

function row(leadId: string, phone: string, consent: Partial<CustomerCareCrmConsent> = {}): CustomerCareCrmRow {
  return {
    leadId,
    pageId: '105252511858057',
    customerName: 'Khách',
    phone,
    zaloMentioned: false,
    leadStatus: 'new',
    phoneCapturedAt: NOW_ISO,
    lastMessageAt: NOW_ISO,
    recentMessages: [],
    profile: { ...PROFILE, updatedAt: NOW_ISO, updatedBy: null },
    identity: identity(consent),
  };
}

function page(
  rows: CustomerCareCrmRow[],
  nextCursor: string | null,
  extra: Partial<{ workspaceId: string; identityEnabled: boolean | null; identityUnavailable: boolean }> = {},
): CustomerCareCrmListResult {
  return {
    ok: true,
    workspaceId: extra.workspaceId ?? WORKSPACE,
    role: 'owner',
    canDelete: true,
    rows,
    nextCursor,
    assignees: [],
    identityEnabled: extra.identityEnabled === undefined ? true : extra.identityEnabled,
    identityUnavailable: extra.identityUnavailable ?? false,
    consentAsk: null,
  };
}

/** A fake `listCrm` that answers the given pages in order and records what it was asked. */
function lister(pages: CustomerCareCrmListResult[]) {
  const inputs: CustomerCareCrmListInput[] = [];
  const list = async (input: CustomerCareCrmListInput) => {
    inputs.push(input);
    return pages.shift() ?? { ok: false as const, error: 'unavailable' as const };
  };
  return { list, inputs };
}

const options = (drafts: Readonly<Record<string, CustomerCareCrmProfileInput>> = {}) => ({
  workspaceId: () => WORKSPACE,
  drafts: () => drafts,
});

describe('"Xuất CSV" builds the file from a fresh full read, never from the rows on screen', () => {
  it('excludes a page-2 customer the fresh read shows as declined (granted on screen), and reads every page with identity', async () => {
    const onScreenPage2 = row('lead-p2', '0912345678');
    expect(onScreenPage2.identity?.consent?.state).toBe('granted');
    const { list, inputs } = lister([
      page([row('lead-p1', '0901234567')], 'c1'),
      page([row('lead-p2', '0912345678', { state: 'declined', noMarketing: true })], null),
    ]);

    const outcome = await crmFreshAdsExport(list, 'all', options());

    expect(inputs).toEqual([{ cursor: null, retryIdentity: true }, { cursor: 'c1' }]);
    expect(outcome).toEqual({
      ok: true,
      truncated: false,
      result: {
        csv: `phone\n${sha('84901234567')}`,
        includedCount: 1,
        excludedNoConsent: 0,
        excludedSuppressed: 1,
        blockedReason: null,
      },
    });
  });

  it('blocks with a reason when the fresh read fails, throws, or lands on another workspace', async () => {
    const failed = await crmFreshAdsExport(lister([page([row('a', '0901234567')], 'c1')]).list, 'all', options());
    expect(failed).toEqual({ ok: false, message: expect.stringContaining('đọc lại') });

    const thrown = await crmFreshAdsExport(async () => { throw new Error('ipc'); }, 'all', options());
    expect(thrown).toEqual({ ok: false, message: expect.stringContaining('đọc lại') });

    const moved = await crmFreshAdsExport(
      lister([page([row('a', '0901234567')], null, { workspaceId: '22222222-2222-4222-8222-222222222222' })]).list,
      'all',
      options(),
    );
    expect(moved).toEqual({ ok: false, message: expect.stringContaining('dự án') });
  });

  it('is blocked by the gate when any page came back without identity, or the AI profile is off', async () => {
    const partial = await crmFreshAdsExport(
      lister([page([row('a', '0901234567')], 'c1'), page([row('b', '0912345678')], null, { identityUnavailable: true })]).list,
      'all',
      options(),
    );
    expect(partial).toMatchObject({ ok: true, result: { csv: 'phone', includedCount: 0, blockedReason: 'identity_unavailable' } });

    const off = await crmFreshAdsExport(lister([page([row('a', '0901234567')], null, { identityEnabled: false })]).list, 'all', options());
    expect(off).toMatchObject({ ok: true, result: { includedCount: 0, blockedReason: 'identity_off' } });
  });

  it('honours an unsaved "Không liên hệ" draft, read after the fresh answer; a draft never adds anyone', async () => {
    const drafts: Record<string, CustomerCareCrmProfileInput> = {};
    const { list } = lister([page([row('lead-a', '0901234567'), row('lead-b', '0912345678', { state: 'unknown' })], null)]);
    const pending = crmFreshAdsExport(list, 'all', { workspaceId: () => WORKSPACE, drafts: () => drafts });
    drafts['lead-a'] = { ...PROFILE, stage: 'do_not_contact' };
    drafts['lead-b'] = { ...PROFILE, stage: 'deposit' };

    expect(await pending).toMatchObject({ ok: true, result: { includedCount: 0, excludedSuppressed: 1, excludedNoConsent: 1 } });
  });

  it('turns panel edits into the drafts the export honours', () => {
    const draft = { ...PROFILE, stage: 'do_not_contact' as const };
    expect(crmDraftProfiles({ x: { draft, rejected: null, error: '', baseUpdatedAt: null } })).toEqual({ x: draft });
  });
});
