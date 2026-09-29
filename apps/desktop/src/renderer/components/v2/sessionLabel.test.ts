import { describe, expect, it } from 'vitest';
import type { AgentChatSession } from '../../types/agent-registry';
import { SESSION_PREVIEW_MAX, formatRelativeTime, sessionLabel, sessionPreview } from './sessionLabel';

function session(contents: string[], agentName = 'Izzi'): AgentChatSession {
  return {
    id: 's1',
    agentId: 'izzi',
    agentName,
    agentIcon: '🤖',
    model: 'izzi-smart',
    provider: 'izzi',
    createdAt: '2026-09-02T00:00:00.000Z',
    isActive: true,
    messages: contents.map((content, index) => ({
      id: `s1-m${index}`,
      role: 'user',
      content,
      createdAt: '2026-09-02T00:01:00.000Z',
    })) as AgentChatSession['messages'],
  };
}

describe('sessionPreview', () => {
  it('falls back when every message is blank', () => {
    expect(sessionPreview(session([]))).toBe('Phiên trống');
    expect(sessionPreview(session(['   ', '\n']))).toBe('Phiên trống');
  });

  it('uses the last non-empty message with whitespace collapsed', () => {
    expect(sessionPreview(session(['đầu', '  cuối\n\tcùng  ', ' ']))).toBe('cuối cùng');
  });

  it('truncates to the preview limit with an ellipsis', () => {
    const preview = sessionPreview(session(['a'.repeat(SESSION_PREVIEW_MAX + 10)]));

    expect(preview).toHaveLength(SESSION_PREVIEW_MAX);
    expect(preview.endsWith('…')).toBe(true);
    expect(sessionPreview(session(['b'.repeat(SESSION_PREVIEW_MAX)]))).toBe('b'.repeat(SESSION_PREVIEW_MAX));
  });
});

describe('sessionLabel', () => {
  it('prefixes the agent name and falls back to a generic agent', () => {
    expect(sessionLabel(session(['xin chào']))).toBe('Izzi · xin chào');
    expect(sessionLabel(session(['xin chào'], ''))).toBe('Agent · xin chào');
  });
});

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-09-28T12:00:00.000Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it('buckets elapsed time into short Vietnamese labels', () => {
    expect(formatRelativeTime(ago(30_000), now)).toBe('vừa xong');
    expect(formatRelativeTime(ago(5 * 60_000), now)).toBe('5 phút trước');
    expect(formatRelativeTime(ago(3 * 3_600_000), now)).toBe('3 giờ trước');
    expect(formatRelativeTime(ago(2 * 86_400_000), now)).toBe('2 ngày trước');
    expect(formatRelativeTime(ago(14 * 86_400_000), now)).toBe('2 tuần trước');
  });

  it('treats future times as just now and rejects invalid input', () => {
    expect(formatRelativeTime(ago(-60_000), now)).toBe('vừa xong');
    expect(formatRelativeTime('không phải ngày', now)).toBe('');
  });
});
