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

export interface CustomerCareSnapshot {
  workspaceId: string;
  setup: CustomerCareSetup | null;
  blockers: string[];
  mode: 'shadow';
  outboundEnabled: false;
  encryptedStorageAvailable: boolean;
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
