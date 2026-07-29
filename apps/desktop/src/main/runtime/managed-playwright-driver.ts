import { createHash } from 'node:crypto';
import * as path from 'node:path';
import {
  assertAllowedUrl,
  validateRuntimeSpec,
  type BrowserRuntimeSpec,
} from '../../shared/runtime';
import { redactRuntimeText } from './redaction';
import type {
  BrowserReadResult,
  BrowserSubmitResult,
  IsolatedBrowserDriver,
  IsolatedBrowserSession,
} from './browser-runtime';

export interface PlaywrightLaunchOptions {
  readonly executablePath: string;
  readonly headless: false;
  readonly chromiumSandbox: true;
  readonly timeout: number;
  readonly downloadsPath: string;
}

export interface PlaywrightBrowserContextOptions {
  readonly acceptDownloads: false;
  readonly deviceScaleFactor: 1;
  readonly serviceWorkers: 'block';
  readonly storageState?: unknown;
  readonly viewport: {
    readonly width: 1280;
    readonly height: 900;
  };
}

export interface PlaywrightRequestPort {
  url(): string;
  method(): string;
}

export interface PlaywrightRoutePort {
  request(): PlaywrightRequestPort;
  continue(): Promise<void>;
  abort(errorCode?: string): Promise<void>;
}

export interface PlaywrightWebSocketRoutePort {
  url(): string;
  close(options?: { code?: number; reason?: string }): void | Promise<void>;
}

export interface PlaywrightResponsePort {
  url(): string;
  status(): number;
}

export interface PlaywrightLocatorPort {
  innerText(options?: { timeout?: number }): Promise<string>;
}

export interface PlaywrightPagePort {
  setDefaultTimeout(timeout: number): void;
  setDefaultNavigationTimeout(timeout: number): void;
  goto(
    url: string,
    options: {
      waitUntil: 'domcontentloaded';
      timeout: number;
    },
  ): Promise<PlaywrightResponsePort | null>;
  locator(selector: string): PlaywrightLocatorPort;
  screenshot(options: {
    type: 'png';
    fullPage: false;
    timeout: number;
  }): Promise<Buffer>;
  evaluate<TResult, TArg>(
    pageFunction: (input: TArg) => Promise<TResult> | TResult,
    input: TArg,
  ): Promise<TResult>;
}

export interface PlaywrightBrowserContextPort {
  route(
    matcher: string,
    handler: (route: PlaywrightRoutePort) => Promise<void>,
  ): Promise<void>;
  routeWebSocket(
    matcher: string,
    handler: (route: PlaywrightWebSocketRoutePort) => Promise<void>,
  ): Promise<void>;
  newPage(): Promise<PlaywrightPagePort>;
  storageState(): Promise<unknown>;
  close(): Promise<void>;
}

export interface PlaywrightBrowserPort {
  newContext(
    options: PlaywrightBrowserContextOptions,
  ): Promise<PlaywrightBrowserContextPort>;
  close(): Promise<void>;
}

export interface PlaywrightBrowserTypePort {
  launch(options: PlaywrightLaunchOptions): Promise<PlaywrightBrowserPort>;
}

/**
 * A deliberately narrow structural subset of Playwright. A future production
 * adapter may pass `playwright.chromium` without this module importing an
 * undeclared package.
 */
export interface ManagedPlaywrightPort {
  readonly chromium: PlaywrightBrowserTypePort;
}

export interface ManagedPlaywrightExecutableVerifier {
  verify(input: {
    readonly executablePath: string;
    readonly expectedDigest: string;
  }): Promise<string>;
}

export interface ManagedPlaywrightIdempotencyAuthority {
  assertReplaySafe(input: {
    readonly runtime: BrowserRuntimeSpec;
    readonly url: string;
    readonly idempotencyKey: string;
  }): Promise<void>;
}

export interface ManagedPlaywrightDriverOptions {
  readonly executablePath: string;
  readonly executableDigest: string;
  readonly packageId: string;
  readonly maxOperationTimeoutMs: number;
  readonly maxTextBytes: number;
  readonly maxScreenshotBytes: number;
}

const SHA256 = /^sha256:[a-f0-9]{64}$/;
const IDEMPOTENCY_KEY = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,199}$/;
const MAX_STORAGE_STATE_BYTES = 1024 * 1024;

export class ManagedPlaywrightDriver implements IsolatedBrowserDriver {
  readonly idempotentReplaySafe = true;

  constructor(
    private readonly playwright: ManagedPlaywrightPort,
    private readonly executableVerifier: ManagedPlaywrightExecutableVerifier,
    private readonly idempotencyAuthority: ManagedPlaywrightIdempotencyAuthority,
    private readonly options: ManagedPlaywrightDriverOptions,
  ) {
    validateDriverOptions(options);
  }

  async open(
    inputSpec: BrowserRuntimeSpec,
    encryptedStorageState: string | null,
  ): Promise<IsolatedBrowserSession> {
    const validated = validateRuntimeSpec(inputSpec);
    if (validated.kind !== 'browser') {
      throw new Error('Managed Playwright driver requires a browser runtime');
    }
    const spec = validated;
    if (!spec.visibleReviewMode) {
      throw new Error('Managed Playwright driver requires visible review mode');
    }
    if (spec.storageStateRef.store !== 'encrypted_file') {
      throw new Error('Managed Playwright driver requires encrypted storage state');
    }
    if (spec.authority.packageId !== this.options.packageId) {
      throw new Error('Managed Playwright package binding does not match runtime');
    }
    const storageState = parseStorageState(encryptedStorageState);
    const actualDigest = await this.executableVerifier.verify({
      executablePath: this.options.executablePath,
      expectedDigest: this.options.executableDigest,
    });
    if (actualDigest !== this.options.executableDigest) {
      throw new Error('Managed Playwright executable digest does not match');
    }

    const operationTimeoutMs = Math.min(
      spec.budget.timeoutMs,
      this.options.maxOperationTimeoutMs,
    );
    const browser = await this.playwright.chromium.launch({
      executablePath: this.options.executablePath,
      headless: false,
      chromiumSandbox: true,
      timeout: operationTimeoutMs,
      downloadsPath: spec.paths.downloadDir,
    });
    let context: PlaywrightBrowserContextPort | null = null;
    try {
      context = await browser.newContext({
        acceptDownloads: false,
        deviceScaleFactor: 1,
        serviceWorkers: 'block',
        ...(storageState === undefined ? {} : { storageState }),
        viewport: { width: 1280, height: 900 },
      });
      let session: ManagedPlaywrightSession | null = null;
      await context.route('**/*', async (route) => {
        if (!session) {
          await route.abort('blockedbyclient');
          return;
        }
        await session.authorizeHttpRoute(route);
      });
      await context.routeWebSocket('**/*', async (route) => {
        if (!session) {
          await route.close({
            code: 1008,
            reason: 'browser session is not ready',
          });
          return;
        }
        await session.authorizeWebSocketRoute(route);
      });
      const page = await context.newPage();
      page.setDefaultTimeout(operationTimeoutMs);
      page.setDefaultNavigationTimeout(operationTimeoutMs);
      session = new ManagedPlaywrightSession(
        spec,
        browser,
        context,
        page,
        this.idempotencyAuthority,
        operationTimeoutMs,
        this.options.maxTextBytes,
        this.options.maxScreenshotBytes,
      );
      return session;
    } catch (error) {
      if (context) await closeQuietly(context);
      await closeQuietly(browser);
      throw error;
    }
  }
}

class ManagedPlaywrightSession implements IsolatedBrowserSession {
  private active = false;
  private closed = false;
  private operationAuthorizeUrl: ((candidate: string) => void) | null = null;
  private operationPolicy:
    | { readonly kind: 'navigate' }
    | {
      readonly kind: 'submit';
      readonly submitUrl: string;
      submitStarted: boolean;
    }
    | null = null;

  constructor(
    private readonly runtime: BrowserRuntimeSpec,
    private readonly browser: PlaywrightBrowserPort,
    private readonly context: PlaywrightBrowserContextPort,
    private readonly page: PlaywrightPagePort,
    private readonly idempotencyAuthority: ManagedPlaywrightIdempotencyAuthority,
    private readonly timeoutMs: number,
    private readonly maxTextBytes: number,
    private readonly maxScreenshotBytes: number,
  ) {}

  async authorizeHttpRoute(route: PlaywrightRoutePort): Promise<void> {
    const request = route.request();
    const candidate = request.url();
    try {
      this.authorizeHttp(candidate);
      this.authorizeMethod(candidate, request.method());
      await route.continue();
    } catch {
      await route.abort('blockedbyclient');
    }
  }

  async authorizeWebSocketRoute(
    route: PlaywrightWebSocketRoutePort,
  ): Promise<void> {
    try {
      const mapped = mapWebSocketToHttp(route.url());
      this.authorizeHttp(mapped);
      throw new Error('WebSocket authority is not granted');
    } catch {
      await route.close({
        code: 1008,
        reason: 'origin is not allowlisted',
      });
    }
  }

  async navigate(
    url: string,
    signal: AbortSignal | undefined,
    authorizeUrl: (candidate: string) => void,
  ): Promise<BrowserReadResult> {
    return this.runOperation(
      signal,
      authorizeUrl,
      { kind: 'navigate' },
      async () => {
      this.authorizeHttp(url);
      const response = await this.page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: this.timeoutMs,
      });
      const finalUrl = response?.url() ?? url;
      this.authorizeHttp(finalUrl);
      const text = await this.page.locator('body').innerText({
        timeout: this.timeoutMs,
      });
      assertBoundedText(text, this.maxTextBytes, 'browser page text');
      return {
        finalUrl,
        text: redactRuntimeText(text),
        trace: auditTrace('navigate', finalUrl, response?.status() ?? null),
        screenshot: await this.captureRedactedScreenshot(),
      };
      },
    );
  }

  async submitTestEndpoint(
    input: {
      url: string;
      body: unknown;
      idempotencyKey: string;
    },
    signal: AbortSignal | undefined,
    authorizeUrl: (candidate: string) => void,
  ): Promise<BrowserSubmitResult> {
    return this.runOperation(
      signal,
      authorizeUrl,
      {
        kind: 'submit',
        submitUrl: input.url,
        submitStarted: false,
      },
      async () => {
      this.authorizeHttp(input.url);
      if (!IDEMPOTENCY_KEY.test(input.idempotencyKey)) {
        throw new Error('Managed Playwright idempotency key is invalid');
      }
      const serializedBody = serializeBoundedJson(
        input.body,
        this.maxTextBytes,
      );
      await this.idempotencyAuthority.assertReplaySafe({
        runtime: this.runtime,
        url: input.url,
        idempotencyKey: input.idempotencyKey,
      });
      const result = await this.page.evaluate(
        async (request) => {
          const browserGlobal = globalThis as unknown as {
            fetch(
              url: string,
              init: {
                method: 'POST';
                credentials: 'include';
                redirect: 'follow';
                headers: Record<string, string>;
                body: string;
              },
            ): Promise<{
              readonly url: string;
              readonly status: number;
              readonly headers: {
                get(name: string): string | null;
              };
              text(): Promise<string>;
            }>;
          };
          const response = await browserGlobal.fetch(request.url, {
            method: 'POST',
            credentials: 'include',
            redirect: 'follow',
            headers: {
              'content-type': 'application/json',
              'idempotency-key': request.idempotencyKey,
            },
            body: request.serializedBody,
          });
          const contentLength = Number(
            response.headers.get('content-length') ?? '0',
          );
          if (
            Number.isFinite(contentLength)
            && contentLength > request.maxResponseBytes
          ) {
            throw new Error('Browser response exceeds its byte budget');
          }
          const responseBody = await response.text();
          const encoder = new (
            globalThis as unknown as {
              TextEncoder: new () => {
                encode(value: string): { readonly byteLength: number };
              };
            }
          ).TextEncoder();
          if (
            encoder.encode(responseBody).byteLength
            > request.maxResponseBytes
          ) {
            throw new Error('Browser response exceeds its byte budget');
          }
          return {
            finalUrl: response.url,
            status: response.status,
            responseBody,
          };
        },
        {
          url: input.url,
          serializedBody,
          idempotencyKey: input.idempotencyKey,
          maxResponseBytes: this.maxTextBytes,
        },
      );
      this.authorizeHttp(result.finalUrl);
      assertBoundedText(
        result.responseBody,
        this.maxTextBytes,
        'browser response body',
      );
      return {
        finalUrl: result.finalUrl,
        status: result.status,
        responseBody: result.responseBody,
        trace: auditTrace('submit', result.finalUrl, result.status),
        screenshot: await this.captureRedactedScreenshot(),
      };
      },
    );
  }

  async exportStorageState(): Promise<string> {
    this.assertOpen();
    return JSON.stringify(validateStorageState(await this.context.storageState()));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.operationAuthorizeUrl = null;
    this.operationPolicy = null;
    await closeQuietly(this.context);
    await closeQuietly(this.browser);
  }

  private authorizeHttp(candidate: string): void {
    assertAllowedUrl(candidate, this.runtime.network);
    if (!this.operationAuthorizeUrl) {
      throw new Error('Browser request occurred outside an authorized operation');
    }
    this.operationAuthorizeUrl(candidate);
  }

  private authorizeMethod(candidate: string, rawMethod: string): void {
    const method = rawMethod.toUpperCase();
    if (!this.operationPolicy) {
      throw new Error('Browser request occurred outside an authorized operation');
    }
    if (this.operationPolicy.kind === 'navigate') {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        throw new Error('Side-effecting browser request is denied during read');
      }
      return;
    }
    if (
      (method === 'POST' || method === 'OPTIONS')
      && candidate === this.operationPolicy.submitUrl
    ) {
      if (method === 'POST') this.operationPolicy.submitStarted = true;
      return;
    }
    if (
      this.operationPolicy.submitStarted
      && ['GET', 'HEAD'].includes(method)
    ) {
      return;
    }
    throw new Error('Browser request is outside the approved submit operation');
  }

  private async captureRedactedScreenshot(): Promise<string> {
    const screenshot = await this.page.screenshot({
      type: 'png',
      fullPage: false,
      timeout: this.timeoutMs,
    });
    if (!Buffer.isBuffer(screenshot)) {
      throw new Error('Managed Playwright screenshot must be an in-memory buffer');
    }
    if (screenshot.byteLength > this.maxScreenshotBytes) {
      throw new Error('Managed Playwright screenshot exceeds its byte budget');
    }
    return JSON.stringify({
      kind: 'redacted_screenshot_digest',
      sha256: `sha256:${createHash('sha256').update(screenshot).digest('hex')}`,
      bytes: screenshot.byteLength,
    });
  }

  private async runOperation<T>(
    signal: AbortSignal | undefined,
    authorizeUrl: (candidate: string) => void,
    policy: NonNullable<ManagedPlaywrightSession['operationPolicy']>,
    operation: () => Promise<T>,
  ): Promise<T> {
    this.assertOpen();
    if (this.active) {
      throw new Error('Managed Playwright session already has an active operation');
    }
    if (signal?.aborted) {
      await this.close();
      throw new Error('Managed Playwright operation canceled');
    }
    this.active = true;
    this.operationAuthorizeUrl = authorizeUrl;
    this.operationPolicy = policy;
    let timeout: NodeJS.Timeout | undefined;
    let abortListener: (() => void) | undefined;
    let forcedClose = false;
    const interruption = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        forcedClose = true;
        reject(new Error('Managed Playwright operation timed out'));
      }, this.timeoutMs);
      abortListener = () => {
        forcedClose = true;
        reject(new Error('Managed Playwright operation canceled'));
      };
      signal?.addEventListener('abort', abortListener, { once: true });
    });
    try {
      return await Promise.race([operation(), interruption]);
    } catch (error) {
      if (forcedClose) await this.close();
      throw error;
    } finally {
      if (timeout) clearTimeout(timeout);
      if (abortListener) signal?.removeEventListener('abort', abortListener);
      this.operationAuthorizeUrl = null;
      this.operationPolicy = null;
      this.active = false;
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('Managed Playwright session is closed');
  }
}

function validateDriverOptions(options: ManagedPlaywrightDriverOptions): void {
  if (
    !path.isAbsolute(options.executablePath)
    || options.executablePath !== options.executablePath.trim()
    || /[\0\r\n]/.test(options.executablePath)
  ) {
    throw new Error('Managed Playwright executable path must be exact and absolute');
  }
  if (!SHA256.test(options.executableDigest)) {
    throw new Error('Managed Playwright executable digest must be SHA-256');
  }
  if (
    !options.packageId
    || options.packageId !== options.packageId.trim()
    || /[\0\r\n]/.test(options.packageId)
  ) {
    throw new Error('Managed Playwright package id is invalid');
  }
  for (const [name, value] of Object.entries({
    maxOperationTimeoutMs: options.maxOperationTimeoutMs,
    maxTextBytes: options.maxTextBytes,
    maxScreenshotBytes: options.maxScreenshotBytes,
  })) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`Managed Playwright ${name} must be a positive integer`);
    }
  }
}

function parseStorageState(serialized: string | null): unknown | undefined {
  if (serialized === null) return undefined;
  assertBoundedText(
    serialized,
    MAX_STORAGE_STATE_BYTES,
    'browser storage state',
  );
  try {
    return validateStorageState(JSON.parse(serialized));
  } catch {
    throw new Error('Managed Playwright storage state is invalid');
  }
}

function validateStorageState(value: unknown): {
  readonly cookies: readonly unknown[];
  readonly origins: readonly unknown[];
} {
  if (!isPlainRecord(value)) {
    throw new Error('storage state must be an object');
  }
  const keys = Object.keys(value);
  if (
    keys.some((key) => key !== 'cookies' && key !== 'origins')
    || !Array.isArray(value.cookies)
    || !Array.isArray(value.origins)
  ) {
    throw new Error('storage state shape is invalid');
  }
  return {
    cookies: value.cookies,
    origins: value.origins,
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function mapWebSocketToHttp(raw: string): string {
  const parsed = new URL(raw);
  if (parsed.protocol === 'ws:') {
    parsed.protocol = 'http:';
  } else if (parsed.protocol === 'wss:') {
    parsed.protocol = 'https:';
  } else {
    throw new Error('Managed Playwright WebSocket URL is invalid');
  }
  return parsed.toString();
}

function auditTrace(
  operation: 'navigate' | 'submit',
  rawUrl: string,
  status: number | null,
): string {
  const url = new URL(rawUrl);
  url.search = '';
  url.hash = '';
  return redactRuntimeText(JSON.stringify({
    schemaVersion: 1,
    operation,
    url: url.toString(),
    status,
    rawTraceCaptured: false,
  }));
}

function assertBoundedText(
  value: string,
  maxBytes: number,
  label: string,
): void {
  if (Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new Error(`${label} exceeds its byte budget`);
  }
}

function serializeBoundedJson(value: unknown, maxBytes: number): string {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new Error('browser submit body must be JSON serializable');
  }
  if (serialized === undefined) {
    throw new Error('browser submit body must be JSON serializable');
  }
  assertBoundedText(serialized, maxBytes, 'browser submit body');
  return serialized;
}

async function closeQuietly(
  resource: { close(): Promise<void> },
): Promise<void> {
  try {
    await resource.close();
  } catch {
    // Closing is best-effort here; callers preserve the primary failure.
  }
}
