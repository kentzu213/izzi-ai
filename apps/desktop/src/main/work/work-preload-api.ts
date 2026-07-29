/**
 * Public preload shape for the Personal Office work engine.
 *
 * Every operation carries an explicit workspace scope. The renderer may state
 * which workspace it is acting in, but main remains authoritative: work-ipc
 * resolves the signed-in identity and verifies that scope before reading or
 * mutating anything.
 *
 * This module is deliberately Electron-free so the shape can be imported by
 * preload, tests, and a future typed renderer declaration without pulling main
 * process capabilities into the renderer bundle.
 *
 * @module main/work/work-preload-api
 */
import type {
  WorkApproval,
  WorkApprovalDecision,
  WorkApprovalReceipt,
  WorkCheckpointCursor,
  WorkEvent,
  WorkRun,
} from './work-types';
import type { WorkRunBundle } from './work-service';

export const WORK_IPC_CHANNELS = Object.freeze({
  listRuns: 'work:listRuns',
  getRun: 'work:getRun',
  listEvents: 'work:listEvents',
  listEventsSince: 'work:listEventsSince',
  latestEventSeq: 'work:latestEventSeq',
  listLineage: 'work:listLineage',
  listPendingApprovals: 'work:listPendingApprovals',
  createRun: 'work:createRun',
  decideApproval: 'work:decideApproval',
  resume: 'work:resume',
  event: 'work:event',
} as const);

export interface WorkWorkspaceRequest {
  workspaceId: string;
}

export interface WorkListRunsRequest extends WorkWorkspaceRequest {
  limit?: number;
}

export interface WorkRunRequest extends WorkWorkspaceRequest {
  runId: string;
}

export interface WorkListEventsRequest extends WorkRunRequest {
  afterRunSeq?: number;
  limit?: number;
}

export interface WorkListEventsSinceRequest extends WorkWorkspaceRequest {
  afterSeq?: number;
  limit?: number;
}

export interface WorkPendingApprovalsRequest extends WorkWorkspaceRequest {
  runId?: string;
}

export interface WorkCreateRunRequest extends WorkWorkspaceRequest {
  title?: string;
  brief: string;
}

export interface WorkDecideApprovalRequest extends WorkWorkspaceRequest {
  approvalId: string;
  decision: WorkApprovalDecision;
  note?: string;
  editedInput?: unknown;
}

export type WorkIpcFailure =
  | 'invalid-request'
  | 'not-authenticated'
  | 'forbidden'
  | 'invalid-state'
  | 'already-decided'
  | 'missing-edited-input'
  | 'expired'
  | 'plan-changed'
  | 'artifact-changed'
  | 'context-changed'
  | 'binding-tampered';

export type WorkApprovalDecisionResponse =
  | {
      ok: true;
      approval: WorkApproval;
      receipt: WorkApprovalReceipt;
      duplicate: boolean;
    }
  | { ok: false; reason: WorkIpcFailure; approval?: WorkApproval };

export type WorkResumeResponse =
  | { ok: true; run: WorkRun; cursor: WorkCheckpointCursor }
  | { ok: false; reason: WorkIpcFailure };

export interface WorkPreloadApi {
  listRuns(input: WorkListRunsRequest): Promise<WorkRun[]>;
  getRun(input: WorkRunRequest): Promise<WorkRunBundle | null>;
  listEvents(input: WorkListEventsRequest): Promise<WorkEvent[]>;
  listEventsSince(input: WorkListEventsSinceRequest): Promise<WorkEvent[]>;
  latestEventSeq(input: WorkWorkspaceRequest): Promise<number>;
  listLineage(input: WorkRunRequest): Promise<WorkRun[]>;
  listPendingApprovals(input: WorkPendingApprovalsRequest): Promise<WorkApproval[]>;
  createRun(input: WorkCreateRunRequest): Promise<WorkRun | null>;
  decideApproval(input: WorkDecideApprovalRequest): Promise<WorkApprovalDecisionResponse>;
  resume(input: WorkRunRequest): Promise<WorkResumeResponse>;
  onEvent(workspaceId: string, listener: (event: WorkEvent) => void): () => void;
}
