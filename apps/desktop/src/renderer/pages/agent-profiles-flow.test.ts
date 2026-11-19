import { describe, expect, it } from 'vitest';
import type { AgentProfilesError, AgentProfilesState } from '../../shared/agent-profile-types';
import {
  agentProfilesErrorText,
  forgetConfirmText,
  profileLineDiff,
  profileUseNote,
  refreshButtonState,
  refreshNotice,
} from './agent-profiles-flow';
import { CONTENT_AGENT, DIRECTOR_AGENT } from '../../main/agents/memory/agent-profile-digest';

const STATE: AgentProfilesState = {
  profiles: [], lastRunAt: null, runsToday: 0, maxRunsPerDay: 3, callsToday: 0, maxCallsPerDay: 6,
};

describe('agentProfilesErrorText', () => {
  it('has a Vietnamese message for every error code', () => {
    const codes: AgentProfilesError[] = [
      'auth', 'busy', 'no_activity', 'daily_limit', 'quota', 'model_unavailable', 'invalid_output', 'invalid_input', 'not_found', 'storage',
    ];
    for (const code of codes) {
      expect(agentProfilesErrorText(code).length).toBeGreaterThan(10);
    }
    expect(agentProfilesErrorText('daily_limit')).not.toMatch(/\d/);
    expect(agentProfilesErrorText('invalid_output')).toContain('chỉ đọc hoạt động mới');
  });
});

describe('refreshButtonState', () => {
  it('is enabled with runs left, shows progress while running and stops at the daily cap', () => {
    expect(refreshButtonState(STATE, false)).toEqual({ disabled: false, label: 'Cập nhật hồ sơ ngay', hint: 'Còn 3/3 lần hôm nay.' });
    expect(refreshButtonState(STATE, true)).toMatchObject({ disabled: true, label: 'Đang chắt lọc…' });
    expect(refreshButtonState({ ...STATE, runsToday: 3 }, false)).toMatchObject({ disabled: true, hint: 'Đã dùng hết 3 lần hôm nay.' });
    expect(refreshButtonState(null, false)).toMatchObject({ disabled: true });
  });

  it('also stops when the model calls for today are used up, even with runs left', () => {
    expect(refreshButtonState({ ...STATE, runsToday: 0, callsToday: 6 }, false)).toEqual({
      disabled: true, label: 'Cập nhật hồ sơ ngay', hint: 'Đã dùng hết lượt gọi AI hôm nay.',
    });
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
