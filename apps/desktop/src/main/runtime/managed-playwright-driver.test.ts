import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { secretRef } from '../../shared/personal-office';
import type { BrowserRuntimeSpec } from '../../shared/runtime';
import {
  ManagedPlaywrightDriver,
  type ManagedPlaywrightExecutableVerifier,
  type ManagedPlaywrightPort,
  type PlaywrightBrowserContextPort,
  type PlaywrightBrowserPort,
  type PlaywrightPagePort,
  type PlaywrightRoutePort,
  type PlaywrightWebSocketRoutePort,
} from './managed-playwright-driver';

const executablePath = process.platform === 'win32'
  ? 'C:\\Program Files\\Izzi\\runtime\\chromium.exe'
  : '/opt/izzi/runtime/chromium';
const runtimeRoot = process.platform === 'win32'
  ? 'C:\\izzi\\browser'
  : '/izzi/browser';
const executableDigest = `sha256:${'a'.repeat(64)}`;

const runtime: BrowserRuntimeSpec = {
  schemaVersion: 1,
  id: 'runtime.browser.managed',
  kind: 'browser',
  authority: {
    tenantId: 'tenant:izzi',
    userId: 'user:operator',
    workspaceId: 'workspace:personal-office',
    packageId: 'skill-package:marketing',
    integrationId: 'google-calendar',
    grantId: 'grant:calendar',
    runId: 'run:marketing',
  },
  paths: {
    workDir: runtimeRoot,
    tempDir: runtimeRoot,
    uploadDir: runtimeRoot,
    downloadDir: runtimeRoot,
    allowedRoots: [runtimeRoot],
  },
  network: {
    mode: 'allowlist',
    bindHost: '127.0.0.1',
    allowedOrigins: ['https://calendar.google.com'],
    allowedPorts: [443],
  },
  budget: {
    cpuPercent: 25,
    memoryMb: 512,
    diskMb: 512,
    timeoutMs: 60_000,
  },
  env: [],
  visibleReviewMode: true,
  storageStateRef: secretRef(
    'encrypted_file',
    'browser/calendar/operator',
  ),
};

class FakeRoute implements PlaywrightRoutePort {
  continued = false;
  aborted = false;

  constructor(
    private readonly requestUrl: string,
    private readonly requestMethod = 'GET',
  ) {}

  request() {
    return {
      url: () => this.requestUrl,
      method: () => this.requestMethod,
    };
  }

  async continue() {
    this.continued = true;
  }

  async abort() {
    this.aborted = true;
  }
}

class FakeWebSocketRoute implements PlaywrightWebSocketRoutePort {
  closed = false;

  constructor(private readonly socketUrl: string) {}

  url() {
    return this.socketUrl;
  }

  close() {
    this.closed = true;
  }
}

class FakePage implements PlaywrightPagePort {
  readonly goto = vi.fn(async (url: string) => {
    await this.context.dispatchRoute(url);
    if (this.context.socketDuringOperation) {
      await this.context.dispatchSocket(this.context.socketDuringOperation);
    }
    return {
      url: () => url,
      status: () => 200,
    };
  });
  readonly locator = vi.fn(() => ({
    innerText: vi.fn(async () => 'Calendar preview token=must-redact'),
  }));
  readonly screenshot = vi.fn(async () => Buffer.from('screenshot pixels'));
  readonly evaluate = vi.fn(async (
    pageFunction: (input: {
      url: string;
      serializedBody: string;
      idempotencyKey: string;
      maxResponseBytes: number;
    }) => Promise<{
      finalUrl: string;
      status: number;
      responseBody: string;
    }>,
    input: {
      url: string;
      serializedBody: string;
      idempotencyKey: string;
      maxResponseBytes: number;
    },
  ) => {
    await this.context.dispatchRoute(input.url, 'POST');
    return pageFunction(input);
  });

  constructor(private readonly context: FakeContext) {}

  setDefaultTimeout = vi.fn();
  setDefaultNavigationTimeout = vi.fn();
}

class FakeContext implements PlaywrightBrowserContextPort {
  routeHandler: ((route: PlaywrightRoutePort) => Promise<void>) | null = null;
  socketHandler: ((route: PlaywrightWebSocketRoutePort) => Promise<void>) | null = null;
  socketDuringOperation: FakeWebSocketRoute | null = null;
  readonly page = new FakePage(this);
  readonly route = vi.fn(async (
    _matcher: string,
    handler: (route: PlaywrightRoutePort) => Promise<void>,
  ) => {
    this.routeHandler = handler;
  });
  readonly routeWebSocket = vi.fn(async (
    _matcher: string,
    handler: (route: PlaywrightWebSocketRoutePort) => Promise<void>,
  ) => {
    this.socketHandler = handler;
  });
  readonly newPage = vi.fn(async () => this.page);
  readonly storageState = vi.fn(async () => ({
    cookies: [{ name: 'sid', value: 'encrypted-at-rest-only' }],
    origins: [],
  }));
  readonly close = vi.fn(async () => undefined);

  async dispatchRoute(url: string, method = 'GET'): Promise<FakeRoute> {
    if (!this.routeHandler) throw new Error('route handler missing');
    const route = new FakeRoute(url, method);
    await this.routeHandler(route);
    if (route.aborted) throw new Error('request blocked');
    return route;
  }

  async dispatchSocket(route: FakeWebSocketRoute): Promise<void> {
    if (!this.socketHandler) throw new Error('socket handler missing');
    await this.socketHandler(route);
  }
}

class FakeBrowser implements PlaywrightBrowserPort {
  readonly context = new FakeContext();
  readonly newContext = vi.fn(async () => this.context);
  readonly close = vi.fn(async () => undefined);
}

function harness(overrides: {
  verifier?: ManagedPlaywrightExecutableVerifier;
  browser?: FakeBrowser;
} = {}) {
  const browser = overrides.browser ?? new FakeBrowser();
  const playwright: ManagedPlaywrightPort = {
    chromium: {
      launch: vi.fn(async () => browser),
    },
  };
  const verifier = overrides.verifier ?? {
    verify: vi.fn(async () => executableDigest),
  };
  const idempotency = {
    assertReplaySafe: vi.fn(async () => undefined),
  };
  const driver = new ManagedPlaywrightDriver(
    playwright,
    verifier,
    idempotency,
    {
      executablePath,
      executableDigest,
      packageId: runtime.authority.packageId,
      maxOperationTimeoutMs: 90_000,
      maxTextBytes: 64 * 1024,
      maxScreenshotBytes: 64 * 1024,
    },
  );
  return {
    browser,
    driver,
    idempotency,
    launch: playwright.chromium.launch,
    verifier,
  };
}

describe('ManagedPlaywrightDriver', () => {
  it('verifies the exact executable and opens one headed isolated context', async () => {
    const test = harness();
    const session = await test.driver.open(
      runtime,
      JSON.stringify({ cookies: [], origins: [] }),
    );

    expect(test.verifier.verify).toHaveBeenCalledWith({
      executablePath,
      expectedDigest: executableDigest,
    });
    expect(test.launch).toHaveBeenCalledWith({
      executablePath,
      headless: false,
      chromiumSandbox: true,
      timeout: runtime.budget.timeoutMs,
      downloadsPath: runtime.paths.downloadDir,
    });
    expect(test.browser.newContext).toHaveBeenCalledWith({
      acceptDownloads: false,
      deviceScaleFactor: 1,
      serviceWorkers: 'block',
      storageState: { cookies: [], origins: [] },
      viewport: { width: 1280, height: 900 },
    });
    expect(test.browser.context.route).toHaveBeenCalledWith(
      '**/*',
      expect.any(Function),
    );
    expect(test.browser.context.routeWebSocket).toHaveBeenCalledWith(
      '**/*',
      expect.any(Function),
    );
    expect(await session.exportStorageState()).toBe(JSON.stringify({
      cookies: [{ name: 'sid', value: 'encrypted-at-rest-only' }],
      origins: [],
    }));

    await session.close();
    await session.close();
    expect(test.browser.context.close).toHaveBeenCalledOnce();
    expect(test.browser.close).toHaveBeenCalledOnce();
  });

  it('contains HTTP and WebSocket traffic to the exact runtime allowlist', async () => {
    const test = harness();
    const session = await test.driver.open(runtime, null);
    const authorizeUrl = vi.fn();
    const allowedSocket = new FakeWebSocketRoute(
      'wss://calendar.google.com/live',
    );
    test.browser.context.socketDuringOperation = allowedSocket;

    const read = await session.navigate(
      'https://calendar.google.com/read?access_token=raw-value',
      undefined,
      authorizeUrl,
    );
    expect(read.finalUrl).toBe(
      'https://calendar.google.com/read?access_token=raw-value',
    );
    expect(read.text).toContain('[redacted]');
    expect(read.trace).not.toContain('access_token');
    expect(read.trace).not.toContain('raw-value');
    expect(read.screenshot).toEqual(JSON.stringify({
      kind: 'redacted_screenshot_digest',
      sha256: `sha256:${createHash('sha256')
        .update('screenshot pixels')
        .digest('hex')}`,
      bytes: Buffer.byteLength('screenshot pixels'),
    }));
    expect(authorizeUrl).toHaveBeenCalledWith(
      'https://calendar.google.com/read?access_token=raw-value',
    );
    expect(allowedSocket.closed).toBe(true);

    const deniedHttp = new FakeRoute('https://evil.example/collect');
    await test.browser.context.routeHandler!(deniedHttp);
    expect(deniedHttp.aborted).toBe(true);
    expect(deniedHttp.continued).toBe(false);

    const deniedSocket = new FakeWebSocketRoute('wss://evil.example/live');
    await test.browser.context.socketHandler!(deniedSocket);
    expect(deniedSocket.closed).toBe(true);

    await session.close();
  });

  it('blocks side-effecting page traffic during the read-only phase', async () => {
    const test = harness();
    const session = await test.driver.open(runtime, null);
    test.browser.context.page.goto.mockImplementationOnce(async (url) => {
      await test.browser.context.dispatchRoute(url, 'GET');
      await test.browser.context.dispatchRoute(
        'https://calendar.google.com/hidden-write',
        'POST',
      );
      return { url: () => url, status: () => 200 };
    });

    await expect(session.navigate(
      'https://calendar.google.com/read',
      undefined,
      vi.fn(),
    )).rejects.toThrow(/request blocked/);

    await session.close();
  });

  it('requires explicit idempotency authority before an approved submit', async () => {
    const test = harness();
    const session = await test.driver.open(runtime, null);
    const fetchStub = vi.fn(async () => ({
      url: 'https://calendar.google.com/receipt',
      status: 201,
      headers: {
        get: () => null,
      },
      text: async () => '{"receipt":"ok"}',
    }));
    vi.stubGlobal('fetch', fetchStub);
    try {
      const result = await session.submitTestEndpoint(
        {
          url: 'https://calendar.google.com/submit',
          body: { title: 'Reviewed task' },
          idempotencyKey: 'browser-action-0001',
        },
        undefined,
        vi.fn(),
      );

      expect(test.idempotency.assertReplaySafe).toHaveBeenCalledWith({
        runtime,
        url: 'https://calendar.google.com/submit',
        idempotencyKey: 'browser-action-0001',
      });
      expect(fetchStub).toHaveBeenCalledWith(
        'https://calendar.google.com/submit',
        {
          method: 'POST',
          credentials: 'include',
          redirect: 'follow',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': 'browser-action-0001',
          },
          body: '{"title":"Reviewed task"}',
        },
      );
      expect(test.browser.context.page.evaluate).toHaveBeenCalledOnce();
      expect(result).toMatchObject({
        finalUrl: 'https://calendar.google.com/receipt',
        status: 201,
        responseBody: '{"receipt":"ok"}',
      });
    } finally {
      vi.unstubAllGlobals();
    }

    await session.close();
  });

  it('fails before launch on executable, package, storage or visible-mode drift', async () => {
    const badDigest = harness({
      verifier: {
        verify: vi.fn(async () => `sha256:${'b'.repeat(64)}`),
      },
    });
    await expect(badDigest.driver.open(runtime, null))
      .rejects.toThrow(/digest/);
    expect(badDigest.launch).not.toHaveBeenCalled();

    const test = harness();
    await expect(test.driver.open({
      ...runtime,
      visibleReviewMode: false,
    }, null)).rejects.toThrow(/visible/);
    await expect(test.driver.open({
      ...runtime,
      authority: {
        ...runtime.authority,
        packageId: 'skill-package:other',
      },
    }, null)).rejects.toThrow(/package/);
    await expect(test.driver.open(runtime, '{not-json'))
      .rejects.toThrow(/storage state/);
    expect(test.launch).not.toHaveBeenCalled();
  });

  it('closes the browser when isolated context creation fails', async () => {
    const browser = new FakeBrowser();
    browser.newContext.mockRejectedValueOnce(new Error('context failed'));
    const test = harness({ browser });

    await expect(test.driver.open(runtime, null)).rejects.toThrow(
      'context failed',
    );
    expect(browser.close).toHaveBeenCalledOnce();
  });

  it('closes the full session when an operation is canceled', async () => {
    const test = harness();
    const session = await test.driver.open(runtime, null);
    const abort = new AbortController();
    abort.abort();

    await expect(session.navigate(
      'https://calendar.google.com/read',
      abort.signal,
      vi.fn(),
    )).rejects.toThrow(/canceled/);
    expect(test.browser.context.close).toHaveBeenCalledOnce();
    expect(test.browser.close).toHaveBeenCalledOnce();
  });
});
