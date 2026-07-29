import React, { useEffect, useState } from 'react';
import type { RuntimeHealthSnapshot } from '../../shared/runtime/types';

type LoadState =
  | { status: 'loading'; items: readonly RuntimeHealthSnapshot[] }
  | { status: 'ready'; items: readonly RuntimeHealthSnapshot[] }
  | { status: 'error'; items: readonly RuntimeHealthSnapshot[] };

export function RuntimeHealthPanel() {
  const [state, setState] = useState<LoadState>({ status: 'loading', items: [] });

  useEffect(() => {
    let active = true;
    const api = window.electronAPI?.runtime;
    if (!api) {
      setState({ status: 'error', items: [] });
      return () => {
        active = false;
      };
    }
    void api.listHealth({ workspaceId: '' }).then(
      (items) => {
        if (active) setState({ status: 'ready', items });
      },
      () => {
        if (active) setState({ status: 'error', items: [] });
      },
    );
    return () => {
      active = false;
    };
  }, []);

  return (
    <section aria-labelledby="po-runtime-health-heading">
      <h2 id="po-runtime-health-heading" className="po-panel__title">
        Runtime health
      </h2>
      {state.status === 'loading' && (
        <p className="po-panel__text" role="status">
          Checking managed runtimes…
        </p>
      )}
      {state.status === 'error' && (
        <p className="po-panel__text" role="alert">
          Runtime health is unavailable. No runtime action was started.
        </p>
      )}
      {state.status === 'ready' && state.items.length === 0 && (
        <p className="po-panel__text">No managed runtime is active.</p>
      )}
      {state.items.length > 0 && (
        <ul className="po-link-list" aria-label="Managed runtime health">
          {state.items.map((item) => (
            <li key={item.runtimeId} className="po-link-row">
              <span className="po-link-row__label">
                {item.packageId} · {item.kind}
              </span>
              <span className="po-link-row__hint">
                {item.lifecycle} · {item.healthy ? 'healthy' : 'not healthy'}
                {item.detail ? ` · ${item.detail}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
