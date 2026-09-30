/**
 * Calls the `graph:openMyGraphWeb` IPC and reports the outcome instead of leaving a floating
 * promise (ledger #23). A rejection is logged (error name only, never the raw Error) and turned
 * into `false`; it is never re-thrown into an unhandled rejection, and never silently dropped.
 */
export type OpenMyGraphWebIpc = () => Promise<{ ok: boolean; url?: string }>;

export async function openMyGraphWebSafely(open: OpenMyGraphWebIpc | undefined): Promise<boolean> {
  if (!open) {
    console.warn('[MyGraph] graph.openMyGraphWeb bridge is unavailable');
    return false;
  }
  try {
    const result = await open();
    if (result?.ok === true) return true;
    console.warn('[MyGraph] openMyGraphWeb returned a non-ok result');
    return false;
  } catch (err) {
    // Log only the error name: the message or stack can carry a URL, path or main-side detail.
    const name = err instanceof Error ? (err.name || 'Error').slice(0, 50) : 'error';
    console.error(`[MyGraph] openMyGraphWeb failed: ${name}`);
    return false;
  }
}

/**
 * Race guard for the page's "open on web" state (ledger #23). `begin()` is called per click and
 * returns a check that is true only while the page is mounted and that click is still the latest,
 * so a slow earlier click or a result after unmount cannot overwrite the visible state.
 * `setMounted(true)` runs in the effect body too, because StrictMode mounts, cleans up and remounts.
 */
export function createOpenWebGuard() {
  let latest = 0;
  let mounted = true;
  return {
    setMounted(value: boolean): void {
      mounted = value;
    },
    begin(): () => boolean {
      const id = ++latest;
      return () => mounted && id === latest;
    },
  };
}
