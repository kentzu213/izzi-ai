import { describe, expect, it } from 'vitest';
import {
  AGENT_PROFILES_MAX_RUNS_PER_DAY,
  AgentProfileStore,
  advanceWatermarks,
  approveProfile,
  callsToday,
  countCall,
  discardProfile,
  emptyProfiles,
  forgetProfile,
  recordRun,
  setPendingProfiles,
  toProfilesState,
  vnDayKey,
  watermarkMs,
} from './agent-profile-store';

const NOW = Date.parse('2026-11-19T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const iso = (ms: number): string => new Date(ms).toISOString();

function memoryStore() {
  const values = new Map<string, string>();
  return { values, getSetting: (key: string) => values.get(key) ?? null, setSetting: (key: string, value: string) => { values.set(key, value); } };
}

describe('vnDayKey', () => {
  it('counts days in Vietnam time', () => {
    expect(vnDayKey(Date.parse('2026-11-19T16:59:00.000Z'))).toBe('2026-11-19');
    expect(vnDayKey(Date.parse('2026-11-19T17:00:00.000Z'))).toBe('2026-11-20');
  });
});

describe('AgentProfileStore', () => {
  it('keeps each account apart under a hashed key and round-trips the data', () => {
    // Arrange
    const settings = memoryStore();
    const store = new AgentProfileStore(settings);
    const data = recordRun(
      setPendingProfiles(emptyProfiles(), [{ agentId: 'socrates', text: 'Sở thích: ngắn.' }], { socrates: 'Socrates' }, NOW),
      NOW,
      { socrates: NOW - HOUR },
    );

    // Act
    store.save('user-1', countCall(data, NOW));

    // Assert
    expect(store.load('user-1')).toEqual(countCall(data, NOW));
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

  it('counts runs and model calls per Vietnam day and reports the view sorted by agent name', () => {
    // Arrange
    let data = setPendingProfiles(
      emptyProfiles(),
      [{ agentId: 'socrates', text: 's' }, { agentId: 'builder', text: 'b' }],
      { socrates: 'Socrates', builder: 'Builder' },
      NOW,
    );

    // Act
    data = recordRun(recordRun(data, NOW, {}), NOW + 1000, {});
    data = countCall(countCall(countCall(data, NOW), NOW), NOW);
    const today = toProfilesState(data, NOW + 2000);
    const tomorrow = toProfilesState(data, NOW + 24 * HOUR);

    // Assert
    expect(today).toMatchObject({ runsToday: 2, maxRunsPerDay: AGENT_PROFILES_MAX_RUNS_PER_DAY, lastRunAt: iso(NOW + 1000) });
    expect(today.profiles.map((profile) => profile.agentName)).toEqual(['Builder', 'Socrates']);
    expect(tomorrow.runsToday).toBe(0);
    expect(callsToday(data, NOW)).toBe(3);
    expect(callsToday(data, NOW + 24 * HOUR)).toBe(0);
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
