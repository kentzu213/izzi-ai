/**
 * Background "new lead" notifications (Phase B1). While someone with lead access (owner, manager, editor)
 * is signed in and the active workspace's Page inbox is on, main reads the first page of leads once a
 * minute and shows one notification when customers newly left a phone number. A workspace switch stops
 * watching the old workspace at once.
 *
 * Privacy: a notification carries fixed text (or a count), never a customer's name, phone or message.
 * The only thing kept on disk is the newest `phoneCapturedAt` already seen, per account and workspace.
 * Nothing is logged except fixed diagnostics.
 *
 * Request budget (backend limit: 30/min across all Care routes): one lead read per minute while the inbox
 * is on, plus one authority and one inbox read every few minutes.
 *
 * @module main/customer-care/care-lead-notifier
 */
import { createHash } from 'node:crypto';
import type { CustomerCareAuthorityLookup, CustomerCareLead } from '../../shared/customer-care-types';
import { ISO_PATTERN } from '../marketing/native-marketing-client';
import type { CareLeadsGateway } from './care-facebook-client';
import { canReadCareLeads } from './care-leads';

export const CARE_LEAD_POLL_MS = 60_000;
/** How long the resolved workspace, role and inbox state are reused before they are read again. */
export const CARE_LEAD_CONTEXT_TTL_MS = 5 * 60_000;
export const CARE_LEAD_NOTIFICATION_TITLE = 'Khách mới để lại số';
/**
 * Windows keeps toasts in Action Center and on the lock screen, so the text is fixed: never a customer's
 * name, phone or message. The Care screen shows who it is.
 */
export const CARE_LEAD_NOTIFICATION_BODY = 'Có khách mới để lại số';
/** More new leads than this in one check are announced with their count. */
export const CARE_LEAD_MAX_NOTIFICATIONS = 3;
/**
 * How far a `phoneCapturedAt` may run ahead of this machine's clock. A time further ahead is ignored for
 * notifications, so one skewed timestamp cannot move the mark into the future and silence later leads.
 */
export const CARE_LEAD_MAX_CLOCK_SKEW_MS = 5 * 60_000;
const MARK_PREFIX = 'customer_care_lead_seen:v1';
/** Stored when the first check finds no lead: every later lead is new. */
const NO_LEADS_MARK = '1970-01-01T00:00:00.000Z';

export interface CareLeadNotification {
  title: string;
  body: string;
}

export interface CareLeadNotifierOptions {
  resolveAuthority: () => Promise<CustomerCareAuthorityLookup>;
  currentIdentityId: () => string | null;
  /**
   * The workspace main stores as active for the signed-in account, read locally without a request.
   * When it no longer matches the watched one, the authority is read again at once.
   */
  currentWorkspaceId?: () => string | null;
  gateway: Pick<CareLeadsGateway, 'getInbox' | 'listLeads'>;
  store: { getSetting(key: string): string | null; setSetting(key: string, value: string): void };
  notify: (notification: CareLeadNotification) => void;
  /** Fixed diagnostics only; never receives lead data. */
  log?: (message: string) => void;
  now?: () => number;
}

/**
 * What one account may watch. `workspaceId` is null when it may not read leads there (role, backend
 * missing, inbox unreadable); `watching` is true only with a live Page whose inbox is on.
 * `authorityWorkspaceId` is the workspace the authority was resolved for, even when it grants nothing.
 */
interface WatchContext {
  identityId: string;
  authorityWorkspaceId: string | null;
  workspaceId: string | null;
  watching: boolean;
  checkedAt: number;
}

/** One notification per check, with fixed text; the count only when there are many. Never lead data. */
export function careLeadNotification(newLeadCount: number): CareLeadNotification {
  return {
    title: CARE_LEAD_NOTIFICATION_TITLE,
    body: newLeadCount > CARE_LEAD_MAX_NOTIFICATIONS
      ? `${newLeadCount} khách mới đã để lại số điện thoại.`
      : CARE_LEAD_NOTIFICATION_BODY,
  };
}

function newestCapturedAt(leads: readonly CustomerCareLead[]): string | null {
  let newest: string | null = null;
  for (const lead of leads) {
    if (newest === null || Date.parse(lead.phoneCapturedAt) > Date.parse(newest)) newest = lead.phoneCapturedAt;
  }
  return newest;
}

function markKey(identityId: string, workspaceId: string): string {
  const scope = createHash('sha256')
    .update(JSON.stringify(['customer-care-leads.v1', identityId, workspaceId]), 'utf8')
    .digest('hex');
  return `${MARK_PREFIX}:${scope}`;
}

export class CareLeadNotifier {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  /** A refresh arrived while a check was running: run one more check right after it. */
  private rerun = false;
  private context: WatchContext | null = null;
  /** Bumped by sign-out and stop: an answer that started under an older generation is dropped. */
  private generation = 0;
  private readonly now: () => number;

  constructor(private readonly options: CareLeadNotifierOptions) {
    this.now = options.now ?? Date.now;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => { void this.tick(); }, CARE_LEAD_POLL_MS);
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.rerun = false;
    this.reset();
  }

  /** Sign-out: forget the watched workspace and drop any answer still in flight. */
  reset(): void {
    this.generation += 1;
    this.context = null;
  }

  /** The inbox was switched: drop what is in flight and read workspace, role and inbox again now. */
  refresh(): void {
    this.reset();
    this.rerun = true;
    void this.tick();
  }

  /** Single-flight: a check that starts while another is running does nothing (a refresh queues one). */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.rerun = false;
    try {
      await this.check(this.generation);
    } catch {
      this.log('lead check failed');
    } finally {
      this.running = false;
      if (this.rerun) void this.tick();
    }
  }

  private async check(generation: number): Promise<void> {
    const identityId = this.identity();
    if (!identityId) {
      this.context = null;
      return;
    }
    const activeWorkspace = this.activeWorkspace();
    let context = this.context;
    if (!context || this.isStale(context, identityId, activeWorkspace)) {
      const resolved = await this.resolveContext(identityId);
      if (!resolved || !this.isCurrent(generation, identityId, activeWorkspace)) return;
      this.context = resolved;
      context = resolved;
    }
    const { workspaceId } = context;
    if (workspaceId === null) return;
    const key = markKey(identityId, workspaceId);
    const mark = this.readMark(key);
    // With the inbox off nothing new can arrive; a missing mark is still set so the first lead after
    // the inbox is switched on is notified instead of being taken for an old one.
    if (!context.watching && mark !== null) return;

    const result = await this.options.gateway.listLeads(workspaceId, null);
    if (!this.isCurrent(generation, identityId, activeWorkspace)) return;
    if (!result.ok) {
      if (result.error === 'forbidden' || result.error === 'auth') this.context = null;
      return;
    }
    const latestAllowed = this.now() + CARE_LEAD_MAX_CLOCK_SKEW_MS;
    const leads = result.value.leads.filter((lead) => Date.parse(lead.phoneCapturedAt) <= latestAllowed);
    const newest = newestCapturedAt(leads);
    // No mark yet, or one that lies beyond the allowed skew: start over from what is already there.
    if (mark === null || Date.parse(mark) > latestAllowed) {
      this.writeMark(key, newest ?? NO_LEADS_MARK);
      return;
    }
    const markMs = Date.parse(mark);
    const fresh = leads.filter((lead) => Date.parse(lead.phoneCapturedAt) > markMs);
    if (fresh.length === 0 || newest === null) return;
    // The mark moves first: a failed write must not turn into the same notification every minute.
    if (!this.writeMark(key, newest)) return;
    this.show(careLeadNotification(fresh.length));
  }

  /** Re-read workspace, role and inbox after the TTL, for another account, or once the workspace changed. */
  private isStale(context: WatchContext, identityId: string, activeWorkspace: string | null): boolean {
    if (context.identityId !== identityId) return true;
    if (this.now() - context.checkedAt >= CARE_LEAD_CONTEXT_TTL_MS) return true;
    return activeWorkspace !== null
      && context.authorityWorkspaceId !== null
      && activeWorkspace !== context.authorityWorkspaceId;
  }

  private async resolveContext(identityId: string): Promise<WatchContext | null> {
    const checkedAt = this.now();
    let authority: CustomerCareAuthorityLookup;
    try {
      authority = await this.options.resolveAuthority();
    } catch {
      return null;
    }
    // Unreachable: ask again on the next check rather than going quiet for minutes.
    if (authority === 'unavailable') return null;
    if (!authority || authority.identityId !== identityId) {
      return { identityId, authorityWorkspaceId: null, workspaceId: null, watching: false, checkedAt };
    }
    const unwatched = {
      identityId, authorityWorkspaceId: authority.workspaceId, workspaceId: null, watching: false, checkedAt,
    };
    if (!canReadCareLeads(authority.role)) return unwatched;
    const inbox = await this.options.gateway.getInbox(authority.workspaceId).catch(() => null);
    if (!inbox || (!inbox.ok && inbox.error === 'unavailable')) return null;
    if (!inbox.ok) return unwatched;
    return { ...unwatched, workspaceId: authority.workspaceId, watching: inbox.value?.enabled === true };
  }

  /** An answer applies only to the generation, account and active workspace it was asked under. */
  private isCurrent(generation: number, identityId: string, activeWorkspace: string | null): boolean {
    return generation === this.generation
      && this.identity() === identityId
      && this.activeWorkspace() === activeWorkspace;
  }

  private activeWorkspace(): string | null {
    try {
      const workspaceId = this.options.currentWorkspaceId?.();
      return typeof workspaceId === 'string' && workspaceId ? workspaceId : null;
    } catch {
      return null;
    }
  }

  private identity(): string | null {
    try {
      const identityId = this.options.currentIdentityId();
      return typeof identityId === 'string' && identityId ? identityId : null;
    } catch {
      return null;
    }
  }

  private readMark(key: string): string | null {
    try {
      const value = this.options.store.getSetting(key);
      return typeof value === 'string' && ISO_PATTERN.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
    } catch {
      return null;
    }
  }

  private writeMark(key: string, value: string): boolean {
    try {
      this.options.store.setSetting(key, value);
      return true;
    } catch {
      this.log('lead mark not saved');
      return false;
    }
  }

  private show(notification: CareLeadNotification): void {
    try {
      this.options.notify(notification);
    } catch {
      this.log('lead notification failed');
    }
  }

  private log(message: string): void {
    try {
      this.options.log?.(message);
    } catch {
      // Diagnostics must never break the check loop.
    }
  }
}
