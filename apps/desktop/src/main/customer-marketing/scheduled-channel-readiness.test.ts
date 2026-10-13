import { describe, expect, it, vi } from 'vitest';
import type {
  NativeMarketingAccountHealthResult,
  NativeMarketingAccountHealthSummary,
} from '../marketing/native-marketing-client';
import type { CustomerMarketingCredentialConnectionState } from '../../shared/customer-marketing-credential-types';
import type { CustomerMarketingIntegrationAuthorityState } from './customer-marketing-integration-authority';
import { createScheduledChannelReadinessCheck } from './scheduled-channel-readiness';

const NATIVE_ID = '11111111-1111-4111-8111-111111111111';

const SYNCED: CustomerMarketingIntegrationAuthorityState = {
  status: 'synced',
  workspace: { id: NATIVE_ID, name: 'Izzi', role: 'owner', plan: 'pro', quota: null },
};

function account(
  platform: 'facebook' | 'youtube',
  readiness: NativeMarketingAccountHealthSummary['readiness'],
): NativeMarketingAccountHealthSummary {
  return {
    id: `${platform}-${readiness}`,
    platform,
    name: `${platform} page`,
    accountStatus: readiness === 'ready' ? 'connected' : 'needs_reauth',
    tokenExpiresAt: null,
    hasAccessToken: readiness === 'ready',
    hasRefreshToken: true,
    readiness,
    reason: readiness === 'ready' ? 'account_connected' : 'token_expired',
  };
}

function health(accounts: NativeMarketingAccountHealthSummary[]): NativeMarketingAccountHealthResult {
  return {
    ok: true,
    health: {
      workspaceId: NATIVE_ID,
      checkedAt: '2026-10-13T00:00:00.000Z',
      authority: 'backend_oauth',
      externalActionPerformed: false,
      accounts,
    },
  };
}

function setup(options: {
  authority?: CustomerMarketingIntegrationAuthorityState | Error;
  health?: NativeMarketingAccountHealthResult | Error;
  telegram?: CustomerMarketingCredentialConnectionState | Error;
} = {}) {
  const resolve = vi.fn(async () => {
    const value = options.authority ?? SYNCED;
    if (value instanceof Error) throw value;
    return value;
  });
  const listAccountHealth = vi.fn(async () => {
    const value = options.health ?? health([]);
    if (value instanceof Error) throw value;
    return value;
  });
  const telegramState = vi.fn(() => {
    const value = options.telegram ?? 'disconnected';
    if (value instanceof Error) throw value;
    return value;
  });
  const check = createScheduledChannelReadinessCheck({
    authority: { resolve },
    listAccountHealth,
    telegramState,
  });
  return { check, resolve, listAccountHealth, telegramState };
}

describe('createScheduledChannelReadinessCheck', () => {
  it('reports Facebook ready when an OAuth account is ready on IzziAPI', async () => {
    const context = setup({ health: health([account('facebook', 'expired'), account('facebook', 'ready')]) });

    const result = await context.check('customer-local', ['facebook']);

    expect(result).toEqual([{ channel: 'facebook', state: 'ready' }]);
    expect(context.resolve).toHaveBeenCalledWith('customer-local');
    expect(context.listAccountHealth).toHaveBeenCalledWith(NATIVE_ID);
  });

  it('asks for a Facebook login when no account is connected', async () => {
    const context = setup({ health: health([account('youtube', 'ready')]) });

    const [facebook] = await context.check('customer-local', ['facebook']);

    expect(facebook.state).toBe('needs_login');
    expect(facebook.detail).toContain('Chưa kết nối Facebook');
    expect(facebook.detail).toContain('Chạy lại');
  });

  it('asks for a fresh login when every YouTube account expired or needs reauth', async () => {
    const context = setup({ health: health([account('youtube', 'expired'), account('youtube', 'needs_reauth')]) });

    const [youtube] = await context.check('customer-local', ['youtube']);

    expect(youtube.state).toBe('needs_login');
    expect(youtube.detail).toContain('Kết nối YouTube đã hết hạn');
  });

  it('reports unavailable, not a login request, when IzziAPI health cannot be read', async () => {
    const context = setup({ health: { ok: false, error: 'network-error' } });

    const [facebook] = await context.check('customer-local', ['facebook']);

    expect(facebook.state).toBe('unavailable');
    expect(facebook.detail).toContain('app sẽ thử lại');
  });

  it('reports unavailable when the account health request throws', async () => {
    const context = setup({ health: new Error('socket hang up') });

    const [facebook] = await context.check('customer-local', ['facebook']);

    expect(facebook.state).toBe('unavailable');
  });

  it('reports unavailable when the native workspace cannot be resolved safely', async () => {
    const context = setup({ authority: { status: 'unavailable', workspace: null } });

    const result = await context.check('customer-local', ['facebook', 'telegram']);

    expect(result.map((item) => item.state)).toEqual(['unavailable', 'unavailable']);
    expect(context.listAccountHealth).not.toHaveBeenCalled();
    expect(context.telegramState).not.toHaveBeenCalled();
  });

  it('reports unavailable when resolving the workspace throws', async () => {
    const context = setup({ authority: new Error('offline') });

    const [youtube] = await context.check('customer-local', ['youtube']);

    expect(youtube.state).toBe('unavailable');
  });

  it('asks for a login when the customer has no IzziAPI marketing workspace yet', async () => {
    const context = setup({ authority: { status: 'not_found', workspace: null } });

    const [facebook] = await context.check('customer-local', ['facebook']);

    expect(facebook.state).toBe('needs_login');
  });

  it('asks for the right IzziAPI login when the account has no access to the workspace', async () => {
    const context = setup({ authority: { status: 'forbidden', workspace: null } });

    const result = await context.check('customer-local', ['facebook', 'telegram']);

    expect(result.map((item) => item.state)).toEqual(['needs_login', 'needs_login']);
    expect(result[0].detail).toContain('không có quyền');
    expect(context.listAccountHealth).not.toHaveBeenCalled();
    expect(context.telegramState).not.toHaveBeenCalled();
  });

  it('reads Telegram from the encrypted local vault state', async () => {
    const connected = setup({ telegram: 'connected' });
    const expired = setup({ telegram: 'expired' });
    const locked = setup({ telegram: 'locked' });

    expect(await connected.check('customer-local', ['telegram'])).toEqual([{ channel: 'telegram', state: 'ready' }]);
    expect((await expired.check('customer-local', ['telegram']))[0].state).toBe('needs_login');
    const [lockedTelegram] = await locked.check('customer-local', ['telegram']);
    expect(lockedTelegram.state).toBe('needs_login');
    expect(lockedTelegram.detail).toContain('kho mã hoá');
    expect(connected.telegramState).toHaveBeenCalledWith(NATIVE_ID);
    expect(connected.listAccountHealth).not.toHaveBeenCalled();
  });

  it('labels channels without an automatic connector as manual instead of blocking them', async () => {
    const context = setup();

    const result = await context.check('customer-local', ['instagram', 'tiktok', 'x']);

    expect(result.map((item) => item.state)).toEqual(['manual', 'manual', 'manual']);
    expect(result[0].detail).toContain('tự đăng');
    expect(context.resolve).not.toHaveBeenCalled();
  });

  it('never reports a channel without a connector as ready', async () => {
    const context = setup();

    const result = await context.check('customer-local', ['website', 'email', 'crm', 'ads', 'seo', 'fb', 'zalo']);

    expect(result.map((item) => item.state)).toEqual(Array(7).fill('manual'));
    expect(result.find((item) => item.channel === 'zalo')?.detail).toContain('cho zalo');
    expect(context.resolve).not.toHaveBeenCalled();
    expect(context.telegramState).not.toHaveBeenCalled();
  });

  it('treats only internal work as ready without a connection', async () => {
    const context = setup();

    expect(await context.check('customer-local', ['internal'])).toEqual([{ channel: 'internal', state: 'ready' }]);
    expect(context.resolve).not.toHaveBeenCalled();
  });

  it('checks a channel alias as the channel it names, keeping the original name', async () => {
    const context = setup({ health: health([account('facebook', 'ready')]), telegram: 'expired' });

    const result = await context.check('customer-local', ['facebook-page', 'YouTube_Shorts', 'telegram_channel']);

    expect(result).toEqual([
      { channel: 'facebook-page', state: 'ready' },
      expect.objectContaining({ channel: 'YouTube_Shorts', state: 'needs_login' }),
      expect.objectContaining({ channel: 'telegram_channel', state: 'needs_login' }),
    ]);
    expect(context.listAccountHealth).toHaveBeenCalledTimes(1);
  });

  it('checks each distinct channel once', async () => {
    const context = setup({ health: health([account('facebook', 'ready')]) });

    const result = await context.check('customer-local', ['facebook', 'facebook', 'youtube']);

    expect(result.map((item) => item.channel)).toEqual(['facebook', 'youtube']);
    expect(context.resolve).toHaveBeenCalledTimes(1);
    expect(context.listAccountHealth).toHaveBeenCalledTimes(1);
  });
});
