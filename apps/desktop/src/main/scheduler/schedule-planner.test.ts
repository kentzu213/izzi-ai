import { describe, expect, it } from 'vitest';
import {
  buildCreateFromXmlCommand,
  buildDeleteTaskCommand,
  buildTaskXml,
  buildToggleTaskCommand,
  clampOutput,
  describeRecurrence,
  diagnoseSessionIssue,
  explainExitCode,
  isProfileSessionStale,
  isRefusedByMachineState,
  machinePolicyOrDefaults,
  normalizeTimeOfDay,
  taskNameFor,
} from './schedule-planner.js';
import { playbookProfiles, validatePlaybook, type Playbook } from './playbook-types.js';

const playbook: Playbook = {
  id: 'demo',
  name: 'Demo',
  summary: 'demo',
  workingDir: 'C:/work',
  defaultTimeoutMs: 60_000,
  steps: [
    { id: 'a', label: 'A', command: 'node', args: ['a.mjs'], requiresProfiles: ['C:/p1'] },
    { id: 'b', label: 'B', command: 'node', args: ['b.mjs'], requiresProfiles: ['C:/p1', 'C:/p2'] },
  ],
};

describe('time of day (R1.1)', () => {
  it('normalises valid times and pads them', () => {
    expect(normalizeTimeOfDay('9:05')).toBe('09:05');
    expect(normalizeTimeOfDay('21:00')).toBe('21:00');
    expect(normalizeTimeOfDay(' 00:00 ')).toBe('00:00');
  });

  it('rejects impossible or malformed times', () => {
    for (const bad of ['24:00', '12:60', '-1:00', '1200', 'abc', '', '12:5']) {
      expect(normalizeTimeOfDay(bad), bad).toBeNull();
    }
  });
});

describe('task naming and lifecycle commands (R1.2, R1.4)', () => {
  it('namespaces task names and strips unsafe characters', () => {
    expect(taskNameFor('a b/c:d')).toBe('IzziSession_a_b_c_d');
    expect(buildDeleteTaskCommand('x').args).toEqual(['/Delete', '/F', '/TN', 'IzziSession_x']);
    expect(buildToggleTaskCommand('x', false).args).toContain('/DISABLE');
    expect(buildToggleTaskCommand('x', true).args).toContain('/ENABLE');
  });
});

describe('task XML — machine policy actually reaches the definition (R5.3)', () => {
  const base = {
    timeOfDay: '21:00',
    recurrence: { kind: 'daily' } as const,
    runner: 'C:/Program Files/App/app.exe',
    runnerArgs: ['--run-session=abc'],
  };

  it('encodes "run on battery + wake + catch up" as the scheduler expects', () => {
    const result = buildTaskXml({
      ...base,
      machinePolicy: { runOnBattery: true, wakeToRun: true, catchUpMissed: true },
    });
    if ('error' in result) throw new Error(result.error);
    // Running on battery means NOT disallowing it, and NOT stopping when it switches.
    expect(result.xml).toContain('<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>');
    expect(result.xml).toContain('<StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>');
    expect(result.xml).toContain('<WakeToRun>true</WakeToRun>');
    expect(result.xml).toContain('<StartWhenAvailable>true</StartWhenAvailable>');
    // Second line of defence against overlapping runs (R2.5).
    expect(result.xml).toContain('<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>');
    expect(result.xml).toContain('<StartBoundary>2020-01-01T21:00:00</StartBoundary>');
  });

  it('inverts the battery flags when the user opts out', () => {
    const result = buildTaskXml({
      ...base,
      machinePolicy: { runOnBattery: false, wakeToRun: false, catchUpMissed: false },
    });
    if ('error' in result) throw new Error(result.error);
    expect(result.xml).toContain('<DisallowStartIfOnBatteries>true</DisallowStartIfOnBatteries>');
    expect(result.xml).toContain('<WakeToRun>false</WakeToRun>');
    expect(result.xml).toContain('<StartWhenAvailable>false</StartWhenAvailable>');
  });

  it('writes weekly day tags in the scheduler vocabulary', () => {
    const result = buildTaskXml({
      ...base,
      recurrence: { kind: 'weekly', days: ['WED', 'SUN'] },
      machinePolicy: { runOnBattery: true, wakeToRun: true, catchUpMissed: true },
    });
    if ('error' in result) throw new Error(result.error);
    expect(result.xml).toContain('<Wednesday />');
    expect(result.xml).toContain('<Sunday />');
    expect(result.xml).toContain('<ScheduleByWeek>');
  });

  it('escapes the command and arguments instead of injecting raw XML', () => {
    const result = buildTaskXml({
      ...base,
      runner: 'C:/a&b/app.exe',
      runnerArgs: ['--x=<script>'],
      machinePolicy: { runOnBattery: true, wakeToRun: true, catchUpMissed: true },
    });
    if ('error' in result) throw new Error(result.error);
    expect(result.xml).toContain('C:/a&amp;b/app.exe');
    expect(result.xml).toContain('&lt;script&gt;');
    expect(result.xml).not.toContain('<script>');
  });

  it('refuses an invalid time or an empty weekly day set', () => {
    const policy = { runOnBattery: true, wakeToRun: true, catchUpMissed: true };
    expect('error' in buildTaskXml({ ...base, timeOfDay: '99:00', machinePolicy: policy })).toBe(true);
    expect(
      'error' in buildTaskXml({ ...base, recurrence: { kind: 'weekly', days: [] }, machinePolicy: policy }),
    ).toBe(true);
  });

  it('registers from the XML file under the namespaced task name', () => {
    const cmd = buildCreateFromXmlCommand('abc', 'C:/tmp/x.xml');
    expect(cmd.args).toEqual(['/Create', '/F', '/TN', 'IzziSession_abc', '/XML', 'C:/tmp/x.xml']);
  });
});

describe('machine policy defaults (R5.3)', () => {
  it('defaults to actually running (battery + wake + catch up)', () => {
    expect(machinePolicyOrDefaults()).toEqual({
      runOnBattery: true, wakeToRun: true, catchUpMissed: true,
    });
  });

  it('lets a single field be overridden without losing the others', () => {
    expect(machinePolicyOrDefaults({ wakeToRun: false })).toEqual({
      runOnBattery: true, wakeToRun: false, catchUpMissed: true,
    });
  });
});

describe('exit code explanations (R3.2)', () => {
  it('names the battery/asleep refusal specifically', () => {
    expect(explainExitCode(2147946720)).toMatch(/pin|ngủ/);
    expect(isRefusedByMachineState(2147946720)).toBe(true);
    expect(isRefusedByMachineState(-2147020576)).toBe(true);
  });

  it('distinguishes success, step failure and unknown', () => {
    expect(explainExitCode(0)).toMatch(/không lỗi/i);
    expect(explainExitCode(1)).toMatch(/một bước thất bại/i);
    expect(explainExitCode(null)).toMatch(/không rõ/i);
    expect(isRefusedByMachineState(1)).toBe(false);
  });
});

describe('session diagnosis (R4.1)', () => {
  it('detects two-factor before treating it as a plain logout', () => {
    const d = diagnoseSessionIssue('redirected to two_step_verification/two_factor?...', 'C:/p');
    expect(d?.kind).toBe('two_factor_required');
    expect(d?.profileDir).toBe('C:/p');
  });

  it('detects a provider billing block', () => {
    const d = diagnoseSessionIssue('modal-subscription-failure intercepts pointer events');
    expect(d?.kind).toBe('billing_blocked');
    const vi = diagnoseSessionIssue('Xem lại phương thức thanh toán');
    expect(vi?.kind).toBe('billing_blocked');
  });

  it('detects an authorisation refusal', () => {
    const d = diagnoseSessionIssue('Publish API lỗi 403: Admin access required');
    expect(d?.kind).toBe('authorization_refused');
  });

  it('detects a plain logged-out session', () => {
    const d = diagnoseSessionIssue('Đăng nhập Bạn quên tài khoản ư? Tham gia nhóm');
    expect(d?.kind).toBe('logged_out');
  });

  it('returns null for a normal code failure so it is not mislabelled as a login problem', () => {
    expect(diagnoseSessionIssue('TypeError: x is not a function')).toBeNull();
    expect(diagnoseSessionIssue('')).toBeNull();
  });

  it('always carries an action the user can perform', () => {
    for (const text of ['two_factor', 'billing', '403 forbidden', 'session expired']) {
      const d = diagnoseSessionIssue(text);
      expect(d, text).not.toBeNull();
      expect(d!.action.length).toBeGreaterThan(10);
    }
  });
});

describe('stale profile advisory (R4.4)', () => {
  const now = Date.UTC(2026, 6, 27);
  it('flags a profile untouched for longer than the window', () => {
    expect(isProfileSessionStale(now - 20 * 86_400_000, now)).toBe(true);
  });
  it('does not flag a recently used profile', () => {
    expect(isProfileSessionStale(now - 2 * 86_400_000, now)).toBe(false);
  });
  it('treats a missing timestamp as stale (fail towards telling the user)', () => {
    expect(isProfileSessionStale(0, now)).toBe(true);
    expect(isProfileSessionStale(Number.NaN, now)).toBe(true);
  });
});

describe('output capture (R2.4)', () => {
  it('keeps short output verbatim', () => {
    expect(clampOutput('hello')).toBe('hello');
  });
  it('clamps long output while keeping the head and the tail', () => {
    const long = `${'a'.repeat(9000)}TAIL_MARKER`;
    const out = clampOutput(long, 1000);
    expect(out.length).toBeLessThan(1400);
    expect(out).toContain('TAIL_MARKER');
    expect(out).toContain('đã cắt');
  });
});

describe('playbook model (R2.1, R4.3)', () => {
  it('accepts a well-formed playbook', () => {
    expect(validatePlaybook(playbook)).toEqual([]);
  });

  it('reports duplicate step ids, empty commands and bad timeouts', () => {
    const broken: Playbook = {
      ...playbook,
      steps: [
        { id: 'a', label: 'A', command: 'node', args: [] },
        { id: 'a', label: 'dup', command: '', args: [], timeoutMs: 0 },
      ],
    };
    const problems = validatePlaybook(broken);
    expect(problems.join(' ')).toMatch(/duplicate id/);
    expect(problems.join(' ')).toMatch(/command is empty/);
    expect(problems.join(' ')).toMatch(/timeoutMs/);
  });

  it('collects the distinct profiles the playbook needs', () => {
    expect(playbookProfiles(playbook)).toEqual(['C:/p1', 'C:/p2']);
  });
});

describe('recurrence description (R3.1)', () => {
  it('describes daily and weekly schedules', () => {
    expect(describeRecurrence({ kind: 'daily' }, '10:00')).toMatch(/Hằng ngày.*10:00/);
    expect(describeRecurrence({ kind: 'weekly', days: ['WED'] }, '19:00')).toMatch(/WED.*19:00/);
    expect(describeRecurrence({ kind: 'weekly', days: [] }, '19:00')).toMatch(/Chưa chọn ngày/);
  });
});
