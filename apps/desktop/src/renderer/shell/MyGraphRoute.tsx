/**
 * Personal Office shell — MyGraph route shell.
 *
 * OWNERSHIP BOUNDARY (gate PO-VAULT-OWNERSHIP):
 *   Loop 02 owns this *route shell* — the heading, the landmark, the surface
 *   states, and the frame the graph is mounted into.
 *   Loop 04 owns everything *inside* it: the graph canvas, node interaction,
 *   vault-ops / vault-types / wikilink, and renderer/components/vault/*.
 *
 * So this file deliberately does no graph work. It does not restyle the canvas,
 * does not read graph state, and does not wrap the graph in extra chrome. It
 * mounts the existing knowledge surface unchanged and supplies only what the
 * shell contract requires: one h1, the offline/degraded notices, and an error
 * boundary story consistent with every other route.
 *
 * @module renderer/shell/MyGraphRoute
 */

import React from 'react';
import { SurfaceNotice } from './SurfaceState';
import type { WorkSnapshot } from './types';

interface MyGraphRouteProps {
  readonly snapshot: WorkSnapshot;
  /** Renders the legacy `knowledge` page. Owned by App.tsx, Loop 04 internals. */
  readonly renderGraph: () => React.ReactNode;
}

export function MyGraphRoute({ snapshot, renderGraph }: MyGraphRouteProps) {
  return (
    <section className="po-surface po-surface--graph" aria-labelledby="po-mygraph-heading">
      <header className="po-surface__head">
        <h1 id="po-mygraph-heading" className="po-surface__title">
          MyGraph
        </h1>
        <p className="po-surface__subtitle">Your knowledge graph</p>
      </header>

      {snapshot.isOffline && (
        <SurfaceNotice
          kind="offline"
          message="You are offline. The graph shows the last data loaded on this device."
        />
      )}
      {!snapshot.isOffline && snapshot.degradedReason && (
        <SurfaceNotice kind="degraded" message={snapshot.degradedReason} />
      )}

      {/*
        Loop 04 territory below this line. The graph renders itself; the shell
        only provides the mount point so the route has a stable landmark.
      */}
      <div className="po-graph-mount">{renderGraph()}</div>
    </section>
  );
}
