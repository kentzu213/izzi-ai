/**
 * Scheduled Sessions — the side-effecting service (spec: scheduled-sessions).
 *
 * Split of responsibility: every rule that decides *what* to do lives in schedule-planner.ts and is
 * unit-tested; this file only performs effects (OS scheduler, child processes, database, opening a
 * browser profile) using those decisions.
 *
 * Safety notes:
 * - Commands come from built-in playbooks the user selected; nothing is assembled from free-form
 *   text (R5.1). Steps are spawned with an argument array, never through a shell.
 * - Nothing here reads, stores or logs credentials (R5.2). Browser profiles are opened, never
 *   automated or scraped.
 */
import { randomUUID } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { DatabaseManager, ScheduledSessionRow, ScheduledSessionRunRow } from '../db/database.js';
import {
  BUILTIN_PLAYBOOKS,
  findPlaybook,
} from './playbook-templates.js';
import {
  DEFAULT_MACHINE_POLICY,
  playbookProfiles,
  type MachinePolicy,
  type Playbook,
  type RunStatus,
  type RunStepResult,
  type ScheduleRecurrence,
  type ScheduledSession,
  type SessionDiagnosis,
  type SessionRun,
} from './playbook-types.js';
import {
  buildCreateFromXmlCommand,
  buildDeleteTaskCommand,
  buildTaskXml,
  buildToggleTaskCommand,
  clampOutput,
  diagnoseSessionIssue,
  describeRecurrence,
  isProfileSessionStale,
  machinePolicyOrDefaults,
  normalizeTimeOfDay,
} from './schedule-planner.js';

export interface CreateSessionInput {
  name: string;
  playbookId: string;
  /** Folder that holds the pipeline scripts the playbook runs. */
  workingDir: string;
  timeOfDay: string;
  recurrence: ScheduleRecurrence;
  machinePolicy?: Partial<MachinePolicy>;
}

export interface ScheduleSummary extends ScheduledSession {
  workingDir: string;
  playbookName: string;
  recurrenceLabel: string;
  lastRun: SessionRun | null;
  /** Present when the last failure looks like a login/session problem (R4.2). */
  attention: SessionDiagnosis | null;
}

export interface ProfileHealth {
  profileDir: string;
  exists: boolean;
  /** Session data untouched for a long time → advise a re-login before the next run (R4.4). */
  mayHaveExpired: boolean;
  lastActivityAt: string | null;
}

interface RunHandle {
  runId: string;
  child: ReturnType<typeof spawn> | null;
}

export class ScheduleService {
  private active = new Map<string, RunHandle>();

  constructor(private readonly db: DatabaseManager) {}

  listPlaybooks(): Playbook[] {
    return BUILTIN_PLAYBOOKS;
  }

  list(): ScheduleSummary[] {
    return this.db.listScheduledSessions().map((row) => this.toSummary(row));
  }

  create(input: CreateSessionInput): { ok: true; session: ScheduleSummary } | { ok: false; error: string } {
    const playbook = findPlaybook(input.playbookId);
    if (!playbook) return { ok: false, error: `Không tìm thấy playbook "${input.playbookId}"` };
    if (!normalizeTimeOfDay(input.timeOfDay)) return { ok: false, error: `Giờ không hợp lệ: ${input.timeOfDay}` };
    if (!input.workingDir.trim() || !existsSync(input.workingDir)) {
      return { ok: false, error: 'Thư mục pipeline không tồn tại' };
    }
    if (!input.name.trim()) return { ok: false, error: 'Chưa đặt tên phiên' };

    const now = new Date().toISOString();
    const id = randomUUID();
    const policy = machinePolicyOrDefaults(input.machinePolicy);

    const row: ScheduledSessionRow = {
      id,
      name: input.name.trim(),
      playbook_id: playbook.id,
      working_dir: input.workingDir,
      time_of_day: normalizeTimeOfDay(input.timeOfDay)!,
      recurrence: JSON.stringify(input.recurrence),
      machine_policy: JSON.stringify(policy),
      enabled: 1,
      created_at: now,
      updated_at: now,
    };

    const registered = this.registerWithOsScheduler(row);
    if (!registered.ok) return { ok: false, error: registered.error };

    this.db.upsertScheduledSession(row);
    return { ok: true, session: this.toSummary(row) };
  }

  setEnabled(id: string, enabled: boolean): { ok: boolean; error?: string } {
    const row = this.db.getScheduledSession(id);
    if (!row) return { ok: false, error: 'Không tìm thấy phiên' };
    const cmd = buildToggleTaskCommand(id, enabled);
    const result = this.runSchtasks(cmd.args);
    if (!result.ok) return { ok: false, error: result.error };
    this.db.setScheduledSessionEnabled(id, enabled, new Date().toISOString());
    return { ok: true };
  }

  remove(id: string): { ok: boolean; error?: string } {
    // Delete the OS registration first so a failure never leaves an orphan trigger (R1.4).
    const result = this.runSchtasks(buildDeleteTaskCommand(id).args);
    if (!result.ok && !/cannot find|không tìm thấy/i.test(result.error)) {
      return { ok: false, error: result.error };
    }
    this.db.deleteScheduledSession(id);
    return { ok: true };
  }

  runs(sessionId: string, limit = 20): SessionRun[] {
    return this.db.listScheduledSessionRuns(sessionId, limit).map((row) => this.toRun(row));
  }

  /**
   * Runs a schedule's playbook now, step by step. Refuses to start when a run of the same schedule
   * is still active, so a slow run cannot overlap itself and publish twice (R2.5).
   */
  async runNow(sessionId: string): Promise<{ ok: boolean; runId?: string; error?: string }> {
    const row = this.db.getScheduledSession(sessionId);
    if (!row) return { ok: false, error: 'Không tìm thấy phiên' };
    if (this.active.has(sessionId) || this.db.hasRunningScheduledSessionRun(sessionId)) {
      return { ok: false, error: 'Phiên này đang chạy — không chạy chồng để tránh đăng trùng' };
    }
    const playbook = findPlaybook(row.playbook_id);
    if (!playbook) return { ok: false, error: `Playbook "${row.playbook_id}" không còn tồn tại` };

    const runId = randomUUID();
    const startedAt = new Date().toISOString();
    const runRow: ScheduledSessionRunRow = {
      id: runId,
      session_id: sessionId,
      status: 'running',
      started_at: startedAt,
      ended_at: null,
      failed_step_id: null,
      steps: '[]',
      diagnosis: null,
    };
    this.db.insertScheduledSessionRun(runRow);
    this.active.set(sessionId, { runId, child: null });

    const steps: RunStepResult[] = [];
    let failedStepId: string | null = null;
    let diagnosis: SessionDiagnosis | null = null;

    try {
      for (const step of playbook.steps) {
        const cwd = step.cwd ? path.resolve(row.working_dir, step.cwd) : row.working_dir;
        const stepStarted = new Date().toISOString();
        const exec = await this.spawnStep({
          sessionId,
          command: step.command,
          args: step.args,
          cwd,
          timeoutMs: step.timeoutMs ?? playbook.defaultTimeoutMs,
        });
        const result: RunStepResult = {
          stepId: step.id,
          label: step.label,
          exitCode: exec.exitCode,
          startedAt: stepStarted,
          endedAt: new Date().toISOString(),
          output: clampOutput(exec.output),
        };
        steps.push(result);

        if (exec.exitCode !== 0) {
          // A step's declared profile is what the user must go fix, when the failure is a session
          // problem rather than a code problem (R4.1/R4.3).
          diagnosis = diagnoseSessionIssue(
            exec.output,
            step.requiresProfiles?.length
              ? path.resolve(row.working_dir, step.requiresProfiles[0])
              : undefined,
          );
          if (!step.continueOnError) {
            failedStepId = step.id;
            break;
          }
        }
      }
    } finally {
      this.active.delete(sessionId);
    }

    const status: RunStatus = failedStepId ? 'failed' : 'success';
    this.db.updateScheduledSessionRun({
      ...runRow,
      status,
      ended_at: new Date().toISOString(),
      failed_step_id: failedStepId,
      steps: JSON.stringify(steps),
      diagnosis: diagnosis ? JSON.stringify(diagnosis) : null,
    });

    return { ok: status === 'success', runId, error: failedStepId ? 'Một bước thất bại' : undefined };
  }

  /** Health of every browser profile the schedules depend on (R4.4). */
  profileHealth(): ProfileHealth[] {
    const seen = new Map<string, ProfileHealth>();
    const now = Date.now();
    for (const row of this.db.listScheduledSessions()) {
      const playbook = findPlaybook(row.playbook_id);
      if (!playbook) continue;
      for (const relative of playbookProfiles(playbook)) {
        const dir = path.resolve(row.working_dir, relative);
        if (seen.has(dir)) continue;
        const exists = existsSync(dir);
        const lastWriteMs = exists ? this.profileActivityMs(dir) : 0;
        seen.set(dir, {
          profileDir: dir,
          exists,
          mayHaveExpired: !exists || isProfileSessionStale(lastWriteMs, now),
          lastActivityAt: lastWriteMs ? new Date(lastWriteMs).toISOString() : null,
        });
      }
    }
    return [...seen.values()];
  }

  /**
   * Opens a browser on that profile so the human can log in (R4.3).
   * The app only launches the browser; it never types credentials and never stores them.
   */
  openProfileForLogin(profileDir: string, url = 'https://www.facebook.com/'): { ok: boolean; error?: string } {
    if (!profileDir.trim() || !existsSync(profileDir)) {
      return { ok: false, error: 'Không tìm thấy thư mục profile' };
    }
    const chrome = this.findChrome();
    if (!chrome) return { ok: false, error: 'Không tìm thấy Chrome trên máy' };
    try {
      const child = spawn(chrome, [`--user-data-dir=${profileDir}`, url], {
        detached: true,
        stdio: 'ignore',
      });
      child.unref();
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // ── internals ──

  private toSummary(row: ScheduledSessionRow): ScheduleSummary {
    const playbook = findPlaybook(row.playbook_id);
    const recurrence = this.parseJson<ScheduleRecurrence>(row.recurrence, { kind: 'daily' });
    const runs = this.db.listScheduledSessionRuns(row.id, 1);
    const lastRun = runs.length ? this.toRun(runs[0]) : null;
    return {
      id: row.id,
      name: row.name,
      playbookId: row.playbook_id,
      workingDir: row.working_dir,
      playbookName: playbook?.name ?? row.playbook_id,
      timeOfDay: row.time_of_day,
      recurrence,
      recurrenceLabel: describeRecurrence(recurrence, row.time_of_day),
      machinePolicy: this.parseJson<MachinePolicy>(row.machine_policy, DEFAULT_MACHINE_POLICY),
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastRun,
      attention: lastRun?.diagnosis ?? null,
    };
  }

  private toRun(row: ScheduledSessionRunRow): SessionRun {
    return {
      id: row.id,
      sessionId: row.session_id,
      status: row.status as RunStatus,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      failedStepId: row.failed_step_id,
      steps: this.parseJson<RunStepResult[]>(row.steps, []),
      diagnosis: row.diagnosis ? this.parseJson<SessionDiagnosis | null>(row.diagnosis, null) : null,
    };
  }

  private parseJson<T>(raw: string | null, fallback: T): T {
    if (!raw) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }

  /**
   * Registers the trigger with the OS scheduler. The task launches this app with
   * `--run-session=<id>`, which is handled in main and runs the playbook headlessly.
   */
  private registerWithOsScheduler(row: ScheduledSessionRow): { ok: true } | { ok: false; error: string } {
    const recurrence = this.parseJson<ScheduleRecurrence>(row.recurrence, { kind: 'daily' });
    const machinePolicy = this.parseJson<MachinePolicy>(row.machine_policy, DEFAULT_MACHINE_POLICY);

    // Registered from an XML definition: the battery / wake / catch-up settings that decide whether
    // a run happens at all cannot be expressed with the CLI flags, and a schedule that is silently
    // skipped is the failure this feature exists to prevent (R5.3).
    const built = buildTaskXml({
      timeOfDay: row.time_of_day,
      recurrence,
      runner: process.execPath,
      runnerArgs: [`--run-session=${row.id}`],
      machinePolicy,
      description: `Izzi: ${row.name}`,
    });
    if ('error' in built) return { ok: false, error: built.error };

    const xmlPath = path.join(tmpdir(), `izzi-session-${row.id}.xml`);
    try {
      // The scheduler expects UTF-16 for a task definition, matching the XML declaration.
      writeFileSync(xmlPath, built.xml, 'utf16le');
      const created = this.runSchtasks(buildCreateFromXmlCommand(row.id, xmlPath).args);
      if (!created.ok) return { ok: false, error: created.error };
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      try {
        rmSync(xmlPath, { force: true });
      } catch {
        // best-effort cleanup of the temporary definition
      }
    }
  }

  private runSchtasks(args: string[]): { ok: true } | { ok: false; error: string } {
    try {
      execFileSync('schtasks', args, { encoding: 'utf8', windowsHide: true });
      return { ok: true };
    } catch (error) {
      const message =
        error instanceof Error
          ? `${error.message}`.split('\n').slice(0, 2).join(' ')
          : String(error);
      return { ok: false, error: message };
    }
  }

  private spawnStep(params: {
    sessionId: string;
    command: string;
    args: string[];
    cwd: string;
    timeoutMs: number;
  }): Promise<{ exitCode: number | null; output: string }> {
    return new Promise((resolve) => {
      let output = '';
      let settled = false;
      const finish = (exitCode: number | null) => {
        if (settled) return;
        settled = true;
        resolve({ exitCode, output });
      };

      // shell:false — arguments stay an array, so a path or argument can never be reinterpreted
      // as a command (R5.1).
      const child = spawn(params.command, params.args, {
        cwd: params.cwd,
        shell: false,
        windowsHide: true,
      });
      const handle = this.active.get(params.sessionId);
      if (handle) handle.child = child;

      const timer = setTimeout(() => {
        output += `\n[timeout ${params.timeoutMs}ms — đã dừng bước này]`;
        child.kill();
      }, params.timeoutMs);

      child.stdout?.on('data', (chunk) => {
        output += String(chunk);
      });
      child.stderr?.on('data', (chunk) => {
        output += String(chunk);
      });
      child.on('error', (error) => {
        output += `\n[không chạy được: ${error.message}]`;
        clearTimeout(timer);
        finish(null);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        finish(code);
      });
    });
  }

  /** Most recent write inside the profile folder's session-bearing files. */
  private profileActivityMs(dir: string): number {
    const candidates = [
      path.join(dir, 'Default', 'Network', 'Cookies'),
      path.join(dir, 'Default', 'Cookies'),
      path.join(dir, 'Default', 'Preferences'),
      dir,
    ];
    let newest = 0;
    for (const file of candidates) {
      try {
        if (!existsSync(file)) continue;
        const mtime = statSync(file).mtimeMs;
        if (mtime > newest) newest = mtime;
      } catch {
        // unreadable entry — ignore, the advisory falls back to "may have expired"
      }
    }
    return newest;
  }

  private findChrome(): string | null {
    const candidates = [
      path.join(process.env['PROGRAMFILES'] ?? 'C:/Program Files', 'Google/Chrome/Application/chrome.exe'),
      path.join(
        process.env['PROGRAMFILES(X86)'] ?? 'C:/Program Files (x86)',
        'Google/Chrome/Application/chrome.exe',
      ),
      path.join(process.env['LOCALAPPDATA'] ?? '', 'Google/Chrome/Application/chrome.exe'),
    ];
    return candidates.find((candidate) => candidate && existsSync(candidate)) ?? null;
  }
}

/**
 * Headless entry point used by the OS-scheduled task: `<app> --run-session=<id>`.
 * Returns true when the process handled a scheduled run and should exit.
 */
export async function handleScheduledRunArgv(
  argv: string[],
  service: ScheduleService,
): Promise<boolean> {
  const flag = argv.find((arg) => arg.startsWith('--run-session='));
  if (!flag) return false;
  const sessionId = flag.slice('--run-session='.length).trim();
  if (!sessionId) return false;
  const result = await service.runNow(sessionId);
  if (!result.ok) {
    // Non-zero exit lets the OS scheduler's "last result" reflect the failure (R3.1/R3.2).
    process.exitCode = 1;
  }
  return true;
}
