import { describe, expect, it } from 'vitest';
import type { AgentChatSession, AgentStep, GatewayChatMessage } from '../../types/agent-registry';
import {
  activityFeed,
  agentTurns,
  needsAttention,
  projectSessions,
  recentContext,
  runningNow,
} from './projectWorkspaceData';

function msg(
  id: string,
  sessionId: string,
  role: GatewayChatMessage['role'],
  createdAt: string,
  extra: Partial<GatewayChatMessage> = {},
): GatewayChatMessage {
  return { id, sessionId, agentId: 'izzi', role, content: `${id} text`, state: 'done', createdAt, ...extra };
}

function session(id: string, messages: GatewayChatMessage[]): AgentChatSession {
  return {
    id,
    agentId: 'izzi',
    agentName: `Agent ${id}`,
    agentIcon: '',
    messages,
    model: 'izzi-smart',
    provider: 'izzi',
    createdAt: '2026-09-01T00:00:00.000Z',
    isActive: true,
  } as AgentChatSession;
}

const step = (id: string, status: AgentStep['status'], label = `step ${id}`): AgentStep => ({
  id,
  kind: 'tool',
  label,
  status,
});

const A1 = session('a1', [
  msg('a1-u1', 'a1', 'user', '2026-09-02T10:00:00.000Z'),
  msg('a1-t1', 'a1', 'assistant', '2026-09-02T10:00:01.000Z', { steps: [step('x', 'done')] }),
  msg('a1-u2', 'a1', 'user', '2026-09-02T11:00:00.000Z'),
  msg('a1-t2', 'a1', 'assistant', '2026-09-02T11:00:01.000Z', { state: 'streaming', steps: [step('y', 'running')] }),
]);
const A2 = session('a2', [
  msg('a2-u1', 'a2', 'user', '2026-09-03T09:00:00.000Z'),
  msg('a2-t1', 'a2', 'assistant', '2026-09-03T09:00:01.000Z', { state: 'error' }),
]);
const B1 = session('b1', [
  msg('b1-u1', 'b1', 'user', '2026-09-04T00:00:00.000Z'),
  msg('b1-t1', 'b1', 'assistant', '2026-09-04T00:00:01.000Z', { state: 'error', steps: [step('z', 'error')] }),
]);
const ALL = [A1, A2, B1];
const projectA = { sessionIds: ['a1', 'a2', 'gone'] };
const projectB = { sessionIds: ['b1'] };

describe('project workspace data (M3-B1)', () => {
  it('keeps only sessions explicitly assigned to the project, in assignment order', () => {
    expect(projectSessions(ALL, projectA).map((s) => s.id)).toEqual(['a1', 'a2']);
    expect(projectSessions(ALL, projectB).map((s) => s.id)).toEqual(['b1']);
    expect(projectSessions(ALL, { sessionIds: [] })).toEqual([]);
  });

  it('never leaks another project’s turns, attention or activity (A/B isolation)', () => {
    const a = projectSessions(ALL, projectA);
    const b = projectSessions(ALL, projectB);

    expect(agentTurns(a).every((turn) => turn.sessionId !== 'b1')).toBe(true);
    expect(needsAttention(a).map((item) => item.sessionId)).toEqual(['a2']);
    expect(needsAttention(b).map((item) => item.sessionId)).toEqual(['b1']);
    expect(activityFeed(a, 50).some((item) => item.sessionId === 'b1')).toBe(false);
    expect(recentContext(b, 50).map((m) => m.sessionId)).toEqual(['b1', 'b1']);
  });

  it('builds one agent turn per assistant message with its opening prompt, newest first', () => {
    const turns = agentTurns([A1]);

    expect(turns.map((turn) => [turn.id, turn.prompt, turn.state])).toEqual([
      ['a1-t2', 'a1-u2 text', 'streaming'],
      ['a1-t1', 'a1-u1 text', 'done'],
    ]);
    expect(turns[0].steps.map((s) => s.id)).toEqual(['y']);
    expect(turns[0].agentName).toBe('Agent a1');
  });

  it('flags failed turns and failed steps as needing attention', () => {
    expect(needsAttention([A2])[0].label).toBe('Lượt agent gặp lỗi');
    expect(needsAttention([session('s', [msg('t', 's', 'assistant', 'x', { steps: [step('q', 'error', 'Gọi API')] })])])[0].label).toBe(
      'Bước lỗi: Gọi API',
    );
    expect(needsAttention([A1])).toEqual([]);
  });

  it('lists turns still pending, streaming or with a running step', () => {
    expect(runningNow(ALL).map((turn) => turn.id)).toEqual(['a1-t2']);
  });

  it('orders recent context newest first and respects the limit', () => {
    expect(recentContext([A1, A2], 3).map((m) => m.id)).toEqual(['a2-t1', 'a2-u1', 'a1-t2']);
  });

  it('puts real messages and steps on the activity feed, a step right after its message', () => {
    const feed = activityFeed([A1], 50);

    expect(feed.map((item) => item.id)).toEqual(['a1-t2:y', 'a1-t2', 'a1-u2', 'a1-t1:x', 'a1-t1', 'a1-u1']);
    expect(feed[0]).toMatchObject({ kind: 'step', label: 'Công cụ · running', detail: 'step y' });
    expect(feed[1]).toMatchObject({ kind: 'message', label: 'Agent · Agent a1' });
    expect(feed[2].label).toBe('Bạn · Agent a1');
    expect(activityFeed([A1], 2)).toHaveLength(2);
  });
});
