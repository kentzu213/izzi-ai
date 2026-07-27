import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';

/**
 * CMR-404 — coverage for the auto-update dependency path.
 *
 * `updater-service.test.ts` injects a fake adapter, so `electron-updater` and its two
 * security-relevant dependencies never execute there: `builder-util-runtime` (sha512 verification
 * of the downloaded artifact, HTTP plumbing) and `js-yaml` (parsing `latest.yml`, which declares
 * which file to download and its expected digest).
 *
 * Those two are exactly what a `pnpm.overrides` entry can silently swap. This suite resolves them
 * **the way electron-updater resolves them** — not via workspace hoisting — so it fails if an
 * override moves either package outside the range its parent declares, or drops an API that
 * electron-updater imports.
 */

const requireHere = createRequire(import.meta.url);
const electronUpdaterPkgPath = requireHere.resolve('electron-updater/package.json');
const electronUpdaterPkg = requireHere(electronUpdaterPkgPath) as {
  version: string;
  dependencies: Record<string, string>;
};
// Resolve from electron-updater's own location: this is the copy it would load at runtime.
const requireFromUpdater = createRequire(electronUpdaterPkgPath);

/** Every symbol electron-updater imports from builder-util-runtime (grepped from its `out/`). */
const REQUIRED_RUNTIME_EXPORTS = [
  'asArray',
  'CancellationError',
  'CancellationToken',
  'configureRequestOptions',
  'configureRequestUrl',
  'createHttpError',
  'CURRENT_APP_INSTALLER_FILE_NAME',
  'CURRENT_APP_PACKAGE_FILE_NAME',
  'DigestTransform',
  'getS3LikeProviderBaseUrl',
  'githubUrl',
  'HttpError',
  'HttpExecutor',
  'newError',
  'parseDn',
  'parseXml',
  'retry',
  'safeGetHeader',
  'safeStringifyJson',
  'UUID',
] as const;

/**
 * Versions this workspace deliberately overrides past the range a parent declares, because the
 * override closes a security advisory AND the behaviour below is asserted against it.
 *
 * `builder-util-runtime@9.7.0` fixes GHSA-p2f4-r6v6-j797 (high, CWE-200): before it, a
 * cross-origin redirect leaked `PRIVATE-TOKEN` and mixed-case `Authorization` headers. This app
 * publishes and updates through the GitHub provider, which is token-bearing, so that path is
 * reachable. `electron-updater@6.8.3` pins `builder-util-runtime` exactly at 9.5.1, so the fix can
 * only arrive through a `pnpm.overrides` entry.
 *
 * Anything NOT listed here still fails the range check — an accidental or unvetted bump does not
 * get a free pass. Adding an entry means: re-run this suite and the packaging smoke, and record the
 * evidence in docs/compliance/cmr-404-dependency-audit.md.
 */
const AUDITED_OVERRIDES: Record<string, readonly string[]> = {
  'builder-util-runtime': ['9.7.0'],
};

/**
 * Real semver, not a hand-rolled range check: a security gate should not depend on my own
 * approximation of range syntax. `semver` is resolved from electron-updater's own tree, so this
 * adds no dependency to the workspace.
 */
const semver = requireFromUpdater('semver') as {
  satisfies: (version: string, range: string) => boolean;
  gte: (a: string, b: string) => boolean;
  valid: (version: string) => string | null;
};

/**
 * Whether a resolved version is acceptable for a declared dependency range.
 * An explicitly audited override version is also accepted — see AUDITED_OVERRIDES.
 */
function satisfiesDeclared(name: string, declared: string, resolved: string): boolean {
  if (AUDITED_OVERRIDES[name]?.includes(resolved)) return true;
  return semver.satisfies(resolved, declared);
}

function resolvedVersionOf(name: string): string {
  const pkg = requireFromUpdater(`${name}/package.json`) as { version: string };
  return pkg.version;
}

describe('CMR-404 auto-update dependency contract', () => {
  it('resolves builder-util-runtime inside the range electron-updater declares', () => {
    const declared = electronUpdaterPkg.dependencies['builder-util-runtime'];
    const resolved = resolvedVersionOf('builder-util-runtime');

    expect(declared, 'electron-updater must declare builder-util-runtime').toBeTruthy();
    expect(
      satisfiesDeclared('builder-util-runtime', declared, resolved),
      `builder-util-runtime resolved to ${resolved} but electron-updater@${electronUpdaterPkg.version} declares "${declared}". `
      + 'An override outside that range changes the update-verification path — see docs/compliance/cmr-404-dependency-audit.md.',
    ).toBe(true);
  });

  it('resolves js-yaml inside the range electron-updater declares', () => {
    const declared = electronUpdaterPkg.dependencies['js-yaml'];
    const resolved = resolvedVersionOf('js-yaml');

    expect(declared, 'electron-updater must declare js-yaml').toBeTruthy();
    expect(
      satisfiesDeclared('js-yaml', declared, resolved),
      `js-yaml resolved to ${resolved} but electron-updater@${electronUpdaterPkg.version} declares "${declared}".`,
    ).toBe(true);
  });

  it('resolves a builder-util-runtime that carries the credential-leak fix', () => {
    // GHSA-p2f4-r6v6-j797 is patched in >=9.7.0. This app updates through the token-bearing GitHub
    // provider, so a regression below that floor re-opens the header leak. This is NOT tautological
    // with the override: if someone removes the `pnpm.overrides` entry, electron-updater's exact
    // 9.5.1 pin takes over again and this assertion is what catches it.
    const resolved = resolvedVersionOf('builder-util-runtime');

    expect(semver.valid(resolved), `unparseable version ${resolved}`).not.toBeNull();
    expect(
      semver.gte(resolved, '9.7.0'),
      `builder-util-runtime resolved to ${resolved}, below the 9.7.0 floor that fixes GHSA-p2f4-r6v6-j797 `
      + '(cross-origin redirect leaks PRIVATE-TOKEN / Authorization headers).',
    ).toBe(true);
  });

  it('resolves a js-yaml that carries the merge-key CPU-exhaustion fix', () => {
    // GHSA-52cp-r559-cp3m (high): js-yaml <4.3.0 lets chained YAML merge keys force quadratic CPU
    // consumption. This is the parser AppUpdater runs on `latest.yml`, i.e. content fetched from the
    // release host, so a hostile or compromised manifest reaches it. 4.3.0 stays inside the `^4.1.0`
    // range electron-updater declares, so no override exemption is needed — only a floor.
    const resolved = resolvedVersionOf('js-yaml');
    expect(semver.valid(resolved), `unparseable version ${resolved}`).not.toBeNull();
    expect(
      semver.gte(resolved, '4.3.0'),
      `js-yaml resolved to ${resolved}, below the 4.3.0 floor that fixes GHSA-52cp-r559-cp3m `
      + '(YAML merge-key chains force quadratic CPU consumption while parsing latest.yml).',
    ).toBe(true);
  });

  it('strips credential headers on a cross-origin redirect and keeps them same-origin', () => {
    // The security property itself, not just the version number: GHSA-p2f4-r6v6-j797 was a
    // cross-origin redirect forwarding `PRIVATE-TOKEN` and mixed-case `Authorization`. A future
    // 9.7.x that regressed this would still satisfy the version floor, so assert the behaviour.
    const { HttpExecutor } = requireFromUpdater('builder-util-runtime') as {
      HttpExecutor: {
        prepareRedirectUrlOptions: (
          redirectUrl: string,
          options: { protocol: string; hostname: string; path: string; headers: Record<string, string> },
        ) => { headers?: Record<string, string> };
      };
    };
    const origin = {
      protocol: 'https:',
      hostname: 'api.github.com',
      path: '/repos/kentzu213/starizzi-app/releases',
      headers: {
        'PRIVATE-TOKEN': 'must-not-leak',
        Authorization: 'Bearer must-not-leak',
        accept: 'application/json',
      },
    };

    const crossOrigin = HttpExecutor.prepareRedirectUrlOptions('https://evil.example/artifact', {
      ...origin,
      headers: { ...origin.headers },
    });
    expect(crossOrigin.headers?.['PRIVATE-TOKEN'], 'PRIVATE-TOKEN must not follow a cross-origin redirect').toBeUndefined();
    expect(crossOrigin.headers?.Authorization, 'Authorization must not follow a cross-origin redirect').toBeUndefined();
    // A non-credential header is fine to carry over; only secrets are stripped.
    expect(crossOrigin.headers?.accept).toBe('application/json');

    const sameOrigin = HttpExecutor.prepareRedirectUrlOptions('https://api.github.com/repos/x/assets/1', {
      ...origin,
      headers: { ...origin.headers },
    });
    expect(sameOrigin.headers?.Authorization, 'same-origin redirects must still authenticate').toBe('Bearer must-not-leak');
  });

  it('rejects a version outside the declared range unless it is explicitly audited', () => {
    // Guards the exemption mechanism itself: the allowlist must not degrade into "anything goes".
    const declaredExact = '9.5.1';

    expect(satisfiesDeclared('builder-util-runtime', declaredExact, '9.7.0')).toBe(true);   // audited
    expect(satisfiesDeclared('builder-util-runtime', declaredExact, '9.5.1')).toBe(true);   // the pin
    expect(satisfiesDeclared('builder-util-runtime', declaredExact, '9.8.0')).toBe(false);  // unvetted
    expect(satisfiesDeclared('builder-util-runtime', declaredExact, '10.0.0')).toBe(false); // major
    expect(satisfiesDeclared('js-yaml', '^4.1.0', '5.0.0')).toBe(false);
    expect(satisfiesDeclared('js-yaml', '^4.1.0', '4.3.0')).toBe(true);
  });

  it('still exports every symbol electron-updater imports', () => {
    const runtime = requireFromUpdater('builder-util-runtime') as Record<string, unknown>;
    const missing = REQUIRED_RUNTIME_EXPORTS.filter((name) => runtime[name] === undefined);

    expect(missing, `builder-util-runtime is missing exports electron-updater uses: ${missing.join(', ')}`).toEqual([]);
  });

  it('verifies a correct sha512 digest and rejects a tampered one', async () => {
    const { DigestTransform } = requireFromUpdater('builder-util-runtime') as {
      DigestTransform: new (expected: string, algorithm?: string, encoding?: string) => NodeJS.ReadWriteStream;
    };
    const payload = Buffer.from('izzi-openclaw-update-artifact');
    const expected = createHash('sha512').update(payload).digest('base64');

    const drain = (stream: NodeJS.ReadWriteStream): Promise<void> => new Promise((resolve, reject) => {
      stream.on('error', reject);
      stream.on('finish', () => resolve());
      stream.resume();
    });

    // Correct digest: the transform completes.
    const good = new DigestTransform(expected, 'sha512', 'base64');
    const goodDone = drain(good);
    Readable.from([payload]).pipe(good);
    await expect(goodDone).resolves.toBeUndefined();

    // Tampered digest: the transform must fail rather than pass the artifact through, and it must
    // fail *because of the checksum* — not because some unrelated stream error happened to occur.
    const wrong = createHash('sha512').update(Buffer.from('not-the-same-artifact')).digest('base64');
    const bad = new DigestTransform(wrong, 'sha512', 'base64');
    const badDone = drain(bad);
    Readable.from([payload]).pipe(bad);

    const failure = await badDone.then(() => null, (error: unknown) => error);
    expect(failure, 'a tampered artifact must not validate').toBeInstanceOf(Error);
    const message = (failure as Error).message;
    // The error has to name both digests, i.e. it is a checksum comparison failure.
    expect(message).toMatch(/checksum mismatch/i);
    expect(message).toContain(expected);
    expect(message).toContain(wrong);
  });

  it('parses a latest.yml update manifest the way AppUpdater does', () => {
    const yaml = requireFromUpdater('js-yaml') as { load: (input: string) => unknown };
    const manifest = yaml.load([
      'version: 1.12.0',
      'files:',
      '  - url: Izzi-OpenClaw-Setup-1.12.0.exe',
      '    sha512: 3q2+7wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
      '    size: 123456789',
      'path: Izzi-OpenClaw-Setup-1.12.0.exe',
      'sha512: 3q2+7wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
      'releaseDate: 2026-07-27T00:00:00.000Z',
      '',
    ].join('\n')) as {
      version: string;
      path: string;
      sha512: string;
      files: { url: string; sha512: string; size: number }[];
    };

    expect(manifest.version).toBe('1.12.0');
    expect(manifest.path).toBe('Izzi-OpenClaw-Setup-1.12.0.exe');
    expect(manifest.files).toHaveLength(1);
    expect(manifest.files[0].url).toBe('Izzi-OpenClaw-Setup-1.12.0.exe');
    expect(manifest.files[0].size).toBe(123456789);
    // The digest must survive parsing byte-for-byte: this is what the download is verified against.
    expect(manifest.files[0].sha512).toBe(manifest.sha512);
  });

  it('exposes working cancellation and error helpers', () => {
    const runtime = requireFromUpdater('builder-util-runtime') as {
      CancellationToken: new () => { cancelled: boolean; cancel: () => void; dispose: () => void };
      newError: (message: string, code: string) => Error & { code?: string };
      safeStringifyJson: (value: unknown) => string;
    };

    const token = new runtime.CancellationToken();
    expect(token.cancelled).toBe(false);
    token.cancel();
    expect(token.cancelled).toBe(true);
    token.dispose();

    const error = runtime.newError('update check failed', 'ERR_UPDATER_INVALID_UPDATE_INFO');
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe('ERR_UPDATER_INVALID_UPDATE_INFO');

    expect(runtime.safeStringifyJson({ version: '1.12.0' })).toContain('1.12.0');
  });
});
