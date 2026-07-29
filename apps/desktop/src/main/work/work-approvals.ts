/**
 * Approval validity and receipts.
 *
 * An approval is a promise about a *specific* action. Between the moment a human
 * sees it and the moment an executor would act on it, the world can move: the
 * plan can be rewritten, a newer artifact version can be produced, the context
 * can be recompiled, the window can lapse. Honouring the approval anyway is how
 * a user ends up publishing something they never saw.
 *
 * So validity is re-derived at decision time from the immutable binding, and a
 * mismatch fails closed with a reason the UI can explain.
 *
 * @module main/work/work-approvals
 */
import {
  WORK_EVENT_PAYLOAD_VERSION,
  type WorkApproval,
  type WorkApprovalDecision,
  type WorkApprovalInvalidReason,
  type WorkApprovalReceipt,
  type WorkApprovalStatus,
} from './work-types';
import { computeActionHash } from './work-hash';

/** Live facts the approval is re-checked against. */
export interface ApprovalValidityContext {
  /** ISO timestamp treated as "now". Injected so expiry is testable. */
  now: string;
  /** The run's current plan hash. */
  planHash: string;
  /**
   * Current version of the artifact the approval is bound to, when it is bound
   * to one. `null`/absent means "unknown" and is not treated as a change.
   */
  currentArtifactVersion?: number | null;
  /** The run's current context snapshot id. */
  contextSnapshotId?: string | null;
}

export type ApprovalValidity =
  | { valid: true }
  | { valid: false; reason: WorkApprovalInvalidReason };

/**
 * Re-derive whether an approval still covers reality.
 *
 * Order matters: tampering is checked before anything else, because a binding
 * that no longer hashes to its stored `action_hash` means the row was edited
 * outside the service — nothing derived from it can be trusted, including its
 * expiry.
 */
export function evaluateApprovalValidity(
  approval: WorkApproval,
  context: ApprovalValidityContext,
): ApprovalValidity {
  if (computeActionHash(approval.binding) !== approval.actionHash) {
    return { valid: false, reason: 'binding-tampered' };
  }

  if (Date.parse(context.now) >= Date.parse(approval.expiresAt)) {
    return { valid: false, reason: 'expired' };
  }

  if (approval.binding.planHash !== context.planHash) {
    return { valid: false, reason: 'plan-changed' };
  }

  if (
    approval.binding.artifactId !== null &&
    typeof context.currentArtifactVersion === 'number' &&
    approval.binding.artifactVersion !== context.currentArtifactVersion
  ) {
    return { valid: false, reason: 'artifact-changed' };
  }

  const boundContext = approval.binding.contextSnapshotId ?? null;
  const liveContext = context.contextSnapshotId ?? null;
  if (boundContext !== liveContext) {
    return { valid: false, reason: 'context-changed' };
  }

  return { valid: true };
}

/** The status an invalidation reason maps to. */
export function statusForInvalidReason(reason: WorkApprovalInvalidReason): WorkApprovalStatus {
  return reason === 'expired' ? 'expired' : 'invalidated';
}

/** Terminal status a decision produces. `edit` is distinct from `approve` on purpose. */
export function statusForDecision(decision: WorkApprovalDecision): WorkApprovalStatus {
  if (decision === 'approve') return 'approved';
  if (decision === 'edit') return 'edited';
  return 'rejected';
}

export interface BuildReceiptInput {
  approval: WorkApproval;
  decision: WorkApprovalDecision;
  status: WorkApprovalStatus;
  /**
   * Hash of what was actually decided. Equals the proposal for approve/reject;
   * differs for `edit`, because the reviewer changed the action.
   */
  decidedActionHash: string;
  decidedBy: string;
  decidedAt: string;
}

/**
 * Build the audit receipt. `externalActionPerformed` is hard-coded `false`:
 * deciding an approval records consent, it never performs the effect. Executing
 * is a separate, later step that must present the receipt.
 */
export function buildReceipt(input: BuildReceiptInput): WorkApprovalReceipt {
  return {
    approvalId: input.approval.id,
    runId: input.approval.runId,
    decision: input.decision,
    status: input.status,
    decidedActionHash: input.decidedActionHash,
    proposedActionHash: input.approval.actionHash,
    decidedBy: input.decidedBy,
    decidedAt: input.decidedAt,
    externalActionPerformed: false,
    payloadVersion: WORK_EVENT_PAYLOAD_VERSION,
  };
}
