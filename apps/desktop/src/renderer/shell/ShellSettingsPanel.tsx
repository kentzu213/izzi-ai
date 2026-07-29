/**
 * Personal Office shell — Settings surface.
 *
 * Holds three things and nothing else:
 *   1. the rollback control for the shell flag (so a user is never trapped);
 *   2. the legacy surface index — every pre-Loop-02 page, still reachable;
 *   3. the setup groups that must NOT become workspace tabs.
 *
 * The legacy index is the reason nothing was deleted. AI Marketing and Phòng
 * Marketing appear here as two entries in one Marketing group, which is exactly
 * the shape the IA requires: catalogued, not peers in the primary nav.
 *
 * @module renderer/shell/ShellSettingsPanel
 */

import React from 'react';
import { LEGACY_GROUPS, SETUP_GROUPS, type LegacyPageId } from './legacySurfaces';
import { ChevronRightIcon } from './ShellIcons';
import { RuntimeHealthPanel } from './RuntimeHealthPanel';

interface ShellSettingsPanelProps {
  /**
   * Opens a legacy surface inside the shell. Takes the page id, not the whole
   * descriptor: the store's `openLegacy` is keyed by `LegacyPageId`, so passing
   * the id is the one typed API and needs no unwrapping at the call site.
   */
  readonly onOpenLegacy: (page: LegacyPageId) => void;
  /**
   * Rollback to the legacy sidebar shell. Owned by App.tsx, because only the
   * mount point can clear the flag *and* re-render the old layout.
   */
  readonly onDisableShell: () => void;
  /** The existing Settings page, rendered by App.tsx inside this panel. */
  readonly children?: React.ReactNode;
}

export function ShellSettingsPanel({
  onOpenLegacy,
  onDisableShell,
  children,
}: ShellSettingsPanelProps) {
  return (
    <section className="po-surface" aria-labelledby="po-settings-heading">
      <header className="po-surface__head">
        <h1 id="po-settings-heading" className="po-surface__title">
          Settings
        </h1>
        <p className="po-surface__subtitle">Setup, runtime and everything that is not daily work</p>
      </header>

      <div className="po-settings">
        <section className="po-panel" aria-labelledby="po-settings-shell">
          <h2 id="po-settings-shell" className="po-panel__title">
            Shell
          </h2>
          <p className="po-panel__text">
            You are using the Personal Office shell. Switching back keeps every page and all your
            data — only the navigation changes.
          </p>
          <button type="button" className="po-btn po-btn--quiet" onClick={onDisableShell}>
            Switch to the classic shell
          </button>
        </section>

        <section className="po-panel">
          <RuntimeHealthPanel />
        </section>

        {SETUP_GROUPS.map((group) => (
          <section
            key={group.id}
            className="po-panel"
            aria-labelledby={`po-setup-group-${group.id}`}
          >
            <h2 id={`po-setup-group-${group.id}`} className="po-panel__title">
              {group.label}
            </h2>
            <p className="po-panel__text">{group.description}</p>
            <ul className="po-link-list">
              {group.surfaces.map((surface) => (
                <li key={surface.id}>
                  <button
                    type="button"
                    className="po-link-row"
                    onClick={() => onOpenLegacy(surface.id)}
                  >
                    <span className="po-link-row__label">{surface.label}</span>
                    <span className="po-link-row__hint">{surface.description}</span>
                    <ChevronRightIcon className="po-link-row__chevron" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}

        {LEGACY_GROUPS.map((group) => (
          <section
            key={group.id}
            className="po-panel"
            aria-labelledby={`po-legacy-group-${group.id}`}
          >
            <h2 id={`po-legacy-group-${group.id}`} className="po-panel__title">
              {group.label}
            </h2>
            <p className="po-panel__text">{group.description}</p>
            <ul className="po-link-list">
              {group.surfaces.map((surface) => (
                <li key={surface.id}>
                  <button
                    type="button"
                    className="po-link-row"
                    onClick={() => onOpenLegacy(surface.id)}
                  >
                    <span className="po-link-row__label">{surface.label}</span>
                    <span className="po-link-row__hint">{surface.description}</span>
                    <ChevronRightIcon className="po-link-row__chevron" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}

        {children && (
          <section className="po-panel" aria-labelledby="po-settings-account">
            <h2 id="po-settings-account" className="po-panel__title">
              Account and preferences
            </h2>
            <div className="po-embed">{children}</div>
          </section>
        )}
      </div>
    </section>
  );
}
