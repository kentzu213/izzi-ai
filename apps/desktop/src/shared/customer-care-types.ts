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
  }
  | { state: 'not_connected' }
  | { state: 'unavailable' }
  | { state: 'unsupported' };

export interface CustomerCareSnapshot {
  workspaceId: string;
  setup: CustomerCareSetup | null;
  blockers: string[];
  pageConnection: CustomerCarePageConnection;
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
  reason: 'eligible' | 'missing_moderate_task' | 'missing_page_token';
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

export type CustomerCareFacebookActionResult = { ok: true; snapshot: CustomerCareSnapshot } | CustomerCareFacebookFailure;

/** Renderer input for Page selection; main validates both fields before use. */
export interface CustomerCareFacebookSelectInput {
  choiceId: string;
  pageId: string;
}

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
}

/** An active owner, manager or editor of the workspace; `label` is null when no safe name could be shown. */
export interface CustomerCareCrmAssignee {
  userId: string;
  label: string | null;
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
  }
  | CustomerCareFacebookFailure;

/** Someone else saved first: nothing was overwritten, and `row` is the current state on the server. */
export interface CustomerCareCrmConflict {
  ok: false;
  error: 'profile_conflict';
  workspaceId: string;
  row: CustomerCareCrmRow;
}

export type CustomerCareCrmSaveResult =
  | { ok: true; workspaceId: string; row: CustomerCareCrmRow }
  | CustomerCareCrmConflict
  | CustomerCareFacebookFailure;

/** Renderer inputs; the workspace always comes from main's live authority. */
export interface CustomerCareCrmListInput {
  cursor: string | null;
}

export interface CustomerCareCrmSaveInput {
  leadId: string;
  /** The `updatedAt` the edit was made against; null for a first save. */
  expectedUpdatedAt: string | null;
  profile: CustomerCareCrmProfileInput;
}
