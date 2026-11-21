import { describe, expect, it, vi } from 'vitest';
import type { AgentProfilesResult } from '../../../shared/agent-profile-types';
import { DIRECTOR_AGENT } from './agent-profile-digest';
import { AgentProfileStore, emptyProfiles } from './agent-profile-store';
import {
  AGENT_PROFILES_MAX_AGENTS_PER_RUN,
  AGENT_PROFILE_FALLBACK_MODEL,
  AGENT_PROFILE_MODEL,
  AgentProfileService,
  type AgentProfileChat,
} from './agent-profile-service';

const NOW = Date.parse('2026-11-19T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const at = (ms: number): string => new Date(ms).toISOString();
const UNAVAILABLE = { reply: '', error: 'http 503: No provider available' };

function pauseOf(result: AgentProfilesResult) {
  return result.ok ? result.state.backgroundPause : 'not ok';
}

function profileText(note: string): string {
  return `Sở thích:\n- ${note}\nQuyết định:\n- giọng thân thiện\nViệc lặp lại:\n- caption hằng tuần\nKết quả gần đây:\n- 2 bài đã duyệt`;
}

function chatSession(content: string, ms: number, agentId = 'socrates', agentName = 'Socrates') {
  return {
    id: `s-${agentId}-${ms}`, agentId, agentName,
    messages: [
      { id: `u-${ms}`, role: 'user', content, state: 'done', createdAt: at(ms) },
      { id: `a-${ms}`, role: 'assistant', content: 'Đã xong', state: 'done', createdAt: at(ms + 1000) },
    ],
  };
}

const MARKETING = {
  runs: [{ id: 'r1', goal: 'Tăng khách tháng 12' }],
  approvals: [{ id: 'a1', runId: 'r1', kind: 'strategy', title: 'Chiến lược 12', status: 'approved', reviewedAt: at(NOW - HOUR) }],
  schedule: { jobs: [], drafts: [] },
};

function reply(profiles: { agentId: string; profile: string }[], extra: { truncated?: boolean } = {}) {
  return { reply: JSON.stringify({ profiles }), ...extra };
}

const BOTH = reply([
  { agentId: 'socrates', profile: profileText('caption ngắn') },
  { agentId: DIRECTOR_AGENT.id, profile: profileText('tập trung tháng 12') },
]);

function setup(options: {
  owner?: () => string | null;
  sessions?: unknown[];
  marketing?: () => Promise<unknown>;
  chat?: AgentProfileChat;
} = {}) {
  let now = NOW;
  const values = new Map<string, string>();
  const store = new AgentProfileStore({ getSetting: (key) => values.get(key) ?? null, setSetting: (key, value) => { values.set(key, value); } });
  const sessions = options.sessions ?? [chatSession('Viết caption ngắn, gọi 0912345678', NOW - 2 * HOUR)];
  const chat = vi.fn(options.chat ?? (async () => BOTH));
  const service = new AgentProfileService({
    store,
    currentOwnerId: options.owner ?? (() => 'user-1'),
    readChatSessions: () => sessions,
    readMarketingSnapshot: options.marketing ?? (async () => MARKETING),
    chat,
    now: () => now,
    log: vi.fn(),
  });
  return { service, chat, store, sessions, advance: (ms: number) => { now += ms; } };
}

describe('AgentProfileService.refresh', () => {
  it('distils new chat and marketing activity in one bounded call and keeps the profiles for review', async () => {
    // Arrange
    const { service, chat, store } = setup();

    // Act
    const result = await service.refresh();

    // Assert
    expect(chat).toHaveBeenCalledTimes(1);
    const [payload, signal] = chat.mock.calls[0];
    expect(payload).toMatchObject({ model: AGENT_PROFILE_MODEL, enableTools: false });
    expect(payload.model).toBe('gpt-6-luna');
    expect(payload.maxTokens).toBe(400 + 700 * 2 + 3000);
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(payload.message).toContain('Agent: Socrates (id: socrates)');
    expect(payload.message).toContain('Chiến lược "Chiến lược 12"');
    expect(payload.message).not.toContain('0912345678');
    expect(result).toMatchObject({ ok: true, updated: 2 });
    if (!result.ok) return;
    expect(result.state.lastRunAt).toBe(at(NOW));
    expect(result.state.profiles.map((profile) => [profile.agentName, profile.approved])).toEqual([
      ['AI Marketing Director', null],
      ['Socrates', null],
    ]);
    expect(store.load('user-1').fingerprints).toHaveLength(1);
  });

  it('reads only newer activity per agent, including what arrived during the call, and builds on the approved profile', async () => {
    // Arrange
    const sessions: unknown[] = [chatSession('Yêu cầu cũ', NOW - 2 * HOUR)];
    const chat = vi.fn(async () => {
      // A turn finishes while the model is answering: it must not be skipped later.
      if (chat.mock.calls.length === 1) sessions.push(chatSession('Trong lúc chạy', NOW - 10 * 60 * 1000));
      return reply([{ agentId: 'socrates', profile: profileText('caption ngắn') }]);
    });
    const { service, advance } = setup({ sessions, marketing: async () => null, chat });
    await service.refresh();
    await service.approve({ agentId: 'socrates' });
    advance(HOUR);

    // Act
    await service.refresh();

    // Assert
    const second = chat.mock.calls[1][0].message as string;
    expect(second).toContain('Trong lúc chạy');
    expect(second).not.toContain('Yêu cầu cũ');
    expect(second).toContain(`Hồ sơ cũ:\n${profileText('caption ngắn')}`);
  });

  it('handles at most 4 agents per run and leaves the rest for the next run', async () => {
    // Arrange
    const sessions = Array.from({ length: 6 }, (_, index) => chatSession(`việc ${index}`, NOW - (index + 1) * HOUR, `agent-${index}`, `Agent ${index}`));
    const { service, chat } = setup({ sessions, marketing: async () => null, chat: async () => reply([]) });

    // Act
    await service.refresh();
    await service.refresh();

    // Assert
    const first = chat.mock.calls[0][0].message as string;
    const second = chat.mock.calls[1][0].message as string;
    expect(first.match(/### Agent:/g)).toHaveLength(AGENT_PROFILES_MAX_AGENTS_PER_RUN);
    expect(first).toContain('(id: agent-5)');
    expect(first).not.toContain('(id: agent-0)');
    expect(second.match(/### Agent:/g)).toHaveLength(2);
    expect(second).toContain('(id: agent-0)');
  });

  it('never starves an agent whose work waits longest, even when others stay busy every day', async () => {
    // Arrange: the Director's review is old; four other agents get new activity before every run.
    const sessions: unknown[] = [];
    const busy = ['a', 'b', 'c'];
    const marketing = {
      ...MARKETING,
      approvals: [{ id: 'a1', runId: 'r1', kind: 'strategy', title: 'Chiến lược 12', status: 'approved', reviewedAt: at(NOW - 20 * HOUR) }],
      schedule: { jobs: [{ id: 'j', kind: 'social_post', channel: 'facebook', title: 'Bài', status: 'failed', updatedAt: at(NOW - 10 * 60_000) }], drafts: [] },
    };
    for (const agent of busy) sessions.push(chatSession(`việc ${agent}`, NOW - 5 * 60_000, agent, agent.toUpperCase()));
    const { service, chat } = setup({ sessions, marketing: async () => marketing, chat: async () => reply([]) });

    // Act
    await service.refresh();

    // Assert
    expect(chat.mock.calls[0][0].message).toContain(`(id: ${DIRECTOR_AGENT.id})`);
  });

  it('[2] says there is nothing new instead of spending a model call, for the owner and in the background', async () => {
    const { service, chat } = setup({ sessions: [], marketing: async () => null });
    expect(await service.refresh()).toEqual({ ok: false, error: 'no_activity' });
    expect(await service.refresh('background')).toEqual({ ok: false, error: 'no_activity' });
    expect(chat).not.toHaveBeenCalled();
    expect(pauseOf(service.getState())).toBeNull();
  });

  it('[2] makes 0 calls once the activity is handled, however often it is asked', async () => {
    // Arrange
    const { service, chat } = setup({ marketing: async () => null });
    await service.refresh();

    // Act
    const results = [await service.refresh(), await service.refresh('background'), await service.refresh()];

    // Assert
    expect(chat).toHaveBeenCalledTimes(1);
    expect(results).toEqual(Array(3).fill({ ok: false, error: 'no_activity' }));
  });

  it('[1] has no daily cap: keeps calling for new activity past the old 3 runs and 6 calls a day', async () => {
    // Arrange
    const { service, chat, sessions, advance } = setup({ marketing: async () => null, chat: async () => reply([]) });
    const results: AgentProfilesResult[] = [];

    // Act
    for (let index = 0; index < 8; index += 1) {
      sessions.push(chatSession(`việc ${index}`, NOW + index * 120_000));
      advance(120_000);
      results.push(await service.refresh());
    }

    // Assert
    expect(chat).toHaveBeenCalledTimes(8);
    expect(results.every((result) => result.ok)).toBe(true);
  });

  it('[1] lets the owner retry a failed run as often as needed: failed calls use up nothing', async () => {
    // Arrange
    const chat = vi.fn().mockResolvedValue(UNAVAILABLE);
    const { service } = setup({ chat });

    // Act
    const results: AgentProfilesResult[] = [];
    for (let index = 0; index < 5; index += 1) results.push(await service.refresh());

    // Assert
    expect(chat).toHaveBeenCalledTimes(10);
    expect(results).toEqual(Array(5).fill({ ok: false, error: 'model_unavailable' }));
  });

  it('[6] has no monthly cap: a run a day with new activity for 31 days is never refused', async () => {
    // Arrange
    const { service, chat, sessions, advance } = setup({ marketing: async () => null, chat: async () => reply([]) });
    const results: AgentProfilesResult[] = [];

    // Act
    for (let day = 1; day <= 31; day += 1) {
      advance(DAY);
      sessions.push(chatSession(`ngày ${day}`, NOW + day * DAY - HOUR));
      results.push(await service.refresh(day % 2 === 0 ? 'background' : 'owner'));
    }

    // Assert
    expect(chat).toHaveBeenCalledTimes(31);
    expect(results.every((result) => result.ok)).toBe(true);
  });

  it('falls back once to gpt-4o-mini, which needs no room for reasoning', async () => {
    // Arrange
    const chat = vi.fn()
      .mockResolvedValueOnce(UNAVAILABLE)
      .mockResolvedValueOnce(reply([{ agentId: 'socrates', profile: profileText('ngắn') }]));
    const { service } = setup({ chat });

    // Act
    const result = await service.refresh();

    // Assert
    expect(chat.mock.calls.map((call) => call[0].model)).toEqual([AGENT_PROFILE_MODEL, AGENT_PROFILE_FALLBACK_MODEL]);
    expect(chat.mock.calls[1][0].model).toBe('gpt-4o-mini');
    expect(chat.mock.calls[1][0].maxTokens).toBe(400 + 700 * 2);
    expect(result.ok).toBe(true);
  });

  it('[3] stops on a 402 answer at once, with no fallback call, and leaves the activity for later', async () => {
    // Arrange
    const chat = vi.fn().mockResolvedValue({ reply: '', error: 'http 402: insufficient balance' });
    const { service, store } = setup({ chat });

    // Act
    const result = await service.refresh();

    // Assert
    expect(result).toEqual({ ok: false, error: 'quota' });
    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat.mock.calls[0][0].model).toBe(AGENT_PROFILE_MODEL);
    expect(store.load('user-1').watermarks).toEqual({});
    // The owner sees the 402 right away; no background pause is set for something the owner did.
    expect(pauseOf(service.getState())).toBeNull();
  });

  it('[3] a background run that meets 402 stops background runs until "Tiếp tục"; the owner can still run', async () => {
    // Arrange
    const chat = vi.fn()
      .mockResolvedValueOnce({ reply: '', error: 'http 402: insufficient balance' })
      .mockResolvedValue(reply([{ agentId: 'socrates', profile: profileText('ngắn') }]));
    const { service, sessions, advance } = setup({ chat, marketing: async () => null });

    // Act
    const first = await service.refresh('background');
    advance(HOUR);
    sessions.push(chatSession('việc mới', NOW + 30 * 60_000));
    const next = await service.refresh('background');
    const owner = await service.refresh();

    // Assert
    expect(first).toEqual({ ok: false, error: 'quota' });
    expect(next).toEqual({ ok: false, error: 'paused' });
    expect(owner).toMatchObject({ ok: true, updated: 1 });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(pauseOf(owner)).toEqual({ reason: 'quota', at: at(NOW) });
  });

  it('[4] gives up on a call after 90 s, then tries the fallback once with its own 90 s', async () => {
    vi.useFakeTimers();
    try {
      // Arrange: a server that never answers and ignores the abort.
      const signals: AbortSignal[] = [];
      const chat = vi.fn((_payload: unknown, signal: AbortSignal) => {
        signals.push(signal);
        return new Promise<never>(() => {});
      });
      const { service } = setup({ chat });

      // Act
      const run = service.refresh();
      await vi.advanceTimersByTimeAsync(0);
      const startedCalls = chat.mock.calls.length;
      await vi.advanceTimersByTimeAsync(89_999);
      const abortedBefore = signals[0].aborted;
      await vi.advanceTimersByTimeAsync(1);
      const abortedAt90s = signals[0].aborted;
      const callsAfterFirstTimeout = chat.mock.calls.length;
      await vi.advanceTimersByTimeAsync(90_000);

      // Assert
      expect(startedCalls).toBe(1);
      expect(abortedBefore).toBe(false);
      expect(abortedAt90s).toBe(true);
      expect(callsAfterFirstTimeout).toBe(2);
      expect(await run).toEqual({ ok: false, error: 'model_unavailable' });
      expect(signals[1].aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('[5] pauses background runs instead of resending an input already sent, and keeps them paused', async () => {
    // Arrange
    const chat = vi.fn().mockResolvedValue(UNAVAILABLE);
    const { service } = setup({ chat, marketing: async () => null });

    // Act
    const first = await service.refresh('background');
    const second = await service.refresh('background');
    const third = await service.refresh('background');

    // Assert
    expect(first).toEqual({ ok: false, error: 'model_unavailable' });
    expect(second).toEqual({ ok: false, error: 'paused' });
    expect(third).toEqual({ ok: false, error: 'paused' });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(pauseOf(service.getState())).toEqual({ reason: 'repeat_input', at: at(NOW) });
  });

  it('[5] pauses the third background run in a row that would send no new activity', async () => {
    // Arrange: Socrates' activity was sent once already and never answered; its profile is in use.
    const chat = vi.fn().mockResolvedValue(UNAVAILABLE);
    const { service, store } = setup({ chat, marketing: async () => null });
    store.save('user-1', {
      ...emptyProfiles(),
      sent: { socrates: at(NOW - 2 * HOUR + 1000) },
      idleRuns: 1,
      agents: { socrates: { agentName: 'Socrates', approved: { text: profileText('cũ'), at: at(NOW - DAY) }, pending: null } },
    });

    // Act: the second idle run still calls; the owner then drops the profile, so the next input differs.
    const second = await service.refresh('background');
    await service.forget({ agentId: 'socrates' });
    const third = await service.refresh('background');

    // Assert
    expect(second).toEqual({ ok: false, error: 'model_unavailable' });
    expect(third).toEqual({ ok: false, error: 'paused' });
    expect(chat).toHaveBeenCalledTimes(2);
    expect(pauseOf(service.getState())).toEqual({ reason: 'idle_runs', at: at(NOW) });
  });

  it('[5] never blocks the owner\'s click, even while background runs are paused on that same input', async () => {
    // Arrange
    const chat = vi.fn()
      .mockResolvedValueOnce(UNAVAILABLE)
      .mockResolvedValueOnce(UNAVAILABLE)
      .mockResolvedValue(reply([{ agentId: 'socrates', profile: profileText('ngắn') }]));
    const { service } = setup({ chat, marketing: async () => null });
    await service.refresh('background');
    await service.refresh('background');

    // Act
    const owner = await service.refresh();

    // Assert
    expect(owner).toMatchObject({ ok: true, updated: 1 });
    expect(chat).toHaveBeenCalledTimes(3);
    expect(pauseOf(owner)).toEqual({ reason: 'repeat_input', at: at(NOW) });
  });

  it('[5] spends nothing in the background when it cannot remember what it sent; the owner still runs', async () => {
    // Arrange
    const { service, chat, store } = setup({ marketing: async () => null });
    const save = vi.spyOn(store, 'save').mockReturnValue(false);

    // Act
    const background = await service.refresh('background');
    const owner = await service.refresh();

    // Assert
    expect(background).toEqual({ ok: false, error: 'storage' });
    expect(owner.ok).toBe(true);
    expect(chat).toHaveBeenCalledTimes(1);
    save.mockRestore();
  });

  it('[5] "Tiếp tục" lets background runs call the model again', async () => {
    // Arrange
    const chat = vi.fn()
      .mockResolvedValueOnce(UNAVAILABLE)
      .mockResolvedValueOnce(UNAVAILABLE)
      .mockResolvedValue(reply([{ agentId: 'socrates', profile: profileText('ngắn') }]));
    const { service } = setup({ chat, marketing: async () => null });
    await service.refresh('background');
    await service.refresh('background');

    // Act
    const resumed = await service.resume();
    const again = await service.refresh('background');

    // Assert
    expect(pauseOf(resumed)).toBeNull();
    expect(again).toMatchObject({ ok: true, updated: 1 });
    expect(chat).toHaveBeenCalledTimes(3);
    expect(await setup({ owner: () => null }).service.resume()).toEqual({ ok: false, error: 'auth' });
  });

  it('never loops on an unusable or cut-off answer: the run counts and that activity is done', async () => {
    // Arrange
    const chat = vi.fn()
      .mockResolvedValueOnce({ reply: 'xin lỗi' })
      .mockResolvedValueOnce(reply([{ agentId: 'socrates', profile: profileText('ngắn') }], { truncated: true }));
    const { service, sessions, advance } = setup({ chat, marketing: async () => null });

    // Act
    const first = await service.refresh();
    const again = await service.refresh();
    advance(HOUR);
    sessions.push(chatSession('việc mới', NOW + 30 * 60 * 1000));
    const truncated = await service.refresh();

    // Assert
    expect(first).toEqual({ ok: false, error: 'invalid_output' });
    expect(again).toEqual({ ok: false, error: 'no_activity' });
    expect(truncated).toEqual({ ok: false, error: 'invalid_output' });
    const state = service.getState();
    expect(state.ok && state.state.lastRunAt).toBe(at(NOW + HOUR));
  });

  it('reports every profile dropped by the checks as unusable, not as nothing new', async () => {
    const { service } = setup({ chat: async () => reply([{ agentId: 'socrates', profile: profileText('gọi 0912345678') }]) });
    expect(await service.refresh()).toEqual({ ok: false, error: 'invalid_output' });
  });

  it('drops the answer when the account changed during the call, or before it', async () => {
    // Arrange
    let owner: string | null = 'user-1';
    const during = setup({
      owner: () => owner,
      chat: async () => { owner = 'user-2'; return BOTH; },
    });
    let owner2: string | null = 'user-1';
    const before = setup({
      owner: () => owner2,
      marketing: async () => { owner2 = 'user-2'; return MARKETING; },
    });

    // Act
    const duringResult = await during.service.refresh();
    const beforeResult = await before.service.refresh();

    // Assert
    expect(duringResult).toEqual({ ok: false, error: 'auth' });
    expect(during.store.load('user-1').agents).toEqual({});
    expect(during.store.load('user-2').agents).toEqual({});
    expect(beforeResult).toEqual({ ok: false, error: 'auth' });
    expect(before.chat).not.toHaveBeenCalled();
  });

  it('[4] runs one at a time: busy for a second refresh, a background run, approve, discard or "Tiếp tục"', async () => {
    // Arrange
    let release: (value: { reply: string }) => void = () => {};
    const { service, chat } = setup({ chat: () => new Promise((resolve) => { release = resolve; }) });
    const signedOut = setup({ owner: () => null });

    // Act
    const first = service.refresh();
    const second = await service.refresh();
    const background = await service.refresh('background');
    const discard = await service.discard({ agentId: 'socrates' });
    const resume = await service.resume();
    await vi.waitFor(() => expect(chat).toHaveBeenCalled());
    release(BOTH);
    await first;

    // Assert
    expect(second).toEqual({ ok: false, error: 'busy' });
    expect(background).toEqual({ ok: false, error: 'busy' });
    expect(discard).toEqual({ ok: false, error: 'busy' });
    expect(resume).toEqual({ ok: false, error: 'busy' });
    expect(chat).toHaveBeenCalledTimes(1);
    expect(await signedOut.service.refresh()).toEqual({ ok: false, error: 'auth' });
  });

  it('keeps working on chat history alone when the marketing snapshot cannot be read', async () => {
    const { service } = setup({ marketing: async () => { throw new Error('no workspace'); } });
    expect((await service.refresh()).ok).toBe(true);
  });
});

describe('AgentProfileService approve and discard', () => {
  it('approves or discards a pending profile and validates the input', async () => {
    // Arrange
    const { service } = setup();
    await service.refresh();

    // Act
    const approved = await service.approve({ agentId: 'socrates' });
    const discarded = await service.discard({ agentId: DIRECTOR_AGENT.id });
    const again = await service.approve({ agentId: 'socrates' });

    // Assert
    expect(approved.ok && approved.state.profiles.find((p) => p.agentId === 'socrates')?.approved?.text).toBe(profileText('caption ngắn'));
    expect(discarded.ok && discarded.state.profiles.find((p) => p.agentId === DIRECTOR_AGENT.id)?.pending).toBeNull();
    expect(again).toEqual({ ok: false, error: 'not_found' });
    expect(await service.approve({ agentId: 42 })).toEqual({ ok: false, error: 'invalid_input' });
    expect(await service.discard(null)).toEqual({ ok: false, error: 'invalid_input' });
  });
});

describe('AgentProfileService forget and approvedProfile', () => {
  it('reads only the approved profile of the signed-in account, and forget stops using it', async () => {
    // Arrange
    let owner: string | null = 'user-1';
    const { service } = setup({ owner: () => owner });
    await service.refresh();
    expect(service.approvedProfile('socrates')).toBeNull();
    await service.approve({ agentId: 'socrates' });

    // Act
    const inUse = service.approvedProfile('socrates');
    const forOwner = service.approvedProfile('socrates', 'user-1');
    const forOtherOwner = service.approvedProfile('socrates', 'user-2');
    owner = 'user-2';
    const otherAccount = service.approvedProfile('socrates');
    owner = 'user-1';
    const forgotten = await service.forget({ agentId: 'socrates' });

    // Assert
    expect(inUse).toBe(profileText('caption ngắn'));
    expect(forOwner).toBe(inUse);
    expect(forOtherOwner).toBeNull();
    expect(otherAccount).toBeNull();
    expect(forgotten.ok && forgotten.state.profiles.find((p) => p.agentId === 'socrates')).toBeUndefined();
    expect(service.approvedProfile('socrates')).toBeNull();
    expect(await service.forget({ agentId: 'socrates' })).toEqual({ ok: false, error: 'not_found' });
    expect(await service.forget({})).toEqual({ ok: false, error: 'invalid_input' });
    expect(service.approvedProfile('')).toBeNull();
  });
});

describe('AgentProfileService when the settings write fails', () => {
  it('reports the failure instead of a change that was not saved', async () => {
    // Arrange
    const { service, store } = setup();
    await service.refresh();
    await service.approve({ agentId: 'socrates' });
    vi.spyOn(store, 'save').mockReturnValue(false);

    // Act
    const result = await service.forget({ agentId: 'socrates' });

    // Assert
    expect(result).toEqual({ ok: false, error: 'storage' });
    expect(service.approvedProfile('socrates')).toBe(profileText('caption ngắn'));
  });
});
