/**
 * Personal Office shell — delegate composer.
 *
 * The primary action of the whole product: type a goal, hand it over.
 *
 * Kept to ONE field on purpose. The acceptance criterion is "launch to a
 * delegated brief in at most two actions", and Today is the default route, so
 * this must be action #1 and #2 (type, submit). No workspace picker, no model
 * picker, no stage picker — those are progressive-disclosure L2/L3 concerns.
 *
 * @module renderer/shell/DelegateComposer
 */

import React, { useId, useState } from 'react';
import { SendIcon } from './ShellIcons';

interface DelegateComposerProps {
  readonly onDelegate: (goal: string) => Promise<boolean>;
  readonly isBusy: boolean;
  /** When set, delegation is impossible and this explains why (offline, no engine). */
  readonly disabledReason?: string;
}

export function DelegateComposer({ onDelegate, isBusy, disabledReason }: DelegateComposerProps) {
  const [goal, setGoal] = useState('');
  const [feedback, setFeedback] = useState<string | null>(null);
  const hintId = useId();
  const statusId = useId();
  const isDisabled = Boolean(disabledReason) || isBusy;

  async function submit() {
    const trimmed = goal.trim();
    if (!trimmed || isDisabled) return;
    const ok = await onDelegate(trimmed);
    if (ok) {
      setGoal('');
      setFeedback('Delegated. It will show up in Active work.');
    } else {
      setFeedback('Could not delegate that. Nothing was sent.');
    }
  }

  /**
   * Ctrl/Cmd+Enter submits; plain Enter inserts a newline. A goal is often more
   * than one line, and losing a half-typed brief to a stray Enter is worse than
   * requiring a modifier.
   */
  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void submit();
    }
  }

  return (
    <section className="po-composer" aria-labelledby={`${hintId}-label`}>
      <h2 className="po-composer__label" id={`${hintId}-label`}>
        Delegate something
      </h2>

      <div className="po-composer__row">
        <textarea
          className="po-composer__input"
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="What should get done?"
          rows={2}
          aria-describedby={`${hintId} ${statusId}`}
          disabled={Boolean(disabledReason)}
        />
        <button
          type="button"
          className="po-composer__submit"
          onClick={() => void submit()}
          disabled={isDisabled || goal.trim().length === 0}
        >
          <SendIcon className="po-composer__submit-icon" />
          {isBusy ? 'Delegating…' : 'Delegate'}
        </button>
      </div>

      <p className="po-composer__hint" id={hintId}>
        {disabledReason ?? 'Ctrl or Cmd + Enter to delegate.'}
      </p>

      {/* Announces the outcome without moving focus away from the field. */}
      <p className="po-composer__status" id={statusId} role="status" aria-live="polite">
        {feedback ?? ''}
      </p>
    </section>
  );
}
