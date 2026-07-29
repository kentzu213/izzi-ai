import { describe, expect, it } from 'vitest';
import { secretRef } from '../personal-office';
import {
  assertAllowedUrl,
  assertNoCredentialFields,
  RuntimeValidationError,
  validateRuntimeSpec,
} from './validation';
import type { BrowserRuntimeSpec, NativeRuntimeSpec } from './types';

const root = process.platform === 'win32' ? 'C:\\izzi\\workspace' : '/izzi/workspace';
const native: NativeRuntimeSpec = {
  schemaVersion: 1,
  id: 'runtime.native.test',
  kind: 'binary',
  authority: {
    tenantId: 'tenant-1',
    userId: 'user-1',
    workspaceId: 'workspace-1',
    packageId: 'package-1',
    integrationId: 'native-test',
    grantId: 'grant-1',
  },
  paths: {
    workDir: `${root}${process.platform === 'win32' ? '\\work' : '/work'}`,
    tempDir: `${root}${process.platform === 'win32' ? '\\tmp' : '/tmp'}`,
    uploadDir: `${root}${process.platform === 'win32' ? '\\uploads' : '/uploads'}`,
    downloadDir: `${root}${process.platform === 'win32' ? '\\downloads' : '/downloads'}`,
    allowedRoots: [root],
  },
  network: { mode: 'deny', bindHost: '127.0.0.1', allowedOrigins: [], allowedPorts: [] },
  budget: { cpuPercent: 50, memoryMb: 512, diskMb: 1024, timeoutMs: 30_000 },
  env: [{ name: 'API_TOKEN', secret: secretRef('os_keychain', 'runtime/test') }],
  executable: process.platform === 'win32' ? 'C:\\Program Files\\Izzi\\tool.exe' : '/opt/izzi/tool',
  args: ['--safe'],
  executableSha256: `sha256:${'a'.repeat(64)}`,
};

describe('runtime validation', () => {
  it('rejects traversal outside owned roots', () => {
    expect(() =>
      validateRuntimeSpec({
        ...native,
        paths: { ...native.paths, workDir: `${root}${process.platform === 'win32' ? '\\..\\escape' : '/../escape'}` },
      }),
    ).toThrow(RuntimeValidationError);
  });

  it('keeps metacharacters as array arguments but rejects control-character injection', () => {
    expect(validateRuntimeSpec({ ...native, args: ['hello;still-one-arg'] })).toBeTruthy();
    expect(() => validateRuntimeSpec({ ...native, args: ['ok\nwhoami'] })).toThrow(
      'control characters',
    );
  });

  it('denies a native executable without a verified digest', () => {
    expect(() => validateRuntimeSpec({ ...native, executableSha256: 'unknown' })).toThrow(
      'digest',
    );
  });

  it('does not accept raw environment values', () => {
    expect(() =>
      validateRuntimeSpec({
        ...native,
        env: [{ name: 'TOKEN', secret: 'plain-secret' as never }],
      }),
    ).toThrow('Raw env value');
  });

  it('revalidates exact origins and final redirects', () => {
    const policy = {
      mode: 'allowlist' as const,
      bindHost: '127.0.0.1',
      allowedOrigins: ['http://127.0.0.1:43111'],
      allowedPorts: [43111],
    };
    expect(assertAllowedUrl('http://127.0.0.1:43111/read', policy).pathname).toBe('/read');
    for (const escaped of [
      'http://127.0.0.1.evil.test:43111/read',
      'http://user@127.0.0.1:43111/read',
      'http://127.0.0.1:43112/read',
      'https://127.0.0.1:43111/read',
    ]) {
      expect(() => assertAllowedUrl(escaped, policy)).toThrow(RuntimeValidationError);
    }
  });

  it('rejects password, MFA, recovery and key fields recursively', () => {
    for (const input of [
      { password: 'x' },
      { profile: { mfaCode: '123456' } },
      { recovery_code: 'x' },
      { apiKey: 'x' },
    ]) {
      expect(() => assertNoCredentialFields(input)).toThrow('Credential field');
    }
  });

  it('requires encrypted-state reference and an allowlist for browser runtimes', () => {
    const browser: BrowserRuntimeSpec = {
      ...native,
      id: 'runtime.browser.test',
      kind: 'browser',
      network: {
        mode: 'allowlist',
        bindHost: '127.0.0.1',
        allowedOrigins: ['http://127.0.0.1:43111'],
        allowedPorts: [43111],
      },
      storageStateRef: secretRef('encrypted_file', 'browser/workspace-1/test'),
      visibleReviewMode: false,
      authority: {
        ...native.authority,
        integrationId: 'browser-test',
        runId: 'run-1',
      },
    };
    delete (browser as Partial<NativeRuntimeSpec>).executable;
    delete (browser as Partial<NativeRuntimeSpec>).args;
    delete (browser as Partial<NativeRuntimeSpec>).executableSha256;
    expect(validateRuntimeSpec(browser)).toBe(browser);
    expect(() =>
      validateRuntimeSpec({
        ...browser,
        network: { mode: 'deny', bindHost: '127.0.0.1', allowedOrigins: [], allowedPorts: [] },
      }),
    ).toThrow('allowlist');
  });

  it('rejects non-loopback runtime binds', () => {
    expect(() =>
      validateRuntimeSpec({
        ...native,
        network: { ...native.network, bindHost: '0.0.0.0' },
      }),
    ).toThrow('loopback');
  });

  it('requires exact integration/grant identities and browser run identity', () => {
    expect(() => validateRuntimeSpec({
      ...native,
      authority: { ...native.authority, integrationId: '' },
    })).toThrow('integrationId');
    expect(() => validateRuntimeSpec({
      ...native,
      authority: { ...native.authority, grantId: '' },
    })).toThrow('grantId');
    const browser = {
      ...native,
      id: 'runtime.browser.run-bound',
      kind: 'browser' as const,
      authority: { ...native.authority, integrationId: 'browser-test' },
      network: {
        mode: 'allowlist' as const,
        bindHost: '127.0.0.1',
        allowedOrigins: ['http://127.0.0.1:43111'],
        allowedPorts: [43111],
      },
      storageStateRef: secretRef('encrypted_file', 'browser/workspace-1/test'),
      visibleReviewMode: false,
    };
    delete (browser as Partial<NativeRuntimeSpec>).executable;
    delete (browser as Partial<NativeRuntimeSpec>).args;
    delete (browser as Partial<NativeRuntimeSpec>).executableSha256;
    expect(() => validateRuntimeSpec(browser)).toThrow('runId');
  });
});
