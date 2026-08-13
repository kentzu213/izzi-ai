import path from 'node:path';

export const CUSTOMER_MARKETING_STAGING_PROFILE_ID = 'customer-marketing-staging' as const;

const STAGING_API_ORIGIN = 'https://marketing-staging.izziapi.com';
const STAGING_SUPABASE_REF = 'bogwhtnknhquxhktormu';
const STAGING_SUPABASE_ORIGIN = `https://${STAGING_SUPABASE_REF}.supabase.co`;
const STAGING_USER_DATA_DIRECTORY = 'IzziAI-Customer-Marketing-Staging';

export interface DesktopRuntimeProfile {
  id: 'default' | typeof CUSTOMER_MARKETING_STAGING_PROFILE_ID;
  customerMarketingStaging: boolean;
  registerProtocol: boolean;
  updaterEnabled: boolean;
  googleOAuthEnabled: boolean;
}

function normalizeOrigin(value: string | undefined): string {
  if (!value) return '';
  try {
    const url = new URL(value);
    return url.pathname === '/' && !url.search && !url.hash ? url.origin : '';
  } catch {
    return '';
  }
}

function decodeJwtClaims(value: string | undefined): Record<string, unknown> | null {
  if (!value) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  try {
    const parsed = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function readUserDataArgument(argv: readonly string[]): string | null {
  const prefix = '--user-data-dir=';
  const argument = argv.find((value) => value.toLowerCase().startsWith(prefix));
  if (!argument) return null;
  const value = argument.slice(prefix.length).trim().replace(/^"|"$/g, '');
  return path.isAbsolute(value) ? path.resolve(value) : null;
}

export function resolveDesktopRuntimeProfile(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv,
): DesktopRuntimeProfile {
  const requested = env.IZZI_DESKTOP_RUNTIME_PROFILE?.trim();
  if (!requested) {
    return {
      id: 'default',
      customerMarketingStaging: false,
      registerProtocol: true,
      updaterEnabled: true,
      googleOAuthEnabled: true,
    };
  }
  if (requested !== CUSTOMER_MARKETING_STAGING_PROFILE_ID) {
    throw new Error('Desktop runtime profile is not reviewed.');
  }

  const apiOrigin = normalizeOrigin(env.OPENCLAW_API_URL);
  const marketingOrigin = normalizeOrigin(env.STARIZZI_CUSTOMER_MARKETING_API_URL);
  const supabaseOrigin = normalizeOrigin(env.OPENCLAW_SUPABASE_URL);
  const claims = decodeJwtClaims(env.OPENCLAW_SUPABASE_ANON_KEY);
  const userDataPath = readUserDataArgument(argv);

  if (
    apiOrigin !== STAGING_API_ORIGIN
    || marketingOrigin !== STAGING_API_ORIGIN
    || env.STARIZZI_CUSTOMER_MARKETING_API_ENABLED !== 'true'
    || supabaseOrigin !== STAGING_SUPABASE_ORIGIN
  ) {
    throw new Error('Customer Marketing staging profile endpoints are invalid.');
  }
  if (claims?.role !== 'anon' || claims.ref !== STAGING_SUPABASE_REF) {
    throw new Error('Customer Marketing staging profile requires the reviewed Supabase anon client.');
  }
  if (!userDataPath || path.basename(userDataPath) !== STAGING_USER_DATA_DIRECTORY) {
    throw new Error('Customer Marketing staging profile requires isolated userData.');
  }

  return {
    id: CUSTOMER_MARKETING_STAGING_PROFILE_ID,
    customerMarketingStaging: true,
    registerProtocol: false,
    updaterEnabled: false,
    googleOAuthEnabled: false,
  };
}

export const DESKTOP_RUNTIME_PROFILE = resolveDesktopRuntimeProfile();
