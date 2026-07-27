import React, { useEffect, useMemo, useState } from 'react';
import {
  useScheduledSessionsStore,
  type CreateScheduleInput,
  type PlaybookInfo,
  type ProfileHealth,
  type ScheduleSummary,
  type SessionRun,
  type Weekday,
} from '../store/scheduledSessions';
import '../styles/scheduled-sessions.css';

/**
 * ScheduledSessionsPage — create and watch recurring agent sessions.
 *
 * The point of this surface is that a user never touches the OS scheduler: they pick a playbook, a
 * folder, a time and a recurrence. When a run fails the page says *what a human must do* — the
 * failures that actually happen in practice are expired logins, two-factor prompts and provider
 * billing blocks, not code bugs.
 *
 * All effects go through `electronAPI.schedule` in main; no credential is ever handled here.
 *
 * @see .kiro/specs/scheduled-sessions/requirements.md
 */

const WEEKDAY_LABELS: Array<{ value: Weekday; label: string }> = [
  { value: 'MON', label: 'T2' },
  { value: 'TUE', label: 'T3' },
  { value: 'WED', label: 'T4' },
  { value: 'THU', label: 'T5' },
  { value: 'FRI', label: 'T6' },
  { value: 'SAT', label: 'T7' },
  { value: 'SUN', label: 'CN' },
];

const STATUS_LABEL: Record<SessionRun['status'], string> = {
  running: 'Đang chạy',
  success: 'Thành công',
  failed: 'Thất bại',
  refused: 'Bị từ chối',
};

const ISSUE_LABEL: Record<string, string> = {
  logged_out: 'Phiên đăng nhập đã hết',
  two_factor_required: 'Cần xác minh 2 bước',
  billing_blocked: 'Bị chặn bởi thông báo thanh toán',
  authorization_refused: 'Tài khoản không đủ quyền',
  unknown: 'Cần kiểm tra phiên',
};

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('vi-VN');
}

export function ScheduledSessionsPage() {
  const {
    status,
    sessions,
    playbooks,
    profiles,
    runs,
    error,
    busyId,
    refresh,
    create,
    setEnabled,
    remove,
    runNow,
    loadRuns,
    openProfile,
  } = useScheduledSessionsStore();

  const [showForm, setShowForm] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const attentionCount = useMemo(
    () => sessions.filter((s) => s.attention).length + profiles.filter((p) => p.mayHaveExpired).length,
    [sessions, profiles],
  );

  const toggleExpanded = async (id: string) => {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    await loadRuns(id);
  };

  return (
    <div className="schedules">
      <header className="schedules__header">
        <div>
          <div className="schedules__kicker">Phiên đặt lịch</div>
          <h1 className="schedules__title">Tự chạy đúng giờ, đúng quy trình</h1>
          <p className="schedules__subtitle">
            Chọn playbook + giờ, app tự đăng ký với Trình lên lịch của hệ điều hành. Mỗi lần chạy đều
            có log và mã lỗi được dịch sang tiếng người.
          </p>
        </div>
        <button type="button" className="schedules__primary" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Đóng' : '+ Tạo phiên'}
        </button>
      </header>

      {attentionCount > 0 && (
        <div className="schedules__attention" role="status">
          <strong>{attentionCount} việc cần bạn xử lý.</strong> Phiên đăng nhập hoặc thanh toán của
          nhà cung cấp là nguyên nhân phổ biến nhất khiến lịch chạy nhưng không ra kết quả.
        </div>
      )}

      {error && (
        <div className="schedules__error" role="alert">
          {error}
        </div>
      )}

      {showForm && (
        <CreateForm
          playbooks={playbooks}
          onCancel={() => setShowForm(false)}
          onSubmit={async (input) => {
            const ok = await create(input);
            if (ok) setShowForm(false);
            return ok;
          }}
        />
      )}

      {profiles.length > 0 && (
        <section className="schedules__panel">
          <h2 className="schedules__panelTitle">Phiên đăng nhập của browser profile</h2>
          <ul className="schedules__profiles">
            {profiles.map((profile) => (
              <ProfileRow key={profile.profileDir} profile={profile} onOpen={openProfile} />
            ))}
          </ul>
        </section>
      )}

      <section className="schedules__panel">
        <h2 className="schedules__panelTitle">Lịch đã tạo</h2>

        {status === 'loading' && <p className="schedules__muted">Đang tải…</p>}

        {status === 'ready' && sessions.length === 0 && (
          <p className="schedules__muted">
            Chưa có phiên nào. Bấm “Tạo phiên” và chọn một playbook để bắt đầu.
          </p>
        )}

        <ul className="schedules__list">
          {sessions.map((session) => (
            <ScheduleRow
              key={session.id}
              session={session}
              runs={runs[session.id] ?? []}
              busy={busyId === session.id}
              expanded={expanded === session.id}
              onToggleExpanded={() => void toggleExpanded(session.id)}
              onRunNow={() => void runNow(session.id)}
              onSetEnabled={(enabled) => void setEnabled(session.id, enabled)}
              onRemove={() => void remove(session.id)}
              onOpenProfile={openProfile}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}

function ProfileRow({
  profile,
  onOpen,
}: {
  profile: ProfileHealth;
  onOpen: (dir: string) => Promise<boolean>;
}) {
  const state = !profile.exists
    ? { cls: 'is-missing', text: 'Không tìm thấy thư mục profile' }
    : profile.mayHaveExpired
      ? { cls: 'is-stale', text: 'Có thể đã hết phiên — nên đăng nhập lại trước giờ chạy' }
      : { cls: 'is-ok', text: 'Hoạt động gần đây' };

  return (
    <li className={`schedules__profile ${state.cls}`}>
      <div className="schedules__profileMain">
        <code className="schedules__path">{profile.profileDir}</code>
        <span className="schedules__profileState">{state.text}</span>
        <span className="schedules__muted">Lần dùng gần nhất: {fmtDateTime(profile.lastActivityAt)}</span>
      </div>
      {profile.exists && (
        <button type="button" className="schedules__ghost" onClick={() => void onOpen(profile.profileDir)}>
          Mở để đăng nhập
        </button>
      )}
    </li>
  );
}

function ScheduleRow({
  session,
  runs,
  busy,
  expanded,
  onToggleExpanded,
  onRunNow,
  onSetEnabled,
  onRemove,
  onOpenProfile,
}: {
  session: ScheduleSummary;
  runs: SessionRun[];
  busy: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onRunNow: () => void;
  onSetEnabled: (enabled: boolean) => void;
  onRemove: () => void;
  onOpenProfile: (dir: string) => Promise<boolean>;
}) {
  const last = session.lastRun;
  return (
    <li className={`schedules__item ${session.enabled ? '' : 'is-disabled'}`}>
      <div className="schedules__itemHead">
        <div className="schedules__itemMain">
          <h3 className="schedules__itemTitle">{session.name}</h3>
          <p className="schedules__itemMeta">
            {session.recurrenceLabel} · {session.playbookName}
          </p>
          <p className="schedules__muted">
            Lần chạy cuối: {fmtDateTime(last?.startedAt ?? null)}
            {last ? ` · ${STATUS_LABEL[last.status]}` : ''}
            {last?.failedStepId ? ` · dừng ở bước “${labelOfStep(last, last.failedStepId)}”` : ''}
          </p>
        </div>

        <div className="schedules__itemActions">
          <button type="button" className="schedules__ghost" disabled={busy} onClick={onRunNow}>
            {busy ? 'Đang chạy…' : 'Chạy thử ngay'}
          </button>
          <button
            type="button"
            className="schedules__ghost"
            disabled={busy}
            onClick={() => onSetEnabled(!session.enabled)}
          >
            {session.enabled ? 'Tạm dừng' : 'Bật lại'}
          </button>
          <button type="button" className="schedules__ghost is-danger" disabled={busy} onClick={onRemove}>
            Xoá
          </button>
        </div>
      </div>

      {session.attention && (
        <div className="schedules__diagnosis">
          <strong>{ISSUE_LABEL[session.attention.kind] ?? ISSUE_LABEL.unknown}</strong>
          <span>{session.attention.action}</span>
          {session.attention.profileDir && (
            <button
              type="button"
              className="schedules__ghost"
              onClick={() => void onOpenProfile(session.attention!.profileDir!)}
            >
              Mở profile để đăng nhập
            </button>
          )}
        </div>
      )}

      <button type="button" className="schedules__disclosure" onClick={onToggleExpanded}>
        {expanded ? 'Ẩn log' : 'Xem log các lần chạy'}
      </button>

      {expanded && (
        <div className="schedules__runs">
          {runs.length === 0 && <p className="schedules__muted">Chưa có lần chạy nào.</p>}
          {runs.map((run) => (
            <details key={run.id} className="schedules__run">
              <summary>
                {fmtDateTime(run.startedAt)} · {STATUS_LABEL[run.status]}
              </summary>
              {run.steps.map((step) => (
                <div key={step.stepId} className="schedules__step">
                  <div className="schedules__stepHead">
                    <span>{step.label}</span>
                    <span className={step.exitCode === 0 ? 'is-ok' : 'is-bad'}>
                      mã {step.exitCode ?? '—'}
                    </span>
                  </div>
                  <pre className="schedules__log">{step.output}</pre>
                </div>
              ))}
            </details>
          ))}
        </div>
      )}
    </li>
  );
}

function labelOfStep(run: SessionRun, stepId: string): string {
  return run.steps.find((s) => s.stepId === stepId)?.label ?? stepId;
}

function CreateForm({
  playbooks,
  onSubmit,
  onCancel,
}: {
  playbooks: PlaybookInfo[];
  onSubmit: (input: CreateScheduleInput) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [playbookId, setPlaybookId] = useState(playbooks[0]?.id ?? '');
  const [workingDir, setWorkingDir] = useState('');
  const [timeOfDay, setTimeOfDay] = useState('10:00');
  const [mode, setMode] = useState<'daily' | 'weekly'>('daily');
  const [days, setDays] = useState<Weekday[]>(['WED']);
  const [submitting, setSubmitting] = useState(false);

  const selected = playbooks.find((p) => p.id === playbookId);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    await onSubmit({
      name,
      playbookId,
      workingDir,
      timeOfDay,
      recurrence: mode === 'daily' ? { kind: 'daily' } : { kind: 'weekly', days },
    });
    setSubmitting(false);
  };

  return (
    <form className="schedules__panel schedules__form" onSubmit={submit}>
      <h2 className="schedules__panelTitle">Tạo phiên đặt lịch</h2>

      <label className="schedules__field">
        <span>Tên phiên</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Bài review hằng ngày" required />
      </label>

      <label className="schedules__field">
        <span>Playbook</span>
        <select value={playbookId} onChange={(e) => setPlaybookId(e.target.value)}>
          {playbooks.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>

      {selected && <p className="schedules__muted">{selected.summary}</p>}

      {selected?.gates?.length ? (
        <ul className="schedules__gates">
          {selected.gates.map((gate) => (
            <li key={gate}>{gate}</li>
          ))}
        </ul>
      ) : null}

      <label className="schedules__field">
        <span>Thư mục pipeline</span>
        <input
          value={workingDir}
          onChange={(e) => setWorkingDir(e.target.value)}
          placeholder="C:\\...\\fb-auto-post"
          required
        />
      </label>

      <div className="schedules__row">
        <label className="schedules__field">
          <span>Giờ chạy</span>
          <input type="time" value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} required />
        </label>

        <label className="schedules__field">
          <span>Tần suất</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as 'daily' | 'weekly')}>
            <option value="daily">Hằng ngày</option>
            <option value="weekly">Theo ngày trong tuần</option>
          </select>
        </label>
      </div>

      {mode === 'weekly' && (
        <div className="schedules__days">
          {WEEKDAY_LABELS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              className={`schedules__day ${days.includes(value) ? 'is-on' : ''}`}
              onClick={() =>
                setDays((prev) => (prev.includes(value) ? prev.filter((d) => d !== value) : [...prev, value]))
              }
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <p className="schedules__muted">
        Mặc định: chạy cả khi máy dùng pin, đánh thức máy nếu đang ngủ, và chạy bù nếu bỏ lỡ giờ — vì
        lịch bị bỏ qua âm thầm là lỗi thường gặp nhất.
      </p>

      <div className="schedules__formActions">
        <button type="submit" className="schedules__primary" disabled={submitting}>
          {submitting ? 'Đang tạo…' : 'Tạo phiên'}
        </button>
        <button type="button" className="schedules__ghost" onClick={onCancel}>
          Huỷ
        </button>
      </div>
    </form>
  );
}

export default ScheduledSessionsPage;
