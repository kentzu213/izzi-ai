/**
 * Personal Office shell — workspace home.
 *
 * Exactly four surfaces: Brief, Work, Deliverables, Approvals.
 *
 * Context, Apps, Brand, Knowledge, Agents/Skills, Policies and Runtime are
 * deliberately NOT tabs. They live in the setup drawer, because they are things
 * you configure occasionally, not things you operate daily. Promoting any of
 * them to a tab is what turned the legacy shell into a control panel.
 *
 * @module renderer/shell/WorkspaceHome
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { WORKSPACE_SURFACES, type WorkspaceSurface, type WorkSnapshot, type WorkspaceView } from './types';
import { SurfaceNotice, SurfaceState } from './SurfaceState';
import { ApprovalCard, DeliverableCard, WorkItemCard, WorkLane } from './WorkLane';
import { CloseIcon, SlidersIcon } from './ShellIcons';
import type { ApprovalId } from '../../shared/personal-office';

/** Drawer entries. Each is a setup concern, not an operating surface. */
const SETUP_SECTIONS: readonly { id: string; label: string; description: string }[] = Object.freeze([
  Object.freeze({ id: 'context', label: 'Context', description: 'What this office knows by default' }),
  Object.freeze({ id: 'apps', label: 'Apps', description: 'Connected tools and integrations' }),
  Object.freeze({ id: 'brand', label: 'Brand', description: 'Voice, tone and visual rules' }),
  Object.freeze({ id: 'knowledge', label: 'Knowledge', description: 'Sources this office may read' }),
  Object.freeze({ id: 'agents', label: 'Agents and skills', description: 'Who does the work' }),
  Object.freeze({ id: 'policies', label: 'Policies', description: 'What needs your approval' }),
  Object.freeze({ id: 'runtime', label: 'Runtime', description: 'Where the work executes' }),
]);

interface SetupDrawerProps {
  readonly isOpen: boolean;
  readonly workspaceName: string;
  readonly onClose: () => void;
}

function SetupDrawer({ isOpen, workspaceName, onClose }: SetupDrawerProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    restoreTo.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>('button')?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panel) return;
      const focusable = Array.from(
        panel.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
      ).filter((el) => !el.hasAttribute('disabled'));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      restoreTo.current?.focus?.();
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="po-drawer-layer">
      <div className="po-drawer-backdrop" onMouseDown={onClose} aria-hidden="true" />
      <aside
        className="po-drawer"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Setup for ${workspaceName}`}
      >
        <header className="po-drawer__head">
          <h2 className="po-drawer__title">Setup</h2>
          <button type="button" className="po-icon-button" onClick={onClose} aria-label="Close setup" title="Close setup">
            <CloseIcon className="po-icon" />
          </button>
        </header>
        <p className="po-drawer__lede">
          Occasional configuration for this office. Nothing here is part of the daily loop.
        </p>
        <ul className="po-drawer__list">
          {SETUP_SECTIONS.map((section) => (
            <li key={section.id}>
              <button type="button" className="po-drawer__item" disabled aria-disabled="true">
                <span className="po-drawer__item-label">{section.label}</span>
                <span className="po-drawer__item-desc">{section.description}</span>
                <span className="po-chip po-chip--quiet">Not in this release</span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

interface WorkspaceHomeProps {
  readonly workspace: WorkspaceView | undefined;
  readonly snapshot: WorkSnapshot;
  readonly surface: WorkspaceSurface;
  readonly onSurfaceChange: (surface: WorkspaceSurface) => void;
  readonly onRetry: () => void;
  readonly onBack: () => void;
}

export function WorkspaceHome({
  workspace,
  snapshot,
  surface,
  onSurfaceChange,
  onRetry,
  onBack,
}: WorkspaceHomeProps) {
  const [isDrawerOpen, setDrawerOpen] = useState(false);
  const tabsRef = useRef<HTMLDivElement | null>(null);

  /** Roving tabindex: arrows move between surfaces, matching tab semantics. */
  const onTabKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
      if (!keys.includes(event.key)) return;
      event.preventDefault();
      const index = WORKSPACE_SURFACES.findIndex((entry) => entry.id === surface);
      let next = index;
      if (event.key === 'ArrowLeft') next = (index - 1 + WORKSPACE_SURFACES.length) % WORKSPACE_SURFACES.length;
      if (event.key === 'ArrowRight') next = (index + 1) % WORKSPACE_SURFACES.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = WORKSPACE_SURFACES.length - 1;
      const target = WORKSPACE_SURFACES[next];
      onSurfaceChange(target.id);
      tabsRef.current?.querySelector<HTMLElement>(`#po-tab-${target.id}`)?.focus();
    },
    [onSurfaceChange, surface],
  );

  if (!workspace) {
    return (
      <section className="po-surface" aria-labelledby="po-workspace-missing">
        <h1 className="po-surface__title" id="po-workspace-missing">
          Workspace
        </h1>
        <SurfaceState
          kind="empty"
          title="That workspace is not available"
          description="It may have been removed, or it has not finished setting up."
          action={{ label: 'Back to workspaces', onClick: onBack }}
        />
      </section>
    );
  }

  const runsHere = snapshot.active
    .concat(snapshot.needsMe, snapshot.attention)
    .filter((item) => item.workspaceId === workspace.id);
  const deliveredHere = snapshot.delivered.filter((item) => item.workspaceId === workspace.id);
  const deliverablesHere = snapshot.deliverables.filter((item) =>
    deliveredHere.some((run) => run.id === item.runId),
  );
  const approvalsHere = snapshot.approvals.filter((approval) =>
    runsHere.some((run) => run.id === approval.runId),
  );

  const blocked = snapshot.status === 'loading' || snapshot.status === 'error';

  return (
    <section className="po-surface" aria-labelledby="po-workspace-title">
      <header className="po-surface__head">
        <div>
          <h1 className="po-surface__title" id="po-workspace-title">
            {workspace.name}
          </h1>
          <p className="po-surface__lede">
            {workspace.brief ?? 'No brief set for this office yet.'}
          </p>
        </div>
        <button
          type="button"
          className="po-button po-button--quiet"
          onClick={() => setDrawerOpen(true)}
          aria-label={`Open setup for ${workspace.name}`}
        >
          <SlidersIcon className="po-icon" />
          <span>Setup</span>
        </button>
      </header>

      {snapshot.isOffline && (
        <SurfaceNotice kind="offline" message="Offline. Showing the last known state; actions are paused." />
      )}
      {snapshot.degradedReason && !snapshot.isOffline && (
        <SurfaceNotice kind="degraded" message={snapshot.degradedReason} />
      )}

      <div className="po-tabs" role="tablist" aria-label="Workspace surfaces" ref={tabsRef} onKeyDown={onTabKeyDown}>
        {WORKSPACE_SURFACES.map((entry) => {
          const isActive = entry.id === surface;
          return (
            <button
              key={entry.id}
              id={`po-tab-${entry.id}`}
              type="button"
              role="tab"
              className={`po-tab${isActive ? ' po-tab--active' : ''}`}
              aria-selected={isActive}
              aria-controls={`po-panel-${entry.id}`}
              tabIndex={isActive ? 0 : -1}
              onClick={() => onSurfaceChange(entry.id)}
            >
              {entry.label}
            </button>
          );
        })}
      </div>

      <div className="po-tabpanel" role="tabpanel" id={`po-panel-${surface}`} aria-labelledby={`po-tab-${surface}`}>
        {blocked ? (
          <SurfaceState
            kind={snapshot.status === 'loading' ? 'loading' : 'error'}
            title={snapshot.status === 'loading' ? 'Loading' : 'Could not load this workspace'}
            description={snapshot.status === 'error' ? snapshot.errorMessage : undefined}
            skeleton="list"
            action={snapshot.status === 'error' ? { label: 'Try again', onClick: onRetry } : undefined}
          />
        ) : (
          <WorkspaceSurfaceBody
            surface={surface}
            workspace={workspace}
            runs={runsHere}
            delivered={deliveredHere}
            deliverables={deliverablesHere}
            approvals={approvalsHere}
          />
        )}
      </div>

      <SetupDrawer isOpen={isDrawerOpen} workspaceName={workspace.name} onClose={() => setDrawerOpen(false)} />
    </section>
  );
}

interface SurfaceBodyProps {
  readonly surface: WorkspaceSurface;
  readonly workspace: WorkspaceView;
  readonly runs: WorkSnapshot['active'];
  readonly delivered: WorkSnapshot['delivered'];
  readonly deliverables: WorkSnapshot['deliverables'];
  readonly approvals: WorkSnapshot['approvals'];
}

function WorkspaceSurfaceBody({
  surface,
  workspace,
  runs,
  delivered,
  deliverables,
  approvals,
}: SurfaceBodyProps) {
  if (surface === 'brief') {
    return (
      <div className="po-brief">
        <dl className="po-brief__facts">
          <div className="po-brief__fact">
            <dt>Active</dt>
            <dd>{workspace.activeCount}</dd>
          </div>
          <div className="po-brief__fact">
            <dt>Needs you</dt>
            <dd>{workspace.needsMeCount}</dd>
          </div>
          <div className="po-brief__fact">
            <dt>Delivered</dt>
            <dd>{workspace.deliveredCount}</dd>
          </div>
        </dl>
        {workspace.brief ? (
          <p className="po-brief__text">{workspace.brief}</p>
        ) : (
          <SurfaceState
            kind="empty"
            title="No brief yet"
            description="A brief is the one line that tells this office what it is for. The work model does not carry one yet, so it cannot be set from here in this release."
          />
        )}
      </div>
    );
  }

  if (surface === 'work') {
    return (
      <WorkLane title="Work in this office" count={runs.length} emptyHint="Nothing running here right now.">
        {runs.map((item) => (
          <WorkItemCard key={item.id} item={item} />
        ))}
      </WorkLane>
    );
  }

  if (surface === 'deliverables') {
    return (
      <WorkLane
        title="Deliverables"
        count={deliverables.length}
        tone="done"
        emptyHint={
          delivered.length > 0
            ? 'Finished work here has not produced a file yet.'
            : 'Finished work will leave its files here.'
        }
      >
        {deliverables.map((item) => (
          <DeliverableCard key={item.id} item={item} />
        ))}
      </WorkLane>
    );
  }

  return (
    <WorkLane
      title="Approvals"
      count={approvals.length}
      tone="attention"
      emptyHint="No decisions waiting in this office."
    >
      {approvals.map((approval) => (
        <ApprovalCard
          key={approval.id as ApprovalId}
          approval={approval}
          disabledReason="Deciding an approval needs the work engine, which lands in the next loop."
        />
      ))}
    </WorkLane>
  );
}
