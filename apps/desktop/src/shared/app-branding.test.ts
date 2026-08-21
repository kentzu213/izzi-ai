import { createHash } from 'node:crypto';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import builderConfig from '../../electron-builder.json';
import desktopPackage from '../../package.json';
import { APP_ID, APP_NAME } from './app-branding';

const EXPECTED_ICON_HASHES = {
  ico: 'ac711a1557e15fa612cab7299442fb9d29e95170a8a303064f433eb6b126b1f9',
  png: '824807c15344b8d36a31cae66cd54ff77e15d12ecf100e21b4c243fcad0e5e4c',
} as const;

const SHARP_RUNTIME_DEPENDENCIES = {
  '@img/sharp-darwin-arm64': '0.35.3',
  '@img/sharp-darwin-x64': '0.35.3',
  '@img/sharp-libvips-darwin-arm64': '1.3.2',
  '@img/sharp-libvips-darwin-x64': '1.3.2',
  '@img/sharp-win32-x64': '0.35.3',
} as const;

const requireHere = createRequire(import.meta.url);

type AfterPackHook = (context: {
  appOutDir: string;
  arch: number;
  electronPlatformName: string;
  packager: { appInfo: { productFilename: string } };
}) => Promise<void>;

function sha256(url: URL): string {
  return createHash('sha256').update(readFileSync(url)).digest('hex');
}

function icoSizes(url: URL): number[] {
  const ico = readFileSync(url);
  const count = ico.readUInt16LE(4);
  return Array.from({ length: count }, (_, index) => {
    const width = ico[6 + index * 16];
    return width === 0 ? 256 : width;
  });
}

function writePackagedRuntime(
  resourcesDir: string,
  packages: Record<string, string[]>,
): void {
  for (const [packageName, nativeFiles] of Object.entries(packages)) {
    const packageDir = join(
      resourcesDir,
      'app.asar.unpacked',
      'node_modules',
      ...packageName.split('/'),
    );
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ name: packageName }));
    for (const nativeFile of nativeFiles) {
      const nativePath = join(packageDir, nativeFile);
      mkdirSync(join(nativePath, '..'), { recursive: true });
      writeFileSync(nativePath, 'native-runtime');
    }
  }
}

describe('Izzi AI desktop branding contract', () => {
  it('keeps visible package metadata aligned with the runtime brand', () => {
    expect(builderConfig.productName).toBe(APP_NAME);
    expect(builderConfig.appId).toBe(APP_ID);
    expect(builderConfig.nsis.shortcutName).toBe(APP_NAME);
    expect(builderConfig.linux.desktop.entry.Name).toBe(APP_NAME);
    expect(desktopPackage.description).toContain(APP_NAME);
  });

  it('pins the approved cyan S assets used by Windows packaging and runtime', () => {
    expect(builderConfig.win.icon).toBe('build/icon.ico');
    expect(builderConfig.nsis.installerIcon).toBe('build/icon.ico');
    const icoUrl = new URL('../../build/icon.ico', import.meta.url);
    expect(sha256(icoUrl)).toBe(EXPECTED_ICON_HASHES.ico);
    expect(icoSizes(icoUrl)).toEqual([16, 24, 32, 48, 64, 128, 256]);
    const mirroredIcoUrl = new URL('../../build/icons/icon.ico', import.meta.url);
    expect(sha256(mirroredIcoUrl)).toBe(EXPECTED_ICON_HASHES.ico);
    expect(icoSizes(mirroredIcoUrl)).toEqual([16, 24, 32, 48, 64, 128, 256]);
    expect(sha256(new URL('../../build/icon.png', import.meta.url))).toBe(EXPECTED_ICON_HASHES.png);
  });

  it('sets the Windows identity, title, and window icon without moving legacy user data', () => {
    const mainSource = readFileSync(new URL('../main/index.ts', import.meta.url), 'utf8');
    const logoSource = readFileSync(new URL('../renderer/components/AppIcons.tsx', import.meta.url), 'utf8');

    expect(mainSource).not.toContain('app.setName(');
    expect(mainSource).toContain('app.setAppUserModelId(APP_ID)');
    expect(mainSource).toContain('title: APP_NAME');
    expect(mainSource).toContain('...(appIcon ? { icon: appIcon } : {})');
    expect(logoSource).toContain('aria-label="Izzi AI logo"');
    expect(logoSource).not.toContain('Starizzi Logo');
  });

  it('publishes deterministic prereleases only after every platform asset exists', () => {
    const workflowSource = readFileSync(
      new URL('../../../../.github/workflows/release-desktop.yml', import.meta.url),
      'utf8',
    );
    const inventory = workflowSource.match(/\$requiredNames = @\(([\s\S]*?)\n\s*\)/)?.[1] ?? '';

    expect(builderConfig.detectUpdateChannel).toBe(true);
    expect(builderConfig.artifactName).toBe('Izzi-AI-${version}-${os}-${arch}.${ext}');
    expect(workflowSource).not.toContain('--publish always');
    expect(workflowSource.match(/--publish never/g)).toHaveLength(2);
    expect(workflowSource.match(/gh release upload/g)).toHaveLength(2);
    expect(workflowSource).toContain("if ($tag.Contains('-'))");
    expect(workflowSource).toContain("$arguments += '--prerelease'");
    expect(workflowSource).toContain("'--draft',");
    expect(workflowSource).toContain('already published; refusing to replace its assets');
    expect(workflowSource).toContain('needs: [build-windows, build-mac]');
    expect(inventory.match(/^\s+(?:"Izzi-AI|'latest)/gm)).toHaveLength(12);
    expect(workflowSource).toContain('if ($assets.Count -ne $requiredNames.Count)');
    expect(workflowSource).toContain('--repo $env:GITHUB_REPOSITORY --draft=false');
    expect(workflowSource).toContain('Enforce Windows signing policy');
    expect(workflowSource).toContain('Test Windows signing policy');
    expect(workflowSource).toContain('pnpm test:signing-policy');
    expect(workflowSource).toContain('verify-windows-signing-policy.ps1');
    expect(workflowSource).toContain('broadDistributionAllowed=$env:WINDOWS_BROAD_DISTRIBUTION_ALLOWED');
    expect(workflowSource).toContain('publishAllowed=$env:WINDOWS_PUBLISH_ALLOWED');
    expect(workflowSource).toContain("if ($env:WINDOWS_PUBLISH_ALLOWED -ne 'true')");
    expect(workflowSource).toContain('keeping the release draft for internal evaluation');
    expect(workflowSource.indexOf('Test Windows signing policy')).toBeLessThan(
      workflowSource.indexOf('Package Windows'),
    );
    expect(workflowSource.indexOf('Enforce Windows signing policy')).toBeLessThan(
      workflowSource.indexOf('Ensure GitHub release exists'),
    );
    const localBatchReleaseSource = readFileSync(
      new URL('../../scripts/release-win.bat', import.meta.url),
      'utf8',
    );
    const localPowerShellReleaseSource = readFileSync(
      new URL('../../scripts/release-win.ps1', import.meta.url),
      'utf8',
    );
    for (const localReleaseSource of [localBatchReleaseSource, localPowerShellReleaseSource]) {
      expect(localReleaseSource).not.toContain('--publish always');
      expect(localReleaseSource).toContain('--publish never');
    }
  });

  it('publishes unsigned prereleases only behind an explicit opt-in and never unsigned stables', () => {
    const workflowSource = readFileSync(
      new URL('../../../../.github/workflows/release-desktop.yml', import.meta.url),
      'utf8',
    );
    const policySource = readFileSync(
      new URL('../../scripts/verify-windows-signing-policy.ps1', import.meta.url),
      'utf8',
    );
    const policyTestSource = readFileSync(
      new URL('../../scripts/test-windows-signing-policy.ps1', import.meta.url),
      'utf8',
    );

    // The opt-in only ever reaches the verifier as an explicit repository variable.
    expect(workflowSource).toContain(
      'UNSIGNED_PRERELEASE_PUBLISH_OPT_IN: ${{ vars.ALLOW_UNSIGNED_PRERELEASE_PUBLISH }}',
    );
    expect(workflowSource).toContain('-UnsignedPrereleaseOptIn $optIn');
    expect(workflowSource).toContain('publish_allowed: ${{ steps.windows-signing-policy.outputs.publish_allowed }}');
    expect(workflowSource).toContain(
      'WINDOWS_PUBLISH_ALLOWED: ${{ needs.build-windows.outputs.publish_allowed }}',
    );
    expect(workflowSource).toContain(
      'Stable releases require a valid Authenticode signature before publication.',
    );

    // Stable Authenticode enforcement precedes (and is unaffected by) the opt-in.
    expect(policySource).toContain('[string]$UnsignedPrereleaseOptIn = ""');
    expect(policySource).toContain('$unsignedPublishOptIn = $UnsignedPrereleaseOptIn.Trim() -eq "true"');
    expect(policySource).toContain('requires Authenticode status Valid');
    expect(policySource).toContain('publishAllowed = $unsignedPublishOptIn');
    expect(policySource.indexOf('requires Authenticode status Valid')).toBeLessThan(
      policySource.indexOf('publishAllowed = $unsignedPublishOptIn'),
    );

    // Both branches of the opt-in are covered by the signing-policy self-test.
    expect(policyTestSource).toContain('Unsigned prerelease publish default mismatch');
    expect(policyTestSource).toContain('Unsigned prerelease opt-in publish mismatch');
    expect(policyTestSource).toContain('Unsigned stable release was not rejected under opt-in');
  });

  it('provisions target-native optional packages without a third-party Electron mirror', () => {
    const workflowSource = readFileSync(
      new URL('../../../../.github/workflows/release-desktop.yml', import.meta.url),
      'utf8',
    );
    const macJob = workflowSource.split('  build-mac:')[1] ?? '';

    expect(builderConfig).not.toHaveProperty('electronDownload');
    expect(workflowSource).not.toContain('pnpm config set supportedArchitectures');
    expect(macJob).toContain('npm pkg set --json');
    expect(macJob).toContain(`'pnpm.supportedArchitectures.os=["darwin"]'`);
    expect(macJob).toContain(`'pnpm.supportedArchitectures.cpu=["x64","arm64"]'`);
    expect(macJob.indexOf('npm pkg set --json')).toBeLessThan(macJob.indexOf('pnpm install --frozen-lockfile'));
  });

  it('keeps executable package dependencies together in the ASAR-unpacked runtime', () => {
    expect(builderConfig.asar).toBe(true);
    expect(builderConfig.asarUnpack).not.toContain('node_modules/**/*');
    for (const packageName of [
      '@esbuild/win32-x64',
      '@hono/node-server',
      '@img/sharp-win32-x64',
      '@puppeteer/browsers',
      'esbuild',
      'fontkit',
      'hono',
      'hyperframes',
      'postcss',
      'puppeteer-core',
      'sharp',
    ]) {
      expect(builderConfig.asarUnpack).toContain(`node_modules/${packageName}/**/*`);
    }
    expect(builderConfig.asarUnpack).toContain('dist/main/extensions/extension-runner.js');
  });

  it('includes and verifies Sharp native runtimes for every published desktop target', async () => {
    const optionalDependencies = (
      desktopPackage as typeof desktopPackage & {
        optionalDependencies?: Record<string, string>;
      }
    ).optionalDependencies;

    expect(optionalDependencies).toMatchObject(SHARP_RUNTIME_DEPENDENCIES);
    expect(builderConfig.afterPack).toBe('scripts/after-pack.cjs');
    for (const packageName of Object.keys(SHARP_RUNTIME_DEPENDENCIES)) {
      expect(builderConfig.asarUnpack).toContain(`node_modules/${packageName}/**/*`);
    }

    const { default: afterPack } = requireHere('../../scripts/after-pack.cjs') as {
      default: AfterPackHook;
    };
    const roots: string[] = [];
    const fixture = (
      platform: 'win32' | 'darwin',
      arch: 1 | 3,
      packages: Record<string, string[]>,
    ) => {
      const appOutDir = mkdtempSync(join(tmpdir(), 'izzi-after-pack-'));
      roots.push(appOutDir);
      const resourcesDir = platform === 'darwin'
        ? join(appOutDir, `${APP_NAME}.app`, 'Contents', 'Resources')
        : join(appOutDir, 'resources');
      writePackagedRuntime(resourcesDir, packages);
      return {
        appOutDir,
        arch,
        electronPlatformName: platform,
        packager: { appInfo: { productFilename: APP_NAME } },
      };
    };

    try {
      await expect(afterPack(fixture('win32', 1, {
        '@img/sharp-win32-x64': [
          'lib/sharp-win32-x64-0.35.3.node',
          'lib/libvips-42.dll',
        ],
      }))).resolves.toBeUndefined();
      await expect(afterPack(fixture('darwin', 1, {
        '@img/sharp-darwin-x64': ['lib/sharp-darwin-x64.node'],
        '@img/sharp-libvips-darwin-x64': ['lib/libvips-cpp.dylib'],
      }))).resolves.toBeUndefined();
      await expect(afterPack(fixture('darwin', 3, {
        '@img/sharp-darwin-arm64': ['lib/sharp-darwin-arm64.node'],
        '@img/sharp-libvips-darwin-arm64': ['lib/libvips-cpp.dylib'],
      }))).resolves.toBeUndefined();

      await expect(afterPack(fixture('darwin', 3, {
        '@img/sharp-darwin-arm64': ['lib/sharp-darwin-arm64.node'],
      }))).rejects.toThrow('@img/sharp-libvips-darwin-arm64');
    } finally {
      for (const root of roots) rmSync(root, { recursive: true, force: true });
    }
  });
});
