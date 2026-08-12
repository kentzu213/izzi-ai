import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('pins the workspace lint toolchain and entry points', () => {
  const rootPackage = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const desktopPackage = JSON.parse(readFileSync(
    join(ROOT, 'apps/desktop/package.json'),
    'utf8',
  ));

  assert.equal(rootPackage.scripts.lint, 'eslint .');
  assert.equal(rootPackage.scripts['lint:fix'], 'eslint . --fix');
  assert.equal(desktopPackage.scripts.lint, 'pnpm --dir ../.. exec eslint apps/desktop/src');
  assert.deepEqual(rootPackage.devDependencies, {
    '@eslint/js': '9.39.4',
    eslint: '9.39.4',
    'eslint-plugin-react-hooks': '7.1.1',
    globals: '17.9.0',
    typescript: '5.9.3',
    'typescript-eslint': '8.67.0',
  });
  assert.equal(rootPackage.pnpm.overrides['@babel/core'], '7.29.6');
  assert.equal(rootPackage.pnpm.overrides['brace-expansion@^1.0.0'], '1.1.18');
  assert.equal(rootPackage.pnpm.overrides['brace-expansion@^5.0.0'], '5.0.9');
});

test('keeps Node interop scoped away from renderer hook rules', async () => {
  const eslint = new ESLint({ cwd: ROOT });
  const mainConfig = await eslint.calculateConfigForFile(join(
    ROOT,
    'apps/desktop/src/main/extensions/extension-runner.ts',
  ));
  const rendererConfig = await eslint.calculateConfigForFile(join(
    ROOT,
    'apps/desktop/src/renderer/pages/CustomerMarketingRoom.tsx',
  ));

  assert.equal(mainConfig.rules['@typescript-eslint/no-unused-vars'][0], 2);
  assert.equal(mainConfig.rules['@typescript-eslint/no-require-imports'][0], 0);
  assert.equal(mainConfig.rules['react-hooks/rules-of-hooks'], undefined);
  assert.equal(rendererConfig.rules['react-hooks/rules-of-hooks'][0], 2);
  assert.equal(rendererConfig.rules['react-hooks/exhaustive-deps'][0], 2);
  assert.equal(rendererConfig.languageOptions.globals.window, false);
});

test('limits the migration baseline to the measured legacy findings', () => {
  const suppressions = JSON.parse(readFileSync(
    join(ROOT, 'eslint-suppressions.json'),
    'utf8',
  ));
  const allowedRules = new Set([
    '@typescript-eslint/no-unused-vars',
    'react-hooks/exhaustive-deps',
  ]);
  const totals = new Map();

  for (const [file, rules] of Object.entries(suppressions)) {
    assert.match(file, /^(apps|packages)\//);
    for (const [rule, metadata] of Object.entries(rules)) {
      assert.equal(allowedRules.has(rule), true, `${file} suppresses unexpected rule ${rule}`);
      totals.set(rule, (totals.get(rule) ?? 0) + metadata.count);
    }
  }

  assert.deepEqual(Object.fromEntries(totals), {
    '@typescript-eslint/no-unused-vars': 22,
    'react-hooks/exhaustive-deps': 7,
  });
});

test('rejects a new unused variable outside the suppression baseline', async () => {
  const eslint = new ESLint({ cwd: ROOT });
  const [result] = await eslint.lintText('const shouldFailLint = 1;\n', {
    filePath: join(ROOT, 'apps/desktop/src/main/__lint_probe__.ts'),
  });

  assert.equal(result.errorCount, 1);
  assert.equal(result.warningCount, 0);
  assert.deepEqual(result.messages.map((message) => message.ruleId), [
    '@typescript-eslint/no-unused-vars',
  ]);
});
