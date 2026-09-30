import React, { type ReactNode } from 'react';

export interface MyGraphWorkspaceV2Props {
  /** The package graph view. The page builds it; this component only places it. */
  graph: ReactNode;
  /** Rendered inside the stage but outside `.graphview-scope` (e.g. the Live.md panel). */
  aside?: ReactNode;
  onOpenWeb: () => void;
  /** Shown when the last "open on web" attempt failed. */
  openWebError?: string;
}

/**
 * V2 frame for MyGraph. Presentational only: no IPC, no package import.
 * The graph keeps its own `.graphview-scope` token island, so the V2 CSS
 * never targets that class.
 */
export function MyGraphWorkspaceV2({ graph, aside, onOpenWeb, openWebError }: MyGraphWorkspaceV2Props) {
  return (
    <section className="v2-surface v2-mygraph" aria-labelledby="v2-mygraph-title">
      <header className="v2-surface__header">
        <div className="v2-mygraph__intro">
          <p className="v2-mygraph__kicker">Knowledge</p>
          <h1 id="v2-mygraph-title" className="v2-surface__title">MyGraph</h1>
          <p className="v2-mygraph__lead">Bản đồ tri thức của bạn, đồng bộ với tài khoản izziapi.com.</p>
        </div>
        <button type="button" className="v2-button v2-button--ghost" onClick={onOpenWeb}>
          Mở trên web ↗
        </button>
      </header>
      {openWebError && <p className="v2-mygraph__error" role="alert">{openWebError}</p>}
      <div className="v2-mygraph__stage">
        <div className="graphview-scope v2-mygraph__canvas">{graph}</div>
        {aside}
      </div>
    </section>
  );
}
