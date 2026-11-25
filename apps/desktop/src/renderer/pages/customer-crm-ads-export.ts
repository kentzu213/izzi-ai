/**
 * "Xuất CSV" (Ads): the file is built from a fresh full read with identity, never from the rows on screen. Pages 2–50
 * on screen keep the identities of the last full load, so a customer who refused since then would still look eligible
 * there. Unsaved drafts can only withhold a customer.
 */
import type {
  CustomerCareCrmListInput,
  CustomerCareCrmListResult,
  CustomerCareCrmProfileInput,
} from '../../shared/customer-care-types';
import {
  buildMetaCustomAudienceCsv,
  type CrmMetaAudienceTarget,
  type CrmMetaCustomAudienceCsvResult,
} from '../../shared/customer-crm-enterprise';
import { CRM_MAX_PAGES, loadCrmPages, type CrmRowEdit } from './customer-crm-flow';

export const CRM_EXPORT_REREAD_FAILED =
  'Chưa xuất được: izzi không đọc lại được danh sách khách để kiểm tra đồng ý mới nhất. Thử lại sau ít phút.';
export const CRM_EXPORT_SCOPE_CHANGED = 'Chưa xuất được: dự án vừa đổi trong lúc đọc lại danh sách. Hãy thử lại.';

/** `result.blockedReason` set: the fresh read itself says the export is closed (AI profile off or identity unread). */
export type CrmAdsExportOutcome =
  | { ok: true; result: CrmMetaCustomAudienceCsvResult; truncated: boolean }
  | { ok: false; message: string };

/** The unsaved drafts of the panel's edits, by lead. */
export function crmDraftProfiles(edits: Readonly<Record<string, CrmRowEdit>>): Record<string, CustomerCareCrmProfileInput> {
  return Object.fromEntries(Object.entries(edits).map(([leadId, edit]) => [leadId, edit.draft]));
}

export async function crmFreshAdsExport(
  list: (input: CustomerCareCrmListInput) => Promise<CustomerCareCrmListResult>,
  target: CrmMetaAudienceTarget,
  options: {
    /** The workspace on screen now; a read that answers for another one is not used. */
    workspaceId: () => string | null;
    /** Read after the answer arrives, so a draft typed meanwhile still counts. */
    drafts: () => Readonly<Record<string, CustomerCareCrmProfileInput>>;
  },
): Promise<CrmAdsExportOutcome> {
  let loaded: Awaited<ReturnType<typeof loadCrmPages>>;
  try {
    // `retryIdentity` + `strictAllPages`: main reads every page's latest identity and fails closed if any page fails.
    loaded = await loadCrmPages(list, CRM_MAX_PAGES, { retryIdentity: true, strictAllPages: true });
  } catch {
    return { ok: false, message: CRM_EXPORT_REREAD_FAILED };
  }
  if (!loaded.ok) return { ok: false, message: CRM_EXPORT_REREAD_FAILED };
  if (loaded.workspaceId !== options.workspaceId()) return { ok: false, message: CRM_EXPORT_SCOPE_CHANGED };
  const result = await buildMetaCustomAudienceCsv(
    loaded.rows,
    target,
    { identityEnabled: loaded.identityEnabled, identityUnavailable: loaded.identityUnavailable },
    options.drafts(),
  );
  return { ok: true, result, truncated: loaded.truncated };
}
