import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type {
  CustomerCapability,
  CustomerMediaArtifact,
  CustomerRole,
} from '../../../shared/customer-marketing-types';
import {
  AGENT_MARKETING_TABS,
  ANALYTICS_GATE_COPY,
  AgentMarketingFilesList,
  AgentMarketingWorkspaceV2,
  DEFAULT_AGENT_MARKETING_TAB,
  resolveAgentMarketingOpenTab,
  resolveAnalyticsTabGate,
  withMountedTab,
  type AgentMarketingTab,
} from './AgentMarketingWorkspaceV2';

function analyticsCapability(overrides: Partial<CustomerCapability> = {}): CustomerCapability {
  return {
    id: 'analytics-copilot',
    name: 'Analytics Copilot',
    description: 'Đọc số liệu chiến dịch',
    category: 'analytics',
    role: 'analyst',
    source: 'core',
    status: 'available',
    automationModes: ['copilot'],
    requiredIntegrations: [],
    minimumPlan: 'pro',
    permission: 'execute',
    stability: 'stable',
    creditEstimate: { minimum: 1, maximum: 2, unit: 'credits_per_run' },
    inputs: [],
    outputs: [],
    ...overrides,
  };
}

const OWNER_PRO = { plan: 'pro', role: 'owner' as CustomerRole };

function artifact(overrides: Partial<CustomerMediaArtifact> = {}): CustomerMediaArtifact {
  return {
    id: 'artifact-1',
    jobId: 'job-1',
    kind: 'project_manifest',
    name: 'manifest.json',
    createdAt: '2026-09-01T08:00:00.000Z',
    ...overrides,
  };
}

function renderWorkspace(tab: AgentMarketingTab, options: {
  artifacts?: CustomerMediaArtifact[];
  externalActionsAllowed?: boolean;
} = {}) {
  return renderToStaticMarkup(
    createElement(AgentMarketingWorkspaceV2, {
      tab,
      onTabChange: () => undefined,
      conversation: createElement('div', { id: 'slot-conversation' }, 'conversation'),
      plan: createElement('div', { id: 'slot-plan' }, 'plan'),
      content: createElement('div', { id: 'slot-content' }, 'content'),
      analytics: createElement('div', { id: 'slot-analytics' }, 'analytics'),
      channels: createElement('div', { id: 'slot-channels' }, 'channels'),
      inspector: createElement('div', { id: 'slot-inspector' }, 'approvals'),
      artifacts: options.artifacts ?? [],
      externalActionsAllowed: options.externalActionsAllowed ?? false,
    }),
  );
}

function count(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

describe('Agent Marketing V2 tabs', () => {
  it('exposes the six contract tabs in order and opens on the Director conversation', () => {
    expect(AGENT_MARKETING_TABS.map((item) => item.id)).toEqual([
      'conversation', 'plan', 'content', 'analytics', 'channels', 'files',
    ]);
    expect(DEFAULT_AGENT_MARKETING_TAB).toBe('conversation');
  });

  it.each(AGENT_MARKETING_TABS.map((item) => item.id))('mounts only the active %s slot on first render', (tab) => {
    const html = renderWorkspace(tab);

    // One tabpanel per tab so a visited panel can stay mounted; every other panel is hidden.
    expect(count(html, 'role="tabpanel"')).toBe(AGENT_MARKETING_TABS.length);
    expect(count(html, 'hidden=""')).toBe(AGENT_MARKETING_TABS.length - 1);
    expect(html).toMatch(new RegExp(`id="v2-am-panel-${tab}"(?![^>]*hidden)[^>]*>`));
    expect(html).toContain(`aria-labelledby="v2-am-tab-${tab}"`);
    expect(count(html, 'aria-selected="true"')).toBe(1);
    expect(html).toMatch(new RegExp(`id="v2-am-tab-${tab}"[^>]*aria-selected="true"`));
    for (const other of ['conversation', 'plan', 'content', 'analytics', 'channels']) {
      expect(html.includes(`id="slot-${other}"`)).toBe(other === tab);
    }
    // The inspector (approvals) stays visible on every tab.
    expect(html).toContain('id="slot-inspector"');
  });

  it('shows the external-action guard from the snapshot flag without changing it', () => {
    expect(renderWorkspace('conversation')).toContain('Hành động bên ngoài: <strong>Tắt</strong>');
    expect(renderWorkspace('conversation', { externalActionsAllowed: true }))
      .toContain('Hành động bên ngoài: <strong>Bật</strong>');
  });
});

describe('Agent Marketing V2 panel persistence', () => {
  it('keeps the same set when the tab is already mounted', () => {
    const mounted: ReadonlySet<AgentMarketingTab> = new Set<AgentMarketingTab>(['conversation', 'analytics']);

    expect(withMountedTab(mounted, 'analytics')).toBe(mounted);
  });

  it('adds a newly opened tab without mutating the previous set', () => {
    const mounted: ReadonlySet<AgentMarketingTab> = new Set<AgentMarketingTab>(['conversation']);

    const next = withMountedTab(mounted, 'analytics');

    expect([...next]).toEqual(['conversation', 'analytics']);
    expect([...mounted]).toEqual(['conversation']);
  });

  it('keeps the Director draft and Analytics mounted across a round trip of tab switches', () => {
    let mounted: ReadonlySet<AgentMarketingTab> = new Set<AgentMarketingTab>([DEFAULT_AGENT_MARKETING_TAB]);
    for (const tab of ['analytics', 'plan', 'conversation', 'analytics'] as const) {
      mounted = withMountedTab(mounted, tab);
    }

    expect(mounted.has('conversation')).toBe(true);
    expect(mounted.has('analytics')).toBe(true);
    expect(mounted.has('files')).toBe(false);
  });
});

describe('Agent Marketing V2 workbench open routing', () => {
  it('maps Director and Content requests onto their V2 tabs', () => {
    expect(resolveAgentMarketingOpenTab('director')).toBe('conversation');
    expect(resolveAgentMarketingOpenTab('content')).toBe('content');
  });

  it.each(['assets', 'campaigns', 'approvals', 'brand'] as const)('ignores %s, which has no V2 tab', (view) => {
    expect(resolveAgentMarketingOpenTab(view)).toBeNull();
  });
});

describe('Agent Marketing V2 analytics gate', () => {
  it('reports missing when the catalog has no Analytics Copilot', () => {
    expect(resolveAnalyticsTabGate([], OWNER_PRO)).toEqual({ ready: false, state: 'missing' });
  });

  it.each([
    ['extension source', { source: 'extension' as const }, OWNER_PRO, 'surface_catalog_only'],
    ['plan below minimum', {}, { plan: 'starter', role: 'owner' as CustomerRole }, 'surface_plan_required'],
    ['role without permission', {}, { plan: 'pro', role: 'viewer' as CustomerRole }, 'surface_permission_required'],
    ['reviewer cannot execute', {}, { plan: 'pro', role: 'reviewer' as CustomerRole }, 'surface_permission_required'],
  ])('blocks the workbench for %s', (_label, overrides, workspace, state) => {
    expect(resolveAnalyticsTabGate([analyticsCapability(overrides)], workspace))
      .toEqual({ ready: false, state });
  });

  it('opens the workbench for setup and ready states, like the legacy capability view', () => {
    expect(resolveAnalyticsTabGate([analyticsCapability({ status: 'needs_setup' })], OWNER_PRO))
      .toEqual({ ready: true, state: 'surface_setup' });
    expect(resolveAnalyticsTabGate([analyticsCapability()], OWNER_PRO))
      .toEqual({ ready: true, state: 'surface_ready' });
  });

  it('has state-only copy for every gate state and invents no metrics', () => {
    const states = ['missing', 'surface_catalog_only', 'surface_plan_required',
      'surface_permission_required', 'surface_setup', 'surface_ready'] as const;
    for (const state of states) {
      expect(ANALYTICS_GATE_COPY[state].trim().length).toBeGreaterThan(0);
      expect(ANALYTICS_GATE_COPY[state]).not.toMatch(/\d/);
    }
  });
});

describe('Agent Marketing V2 files', () => {
  it('shows an honest empty state when no media artifact exists', () => {
    const html = renderWorkspace('files');
    expect(html).toContain('Chưa có tệp nào. Tệp xuất hiện khi một media job tạo artifact.');
    expect(html).not.toContain('v2-agent-marketing__files');
  });

  it('lists snapshot artifacts with kind, short hash, size and machine-readable date', () => {
    const html = renderToStaticMarkup(createElement(AgentMarketingFilesList, {
      artifacts: [artifact({ sha256: 'abcdef0123456789abcdef', sizeBytes: 2_048 })],
    }));

    expect(html).toContain('<strong>manifest.json</strong>');
    expect(html).toContain('project manifest');
    expect(html).toContain('abcdef012345');
    expect(html).not.toContain('abcdef0123456');
    expect(html).toContain('2 KB');
    expect(html).toContain('dateTime="2026-09-01T08:00:00.000Z"');
  });

  it('omits hash and size when the artifact does not carry them and flags a bad date', () => {
    const html = renderToStaticMarkup(createElement(AgentMarketingFilesList, {
      artifacts: [artifact({ createdAt: 'not-a-date' })],
    }));

    expect(html).not.toContain(' B ·');
    expect(html).toContain('Chưa ghi nhận');
  });
});

describe('Agent Marketing V2 wiring', () => {
  const room = readFileSync(
    fileURLToPath(new URL('../../pages/CustomerMarketingRoom.tsx', import.meta.url)),
    'utf8',
  );
  const app = readFileSync(fileURLToPath(new URL('../../App.tsx', import.meta.url)), 'utf8');

  it('passes the shell flag only from App and keeps the page default OFF', () => {
    expect(app).toContain('<CustomerMarketingRoomPage v2={isShellV2} />');
    expect(room).toContain('export function CustomerMarketingRoomPage({ v2 = false }');
    expect(room).toMatch(/function CustomerRoom\(\{[\s\S]*?v2 = false,/);
  });

  it('branches after every hook in CustomerRoom and keeps the legacy WorkspaceNav', () => {
    const start = room.indexOf('function CustomerRoom(');
    const end = room.indexOf('export function CustomerMarketingRoomPage');
    const body = room.slice(start, end);
    const branch = body.indexOf('if (v2) {');
    // Any hook call: built-ins (useEffect, useLayoutEffect, useContext, ...) and custom use* hooks.
    const hookCalls = [...body.matchAll(/\buse[A-Z]\w*(?:<[^>()]*>)?\(/g)];
    const lastHook = hookCalls.length > 0 ? hookCalls[hookCalls.length - 1].index ?? -1 : -1;

    expect(branch).toBeGreaterThan(0);
    expect(lastHook).toBeLessThan(branch);
    expect(body.slice(branch)).toContain('<WorkspaceNav');
  });

  it('keeps the V2 component free of IPC and mutations', () => {
    const component = readFileSync(
      fileURLToPath(new URL('./AgentMarketingWorkspaceV2.tsx', import.meta.url)),
      'utf8',
    );
    expect(component).not.toMatch(/window\.(izzi|electron|api)|ipcRenderer|invoke\(/);
  });

  it('never remounts the Director draft or Analytics fetch on a tab switch (ledger #6)', () => {
    const v2Frame = room.slice(room.indexOf('<AgentMarketingWorkspaceV2'), room.indexOf('externalActionsAllowed={snapshot.externalActionsAllowed}'));
    const workbenches = readFileSync(
      fileURLToPath(new URL('../../pages/CustomerMarketingCapabilityWorkbenches.tsx', import.meta.url)),
      'utf8',
    );
    const analytics = workbenches.slice(workbenches.indexOf('function AnalyticsCopilotView('));

    // The page picks slots from the snapshot, never from the active tab.
    expect(v2Frame).not.toMatch(/key=\{/);
    expect(v2Frame).not.toContain('v2Tab ===');
    expect(room).toContain('const analyticsGate = resolveAnalyticsTabGate(snapshot.capabilities, snapshot.workspace);');
    // The draft lives in the kept-mounted composer, and Analytics fetches once per mount.
    expect(room).toMatch(/function DirectorComposer\([^)]*\) \{\s*const \[goal, setGoal\] = useState\(''\);/);
    expect(analytics).toContain('const initialRange = useMemo(() => currentMonthAnalyticsRange(), []);');
    expect(analytics).toMatch(/const load = useCallback\([\s\S]*?\n  \}, \[\]\);/);
    expect(analytics).toContain('}, [initialRange, load]);');
  });

  it('routes Director success to the V2 tab only, and the legacy view only with the flag OFF', () => {
    const handler = room.slice(room.indexOf('const director = async'), room.indexOf('const review = async'));

    expect(handler).toContain("if (v2) setV2Tab('conversation');");
    expect(handler).toContain("else selectView('director');");
  });

  it('routes Analytics workbench open requests through the V2 tab map', () => {
    const branch = room.slice(room.indexOf('if (v2) {'), room.indexOf('<WorkspaceSettingsDrawer'));

    expect(branch).toContain('resolveAgentMarketingOpenTab(view)');
    expect(branch).toContain('onOpen={openFromWorkbench}');
    expect(branch).not.toContain('onOpen={toConversation}');
  });

  it('marks the V2 room root so V2 surface tokens replace the legacy cmr frame', () => {
    const branch = room.slice(room.indexOf('if (v2) {'));

    expect(branch).toContain('<div className="cmr-page v2-agent-marketing-room">');
  });
});
