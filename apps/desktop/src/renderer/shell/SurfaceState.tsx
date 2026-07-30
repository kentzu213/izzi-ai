/**
 * Personal Office shell — the interaction states every surface must implement.
 *
 * Two distinct mechanisms, deliberately not merged:
 *
 *   - `SurfaceState` REPLACES content (loading / empty / error). There is
 *     nothing useful to show, so the surface shows why.
 *   - `SurfaceNotice` sits ABOVE content (offline / degraded). The data is still
 *     worth reading, so it stays readable and the banner says what is wrong.
 *
 * Collapsing these would force a choice between hiding usable data and hiding
 * the warning. Both are wrong.
 *
 * @module renderer/shell/SurfaceState
 */

import React from 'react';
import { AlertIcon, InboxIcon, OfflineIcon } from './ShellIcons';

/** Skeleton silhouettes, chosen to match the real layout so nothing jumps. */
export type SkeletonShape = 'lanes' | 'list' | 'block';

interface SurfaceStateProps {
  readonly kind: 'loading' | 'empty' | 'error';
  /** Required for empty/error. Loading is announced, not titled. */
  readonly title?: string;
  readonly description?: string;
  readonly skeleton?: SkeletonShape;
  /** The single action that resolves this state. */
  readonly action?: { readonly label: string; readonly onClick: () => void };
}

function Skeleton({ shape }: { readonly shape: SkeletonShape }) {
  if (shape === 'lanes') {
    return (
      <div className="po-skeleton po-skeleton--lanes">
        {[0, 1, 2].map((lane) => (
          <div className="po-skeleton__lane" key={lane}>
            <span className="po-skeleton__bar po-skeleton__bar--head" />
            <span className="po-skeleton__bar" />
            <span className="po-skeleton__bar po-skeleton__bar--short" />
          </div>
        ))}
      </div>
    );
  }
  if (shape === 'list') {
    return (
      <div className="po-skeleton po-skeleton--list">
        {[0, 1, 2, 3].map((row) => (
          <span className="po-skeleton__bar" key={row} />
        ))}
      </div>
    );
  }
  return (
    <div className="po-skeleton po-skeleton--block">
      <span className="po-skeleton__bar po-skeleton__bar--head" />
      <span className="po-skeleton__bar" />
      <span className="po-skeleton__bar po-skeleton__bar--short" />
    </div>
  );
}

/**
 * Content-replacing state.
 *
 * Loading uses `aria-busy` + a polite live region rather than a visual-only
 * spinner, so a screen-reader user is told the surface is working.
 */
export function SurfaceState({ kind, title, description, skeleton, action }: SurfaceStateProps) {
  if (kind === 'loading') {
    return (
      <div className="po-state po-state--loading" aria-busy="true">
        <p className="po-state__live" role="status">
          Loading…
        </p>
        <Skeleton shape={skeleton ?? 'block'} />
      </div>
    );
  }

  const isError = kind === 'error';
  return (
    <div className={`po-state po-state--${kind}`} role={isError ? 'alert' : undefined}>
      <span className="po-state__icon" aria-hidden="true">
        {isError ? <AlertIcon className="po-state__icon-svg" /> : <InboxIcon className="po-state__icon-svg" />}
      </span>
      <div className="po-state__body">
        <p className="po-state__title">{title}</p>
        {description ? <p className="po-state__description">{description}</p> : null}
      </div>
      {action ? (
        <button type="button" className="po-btn po-btn--primary" onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

interface SurfaceNoticeProps {
  readonly kind: 'offline' | 'degraded';
  /** For degraded: name the part that is broken, not just "something failed". */
  readonly message: string;
  readonly action?: { readonly label: string; readonly onClick: () => void };
}

/**
 * Content-preserving banner.
 *
 * `role="status"` (polite) rather than `alert`: connectivity changes should not
 * interrupt what the operator is reading mid-sentence.
 */
export function SurfaceNotice({ kind, message, action }: SurfaceNoticeProps) {
  return (
    <div className={`po-notice po-notice--${kind}`} role="status">
      <span className="po-notice__icon" aria-hidden="true">
        {kind === 'offline' ? (
          <OfflineIcon className="po-notice__icon-svg" />
        ) : (
          <AlertIcon className="po-notice__icon-svg" />
        )}
      </span>
      <p className="po-notice__message">{message}</p>
      {action ? (
        <button type="button" className="po-btn po-btn--quiet" onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Demo marker.
 *
 * Non-negotiable wherever fabricated data renders: passing demo runs off as real
 * work would make the whole surface untrustworthy. Carries a text label, not
 * just a colour, so it survives greyscale and screenshots.
 */
export function DemoBadge() {
  return (
    <span className="po-demo-badge" title="Sample data, not real work">
      Demo data
    </span>
  );
}
