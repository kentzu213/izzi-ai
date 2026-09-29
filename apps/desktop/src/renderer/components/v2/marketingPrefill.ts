/*
 * Home → Agent Marketing (M3 capability routing). Home offers its text as a
 * neutral prefill for the existing Director textarea: it is only typed in,
 * never submitted, so no plan, run or project is created and no V2 project is
 * mapped to Marketing.
 *
 * RAM only, module-level so it survives the Home unmount on navigation. At
 * most one offer is pending; a newer offer, an edit on Home or an account
 * switch/logout drops it together with its callback, so a stale or remounted
 * caller can never clear the Home draft or leak text into another account.
 */

interface PendingPrefill {
  text: string;
  onConsumed: () => void;
}

let pending: PendingPrefill | null = null;

/** Replaces any pending offer. Empty text is refused and offers nothing. */
export function offerMarketingPrefill(text: string, onConsumed: () => void): boolean {
  if (!text.trim()) {
    pending = null;
    return false;
  }
  pending = { text, onConsumed };
  return true;
}

/**
 * Hands the pending text to the Director textarea exactly once. The offer's
 * callback (Home clears its draft) runs only now, so the draft is kept until
 * the text has actually arrived.
 */
export function consumeMarketingPrefill(): string | null {
  const offer = pending;
  if (!offer) return null;
  pending = null;
  offer.onConsumed();
  return offer.text;
}

/** Drops the pending offer without running its callback. */
export function cancelMarketingPrefill(): void {
  pending = null;
}
