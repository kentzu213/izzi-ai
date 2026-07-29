/**
 * Personal Office shell — the few glyphs the shell needs that `AppIcons` lacks.
 *
 * Same conventions as `components/AppIcons.tsx`: `currentColor`, a `className`
 * hook for sizing, and `aria-hidden` so the glyph is never announced. Every
 * icon-only control supplies its own accessible name; the glyph is decoration.
 *
 * @module renderer/shell/ShellIcons
 */

import React from 'react';

type IconProps = { className?: string };

function Stroke({ children, className }: React.PropsWithChildren<IconProps>) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export function MenuIcon({ className }: IconProps) {
  return (
    <Stroke className={className}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Stroke>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <Stroke className={className}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </Stroke>
  );
}

export function CloseIcon({ className }: IconProps) {
  return (
    <Stroke className={className}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Stroke>
  );
}

export function ChevronRightIcon({ className }: IconProps) {
  return (
    <Stroke className={className}>
      <path d="m9 5 7 7-7 7" />
    </Stroke>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <Stroke className={className}>
      <path d="m4 12.5 5 5L20 6.5" />
    </Stroke>
  );
}

export function AlertIcon({ className }: IconProps) {
  return (
    <Stroke className={className}>
      <path d="M12 4.5 21 20H3L12 4.5Z" />
      <path d="M12 10v4.5" />
      <path d="M12 17.4v.2" />
    </Stroke>
  );
}

export function OfflineIcon({ className }: IconProps) {
  return (
    <Stroke className={className}>
      <path d="M3 3l18 18" />
      <path d="M8.5 15.5a5 5 0 0 1 7 0" />
      <path d="M5 12a10 10 0 0 1 3-2.1" />
      <path d="M19 12a10 10 0 0 0-6.5-2.9" />
    </Stroke>
  );
}

export function InboxIcon({ className }: IconProps) {
  return (
    <Stroke className={className}>
      <path d="M4 13h4l1.5 3h5L16 13h4" />
      <path d="M4 13 6.5 6h11L20 13v5H4v-5Z" />
    </Stroke>
  );
}

export function SendIcon({ className }: IconProps) {
  return (
    <Stroke className={className}>
      <path d="M4.5 12 20 5l-6.5 15L11 14l-6.5-2Z" />
    </Stroke>
  );
}

export function SlidersIcon({ className }: IconProps) {
  return (
    <Stroke className={className}>
      <path d="M5 7h14M5 12h14M5 17h14" />
      <circle cx="9" cy="7" r="2" />
      <circle cx="15" cy="12" r="2" />
      <circle cx="8" cy="17" r="2" />
    </Stroke>
  );
}
