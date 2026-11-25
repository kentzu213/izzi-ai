import { ipcMain } from 'electron';
import { isTrustedMarketingSender } from './marketing-ipc';
import type { MarketingAdsService } from './marketing-ads-service';
import type { MarketingAdsOAuthCoordinator } from './marketing-ads-oauth';

const PUBLIC_ERROR = 'Không thể truy cập Quản lý Quảng cáo. Vui lòng kiểm tra đăng nhập và quyền workspace.';

const METHODS = [
  'getStatus',
  'connectMetaAds',
  'saveMetaAccounts',
  'disconnectMetaAds',
  'getOverview',
  'takeOAuthEvent',
] as const;

export function registerMarketingAdsIpc(
  service: Pick<MarketingAdsService, 'getStatus' | 'saveMetaAccounts' | 'disconnectMetaAds' | 'getOverview'>,
  oauth: Pick<MarketingAdsOAuthCoordinator, 'connect' | 'takeOAuthEvent'>,
): void {
  for (const method of METHODS) {
    ipcMain.handle(`marketingAds:${method}`, async (event, input: unknown) => {
      if (!isTrustedMarketingSender(event)) throw new Error(PUBLIC_ERROR);
      try {
        if (method === 'getStatus') return await service.getStatus();
        if (method === 'connectMetaAds') return await oauth.connect();
        if (method === 'saveMetaAccounts') return await service.saveMetaAccounts(input);
        if (method === 'disconnectMetaAds') return await service.disconnectMetaAds();
        if (method === 'getOverview') return await service.getOverview(input);
        return oauth.takeOAuthEvent();
      } catch {
        throw new Error(PUBLIC_ERROR);
      }
    });
  }
}
