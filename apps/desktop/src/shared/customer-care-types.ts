/**
 * Customer-care shadow assistant contract. Drafts are produced locally for an
 * operator to review; nothing is sent, connected, or recorded as analytics.
 */

export type CustomerCareFactTopic = 'catalog' | 'price' | 'quality' | 'policy' | 'contact';

/** One merchant-approved statement. Only its exact `text` may appear in a draft. */
export interface CustomerCareFact {
  id: string;
  topic: CustomerCareFactTopic;
  text: string;
  source: string;
  approvedAt: string;
  expiresAt?: string;
}

/** Merchant setup. Page fields are operator-entered and never treated as a verified connection. */
export interface CustomerCareSetup {
  merchantName: string;
  pageId: string;
  pageName: string;
  handoffTarget: string;
  facts: CustomerCareFact[];
}

export type CustomerCareRole = 'owner' | 'manager' | 'editor' | 'reviewer' | 'viewer';

/** Resolved by main from the authenticated session; never accepted from the renderer. */
export interface CustomerCareAuthority {
  identityId: string;
  workspaceId: string;
  role: CustomerCareRole;
}

/**
 * Authority lookup outcome: an authority, `'unavailable'` when the server could not be reached
 * (timeout, network, 5xx, auth server down), or `null` for a genuine denial / sign-in requirement.
 * Neither non-authority value ever grants access.
 */
export type CustomerCareAuthorityLookup = CustomerCareAuthority | 'unavailable' | null;

/** One secondary Facebook Page verified for CRM sync/backfill in this workspace. */
export interface CustomerCareCrmSyncedPage {
  pageId: string;
  pageName: string | null;
  verifiedAt: string;
}

/**
 * The workspace's Facebook Page connection as verified by the izzi backend. `unavailable` means the
 * status could not be read; `unsupported` means the backend (or this build) has no Care Page routes.
 */
export type CustomerCarePageConnection =
  | {
    state: 'connected';
    pageId: string;
    pageName: string | null;
    status: 'active' | 'needs_reauth';
    missingScopes: string[];
    verifiedAt: string;
    crmPages?: CustomerCareCrmSyncedPage[];
  }
  | { state: 'not_connected' }
  | { state: 'unavailable' }
  | { state: 'unsupported' };

export interface CustomerCareSnapshot {
  workspaceId: string;
  setup: CustomerCareSetup | null;
  blockers: string[];
  pageConnection: CustomerCarePageConnection;
  /** Secondary CRM-synced Pages when verified on the backend. */
  crmPages?: CustomerCareCrmSyncedPage[];
  /** Display hint only: whether the caller's role may connect, select or disconnect the Page. Main re-checks. */
  canManagePage: boolean;
  mode: 'shadow';
  modeReasons: string[];
  outboundEnabled: false;
  encryptedStorageAvailable: boolean;
}

/** One Page offered after Facebook Login. Tokens never leave the backend. */
export interface CustomerCareFacebookPageChoice {
  pageId: string;
  name: string | null;
  eligible: boolean;
  reason: 'eligible' | 'missing_moderate_task' | 'missing_page_token' | 'missing_messaging_scope';
}

/** Bounded backend reasons a 4xx Care Facebook answer may carry. */
export const CUSTOMER_CARE_FACEBOOK_REJECT_REASONS = [
  'invalid_request',
  'invalid_code',
  'not_found',
  'replayed',
  'expired',
  'tenant_mismatch',
  'platform_mismatch',
  'actor_mismatch',
  'choice_not_found',
  'choice_expired',
  'choice_consumed',
  'page_not_eligible',
  // 502: Facebook answered, but the token does not prove this Page; reconnecting helps.
  'token_invalid',
  'token_app_mismatch',
  'token_page_mismatch',
  // 422, Phase B1: no live Page binding for the inbox, or a lead outside this workspace.
  'page_not_connected',
  'lead_not_found',
  // 422, Phase C: automatic replies need the inbox on and the pages_messaging grant.
  'inbox_off',
  'permission_missing',
  // Care CRM S2: set by the CRM client on a 429 (reported as `unavailable`), so the screen skips a refresh.
  'rate_limited',
  // Care CRM S2, 403 on a save: the chosen owner is no longer an active owner, manager or editor.
  'owner_not_eligible',
  // Care CRM S3, the identity card (backend bae6259). 422: the customer did not agree, the 24-hour window
  // closed, or the shop already asked twice; 409 an identity run is in progress.
  'consent_required',
  'outside_window',
  'ask_limit',
  'identity_running',
  // 429 on a refresh: the workspace used today's identity runs.
  'daily_cap',
  // 503: the AI customer profile is off for this workspace.
  'profile_ai_off',
  // 502: the model did not answer, or Facebook refused / did not take the consent question.
  'ai_unavailable',
  'provider_rejected',
  'provider_timeout',
  'provider_unavailable',
] as const;
export type CustomerCareFacebookRejectReason = (typeof CUSTOMER_CARE_FACEBOOK_REJECT_REASONS)[number];

/** Bounded failure codes for the Page connect flow; the renderer maps them to Vietnamese text. */
export type CustomerCareFacebookError =
  | 'auth'
  | 'forbidden'
  | 'access_changed'
  | 'invalid_input'
  | 'declined'
  | 'expired'
  | 'unsupported'
  | 'unavailable'
  | 'not_configured'
  | 'rejected'
  | 'page_bound_elsewhere'
  | 'no_pages'
  | 'invalid-response'
  // Phase C: automatic replies need a saved Care setup to answer from.
  | 'setup_required';

export interface CustomerCareFacebookFailure {
  ok: false;
  error: CustomerCareFacebookError;
  reason?: CustomerCareFacebookRejectReason;
}

/** Pushed to the renderer on `customerCare:facebookPageChoices` after the Facebook Login deep link. */
export type CustomerCareFacebookChoicesEvent =
  | {
    ok: true;
    choiceId: string;
    expiresAt: string;
    pages: CustomerCareFacebookPageChoice[];
    missingScopes: string[];
  }
  | CustomerCareFacebookFailure;

export type CustomerCareFacebookConnectResult = { ok: true } | CustomerCareFacebookFailure;

export const CUSTOMER_CARE_BACKFILL_SKIP_REASONS = [
  'permission_missing',
  'token_invalid',
  'bound_elsewhere',
  'provider_error',
] as const;
export type CustomerCareBackfillSkipReason = (typeof CUSTOMER_CARE_BACKFILL_SKIP_REASONS)[number];

export interface CustomerCareBackfillSkippedPage {
  pageId: string;
  pageName: string | null;
  reason: CustomerCareBackfillSkipReason;
}

/** Summary returned after backfilling recent Messenger history (up to 90 days) from one or more Pages into CRM. */
export interface CustomerCareBackfillSummary {
  pagesProcessed: number;
  conversationsScanned: number;
  leadsImported: number;
  messagesStored: number;
  namesSealed: number;
  skippedPages?: CustomerCareBackfillSkippedPage[];
}

export type CustomerCareSelectPageResult =
  | { ok: true; snapshot: CustomerCareSnapshot; backfill?: CustomerCareBackfillSummary }
  | CustomerCareFacebookFailure;

export type CustomerCareFacebookActionResult = CustomerCareSelectPageResult;

/** Renderer input for Page selection / multi-Page CRM backfill; main validates every field strictly before use. */
export interface CustomerCareSelectPageInput {
  choiceId?: string;
  pageId: string;
  backfillPageIds?: string[];
  importOnly?: boolean;
  backfillCurrent?: boolean;
}

export type CustomerCareFacebookSelectInput = CustomerCareSelectPageInput;

// Phase B1: izzi reads Page messages and lists customers who left a phone number. Nothing is ever sent
// to a customer. Lead phones and messages live in memory for display only: never persisted or tracked.

/** The Page's Messenger webhook subscription as reported by the izzi backend. */
export interface CustomerCareInboxState {
  enabled: boolean;
  subscribedAt: string | null;
  /** When izzi last stored a customer message for this workspace. */
  lastEventAt: string | null;
}

export const CUSTOMER_CARE_LEAD_STATUSES = ['new', 'contacted', 'closed'] as const;
export type CustomerCareLeadStatus = (typeof CUSTOMER_CARE_LEAD_STATUSES)[number];

export interface CustomerCareLeadMessage {
  text: string;
  at: string;
}

export interface CustomerCareLead {
  id: string;
  pageId: string;
  customerName: string | null;
  /** Normalized Vietnamese mobile, `0xxxxxxxxx`. */
  phone: string;
  zaloMentioned: boolean;
  status: CustomerCareLeadStatus;
  phoneCapturedAt: string;
  lastMessageAt: string;
  statusChangedAt: string | null;
  /** Up to 3 customer messages, oldest first, plain text. */
  recentMessages: CustomerCareLeadMessage[];
}

/** `inbox` is null without a live Page binding; `canManage` is a display hint, main re-checks the role. */
export type CustomerCareInboxResult =
  | { ok: true; workspaceId: string; inbox: CustomerCareInboxState | null; canManage: boolean }
  | CustomerCareFacebookFailure;

export type CustomerCareLeadListResult =
  | { ok: true; workspaceId: string; leads: CustomerCareLead[]; nextCursor: string | null }
  | CustomerCareFacebookFailure;

export type CustomerCareLeadStatusResult =
  | { ok: true; workspaceId: string; lead: CustomerCareLead }
  | CustomerCareFacebookFailure;

/** B1b: the customer's lead and every message izzi stored for them are deleted on the server. */
export type CustomerCareLeadPurgeResult =
  | { ok: true; workspaceId: string; leadId: string }
  | CustomerCareFacebookFailure;

/** Renderer inputs; the workspace always comes from main's live authority. */
export interface CustomerCareInboxInput {
  enabled: boolean;
}

export interface CustomerCareLeadListInput {
  cursor: string | null;
}

export interface CustomerCareLeadStatusInput {
  leadId: string;
  status: CustomerCareLeadStatus;
}

export interface CustomerCareLeadPurgeInput {
  leadId: string;
}

// Phase C: the izzi server answers Page customers by itself, from the shop's approved facts, until the
// customer leaves a phone number, declines, or someone else replies from the Page. Owner/manager switch.

/** Bounded codes for the last reply izzi did not send; the renderer maps them to Vietnamese text. */
export const CUSTOMER_CARE_AUTO_REPLY_PROBLEMS = [
  'standby',
  'outside_window',
  'page_limit',
  'declined',
  'other_app',
  'recipient_not_allowed',
  'recipient_unavailable',
  'token_invalid',
  'token_unreadable',
  'permission_missing',
  'rate_limited',
  'invalid_script',
  'message_unreadable',
  'switched_off',
  'unknown',
] as const;
export type CustomerCareAutoReplyProblem = (typeof CUSTOMER_CARE_AUTO_REPLY_PROBLEMS)[number];

export interface CustomerCareAutoReplyState {
  enabled: boolean;
  enabledAt: string | null;
  /** The izzi server allows automatic replies (deployment switch). */
  available: boolean;
  /** When the facts izzi answers with were last uploaded from this app. */
  scriptUpdatedAt: string | null;
  factCount: number;
  sentLast24h: number;
  lastSentAt: string | null;
  stoppedLast24h: number;
  lastProblem: { reason: CustomerCareAutoReplyProblem; at: string } | null;
}

/** `autoReply` is null without a live Page binding; `canManage` is a display hint, main re-checks the role. */
export type CustomerCareAutoReplyResult =
  | { ok: true; workspaceId: string; autoReply: CustomerCareAutoReplyState | null; canManage: boolean }
  | CustomerCareFacebookFailure;

/** Renderer input; main builds the script from the saved setup itself. */
export interface CustomerCareAutoReplyInput {
  enabled: boolean;
}

export type CustomerCareMessageRole = 'customer' | 'sale';

export interface CustomerCareMessage {
  role: CustomerCareMessageRole;
  text: string;
}

/** Operator-supplied simulation state. It is not inferred from customer text. */
export type CustomerCareContactPermission = 'unknown' | 'zalo_only' | 'call_allowed' | 'declined';

export type CustomerCareAssistRequest = 'reply' | 'price_objection' | 'handoff';

export interface CustomerCareAssistInput {
  messages: CustomerCareMessage[];
  contactPermission: CustomerCareContactPermission;
  request: CustomerCareAssistRequest;
  synthetic: boolean;
}

export type CustomerCareNextAction = 'ask_contact' | 'answer' | 'handoff' | 'respect_decline';

export interface CustomerCareAssistResult {
  status: 'draft' | 'blocked' | 'error';
  text: string;
  factIds: string[];
  unresolvedQuestions: string[];
  nextAction: CustomerCareNextAction;
  contactDetected: boolean;
  callAllowed: boolean;
  zaloAllowed: boolean;
  externalActionPerformed: false;
  synthetic: boolean;
  error?: string;
  engine: 'model' | 'rules';
}

export interface CustomerCareMutationResult {
  ok: boolean;
  snapshot?: CustomerCareSnapshot;
  error?: string;
  /** Phase C, only while automatic replies are on: whether the server now answers with the saved facts. */
  autoReplyScript?: 'updated' | 'failed';
}

// Care CRM S2: staff keep a hand-filled profile per Care lead and work a call list in MyGraph → CRM. Rows
// live in memory for display only; nothing is written to graph nodes, SQLite, settings, logs or files.

export const CUSTOMER_CARE_CRM_STAGES = [
  'has_phone',
  'consulting',
  'deposit',
  'delivered',
  'lost',
  'do_not_contact',
] as const;
export type CustomerCareCrmStage = (typeof CUSTOMER_CARE_CRM_STAGES)[number];

export const CUSTOMER_CARE_CRM_OCCASIONS = ['new_home', 'tet', 'anniversary', 'gift', 'replacement', 'other'] as const;
export type CustomerCareCrmOccasion = (typeof CUSTOMER_CARE_CRM_OCCASIONS)[number];

/** Chosen by staff; never inferred. */
export const CUSTOMER_CARE_CRM_ADDRESS_FORMS = ['anh', 'chi', 'co', 'chu', 'ban'] as const;
export type CustomerCareCrmAddressForm = (typeof CUSTOMER_CARE_CRM_ADDRESS_FORMS)[number];

export const CUSTOMER_CARE_CRM_LOST_REASONS = ['price', 'bought_elsewhere', 'no_reply', 'not_needed', 'other'] as const;
export type CustomerCareCrmLostReason = (typeof CUSTOMER_CARE_CRM_LOST_REASONS)[number];

/** The roles the CRM routes answer for; a viewer or reviewer gets 403. */
export const CUSTOMER_CARE_CRM_ROLES = ['owner', 'manager', 'editor'] as const;
export type CustomerCareCrmRole = (typeof CUSTOMER_CARE_CRM_ROLES)[number];

/** The editable profile: a full replace on every save, never a patch. */
export interface CustomerCareCrmProfileInput {
  stage: CustomerCareCrmStage;
  ownerUserId: string | null;
  addressForm: CustomerCareCrmAddressForm | null;
  occasion: CustomerCareCrmOccasion | null;
  /** `YYYY-MM-DD`. */
  neededBy: string | null;
  /** Ids of the shop's approved Care facts; at most 8. */
  productFactIds: string[];
  nextStep: string | null;
  /** ISO timestamp. */
  nextStepDueAt: string | null;
  /** Only when `stage` is `lost`. */
  lostReason: CustomerCareCrmLostReason | null;
  /** `YYYY-MM-DD`, only when `stage` is `deposit` or `delivered`. */
  purchasedAt: string | null;
  note: string | null;
}

export interface CustomerCareCrmProfile extends CustomerCareCrmProfileInput {
  /** Null until the first save; a save carries it back as `expectedUpdatedAt`. */
  updatedAt: string | null;
  updatedBy: string | null;
  /**
   * Present only when the server could not open the sealed details: the detail fields came back empty, the
   * row is shown read-only and is never saved (the server would answer 503).
   */
  detailsUnreadable?: true;
}

export interface CustomerCareCrmRow {
  leadId: string;
  pageId: string;
  customerName: string | null;
  /** Normalized Vietnamese mobile, `0xxxxxxxxx`. */
  phone: string;
  zaloMentioned: boolean;
  leadStatus: CustomerCareLeadStatus;
  phoneCapturedAt: string;
  lastMessageAt: string;
  /** Up to 3 customer messages, oldest first, plain text. */
  recentMessages: CustomerCareLeadMessage[];
  profile: CustomerCareCrmProfile;
  /** Care CRM S3: present on every row when the server answered `include=identity`; absent from an older server. */
  identity?: CustomerCareCrmIdentity;
  /** Care CRM S3: the server sent this row's identity but it could not be read; the row itself is shown as usual. */
  identityUnavailable?: true;
}

/** An active owner, manager or editor of the workspace; `label` is null when no safe name could be shown. */
export interface CustomerCareCrmAssignee {
  userId: string;
  label: string | null;
}

/** One Facebook Page that contributed leads to this workspace's CRM (`GET /crm?include=identity,pages`). */
export interface CustomerCareCrmPageSource {
  pageId: string;
  pageName: string | null;
}

/** `canDelete` is a display hint for the existing purge; main and the server re-check the role. */
export type CustomerCareCrmListResult =
  | {
    ok: true;
    workspaceId: string;
    role: CustomerCareCrmRole;
    canDelete: boolean;
    rows: CustomerCareCrmRow[];
    nextCursor: string | null;
    assignees: CustomerCareCrmAssignee[];
    pages?: CustomerCareCrmPageSource[];
    /**
     * Care CRM S3: whether the AI customer profile is on for this workspace; null when the server sent no identity
     * at all (a server without S3), so the rows carry none.
     */
    identityEnabled: boolean | null;
    /**
     * Care CRM S3: the identity could not be loaded for this page (the identity read failed and the list was read
     * without it, or the answer's identity part was unreadable); the table is shown without it.
     */
    identityUnavailable: boolean;
    /** Care CRM S3: the exact consent question "Xin phép khách" would send now; null while asks are off. */
    consentAsk: CustomerCareCrmConsentAsk | null;
  }
  | CustomerCareFacebookFailure;

/**
 * Someone else saved first: nothing was overwritten, and `profile` is the current state on the server. Only
 * the profile is handed back: after a save the server may not be able to present the lead's phone and
 * messages, so the screen keeps the ones it already shows.
 */
export interface CustomerCareCrmConflict {
  ok: false;
  error: 'profile_conflict';
  workspaceId: string;
  leadId: string;
  profile: CustomerCareCrmProfile;
}

/** A committed save answers with the stored profile; the screen merges it into the row it shows. */
export type CustomerCareCrmSaveResult =
  | { ok: true; workspaceId: string; leadId: string; profile: CustomerCareCrmProfile }
  | CustomerCareCrmConflict
  | CustomerCareFacebookFailure;

// Care CRM S3 identity (spec 2026-11-25, section 5; backend bae6259). Main asks `GET /crm` with `include=identity`
// and parses the block exactly; an older server answers without it, and the rows then carry none. Like every CRM
// row it lives in renderer memory for display only. Every field may be null.

export const CUSTOMER_CARE_CRM_ID_CONFIDENCES = ['low', 'medium', 'high'] as const;
/** Server-computed: said directly = high, two or more signals = medium, one signal = low (never shown). */
export type CustomerCareCrmIdConfidence = (typeof CUSTOMER_CARE_CRM_ID_CONFIDENCES)[number];

export const CUSTOMER_CARE_CRM_ID_KINDS = ['stated', 'inferred'] as const;
export const CUSTOMER_CARE_CRM_ID_SOURCES = ['ai', 'staff', 'meta', 'ad'] as const;
export const CUSTOMER_CARE_CRM_ID_STATUSES = ['suggested', 'confirmed', 'corrected'] as const;
export const CUSTOMER_CARE_CRM_EVIDENCE_SOURCES = ['customer', 'page', 'izzi', 'ad', 'link', 'note'] as const;

export interface CustomerCareCrmEvidence {
  source: (typeof CUSTOMER_CARE_CRM_EVIDENCE_SOURCES)[number];
  at: string;
  /** At most 80 characters, masked by the server. */
  quote: string | null;
}

/** One identity field: its value, how it was reached, and up to two pieces of evidence. */
export interface CustomerCareCrmIdField<T> {
  value: T;
  confidence: CustomerCareCrmIdConfidence;
  kind: (typeof CUSTOMER_CARE_CRM_ID_KINDS)[number];
  source: (typeof CUSTOMER_CARE_CRM_ID_SOURCES)[number];
  status: (typeof CUSTOMER_CARE_CRM_ID_STATUSES)[number];
  updatedAt: string;
  evidence: CustomerCareCrmEvidence[];
}

export const CUSTOMER_CARE_CRM_CONSENT_STATES = ['unknown', 'asked', 'granted', 'declined', 'withdrawn'] as const;
export type CustomerCareCrmConsentState = (typeof CUSTOMER_CARE_CRM_CONSENT_STATES)[number];

export interface CustomerCareCrmConsent {
  state: CustomerCareCrmConsentState;
  at: string | null;
  noMarketing: boolean;
  canAsk: boolean;
  /**
   * When the customer sent "XOÁ" without having been told about it: nothing was purged and staff decide. Absent
   * from a server older than CRM S3 round 3.
   */
  eraseRequestedAt?: string | null;
}

/** The consent question exactly as the server would send it (disclosure, consent line, privacy link). */
export interface CustomerCareCrmConsentAsk {
  text: string;
  copyVersion: number;
}

export const CUSTOMER_CARE_CRM_TIMELINES = ['this_week', 'this_month', 'before_tet', 'later'] as const;
export type CustomerCareCrmTimeline = (typeof CUSTOMER_CARE_CRM_TIMELINES)[number];

/** Shown as an estimate ("ước tính"): one band, or two adjacent ones. */
export const CUSTOMER_CARE_CRM_AGE_BANDS = ['18-24', '25-34', '35-44', '45-54', '55+'] as const;
export type CustomerCareCrmAgeBand = (typeof CUSTOMER_CARE_CRM_AGE_BANDS)[number];

/** Who the purchase is for; always backed by a customer quote. Never marital status. */
export const CUSTOMER_CARE_CRM_RECIPIENTS = ['self', 'spouse', 'parents', 'children', 'household', 'gift'] as const;
export type CustomerCareCrmRecipient = (typeof CUSTOMER_CARE_CRM_RECIPIENTS)[number];

export const CUSTOMER_CARE_CRM_BUDGET_BANDS = ['under_5m', '5m_15m', '15m_30m', '30m_plus'] as const;
export type CustomerCareCrmBudgetBand = (typeof CUSTOMER_CARE_CRM_BUDGET_BANDS)[number];

export const CUSTOMER_CARE_CRM_PERSONAS = ['P1', 'P2', 'P3', 'P4'] as const;
export type CustomerCareCrmPersona = (typeof CUSTOMER_CARE_CRM_PERSONAS)[number];

/** A link the customer shared: the title and the domain only, never the address. */
export interface CustomerCareCrmSharedLink {
  title: string | null;
  domain: string;
}

/** No gender field exists: the form of address (`addressForm`) is what staff use. */
export interface CustomerCareCrmIdentity {
  version: string | null;
  lastRunAt: string | null;
  consent: CustomerCareCrmConsent | null;
  occasion: CustomerCareCrmIdField<CustomerCareCrmOccasion> | null;
  timeline: CustomerCareCrmIdField<CustomerCareCrmTimeline> | null;
  productFactIds: CustomerCareCrmIdField<string[]> | null;
  addressForm: CustomerCareCrmIdField<CustomerCareCrmAddressForm> | null;
  ageBand: CustomerCareCrmIdField<CustomerCareCrmAgeBand[]> | null;
  family: CustomerCareCrmIdField<{ recipient: CustomerCareCrmRecipient }> | null;
  interests: {
    adTitle: CustomerCareCrmIdField<string> | null;
    sharedLinks: CustomerCareCrmIdField<CustomerCareCrmSharedLink>[];
    budgetBand: CustomerCareCrmIdField<CustomerCareCrmBudgetBand> | null;
  } | null;
  persona: (CustomerCareCrmIdField<CustomerCareCrmPersona> & { summary: string }) | null;
}

/** Renderer inputs; the workspace always comes from main's live authority. */
export interface CustomerCareCrmListInput {
  cursor: string | null;
  /** Care CRM S3, first page of "Làm mới" only: try the identity read again even while main has paused it. */
  retryIdentity?: true;
}

export interface CustomerCareCrmSaveInput {
  leadId: string;
  /** The `updatedAt` the edit was made against; null for a first save. */
  expectedUpdatedAt: string | null;
  profile: CustomerCareCrmProfileInput;
}

// Care CRM S3 staff actions on the identity card (`POST /crm/identity`, `POST /crm/identity/refresh`). Every
// action is started by a person; nothing here polls. The workspace always comes from main's live authority.

/** The identity fields a staff action names. `adTitle` is never one: it comes from the ad. */
export const CUSTOMER_CARE_CRM_IDENTITY_FIELDS = [
  'occasion', 'timeline', 'productFactIds', 'addressForm', 'ageBand', 'family', 'persona', 'budgetBand', 'sharedLink',
] as const;
export type CustomerCareCrmIdentityField = (typeof CUSTOMER_CARE_CRM_IDENTITY_FIELDS)[number];

/** Allowed before the customer agreed; every other field is the profile layer. */
export const CUSTOMER_CARE_CRM_ORDER_FIELDS: readonly CustomerCareCrmIdentityField[] = ['occasion', 'timeline', 'productFactIds'];

// clear_erase_request (owner/manager): the customer changed their mind about a pending "XOÁ" (backend 79e14f9).
export const CUSTOMER_CARE_CRM_IDENTITY_ACTIONS = [
  'confirm', 'correct', 'reject', 'ask_consent', 'withdraw_consent', 'clear_erase_request',
] as const;
export type CustomerCareCrmIdentityAction = (typeof CUSTOMER_CARE_CRM_IDENTITY_ACTIONS)[number];

/**
 * confirm / correct / reject carry `field` and `expectedVersion` (the identity `version` the card opened with);
 * `correct` adds `value` (the field's type), `sharedLink` adds `index` (0–2). ask_consent, withdraw_consent and
 * clear_erase_request carry only `leadId` and `action`. Main checks the exact key set for each action.
 */
export interface CustomerCareCrmIdentityActionInput {
  leadId: string;
  action: CustomerCareCrmIdentityAction;
  field?: CustomerCareCrmIdentityField;
  value?: unknown;
  index?: number;
  expectedVersion?: string | null;
}

export interface CustomerCareCrmIdentityRefreshInput {
  leadId: string;
}

/**
 * The identity after the action. `identity_conflict`: someone (or an AI run) changed it first; nothing was written
 * and `identity` is the current one.
 */
export type CustomerCareCrmIdentityActionResult =
  | { ok: true; workspaceId: string; leadId: string; identity: CustomerCareCrmIdentity }
  | { ok: false; error: 'identity_conflict'; workspaceId: string; leadId: string; identity: CustomerCareCrmIdentity }
  | CustomerCareFacebookFailure;

/** `refresh_too_soon`: one refresh per customer every 10 minutes; `retryAfterSec` says when the next one may run. */
export type CustomerCareCrmIdentityRefreshResult =
  | { ok: true; workspaceId: string; leadId: string; identity: CustomerCareCrmIdentity; outcome: 'updated' | 'no_change' }
  | { ok: false; error: 'refresh_too_soon'; workspaceId: string; leadId: string; retryAfterSec: number }
  | CustomerCareFacebookFailure;
