/**
 * Personal Office shell — lane + card primitives.
 *
 * Progressive disclosure lives here:
 *   L1 = the card face (goal, lane, relative time, progress bar)
 *   L2 = the expanded detail, in place, no navigation (aria-expanded)
 *   L3 = an explicit labelled action that navigates ("Open workspace")
 *
 * Nothing hash-shaped, path-shaped or payload-shaped is rendered at any level;
 * the adapter already reduced those before they reached a view model.
 *
 * @module renderer/shell/WorkLane
 */

import React, { useId, useState } from 'react';
import type { Approval } from '../../shared/personal-office';
import { needsMeKind, type DeliverableView, type WorkItemView } from './types';
import { formatBytes, formatRelativeTime, formatRisk, formatState } from './format';
import { AlertIcon, CheckIcon, ChevronRightIcon } from './ShellIcons';

/* ───────────────────────────── lane ───────────────────────────── */

interface WorkLaneProps {
  readonly title: string;
  readonly count: number;
  readonly tone?: 'neutral' | 'attention' | 'done';
  readonly emptyHint: string;
  readonly children?: React.ReactNode;
}

export function WorkLane({ title, count, tone = 'neutral', emptyHint, children }: WorkLaneProps) {
  const headingId = useId();
  return (
    <section className={`po-lane po-lane--${tone}`} aria-labelledby={headingId}>
      <div className="po-lane__head">
        <h3 className="po-lane__title" id={headingId}>
          {title}
        </h3>
        {/* The count is part of the heading's accessible context, not decoration. */}
        <span className="po-lane__count" aria-label={`${count} items`}>
          {count}
        </span>
      </div>
      {count === 0 ? <p className="po-lane__empty">{emptyHint}</p> : <ul className="po-lane__list">{children}</ul>}
    </section>
  );
}

/* ─────────────────────────── progress ─────────────────────────── */

export function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="po-progress">
      <div
        className="po-progress__track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        aria-valuetext={`${done} of ${total} steps done`}
      >
        <div className="po-progress__fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="po-progress__text">
        {done}/{total} steps
      </span>
    </div>
  );
}

/* ─────────────────────────── work card ─────────────────────────── */

const NEEDS_ME_COPY: Record<'approval' | 'external' | 'paused', string> = {
  approval: 'Needs your decision',
  external: 'Waiting on an integration',
  paused: 'Paused — needs a nudge',
};

interface WorkItemCardProps {
  readonly item: WorkItemView;
  readonly onOpenWorkspace: (id: WorkItemView['workspaceId']) => void;
}

export function WorkItemCard({ item, onOpenWorkspace }: WorkItemCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const detailId = useId();
  const time = formatRelativeTime(item.updatedAt);
  const kind = needsMeKind(item.state);

  return (
    <li className="po-card">
      <div className="po-card__face">
        <div className="po-card__main">
          {/* L1: the operator's own words come first. */}
          <p className="po-card__goal">{item.goal}</p>
          <p className="po-card__meta">
            <span className="po-card__state">{formatState(item.state)}</span>
            <span aria-hidden="true"> · </span>
            <span>{item.workspaceName}</span>
            <span aria-hidden="true"> · </span>
            <time dateTime={time.machine} title={time.absolute}>
              {time.label}
            </time>
          </p>
          {kind && <p className="po-card__needs">{NEEDS_ME_COPY[kind]}</p>}
          {item.progress && <ProgressBar done={item.progress.done} total={item.progress.total} />}
        </div>

        <button
          type="button"
          className="po-card__disclose"
          onClick={() => setIsOpen((open) => !open)}
          aria-expanded={isOpen}
          aria-controls={detailId}
        >
          {/* Accessible name states what it does AND to what. */}
          <span className="po-visually-hidden">{isOpen ? 'Hide details for' : 'Show details for'} {item.goal}</span>
          <ChevronRightIcon className={`po-card__chevron ${isOpen ? 'is-open' : ''}`} />
        </button>
      </div>

      {/* L2: in place, no route change. */}
      <div className="po-card__detail" id={detailId} hidden={!isOpen}>
        {item.failureSummary && (
          <p className="po-card__failure">
            <AlertIcon className="po-card__failure-icon" />
            {item.failureSummary}
          </p>
        )}
        {item.detail && <p className="po-card__detail-line">{item.detail}</p>}
        {!item.detail && !item.failureSummary && (
          <p className="po-card__detail-line">No extra detail recorded yet.</p>
        )}
        {/* L3: explicit, labelled navigation. */}
        <button type="button" className="po-card__open" onClick={() => onOpenWorkspace(item.workspaceId)}>
          Open workspace
        </button>
      </div>
    </li>
  );
}

/* ─────────────────────────── approval card ─────────────────────────── */

interface ApprovalCardProps {
  readonly approval: Approval;
  readonly onDecide: (id: Approval['id'], decision: 'approved' | 'rejected') => void;
  readonly disabledReason?: string;
}

export function ApprovalCard({ approval, onDecide, disabledReason }: ApprovalCardProps) {
  const [isOpen, setIsOpen] = useState(false);
  const detailId = useId();

  return (
    <li className={`po-card po-card--approval po-card--risk-${approval.risk}`}>
      <div className="po-card__face">
        <div className="po-card__main">
          <p className="po-card__goal">{approval.title}</p>
          <p className="po-card__meta">
            <span className="po-card__risk">{formatRisk(approval.risk)}</span>
            <span aria-hidden="true"> · </span>
            <span>{approval.summary}</span>
          </p>
        </div>
        <button
          type="button"
          className="po-card__disclose"
          onClick={() => setIsOpen((open) => !open)}
          aria-expanded={isOpen}
          aria-controls={detailId}
        >
          <span className="po-visually-hidden">
            {isOpen ? 'Hide what this will do' : 'Show what this will do'} for {approval.title}
          </span>
          <ChevronRightIcon className={`po-card__chevron ${isOpen ? 'is-open' : ''}`} />
        </button>
      </div>

      <div className="po-card__detail" id={detailId} hidden={!isOpen}>
        {/* Renders the producer-provided, already-redacted preview fields only.
            `binding.input` is deliberately never rendered: it is typed `unknown`,
            so the shell has no safe way to display it (raised as CR-UX-03). */}
        <dl className="po-approval__preview">
          <dt>Target</dt>
          <dd>{approval.binding.target}</dd>
          <dt>Effect</dt>
          <dd>{approval.binding.estimatedSideEffect}</dd>
        </dl>
        <div className="po-approval__actions">
          <button
            type="button"
            className="po-approval__approve"
            onClick={() => onDecide(approval.id, 'approved')}
            disabled={Boolean(disabledReason)}
          >
            <CheckIcon className="po-approval__icon" />
            Approve
          </button>
          <button
            type="button"
            className="po-approval__reject"
            onClick={() => onDecide(approval.id, 'rejected')}
            disabled={Boolean(disabledReason)}
          >
            Decline
          </button>
        </div>
        {disabledReason && <p className="po-approval__blocked">{disabledReason}</p>}
      </div>
    </li>
  );
}

/* ─────────────────────────── deliverable card ─────────────────────────── */

export function DeliverableCard({ item }: { item: DeliverableView }) {
  const time = formatRelativeTime(item.createdAt);
  return (
    <li className="po-card po-card--deliverable">
      <div className="po-card__face">
        <div className="po-card__main">
          {/* fileLabel is a basename by construction — never an absolute path. */}
          <p className="po-card__goal">{item.fileLabel}</p>
          <p className="po-card__meta">
            <span>{item.mimeType}</span>
            <span aria-hidden="true"> · </span>
            <span>{formatBytes(item.sizeBytes)}</span>
            <span aria-hidden="true"> · </span>
            <time dateTime={time.machine} title={time.absolute}>
              {time.label}
            </time>
          </p>
        </div>
      </div>
    </li>
  );
}
