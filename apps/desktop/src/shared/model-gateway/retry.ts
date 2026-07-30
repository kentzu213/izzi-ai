import type { ModelEndpointClass, ModelRouteRetryPolicy } from './contracts';

export const FIXED_PRICE_STREAMING_LIMITATION =
  'Streaming is temporarily unavailable for fixed-price models; retry with stream=false.';
export const MODEL_STREAMING_TEMPORARILY_UNAVAILABLE =
  'streaming temporarily unavailable for this model';

const EXACT_STREAMING_LIMITATIONS = new Set([
  FIXED_PRICE_STREAMING_LIMITATION,
  MODEL_STREAMING_TEMPORARILY_UNAVAILABLE,
]);

function errorMessageFromJson(rawBody: string): string | null {
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const error = (parsed as Record<string, unknown>).error;
    if (!error || typeof error !== 'object' || Array.isArray(error)) return null;
    const message = (error as Record<string, unknown>).message;
    return typeof message === 'string' ? message : null;
  } catch {
    return null;
  }
}

/** Only exact known JSON error messages permit the sole retry. */
export function isExactStreamingLimitation(status: number, rawBody: string): boolean {
  if (status !== 400) return false;
  const message = errorMessageFromJson(rawBody);
  return message !== null && EXACT_STREAMING_LIMITATIONS.has(message);
}

export function retryPolicyForEndpointClass(
  endpointClass: ModelEndpointClass,
): ModelRouteRetryPolicy {
  return endpointClass === 'official-izzi-https'
    ? 'same-route-exact-streaming-limitation-once'
    : 'none';
}

/** Clone only the stream flag. Every other payload field retains identity. */
export function createNonStreamingRetryPayload<T extends { stream: boolean }>(
  payload: T,
): (Omit<T, 'stream'> & { stream: false }) | null {
  if (payload.stream !== true) return null;
  return { ...payload, stream: false };
}
