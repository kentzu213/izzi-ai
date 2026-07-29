import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import builderConfig from '../../electron-builder.json';
import desktopPackage from '../../package.json';
import { APP_ID, APP_NAME } from './app-branding';

const EXPECTED_ICON_HASHES = {
  ico: 'ac711a1557e15fa612cab7299442fb9d29e95170a8a303064f433eb6b126b1f9',
  png: '824807c15344b8d36a31cae66cd54ff77e15d12ecf100e21b4c243fcad0e5e4c',
} as const;

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

describe('Izzi AI desktop branding contract', () => {
  it('keeps visible package metadata aligned with the runtime brand', () => {
    expect(builderConfig.productName).toBe(APP_NAME);
    expect(builderConfig.appId).toBe(APP_ID);
    expect(builderConfig.nsis.shortcutName).toBe(APP_NAME);
    expect(builderConfig.linux.desktop.Name).toBe(APP_NAME);
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

  it('requires a manual, version-matched draft or prerelease workflow', () => {
    const workflowSource = readFileSync(
      new URL('../../../../.github/workflows/release-desktop.yml', import.meta.url),
      'utf8',
    );

    expect(builderConfig.detectUpdateChannel).toBe(true);
    expect(builderConfig.publish.releaseType).toBe('draft');
    expect(workflowSource).toMatch(/^ {2}workflow_dispatch:$/m);
    expect(workflowSource).not.toMatch(/^ {2}push:$/m);
    expect(workflowSource).toContain('if: ${{ inputs.confirm_publish == true }}');
    expect(workflowSource).toContain('          - draft');
    expect(workflowSource).toContain('          - prerelease');
    expect(workflowSource.match(/ref: refs\/tags\/\$\{\{ inputs\.release_tag \}\}/g)).toHaveLength(3);
    expect(workflowSource.match(/persist-credentials: false/g)).toHaveLength(3);
    expect(workflowSource.match(/git show-ref --verify --quiet "\$TAG_REF"/g)).toHaveLength(3);
    expect(workflowSource.match(/git rev-parse "\$\{TAG_REF\}\^\{commit\}"/g)).toHaveLength(3);
    expect(workflowSource.match(/git rev-parse HEAD/g)).toHaveLength(3);
    expect(workflowSource.match(/require\('\.\/apps\/desktop\/package\.json'\)\.version/g)).toHaveLength(
      3,
    );
    expect(workflowSource.match(/TAG_VERSION="\$\{RELEASE_TAG#v\}"/g)).toHaveLength(3);
    expect(workflowSource).toContain('WINDOWS_CSC_LINK: ${{ secrets.WINDOWS_CSC_LINK }}');
    expect(workflowSource).toContain(
      'WINDOWS_CSC_KEY_PASSWORD: ${{ secrets.WINDOWS_CSC_KEY_PASSWORD }}',
    );
    expect(workflowSource).toContain('CSC_LINK: ${{ secrets.WINDOWS_CSC_LINK }}');
    expect(workflowSource).toContain(
      'CSC_KEY_PASSWORD: ${{ secrets.WINDOWS_CSC_KEY_PASSWORD }}',
    );
    expect(workflowSource.match(/EP_DRAFT:/g)).toHaveLength(2);
    expect(workflowSource.match(/EP_PRE_RELEASE:/g)).toHaveLength(2);
  });

  it('keeps local Windows release helpers packaging-only', () => {
    const powershellSource = readFileSync(
      new URL('../../scripts/release-win.ps1', import.meta.url),
      'utf8',
    );
    const batchSource = readFileSync(new URL('../../scripts/release-win.bat', import.meta.url), 'utf8');

    for (const source of [powershellSource, batchSource]) {
      expect(source).toContain('--publish never');
      expect(source).not.toContain('--publish always');
      expect(source).not.toContain('GH_TOKEN');
    }
  });
});
