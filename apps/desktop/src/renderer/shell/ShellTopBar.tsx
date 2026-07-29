/**
 * Personal Office shell — top bar (the `banner` landmark).
 *
 * Deliberately does NOT render an `<h1>`: each surface owns its own page
 * heading, so the document keeps exactly one h1 and a sane heading order.
 *
 * @module renderer/shell/ShellTopBar
 */

import React from 'react';
import { MenuIcon, SearchIcon } from './ShellIcons';
import { DemoBadge } from './SurfaceState';
import type { WorkSnapshot } from './types';

/**
 * Plain-language health line.
 *
 * Ordered by what the operator can act on: connectivity first, then failures,
 * then normal progress. Never surfaces an error object.
 */
function healthCopy(snapshot: WorkSnapshot): { tone: string; text: string } {
  if (snapshot.isOffline) return { tone: 'offline', text: 'Offline' };
  if (snapshot.status === 'error') return { tone: 'error', text: 'Needs attention' };
  if (snapshot.status === 'degraded') return { tone: 'warn', text: 'Partly available' };
  if (snapshot.attention.length > 0) {
    return { tone: 'warn', text: `${snapshot.attention.length} need${snapshot.attention.length === 1 ? 's' : ''} a look` };
  }
  if (snapshot.status === 'loading') return { tone: 'idle', text: 'Loading' };
  if (snapshot.active.length > 0) return { tone: 'ok', text: `${snapshot.active.length} running` };
  return { tone: 'idle', text: 'Idle' };
}

interface ShellTopBarProps {
  readonly title: string;
  readonly snapshot: WorkSnapshot;
  /** Only rendered at narrow widths, where the sidebar collapses to a sheet. */
  readonly showMenuButton: boolean;
  readonly onOpenNav: () => void;
  readonly onOpenPalette: () => void;
}

export function ShellTopBar({
  title,
  snapshot,
  showMenuButton,
  onOpenNav,
  onOpenPalette,
}: ShellTopBarProps) {
  const health = healthCopy(snapshot);

  return (
    <header className="po-topbar" role="banner">
      {showMenuButton && (
        <button
          type="button"
          className="po-topbar__icon-button"
          onClick={onOpenNav}
          aria-label="Open navigation"
          title="Open navigation"
        >
          <MenuIcon className="po-topbar__icon" />
        </button>
      )}

      <p className="po-topbar__title">{title}</p>

      {snapshot.isDemo && <DemoBadge />}

      <span className="po-topbar__spacer" />

      {/*
        Health is a live region so a change in run health is announced without
        stealing focus. `polite` because it is ambient, not urgent — urgent
        approvals get their own assertive region on Today.
      */}
      <p className={`po-topbar__health po-topbar__health--${health.tone}`} role="status" aria-live="polite">
        <span className="po-topbar__health-dot" aria-hidden="true" />
        {health.text}
      </p>

      <button
        type="button"
        className="po-topbar__search"
        onClick={onOpenPalette}
        aria-label="Search commands and workspaces"
        title="Search commands and workspaces"
      >
        <SearchIcon className="po-topbar__icon" />
        <span className="po-topbar__search-label">Search</span>
        <kbd className="po-topbar__kbd">Ctrl K</kbd>
      </button>
    </header>
  );
}
