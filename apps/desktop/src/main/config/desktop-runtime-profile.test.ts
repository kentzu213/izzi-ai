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

describe('desktop runtime profile', () => {
  it('keeps the default desktop protocol, updater and OAuth behavior unchanged', () => {
    expect(resolveDesktopRuntimeProfile({}, [])).toEqual({
      id: 'default',
      customerMarketingStaging: false,
      registerProtocol: true,
      updaterEnabled: true,
      googleOAuthEnabled: true,
    });
  });

  it('accepts only the reviewed staging origins, public anon role and isolated userData', () => {
    const userData = path.resolve('C:/Users/Public/IzziAI-Customer-Marketing-Staging');
    expect(resolveDesktopRuntimeProfile(stagingEnv(), [`--user-data-dir=${userData}`])).toEqual({
      id: CUSTOMER_MARKETING_STAGING_PROFILE_ID,
      customerMarketingStaging: true,
      registerProtocol: false,
      updaterEnabled: false,
      googleOAuthEnabled: false,
    });
  });

  it.each([
    ['production API', { OPENCLAW_API_URL: 'https://api.izziapi.com' }],
    ['different Marketing API', { STARIZZI_CUSTOMER_MARKETING_API_URL: 'https://example.com' }],
    ['disabled bridge', { STARIZZI_CUSTOMER_MARKETING_API_ENABLED: 'false' }],
    ['different Supabase project', { OPENCLAW_SUPABASE_URL: 'https://other.supabase.co' }],
  ])('rejects %s in the staging profile', (_label, override) => {
    expect(() => resolveDesktopRuntimeProfile(
      { ...stagingEnv(), ...override },
      ['--user-data-dir=C:/Users/Public/IzziAI-Customer-Marketing-Staging'],
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
      ['--user-data-dir=C:/Users/Public/IzziAI-Customer-Marketing-Staging'],
    )).toThrow(/anon/i);
    expect(() => resolveDesktopRuntimeProfile(
      stagingEnv(),
      ['--user-data-dir=C:/Users/owner/AppData/Roaming/@openclaw'],
    )).toThrow(/userData/i);
  });

  it('rejects unknown named profiles', () => {
    expect(() => resolveDesktopRuntimeProfile(
      { IZZI_DESKTOP_RUNTIME_PROFILE: 'unreviewed' },
      [],
    )).toThrow(/not reviewed/i);
  });
});
