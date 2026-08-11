import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import rootPackage from '../../../../package.json';

const requireHere = createRequire(import.meta.url);
const requireFromBuilder = createRequire(requireHere.resolve('electron-builder/package.json'));
const requireFromAppBuilder = createRequire(requireFromBuilder.resolve('app-builder-lib/package.json'));
const requireFromConcurrently = createRequire(requireHere.resolve('concurrently/package.json'));
const requireFromVite = createRequire(requireHere.resolve('vite/package.json'));
const requireFromTsx = createRequire(requireFromVite.resolve('tsx/package.json'));

function resolvedVersion(
  scopedRequire: NodeJS.Require,
  packageName: string,
): string {
  return (scopedRequire(`${packageName}/package.json`) as { version: string }).version;
}

describe('desktop release-toolchain dependency override contract', () => {
  it('pins and resolves each audited override through its real consumer', () => {
    expect(rootPackage.pnpm.overrides).toMatchObject({
      '@xmldom/xmldom': '0.8.13',
      'shell-quote': '1.10.0',
      tar: '7.5.22',
      tmp: '0.2.7',
      'tsx>esbuild': '0.28.2',
    });

    expect(resolvedVersion(requireFromAppBuilder, '@xmldom/xmldom')).toBe('0.8.13');
    expect(resolvedVersion(requireFromConcurrently, 'shell-quote')).toBe('1.10.0');
    expect(resolvedVersion(requireFromAppBuilder, 'tar')).toBe('7.5.22');
    expect(resolvedVersion(requireFromAppBuilder, 'tmp')).toBe('0.2.7');
    expect(resolvedVersion(requireFromTsx, 'esbuild')).toBe('0.28.2');
  });

  it('keeps the overridden parser and build-tool APIs compatible', () => {
    const { DOMParser } = requireFromAppBuilder('@xmldom/xmldom') as {
      DOMParser: new () => { parseFromString: (xml: string, mime: string) => Document };
    };
    const shellQuote = requireFromConcurrently('shell-quote') as {
      parse: (command: string) => unknown[];
    };
    const tar = requireFromAppBuilder('tar') as Record<string, unknown>;
    const tmp = requireFromAppBuilder('tmp') as Record<string, unknown>;
    const esbuild = requireFromTsx('esbuild') as {
      transformSync: (source: string, options: { loader: string }) => { code: string };
    };

    const document = new DOMParser().parseFromString('<update><version>27</version></update>', 'text/xml');
    expect(document.documentElement.tagName).toBe('update');
    expect(shellQuote.parse('echo "izzi ai"')).toEqual(['echo', 'izzi ai']);
    expect(typeof tar.create).toBe('function');
    expect(typeof tar.extract).toBe('function');
    expect(typeof tmp.dirSync).toBe('function');
    expect(esbuild.transformSync('const answer: number = 42;', { loader: 'ts' }).code)
      .toContain('const answer = 42');
  });
});
