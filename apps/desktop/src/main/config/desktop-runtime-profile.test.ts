import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_MARKETING_STAGING_PROFILE_ID,
  resolveDesktopRuntimeProfile,
} from './desktop-runtime-profile';

const STAGING_ANON_KEY = [
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
  Buffer.from(JSON.stringify({
    iss: 'supabase',
    ref: 'bogwhtnknhquxhktormu',
    role: 'anon',
  })).toString('base64url'),
  'test-signature',
].join('.');

function stagingEnv(): NodeJS.ProcessEnv {
  return {
    IZZI_DESKTOP_RUNTIME_PROFILE: CUSTOMER_MARKETING_STAGING_PROFILE_ID,
    OPENCLAW_API_URL: 'https://marketing-staging.izziapi.com',
    OPENCLAW_SUPABASE_URL: 'https://bogwhtnknhquxhktormu.supabase.co',
    OPENCLAW_SUPABASE_ANON_KEY: STAGING_ANON_KEY,
    STARIZZI_CUSTOMER_MARKETING_API_ENABLED: 'true',
    STARIZZI_CUSTOMER_MARKETING_API_URL: 'https://marketing-staging.izziapi.com',
  };
}

const STAGING_PROFILE_ARGUMENT = `--izzi-runtime-profile=${CUSTOMER_MARKETING_STAGING_PROFILE_ID}`;

describe('desktop runtime profile', () => {
  it('keeps the default desktop protocol, updater and OAuth behavior unchanged', () => {
    expect(resolveDesktopRuntimeProfile({}, [])).toEqual({
      id: 'default',
      customerMarketingStaging: false,
      marketingApiBaseUrl: null,
      userDataPath: null,
      singleInstanceLock: true,
      registerProtocol: true,
      updaterEnabled: true,
      googleOAuthEnabled: true,
    });
  });

  it('accepts only the reviewed staging origins, public anon role and isolated userData', () => {
    const userData = path.resolve('C:/Users/Public/IzziAI-Customer-Marketing-Staging');
    expect(resolveDesktopRuntimeProfile(stagingEnv(), [], {
      runtimeProfile: CUSTOMER_MARKETING_STAGING_PROFILE_ID,
      userDataDir: userData,
    })).toEqual({
      id: CUSTOMER_MARKETING_STAGING_PROFILE_ID,
      customerMarketingStaging: true,
      marketingApiBaseUrl: 'https://marketing-staging.izziapi.com',
      userDataPath: userData,
      singleInstanceLock: false,
      registerProtocol: false,
      updaterEnabled: false,
      googleOAuthEnabled: false,
    });
  });

  it('applies isolated Electron userData before the shared instance lock', () => {
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'index.ts'),
      'utf8',
    );
    const setPath = source.indexOf("app.setPath('userData', DESKTOP_RUNTIME_PROFILE.userDataPath)");
    const lock = source.indexOf('app.requestSingleInstanceLock()');
    expect(setPath).toBeGreaterThanOrEqual(0);
    expect(lock).toBeGreaterThan(setPath);
    expect(source).toMatch(/app\.commandLine\.getSwitchValue\('izzi-runtime-profile'\)/);
    expect(source).toMatch(/app\.commandLine\.getSwitchValue\('user-data-dir'\)/);
    expect(source).toMatch(/app\.commandLine\.getSwitchValue\('izzi-marketing-recorder-port'\)/);
    expect(source).toMatch(/DESKTOP_RUNTIME_PROFILE\.singleInstanceLock\s*\?\s*app\.requestSingleInstanceLock\(\)/);
  });

  it('makes bootstrap failures observable instead of leaving a headless process', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'index.ts'), 'utf8');
    expect(source).toMatch(/\[Bootstrap\] Desktop runtime profile failed:/);
    expect(source).toMatch(/app\.whenReady\(\)\.then[\s\S]*\.catch\(\(error: unknown\)/);
    expect(source).toMatch(/\[Bootstrap\] Desktop startup failed:/);
    expect(source).toMatch(/app\.exit\(1\)/);
  });

  it.each([
    ['production API', { OPENCLAW_API_URL: 'https://api.izziapi.com' }],
    ['different Marketing API', { STARIZZI_CUSTOMER_MARKETING_API_URL: 'https://example.com' }],
    ['disabled bridge', { STARIZZI_CUSTOMER_MARKETING_API_ENABLED: 'false' }],
    ['different Supabase project', { OPENCLAW_SUPABASE_URL: 'https://other.supabase.co' }],
  ])('rejects %s in the staging profile', (_label, override) => {
    expect(() => resolveDesktopRuntimeProfile(
      { ...stagingEnv(), ...override },
      [STAGING_PROFILE_ARGUMENT, '--user-data-dir=C:/Users/Public/IzziAI-Customer-Marketing-Staging'],
    )).toThrow(/staging profile/i);
  });

  it('rejects service-role JWTs and non-isolated profile paths', () => {
    const serviceRoleKey = [
      'header',
      Buffer.from(JSON.stringify({ ref: 'bogwhtnknhquxhktormu', role: 'service_role' })).toString('base64url'),
      'signature',
    ].join('.');
    expect(() => resolveDesktopRuntimeProfile(
      { ...stagingEnv(), OPENCLAW_SUPABASE_ANON_KEY: serviceRoleKey },
      [STAGING_PROFILE_ARGUMENT, '--user-data-dir=C:/Users/Public/IzziAI-Customer-Marketing-Staging'],
    )).toThrow(/anon/i);
    expect(() => resolveDesktopRuntimeProfile(
      stagingEnv(),
      [STAGING_PROFILE_ARGUMENT, '--user-data-dir=C:/Users/owner/AppData/Roaming/@openclaw'],
    )).toThrow(/userData/i);
  });

  it('rejects unknown named profiles', () => {
    expect(() => resolveDesktopRuntimeProfile(
      {},
      ['--izzi-runtime-profile=unreviewed'],
    )).toThrow(/not reviewed/i);
  });

  it('accepts the public CLI selector and rejects a conflicting environment selector', () => {
    const userData = path.resolve('IzziAI-Customer-Marketing-Staging');
    const env = stagingEnv();
    delete env.IZZI_DESKTOP_RUNTIME_PROFILE;
    expect(resolveDesktopRuntimeProfile(env, [STAGING_PROFILE_ARGUMENT, `--user-data-dir=${userData}`]).id)
      .toBe(CUSTOMER_MARKETING_STAGING_PROFILE_ID);
    expect(() => resolveDesktopRuntimeProfile(
      { ...env, IZZI_DESKTOP_RUNTIME_PROFILE: 'default' },
      [STAGING_PROFILE_ARGUMENT, `--user-data-dir=${userData}`],
    )).toThrow(/conflict/i);
  });

  it('uses Electron native switches and rejects conflicting native and argv selectors', () => {
    const userData = path.resolve('C:/Users/Public/IzziAI-Customer-Marketing-Staging');
    expect(resolveDesktopRuntimeProfile(stagingEnv(), [], {
      runtimeProfile: CUSTOMER_MARKETING_STAGING_PROFILE_ID,
      userDataDir: userData,
    }).userDataPath).toBe(userData);
    expect(() => resolveDesktopRuntimeProfile(stagingEnv(), [STAGING_PROFILE_ARGUMENT], {
      runtimeProfile: 'default',
      userDataDir: userData,
    })).toThrow(/conflict/i);
  });

  it('does not activate a privileged profile from environment variables alone', () => {
    expect(() => resolveDesktopRuntimeProfile(stagingEnv(), [])).toThrow(/explicit/i);
  });

  it('allows only a bounded loopback recorder port inside the reviewed staging profile', () => {
    const userData = path.resolve('C:/Users/Public/IzziAI-Customer-Marketing-Staging');
    expect(resolveDesktopRuntimeProfile(stagingEnv(), [], {
      runtimeProfile: CUSTOMER_MARKETING_STAGING_PROFILE_ID,
      userDataDir: userData,
      marketingRecorderPort: '43123',
    }).marketingApiBaseUrl).toBe('http://127.0.0.1:43123');
    expect(() => resolveDesktopRuntimeProfile(stagingEnv(), [], {
      runtimeProfile: CUSTOMER_MARKETING_STAGING_PROFILE_ID,
      userDataDir: userData,
      marketingRecorderPort: 'example.com',
    })).toThrow(/recorder port/i);
  });
});
