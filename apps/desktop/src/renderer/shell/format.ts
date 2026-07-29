/**
 * Personal Office shell — display formatting.
 *
 * Pure functions only, so they are unit-testable without a DOM. Every one
 * returns both a human label and a machine-readable value where a screen reader
 * or `<time>` element needs the precise form.
 *
 * @module renderer/shell/format
 */

import type { RunState } from '../../shared/personal-office';
import type { NeedsMeKind } from './types';

export interface RelativeTime {
  /** Short human label, e.g. "4 min ago". */
  readonly label: string;
  /** ISO string for `<time dateTime>`. */
  readonly machine: string;
  /** Full absolute form for tooltips and screen-reader detail. */
  readonly absolute: string;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Relative time that degrades gracefully on an unparseable input. */
export function formatRelativeTime(iso: string, now: number = Date.now()): RelativeTime {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) {
    return { label: 'unknown time', machine: '', absolute: 'Unknown time' };
  }

  const absolute = new Date(parsed).toLocaleString();
  const delta = now - parsed;

  if (delta < 0) return { label: 'just now', machine: iso, absolute };
  if (delta < MINUTE) return { label: 'just now', machine: iso, absolute };
  if (delta < HOUR) {
    const mins = Math.floor(delta / MINUTE);
    return { label: `${mins} min ago`, machine: iso, absolute };
  }
  if (delta < DAY) {
    const hours = Math.floor(delta / HOUR);
    return { label: `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`, machine: iso, absolute };
  }
  const days = Math.floor(delta / DAY);
  return { label: `${days} ${days === 1 ? 'day' : 'days'} ago`, machine: iso, absolute };
}

/** Human label for a run state. Plain words, no engine vocabulary. */
export function formatRunState(state: RunState): string {
  switch (state) {
    case 'created':
      return 'Starting';
    case 'queued':
      return 'Queued';
    case 'running':
      return 'Working';
    case 'awaiting_approval':
      return 'Needs your approval';
    case 'waiting_external':
      return 'Waiting on a connection';
    case 'paused':
      return 'Paused';
    case 'completed':
      return 'Delivered';
    case 'failed':
      return 'Failed';
    case 'canceled':
      return 'Canceled';
    default:
      return 'Unknown';
  }
}

/** Sub-label explaining why something sits in "Waiting for me". */
export function formatNeedsMeKind(kind: NeedsMeKind): string {
  switch (kind) {
    case 'approval':
      return 'Waiting for your decision';
    case 'external':
      return 'Blocked on a connection';
    case 'paused':
      return 'Paused, needs a nudge';
    default:
      return 'Waiting for you';
  }
}

/** Byte size in the shortest honest unit. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Risk label for an approval. */
export function formatRisk(risk: 'low' | 'medium' | 'high'): string {
  switch (risk) {
    case 'low':
      return 'Low risk';
    case 'medium':
      return 'Medium risk';
    case 'high':
      return 'High risk';
    default:
      return 'Unknown risk';
  }
}
