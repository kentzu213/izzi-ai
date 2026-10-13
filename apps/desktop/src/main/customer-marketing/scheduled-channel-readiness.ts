import type {
  NativeMarketingAccountHealthResult,
  NativeMarketingPlatform,
} from '../marketing/native-marketing-client';
import type { CustomerMarketingCredentialConnectionState } from '../../shared/customer-marketing-credential-types';
import type { CustomerChannelReadiness } from '../../shared/customer-marketing-types';
import type { CustomerMarketingIntegrationAuthorityGateway } from './customer-marketing-integration-authority';

export type ScheduledChannelReadinessCheck = (
  workspaceId: string,
  channels: readonly string[],
) => Promise<CustomerChannelReadiness[]>;

export interface ScheduledChannelReadinessDeps {
  authority: CustomerMarketingIntegrationAuthorityGateway;
  /** Read-only IzziAPI OAuth readiness; never calls the social provider. */
  listAccountHealth(nativeWorkspaceId: string): Promise<NativeMarketingAccountHealthResult>;
  /** State of the encrypted Telegram token in the local vault. */
  telegramState(nativeWorkspaceId: string): CustomerMarketingCredentialConnectionState;
}

/** Channels the Channels page can connect through official OAuth on IzziAPI. */
const NATIVE_CHANNELS = new Map<string, { platform: NativeMarketingPlatform; label: string }>([
  ['facebook', { platform: 'facebook', label: 'Facebook' }],
  ['youtube', { platform: 'youtube', label: 'YouTube' }],
]);

/** Channels with no automatic connector yet; any channel not listed here is shown by its own name. */
const MANUAL_CHANNEL_LABELS = new Map<string, string>([
  ['instagram', 'Instagram'],
  ['tiktok', 'TikTok'],
  ['x', 'X'],
  ['threads', 'Threads'],
  ['linkedin', 'LinkedIn'],
  ['website', 'website'],
  ['email', 'email'],
  ['crm', 'CRM'],
  ['ads', 'quảng cáo'],
  ['seo', 'SEO'],
]);

/** Internal work such as KPI reports is never published, so it needs no channel connection. */
const LOCAL_CHANNELS = new Set(['internal']);

/** "facebook-page" or "YouTube_Shorts" are checked as the channel they start with. */
const baseChannel = (channel: string) => channel.trim().toLowerCase().split(/[-_\s]/)[0];

const needsLogin = (channel: string, detail: string): CustomerChannelReadiness =>
  ({ channel, state: 'needs_login', detail });

const unavailable = (channel: string, label: string): CustomerChannelReadiness =>
  ({ channel, state: 'unavailable', detail: `Chưa kiểm tra được kết nối ${label} với IzziAPI; app sẽ thử lại.` });

const missingLogin = (channel: string, label: string) =>
  needsLogin(channel, `Chưa kết nối ${label} — đăng nhập trong mục Kênh rồi bấm "Chạy lại".`);

const forbiddenLogin = (channel: string, label: string) =>
  needsLogin(
    channel,
    `Tài khoản IzziAPI đang đăng nhập không có quyền với workspace của ${label} — đăng nhập đúng tài khoản rồi bấm "Chạy lại".`,
  );

/**
 * Checks, without spending credit or touching a social provider, whether each
 * scheduled channel can receive the work. Facebook/YouTube use the IzziAPI OAuth
 * readiness, Telegram the local vault; channels without a connector stay manual.
 */
export function createScheduledChannelReadinessCheck(
  deps: ScheduledChannelReadinessDeps,
): ScheduledChannelReadinessCheck {
  return async (workspaceId, channels) => {
    const unique = [...new Set(channels)];
    const needsNative = unique.some((channel) => NATIVE_CHANNELS.has(baseChannel(channel)));
    const needsAuthority = needsNative || unique.some((channel) => baseChannel(channel) === 'telegram');

    let nativeWorkspaceId: string | null = null;
    let authorityBlock: 'not_found' | 'forbidden' | null = null;
    if (needsAuthority) {
      try {
        const authority = await deps.authority.resolve(workspaceId);
        if (authority.status === 'synced') nativeWorkspaceId = authority.workspace.id;
        else if (authority.status === 'not_found' || authority.status === 'forbidden') authorityBlock = authority.status;
      } catch {
        // Unresolved authority is reported as unavailable below.
      }
    }
    const blockedByAuthority = (channel: string, label: string) => {
      if (authorityBlock === 'forbidden') return forbiddenLogin(channel, label);
      if (authorityBlock === 'not_found') return missingLogin(channel, label);
      return null;
    };

    let health: NativeMarketingAccountHealthResult | null = null;
    if (needsNative && nativeWorkspaceId) {
      try {
        health = await deps.listAccountHealth(nativeWorkspaceId);
      } catch {
        health = null;
      }
    }

    return unique.map((channel): CustomerChannelReadiness => {
      const base = baseChannel(channel);
      const native = NATIVE_CHANNELS.get(base);
      if (native) {
        const blocked = blockedByAuthority(channel, native.label);
        if (blocked) return blocked;
        if (!health?.ok) return unavailable(channel, native.label);
        const accounts = health.health.accounts.filter((item) => item.platform === native.platform);
        if (accounts.some((item) => item.readiness === 'ready')) return { channel, state: 'ready' };
        if (accounts.length === 0) return missingLogin(channel, native.label);
        return needsLogin(
          channel,
          `Kết nối ${native.label} đã hết hạn hoặc cần cấp quyền lại — đăng nhập lại trong mục Kênh rồi bấm "Chạy lại".`,
        );
      }
      if (base === 'telegram') {
        const blocked = blockedByAuthority(channel, 'Telegram');
        if (blocked) return blocked;
        if (!nativeWorkspaceId) return unavailable(channel, 'Telegram');
        let state: CustomerMarketingCredentialConnectionState;
        try {
          state = deps.telegramState(nativeWorkspaceId);
        } catch {
          return unavailable(channel, 'Telegram');
        }
        if (state === 'connected') return { channel, state: 'ready' };
        // Locked means this computer cannot decrypt the token; retrying alone will not fix it.
        if (state === 'locked') {
          return needsLogin(
            channel,
            'Máy này chưa mở được kho mã hoá chứa token Telegram — mở mục Kênh kiểm tra kết nối rồi bấm "Chạy lại".',
          );
        }
        return missingLogin(channel, 'Telegram');
      }
      if (LOCAL_CHANNELS.has(base)) return { channel, state: 'ready' };
      const label = MANUAL_CHANNEL_LABELS.get(base) ?? channel;
      return {
        channel,
        state: 'manual',
        detail: `Chưa có kết nối tự động cho ${label}; bản nháp sẽ do bạn tự đăng.`,
      };
    });
  };
}
