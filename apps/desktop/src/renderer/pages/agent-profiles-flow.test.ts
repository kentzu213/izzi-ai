import { describe, expect, it } from 'vitest';
import type { AgentProfilesError, AgentProfilesState } from '../../shared/agent-profile-types';
import {
  agentProfilesErrorText,
  backgroundPauseNotice,
  forgetConfirmText,
  profileLineDiff,
  profileUseNote,
  refreshButtonState,
  refreshNotice,
} from './agent-profiles-flow';
import { CONTENT_AGENT, DIRECTOR_AGENT } from '../../main/agents/memory/agent-profile-digest';

const STATE: AgentProfilesState = { profiles: [], lastRunAt: null, backgroundPause: null };
const PAUSED_AT = '2026-11-21T01:00:00.000Z';

describe('agentProfilesErrorText', () => {
  it('has a Vietnamese message for every error code', () => {
    const codes: AgentProfilesError[] = [
      'auth', 'busy', 'no_activity', 'paused', 'quota', 'refused', 'model_unavailable', 'invalid_output', 'invalid_input', 'not_found', 'storage',
    ];
    for (const code of codes) {
      expect(agentProfilesErrorText(code).length).toBeGreaterThan(10);
    }
    expect(agentProfilesErrorText('invalid_output')).toContain('chỉ đọc hoạt động mới');
    expect(agentProfilesErrorText('paused')).toContain('Tiếp tục');
  });

  it('[3] says plainly that a 402 stopped the run and no other model was tried, and where a 402 may come from', () => {
    const text = agentProfilesErrorText('quota');
    expect(text).toContain('402');
    expect(text).toContain('không thử model khác');
    expect(text).toContain('Nạp thêm credit');
    expect(text).toContain('nhà cung cấp model');
  });

  it('[3] never calls a refusal on another status a 402 or an empty balance', () => {
    const text = agentProfilesErrorText('refused');
    expect(text).not.toContain('402');
    expect(text).not.toContain('hết credit');
    expect(text).toContain('hạn mức');
    expect(text).toContain('quyền');
  });
});

describe('refreshButtonState', () => {
  it('[1] is enabled whenever nothing is running, with no daily count, and shows progress while running', () => {
    expect(refreshButtonState(STATE, false)).toEqual({
      disabled: false, label: 'Cập nhật hồ sơ ngay', hint: 'izzi chỉ gọi AI khi có hoạt động mới.',
    });
    expect(refreshButtonState(STATE, false).hint).not.toMatch(/\d|hôm nay/);
    expect(refreshButtonState(STATE, true)).toMatchObject({ disabled: true, label: 'Đang chắt lọc…' });
    expect(refreshButtonState(null, false)).toMatchObject({ disabled: true });
  });

  it('[5] stays enabled while background runs are paused: the owner\'s click is never blocked', () => {
    for (const reason of ['repeat_input', 'idle_runs', 'quota'] as const) {
      expect(refreshButtonState({ ...STATE, backgroundPause: { reason, at: PAUSED_AT } }, false).disabled).toBe(false);
    }
  });
});

describe('backgroundPauseNotice', () => {
  it('[5] explains each background pause and points to "Tiếp tục"; nothing when not paused', () => {
    expect(backgroundPauseNotice(STATE)).toBeNull();
    expect(backgroundPauseNotice(null)).toBeNull();
    const texts = (['repeat_input', 'idle_runs', 'quota'] as const)
      .map((reason) => backgroundPauseNotice({ ...STATE, backgroundPause: { reason, at: PAUSED_AT } }));
    for (const text of texts) {
      expect(text).toContain('Tiếp tục');
      expect(text).toContain('Cập nhật hồ sơ ngay');
    }
    expect(new Set(texts).size).toBe(3);
    expect(texts[2]).toContain('402');
    expect(texts[2]).toContain('nhà cung cấp model');
  });
});

describe('refreshNotice', () => {
  it('tells the owner to review new profiles, or explains why nothing changed', () => {
    expect(refreshNotice({ ok: true, state: STATE, updated: 2 })).toBe('Đã cập nhật 2 hồ sơ. Xem rồi bấm "Dùng" cho hồ sơ bạn đồng ý.');
    expect(refreshNotice({ ok: true, state: STATE, updated: 0 })).toBe('Chưa có điều gì đáng ghi thêm vào hồ sơ.');
    expect(refreshNotice({ ok: false, error: 'no_activity' })).toBe(agentProfilesErrorText('no_activity'));
  });
});

describe('profileLineDiff', () => {
  it('lists the lines the new profile adds and the ones it drops, ignoring blank lines and spacing', () => {
    // Arrange
    const approved = 'Sở thích:\n- câu ngắn\n- ưu tiên Facebook\n\nQuyết định:\n- tập trung tháng 12';
    const pending = 'Sở thích:\n-  câu ngắn\n- thêm TikTok\nQuyết định:\n- tập trung tháng 12\n';

    // Act
    const diff = profileLineDiff(approved, pending);

    // Assert
    expect(diff).toEqual({ added: ['- thêm TikTok'], removed: ['- ưu tiên Facebook'] });
    expect(profileLineDiff(pending, pending)).toEqual({ added: [], removed: [] });
  });
});

describe('profileUseNote', () => {
  it('says how each agent uses its approved profile', () => {
    expect(profileUseNote('hermes')).toContain('không đọc');
    expect(profileUseNote('customer-marketing-content')).toContain('không đọc');
    expect(profileUseNote('customer-marketing-director')).toContain('gợi ý');
    expect(profileUseNote(DIRECTOR_AGENT.id)).toContain('gợi ý');
    expect(profileUseNote(CONTENT_AGENT.id)).toContain('không đọc');
    expect(profileUseNote('socrates')).toBeNull();
  });
});

describe('forgetConfirmText', () => {
  it('names the agent and says the approved profile is removed', () => {
    const text = forgetConfirmText('Socrates');
    expect(text).toContain('Socrates');
    expect(text).toContain('Ngừng dùng');
  });
});
