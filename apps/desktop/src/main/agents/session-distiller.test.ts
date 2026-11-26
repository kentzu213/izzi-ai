import { describe, it, expect, vi } from 'vitest';
import {
  AgentRecallContextProvider,
  DistilledSessionCapturer,
  type MemoryLoopTransport,
} from './session-distiller';

function makeTransport(overrides: Partial<MemoryLoopTransport> = {}): MemoryLoopTransport {
  return {
    captureMemorySession:
      overrides.captureMemorySession ??
      vi.fn().mockResolvedValue({ status: 'written', nodeId: 'session--abc' }),
    recallMemory:
      overrides.recallMemory ??
      vi.fn().mockResolvedValue({
        status: 'ok',
        sessions: [
          {
            id: 'session--1',
            summary: 'Tối ưu MyGraph sync',
            outcome: 'success',
            specsTouched: ['vault'],
            filesTouched: [],
            decisions: ['Dùng manifest SHA-256'],
            followUps: [],
            createdAt: '2026-11-26T09:00:00Z',
            validFrom: '2026-11-26T09:00:00Z',
            validTo: null,
          },
        ],
        insights: [
          {
            id: 'insight--1',
            summary: 'Không đẩy raw chat lên user_nodes.',
            themes: ['mygraph'],
            sourceSessionIds: ['session--1'],
            createdAt: '2026-11-26T08:00:00Z',
            validFrom: '2026-11-26T08:00:00Z',
            validTo: null,
          },
        ],
        procedures: [
          {
            id: 'procedure--1',
            intent: 'Kiểm thử release desktop',
            steps: ['Run vitest', 'Run tsc'],
            tools: ['vitest'],
            featureSpec: 'vault',
            createdAt: '2026-11-26T10:00:00Z',
            validFrom: '2026-11-26T10:00:00Z',
            validTo: null,
          },
        ],
      }),
  };
}

describe('DistilledSessionCapturer', () => {
  it('skips trivial turns without making any network call', async () => {
    const transport = makeTransport();
    const fallback = { capture: vi.fn() };
    const capturer = new DistilledSessionCapturer(transport, fallback);

    const res = await capturer.capture({
      agentId: 'socrates',
      agentName: 'Socrates',
      request: 'ok',
      reply: 'Dạ vâng',
      startedAt: '2026-11-26T10:00:00Z',
      finishedAt: '2026-11-26T10:00:01Z',
    });

    expect(res.via).toBe('skipped');
    expect(transport.captureMemorySession).not.toHaveBeenCalled();
    expect(fallback.capture).not.toHaveBeenCalled();
  });

  it('sends distilled redacted payload to /api/aibase/memory/session and invokes candidate hooks', async () => {
    const transport = makeTransport();
    const fallback = { capture: vi.fn() };
    const hook = { onWorkBlockDistilled: vi.fn() };
    const capturer = new DistilledSessionCapturer(transport, fallback);
    capturer.addCandidateHook(hook);

    const res = await capturer.capture({
      agentId: 'orchestrator',
      agentName: 'Orchestrator',
      request: 'Hoàn thiện slice 1 trên apps/desktop/src/main/graph/graph-client.ts dùng izzi-0123456789abcdef0123456789abcdef',
      reply: 'Quyết định: nối trực tiếp POST /api/aibase/memory/session và bật bộ lọc PII.',
      startedAt: '2026-11-26T10:00:00Z',
      finishedAt: '2026-11-26T10:01:00Z',
    });

    expect(res.ok).toBe(true);
    expect(res.via).toBe('memory-loop');
    expect(res.nodeId).toBe('session--abc');
    expect(fallback.capture).not.toHaveBeenCalled();
    expect(hook.onWorkBlockDistilled).toHaveBeenCalledTimes(1);

    const sentPayload = (transport.captureMemorySession as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(JSON.stringify(sentPayload)).not.toContain('izzi-0123456789abcdef');
    expect(sentPayload.decisions.length).toBeGreaterThanOrEqual(1);
    expect(sentPayload.specsTouched.length).toBeGreaterThanOrEqual(1);
  });

  it('falls back to legacy graph capturer ONLY when backend memory loop is disabled', async () => {
    const transport = makeTransport({
      captureMemorySession: vi.fn().mockResolvedValue({ status: 'disabled' }),
    });
    const fallback = { capture: vi.fn().mockResolvedValue({ ok: true, nodeId: 'node-1' }) };
    const capturer = new DistilledSessionCapturer(transport, fallback);

    const res = await capturer.capture({
      agentId: 'hermes',
      agentName: 'Hermes',
      request: 'Tạo chiến dịch marketing mới cho tuần sau và rà lại ngân sách',
      reply: 'Quyết định: chia 3 nhóm nội dung và chạy thử A/B trước khi tăng ngân sách.',
      startedAt: '2026-11-26T10:00:00Z',
      finishedAt: '2026-11-26T10:01:00Z',
    });

    expect(res.ok).toBe(true);
    expect(res.via).toBe('graph-fallback');
    expect(fallback.capture).toHaveBeenCalledTimes(1);
  });

  it('does NOT fall back on unauthorized (fail-closed)', async () => {
    const transport = makeTransport({
      captureMemorySession: vi.fn().mockResolvedValue({ status: 'unauthorized', error: 'unauthorized' }),
    });
    const fallback = { capture: vi.fn() };
    const capturer = new DistilledSessionCapturer(transport, fallback);

    const res = await capturer.capture({
      agentId: 'hermes',
      agentName: 'Hermes',
      request: 'Kiểm tra đồng bộ MyGraph khi chưa đăng nhập',
      reply: 'Kết luận: cần đăng nhập trước khi đồng bộ lên cloud.',
      startedAt: '2026-11-26T10:00:00Z',
      finishedAt: '2026-11-26T10:01:00Z',
    });

    expect(res.ok).toBe(false);
    expect(fallback.capture).not.toHaveBeenCalled();
  });
});

describe('AgentRecallContextProvider', () => {
  it('fetches unified L4-L5 recall once per scope within TTL and respects disable toggle', async () => {
    let enabled = true;
    const transport = makeTransport();
    const provider = new AgentRecallContextProvider(transport, () => enabled, 60_000);

    const b1 = await provider.getBriefing({ scopeKey: 's1', queryText: 'mygraph' });
    const b2 = await provider.getBriefing({ scopeKey: 's1', queryText: 'mygraph' });

    expect(b1).toContain('Bài học đúc kết (L4)');
    expect(b1).toContain('Quy trình đã học (L5)');
    expect(b2).toBe(b1);
    expect(transport.recallMemory).toHaveBeenCalledTimes(1);

    enabled = false;
    expect(await provider.getBriefing({ scopeKey: 's2' })).toBe('');
  });
});
