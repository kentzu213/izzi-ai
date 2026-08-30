/**
 * IzziAgent — the chat layer for IZZI-NATIVE persona agents (Socrates,
 * Orchestrator) shown in the Agent Hub. Lives in the Electron MAIN process; the
 * Izzi API key NEVER leaves main and is never logged.
 *
 * Unlike the local Docker agents (OpenClaw/Hermes), these run through the Izzi
 * OpenAI-compatible endpoint (`/v1/chat/completions`) with a persona system
 * prompt — so they "install" instantly (no container) and bill to the signed-in
 * user's Izzi account. Mirrors the GraphAgent key-resolution + call pattern.
 *
 * Security (security-baseline A/B): key resolved from `OPENAI_API_KEY` env or the
 * signed-in user's izzi key (`AuthManager.getApiKey()`), used only in the
 * Authorization header over HTTPS, never logged, never returned across IPC.
 *
 * @module main/agents/izzi-agent
 */
import { randomUUID } from 'node:crypto';
import { ipcMain } from 'electron';
import type { AuthManager } from '../auth/auth-manager';
import { buildIzziRequestHeaders, isOfficialIzziApiUrl, modelSupportsTools } from '../agent/izzi-request-headers';
import {
  buildExtensionTools,
  executeExtensionTool,
  type ExtensionToolHost,
} from './extension-tools';
import { createStreamCollector, type AgentTurnEvent } from '../../shared/agent-turn-events';
import type { SessionRecorder } from './agent-session-recorder';

const IZZI_LLM_BASE = 'https://api.izziapi.com/v1';
const MAX_TOOL_ITERATIONS = 20;
/**
 * Output budget for one turn. The previous hardcoded 1200 silently truncated any
 * long-form answer (a plan, a report) mid-sentence and reported it as complete.
 * Callers may raise it up to the ceiling; the gateway still enforces its own limits.
 */
const DEFAULT_MAX_OUTPUT_TOKENS = 4096;
const MAX_OUTPUT_TOKENS_CEILING = 16000;

/** Clamp a caller-supplied output budget into the supported range. */
export function resolveIzziAgentMaxTokens(requested: unknown): number {
  if (typeof requested !== 'number' || !Number.isFinite(requested)) {
    return DEFAULT_MAX_OUTPUT_TOKENS;
  }
  const value = Math.trunc(requested);
  if (value < 1) return DEFAULT_MAX_OUTPUT_TOKENS;
  return Math.min(value, MAX_OUTPUT_TOKENS_CEILING);
}

/**
 * Turn a gateway failure into a message the caller can act on. The gateway documents
 * `{ error: { type, message } }`; discarding it left every failure as a bare
 * `http 400` with no way to tell a bad model id from a bad request shape.
 */
export async function readIzziAgentHttpError(res: {
  status: number;
  json: () => Promise<unknown>;
}): Promise<string> {
  try {
    const body = await res.json();
    const error = (body as { error?: unknown } | null)?.error;
    if (typeof error === 'string' && error.trim().length > 0) {
      return `http ${res.status}: ${error.trim().slice(0, 300)}`;
    }
    if (error && typeof error === 'object') {
      const detail = error as { type?: unknown; code?: unknown; message?: unknown };
      const kind = typeof detail.type === 'string'
        ? detail.type
        : typeof detail.code === 'string' ? detail.code : '';
      const message = typeof detail.message === 'string' ? detail.message : '';
      const text = [kind, message].filter((part) => part.length > 0).join(': ');
      if (text.length > 0) return `http ${res.status}: ${text.slice(0, 300)}`;
    }
  } catch {
    // A non-JSON error body carries nothing extra; fall back to the status alone.
  }
  return `http ${res.status}`;
}

/** Canonicalize legacy SmartRouter aliases; preserve explicit model routes. */
export function normalizeIzziAgentModel(model: string | null | undefined): string {
  const value = model?.trim();
  if (!value || value === 'izzi/auto' || value === 'izzi-auto' || value === 'auto') {
    return 'izzi-smart';
  }
  return value.replace(/^izzi\//, '');
}

export interface IzziAgentMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface IzziAgentChatPayload {
  systemPrompt: string;
  message: string;
  history?: IzziAgentMessage[];
  model?: string;
  /** Opt-in: expose installed+running extension commands as tools the agent may call. */
  enableTools?: boolean;
  /** Correlates streamed process events to the renderer's assistant message. */
  turnId?: string;
  /** Identifies the agent for my-graph work-session capture. */
  agentId?: string;
  agentName?: string;
  /** Pasted image attachments as data URLs; sent as multimodal `image_url` parts. */
  images?: string[];
  /** Output budget for this turn; clamped to the supported ceiling. */
  maxTokens?: number;
}

export interface IzziAgentChatResult {
  reply: string;
  error?: string;
  execution?: IzziAgentModelExecution;
  /** True when the model stopped because it hit the output budget, not because it finished. */
  truncated?: boolean;
}

export interface IzziAgentChatRequestOptions {
  idempotencyKey?: string;
}

export interface IzziAgentModelExecution {
  requestedModel: string;
  servedModel: string;
  usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedTokens: number;
  };
}

export function rendererSafeIzziAgentChatResult(
  result: IzziAgentChatResult,
): Pick<IzziAgentChatResult, 'reply' | 'error' | 'truncated'> {
  return {
    reply: result.reply,
    ...(result.error ? { error: result.error } : {}),
    ...(result.truncated ? { truncated: true } : {}),
  };
}

const ROLES = new Set(['system', 'user', 'assistant']);
const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{1,128}$/;
const HIGH_REASONING_MODEL = 'gpt-5.6-sol';

function nonNegativeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null;
}

function parseModelExecution(
  value: unknown,
  requestedModel: string,
): IzziAgentModelExecution | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const response = value as {
    model?: unknown;
    usage?: {
      prompt_tokens?: unknown;
      completion_tokens?: unknown;
      total_tokens?: unknown;
      prompt_tokens_details?: { cached_tokens?: unknown };
    };
  };
  const servedModel = typeof response.model === 'string' ? response.model.trim().slice(0, 160) : '';
  const promptTokens = nonNegativeInteger(response.usage?.prompt_tokens);
  const completionTokens = nonNegativeInteger(response.usage?.completion_tokens);
  const totalTokens = nonNegativeInteger(response.usage?.total_tokens);
  const cachedTokens = nonNegativeInteger(response.usage?.prompt_tokens_details?.cached_tokens) ?? 0;
  if (
    !servedModel
    || promptTokens === null
    || completionTokens === null
    || totalTokens === null
    || totalTokens < 1
    || promptTokens + completionTokens !== totalTokens
    || cachedTokens > promptTokens
  ) return undefined;
  return {
    requestedModel,
    servedModel,
    usage: { promptTokens, completionTokens, totalTokens, cachedTokens },
  };
}

/** True for a base64 data URL that carries an image (the only image form we accept). */
function isDataImage(u: unknown): u is string {
  return typeof u === 'string' && u.startsWith('data:image/');
}

/**
 * Build the OpenAI-compatible `content` for a user turn: a plain string when
 * there are no images, or a content-parts array (text + image_url) when images
 * are attached. Vision-capable Izzi models read the image_url parts.
 */
function buildUserContent(message: string, images: string[]): unknown {
  if (images.length === 0) return message;
  return [
    ...(message ? [{ type: 'text', text: message }] : []),
    ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
  ];
}

export class IzziAgent {
  constructor(
    private readonly auth: AuthManager,
    /** Optional bridge to installed extensions; enables agent tool-calling when present. */
    private readonly toolHost?: ExtensionToolHost,
  ) {}

  /** Resolve a credential without ever exposing it outside the main process. */
  private async resolveKey(): Promise<string | null> {
    // The chat endpoint below is pinned to the official IzziAPI gateway, which only
    // accepts `izzi-` keys. A foreign OPENAI_API_KEY left on the host must not shadow
    // the authenticated desktop key, or every turn fails with a bare HTTP 401.
    const envKey = process.env.OPENAI_API_KEY?.trim();
    if (envKey && envKey.startsWith('izzi-')) return envKey;
    const chatUrl = `${IZZI_LLM_BASE}/chat/completions`;
    if (!isOfficialIzziApiUrl(chatUrl)) return null;
    if (typeof this.auth.ensureDesktopApiKey === 'function') {
      try {
        const desktopKey = await this.auth.ensureDesktopApiKey();
        if (typeof desktopKey === 'string' && desktopKey.trim().length > 0) return desktopKey.trim();
      } catch {
        // Fall through to a profile key; never log credential acquisition failures here.
      }
    }
    const userKey = typeof this.auth.getApiKey === 'function' ? this.auth.getApiKey() : null;
    return typeof userKey === 'string' && userKey.trim().length > 0 ? userKey.trim() : null;
  }

  async chat(
    payload: IzziAgentChatPayload,
    onEvent?: (evt: AgentTurnEvent) => void,
    requestOptions: IzziAgentChatRequestOptions = {},
  ): Promise<IzziAgentChatResult> {
    const message = typeof payload?.message === 'string' ? payload.message.trim() : '';
    const images = Array.isArray(payload?.images) ? payload.images.filter(isDataImage) : [];
    if (message.length === 0 && images.length === 0) return { reply: '', error: 'empty' };
    const turnId = typeof payload.turnId === 'string' ? payload.turnId : '';
    const emit = onEvent && turnId ? onEvent : undefined;

    const key = await this.resolveKey();
    if (!key) return { reply: '', error: 'no-key' };

    const system = typeof payload.systemPrompt === 'string' ? payload.systemPrompt : '';
    // Legacy SmartRouter aliases become the gateway's canonical route; explicit ids
    // such as claude-sonnet-4.5 pass through unchanged.
    const model = normalizeIzziAgentModel(payload.model);
    const maxTokens = resolveIzziAgentMaxTokens(payload.maxTokens);
    const requestedIdempotencyKey = requestOptions.idempotencyKey?.trim();
    if (
      requestedIdempotencyKey
      && (payload.enableTools || !IDEMPOTENCY_KEY_PATTERN.test(requestedIdempotencyKey))
    ) return { reply: '', error: 'invalid-request-options' };
    const idempotencyKey = requestedIdempotencyKey || undefined;
    const chatUrl = `${IZZI_LLM_BASE}/chat/completions`;
    // Fixed-price routes are refused without this header; mint one per request.
    const nextIdempotencyKey = (): string | undefined => idempotencyKey
      ?? (isOfficialIzziApiUrl(chatUrl) ? randomUUID() : undefined);
    const history: IzziAgentMessage[] = Array.isArray(payload.history)
      ? payload.history
          .filter(
            (m): m is IzziAgentMessage =>
              m !== null &&
              typeof m === 'object' &&
              ROLES.has((m as IzziAgentMessage).role) &&
              typeof (m as IzziAgentMessage).content === 'string' &&
              (m as IzziAgentMessage).content.trim().length > 0,
          )
          .slice(-10)
      : [];

    // Loose message type so tool/assistant-with-tool_calls turns are allowed.
    const reqMessages: Array<Record<string, unknown>> = [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...history,
      { role: 'user', content: buildUserContent(message, images) },
    ];

    // Opt-in tool exposure: only when requested AND a bridge is present.
    const toolIndex = payload.enableTools && this.toolHost ? buildExtensionTools(this.toolHost) : null;
    const tools = toolIndex && toolIndex.tools.length > 0 && modelSupportsTools(model) ? toolIndex.tools : null;

    try {
      for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
        const body: Record<string, unknown> = {
          model,
          messages: reqMessages,
          stream: false,
          max_tokens: maxTokens,
        };
        if (model === HIGH_REASONING_MODEL) body.reasoning_effort = 'high';
        if (tools) {
          body.tools = tools;
          body.tool_choice = 'auto';
        }
        const res = await fetch(`${IZZI_LLM_BASE}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
            ...buildIzziRequestHeaders(chatUrl, nextIdempotencyKey()),
          },
          body: JSON.stringify(body),
        });
        if (!res.ok) return { reply: '', error: await readIzziAgentHttpError(res) };
        const data = (await res.json()) as {
          model?: unknown;
          usage?: unknown;
          choices?: Array<{ finish_reason?: unknown; message?: { content?: unknown; tool_calls?: Array<{ id: string; function?: { name?: string; arguments?: string } }> } }>;
        };
        const truncated = data?.choices?.[0]?.finish_reason === 'length';
        const msg = data?.choices?.[0]?.message;
        const toolCalls = msg?.tool_calls;

        // No tools available or model returned a final answer → done.
        if (!tools || !toolIndex || !Array.isArray(toolCalls) || toolCalls.length === 0) {
          const content = msg?.content;
          return typeof content === 'string' && content.length > 0
            ? {
              reply: content,
              execution: parseModelExecution(data, model),
              ...(truncated ? { truncated: true } : {}),
            }
            : { reply: '', error: 'empty-response' };
        }

        // Execute each requested tool and feed results back.
        reqMessages.push({ role: 'assistant', content: (msg?.content as string) || '', tool_calls: toolCalls });
        for (const tc of toolCalls) {
          const toolName = tc.function?.name || '';
          const label = toolName.replace(/__/g, '.'); // human-readable command id
          const stepId = tc.id || `${toolName}-${Math.random().toString(36).slice(2, 8)}`;
          // Emit a live "tool running" step (Stage 1/3: show the agent's process).
          emit?.({ turnId, kind: 'step', step: { id: stepId, kind: 'tool', label, status: 'running' } });
          let args: unknown = {};
          try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { args = {}; }
          let resultStr: string;
          let ok = true;
          try {
            const result = await executeExtensionTool(this.toolHost!, toolIndex, toolName, args);
            resultStr = JSON.stringify(result ?? null);
          } catch (err) {
            ok = false;
            resultStr = JSON.stringify({ error: (err as Error).message });
          }
          emit?.({
            turnId,
            kind: 'step',
            step: { id: stepId, kind: 'tool', label, status: ok ? 'done' : 'error', detail: ok ? undefined : 'lỗi' },
          });
          reqMessages.push({ role: 'tool', tool_call_id: tc.id, content: resultStr.slice(0, 6000) });
        }
        // loop for the model's next turn
      }
      // Step budget reached: one final answer WITHOUT tools so the user gets a real
      // reply (progress + what's left) instead of an empty error. Resumable next turn.
      try {
        const res = await fetch(`${IZZI_LLM_BASE}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${key}`,
            ...buildIzziRequestHeaders(chatUrl, nextIdempotencyKey()),
          },
          body: JSON.stringify({
            model,
            messages: [
              ...reqMessages,
              {
                role: 'user',
                content:
                  'Bạn đã dùng hết số bước công cụ cho lượt này — DỪNG gọi công cụ. Tổng kết ngắn gọn: đã làm được gì và còn bước nào chưa xong. Nếu chưa hoàn tất, nói rõ để người dùng nhắn "tiếp tục".',
              },
            ],
            stream: false,
            max_tokens: maxTokens,
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
          const content = data?.choices?.[0]?.message?.content;
          if (typeof content === 'string' && content.trim().length > 0) return { reply: content };
        }
      } catch {
        /* fall through to a static wrap-up */
      }
      return {
        reply:
          'Mình đã chạy nhiều bước cho tác vụ này nhưng chưa xong trong một lượt. Nhắn "tiếp tục" để mình làm tiếp.',
      };
    } catch {
      return { reply: '', error: 'network' };
    }
  }
}

/**
 * Register the `izziAgent:chat` IPC handler. The Izzi key stays inside IzziAgent
 * (main process) and NEVER crosses the bridge — the renderer only receives
 * `{ reply, error }`.
 */
export function registerIzziAgentIpc(agent: IzziAgent, recorder?: SessionRecorder): void {
  ipcMain.handle('izziAgent:chat', async (event, payload: IzziAgentChatPayload) => {
    const turnId = typeof payload?.turnId === 'string' ? payload.turnId : '';
    const startedAt = new Date().toISOString();
    // Forward live process events to the renderer; collect steps for the record.
    const collector = createStreamCollector((evt) => event.sender.send('agentStream:event', evt));
    const result = await agent.chat(payload, turnId ? collector.onEvent : undefined);

    // Record the finished turn into the unified surfaces (my-graph + Replay tasks).
    if (recorder && payload?.agentId && typeof result.reply === 'string' && result.reply.length > 0) {
      recorder.record({
        agentId: payload.agentId,
        agentName: payload.agentName || payload.agentId,
        model: payload.model,
        request: payload.message,
        reply: result.reply,
        steps: collector.steps(),
        startedAt,
        finishedAt: new Date().toISOString(),
        turnId,
      });
    }
    return rendererSafeIzziAgentChatResult(result);
  });
}
