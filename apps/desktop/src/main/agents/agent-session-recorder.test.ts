import { describe, it, expect, vi } from 'vitest';
import { buildSessionTask, SessionRecorder } from './agent-session-recorder';
import type { AgentSessionCapturer } from './agent-session-graph';

const base = {
  agentId: 'hermes',
  agentName: 'Hermes',
  request: 'Đăng bài\ndòng 2',
  reply: 'Đã xong',
  startedAt: '2026-01-01T00:00:00Z',
  finishedAt: '2026-01-01T00:01:00Z',
  turnId: 'gw-assistant-42',
};

describe('buildSessionTask', () => {
  it('marks the task done with a stable id from turnId, unbound from chat_sessions (FK safety)', () => {
    const t = buildSessionTask(base);
    expect(t.id).toBe('agent-session--gw-assistant-42');
    expect(t.status).toBe('done');
    expect(t.title).toContain('Hermes');
    expect(t.title).toContain('Đăng bài');
    expect(t.summary).toContain('Đã xong');
    expect(t.sourceMessageId).toBe('gw-assistant-42');
    expect(t.sessionId).toBeUndefined();
    expect(t.createdAt).toBe(base.startedAt);
    expect(t.updatedAt).toBe(base.finishedAt);
  });

  it('falls back to an agent+time id when turnId is missing', () => {
    const t = buildSessionTask({ ...base, turnId: undefined });
    expect(t.id).toBe('agent-session--hermes-2026-01-01T00:01:00Z');
    expect(t.sourceMessageId).toBeUndefined();
  });

  it('clips a long title and summary', () => {
    const t = buildSessionTask({ ...base, request: 'x'.repeat(200), reply: 'y'.repeat(500) });
    expect(t.title.length).toBeLessThanOrEqual(81);
    expect((t.summary ?? '').length).toBeLessThanOrEqual(241);
  });
});

/**
 * S1 of the MyGraph agent-memory plan: a finished chat turn no longer goes into MyGraph as a raw
 * transcript (no PII filter, one ETag change and a full node-list re-download per turn). The Replay
 * task stays. The old graph write can be switched back on with a local setting.
 */
describe('SessionRecorder.record', () => {
  function fixture(captureToGraph?: () => boolean) {
    const capture = vi.fn(async () => ({ ok: true }));
    const upsertAgentTask = vi.fn((task) => task);
    const recorder = new SessionRecorder(
      { capture } as unknown as AgentSessionCapturer,
      { upsertAgentTask },
      captureToGraph ? { captureToGraph } : undefined,
    );
    return { recorder, capture, upsertAgentTask };
  }

  it('keeps the Replay task but writes nothing to MyGraph by default', () => {
    // Arrange
    const { recorder, capture, upsertAgentTask } = fixture();

    // Act
    recorder.record(base);

    // Assert
    expect(capture).not.toHaveBeenCalled();
    expect(upsertAgentTask).toHaveBeenCalledWith(buildSessionTask(base));
  });

  it('writes the turn to MyGraph only while the graph capture setting is on', () => {
    // Arrange
    let on = true;
    const { recorder, capture, upsertAgentTask } = fixture(() => on);

    // Act
    recorder.record(base);
    on = false;
    recorder.record({ ...base, turnId: 'gw-assistant-43' });

    // Assert
    expect(capture).toHaveBeenCalledTimes(1);
    expect(capture).toHaveBeenCalledWith(base);
    expect(upsertAgentTask).toHaveBeenCalledTimes(2);
  });

  it('treats an unreadable setting as off and still records the Replay task', () => {
    // Arrange
    const { recorder, capture, upsertAgentTask } = fixture(() => { throw new Error('db closed'); });

    // Act
    recorder.record(base);

    // Assert
    expect(capture).not.toHaveBeenCalled();
    expect(upsertAgentTask).toHaveBeenCalledTimes(1);
  });

  it('never lets a failed graph or task write break the chat turn', () => {
    // Arrange
    const capture = vi.fn(async () => { throw new Error('offline'); });
    const recorder = new SessionRecorder(
      { capture } as unknown as AgentSessionCapturer,
      { upsertAgentTask: () => { throw new Error('db locked'); } },
      { captureToGraph: () => true },
    );

    // Act + Assert
    expect(() => recorder.record(base)).not.toThrow();
  });
});
