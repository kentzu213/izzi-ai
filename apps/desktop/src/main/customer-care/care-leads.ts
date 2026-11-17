/**
 * Phase B1 Care lead rules: who may read leads or switch the Page inbox, and strict parsing of renderer
 * input. izzi only reads Page messages; nothing here sends anything to a customer. Lead phones and
 * messages stay in memory for display: this module never persists, logs or reports them.
 *
 * @module main/customer-care/care-leads
 */
import type {
  CustomerCareInboxInput,
  CustomerCareLead,
  CustomerCareLeadListInput,
  CustomerCareLeadStatusInput,
  CustomerCareRole,
} from '../../shared/customer-care-types';
import { isCareFacebookChoiceId, isCareLeadStatus, isCareLeadsCursor } from './care-facebook-client';

/** Mirrors the backend: owner, manager and editor read leads; a viewer or reviewer never sees a phone. */
export const CARE_LEAD_READ_ROLES: readonly CustomerCareRole[] = ['owner', 'manager', 'editor'];
/** Only owner and manager subscribe or unsubscribe the Page's messages. */
export const CARE_INBOX_MANAGE_ROLES: readonly CustomerCareRole[] = ['owner', 'manager'];

export function canReadCareLeads(role: CustomerCareRole): boolean {
  return CARE_LEAD_READ_ROLES.includes(role);
}

export function canManageCareInbox(role: CustomerCareRole): boolean {
  return CARE_INBOX_MANAGE_ROLES.includes(role);
}

function exactPlainRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return null;
  const actual = Object.keys(value);
  if (actual.length !== keys.length || !keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    return null;
  }
  return value as Record<string, unknown>;
}

/** `{ enabled }` only; any workspace, identity or token field rejects the input. */
export function parseCareInboxInput(input: unknown): CustomerCareInboxInput | null {
  const record = exactPlainRecord(input, ['enabled']);
  return record && typeof record.enabled === 'boolean' ? { enabled: record.enabled } : null;
}

/** `{ cursor }`: null for the first page, otherwise the opaque `nextCursor` main handed out. */
export function parseCareLeadListInput(input: unknown): CustomerCareLeadListInput | null {
  const record = exactPlainRecord(input, ['cursor']);
  if (!record) return null;
  if (record.cursor === null) return { cursor: null };
  return isCareLeadsCursor(record.cursor) ? { cursor: record.cursor } : null;
}

export function parseCareLeadStatusInput(input: unknown): CustomerCareLeadStatusInput | null {
  const record = exactPlainRecord(input, ['leadId', 'status']);
  if (!record || !isCareFacebookChoiceId(record.leadId) || !isCareLeadStatus(record.status)) return null;
  return { leadId: record.leadId, status: record.status };
}

/** A fresh copy, so the object handed to IPC shares nothing with the client's parse result. */
export function copyCareLead(lead: CustomerCareLead): CustomerCareLead {
  return { ...lead, recentMessages: lead.recentMessages.map((message) => ({ ...message })) };
}
