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
  | 'invalid-response';

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
}
