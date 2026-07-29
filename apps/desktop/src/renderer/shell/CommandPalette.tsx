/**
 * Personal Office shell — command palette (Ctrl/Cmd+K, or `/`).
 *
 * Accessibility notes, since this is the one component W0 called out:
 *
 *   - The dialog is `aria-modal` and focus is TRAPPED: Tab and Shift+Tab cycle
 *     inside the panel only, so a keyboard user can never land on the content
 *     behind an opaque overlay while it is open.
 *   - Focus is restored to whatever opened the palette on close.
 *   - The input is a `combobox` owning a `listbox`; the active option is pointed
 *     at with `aria-activedescendant` rather than moving DOM focus, which is what
 *     lets the user keep typing while arrowing through results.
 *   - The result count is announced politely, so filtering is not silent.
 *
 * @module renderer/shell/CommandPalette
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SearchIcon } from './ShellIcons';

export interface PaletteCommand {
  readonly id: string;
  readonly label: string;
  readonly group: string;
  /** Extra terms to match on that are not in the visible label. */
  readonly keywords?: readonly string[];
  readonly hint?: string;
  run(): void;
}

/**
 * Pure filter, exported so it is unit-testable without a DOM.
 *
 * Matches on the label, the group and any keywords, all case-insensitively.
 */
export function filterCommands(
  commands: readonly PaletteCommand[],
  query: string,
): readonly PaletteCommand[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return commands;
  const terms = trimmed.split(/\s+/);
  return commands.filter((command) => {
    const haystack = [command.label, command.group, ...(command.keywords ?? [])]
      .join(' ')
      .toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}

const FOCUSABLE =
  'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

interface CommandPaletteProps {
  readonly isOpen: boolean;
  readonly commands: readonly PaletteCommand[];
  readonly onClose: () => void;
}

export function CommandPalette({ isOpen, commands, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  const results = useMemo(() => filterCommands(commands, query), [commands, query]);

  // Reset per opening, and remember where focus came from.
  useEffect(() => {
    if (!isOpen) return undefined;
    restoreRef.current = document.activeElement as HTMLElement | null;
    setQuery('');
    setActiveIndex(0);
    inputRef.current?.focus();
    return () => {
      restoreRef.current?.focus?.();
    };
  }, [isOpen]);

  // Keep the pointer inside the (possibly shrunken) result set.
  useEffect(() => {
    setActiveIndex((current) => (current >= results.length ? 0 : current));
  }, [results.length]);

  const runAt = useCallback(
    (index: number) => {
      const command = results[index];
      if (!command) return;
      onClose();
      command.run();
    },
    [results, onClose],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          onClose();
          return;
        case 'ArrowDown':
          event.preventDefault();
          setActiveIndex((current) => (results.length === 0 ? 0 : (current + 1) % results.length));
          return;
        case 'ArrowUp':
          event.preventDefault();
          setActiveIndex((current) =>
            results.length === 0 ? 0 : (current - 1 + results.length) % results.length,
          );
          return;
        case 'Home':
          event.preventDefault();
          setActiveIndex(0);
          return;
        case 'End':
          event.preventDefault();
          setActiveIndex(Math.max(0, results.length - 1));
          return;
        case 'Enter':
          event.preventDefault();
          runAt(activeIndex);
          return;
        case 'Tab': {
          // Focus trap: cycle within the panel instead of escaping behind it.
          const focusable = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
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
          return;
        }
        default:
          return;
      }
    },
    [activeIndex, onClose, results.length, runAt],
  );

  if (!isOpen) return null;

  // Group for display while keeping one flat keyboard index across all groups.
  const groups: { group: string; items: { command: PaletteCommand; index: number }[] }[] = [];
  results.forEach((command, index) => {
    const bucket = groups.find((entry) => entry.group === command.group);
    if (bucket) bucket.items.push({ command, index });
    else groups.push({ group: command.group, items: [{ command, index }] });
  });

  const activeId = results[activeIndex] ? `po-cmd-${results[activeIndex].id}` : undefined;

  return (
    <div className="po-palette" role="presentation" onKeyDown={handleKeyDown}>
      <div className="po-palette__backdrop" role="presentation" onMouseDown={onClose} />
      <div
        className="po-palette__panel"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        ref={panelRef}
      >
        <div className="po-palette__field">
          <SearchIcon className="po-palette__field-icon" />
          <input
            ref={inputRef}
            type="text"
            className="po-palette__input"
            placeholder="Search commands and workspaces"
            aria-label="Search commands and workspaces"
            role="combobox"
            aria-expanded="true"
            aria-controls="po-palette-results"
            aria-activedescendant={activeId}
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>

        <ul className="po-palette__results" id="po-palette-results" role="listbox" aria-label="Results">
          {groups.map((entry) => (
            <li key={entry.group} role="presentation">
              <p className="po-palette__group" role="presentation">
                {entry.group}
              </p>
              <ul role="presentation">
                {entry.items.map(({ command, index }) => (
                  <li
                    key={command.id}
                    id={`po-cmd-${command.id}`}
                    role="option"
                    aria-selected={index === activeIndex}
                    className={`po-palette__option${index === activeIndex ? ' is-active' : ''}`}
                    // Pointer parity with the keyboard path. Mouse users get the
                    // same activation; `onMouseDown` would fire before the input
                    // blur and fight the focus trap.
                    onClick={() => runAt(index)}
                    onMouseEnter={() => setActiveIndex(index)}
                  >
                    <span className="po-palette__option-label">{command.label}</span>
                    {command.hint && <span className="po-palette__option-hint">{command.hint}</span>}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>

        {results.length === 0 && <p className="po-palette__empty">No matching command.</p>}

        <p className="po-palette__status" role="status" aria-live="polite">
          {results.length} result{results.length === 1 ? '' : 's'}
        </p>
      </div>
    </div>
  );
}
