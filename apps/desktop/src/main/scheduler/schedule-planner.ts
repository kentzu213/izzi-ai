/**
 * Scheduled Sessions — pure planning/translation rules.
 *
 * Everything here is a pure function so the parts that decide *what* the OS scheduler is told,
 * and *what a failure means*, are unit-testable without touching the machine.
 *
 * Requirements: R1.1/R1.2 (schedule → scheduler arguments), R3.2 (exit code → plain language),
 * R4.1 (failing output → session diagnosis), R5.3 (machine policy is explicit).
 */
import {
  DEFAULT_MACHINE_POLICY,
  WEEKDAYS,
  type MachinePolicy,
  type ScheduleRecurrence,
  type SessionDiagnosis,
  type SessionIssueKind,
  type Weekday,
} from './playbook-types.js';

/** Task name prefix so app-created tasks are identifiable and never collide with the user's own. */
export const TASK_PREFIX = 'IzziSession_';

export function taskNameFor(sessionId: string): string {
  // Keep it filesystem/scheduler safe: the OS scheduler rejects several punctuation characters.
  return `${TASK_PREFIX}${sessionId.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

/** "HH:MM" in 24h local time, or null when the input is not a valid time of day. */
export function normalizeTimeOfDay(input: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(input.trim());
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Human summary of a recurrence, for the UI. */
export function describeRecurrence(recurrence: ScheduleRecurrence, timeOfDay: string): string {
  if (recurrence.kind === 'daily') return `Hằng ngày lúc ${timeOfDay}`;
  const days = recurrence.days.filter((d) => WEEKDAYS.includes(d));
  if (!days.length) return `Chưa chọn ngày (lúc ${timeOfDay})`;
  return `${days.join(', ')} lúc ${timeOfDay}`;
}

export interface SchedulerCommand {
  /** Executable — the OS scheduler CLI. */
  command: string;
  args: string[];
}

/**
 * Task definition XML.
 *
 * Why XML instead of plain `/Create` flags: the machine-state settings that decide whether a run
 * happens at all — do not start on battery, stop when switching to battery, wake the machine, run
 * as soon as possible after a missed start — cannot be expressed by the CLI flags. Silently skipped
 * runs (the scheduler reporting "the operator refused the request") were a real, hard-to-diagnose
 * failure, so the policy has to actually reach the task definition (R5.3).
 *
 * `MultipleInstancesPolicy=IgnoreNew` is the second line of defence for R2.5: even if the app-side
 * overlap check were bypassed, the OS will not start a second copy of the same task.
 */
export function buildTaskXml(params: {
  timeOfDay: string;
  recurrence: ScheduleRecurrence;
  runner: string;
  runnerArgs: string[];
  machinePolicy: MachinePolicy;
  description?: string;
}): { xml: string } | { error: string } {
  const time = normalizeTimeOfDay(params.timeOfDay);
  if (!time) return { error: `giờ không hợp lệ: "${params.timeOfDay}"` };
  if (!params.runner.trim()) return { error: 'thiếu đường dẫn runner' };

  let trigger: string;
  if (params.recurrence.kind === 'daily') {
    trigger = '      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>';
  } else {
    const days = dedupeDays(params.recurrence.days);
    if (!days.length) return { error: 'lịch theo tuần nhưng chưa chọn ngày nào' };
    const dayTags = days.map((day) => `          <${WEEKDAY_XML[day]} />`).join('\n');
    trigger = [
      '      <ScheduleByWeek>',
      '        <DaysOfWeek>',
      dayTags,
      '        </DaysOfWeek>',
      '        <WeeksInterval>1</WeeksInterval>',
      '      </ScheduleByWeek>',
    ].join('\n');
  }

  // A date is required by the schema; the time-of-day is what actually drives the trigger.
  const startBoundary = `2020-01-01T${time}:00`;
  const policy = params.machinePolicy;
  const args = params.runnerArgs.map(escapeXml).join(' ');

  const xml = [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    '  <RegistrationInfo>',
    `    <Description>${escapeXml(params.description ?? 'Izzi scheduled session')}</Description>`,
    '  </RegistrationInfo>',
    '  <Triggers>',
    '    <CalendarTrigger>',
    `      <StartBoundary>${startBoundary}</StartBoundary>`,
    '      <Enabled>true</Enabled>',
    trigger,
    '    </CalendarTrigger>',
    '  </Triggers>',
    '  <Principals>',
    '    <Principal id="Author">',
    '      <LogonType>InteractiveToken</LogonType>',
    '      <RunLevel>LeastPrivilege</RunLevel>',
    '    </Principal>',
    '  </Principals>',
    '  <Settings>',
    `    <DisallowStartIfOnBatteries>${!policy.runOnBattery}</DisallowStartIfOnBatteries>`,
    `    <StopIfGoingOnBatteries>${!policy.runOnBattery}</StopIfGoingOnBatteries>`,
    `    <WakeToRun>${policy.wakeToRun}</WakeToRun>`,
    `    <StartWhenAvailable>${policy.catchUpMissed}</StartWhenAvailable>`,
    '    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>',
    '    <AllowHardTerminate>true</AllowHardTerminate>',
    '    <Enabled>true</Enabled>',
    '    <ExecutionTimeLimit>PT4H</ExecutionTimeLimit>',
    '  </Settings>',
    '  <Actions Context="Author">',
    '    <Exec>',
    `      <Command>${escapeXml(params.runner)}</Command>`,
    args ? `      <Arguments>${args}</Arguments>` : '      <Arguments></Arguments>',
    '    </Exec>',
    '  </Actions>',
    '</Task>',
  ].join('\n');

  return { xml };
}

/** Registers a task from an XML definition file. */
export function buildCreateFromXmlCommand(sessionId: string, xmlPath: string): SchedulerCommand {
  return {
    command: 'schtasks',
    args: ['/Create', '/F', '/TN', taskNameFor(sessionId), '/XML', xmlPath],
  };
}

const WEEKDAY_XML: Record<Weekday, string> = {
  MON: 'Monday',
  TUE: 'Tuesday',
  WED: 'Wednesday',
  THU: 'Thursday',
  FRI: 'Friday',
  SAT: 'Saturday',
  SUN: 'Sunday',
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildDeleteTaskCommand(sessionId: string): SchedulerCommand {
  return { command: 'schtasks', args: ['/Delete', '/F', '/TN', taskNameFor(sessionId)] };
}

export function buildToggleTaskCommand(sessionId: string, enabled: boolean): SchedulerCommand {
  return {
    command: 'schtasks',
    args: ['/Change', '/TN', taskNameFor(sessionId), enabled ? '/ENABLE' : '/DISABLE'],
  };
}

export function buildQueryTaskCommand(sessionId: string): SchedulerCommand {
  return { command: 'schtasks', args: ['/Query', '/TN', taskNameFor(sessionId), '/FO', 'LIST', '/V'] };
}

function dedupeDays(days: Weekday[]): Weekday[] {
  const seen = new Set<Weekday>();
  for (const day of days) if (WEEKDAYS.includes(day)) seen.add(day);
  return WEEKDAYS.filter((d) => seen.has(d));
}

/**
 * Machine-state flags. Exposed separately because the OS scheduler CLI cannot express all of them
 * on create; the service applies them through a settings update. Defaults follow R5.3.
 */
export function machinePolicyOrDefaults(policy?: Partial<MachinePolicy>): MachinePolicy {
  return { ...DEFAULT_MACHINE_POLICY, ...(policy ?? {}) };
}

/** Exit codes we have actually seen, translated for humans (R3.2). */
export function explainExitCode(code: number | null): string {
  if (code === null) return 'Không rõ kết quả (tiến trình không trả mã).';
  if (code === 0) return 'Chạy xong, không lỗi.';
  // 0x800710E0 — the scheduler refused to start the task. In practice: device on battery, or
  // asleep with wake disabled. This one cost real debugging time, so name it precisely.
  if (code === 2147946720 || code === -2147020576) {
    return 'Hệ thống từ chối chạy: máy đang dùng pin hoặc đang ngủ. Bật "chạy khi dùng pin" và "đánh thức máy".';
  }
  if (code === 267011) return 'Tác vụ chưa từng chạy lần nào.';
  if (code === 1) return 'Playbook chạy nhưng một bước thất bại — xem log để biết bước nào.';
  return `Kết thúc với mã ${code} — xem log của bước cuối.`;
}

/** True when the code means "the OS never even started the run". */
export function isRefusedByMachineState(code: number | null): boolean {
  return code === 2147946720 || code === -2147020576;
}

interface DiagnosisRule {
  kind: SessionIssueKind;
  pattern: RegExp;
  action: string;
}

/**
 * Ordered rules: the first match wins, most specific first. These patterns come from failures
 * observed while operating the pipeline, not from guesswork.
 */
const DIAGNOSIS_RULES: DiagnosisRule[] = [
  {
    kind: 'two_factor_required',
    pattern: /two_step_verification|two_factor|xác minh 2 bước|mã xác thực|checkpoint/i,
    action: 'Phiên cần xác minh 2 bước. Mở profile và nhập mã, rồi chạy lại.',
  },
  {
    kind: 'billing_blocked',
    pattern: /modal-subscription-failure|phương thức thanh toán|payment method|subscription (failed|failure)|billing/i,
    action: 'Nhà cung cấp đang chặn bằng thông báo thanh toán. Xử lý thanh toán/subscription rồi chạy lại.',
  },
  {
    kind: 'authorization_refused',
    pattern: /admin access required|403|forbidden|không có quyền/i,
    action: 'Tài khoản đang đăng nhập không đủ quyền. Đăng nhập bằng tài khoản có quyền rồi chạy lại.',
  },
  {
    kind: 'logged_out',
    pattern: /đăng nhập|log ?in|sign ?in|session expired|unauthorized|401|bạn quên tài khoản/i,
    action: 'Phiên đăng nhập đã hết. Mở profile, đăng nhập lại, rồi chạy lại.',
  },
];

/**
 * Classifies a failing step's output into something the user can act on (R4.1/R4.2).
 * Returns null when the output shows no session problem — so a plain code bug is not mislabelled
 * as "go log in".
 */
export function diagnoseSessionIssue(output: string, profileDir?: string): SessionDiagnosis | null {
  const text = String(output ?? '');
  if (!text.trim()) return null;
  for (const rule of DIAGNOSIS_RULES) {
    if (rule.pattern.test(text)) {
      return { kind: rule.kind, profileDir, action: rule.action };
    }
  }
  return null;
}

/**
 * "May have expired": the profile's stored session data has not been written for a long time
 * (R4.4). Advisory only — it never blocks a run, it just gives the user a chance to re-login
 * before the next scheduled start instead of after a failed one.
 */
export function isProfileSessionStale(lastWriteMs: number, nowMs: number, maxAgeDays = 14): boolean {
  if (!Number.isFinite(lastWriteMs) || lastWriteMs <= 0) return true;
  const ageDays = (nowMs - lastWriteMs) / 86_400_000;
  return ageDays > maxAgeDays;
}

/** Bounded capture so a chatty step cannot bloat the database (R2.4). */
export function clampOutput(output: string, maxChars = 8000): string {
  const text = String(output ?? '');
  if (text.length <= maxChars) return text;
  const head = text.slice(0, Math.floor(maxChars * 0.35));
  const tail = text.slice(-Math.floor(maxChars * 0.6));
  return `${head}\n… [đã cắt ${text.length - head.length - tail.length} ký tự] …\n${tail}`;
}
