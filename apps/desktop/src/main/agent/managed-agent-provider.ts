import axios from 'axios';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ModelRouteResolutionError,
  createNonStreamingRetryPayload,
  hasAsciiControlCharacter,
  isExactStreamingLimitation,
  type ModelEndpointClass,
} from '../../shared/model-gateway';
import type { ChatProvider } from './chat-provider';
import { buildIzziRequestHeaders } from './izzi-request-headers';
import { readStreamBody, streamOpenAISse } from './openai-sse';
import { parseOpenAICompatibleEndpoint } from './provider-settings-store';
import { parseManagedAgentStream } from './stream-parser';
import type {
  ManagedAgentStatus,
  ManagedAgentStreamRequest,
  ManagedProviderStreamChunk,
} from './types';

const DEFAULT_MODEL = 'izzi-smart';
const DEFAULT_MANAGED_BASE_URL = 'https://api.izziapi.com/v1';
const REQUEST_TIMEOUT_MS = 120000;

/** Normalize legacy UI aliases while preserving every explicit model id. */
export function normalizeManagedModel(model: string | null | undefined): string {
  const value = model?.trim();
  if (!value || value === 'izzi/auto' || value === 'izzi-auto' || value === 'auto') {
    return DEFAULT_MODEL;
  }
  return value;
}

const MOCK_AGENT_MODE =
  process.env.STARIZZI_MOCK_AGENT_MODE === 'true'
  || process.env.STARIZZI_MOCK_AGENT_MODE === '1';

interface LocalManagedConfig {
  readonly apiKey: string | null;
  readonly baseUrl: string | null;
  readonly model: string | null;
}

type LocalManagedConfigResult =
  | { readonly ok: true; readonly config: LocalManagedConfig }
  | { readonly ok: false };

interface ManagedRequestSnapshot {
  readonly apiKey: string | null;
  readonly chatCompletionsUrl: string;
  readonly endpointOrigin: string;
  readonly endpointClass: Extract<ModelEndpointClass, 'official-izzi-https'>;
  readonly modelId: string;
}

export interface ManagedRequestRoute {
  readonly provider: ChatProvider;
  readonly endpointOrigin: string;
  readonly endpointClass: Extract<ModelEndpointClass, 'official-izzi-https'>;
  readonly modelId: string;
}

/**
 * Read local ~/.openclaw/openclaw.json once for a request-scoped route.
 * Gateway auth is deliberately ignored; only the model-provider credential is
 * eligible for the direct Izzi API request.
 */
function getLocalConfig(): LocalManagedConfigResult {
  try {
    const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
    if (!fs.existsSync(configPath)) {
      return {
        ok: true,
        config: { apiKey: null, baseUrl: null, model: null },
      };
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as {
      apiKey?: unknown;
      models?: {
        providers?: {
          ninerouter?: {
            apiKey?: unknown;
            baseUrl?: unknown;
          };
        };
      };
      agents?: {
        defaults?: {
          model?: {
            primary?: unknown;
          };
        };
      };
    };
    const ninerouter = config?.models?.providers?.ninerouter;
    if (
      (ninerouter?.baseUrl !== undefined && typeof ninerouter.baseUrl !== 'string')
      || (
        config?.agents?.defaults?.model?.primary !== undefined
        && typeof config.agents.defaults.model.primary !== 'string'
      )
    ) {
      return { ok: false };
    }

    const apiKey = typeof ninerouter?.apiKey === 'string' && ninerouter.apiKey.length > 0
      ? ninerouter.apiKey
      : typeof config?.apiKey === 'string' && config.apiKey.length > 0
        ? config.apiKey
        : null;
    const baseUrl = typeof ninerouter?.baseUrl === 'string' ? ninerouter.baseUrl : null;
    const primaryModel = config?.agents?.defaults?.model?.primary;
    const model = typeof primaryModel === 'string' ? primaryModel : null;

    return {
      ok: true,
      config: { apiKey, baseUrl, model },
    };
  } catch {
    return { ok: false };
  }
}

function createManagedRequestSnapshot(mockMode: boolean): ManagedRequestSnapshot {
  const result: LocalManagedConfigResult = mockMode
    ? {
        ok: true,
        config: {
          apiKey: null,
          baseUrl: DEFAULT_MANAGED_BASE_URL,
          model: DEFAULT_MODEL,
        },
      }
    : getLocalConfig();
  if (!result.ok) {
    throw new ModelRouteResolutionError('managed-config-invalid');
  }

  const config = result.config;
  const endpoint = parseOpenAICompatibleEndpoint(config.baseUrl ?? DEFAULT_MANAGED_BASE_URL);
  if (!endpoint || endpoint.endpointClass !== 'official-izzi-https') {
    throw new ModelRouteResolutionError('managed-endpoint-invalid');
  }

  const modelId = normalizeManagedModel(config.model);
  if (modelId.length > 200 || hasAsciiControlCharacter(modelId)) {
    throw new ModelRouteResolutionError('managed-model-invalid');
  }

  return Object.freeze({
    apiKey: config.apiKey,
    chatCompletionsUrl: endpoint.chatCompletionsUrl,
    endpointOrigin: endpoint.origin,
    endpointClass: 'official-izzi-https',
    modelId,
  });
}

function buildOpenAIPayload(
  request: ManagedAgentStreamRequest,
  modelId: string,
  stream: boolean,
) {
  const messages = [
    ...request.history.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    {
      role: 'user' as const,
      content: request.message,
    },
  ];

  return {
    model: modelId,
    messages,
    stream,
  };
}

function managedHttpError(status: number): Error {
  if (status === 401 || status === 403) {
    return new Error(`Managed provider authentication failed (HTTP ${status}).`);
  }
  return new Error(`Managed provider returned HTTP ${status}.`);
}

function managedNetworkError(error: unknown): Error {
  const code = (error as { code?: string })?.code;
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
    return new Error('Managed provider request timed out.');
  }
  return new Error('Managed provider request failed.');
}

async function* sanitizeManagedStream(
  stream: AsyncGenerator<ManagedProviderStreamChunk>,
): AsyncGenerator<ManagedProviderStreamChunk> {
  for await (const event of stream) {
    if (event.type === 'error') {
      yield { type: 'error', error: 'Managed provider stream failed.' };
      continue;
    }
    if (event.type === 'status' && event.error) {
      yield { ...event, error: 'Managed provider stream failed.' };
      continue;
    }
    yield event;
  }
}

export class ManagedAgentProvider implements ChatProvider {
  private readonly getAccessToken: () => Promise<string | null>;
  private readonly mockMode: boolean;

  constructor(options: {
    getAccessToken: () => Promise<string | null>;
  }) {
    this.getAccessToken = options.getAccessToken;
    this.mockMode = MOCK_AGENT_MODE;
  }

  /**
   * Resolve and freeze one managed route before the request starts. The returned
   * provider closes over the snapshot so later config changes cannot alter the
   * endpoint, model, credential source, or retry policy for that request.
   */
  createRequestRoute(): ManagedRequestRoute {
    const snapshot = createManagedRequestSnapshot(this.mockMode);
    const provider: ChatProvider = Object.freeze({
      streamChat: (request: ManagedAgentStreamRequest) =>
        this.streamChatWithSnapshot(request, snapshot),
      getStatus: (sessionId?: string) => this.getStatus(sessionId),
    });

    return Object.freeze({
      provider,
      endpointOrigin: snapshot.endpointOrigin,
      endpointClass: snapshot.endpointClass,
      modelId: snapshot.modelId,
    });
  }

  async *streamChat(
    request: ManagedAgentStreamRequest,
  ): AsyncGenerator<ManagedProviderStreamChunk> {
    const snapshot = createManagedRequestSnapshot(this.mockMode);
    yield* this.streamChatWithSnapshot(request, snapshot);
  }

  private async *streamChatWithSnapshot(
    request: ManagedAgentStreamRequest,
    snapshot: ManagedRequestSnapshot,
  ): AsyncGenerator<ManagedProviderStreamChunk> {
    if (this.mockMode) {
      yield { type: 'status', state: 'connecting' };
      await new Promise((resolve) => setTimeout(resolve, 70));
      yield { type: 'status', state: 'running' };
      yield { type: 'assistant_start' };
      await new Promise((resolve) => setTimeout(resolve, 80));
      yield { type: 'assistant_delta', delta: `Da nhan muc tieu: ${request.message}. ` };
      await new Promise((resolve) => setTimeout(resolve, 80));
      yield {
        type: 'task_upsert',
        task: {
          id: `task-${request.sessionId}`,
          sessionId: request.sessionId,
          title: 'Xac nhan release gate cho desktop app',
          status: 'in_progress',
          summary: 'Review updater, packaging va UAT checklist truoc khi phat hanh.',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };
      yield {
        type: 'memory_upsert',
        memory: {
          id: `memory-${request.sessionId}`,
          sessionId: request.sessionId,
          kind: 'constraint',
          content: 'Managed runner la execution mode duy nhat trong desktop app.',
          pinned: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };
      await new Promise((resolve) => setTimeout(resolve, 80));
      yield {
        type: 'assistant_delta',
        delta: 'Task va memory mock da duoc tao de phuc vu smoke validation.',
      };
      yield { type: 'assistant_done' };
      return;
    }

    const accessToken = await this.getAccessToken();
    if (!snapshot.apiKey && !accessToken) {
      throw new Error('Managed provider credential is unavailable.');
    }

    const idempotencyKey = randomUUID();
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...buildIzziRequestHeaders(snapshot.chatCompletionsUrl, idempotencyKey),
    };
    if (snapshot.apiKey) {
      headers['x-api-key'] = snapshot.apiKey;
    } else if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    const payload = buildOpenAIPayload(request, snapshot.modelId, true);
    let response;
    try {
      response = await axios.request<NodeJS.ReadableStream>({
        method: 'POST',
        url: snapshot.chatCompletionsUrl,
        data: payload,
        responseType: 'stream',
        validateStatus: () => true,
        headers,
        timeout: REQUEST_TIMEOUT_MS,
      });
    } catch (error) {
      throw managedNetworkError(error);
    }

    if (response.status >= 400) {
      const rawBody = await readStreamBody(response.data);
      const retryPayload = isExactStreamingLimitation(response.status, rawBody)
        ? createNonStreamingRetryPayload(payload)
        : null;
      if (!retryPayload) {
        throw managedHttpError(response.status);
      }

      let fallback;
      try {
        fallback = await axios.request({
          method: 'POST',
          url: snapshot.chatCompletionsUrl,
          data: retryPayload,
          validateStatus: () => true,
          headers: { ...headers, Accept: 'application/json' },
          timeout: REQUEST_TIMEOUT_MS,
        });
      } catch (error) {
        throw managedNetworkError(error);
      }

      if (fallback.status >= 400) {
        throw managedHttpError(fallback.status);
      }

      const content = fallback.data?.choices?.[0]?.message?.content;
      yield { type: 'status', state: 'running' };
      yield { type: 'assistant_start' };
      if (typeof content === 'string' && content.length > 0) {
        yield { type: 'assistant_delta', delta: content };
      }
      yield { type: 'assistant_done' };
      return;
    }

    const contentType = String(response.headers['content-type'] ?? '');
    if (contentType.includes('text/event-stream') || contentType.includes('text/plain')) {
      yield { type: 'status', state: 'running' };
      yield { type: 'assistant_start' };
      yield* streamOpenAISse(response.data);
      return;
    }

    yield* sanitizeManagedStream(parseManagedAgentStream(response.data, contentType));
  }

  async getStatus(_sessionId?: string): Promise<ManagedAgentStatus | null> {
    return {
      state: 'idle',
      updatedAt: new Date().toISOString(),
    };
  }
}
