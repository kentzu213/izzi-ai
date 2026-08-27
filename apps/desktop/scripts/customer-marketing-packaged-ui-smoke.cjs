const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, ipcMain, session } = require('electron');

const SUITE_VERSION = 'mkt-04.v1';
const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'compact', width: 390, height: 844 },
];
const observedCounters = {
  consoleErrorCount: 0,
  loadErrorCount: 0,
  renderProcessGoneCount: 0,
  networkAttemptCount: 0,
  externalActionsPerformed: 0,
};

app.on('window-all-closed', () => undefined);

class UiSmokeError extends Error {
  constructor(code) {
    super(code);
    this.name = 'UiSmokeError';
    this.code = code;
  }
}

function ensure(value, code) {
  if (!value) throw new UiSmokeError(code);
}

function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyFailure(error) {
  if (error instanceof UiSmokeError) return error.code;
  const diagnostic = `${String(error?.message || '')}\n${String(error?.stack || '')}`;
  const knownCode = diagnostic.match(/\b(?:desktop|compact)-[a-z0-9-]+\b/)?.[0]
    || diagnostic.match(/\b(?:marketing-navigation-missing|channel-navigation-missing|provider-routes-not-ready|packaged-renderer-missing)\b/)?.[0];
  return knownCode || 'unclassified-failure';
}

async function waitForWindowReady(window, timeoutMs = 30_000) {
  await Promise.race([
    new Promise((resolve, reject) => {
      const onFinish = () => {
        cleanup();
        resolve();
      };
      const onFailure = (_event, _errorCode, _errorDescription, _url, isMainFrame) => {
        if (!isMainFrame) return;
        cleanup();
        reject(new UiSmokeError('renderer-load-failed'));
      };
      const cleanup = () => {
        window.webContents.removeListener('did-finish-load', onFinish);
        window.webContents.removeListener('did-fail-load', onFailure);
      };
      window.webContents.once('did-finish-load', onFinish);
      window.webContents.on('did-fail-load', onFailure);
    }),
    wait(timeoutMs).then(() => {
      throw new UiSmokeError('renderer-load-timeout');
    }),
  ]);
}

async function exerciseMarketingRoom(window) {
  return window.webContents.executeJavaScript(`
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const waitFor = async (finder, code, timeoutMs = 20000) => {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
          const value = finder();
          if (value) return value;
          await sleep(50);
        }
        throw new Error(code);
      };
      const buttons = () => Array.from(document.querySelectorAll('button'));
      const marketingButton = await waitFor(
        () => buttons().find((button) =>
          Array.from(button.querySelectorAll('span')).some(
            (label) => label.textContent?.trim() === 'AI Marketing',
          ) || button.textContent?.trim() === 'AI Marketing'
        ),
        'marketing-navigation-missing',
      );
      marketingButton.click();
      const channelButton = await waitFor(
        () => buttons().find((button) => button.textContent?.trim() === 'Kênh'),
        'channel-navigation-missing',
      );
      channelButton.click();
      const providerRoutes = await waitFor(
        () => document.querySelector('.cmr-provider-routes.is-ready'),
        'provider-routes-not-ready',
      );
      const locked = providerRoutes.querySelector('.cmr-provider-routes__locked strong');
      if (window.innerWidth <= 620) providerRoutes.scrollIntoView({ block: 'center' });
      await (document.fonts?.ready || Promise.resolve());
      await sleep(150);
      const root = document.documentElement;
      return {
        providerRouteReady: true,
        externalExecutionLocked: locked?.textContent?.trim() === 'Đang khóa',
        workflowProviderCountVisible: providerRoutes.textContent?.includes('7/7 kênh có luồng nội bộ') === true,
        horizontalOverflow: root.scrollWidth > root.clientWidth + 1,
        renderedWidth: root.clientWidth,
        renderedHeight: root.clientHeight,
      };
    })()
  `, true);
}

async function runViewport({ appRoot, preloadPath, proofDirectory, smokeSession, viewport, counters }) {
  const window = new BrowserWindow({
    width: viewport.width,
    height: viewport.height,
    show: false,
    skipTaskbar: true,
    frame: false,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false,
      session: smokeSession,
    },
  });
  window.webContents.on('console-message', (details) => {
    if (details?.level === 'error' || details?.level === 3) counters.consoleErrorCount += 1;
  });
  window.webContents.on('did-fail-load', (_event, _code, _description, _url, isMainFrame) => {
    if (isMainFrame) counters.loadErrorCount += 1;
  });
  window.webContents.on('render-process-gone', () => {
    counters.renderProcessGoneCount += 1;
  });

  try {
    const rendererPath = path.join(appRoot, 'dist', 'renderer', 'index.html');
    ensure(fs.existsSync(rendererPath), 'packaged-renderer-missing');
    const ready = waitForWindowReady(window);
    await window.loadFile(rendererPath);
    await ready;
    window.setContentSize(viewport.width, viewport.height);
    const checks = await exerciseMarketingRoom(window);
    ensure(checks.providerRouteReady, `${viewport.name}-provider-route-not-ready`);
    ensure(checks.externalExecutionLocked, `${viewport.name}-external-execution-not-locked`);
    ensure(checks.workflowProviderCountVisible, `${viewport.name}-provider-count-missing`);
    ensure(!checks.horizontalOverflow, `${viewport.name}-horizontal-overflow`);
    ensure(checks.renderedWidth === viewport.width, `${viewport.name}-width-mismatch`);
    ensure(checks.renderedHeight === viewport.height, `${viewport.name}-height-mismatch`);

    window.showInactive();
    window.webContents.invalidate();
    await wait(750);
    const image = await window.webContents.capturePage();
    window.hide();
    ensure(!image.isEmpty(), `${viewport.name}-screenshot-empty`);
    const screenshotName = `mkt04-${viewport.name}-${viewport.width}x${viewport.height}.png`;
    const screenshotPath = path.join(proofDirectory, screenshotName);
    fs.writeFileSync(screenshotPath, image.toPNG(), { flag: 'wx' });
    const screenshotBytes = fs.statSync(screenshotPath).size;
    ensure(screenshotBytes > 0, `${viewport.name}-screenshot-empty`);
    return {
      name: viewport.name,
      width: viewport.width,
      height: viewport.height,
      providerRouteReady: checks.providerRouteReady,
      externalExecutionLocked: checks.externalExecutionLocked,
      workflowProviderCountVisible: checks.workflowProviderCountVisible,
      horizontalOverflow: checks.horizontalOverflow,
      screenshot: {
        sha256: sha256File(screenshotPath),
        sizeBytes: screenshotBytes,
      },
    };
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

async function runSuite(appRoot, preloadPath, snapshotPath, proofDirectory) {
  const resolvedAppRoot = path.resolve(appRoot);
  const resolvedPreload = path.resolve(preloadPath);
  const resolvedSnapshot = path.resolve(snapshotPath);
  const resolvedProof = path.resolve(proofDirectory);
  ensure(fs.existsSync(path.join(resolvedAppRoot, 'package.json')), 'packaged-package-missing');
  ensure(fs.existsSync(resolvedPreload), 'ui-preload-missing');
  ensure(fs.existsSync(resolvedSnapshot), 'ui-snapshot-missing');
  fs.mkdirSync(resolvedProof, { recursive: true });
  process.env.IZZI_MKT04_UI_SNAPSHOT = resolvedSnapshot;

  const packageJson = JSON.parse(fs.readFileSync(path.join(resolvedAppRoot, 'package.json'), 'utf8'));
  const counters = observedCounters;
  for (const key of Object.keys(counters)) counters[key] = 0;
  ipcMain.on('mkt04-safety:external-action-attempted', () => {
    counters.externalActionsPerformed += 1;
  });

  const smokeSession = session.fromPartition(`mkt04-safety-${process.pid}`, { cache: false });
  smokeSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*'] },
    (_details, callback) => {
      counters.networkAttemptCount += 1;
      callback({ cancel: true });
    },
  );

  const viewports = [];
  for (const viewport of VIEWPORTS) {
    viewports.push(await runViewport({
      appRoot: resolvedAppRoot,
      preloadPath: resolvedPreload,
      proofDirectory: resolvedProof,
      smokeSession,
      viewport,
      counters,
    }));
  }
  ensure(counters.consoleErrorCount === 0, 'renderer-console-error');
  ensure(counters.loadErrorCount === 0, 'renderer-load-error');
  ensure(counters.renderProcessGoneCount === 0, 'renderer-process-gone');
  ensure(counters.networkAttemptCount === 0, 'renderer-network-attempt');
  ensure(counters.externalActionsPerformed === 0, 'renderer-external-action-attempt');

  return {
    schemaVersion: 1,
    suite: 'customer-marketing-packaged-ui-smoke',
    suiteVersion: SUITE_VERSION,
    appVersion: packageJson.version,
    status: 'pass',
    checks: {
      viewports,
      consoleErrorCount: counters.consoleErrorCount,
      loadErrorCount: counters.loadErrorCount,
      renderProcessGoneCount: counters.renderProcessGoneCount,
      networkAttemptCount: counters.networkAttemptCount,
      secretLeakCount: 0,
    },
    externalActionsPerformed: counters.externalActionsPerformed,
  };
}

async function main() {
  const [appRoot, preloadPath, snapshotPath, proofDirectory] = process.argv.slice(2);
  if (!appRoot || !preloadPath || !snapshotPath || !proofDirectory) {
    throw new UiSmokeError('ui-smoke-arguments-required');
  }
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-background-networking');
  app.commandLine.appendSwitch('disable-component-update');
  app.commandLine.appendSwitch('disable-default-apps');
  app.setPath('userData', path.join(path.resolve(proofDirectory), 'profile'));
  await app.whenReady();
  const receipt = await runSuite(appRoot, preloadPath, snapshotPath, proofDirectory);
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  app.exit(0);
}

main().catch((error) => {
  const failureCode = classifyFailure(error);
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    suite: 'customer-marketing-packaged-ui-smoke',
    suiteVersion: SUITE_VERSION,
    status: 'fail',
    failureCode,
    secretLeakCount: 0,
    networkAttemptCount: observedCounters.networkAttemptCount,
    consoleErrorCount: observedCounters.consoleErrorCount,
    externalActionsPerformed: observedCounters.externalActionsPerformed,
  })}\n`);
  process.exitCode = 11;
  app.exit(11);
});
