import { describe, expect, it, vi } from 'vitest';
import {
  AGENT_PROFILE_GRAPH_NODE_CAP,
  AGENT_PROFILE_S3_IDLE_SECONDS,
  AGENT_PROFILE_S3_MIN_INTERVAL_MS,
  AgentProfileS3Coordinator,
  agentProfileNodeUrl,
} from './agent-profile-s3';
import type { AgentProfilesResult } from '../../../shared/agent-profile-types';
import type { GraphNode } from '../../../shared/graph-types';

function makeStore() {
  const map = new Map<string, string>();
  return {
    getSetting: (k: string) => map.get(k) ?? null,
    setSetting: (k: string, v: string) => { map.set(k, v); },
  };
}

function makeProfileState(approvedText: string | null): AgentProfilesResult {
  return {
    ok: true,
    state: {
      profiles: [
        {
          agentId: 'director',
          agentName: 'Giám đốc Marketing',
          approved: approvedText ? { text: approvedText, at: '2026-11-26T00:00:00Z' } : null,
          pending: null,
        },
      ],
      runsToday: 0,
      maxRunsPerDay: 3,
      callsToday: 0,
      maxCallsPerDay: 6,
      lastRunAt: null,
    },
  };
}

describe('AgentProfileS3Coordinator (docs/MYGRAPH-AGENT-MEMORY.md S3)', () => {
  it('runs auto-distill ONLY when >= 20h elapsed and idle >= 5m, and mirrors approved profiles with fingerprint deduplication', async () => {
    let clock = Date.parse('2026-11-26T10:00:00Z');
    let idleSec = 60; // Too active (< 5m)
    let profileText = 'Sở thích: Báo cáo ngắn gọn.\nQuyết định: Ưu tiên video thực tế tại xưởng.';

    const store = makeStore();
    const refresh = vi.fn(async () => makeProfileState(profileText));
    const createNode = vi.fn(async (input: { title: string; url: string }) => ({
      id: 'node-profile-1',
      title: input.title,
      url: input.url,
      nodeType: 'wiki',
      color: '#7c4dff',
      createdAt: '2026-11-26T10:00:00Z',
      updatedAt: '2026-11-26T10:00:00Z',
    }));
    const updateNode = vi.fn(async () => ({ ok: true as const }));
    const readNodes = vi.fn(async () => ({ data: [] as GraphNode[], error: null, status: 200 }));

    const coord = new AgentProfileS3Coordinator({
      profileService: { getState: () => makeProfileState(profileText), refresh },
      graph: { readNodes, createNode, updateNode },
      readCachedNodes: () => [],
      currentOwnerId: () => 'user-1',
      getSystemIdleSeconds: () => idleSec,
      store,
      now: () => clock,
    });

    // 1. Not idle enough -> skips refresh, still mirrors approved profile once!
    const r1 = await coord.tick();
    expect(r1.distilled).toBe(false);
    expect(r1.mirrored).toBe(1);
    expect(refresh).not.toHaveBeenCalled();
    expect(createNode).toHaveBeenCalledTimes(1);

    // 2. Idle >= 5m -> runs refresh once, does NOT rewrite unchanged profile node (0 ETag churn!).
    idleSec = AGENT_PROFILE_S3_IDLE_SECONDS + 10;
    const r2 = await coord.tick();
    expect(r2.distilled).toBe(true);
    expect(r2.mirrored).toBe(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(createNode).toHaveBeenCalledTimes(1);

    // 3. Running again 1 hour later -> respects 20h interval (no second call).
    clock += 60 * 60 * 1000;
    const r3 = await coord.tick();
    expect(r3.distilled).toBe(false);
    expect(refresh).toHaveBeenCalledTimes(1);

    // 4. After 21h and profile changed -> runs refresh and PATCHes existing node by stable URL!
    clock += AGENT_PROFILE_S3_MIN_INTERVAL_MS + 60 * 60 * 1000;
    profileText = 'Sở thích: Báo cáo cực gọn.\nQuyết định: Tập trung chốt đơn qua Zalo.';
    const stableUrl = agentProfileNodeUrl('user-1', 'director');
    readNodes.mockResolvedValueOnce({
      data: [{ id: 'node-profile-1', title: 'Hồ sơ agent · Giám đốc Marketing', url: stableUrl, nodeType: 'wiki', color: '#7c4dff', createdAt: '', updatedAt: '' }],
      error: null,
      status: 200,
    });
    const r4 = await coord.tick();
    expect(r4.distilled).toBe(true);
    expect(r4.mirrored).toBe(1);
    expect(updateNode).toHaveBeenCalledWith('node-profile-1', expect.objectContaining({ title: 'Hồ sơ agent · Giám đốc Marketing' }), { queueOnOffline: false });
  });

  it('refuses to mirror profiles when node list hits 1000-row cap (prevents duplicates)', async () => {
    const store = makeStore();
    const createNode = vi.fn();
    const cappedNodes: GraphNode[] = Array.from({ length: AGENT_PROFILE_GRAPH_NODE_CAP }, (_, i) => ({
      id: `n-${i}`,
      title: `Node ${i}`,
      nodeType: 'note',
      color: '#5ca7ff',
      createdAt: '',
      updatedAt: '',
    }));

    const coord = new AgentProfileS3Coordinator({
      profileService: {
        getState: () => makeProfileState('Quyết định sạch không chứa PII.'),
        refresh: vi.fn(async () => makeProfileState('Quyết định sạch không chứa PII.')),
      },
      graph: {
        readNodes: vi.fn(async () => ({ data: cappedNodes, error: null, status: 200 })),
        createNode,
        updateNode: vi.fn(),
      },
      readCachedNodes: () => [],
      currentOwnerId: () => 'user-1',
      getSystemIdleSeconds: () => 0,
      store,
    });

    const mirrored = await coord.mirrorApprovedProfilesToGraph('user-1');
    expect(mirrored).toBe(0);
    expect(createNode).not.toHaveBeenCalled();
  });
});
