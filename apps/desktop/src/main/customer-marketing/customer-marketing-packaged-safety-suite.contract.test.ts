import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const desktopRoot = fileURLToPath(new URL('../../../', import.meta.url));
const repositoryRoot = path.resolve(desktopRoot, '..', '..');
const scripts = {
  core: path.join(desktopRoot, 'scripts/customer-marketing-packaged-safety-harness.cjs'),
  ui: path.join(desktopRoot, 'scripts/customer-marketing-packaged-ui-smoke.cjs'),
  preload: path.join(desktopRoot, 'scripts/customer-marketing-packaged-ui-preload.cjs'),
  runner: path.join(desktopRoot, 'scripts/run-customer-marketing-packaged-safety-suite.ps1'),
};

function readIfPresent(filePath: string): string {
  return existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
}

describe('MKT-04 packaged Customer Marketing safety suite contract', () => {
  it('ships every deterministic core, UI and orchestration entry point', () => {
    for (const filePath of Object.values(scripts)) {
      expect(existsSync(filePath), filePath).toBe(true);
    }
  });

  it('covers action, route, billing, recovery, model, secret and no-action gates', () => {
    const core = readIfPresent(scripts.core);
    expect(core).toContain("const SUITE_VERSION = 'mkt-04.v1'");
    expect(core).toContain('CUSTOMER_MARKETING_ACTION_GATE_EXECUTOR_ENABLED');
    expect(core).toContain('evaluateCustomerMarketingActionGate');
    expect(core).toContain('parseNativeMarketingProviderRoutes');
    expect(core).toContain('recoverStaleJobs');
    expect(core).toContain('billingQuotaReconciled');
    expect(core).toContain('modelDraftPendingApproval');
    expect(core).toContain('synthetic-secret-must-not-leak');
    expect(core).toContain("[https, 'request']");
    expect(core).toContain("[net, 'connect']");
    expect(core).toContain('externalActionsPerformed: 0');
  });

  it('renders packaged Marketing Room bytes at desktop and compact sizes without network', () => {
    const ui = readIfPresent(scripts.ui);
    const preload = readIfPresent(scripts.preload);
    const rendererIndex = readFileSync(path.join(desktopRoot, 'src/renderer/index.html'), 'utf8');
    expect(ui).toContain('onBeforeRequest');
    expect(ui).toContain("textContent?.trim() === 'Kênh'");
    expect(ui).toContain("document.querySelector('.cmr-provider-routes.is-ready')");
    expect(ui).toContain('width: 1280');
    expect(ui).toContain('height: 900');
    expect(ui).toContain('width: 390');
    expect(ui).toContain('height: 844');
    expect(ui).toContain('consoleErrorCount');
    expect(ui).toContain('externalActionsPerformed');
    expect(ui).toContain('externalActionsPerformed: observedCounters.externalActionsPerformed');
    expect(preload).toContain("contextBridge.exposeInMainWorld('electronAPI'");
    expect(preload).toContain('external-action-attempted');
    expect(preload).toContain('externalExecution: \'blocked\'');
    expect(rendererIndex).not.toMatch(/<link[^>]+href=["']https?:\/\//);
  });

  it('runs the source core in Windows CI and the packaged suite before release signing', () => {
    const packageJson = JSON.parse(readFileSync(path.join(desktopRoot, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    const desktopCi = readFileSync(
      path.join(repositoryRoot, '.github/workflows/desktop-ci.yml'),
      'utf8',
    );
    const release = readFileSync(
      path.join(repositoryRoot, '.github/workflows/release-desktop.yml'),
      'utf8',
    );
    const runner = readIfPresent(scripts.runner);

    expect(packageJson.scripts['test:marketing-safety-core']).toBe(
      'node scripts/customer-marketing-packaged-safety-harness.cjs .',
    );
    expect(desktopCi).toContain('name: Run Customer Marketing safety core');
    expect(desktopCi).toContain('test:marketing-safety-core');
    expect(release).toContain('name: Run packaged Customer Marketing safety suite');
    expect(release.indexOf('name: Run packaged Customer Marketing safety suite'))
      .toBeGreaterThan(release.indexOf('name: Package Windows'));
    expect(release.indexOf('name: Run packaged Customer Marketing safety suite'))
      .toBeLessThan(release.indexOf('name: Enforce Windows signing policy'));
    expect(runner).toContain("$start.Environment['ELECTRON_RUN_AS_NODE'] = '1'");
    expect(runner).toContain("$start.Environment['NODE_PATH'] = $desktopNodeModules");
    expect(runner).toContain('externalActionsPerformed');
    expect(runner).toContain('externalActionsPerformed = $observedExternalActions');
    expect(runner).toContain('secretLeakCount');
  });
});
