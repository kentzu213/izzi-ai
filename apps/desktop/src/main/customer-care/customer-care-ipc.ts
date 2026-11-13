import { ipcMain } from 'electron';
import { isTrustedMarketingSender } from '../marketing/marketing-ipc';
import type { CustomerCareService } from './customer-care-service';

const PUBLIC_ERROR = 'Không thể truy cập Chăm sóc khách hàng. Vui lòng kiểm tra đăng nhập và quyền workspace.';

export function registerCustomerCareIpc(
  service: Pick<CustomerCareService, 'getSnapshot' | 'saveSetup' | 'assist'>,
): void {
  for (const method of ['getSnapshot', 'saveSetup', 'assist'] as const) {
    ipcMain.handle(`customerCare:${method}`, async (event, input: unknown) => {
      if (!isTrustedMarketingSender(event)) throw new Error(PUBLIC_ERROR);
      try {
        if (method === 'getSnapshot') return await service.getSnapshot();
        if (method === 'saveSetup') return await service.saveSetup(input);
        return await service.assist(input);
      } catch {
        // Never serialize provider, crypto or database errors to the renderer.
        throw new Error(PUBLIC_ERROR);
      }
    });
  }
}
