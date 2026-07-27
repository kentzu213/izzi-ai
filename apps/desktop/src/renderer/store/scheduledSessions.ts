import { create } from 'zustand';

/**
 * Scheduled Sessions store — renderer state for the recurring-session surface, wired to main
 * through the `electronAPI.schedule` bridge.
 *
 * Mirrors the conventions of `knowledgeGraph.ts`: one zustand store with state + async actions,
 * feature-detecting the bridge and no-op'ing when it is absent (so the page renders in a browser
 * dev context too). Main is the source of truth: after every accepted write the store re-reads.
 *
 * @module renderer/store/scheduledSessions
 * @see .kiro/specs/scheduled-sessions/requirements.md
 */

export type Weekday = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';

export type Recurrence = { kind: 'daily' } | { kind: 'weekly'; days: Weekday[] };

export interface MachinePolicy {
  runOnBattery: boolean;
  wakeToRun: boolean;
  catchUpMissed: boolean;
}

export interface PlaybookStepInfo {
  id: string;
  label: string;
  requiresProfiles?: string[];
}

export interface PlaybookInfo {
  id: string;
  name: string;
  summary: string;
  gates?: string[];
  steps: PlaybookStepInfo[];
}

export interface RunStepResult {
  stepId: string;
  label: string;
  exitCode: number | null;
  startedAt: string;
  endedAt: string;
  output: string;
}

export interface SessionDiagnosis {
  kind: 'logged_out' | 'two_factor_required' | 'billing_blocked' | 'authorization_refused' | 'unknown';
  profileDir?: string;
  action: string;
}

export interface SessionRun {
  id: string;
  sessionId: string;
  status: 'running' | 'success' | 'failed' | 'refused';
  startedAt: string;
  endedAt: string | null;
  failedStepId: string | null;
  steps: RunStepResult[];
  diagnosis?: SessionDiagnosis | null;
}

export interface ScheduleSummary {
  id: string;
  name: string;
  playbookId: string;
  playbookName: string;
  workingDir: string;
  timeOfDay: string;
  recurrence: Recurrence;
  recurrenceLabel: string;
  machinePolicy: MachinePolicy;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastRun: SessionRun | null;
  attention: SessionDiagnosis | null;
}

export interface ProfileHealth {
  profileDir: string;
  exists: boolean;
  mayHaveExpired: boolean;
  lastActivityAt: string | null;
}

export interface CreateScheduleInput {
  name: string;
  playbookId: string;
  workingDir: string;
  timeOfDay: string;
  recurrence: Recurrence;
  machinePolicy?: Partial<MachinePolicy>;
}

type Status = 'idle' | 'loading' | 'ready';

interface ScheduledSessionsState {
  status: Status;
  sessions: ScheduleSummary[];
  playbooks: PlaybookInfo[];
  profiles: ProfileHealth[];
  runs: Record<string, SessionRun[]>;
  error: string | null;
  busyId: string | null;

  refresh: () => Promise<void>;
  create: (input: CreateScheduleInput) => Promise<boolean>;
  setEnabled: (id: string, enabled: boolean) => Promise<boolean>;
  remove: (id: string) => Promise<boolean>;
  runNow: (id: string) => Promise<boolean>;
  loadRuns: (id: string) => Promise<void>;
  openProfile: (profileDir: string) => Promise<boolean>;
}

interface ScheduleBridge {
  playbooks: () => Promise<unknown[]>;
  list: () => Promise<unknown[]>;
  create: (input: unknown) => Promise<{ ok: boolean; error?: string }>;
  setEnabled: (id: string, enabled: boolean) => Promise<{ ok: boolean; error?: string }>;
  remove: (id: string) => Promise<{ ok: boolean; error?: string }>;
  runNow: (id: string) => Promise<{ ok: boolean; error?: string }>;
  runs: (id: string, limit?: number) => Promise<unknown[]>;
  profileHealth: () => Promise<unknown[]>;
  openProfile: (profileDir: string, url?: string) => Promise<{ ok: boolean; error?: string }>;
}

function bridge(): ScheduleBridge | null {
  const api = (window as unknown as { electronAPI?: { schedule?: ScheduleBridge } }).electronAPI;
  return api?.schedule ?? null;
}

export const useScheduledSessionsStore = create<ScheduledSessionsState>((set, get) => ({
  status: 'idle',
  sessions: [],
  playbooks: [],
  profiles: [],
  runs: {},
  error: null,
  busyId: null,

  refresh: async () => {
    const api = bridge();
    if (!api) {
      set({ status: 'ready', sessions: [], playbooks: [], profiles: [] });
      return;
    }
    set({ status: 'loading', error: null });
    try {
      const [sessions, playbooks, profiles] = await Promise.all([
        api.list(),
        api.playbooks(),
        api.profileHealth(),
      ]);
      set({
        status: 'ready',
        sessions: sessions as ScheduleSummary[],
        playbooks: playbooks as PlaybookInfo[],
        profiles: profiles as ProfileHealth[],
      });
    } catch (error) {
      set({ status: 'ready', error: describe(error) });
    }
  },

  create: async (input) => {
    const api = bridge();
    if (!api) return false;
    set({ error: null });
    try {
      const result = await api.create(input);
      if (!result.ok) {
        set({ error: result.error ?? 'Không tạo được phiên' });
        return false;
      }
      await get().refresh();
      return true;
    } catch (error) {
      set({ error: describe(error) });
      return false;
    }
  },

  setEnabled: async (id, enabled) => {
    const api = bridge();
    if (!api) return false;
    set({ busyId: id, error: null });
    try {
      const result = await api.setEnabled(id, enabled);
      if (!result.ok) set({ error: result.error ?? 'Không đổi được trạng thái' });
      await get().refresh();
      return result.ok;
    } catch (error) {
      set({ error: describe(error) });
      return false;
    } finally {
      set({ busyId: null });
    }
  },

  remove: async (id) => {
    const api = bridge();
    if (!api) return false;
    set({ busyId: id, error: null });
    try {
      const result = await api.remove(id);
      if (!result.ok) set({ error: result.error ?? 'Không xoá được phiên' });
      await get().refresh();
      return result.ok;
    } catch (error) {
      set({ error: describe(error) });
      return false;
    } finally {
      set({ busyId: null });
    }
  },

  runNow: async (id) => {
    const api = bridge();
    if (!api) return false;
    set({ busyId: id, error: null });
    try {
      const result = await api.runNow(id);
      if (!result.ok && result.error) set({ error: result.error });
      await get().refresh();
      await get().loadRuns(id);
      return result.ok;
    } catch (error) {
      set({ error: describe(error) });
      return false;
    } finally {
      set({ busyId: null });
    }
  },

  loadRuns: async (id) => {
    const api = bridge();
    if (!api) return;
    try {
      const rows = await api.runs(id, 10);
      set({ runs: { ...get().runs, [id]: rows as SessionRun[] } });
    } catch (error) {
      set({ error: describe(error) });
    }
  },

  openProfile: async (profileDir) => {
    const api = bridge();
    if (!api) return false;
    try {
      const result = await api.openProfile(profileDir);
      if (!result.ok) set({ error: result.error ?? 'Không mở được profile' });
      return result.ok;
    } catch (error) {
      set({ error: describe(error) });
      return false;
    }
  },
}));

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
