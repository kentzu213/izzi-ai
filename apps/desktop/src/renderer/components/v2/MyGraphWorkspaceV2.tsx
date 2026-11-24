import React, { useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { PanelVisibleContext } from '../../lib/panel-visibility';

export interface MyGraphWorkspaceV2Props {
  /** The package graph view. The page builds it; this component only places it. */
  graph: ReactNode;
  /** Rendered inside the stage but outside `.graphview-scope` (e.g. the Live.md panel). */
  aside?: ReactNode;
  /**
   * Care CRM S2. When given, MyGraph shows "Memory doanh nghiệp | CRM" tabs: Memory is the graph view above,
   * unchanged; CRM mounts the first time it is opened and stays mounted, paused while hidden.
   */
  crm?: ReactNode;
  onOpenWeb: () => void;
  /** Shown when the last "open on web" attempt failed. */
  openWebError?: string;
}

type MyGraphTab = 'memory' | 'crm';

const TABS: ReadonlyArray<{ id: MyGraphTab; label: string }> = [
  { id: 'memory', label: 'Memory doanh nghiệp' },
  { id: 'crm', label: 'CRM' },
];

/**
 * V2 frame for MyGraph. Presentational only: no IPC, no package import.
 * The graph keeps its own `.graphview-scope` token island, so the V2 CSS
 * never targets that class.
 */
export function MyGraphWorkspaceV2({ graph, aside, crm, onOpenWeb, openWebError }: MyGraphWorkspaceV2Props) {
  const [tab, setTab] = useState<MyGraphTab>('memory');
  const [crmOpened, setCrmOpened] = useState(false);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const select = (next: MyGraphTab) => {
    setTab(next);
    if (next === 'crm') setCrmOpened(true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = TABS.findIndex((item) => item.id === tab);
    let next: number;
    if (event.key === 'ArrowRight') next = (current + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') next = (current - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = TABS.length - 1;
    else return;
    event.preventDefault();
    select(TABS[next].id);
    tabRefs.current[next]?.focus();
  };

  const stage = (
    <div className="v2-mygraph__stage">
      <div className="graphview-scope v2-mygraph__canvas">{graph}</div>
      {aside}
    </div>
  );

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
      {crm === undefined ? stage : (
        <>
          <div className="v2-project-tabs v2-mygraph__tabs" role="tablist" aria-label="MyGraph" onKeyDown={onKeyDown}>
            {TABS.map((item, index) => {
              const active = item.id === tab;
              return (
                <button
                  key={item.id}
                  ref={(node) => { tabRefs.current[index] = node; }}
                  type="button"
                  role="tab"
                  id={`v2-mygraph-tab-${item.id}`}
                  className={`v2-tab${active ? ' is-active' : ''}`}
                  aria-selected={active}
                  aria-controls={`v2-mygraph-panel-${item.id}`}
                  tabIndex={active ? 0 : -1}
                  onClick={() => select(item.id)}
                >
                  {item.label}
                </button>
              );
            })}
          </div>
          {/* The graph mounts exactly as before whenever Memory is shown. */}
          <div
            className="v2-mygraph__panel"
            role="tabpanel"
            id="v2-mygraph-panel-memory"
            aria-labelledby="v2-mygraph-tab-memory"
            hidden={tab !== 'memory'}
          >
            {tab === 'memory' && stage}
          </div>
          <div
            className="v2-mygraph__panel v2-mygraph__crm"
            role="tabpanel"
            id="v2-mygraph-panel-crm"
            aria-labelledby="v2-mygraph-tab-crm"
            hidden={tab !== 'crm'}
          >
            {/* Kept mounted once opened so unsaved edits survive a tab switch; its refresh pauses while hidden. */}
            <PanelVisibleContext.Provider value={tab === 'crm'}>
              {(tab === 'crm' || crmOpened) && crm}
            </PanelVisibleContext.Provider>
          </div>
        </>
      )}
    </section>
  );
}
