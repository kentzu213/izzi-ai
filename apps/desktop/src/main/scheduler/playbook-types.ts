/**
 * Scheduled Sessions — playbook model (Requirement R2, R5.1).
 *
 * A playbook is data, not code: an ordered list of steps, each a concrete command plus the
 * directory it runs in. Keeping it declarative is what makes R5.1 hold — the app runs steps the
 * user picked from a template, it never assembles a shell string out of free-form model output.
 *
 * This module is pure (no fs, no child_process) so the rules can be unit-tested.
 */

/** A single step of a playbook. */
export interface PlaybookStep {
  /** Stable id inside the playbook; used in run records so a failure points at a known step. */
  id: string;
  /** Human label shown in the UI. */
  label: string;
  /** Executable to run. */
  command: string;
  /** Arguments passed as an array — never interpolated into a shell string. */
  args: string[];
  /**
   * Working directory. Relative paths resolve against the playbook's `workingDir`.
   * Kept explicit because the verified pipeline depends on cwd for its config/state files.
   */
  cwd?: string;
  /** Per-step timeout. Omitted → the playbook default. */
  timeoutMs?: number;
  /**
   * When true a non-zero exit does NOT stop the run (R2.3). Default false: a failed step stops
   * the pipeline so later steps cannot publish on top of an incomplete one (R2.2).
   */
  continueOnError?: boolean;
  /**
   * Browser profile directories this step needs an authenticated session in. Used by session
   * health (R4) to tell the user *which* profile to fix.
   */
  requiresProfiles?: string[];
}

/** A named, ordered pipeline the scheduler can run. */
export interface Playbook {
  id: string;
  name: string;
  /** One-line description shown when picking a playbook. */
  summary: string;
  /** Base working directory for steps that don't set their own. */
  workingDir: string;
  steps: PlaybookStep[];
  /** Default per-step timeout when a step does not set one. */
  defaultTimeoutMs: number;
  /**
   * Quality gates this playbook is expected to honour, for display only. The gates themselves live
   * in the pipeline scripts (that is where they can actually block a publish); listing them here
   * tells the user what protection they are getting.
   */
  gates?: string[];
}

/** Recurrence for a scheduled session (R1.1). */
export type ScheduleRecurrence =
  | { kind: 'daily' }
  | { kind: 'weekly'; days: Weekday[] };

export type Weekday = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';

export const WEEKDAYS: readonly Weekday[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/** Machine-state choices (R5.3) — defaults are deliberately the "actually runs" ones. */
export interface MachinePolicy {
  /** Run even when the device is on battery. Default true (skipped runs were a real failure). */
  runOnBattery: boolean;
  /** Wake the machine to run. Default true. */
  wakeToRun: boolean;
  /** Run as soon as possible after a missed start. Default true. */
  catchUpMissed: boolean;
}

export const DEFAULT_MACHINE_POLICY: MachinePolicy = {
  runOnBattery: true,
  wakeToRun: true,
  catchUpMissed: true,
};

/** A schedule as stored by the app. */
export interface ScheduledSession {
  id: string;
  name: string;
  playbookId: string;
  /** 24h local time, "HH:MM". */
  timeOfDay: string;
  recurrence: ScheduleRecurrence;
  machinePolicy: MachinePolicy;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type RunStatus = 'running' | 'success' | 'failed' | 'refused';

export interface RunStepResult {
  stepId: string;
  label: string;
  exitCode: number | null;
  startedAt: string;
  endedAt: string;
  /** Bounded captured output (R2.4). */
  output: string;
}

export interface SessionRun {
  id: string;
  sessionId: string;
  status: RunStatus;
  startedAt: string;
  endedAt: string | null;
  /** Step that failed, if any (R3.1). */
  failedStepId: string | null;
  steps: RunStepResult[];
  /** Session diagnosis derived from the failing output (R4.1), when applicable. */
  diagnosis?: SessionDiagnosis | null;
}

/** What a human has to do, when a run failed because a login session went bad (R4.1/R4.2). */
export type SessionIssueKind =
  | 'logged_out'
  | 'two_factor_required'
  | 'billing_blocked'
  | 'authorization_refused'
  | 'unknown';

export interface SessionDiagnosis {
  kind: SessionIssueKind;
  /** Profile directory the user should open, when the failing step declared one. */
  profileDir?: string;
  /** Short, plain-language action for the user. */
  action: string;
}

/** Validates a playbook shape enough to refuse obviously unrunnable data (R5.1). */
export function validatePlaybook(playbook: Playbook): string[] {
  const problems: string[] = [];
  if (!playbook.id.trim()) problems.push('playbook id is empty');
  if (!playbook.name.trim()) problems.push('playbook name is empty');
  if (!playbook.workingDir.trim()) problems.push('playbook workingDir is empty');
  if (!playbook.steps.length) problems.push('playbook has no steps');
  if (playbook.defaultTimeoutMs <= 0) problems.push('defaultTimeoutMs must be positive');

  const seen = new Set<string>();
  for (const [index, step] of playbook.steps.entries()) {
    const where = `step ${index + 1}`;
    if (!step.id.trim()) problems.push(`${where}: id is empty`);
    else if (seen.has(step.id)) problems.push(`${where}: duplicate id "${step.id}"`);
    else seen.add(step.id);
    if (!step.command.trim()) problems.push(`${where}: command is empty`);
    if (!Array.isArray(step.args)) problems.push(`${where}: args must be an array`);
    if (step.timeoutMs !== undefined && step.timeoutMs <= 0) {
      problems.push(`${where}: timeoutMs must be positive`);
    }
  }
  return problems;
}

/** Every profile any step of the playbook needs a live session in (R4.3). */
export function playbookProfiles(playbook: Playbook): string[] {
  const out = new Set<string>();
  for (const step of playbook.steps) {
    for (const profile of step.requiresProfiles ?? []) {
      if (profile.trim()) out.add(profile);
    }
  }
  return [...out];
}
