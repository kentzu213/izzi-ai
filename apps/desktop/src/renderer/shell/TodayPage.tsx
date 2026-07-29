/**
 * Personal Office shell — Today.
 *
 * The landing surface and the primary workflow: delegate a goal, watch it work,
 * clear what needs you, collect the deliverable.
 *
 * Two structural rules are load-bearing here:
 *
 *  1. The composer is NEVER replaced by a state screen. Loading, error and empty
 *     render *below* it. That is what keeps "launch → delegate a brief" inside
 *     two actions even when the engine is unreachable.
 *  2. `attention` (failed runs) renders as an always-visible band above the
 *     lanes. A failed run is not active, not awaiting me, and not delivered, so
 *     without this band it would be invisible — which is the health/error
 *     legibility requirement, not a nicety.
 *
 * @module renderer/shell/TodayPage
 */

import React from 'react';
import { DelegateComposer } from './DelegateComposer';
import { SurfaceState, SurfaceNotice } from './SurfaceState';
import { ApprovalCard, DeliverableCard, WorkItemCard, WorkLane } from './WorkLane';
import type { WorkSnapshot } from './types';
import type { WorkspaceInstanceId } from '../../shared/personal-office';

interface TodayPageProps {
  readonly snapshot: WorkSnapshot;
  readonly isDelegating: boolean;
  readonly onDelegate: (goal: string) => Promise<boolean>;
  readonly onRetry: () => void;
  readonly onOpenWorkspace: (id: WorkspaceInstanceId) => void;
}

export function TodayPage({
  snapshot,
  isDelegating,
  onDelegate,
  onRetry,
  onOpenWorkspace,
}: TodayPageProps) {
  const { status } = snapshot;

  // Only these three replace the lanes. Offline/degraded keep data visible.
  const lanesReplaced = status === 'loading' || status === 'error' || status === 'empty';

  return (
    <div className="po-surface">
      <h1 className="po-surface__title">Today</h1>

      {snapshot.isOffline && (
        <SurfaceNotice
          kind="offline"
          message="You are offline. This is the last known state, and delegating is paused until the connection returns."
        />
      )}
      {!snapshot.isOffline && snapshot.degradedReason && (
        <SurfaceNotice kind="degraded" message={snapshot.degradedReason} />
      )}

      <DelegateComposer
        onDelegate={onDelegate}
        isBusy={isDelegating}
        disabledReason={
          snapshot.isOffline ? 'Delegating is unavailable while you are offline.' : undefined
        }
      />

      {status === 'loading' && (
        <SurfaceState kind="loading" title="Loading your work" skeleton="lanes" />
      )}

      {status === 'error' && (
        <SurfaceState
          kind="error"
          title="Could not load your work"
          description={snapshot.errorMessage ?? 'Something went wrong while reading the work engine.'}
          action={{ label: 'Try again', onClick: onRetry }}
        />
      )}

      {status === 'empty' && (
        <SurfaceState
          kind="empty"
          title="Nothing in flight"
          description="Delegate a goal above and it will show up here as it moves."
        />
      )}

      {!lanesReplaced && (
        <>
          {snapshot.attention.length > 0 && (
            <section className="po-attention" aria-labelledby="po-attention-heading">
              <h2 className="po-attention__heading" id="po-attention-heading">
                Needs attention
              </h2>
              <ul className="po-lane__list">
                {snapshot.attention.map((item) => (
                  <WorkItemCard
                    key={item.id}
                    item={item}
                    onOpenWorkspace={onOpenWorkspace}
                  />
                ))}
              </ul>
            </section>
          )}

          <div className="po-lanes">
            <WorkLane
              title="Active work"
              count={snapshot.active.length}
              emptyHint="Nothing running right now."
            >
              {snapshot.active.map((item) => (
                <WorkItemCard key={item.id} item={item} onOpenWorkspace={onOpenWorkspace} />
              ))}
            </WorkLane>

            <WorkLane
              title="Waiting for me"
              count={snapshot.needsMe.length + snapshot.approvals.length}
              tone={snapshot.approvals.length > 0 ? 'attention' : 'neutral'}
              emptyHint="Nothing is blocked on you."
            >
              {snapshot.approvals.map((approval) => (
                <ApprovalCard
                  key={approval.id}
                  approval={approval}
                  disabledReason={
                    snapshot.isOffline
                      ? 'Decisions are unavailable while you are offline.'
                      : 'Deciding arrives with the work engine.'
                  }
                />
              ))}
              {snapshot.needsMe.map((item) => (
                <WorkItemCard key={item.id} item={item} onOpenWorkspace={onOpenWorkspace} />
              ))}
            </WorkLane>

            <WorkLane
              title="Delivered"
              count={snapshot.deliverables.length + snapshot.delivered.length}
              tone="done"
              emptyHint="Finished work lands here."
            >
              {snapshot.deliverables.map((item) => (
                <DeliverableCard key={item.id} item={item} />
              ))}
              {snapshot.delivered.map((item) => (
                <WorkItemCard key={item.id} item={item} onOpenWorkspace={onOpenWorkspace} />
              ))}
            </WorkLane>
          </div>
        </>
      )}
    </div>
  );
}
