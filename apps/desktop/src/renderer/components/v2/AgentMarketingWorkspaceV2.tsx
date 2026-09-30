import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type {
  CustomerCapability,
  CustomerMediaArtifact,
  CustomerRole,
} from '../../../shared/customer-marketing-types';
import {
  resolveCustomerCapabilitySurface,
  type CustomerCapabilitySurfaceState,
} from '../../pages/customer-capability-actions';
import type { CapabilityWorkbenchOpenView } from '../../pages/CustomerMarketingCapabilityWorkbenches';

// M4 Agent Marketing V2: presentational tab frame only. Data, mutations and gates stay in
// CustomerMarketingRoom; this file never calls IPC.
export const AGENT_MARKETING_TABS = [
  { id: 'conversation', label: 'Hội thoại' },
  { id: 'plan', label: 'Kế hoạch' },
  { id: 'content', label: 'Nội dung' },
  { id: 'analytics', label: 'Phân tích' },
  { id: 'channels', label: 'Kênh' },
  { id: 'files', label: 'Tệp' },
] as const;

export type AgentMarketingTab = (typeof AGENT_MARKETING_TABS)[number]['id'];

// Conversation hosts the only Director composer, so a Home prefill is consumed on mount.
export const DEFAULT_AGENT_MARKETING_TAB: AgentMarketingTab = 'conversation';

// A panel mounts the first time its tab opens and then stays mounted (hidden), so the Director
// draft survives a tab switch and Analytics fetches once instead of on every visit.
export function withMountedTab(
  mounted: ReadonlySet<AgentMarketingTab>,
  tab: AgentMarketingTab,
): ReadonlySet<AgentMarketingTab> {
  return mounted.has(tab) ? mounted : new Set([...mounted, tab]);
}

// Workbench "open" requests mapped onto V2 tabs. Views with no V2 tab return null: approvals
// already live in the always-visible inspector, the rest stay legacy-only (flag OFF).
export function resolveAgentMarketingOpenTab(view: CapabilityWorkbenchOpenView): AgentMarketingTab | null {
  if (view === 'director') return 'conversation';
  if (view === 'content') return 'content';
  return null;
}

const ANALYTICS_CAPABILITY_ID = 'analytics-copilot';

export interface AnalyticsTabGate {
  ready: boolean;
  state: CustomerCapabilitySurfaceState | 'missing';
}

// Same condition as the legacy capability effect: the resolver must hand back the workbench action.
export function resolveAnalyticsTabGate(
  capabilities: readonly CustomerCapability[],
  workspace: { plan: string; role: CustomerRole },
): AnalyticsTabGate {
  const capability = capabilities.find((item) => item.id === ANALYTICS_CAPABILITY_ID);
  if (!capability) return { ready: false, state: 'missing' };
  const surface = resolveCustomerCapabilitySurface(capability, workspace);
  const ready = surface.action?.view === 'capability'
    && surface.action.capabilityId === ANALYTICS_CAPABILITY_ID;
  return { ready, state: surface.state };
}

// Shown instead of the workbench. States only; no metrics are invented here.
export const ANALYTICS_GATE_COPY: Record<AnalyticsTabGate['state'], string> = {
  missing: 'Workspace này chưa có Analytics Copilot trong danh mục.',
  surface_catalog_only: 'Analytics Copilot mới có trong danh mục, chưa mở được trong workspace.',
  surface_plan_required: 'Gói hiện tại chưa bao gồm Analytics Copilot.',
  surface_permission_required: 'Vai trò của bạn chưa có quyền dùng Analytics Copilot.',
  surface_setup: 'Analytics Copilot cần thiết lập trước khi dùng.',
  surface_ready: 'Analytics Copilot chưa sẵn sàng trong workspace này.',
};

function formatArtifactSize(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  if (value < 1_024) return `${value.toLocaleString('vi-VN')} B`;
  const kilobytes = value / 1_024;
  if (kilobytes < 1_024) return `${kilobytes.toLocaleString('vi-VN', { maximumFractionDigits: 1 })} KB`;
  return `${(kilobytes / 1_024).toLocaleString('vi-VN', { maximumFractionDigits: 1 })} MB`;
}

function formatArtifactDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Chưa ghi nhận';
  return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

// Read-only: there is no Files API, so this lists the media artifacts the snapshot already carries.
export function AgentMarketingFilesList({ artifacts }: { artifacts: readonly CustomerMediaArtifact[] }) {
  if (artifacts.length === 0) {
    return (
      <div className="v2-empty">
        <p>Chưa có tệp nào. Tệp xuất hiện khi một media job tạo artifact.</p>
      </div>
    );
  }
  return (
    <ul className="v2-agent-marketing__files">
      {artifacts.map((artifact) => (
        <li key={artifact.id}>
          <strong>{artifact.name}</strong>
          <span>
            {artifact.kind.replace(/_/g, ' ')}
            {artifact.sha256 ? ` · ${artifact.sha256.slice(0, 12)}` : ''}
            {artifact.sizeBytes !== undefined ? ` · ${formatArtifactSize(artifact.sizeBytes)}` : ''}
            {' · '}
            <time dateTime={artifact.createdAt}>{formatArtifactDate(artifact.createdAt)}</time>
          </span>
        </li>
      ))}
    </ul>
  );
}

export interface AgentMarketingWorkspaceV2Props {
  tab: AgentMarketingTab;
  onTabChange: (tab: AgentMarketingTab) => void;
  conversation: ReactNode;
  plan: ReactNode;
  content: ReactNode;
  analytics: ReactNode;
  channels: ReactNode;
  inspector: ReactNode;
  artifacts: readonly CustomerMediaArtifact[];
  externalActionsAllowed: boolean;
}

export function AgentMarketingWorkspaceV2({
  tab,
  onTabChange,
  conversation,
  plan,
  content,
  analytics,
  channels,
  inspector,
  artifacts,
  externalActionsAllowed,
}: AgentMarketingWorkspaceV2Props) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [mountedTabs, setMountedTabs] = useState<ReadonlySet<AgentMarketingTab>>(() => new Set([tab]));
  const activeIndex = AGENT_MARKETING_TABS.findIndex((item) => item.id === tab);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const last = AGENT_MARKETING_TABS.length - 1;
    let next: number;
    if (event.key === 'ArrowRight') next = (activeIndex + 1) % AGENT_MARKETING_TABS.length;
    else if (event.key === 'ArrowLeft') next = (activeIndex - 1 + AGENT_MARKETING_TABS.length) % AGENT_MARKETING_TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    else return;
    event.preventDefault();
    onTabChange(AGENT_MARKETING_TABS[next].id);
    tabRefs.current[next]?.focus();
  };

  useEffect(() => {
    setMountedTabs((current) => withMountedTab(current, tab));
  }, [tab]);

  const panels: Record<AgentMarketingTab, ReactNode> = {
    conversation,
    plan,
    content,
    analytics,
    channels,
    files: <AgentMarketingFilesList artifacts={artifacts} />,
  };

  return (
    <div className="v2-agent-marketing">
      <div className="v2-agent-marketing__main">
        <div className="v2-project-tabs" role="tablist" aria-label="Agent Marketing" onKeyDown={onKeyDown}>
          {AGENT_MARKETING_TABS.map((item, index) => {
            const active = item.id === tab;
            return (
              <button
                key={item.id}
                ref={(node) => { tabRefs.current[index] = node; }}
                type="button"
                role="tab"
                id={`v2-am-tab-${item.id}`}
                className={`v2-tab${active ? ' is-active' : ''}`}
                aria-selected={active}
                aria-controls={`v2-am-panel-${item.id}`}
                tabIndex={active ? 0 : -1}
                onClick={() => onTabChange(item.id)}
              >
                {item.label}
              </button>
            );
          })}
        </div>
        {AGENT_MARKETING_TABS.map((item) => (
          <div
            key={item.id}
            className="v2-project-panel"
            role="tabpanel"
            id={`v2-am-panel-${item.id}`}
            aria-labelledby={`v2-am-tab-${item.id}`}
            tabIndex={0}
            hidden={item.id !== tab}
          >
            {(item.id === tab || mountedTabs.has(item.id)) && panels[item.id]}
          </div>
        ))}
      </div>
      <aside className="v2-agent-marketing__inspector" aria-label="Kiểm soát Agent Marketing">
        <p className="v2-agent-marketing__guard">
          Hành động bên ngoài: <strong>{externalActionsAllowed ? 'Bật' : 'Tắt'}</strong>
        </p>
        {inspector}
      </aside>
    </div>
  );
}
