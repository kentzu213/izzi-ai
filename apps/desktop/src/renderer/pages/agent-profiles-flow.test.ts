import { describe, expect, it } from 'vitest';
import type { AgentProfilesError, AgentProfilesState } from '../../shared/agent-profile-types';
import { agentProfilesErrorText, refreshButtonState, refreshNotice } from './agent-profiles-flow';

const STATE: AgentProfilesState = {
  profiles: [], lastRunAt: null, runsToday: 0, maxRunsPerDay: 3, callsToday: 0, maxCallsPerDay: 6,
};

describe('agentProfilesErrorText', () => {
  it('has a Vietnamese message for every error code', () => {
    const codes: AgentProfilesError[] = [
      'auth', 'busy', 'no_activity', 'daily_limit', 'quota', 'model_unavailable', 'invalid_output', 'invalid_input', 'not_found',
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
