/**
 * AuthManager — Supabase Auth Integration
 * Tích hợp cùng hệ thống auth với izziapi.com
 * - Supabase signInWithPassword / signInWithOAuth
 * - Bearer JWT → izzi-backend /api/auth/me
 * - Token storage via electron safeStorage
 */

import { createClient, SupabaseClient, Session, isAuthRetryableFetchError } from '@supabase/supabase-js';
import { safeStorage, shell } from 'electron';
import { DatabaseManager } from '../db/database';
import { scryptSync, randomBytes, timingSafeEqual } from 'crypto';
import { IZZI_API_BASE, SUPABASE_URL, SUPABASE_ANON_KEY } from '../config/public-config';
import { startLoopbackReceiver, type LoopbackReceiver } from './oauth-loopback';

/**
 * True only when Supabase answered and refused the refresh token (revoked, already used,
 * session gone). Network failures, 5xx and rate limits keep the session for a later retry.
 */
function isRefreshTokenRejected(error: unknown): boolean {
  if (!error || isAuthRetryableFetchError(error)) return false;
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' && status >= 400 && status < 500 && status !== 429;
}

/**
 * Each HTTP request to Supabase Auth is aborted after this long, body included. auth-js turns
 * the abort into a retryable error, so its refresh retry loop always settles: it starts no new
 * attempt once 30 s of backoff have passed, so the last 8 s attempt ends by about 38 s.
 */
const AUTH_REQUEST_TIMEOUT_MS = 8_000;
/**
 * Signup gets longer: the server may create the user just before a short timeout fires, and a
 * retry then fails with "already registered".
 */
const AUTH_SIGNUP_TIMEOUT_MS = 20_000;
/** /api/auth/me only refreshes display data; it must never hold a login or refresh open. */
const PROFILE_TIMEOUT_MS = 8_000;
/**
 * Callers wait at most this long, from the start of a refresh, for the refresh to finish. Same
 * order as the 6 s workspace-client timeout so a hung auth server cannot stall every Care and
 * Marketing call for the full auth-js backoff.
 */
const REFRESH_WAIT_MS = 8_000;

export const AUTH_SERVER_UNREACHABLE_ERROR = 'Máy chủ đăng nhập không phản hồi. Vui lòng thử lại sau ít phút.';
export const AUTH_NETWORK_ERROR = 'Không kết nối được máy chủ đăng nhập. Kiểm tra mạng rồi thử lại.';
const AUTH_RATE_LIMITED_ERROR = 'Quá nhiều lần thử. Vui lòng đợi vài phút rồi thử lại.';
const NETWORK_ERROR_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'EHOSTUNREACH']);
export const AUTH_SIGNUP_UNCONFIRMED_ERROR =
  'Máy chủ đăng nhập không phản hồi. Tài khoản có thể đã được tạo: hãy kiểm tra email xác nhận trước khi đăng ký lại.';

/**
 * Aborts after `timeoutMs`. Not cleared when headers arrive: the body read must be bounded too,
 * and aborting a finished request is a no-op.
 */
function timeoutSignal(timeoutMs: number, callerSignal?: AbortSignal | null): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  if (callerSignal?.aborted) controller.abort();
  else callerSignal?.addEventListener('abort', () => controller.abort(), { once: true });
  return controller.signal;
}

function requestUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function fetchWithTimeout(timeoutMs: number, signupTimeoutMs: number): typeof fetch {
  return (input, init) => {
    const isSignup = requestUrl(input).split('?')[0].endsWith('/auth/v1/signup');
    const signal = timeoutSignal(isSignup ? signupTimeoutMs : timeoutMs, init?.signal);
    return fetch(input, { ...init, signal });
  };
}

/**
 * Fixed message for an auth server that could not be reached (network) or did not answer
 * properly (timeout/abort, 502/503/504, HTML error page); null for a real answer such as wrong
 * credentials, which keeps its specific message.
 */
function authUnavailableMessage(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const { name, message, code, status } = error as { name?: unknown; message?: unknown; code?: unknown; status?: unknown };
  const text = typeof message === 'string' ? message : '';
  const aborted = name === 'AbortError' || name === 'TimeoutError' || /\baborted\b|timed? ?out/i.test(text);
  const networkFailure = (typeof code === 'string' && NETWORK_ERROR_CODES.has(code))
    || /fetch failed|network|ENOTFOUND|EAI_AGAIN|ECONNREFUSED/i.test(text);
  if (isAuthRetryableFetchError(error)) {
    return status === 0 && !aborted && networkFailure ? AUTH_NETWORK_ERROR : AUTH_SERVER_UNREACHABLE_ERROR;
  }
  if (aborted) return AUTH_SERVER_UNREACHABLE_ERROR;
  if (name === 'AuthUnknownError') return AUTH_SERVER_UNREACHABLE_ERROR;
  if (networkFailure) return AUTH_NETWORK_ERROR;
  return null;
}

function isAuthServerUnreachable(error: unknown): boolean {
  return authUnavailableMessage(error) !== null;
}

function isRateLimited(error: { status?: unknown; message: string }): boolean {
  return error.status === 429 || error.message.includes('Too many requests');
}

/** A profile is only ever applied to the session of the user it describes. */
function profileFor(profile: User | null, userId: string | undefined): User | null {
  return profile && userId && profile.id === userId ? profile : null;
}

// Demo password hashing helpers (Node.js built-in crypto — zero new deps)
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, stored: string): boolean {
  // Support legacy plaintext passwords (pre-hash migration)
  if (!stored.includes(':') || stored.length < 145) {
    return password === stored;
  }
  const [salt, key] = stored.split(':');
  const derived = scryptSync(password, salt, 64);
  return timingSafeEqual(Buffer.from(key, 'hex'), derived);
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
  apiKey?: string;
  plan?: string;
  balance?: number;
  role?: string;
  activeKeys?: number;
  createdAt?: string;
}

interface StoredSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  user: User;
}

interface DemoRegisteredUser {
  id: string;
  email: string;
  password: string;
  name: string;
  createdAt: string;
}

export class AuthManager {
  private session: StoredSession | null = null;
  private supabase: SupabaseClient | null = null;
  private db: DatabaseManager;
  private googleOAuthEnabled: boolean;
  private onSessionExpired: () => void;
  /**
   * In-flight refresh shared by concurrent callers: Supabase rotates the refresh token on every use.
   * This is the deadline-bounded view; the refresh itself keeps running until auth-js settles.
   */
  private refreshInFlight: Promise<boolean> | null = null;
  /** The last refresh failed for a transient reason (network, 5xx, non-JSON); the session was kept. */
  private refreshUnavailable = false;
  /** Minted izzi- key for this desktop (bound to a user id), cached in memory. Never logged. */
  private desktopKeyCache: { userId: string; key: string } | null = null;
  /** Pending system-browser Google login; a new attempt cancels the previous one. */
  private googleLoginReceiver: LoopbackReceiver | null = null;
  /**
   * Remote sign-out still running after logout() returned. auth-js signs in without its lock, so a
   * new sign-in must wait for it: a global sign-out landing afterwards would revoke the new session.
   * During an outage the sign-out itself can take ~85 s (queued behind a refresh retry loop of up
   * to ~38 s, a second refresh loop while it loads an expired in-memory session, then its own 8 s
   * request). Sign-ins never wait that long: remoteSignOutSettled() gives up after 8 s.
   */
  private pendingSignOut: Promise<void> | null = null;

  constructor(db: DatabaseManager, options: { googleOAuthEnabled?: boolean; onSessionExpired?: () => void } = {}) {
    this.db = db;
    this.googleOAuthEnabled = options.googleOAuthEnabled ?? true;
    this.onSessionExpired = options.onSessionExpired ?? (() => {});
    this.initSupabase();
    this.loadSession();
  }

  private initSupabase() {
    if (SUPABASE_URL && SUPABASE_ANON_KEY) {
      this.supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          // AuthManager is the single refresh owner. A background ticker would rotate the
          // refresh token behind our stored copy, and the next manual refresh then fails.
          autoRefreshToken: false,
          persistSession: false, // We handle persistence ourselves via safeStorage
          flowType: 'implicit', // Signup confirmation links carry tokens in the hash; Google login uses its own PKCE client.
        },
        global: { fetch: fetchWithTimeout(AUTH_REQUEST_TIMEOUT_MS, AUTH_SIGNUP_TIMEOUT_MS) },
      });
      console.log('[Auth] Supabase client initialized');
    } else {
      console.warn('[Auth] Supabase credentials not configured — running in demo mode');
    }
  }

  private loadSession() {
    try {
      const stored = this.db.getSetting('auth_session');
      if (stored) {
        const decrypted = safeStorage.isEncryptionAvailable()
          ? safeStorage.decryptString(Buffer.from(stored, 'base64'))
          : stored;
        this.session = JSON.parse(decrypted);

        // If Supabase is now configured but session is a demo token,
        // clear it to force real authentication
        if (this.supabase && this.session?.accessToken?.startsWith('demo-token-')) {
          console.log('[Auth] Clearing stale demo session — Supabase is now configured, requiring real login');
          this.clearSession();
          return;
        }

        // Check if session is expired
        if (this.session && this.session.expiresAt < Date.now()) {
          console.log('[Auth] Stored session expired, will refresh');
          this.refreshAccessToken();
        }
      }
    } catch (err) {
      console.error('[Auth] Failed to load session:', err);
      this.session = null;
    }
  }

  private saveSession(session: StoredSession) {
    this.session = session;
    this.refreshUnavailable = false;
    try {
      const serialized = JSON.stringify(session);
      const encrypted = safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(serialized).toString('base64')
        : serialized;
      this.db.setSetting('auth_session', encrypted);
    } catch (err) {
      console.error('[Auth] Failed to save session:', err);
    }
  }

  private clearSession() {
    this.session = null;
    this.refreshUnavailable = false;
    this.desktopKeyCache = null;
    this.db.deleteSetting('auth_session');
    this.db.deleteSetting('izzi_desktop_key');
  }

  private getDemoUsers(): DemoRegisteredUser[] {
    try {
      const raw = this.db.getSetting('demo_users');
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private saveDemoUsers(users: DemoRegisteredUser[]) {
    this.db.setSetting('demo_users', JSON.stringify(users));
  }

  /**
   * Fetch user profile from izzi-backend /api/auth/me
   * Same as izzi-web-v2/src/context/AuthContext.tsx fetchProfile()
   */
  private async fetchProfile(accessToken: string): Promise<User | null> {
    try {
      const res = await fetch(`${IZZI_API_BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: timeoutSignal(PROFILE_TIMEOUT_MS),
      });
      if (!res.ok) return null;
      const data = await res.json() as any;
      return {
        id: data.id,
        email: data.email,
        name: data.name || data.email?.split('@')[0] || '',
        avatar: (data.name || data.email || 'U')[0].toUpperCase(),
        plan: data.plan ?? 'free',
        balance: data.balance ?? 0,
        role: data.role ?? 'user',
        activeKeys: data.activeKeys ?? 0,
        createdAt: data.createdAt || new Date().toISOString(),
      };
    } catch (err) {
      console.error('[Auth] Failed to fetch profile:', err);
      return null;
    }
  }

  /**
   * Login with email + password via Supabase Auth
   * Same flow as izzi-web-v2/src/context/AuthContext.tsx login()
   */
  async login(email: string, password: string): Promise<{ success: boolean; user?: User; error?: string }> {
    // Demo mode fallback — still requires prior signup
    if (!this.supabase) {
      const registered = this.getDemoUsers().find(
        (user) => user.email.toLowerCase() === email.toLowerCase(),
      );

      if (!registered) {
        return { success: false, error: 'Tài khoản chưa tồn tại. Vui lòng đăng ký trước để sử dụng desktop app.' };
      }

      if (!verifyPassword(password, registered.password)) {
        return { success: false, error: 'Sai mật khẩu.' };
      }

      const demoUser: User = {
        id: registered.id,
        email: registered.email,
        name: registered.name,
        avatar: registered.name[0]?.toUpperCase() || registered.email[0]?.toUpperCase() || 'U',
        plan: 'trial',
        balance: 0,
        role: 'user',
        activeKeys: 0,
        createdAt: registered.createdAt,
      };
      this.saveSession({
        accessToken: `demo-token-${registered.id}`,
        refreshToken: `demo-refresh-${registered.id}`,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        user: demoUser,
      });
      this.db.appendDiagnosticEvent({ type: 'auth.login', status: 'success', detail: `Demo login: ${email}` });
      console.log('[Auth] Demo login:', email);
      return { success: true, user: demoUser };
    }

    if (!(await this.remoteSignOutSettled())) return { success: false, error: AUTH_SERVER_UNREACHABLE_ERROR };

    try {
      const { data, error } = await this.supabase.auth.signInWithPassword({ email, password });

      if (error) {
        console.error('[Auth] Supabase login error:', error.message);
        this.db.appendDiagnosticEvent({ type: 'auth.login', status: 'error', detail: error.message, meta: { email } });

        // Translate common Supabase errors to helpful Vietnamese messages
        let userMessage = error.message;
        const unavailable = authUnavailableMessage(error);
        if (unavailable) {
          userMessage = unavailable;
        } else if (error.message === 'Invalid login credentials') {
          userMessage = 'Email hoặc mật khẩu không đúng. Nếu chưa có tài khoản, vui lòng bấm "Đăng ký miễn phí" hoặc "Đăng nhập với Google".';
        } else if (error.message.includes('Email not confirmed')) {
          userMessage = 'Email chưa được xác nhận. Vui lòng kiểm tra hộp thư để xác nhận tài khoản.';
        } else if (isRateLimited(error)) {
          userMessage = AUTH_RATE_LIMITED_ERROR;
        }

        return { success: false, error: userMessage };
      }

      if (!data.session) {
        return { success: false, error: 'No session returned' };
      }

      // Fetch full profile from izzi-backend
      const profile = profileFor(await this.fetchProfile(data.session.access_token), data.user.id);
      const user: User = profile || {
        id: data.user.id,
        email: data.user.email || email,
        name: data.user.user_metadata?.name || email.split('@')[0],
        plan: 'free',
      };

      this.saveSession({
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: (data.session.expires_at || 0) * 1000,
        user,
      });

      this.db.appendDiagnosticEvent({ type: 'auth.login', status: 'success', detail: `Supabase login: ${user.email}` });
      console.log('[Auth] Login successful:', user.email);
      return { success: true, user };
    } catch (err: any) {
      const message = err.message || 'Login failed';
      console.error('[Auth] Login error:', message);
      this.db.appendDiagnosticEvent({ type: 'auth.login', status: 'error', detail: message, meta: { email } });
      return { success: false, error: authUnavailableMessage(err) ?? message };
    }
  }

  /**
   * Login with Google in the system browser (RFC 8252).
   * Google refuses embedded Electron windows, so the OAuth page opens in the user's browser
   * and redirects to a one-shot 127.0.0.1 receiver. A dedicated PKCE client holds the verifier
   * in memory; the code is exchanged here and the session handed to the main client.
   */
  async loginWithGoogle(): Promise<{ success: boolean; user?: User; error?: string }> {
    if (!this.googleOAuthEnabled) {
      return { success: false, error: 'Google OAuth is unavailable in the isolated staging profile.' };
    }
    if (!this.supabase) {
      return { success: false, error: 'Supabase not configured' };
    }

    // Never create a new server session while a global sign-out is still queued.
    if (this.pendingSignOut && !(await this.remoteSignOutSettled())) return { success: false, error: AUTH_SERVER_UNREACHABLE_ERROR };

    this.googleLoginReceiver?.close();
    let receiver: LoopbackReceiver | null = null;
    try {
      receiver = await startLoopbackReceiver();
      this.googleLoginReceiver = receiver;

      const oauthClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false, flowType: 'pkce' },
        global: { fetch: fetchWithTimeout(AUTH_REQUEST_TIMEOUT_MS, AUTH_SIGNUP_TIMEOUT_MS) },
      });
      const { data, error } = await oauthClient.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: receiver.redirectUrl, skipBrowserRedirect: true },
      });
      if (error) return { success: false, error: authUnavailableMessage(error) ?? error.message };
      if (!data.url) return { success: false, error: 'No OAuth URL returned' };

      await shell.openExternal(data.url);
      const outcome = await receiver.result;
      if (outcome.kind === 'error') return { success: false, error: outcome.message };
      // The user may have signed out elsewhere in the app while the browser was open.
      if (!(await this.remoteSignOutSettled())) return { success: false, error: AUTH_SERVER_UNREACHABLE_ERROR };

      const exchanged = await oauthClient.auth.exchangeCodeForSession(outcome.code);
      if (exchanged.error || !exchanged.data.session) {
        return {
          success: false,
          error: authUnavailableMessage(exchanged.error)
            ?? (exchanged.error?.message || 'Không đổi được mã đăng nhập Google'),
        };
      }
      const { access_token, refresh_token } = exchanged.data.session;
      return await this.setSessionFromTokens(access_token, refresh_token);
    } catch (err: any) {
      return { success: false, error: authUnavailableMessage(err) ?? err.message };
    } finally {
      receiver?.close();
      if (this.googleLoginReceiver === receiver) this.googleLoginReceiver = null;
    }
  }

  /**
   * Set session from access_token + refresh_token (from OAuth hash fragment)
   */
  private async setSessionFromTokens(accessToken: string, refreshToken: string): Promise<{ success: boolean; user?: User; error?: string }> {
    if (!this.supabase) return { success: false, error: 'Supabase not configured' };
    if (!(await this.remoteSignOutSettled())) return { success: false, error: AUTH_SERVER_UNREACHABLE_ERROR };

    try {
      const { data, error } = await this.supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      if (error || !data.session) {
        const unavailable = authUnavailableMessage(error);
        if (unavailable) return { success: false, error: unavailable };
        return { success: false, error: error?.message || 'Failed to set session' };
      }

      const profile = profileFor(await this.fetchProfile(data.session.access_token), data.user?.id);
      const user: User = profile || {
        id: data.user?.id || '',
        email: data.user?.email || '',
        name: data.user?.user_metadata?.full_name || data.user?.user_metadata?.name || data.user?.email?.split('@')[0] || '',
        plan: 'free',
      };

      this.saveSession({
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: (data.session.expires_at || 0) * 1000,
        user,
      });

      this.db.appendDiagnosticEvent({ type: 'auth.login', status: 'success', detail: `Google OAuth: ${user.email}` });
      console.log('[Auth] Google OAuth login successful:', user.email);
      return { success: true, user };
    } catch (err: any) {
      return { success: false, error: authUnavailableMessage(err) ?? err.message };
    }
  }

  /**
   * Handle OAuth callback (legacy — kept for custom protocol handler compatibility)
   */
  async handleOAuthCallback(url: string): Promise<{ success: boolean; user?: User; error?: string }> {
    if (!this.googleOAuthEnabled) {
      return { success: false, error: 'Google OAuth is unavailable in the isolated staging profile.' };
    }
    if (!this.supabase) {
      return { success: false, error: 'Supabase not configured' };
    }

    try {
      const parsed = new URL(url);

      // Check hash fragment first
      let accessToken: string | null = null;
      let refreshToken: string | null = null;

      if (parsed.hash && parsed.hash.length > 1) {
        const hashParams = new URLSearchParams(parsed.hash.substring(1));
        accessToken = hashParams.get('access_token');
        refreshToken = hashParams.get('refresh_token');
      }

      // Fallback: query params
      if (!accessToken) {
        accessToken = parsed.searchParams.get('access_token');
        refreshToken = parsed.searchParams.get('refresh_token');
      }

      if (accessToken && refreshToken) {
        return await this.setSessionFromTokens(accessToken, refreshToken);
      }

      return { success: false, error: 'No OAuth tokens in callback URL' };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }

  /**
   * Signup new user via Supabase Auth
   * After successful signup, auto-login the user
   */
  async signup(email: string, password: string, name: string): Promise<{ success: boolean; needsConfirmation?: boolean; error?: string }> {
    if (!this.supabase) {
      const users = this.getDemoUsers();
      const exists = users.some((user) => user.email.toLowerCase() === email.toLowerCase());

      if (exists) {
        return { success: false, error: 'Email đã được đăng ký trong bản chạy thử.' };
      }

      users.push({
        id: `demo-${Date.now()}`,
        email,
        password: hashPassword(password),
        name,
        createdAt: new Date().toISOString(),
      });
      this.saveDemoUsers(users);
      this.db.appendDiagnosticEvent({ type: 'auth.signup', status: 'success', detail: `Demo signup: ${email}` });
      return { success: true };
    }

    if (!(await this.remoteSignOutSettled())) return { success: false, error: AUTH_SERVER_UNREACHABLE_ERROR };

    try {
      const { data, error } = await this.supabase.auth.signUp({
        email,
        password,
        options: { data: { name, full_name: name } },
      });

      if (error) {
        this.db.appendDiagnosticEvent({ type: 'auth.signup', status: 'error', detail: error.message, meta: { email } });

        // Translate common errors
        let msg = error.message;
        if (isAuthServerUnreachable(error)) {
          msg = AUTH_SIGNUP_UNCONFIRMED_ERROR;
        } else if (error.message.includes('already registered') || error.message.includes('already been registered')) {
          msg = 'Email đã được đăng ký. Vui lòng dùng "Đăng nhập" hoặc "Đăng nhập với Google".';
        } else if (error.message.includes('password')) {
          msg = 'Mật khẩu phải có ít nhất 6 ký tự.';
        }

        return { success: false, error: msg };
      }

      this.db.appendDiagnosticEvent({ type: 'auth.signup', status: 'success', detail: `Supabase signup: ${email}` });

      // If Supabase returned a session (email confirmation disabled), auto-login
      if (data.session) {
        const profile = profileFor(await this.fetchProfile(data.session.access_token), data.user?.id);
        const user: User = profile || {
          id: data.user?.id || '',
          email: data.user?.email || email,
          name: data.user?.user_metadata?.name || name,
          plan: 'free',
        };

        this.saveSession({
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
          expiresAt: (data.session.expires_at || 0) * 1000,
          user,
        });

        console.log('[Auth] Signup + auto-login successful:', email);
        return { success: true };
      }

      // If no session, user needs to confirm email first
      console.log('[Auth] Signup successful, awaiting email confirmation:', email);
      return { success: true, needsConfirmation: true };
    } catch (err: any) {
      return { success: false, error: isAuthServerUnreachable(err) ? AUTH_SIGNUP_UNCONFIRMED_ERROR : err.message };
    }
  }

  async logout(): Promise<void> {
    // Local sign-out first: clearing the session makes any refresh still in flight discard its
    // result (memory and disk). The remote sign-out can queue behind hung refreshes inside
    // auth-js for over a minute (see pendingSignOut), so it is best-effort and not awaited.
    this.clearSession();
    const signOut = Promise.resolve()
      .then(() => this.supabase?.auth.signOut())
      .then(() => undefined, () => {
        // Ignore logout API errors
      });
    this.pendingSignOut = signOut;
    void signOut.then(() => {
      if (this.pendingSignOut === signOut) this.pendingSignOut = null;
    });
    this.db.appendDiagnosticEvent({ type: 'auth.logout', status: 'info', detail: 'User logged out' });
    console.log('[Auth] Logged out');
  }

  /** False when the previous remote sign-out is still stuck behind an unresponsive auth server. */
  private async remoteSignOutSettled(): Promise<boolean> {
    const pending = this.pendingSignOut;
    if (!pending) return true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), REFRESH_WAIT_MS);
    });
    return Promise.race([pending.then(() => true), timedOut]).finally(() => clearTimeout(timer));
  }

  refreshAccessToken(): Promise<boolean> {
    if (!this.refreshInFlight) {
      const refreshToken = this.session?.refreshToken;
      // A refresh that outlives the deadline is still applied when it settles (the server may
      // already have rotated the token); until then later callers get `false` without waiting.
      const settled = this.refreshAccessTokenOnce().finally(() => {
        this.refreshInFlight = null;
      });
      this.refreshInFlight = this.boundRefreshWait(settled, refreshToken);
    }
    return this.refreshInFlight;
  }

  private boundRefreshWait(settled: Promise<boolean>, refreshToken: string | undefined): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => {
        console.error('[Auth] Token refresh timed out');
        // Keep the session: a slow auth server is an outage, not a sign-out.
        if (refreshToken && this.session?.refreshToken === refreshToken) this.refreshUnavailable = true;
        resolve(false);
      }, REFRESH_WAIT_MS);
    });
    return Promise.race([settled, deadline]).finally(() => clearTimeout(timer));
  }

  private async refreshAccessTokenOnce(): Promise<boolean> {
    const refreshToken = this.session?.refreshToken;
    if (!refreshToken || !this.supabase) {
      // Nothing to retry, so a missing token is a sign-in requirement, never an outage.
      this.refreshUnavailable = false;
      return false;
    }

    try {
      const { data, error } = await this.supabase.auth.refreshSession({
        refresh_token: refreshToken,
      });

      // Logged out or signed in again while the request was in flight.
      if (this.session?.refreshToken !== refreshToken) return false;

      if (error || !data.session) {
        console.error('[Auth] Token refresh failed:', error?.message);
        if (isRefreshTokenRejected(error)) {
          this.clearSession();
          this.onSessionExpired();
        } else {
          this.refreshUnavailable = true;
        }
        return false;
      }

      // Persist the rotated tokens first: the old refresh token is already spent, so losing
      // these (profile request hangs, app quits) would sign the user out on the next launch.
      const rotated: StoredSession = {
        accessToken: data.session.access_token,
        refreshToken: data.session.refresh_token,
        expiresAt: (data.session.expires_at || 0) * 1000,
        user: this.session.user,
      };
      this.saveSession(rotated);

      // Profile data is cosmetic: never let /api/auth/me hold the refresh (or its callers) open.
      void this.fetchProfile(rotated.accessToken).then((profile) => {
        const own = profileFor(profile, rotated.user.id);
        if (own && this.session === rotated) this.saveSession({ ...rotated, user: own });
      });

      return true;
    } catch {
      console.error('[Auth] Token refresh error');
      if (this.session?.refreshToken === refreshToken) this.refreshUnavailable = true;
      return false;
    }
  }

  async getAccessToken(): Promise<string | null> {
    if (!this.session) return null;

    // Refresh 5 minutes before expiry
    if (this.session.expiresAt - Date.now() < 5 * 60 * 1000) {
      const refreshed = await this.refreshAccessToken();
      // A transient failure keeps the session; the current token still works until it expires.
      if (!refreshed && (!this.session || this.session.expiresAt <= Date.now())) return null;
    }

    return this.session?.accessToken ?? null;
  }

  /**
   * True while a stored session exists but could not be refreshed because the auth server was
   * unreachable (network, 5xx, HTML error page). Callers then report "service unavailable"
   * instead of asking the user to sign in again. A rejected refresh token clears the session.
   */
  isSessionRefreshUnavailable(): boolean {
    return this.session !== null && this.refreshUnavailable;
  }

  isAuthenticated(): boolean {
    return this.session !== null;
  }

  getCurrentUser(): User | null {
    return this.session?.user || null;
  }

  getApiKey(): string | null {
    return this.session?.user?.apiKey || null;
  }

  /**
   * Ensure a durable izzi- API key exists for this desktop install and return it.
   *
   * Why: the dashboard profile (/api/auth/me) does not expose a usable key, and
   * izzi's /v1 endpoint reliably accepts izzi- keys (server-side api_keys lookup)
   * but not the raw Supabase JWT. So on first need we mint a dedicated key via
   * POST /api/keys (authenticated with the user's JWT — a dashboard route that
   * DOES accept the JWT), persist it encrypted and bound to the user id (so an
   * account switch re-mints), and reuse it thereafter. The key is a secret: it is
   * never logged and never crosses the IPC bridge. Returns null when not
   * authenticated or minting fails (the caller then falls back to the JWT).
   */
  async ensureDesktopApiKey(): Promise<string | null> {
    const userId = this.session?.user?.id;
    if (!userId) return null;

    // 1. In-memory cache (only valid for the signed-in user).
    if (this.desktopKeyCache?.userId === userId) return this.desktopKeyCache.key;

    // 2. Persisted key — reuse only if it belongs to the signed-in user.
    const stored = this.loadDesktopKey();
    if (stored && stored.userId === userId && stored.key) {
      this.desktopKeyCache = stored;
      return stored.key;
    }

    // 3. Mint a new key via the dashboard API (JWT-authenticated).
    const token = await this.getAccessToken();
    if (!token) return null;
    try {
      const res = await fetch(`${IZZI_API_BASE}/api/keys`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Izzi AI Desktop' }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { key?: unknown };
      const rawKey = typeof data.key === 'string' ? data.key.trim() : '';
      if (!rawKey.startsWith('izzi-')) return null;
      this.saveDesktopKey({ userId, key: rawKey });
      this.desktopKeyCache = { userId, key: rawKey };
      return rawKey;
    } catch (err) {
      console.error('[Auth] Failed to mint desktop API key:', err instanceof Error ? err.message : 'unknown');
      return null;
    }
  }

  /** The desktop chat key if one is already minted for the signed-in user; never mints. */
  peekDesktopApiKey(): string | null {
    const userId = this.session?.user?.id;
    if (!userId) return null;
    if (this.desktopKeyCache?.userId === userId) return this.desktopKeyCache.key;
    const stored = this.loadDesktopKey();
    return stored && stored.userId === userId && stored.key ? stored.key : null;
  }

  /** Drop the desktop chat key (e.g. after it was revoked) so the next chat mints a fresh one. */
  forgetDesktopApiKey(): void {
    this.desktopKeyCache = null;
    try {
      this.db.deleteSetting('izzi_desktop_key');
    } catch (err) {
      console.error('[Auth] Failed to forget desktop key:', err instanceof Error ? err.message : 'unknown');
    }
  }

  /** Load the persisted desktop key ({ userId, key }), decrypted. */
  private loadDesktopKey(): { userId: string; key: string } | null {
    try {
      const stored = this.db.getSetting('izzi_desktop_key');
      if (!stored) return null;
      const decrypted = safeStorage.isEncryptionAvailable()
        ? safeStorage.decryptString(Buffer.from(stored, 'base64'))
        : stored;
      const parsed = JSON.parse(decrypted);
      if (parsed && typeof parsed.userId === 'string' && typeof parsed.key === 'string') {
        return { userId: parsed.userId, key: parsed.key };
      }
    } catch {
      // treat as absent — a new key will be minted
    }
    return null;
  }

  /** Persist the desktop key encrypted (safeStorage), like the session. */
  private saveDesktopKey(data: { userId: string; key: string }): void {
    try {
      const serialized = JSON.stringify(data);
      const encrypted = safeStorage.isEncryptionAvailable()
        ? safeStorage.encryptString(serialized).toString('base64')
        : serialized;
      this.db.setSetting('izzi_desktop_key', encrypted);
    } catch (err) {
      console.error('[Auth] Failed to save desktop key:', err instanceof Error ? err.message : 'unknown');
    }
  }

  /**
   * Refresh user profile from backend (e.g., after balance change)
   */
  async refreshProfile(): Promise<User | null> {
    const token = await this.getAccessToken();
    const before = this.session;
    if (!token || !before) return null;

    // The request can span a logout, an account switch or a token rotation: apply the answer only
    // to the exact session it was asked for, and only if it describes that session's user.
    const profile = profileFor(await this.fetchProfile(token), before.user.id);
    if (!profile || this.session !== before) return null;
    this.saveSession({ ...before, user: profile });
    return profile;
  }
}
