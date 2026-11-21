import React, { useCallback, useEffect, useState } from 'react';
import type { AgentProfileView, AgentProfilesResult, AgentProfilesState } from '../../shared/agent-profile-types';
import {
  agentProfilesErrorText,
  backgroundPauseNotice,
  forgetConfirmText,
  profileLineDiff,
  profileUseNote,
  refreshButtonState,
  refreshNotice,
} from '../pages/agent-profiles-flow';

/**
 * "Hồ sơ agent" on the Memory page (docs/MYGRAPH-AGENT-MEMORY.md, S2 and S4): the owner asks izzi to
 * distil one short profile per agent from their own recent work, sees what changed against the profile in
 * use, then approves ("Dùng") or drops ("Bỏ") it. "Ngừng dùng" removes the approved profile. When background
 * runs pause on their own, "Tiếp tục" resumes them; the owner's own update button is never blocked.
 */
type ProfileAction = 'approve' | 'discard' | 'forget';

export function AgentProfilesSection() {
  const api = window.electronAPI?.agentProfiles;
  const [state, setState] = useState<AgentProfilesState | null>(null);
  const [running, setRunning] = useState(false);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [resuming, setResuming] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  /** Reads the current account's state; the signed-in account is always resolved in main. */
  const reload = useCallback(async () => {
    if (!api) return;
    try {
      const result = await api.get();
      setState(result.ok ? result.state : null);
      if (!result.ok) setNotice(agentProfilesErrorText(result.error));
    } catch {
      setNotice(agentProfilesErrorText('model_unavailable'));
    }
  }, [api]);

  useEffect(() => {
    void reload();
    // Re-read when the window comes back: the account may have changed meanwhile.
    const onFocus = () => { void reload(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [reload]);

  if (!api) return null;

  const finish = async (result: AgentProfilesResult, message: string | null) => {
    if (result.ok) setState(result.state);
    else await reload();
    setNotice(message);
  };

  const refresh = async () => {
    setRunning(true);
    setNotice(null);
    try {
      const result = await api.refresh();
      await finish(result, refreshNotice(result));
    } catch {
      await finish({ ok: false, error: 'model_unavailable' }, agentProfilesErrorText('model_unavailable'));
    } finally {
      setRunning(false);
    }
  };

  const act = async (kind: ProfileAction, profile: AgentProfileView) => {
    if (kind === 'forget' && !window.confirm(forgetConfirmText(profile.agentName))) return;
    const { agentId } = profile;
    setActingOn(agentId);
    try {
      const result = await api[kind]({ agentId });
      await finish(result, result.ok ? null : agentProfilesErrorText(result.error));
    } catch {
      setNotice(agentProfilesErrorText('model_unavailable'));
    } finally {
      setActingOn(null);
    }
  };

  const resume = async () => {
    setResuming(true);
    try {
      const result = await api.resume();
      await finish(result, result.ok ? null : agentProfilesErrorText(result.error));
    } catch {
      setNotice(agentProfilesErrorText('model_unavailable'));
    } finally {
      setResuming(false);
    }
  };

  const button = refreshButtonState(state, running);
  const pauseNotice = backgroundPauseNotice(state);
  const profiles = state?.profiles ?? [];

  return (
    <section className="memory-section" aria-labelledby="agent-profiles-title">
      <div className="memory-section__header">
        <h3 id="agent-profiles-title" className="memory-section__title">Hồ sơ agent</h3>
        <span className="memory-section__count">{profiles.length || ''}</span>
        <button
          type="button"
          className="btn btn--primary btn--sm"
          onClick={() => void refresh()}
          disabled={button.disabled}
          aria-busy={running}
          style={{ marginInlineStart: 'auto' }}
        >
          {button.label}
        </button>
      </div>
      <p className="memory-section__empty">
        izzi đọc việc bạn đã làm với từng agent trên máy này (đã ẩn số điện thoại, email, Zalo) rồi viết một hồ sơ
        ngắn. Bạn bấm &quot;Dùng&quot; thì hồ sơ mới thay hồ sơ cũ. Khi bạn chat, agent đọc hồ sơ đã duyệt như dữ
        liệu tham khảo, không thêm quyền gì. Bấm &quot;Ngừng dùng&quot; để gỡ.
        {button.hint ? ` ${button.hint}` : ''}
      </p>
      {pauseNotice ? (
        <div className="memory-section__empty" role="status">
          {pauseNotice}{' '}
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => void resume()}
            disabled={running || resuming}
            aria-busy={resuming}
          >
            Tiếp tục
          </button>
        </div>
      ) : null}
      {notice ? <div className="memory-section__empty" role="status">{notice}</div> : null}
      {profiles.length === 0 ? (
        <div className="memory-section__empty">Chưa có hồ sơ nào. Bấm &quot;Cập nhật hồ sơ ngay&quot; để tạo.</div>
      ) : (
        <div className="memory-grid">
          {profiles.map((profile) => (
            <AgentProfileCard
              key={profile.agentId}
              profile={profile}
              disabled={running || actingOn !== null}
              busy={actingOn === profile.agentId}
              onAct={act}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function AgentProfileCard({
  profile,
  disabled,
  busy,
  onAct,
}: {
  profile: AgentProfileView;
  disabled: boolean;
  busy: boolean;
  onAct: (kind: ProfileAction, profile: AgentProfileView) => Promise<void>;
}) {
  const useNote = profileUseNote(profile.agentId);
  return (
    <article className="memory-card glass-card" aria-busy={busy}>
      <div className="memory-card__meta">
        <span className="memory-card__kind">{profile.agentName}</span>
        <span>{profile.pending ? 'Có bản mới chờ duyệt' : 'Đang dùng'}</span>
      </div>
      {useNote ? <div className="memory-card__meta">{useNote}</div> : null}
      {profile.pending ? (
        <>
          <div className="memory-card__content" style={{ whiteSpace: 'pre-wrap' }}>{profile.pending.text}</div>
          {profile.approved ? <ProfileChanges approvedText={profile.approved.text} pendingText={profile.pending.text} /> : null}
          <div className="memory-card__actions">
            <button
              type="button"
              className="btn btn--primary btn--sm"
              disabled={disabled}
              aria-label={`Dùng hồ sơ mới của ${profile.agentName}`}
              onClick={() => void onAct('approve', profile)}
            >
              Dùng
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={disabled}
              aria-label={`Bỏ hồ sơ mới của ${profile.agentName}`}
              onClick={() => void onAct('discard', profile)}
            >
              Bỏ
            </button>
          </div>
        </>
      ) : null}
      {profile.approved ? (
        <details>
          <summary>Hồ sơ đang dùng ({new Date(profile.approved.at).toLocaleString('vi-VN')})</summary>
          <div className="memory-card__content" style={{ whiteSpace: 'pre-wrap' }}>{profile.approved.text}</div>
        </details>
      ) : null}
      {profile.approved ? (
        <div className="memory-card__actions">
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={disabled}
            aria-label={`Ngừng dùng hồ sơ của ${profile.agentName}`}
            onClick={() => void onAct('forget', profile)}
          >
            Ngừng dùng
          </button>
        </div>
      ) : null}
    </article>
  );
}

/** What "Dùng" would change: the lines the new profile adds and the ones it drops. */
function ProfileChanges({ approvedText, pendingText }: { approvedText: string; pendingText: string }) {
  const { added, removed } = profileLineDiff(approvedText, pendingText);
  if (added.length === 0 && removed.length === 0) {
    return <div className="memory-card__meta">Giống hồ sơ đang dùng.</div>;
  }
  return (
    <div className="memory-card__content">
      <strong>Khác với hồ sơ đang dùng:</strong>
      <ul style={{ margin: '4px 0 0', paddingInlineStart: 16 }}>
        {added.map((line, index) => <li key={`added-${index}`}>Thêm: {line}</li>)}
        {removed.map((line, index) => <li key={`removed-${index}`}>Không còn: {line}</li>)}
      </ul>
    </div>
  );
}
