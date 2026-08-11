import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const RENDERER_DIST = join(ROOT, 'apps', 'desktop', 'dist', 'renderer');
const ASSETS_DIR = join(RENDERER_DIST, 'assets');
const ENTRY_BUDGET_BYTES = 400_000;
const CHUNK_BUDGET_BYTES = 500_000;

function rendererJavaScript() {
  return readdirSync(ASSETS_DIR)
    .filter((file) => file.endsWith('.js'))
    .map((file) => ({ file, bytes: statSync(join(ASSETS_DIR, file)).size }));
}

test('keeps the renderer entry and every lazy chunk within budget', () => {
  const html = readFileSync(join(RENDERER_DIST, 'index.html'), 'utf8');
  const entrySource = html.match(/<script[^>]+src="([^"]+\.js)"/)?.[1];
  assert.ok(entrySource, 'renderer index.html must reference a JavaScript entry');

  const chunks = rendererJavaScript();
  const entry = chunks.find((chunk) => chunk.file === basename(entrySource));
  assert.ok(entry, `renderer entry ${entrySource} must exist in the asset directory`);
  assert.ok(
    entry.bytes <= ENTRY_BUDGET_BYTES,
    `renderer entry ${entry.file} is ${entry.bytes} bytes; budget is ${ENTRY_BUDGET_BYTES}`,
  );

  const oversized = chunks.filter((chunk) => chunk.bytes > CHUNK_BUDGET_BYTES);
  assert.deepEqual(
    oversized,
    [],
    `renderer chunks must stay at or below ${CHUNK_BUDGET_BYTES} bytes`,
  );
});

test('runs the renderer budget after build and before test or packaging gates', () => {
  const rootPackage = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const desktopCi = readFileSync(join(ROOT, '.github', 'workflows', 'desktop-ci.yml'), 'utf8');
  const releaseDesktop = readFileSync(
    join(ROOT, '.github', 'workflows', 'release-desktop.yml'),
    'utf8',
  );

  assert.equal(
    rootPackage.scripts['test:renderer-budget'],
    'node --test tools/renderer-bundle-budget.test.mjs',
  );

  const ciBudget = desktopCi.indexOf('run: pnpm test:renderer-budget');
  assert.ok(ciBudget > desktopCi.indexOf('name: Build workspace'));
  assert.ok(ciBudget < desktopCi.indexOf('name: Run desktop smoke tests'));

  const releaseBudget = releaseDesktop.indexOf('run: pnpm test:renderer-budget');
  assert.ok(releaseBudget > releaseDesktop.indexOf('name: Build desktop app'));
  assert.ok(releaseBudget < releaseDesktop.indexOf('name: Run desktop tests'));
  assert.ok(releaseBudget < releaseDesktop.indexOf('name: Package Windows'));
});
