import { describe, expect, it } from 'vitest';
import {
  AGENT_PROFILES_LOOP_IDLE_RUNS,
  AgentProfileStore,
  advanceWatermarks,
  approveProfile,
  backgroundLoopReason,
  discardProfile,
  emptyProfiles,
  forgetProfile,
  pauseBackground,
  recordRun,
  recordSend,
  resumeBackground,
  setPendingProfiles,
  toProfilesState,
  watermarkMs,
} from './agent-profile-store';

const NOW = Date.parse('2026-11-19T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const iso = (ms: number): string => new Date(ms).toISOString();
const FP_A = 'a'.repeat(64);
const FP_B = 'b'.repeat(64);
const FP_C = 'c'.repeat(64);

function memoryStore() {
  const values = new Map<string, string>();
  return { values, getSetting: (key: string) => values.get(key) ?? null, setSetting: (key: string, value: string) => { values.set(key, value); } };
}

describe('AgentProfileStore', () => {
  it('keeps each account apart under a hashed key and round-trips the data', () => {
    // Arrange
    const settings = memoryStore();
    const store = new AgentProfileStore(settings);
    const data = pauseBackground(recordSend(recordRun(
      setPendingProfiles(emptyProfiles(), [{ agentId: 'socrates', text: 'Sở thích: ngắn.' }], { socrates: 'Socrates' }, NOW),
      NOW,
      { socrates: NOW - HOUR },
    ), FP_A, { socrates: NOW }, 'background'), 'repeat_input', NOW);

    // Act
    store.save('user-1', data);

    // Assert
    expect(store.load('user-1')).toEqual(data);
    expect(store.load('user-2')).toEqual(emptyProfiles());
    expect([...settings.values.keys()].join()).not.toContain('user-1');
  });

  it('starts empty on missing, corrupt or wrong-version data, and drops bad parts', () => {
    // Arrange
    const settings = memoryStore();
    const store = new AgentProfileStore(settings);
    store.save('user-1', emptyProfiles());
    const key = [...settings.values.keys()][0];

    // Act + Assert
    settings.values.set(key, '{not json');
    expect(store.load('user-1')).toEqual(emptyProfiles());
    settings.values.set(key, JSON.stringify({ version: 9, agents: {} }));
    expect(store.load('user-1')).toEqual(emptyProfiles());
    settings.values.set(key, JSON.stringify({
      ...emptyProfiles(),
      agents: { socrates: { agentName: 'S', approved: { text: 5 } } },
      watermarks: { socrates: 'yesterday', builder: iso(NOW) },
    }));
    expect(store.load('user-1').agents).toEqual({});
    expect(store.load('user-1').watermarks).toEqual({ builder: iso(NOW) });
    settings.values.set(key, JSON.stringify({
      ...emptyProfiles(),
      sent: { socrates: 'soon', builder: iso(NOW) },
      fingerprints: [FP_A, 'not-a-hash', 7],
      idleRuns: -2,
      pause: { reason: 'tired', at: iso(NOW) },
    }));
    expect(store.load('user-1')).toMatchObject({ sent: { builder: iso(NOW) }, fingerprints: [FP_A], idleRuns: 0, pause: null });
  });

  it('reads data saved before the daily caps were removed, dropping the old day counters', () => {
    // Arrange
    const settings = memoryStore();
    const store = new AgentProfileStore(settings);
    store.save('user-1', emptyProfiles());
    const key = [...settings.values.keys()][0];
    settings.values.set(key, JSON.stringify({
      version: 1, lastRunAt: iso(NOW), runDay: '2026-11-19', runsToday: 3, callDay: '2026-11-19', callsToday: 6,
      watermarks: { socrates: iso(NOW - HOUR) }, agents: {},
    }));

    // Act
    const loaded = store.load('user-1');

    // Assert
    expect(loaded).toEqual({ ...emptyProfiles(), lastRunAt: iso(NOW), watermarks: { socrates: iso(NOW - HOUR) } });
  });
});

describe('profile state changes', () => {
  it('puts new profiles in review and keeps the approved one until the owner approves', () => {
    // Arrange
    const approved = approveProfile(
      setPendingProfiles(emptyProfiles(), [{ agentId: 'socrates', text: 'v1' }], { socrates: 'Socrates' }, NOW),
      'socrates',
      NOW + 1000,
    )!;

    // Act
    const next = setPendingProfiles(approved, [{ agentId: 'socrates', text: 'v2' }], { socrates: 'Socrates' }, NOW + 2000);

    // Assert
    expect(next.agents.socrates).toEqual({
      agentName: 'Socrates',
      approved: { text: 'v1', at: iso(NOW + 1000) },
      pending: { text: 'v2', at: iso(NOW + 2000) },
    });
    expect(approved.agents.socrates.pending).toBeNull();
  });

  it('approve moves the pending profile in; discard drops it; both refuse when nothing is pending', () => {
    // Arrange
    const data = setPendingProfiles(emptyProfiles(), [{ agentId: 'socrates', text: 'v1' }], { socrates: 'Socrates' }, NOW);

    // Act
    const approved = approveProfile(data, 'socrates', NOW + 5);
    const discarded = discardProfile(data, 'socrates');

    // Assert
    expect(approved?.agents.socrates.approved).toEqual({ text: 'v1', at: iso(NOW + 5) });
    expect(discarded?.agents.socrates.pending).toBeNull();
    expect(approveProfile(approved!, 'socrates', NOW)).toBeNull();
    expect(discardProfile(emptyProfiles(), 'builder')).toBeNull();
    expect(data.agents.socrates.pending).not.toBeNull();
  });

  it('[1][6] reports the view sorted by agent name, with no daily or monthly counter or cap', () => {
    // Arrange
    let data = setPendingProfiles(
      emptyProfiles(),
      [{ agentId: 'socrates', text: 's' }, { agentId: 'builder', text: 'b' }],
      { socrates: 'Socrates', builder: 'Builder' },
      NOW,
    );

    // Act
    data = recordRun(recordRun(data, NOW, {}), NOW + 1000, {});
    const state = toProfilesState(data);

    // Assert
    expect(Object.keys(state).sort()).toEqual(['backgroundPause', 'lastRunAt', 'profiles']);
    expect(state).toMatchObject({ lastRunAt: iso(NOW + 1000), backgroundPause: null });
    expect(state.profiles.map((profile) => profile.agentName)).toEqual(['Builder', 'Socrates']);
    expect(Object.keys(data).sort()).toEqual(['agents', 'fingerprints', 'idleRuns', 'lastRunAt', 'pause', 'sent', 'version', 'watermarks']);
  });

  it('moves watermarks forward only, and never reads one from the future', () => {
    // Arrange
    const data = advanceWatermarks(emptyProfiles(), { socrates: NOW - HOUR, builder: NOW + 10 * HOUR });

    // Act
    const back = advanceWatermarks(data, { socrates: NOW - 5 * HOUR });

    // Assert
    expect(watermarkMs(back, 'socrates', NOW)).toBe(NOW - HOUR);
    expect(watermarkMs(back, 'builder', NOW)).toBe(NOW);
    expect(watermarkMs(back, 'nobody', NOW)).toBeNull();
  });
});

describe('forgetProfile', () => {
  it('stops using the approved profile, keeps a pending one, and drops an agent left with nothing', () => {
    // Arrange
    const approved = approveProfile(
      setPendingProfiles(emptyProfiles(), [{ agentId: 'socrates', text: 'v1' }], { socrates: 'Socrates' }, NOW),
      'socrates',
      NOW,
    )!;
    const withPending = setPendingProfiles(approved, [{ agentId: 'socrates', text: 'v2' }], { socrates: 'Socrates' }, NOW);

    // Act
    const forgotten = forgetProfile(approved, 'socrates');
    const keptPending = forgetProfile(withPending, 'socrates');

    // Assert
    expect(forgotten?.agents).toEqual({});
    expect(keptPending?.agents.socrates).toEqual({ agentName: 'Socrates', approved: null, pending: { text: 'v2', at: iso(NOW) } });
    expect(forgetProfile(emptyProfiles(), 'socrates')).toBeNull();
    expect(forgetProfile(forgotten!, 'socrates')).toBeNull();
  });
});

describe('loop record (background runs only)', () => {
  it('[2] remembers every input sent and the newest activity sent per agent, before any answer', () => {
    // Act
    const data = recordSend(emptyProfiles(), FP_A, { socrates: NOW - HOUR }, 'owner');

    // Assert
    expect(data.fingerprints).toEqual([FP_A]);
    expect(data.sent).toEqual({ socrates: iso(NOW - HOUR) });
    expect(data.watermarks).toEqual({});
    expect(backgroundLoopReason(data, FP_A, { socrates: NOW })).toBe('repeat_input');
    expect(backgroundLoopReason(data, FP_B, { socrates: NOW })).toBeNull();
  });

  it(`[5] counts background runs that send no new activity and pauses run number ${AGENT_PROFILES_LOOP_IDLE_RUNS}`, () => {
    // Arrange: the activity was already sent once, and its call was never answered.
    const sent = recordSend(emptyProfiles(), FP_A, { socrates: NOW }, 'background');
    const sameActivity = { socrates: NOW };

    // Act
    const once = recordSend(sent, FP_B, sameActivity, 'background');
    const twice = recordSend(once, FP_C, sameActivity, 'background');

    // Assert
    expect(AGENT_PROFILES_LOOP_IDLE_RUNS).toBe(3);
    expect(sent.idleRuns).toBe(0);
    expect(backgroundLoopReason(sent, FP_B, sameActivity)).toBeNull();
    expect(once.idleRuns).toBe(1);
    expect(backgroundLoopReason(once, FP_C, sameActivity)).toBeNull();
    expect(twice.idleRuns).toBe(2);
    expect(backgroundLoopReason(twice, 'd'.repeat(64), sameActivity)).toBe('idle_runs');
    expect(backgroundLoopReason(twice, 'd'.repeat(64), { socrates: NOW + 1 })).toBeNull();
    expect(backgroundLoopReason(twice, 'd'.repeat(64), { builder: NOW - HOUR })).toBeNull();
  });

  it('[5] never counts an owner run as idle, and a run with new activity starts the count again', () => {
    // Arrange
    const idle = recordSend(recordSend(emptyProfiles(), FP_A, { socrates: NOW }, 'background'), FP_B, { socrates: NOW }, 'background');

    // Act
    const owner = recordSend(idle, FP_C, { socrates: NOW }, 'owner');
    const fresh = recordSend(idle, FP_C, { socrates: NOW + HOUR }, 'background');

    // Assert
    expect(idle.idleRuns).toBe(1);
    expect(owner.idleRuns).toBe(1);
    expect(fresh.idleRuns).toBe(0);
    expect(fresh.sent).toEqual({ socrates: iso(NOW + HOUR) });
  });

  it('keeps a bounded list of recent inputs, newest last, without duplicates', () => {
    // Arrange
    let data = emptyProfiles();

    // Act
    for (let index = 0; index < 30; index += 1) data = recordSend(data, index.toString(16).padStart(64, '0'), {}, 'owner');
    data = recordSend(data, (29).toString(16).padStart(64, '0'), {}, 'owner');

    // Assert
    expect(data.fingerprints).toHaveLength(20);
    expect(new Set(data.fingerprints).size).toBe(20);
    expect(data.fingerprints.at(-1)).toBe((29).toString(16).padStart(64, '0'));
  });

  it('[5] "Tiếp tục" clears the pause, the idle count and the remembered inputs', () => {
    // Arrange
    const paused = pauseBackground(
      recordSend(recordSend(emptyProfiles(), FP_A, { socrates: NOW }, 'background'), FP_B, { socrates: NOW }, 'background'),
      'idle_runs',
      NOW,
    );

    // Act
    const resumed = resumeBackground(paused);

    // Assert
    expect(toProfilesState(paused).backgroundPause).toEqual({ reason: 'idle_runs', at: iso(NOW) });
    expect(resumed).toMatchObject({ pause: null, idleRuns: 0, fingerprints: [] });
    expect(resumed.sent).toEqual(paused.sent);
    expect(backgroundLoopReason(resumed, FP_A, { socrates: NOW })).toBeNull();
  });
});
