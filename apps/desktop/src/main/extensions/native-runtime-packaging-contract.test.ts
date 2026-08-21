import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const desktopRoot = fileURLToPath(new URL('../../../', import.meta.url));
const packageJson = JSON.parse(readFileSync(`${desktopRoot}/package.json`, 'utf8'));
const afterPack = readFileSync(`${desktopRoot}/scripts/after-pack.cjs`, 'utf8');
const desktopMain = readFileSync(`${desktopRoot}/src/main/index.ts`, 'utf8');
const releaseWorkflow = readFileSync(`${desktopRoot}/../../.github/workflows/release-desktop.yml`, 'utf8');

describe('packaged native runtime contract', () => {
  it('rebuilds better-sqlite3 explicitly for the pinned Electron runtime', () => {
    expect(packageJson.devDependencies['@electron/rebuild']).toBe('4.2.0');
    expect(packageJson.scripts['rebuild:native:electron']).toContain(
      'electron-rebuild -f -w better-sqlite3 -v 39.8.10',
    );
    for (const scriptName of ['pack', 'dist', 'build:win']) {
      expect(packageJson.scripts[scriptName]).toContain('pnpm rebuild:native:electron');
      expect(packageJson.scripts[scriptName]).toContain('--config.npmRebuild=false');
    }
    expect(packageJson.scripts['build:mac']).not.toContain('rebuild:native:electron');
  });

  it('rebuilds explicitly in the Windows release job and leaves macOS per-arch rebuilds enabled', () => {
    expect((releaseWorkflow.match(/pnpm rebuild:native:electron/g) || [])).toHaveLength(1);
    expect((releaseWorkflow.match(/--config\.npmRebuild=false/g) || [])).toHaveLength(1);
    expect(releaseWorkflow).toContain('npx electron-builder --mac --config electron-builder.json --publish never');
  });

  it('fails afterPack unless the packaged Electron executable starts its native smoke mode', () => {
    expect(desktopMain).toContain("const NATIVE_RUNTIME_SMOKE_ARG = '--izzi-native-runtime-smoke'");
    expect(desktopMain).toContain('const nativeRuntimeSmoke = process.argv.includes(NATIVE_RUNTIME_SMOKE_ARG)');
    expect(desktopMain).toContain('if (!nativeRuntimeSmoke && DESKTOP_RUNTIME_PROFILE.registerProtocol)');
    expect(afterPack).toContain('const smoke = spawnSync(executablePath, [');
    expect(afterPack).toContain("'--izzi-native-runtime-smoke'");
    expect(afterPack).toContain('Packaged Electron native runtime smoke failed');
  });
});
