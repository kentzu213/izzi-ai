export const LOCAL_COCKPIT_BASE_URL = 'http://127.0.0.1:51226/v1';
export const LOCAL_COCKPIT_MODEL = 'gpt-5.6-sol';
export const LOCAL_COCKPIT_REASONING_EFFORT = 'high' as const;
export const LOCAL_COCKPIT_LABEL = 'Cockpit (local)';

// True only for the canonical loopback gateway. Key self-healing reads the
// Cockpit state file, so it must never run against a third-party endpoint.
export function isLocalCockpitBaseUrl(baseUrl: string | undefined | null): boolean {
  if (typeof baseUrl !== 'string') return false;
  return baseUrl.trim().replace(/\/+$/, '') === LOCAL_COCKPIT_BASE_URL;
}
