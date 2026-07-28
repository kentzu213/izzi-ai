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
});
