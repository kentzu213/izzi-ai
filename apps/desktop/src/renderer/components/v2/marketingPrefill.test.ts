import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentChatSession } from '../../types/agent-registry';
import { useProjectWorkspaceStore } from '../../store/projectWorkspace';
import { cancelPendingHandoff, createComposerHandoff, type HandoffGateway } from './composerHandoff';
import { applyV2Identity } from './identity';
import { cancelMarketingPrefill, consumeMarketingPrefill, offerMarketingPrefill } from './marketingPrefill';

const source = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

function session(id: string, agentId: string): AgentChatSession {
  return {
    id,
    agentId,
    agentName: agentId,
    agentIcon: '',
    messages: [],
    model: 'izzi-smart',
    provider: 'izzi',
    createdAt: '2026-09-01T00:00:00.000Z',
    isActive: true,
  } as unknown as AgentChatSession;
}

function readyGateway() {
  const state: HandoffGateway = {
    sessions: [session('s1', 'izzi')],
    activeSessionId: 's1',
    isSending: false,
    composerDraft: '',
    agents: [{ id: 'izzi' }] as HandoffGateway['agents'],
    hydrateFromDisk: vi.fn(async () => undefined),
    switchSession: vi.fn((id: string) => {
      state.activeSessionId = id;
    }),
    newGatewaySession: vi.fn(),
    setComposerDraft: vi.fn((value: string) => {
      state.composerDraft = value;
    }),
    applySessionModel: vi.fn(async (sessionId, model, provider) => {
      state.sessions = state.sessions.map((item) =>
        item.id === sessionId ? { ...item, model, provider } : item,
      );
      return { ok: true };
    }),
  };
  return state;
}

afterEach(() => {
  cancelMarketingPrefill();
  cancelPendingHandoff();
  useProjectWorkspaceStore.getState().setIdentity(null);
});

describe('marketingPrefill', () => {
  it('hands the text over exactly once', () => {
    offerMarketingPrefill('Chiến dịch tháng 10', vi.fn());

    expect(consumeMarketingPrefill()).toBe('Chiến dịch tháng 10');
    expect(consumeMarketingPrefill()).toBeNull();
  });

  it('keeps the Home draft until the Director textarea consumes the text', () => {
    const clearDraft = vi.fn();

    offerMarketingPrefill('giữ nháp', clearDraft);
    expect(clearDraft).not.toHaveBeenCalled();

    consumeMarketingPrefill();
    consumeMarketingPrefill();
    expect(clearDraft).toHaveBeenCalledTimes(1);
  });

  it('refuses empty text and drops an earlier offer', () => {
    const earlier = vi.fn();
    offerMarketingPrefill('cũ', earlier);

    expect(offerMarketingPrefill('   ', vi.fn())).toBe(false);
    expect(consumeMarketingPrefill()).toBeNull();
    expect(earlier).not.toHaveBeenCalled();
  });

  it('never runs a replaced offer callback', () => {
    const stale = vi.fn();
    const fresh = vi.fn();

    offerMarketingPrefill('cũ', stale);
    offerMarketingPrefill('mới', fresh);

    expect(consumeMarketingPrefill()).toBe('mới');
    expect(stale).not.toHaveBeenCalled();
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['an account switch', 'user-b'],
    ['logout', null],
  ])('cancels a pending offer on %s', (_label, nextUserId) => {
    const clearDraft = vi.fn();
    useProjectWorkspaceStore.getState().setIdentity('user-a');
    offerMarketingPrefill('thuộc user-a', clearDraft);

    applyV2Identity(nextUserId);

    expect(consumeMarketingPrefill()).toBeNull();
    expect(clearDraft).not.toHaveBeenCalled();
  });

  it('is a neutral prefill: the Director composer only sets the goal, never submits', () => {
    const cmr = source('../../pages/CustomerMarketingRoom.tsx');
    const start = cmr.indexOf('function DirectorComposer(');
    const mountRegion = cmr.slice(start, cmr.indexOf('const submit =', start));

    expect(start).toBeGreaterThan(-1);
    expect(mountRegion).toContain('consumeMarketingPrefill()');
    expect(mountRegion).toContain('setGoal(prefill)');
    expect(mountRegion).not.toContain('onSubmit(');
    expect(mountRegion).not.toContain('askDirector');
    // No store, API or project access from the coordinator itself.
    expect(source('./marketingPrefill.ts')).not.toMatch(/^import /m);
  });
});

describe('Chat path with Agent Marketing present', () => {
  it('leaves the Chat composer alone and still hands off to Chat without sending', async () => {
    const gw = readyGateway();

    offerMarketingPrefill('cho marketing', vi.fn());
    consumeMarketingPrefill();
    expect(gw.setComposerDraft).not.toHaveBeenCalled();
    expect(gw.composerDraft).toBe('');

    const result = await createComposerHandoff({
      gateway: () => gw,
      projects: () => useProjectWorkspaceStore.getState(),
    })({ text: 'cho chat', projectId: null });

    expect(result.status).toBe('handed-off');
    expect(gw.setComposerDraft).toHaveBeenCalledTimes(1);
    expect(gw.setComposerDraft).toHaveBeenCalledWith('cho chat');
    expect(gw.isSending).toBe(false);
  });

  it('keeps the Home routes separate: Chat opens the Home conversation, Agent Marketing opens customer-marketing', () => {
    const home = source('./HomeSurface.tsx');

    expect(home).toContain("onSelectSurface('conversation')");
    expect(home).toContain("onNavigate('customer-marketing')");
    expect(home).toContain("capability === 'marketing'");
  });
});
