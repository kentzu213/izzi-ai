/**
 * Personal Office shell — Workspaces.
 *
 * List, open/switch, favourite, and a create-from-blueprint affordance.
 *
 * The create button is deliberately disabled with a stated reason rather than
 * hidden or faked: blueprint provisioning is W3's engine work, and a button that
 * silently does nothing is worse than one that says why it cannot yet.
 *
 * `isFavorite` / `lastOpenedAt` are local UI preference, not domain truth — the
 * contract has no such fields (raised as CR-UX-02). They live in the shell store.
 *
 * @module renderer/shell/WorkspacesPage
 */

import React from 'react';
import { SurfaceNotice, SurfaceState } from './SurfaceState';
import { ChevronRightIcon } from './ShellIcons';
import type { WorkSnapshot, WorkspaceView } from './types';
import type { WorkspaceInstanceId } from '../../shared/personal-office';

interface WorkspacesPageProps {
  readonly snapshot: WorkSnapshot;
  readonly favorites: readonly string[];
  readonly onOpen: (id: WorkspaceInstanceId) => void;
  readonly onToggleFavorite: (id: WorkspaceInstanceId) => void;
  readonly onRetry: () => void;
}

function WorkspaceRow({
  workspace,
  isFavorite,
  onOpen,
  onToggleFavorite,
}: {
  workspace: WorkspaceView;
  isFavorite: boolean;
  onOpen: (id: WorkspaceInstanceId) => void;
  onToggleFavorite: (id: WorkspaceInstanceId) => void;
}) {
  const counts = [
    `${workspace.activeCount} active`,
    `${workspace.needsMeCount} waiting`,
    `${workspace.deliveredCount} delivered`,
  ].join(' · ');

  return (
    <li className="po-ws-row">
      <button
        type="button"
        className="po-ws-row__open"
        onClick={() => onOpen(workspace.id)}
        aria-label={`Open ${workspace.name}. ${counts}`}
      >
        <span className="po-ws-row__main">
          <span className="po-ws-row__name">{workspace.name}</span>
          <span className="po-ws-row__meta">{counts}</span>
        </span>
        {!workspace.isReady && <span className="po-chip po-chip--muted">Not ready</span>}
        <ChevronRightIcon className="po-ws-row__chevron" />
      </button>
      <button
        type="button"
        className={`po-icon-btn po-ws-row__fav${isFavorite ? ' is-on' : ''}`}
        onClick={() => onToggleFavorite(workspace.id)}
        aria-pressed={isFavorite}
        aria-label={isFavorite ? `Unfavourite ${workspace.name}` : `Favourite ${workspace.name}`}
        title={isFavorite ? 'Remove from favourites' : 'Add to favourites'}
      >
        <span aria-hidden="true">{isFavorite ? '★' : '☆'}</span>
      </button>
    </li>
  );
}

export function WorkspacesPage({
  snapshot,
  favorites,
  onOpen,
  onToggleFavorite,
  onRetry,
}: WorkspacesPageProps) {
  const { status } = snapshot;
  const favouriteSet = new Set(favorites);
  const favourite = snapshot.workspaces.filter((w) => favouriteSet.has(w.id));
  const rest = snapshot.workspaces.filter((w) => !favouriteSet.has(w.id));

  return (
    <div className="po-surface">
      <div className="po-surface__head">
        <h1 className="po-surface__title">Workspaces</h1>
        <button
          type="button"
          className="po-btn po-btn--quiet"
          disabled
          title="Blueprints arrive with the work engine"
          aria-describedby="po-ws-create-hint"
        >
          New from blueprint
        </button>
      </div>
      <p className="po-hint" id="po-ws-create-hint">
        Creating an office from a blueprint arrives with the work engine.
      </p>

      {snapshot.isOffline && (
        <SurfaceNotice kind="offline" message="You are offline. Showing the last known list." />
      )}
      {!snapshot.isOffline && snapshot.degradedReason && (
        <SurfaceNotice kind="degraded" message={snapshot.degradedReason} />
      )}

      {status === 'loading' && (
        <SurfaceState kind="loading" title="Loading workspaces" skeleton="list" />
      )}

      {status === 'error' && (
        <SurfaceState
          kind="error"
          title="Could not load workspaces"
          description={snapshot.errorMessage ?? 'Something went wrong while reading the work engine.'}
          action={{ label: 'Try again', onClick: onRetry }}
        />
      )}

      {status !== 'loading' && status !== 'error' && snapshot.workspaces.length === 0 && (
        <SurfaceState
          kind="empty"
          title="No workspaces yet"
          description="Delegate a goal from Today and your first office is created around it."
        />
      )}

      {favourite.length > 0 && (
        <section className="po-ws-group" aria-labelledby="po-ws-fav-heading">
          <h2 className="po-ws-group__heading" id="po-ws-fav-heading">
            Favourites
          </h2>
          <ul className="po-ws-list">
            {favourite.map((workspace) => (
              <WorkspaceRow
                key={workspace.id}
                workspace={workspace}
                isFavorite
                onOpen={onOpen}
                onToggleFavorite={onToggleFavorite}
              />
            ))}
          </ul>
        </section>
      )}

      {rest.length > 0 && (
        <section className="po-ws-group" aria-labelledby="po-ws-all-heading">
          <h2 className="po-ws-group__heading" id="po-ws-all-heading">
            {favourite.length > 0 ? 'Everything else' : 'All workspaces'}
          </h2>
          <ul className="po-ws-list">
            {rest.map((workspace) => (
              <WorkspaceRow
                key={workspace.id}
                workspace={workspace}
                isFavorite={false}
                onOpen={onOpen}
                onToggleFavorite={onToggleFavorite}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
