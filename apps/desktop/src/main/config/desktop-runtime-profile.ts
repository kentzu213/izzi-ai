import path from 'node:path';

export const CUSTOMER_MARKETING_STAGING_PROFILE_ID = 'customer-marketing-staging' as const;
export const CUSTOMER_MARKETING_LOCAL_STAGING_PROFILE_ID = 'customer-marketing-local-staging' as const;

const STAGING_API_ORIGIN = 'https://marketing-staging.izziapi.com';
const STAGING_SUPABASE_REF = 'bogwhtnknhquxhktormu';
const STAGING_SUPABASE_ORIGIN = `https://${STAGING_SUPABASE_REF}.supabase.co`;
const STAGING_USER_DATA_DIRECTORY = 'IzziAI-Customer-Marketing-Staging';
const LOCAL_STAGING_USER_DATA_DIRECTORY = 'IzziAI-Customer-Marketing-Local-Staging';

export interface DesktopRuntimeProfile {
  id: 'default'
    | typeof CUSTOMER_MARKETING_STAGING_PROFILE_ID
    | typeof CUSTOMER_MARKETING_LOCAL_STAGING_PROFILE_ID;
  customerMarketingStaging: boolean;
  marketingApiBaseUrl: string | null;
  userDataPath: string | null;
  singleInstanceLock: boolean;
  registerProtocol: boolean;
  updaterEnabled: boolean;
  googleOAuthEnabled: boolean;
}

export interface DesktopRuntimeSwitches {
  runtimeProfile?: string;
  userDataDir?: string;
  marketingRecorderPort?: string;
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

function normalizeLoopbackOrigin(value: string | undefined): string {
  if (!value) return '';
  try {
    const url = new URL(value);
    const port = Number(url.port);
    return url.protocol === 'http:'
      && url.hostname === '127.0.0.1'
      && !url.username
      && !url.password
      && url.pathname === '/'
      && !url.search
      && !url.hash
      && Number.isInteger(port)
      && port >= 1_024
      && port <= 65_535
      ? url.origin
      : '';
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

function normalizeUserDataPath(value: string | undefined): string | null {
  const normalized = value?.trim().replace(/^"|"$/g, '');
  return normalized && path.isAbsolute(normalized) ? path.resolve(normalized) : null;
}

function readRuntimeProfileArgument(argv: readonly string[]): string | null {
  const prefix = '--izzi-runtime-profile=';
  const argument = argv.find((value) => value.toLowerCase().startsWith(prefix));
  return argument ? argument.slice(prefix.length).trim() : null;
}

export function resolveDesktopRuntimeProfile(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv,
  nativeSwitches: DesktopRuntimeSwitches = {},
): DesktopRuntimeProfile {
  const environmentProfile = env.IZZI_DESKTOP_RUNTIME_PROFILE?.trim() || null;
  const argumentProfile = readRuntimeProfileArgument(argv);
  const nativeProfile = nativeSwitches.runtimeProfile?.trim() || null;
  if (argumentProfile && nativeProfile && argumentProfile !== nativeProfile) {
    throw new Error('Desktop runtime profile selectors conflict.');
  }
  const requested = nativeProfile ?? argumentProfile;
  if (environmentProfile && requested && environmentProfile !== requested) {
    throw new Error('Desktop runtime profile selectors conflict.');
  }
  if (environmentProfile && !requested) {
    throw new Error('Desktop runtime profile requires an explicit launch selector.');
  }
  if (!requested) {
    return {
      id: 'default',
      customerMarketingStaging: false,
      marketingApiBaseUrl: null,
      userDataPath: null,
      singleInstanceLock: true,
      registerProtocol: true,
      updaterEnabled: true,
      googleOAuthEnabled: true,
    };
  }
  if (
    requested !== CUSTOMER_MARKETING_STAGING_PROFILE_ID
    && requested !== CUSTOMER_MARKETING_LOCAL_STAGING_PROFILE_ID
  ) {
    throw new Error('Desktop runtime profile is not reviewed.');
  }

  const apiOrigin = normalizeOrigin(env.OPENCLAW_API_URL);
  const marketingOrigin = normalizeOrigin(env.STARIZZI_CUSTOMER_MARKETING_API_URL);
  const supabaseOrigin = normalizeOrigin(env.OPENCLAW_SUPABASE_URL);
  const webOrigin = normalizeOrigin(env.OPENCLAW_WEB_URL);
  const claims = decodeJwtClaims(env.OPENCLAW_SUPABASE_ANON_KEY);
  const argumentUserDataPath = readUserDataArgument(argv);
  const nativeUserDataPath = normalizeUserDataPath(nativeSwitches.userDataDir);
  if (
    argumentUserDataPath
    && nativeUserDataPath
    && argumentUserDataPath.toLowerCase() !== nativeUserDataPath.toLowerCase()
  ) {
    throw new Error('Desktop runtime profile userData selectors conflict.');
  }
  const userDataPath = nativeUserDataPath ?? argumentUserDataPath;
  const recorderPortValue = nativeSwitches.marketingRecorderPort?.trim() || null;
  const recorderPort = recorderPortValue ? Number(recorderPortValue) : null;

  if (requested === CUSTOMER_MARKETING_LOCAL_STAGING_PROFILE_ID) {
    const localOrigin = normalizeLoopbackOrigin(env.OPENCLAW_API_URL);
    if (!localOrigin || apiOrigin !== localOrigin) {
      throw new Error('Customer Marketing local staging profile API origin is invalid.');
    }
    if (marketingOrigin !== localOrigin) {
      throw new Error('Customer Marketing local staging profile Marketing API origin is invalid.');
    }
    if (supabaseOrigin !== localOrigin) {
      throw new Error('Customer Marketing local staging profile Supabase origin is invalid.');
    }
    if (webOrigin !== localOrigin) {
      throw new Error('Customer Marketing local staging profile web origin is invalid.');
    }
    if (env.STARIZZI_CUSTOMER_MARKETING_API_ENABLED !== 'true') {
      throw new Error('Customer Marketing local staging profile bridge flag is invalid.');
    }
    if (claims?.role !== 'anon') {
      throw new Error('Customer Marketing local staging profile requires an anon client.');
    }
    if (!userDataPath || path.basename(userDataPath) !== LOCAL_STAGING_USER_DATA_DIRECTORY) {
      throw new Error('Customer Marketing local staging profile requires isolated userData.');
    }
    if (recorderPortValue) {
      throw new Error('Customer Marketing local staging profile does not accept a recorder port.');
    }
    return {
      id: CUSTOMER_MARKETING_LOCAL_STAGING_PROFILE_ID,
      customerMarketingStaging: true,
      marketingApiBaseUrl: localOrigin,
      userDataPath,
      singleInstanceLock: false,
      registerProtocol: false,
      updaterEnabled: false,
      googleOAuthEnabled: false,
    };
  }

  if (apiOrigin !== STAGING_API_ORIGIN) {
    throw new Error('Customer Marketing staging profile API origin is invalid.');
  }
  if (marketingOrigin !== STAGING_API_ORIGIN) {
    throw new Error('Customer Marketing staging profile Marketing API origin is invalid.');
  }
  if (env.STARIZZI_CUSTOMER_MARKETING_API_ENABLED !== 'true') {
    throw new Error('Customer Marketing staging profile bridge flag is invalid.');
  }
  if (supabaseOrigin !== STAGING_SUPABASE_ORIGIN) {
    throw new Error('Customer Marketing staging profile Supabase origin is invalid.');
  }
  if (claims?.role !== 'anon' || claims.ref !== STAGING_SUPABASE_REF) {
    throw new Error('Customer Marketing staging profile requires the reviewed Supabase anon client.');
  }
  if (!userDataPath || path.basename(userDataPath) !== STAGING_USER_DATA_DIRECTORY) {
    throw new Error('Customer Marketing staging profile requires isolated userData.');
  }
  if (
    recorderPortValue
    && (!Number.isInteger(recorderPort) || recorderPort! < 1_024 || recorderPort! > 65_535)
  ) {
    throw new Error('Customer Marketing staging profile recorder port is invalid.');
  }

  return {
    id: CUSTOMER_MARKETING_STAGING_PROFILE_ID,
    customerMarketingStaging: true,
    marketingApiBaseUrl: recorderPort ? `http://127.0.0.1:${recorderPort}` : STAGING_API_ORIGIN,
    userDataPath,
    singleInstanceLock: false,
    registerProtocol: false,
    updaterEnabled: false,
    googleOAuthEnabled: false,
  };
}
