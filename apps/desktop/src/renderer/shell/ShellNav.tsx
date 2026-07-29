/**
 * Personal Office shell — navigation.
 *
 * Two presentations of the same five routes:
 *
 *   - `ShellSidebar` for desktop. Collapses to an icon rail between 900px and
 *     1279px, where each button keeps its accessible name and a tooltip.
 *   - `ShellSheetNav` for narrow/mobile. A full-screen sheet, NOT a squeezed
 *     mini-rail: at 390px a rail leaves no room for a legible label and forces
 *     sub-44px targets.
 *
 * @module renderer/shell/ShellNav
 */

import React, { useCallback, useEffect, useRef } from 'react';
import {
  KnowledgeIcon,
  MarketplaceIcon,
  OverviewIcon,
  PlanningIcon,
  SettingsIcon,
} from '../components/AppIcons';
import { CloseIcon } from './ShellIcons';
import { TOP_LEVEL_ROUTES, type ShellRoute, type ShellView } from './types';

const ROUTE_ICONS: Readonly<Record<ShellRoute, React.ComponentType<{ className?: string }>>> =
  Object.freeze({
    today: OverviewIcon,
    workspaces: PlanningIcon,
    mygraph: KnowledgeIcon,
    market: MarketplaceIcon,
    settings: SettingsIcon,
  });

/** A workspace sub-view still marks Workspaces as the current section. */
function isRouteCurrent(route: ShellRoute, view: ShellView): boolean {
  if (route === 'workspaces') return view === 'workspaces' || view === 'workspace';
  return route === view;
}

interface NavListProps {
  readonly view: ShellView;
  readonly onNavigate: (route: ShellRoute) => void;
  readonly variant: 'sidebar' | 'sheet';
}

function NavList({ view, onNavigate, variant }: NavListProps) {
  return (
    <ul className={`po-nav__list po-nav__list--${variant}`}>
      {TOP_LEVEL_ROUTES.map((route) => {
        const Icon = ROUTE_ICONS[route.id];
        const current = isRouteCurrent(route.id, view);
        return (
          <li key={route.id}>
            <button
              type="button"
              className={`po-nav__item${current ? ' is-current' : ''}`}
              // aria-current is how a screen reader knows which surface is open;
              // the highlight alone is invisible to it.
              aria-current={current ? 'page' : undefined}
              // The label survives the icon-rail collapse, where the text is
              // visually hidden but the button must still be nameable.
              aria-label={route.label}
              title={route.label}
              onClick={() => onNavigate(route.id)}
            >
              <span className="po-nav__icon" aria-hidden="true">
                <Icon className="po-nav__icon-svg" />
              </span>
              <span className="po-nav__label">{route.label}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

interface ShellSidebarProps {
  readonly view: ShellView;
  readonly onNavigate: (route: ShellRoute) => void;
}

export function ShellSidebar({ view, onNavigate }: ShellSidebarProps) {
  return (
    <nav className="po-nav po-nav--sidebar" aria-label="Primary">
      <div className="po-nav__brand">
        <span className="po-nav__brand-mark" aria-hidden="true" />
        <span className="po-nav__brand-text">Personal Office</span>
      </div>
      <NavList view={view} onNavigate={onNavigate} variant="sidebar" />
    </nav>
  );
}

interface ShellSheetNavProps {
  readonly view: ShellView;
  readonly isOpen: boolean;
  readonly onNavigate: (route: ShellRoute) => void;
  readonly onClose: () => void;
}

/**
 * Full-screen navigation sheet for narrow viewports.
 *
 * Focus is trapped while open and restored to the trigger on close, so keyboard
 * and screen-reader users cannot tab into the content behind an opaque overlay.
 */
export function ShellSheetNav({ view, isOpen, onNavigate, onClose }: ShellSheetNavProps) {
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    restoreRef.current = document.activeElement as HTMLElement | null;
    const first = sheetRef.current?.querySelector<HTMLElement>('button');
    first?.focus();
    return () => {
      restoreRef.current?.focus?.();
    };
  }, [isOpen]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = sheetRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  if (!isOpen) return null;

  return (
    <div className="po-sheet" role="presentation" onKeyDown={handleKeyDown}>
      <div className="po-sheet__backdrop" role="presentation" onMouseDown={onClose} />
      <div
        className="po-sheet__panel"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        ref={sheetRef}
      >
        <div className="po-sheet__head">
          <span className="po-sheet__title">Go to</span>
          <button type="button" className="po-icon-btn" aria-label="Close navigation" title="Close navigation" onClick={onClose}>
            <CloseIcon className="po-icon-btn__svg" />
          </button>
        </div>
        <nav aria-label="Primary">
          <NavList
            view={view}
            onNavigate={(route) => {
              onNavigate(route);
              onClose();
            }}
            variant="sheet"
          />
        </nav>
      </div>
    </div>
  );
}
