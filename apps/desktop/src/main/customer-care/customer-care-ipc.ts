import { ipcMain } from 'electron';
import { isTrustedMarketingSender } from '../marketing/marketing-ipc';
import type { CustomerCareService } from './customer-care-service';
import type { CareFacebookOAuthCoordinator } from './care-facebook-oauth';
import { CUSTOMER_CARE_PUBLIC_ERRORS } from '../../shared/customer-care-errors';

const PUBLIC_ERROR = 'Không thể truy cập Chăm sóc khách hàng. Vui lòng kiểm tra đăng nhập và quyền workspace.';

const METHODS = [
  'getSnapshot',
  'saveSetup',
  'assist',
  'connectFacebookPage',
  'selectFacebookPage',
  'disconnectFacebookPage',
  'takeFacebookPageChoices',
  'getFacebookInbox',
  'setFacebookInbox',
  'listLeads',
  'setLeadStatus',
  'purgeLead',
] as const;

export function registerCustomerCareIpc(
  service: Pick<
    CustomerCareService,
    | 'getSnapshot' | 'saveSetup' | 'assist' | 'selectFacebookPage' | 'disconnectFacebookPage'
    | 'getFacebookInbox' | 'setFacebookInbox' | 'listLeads' | 'setLeadStatus' | 'purgeLead'
  >,
  facebook: Pick<CareFacebookOAuthCoordinator, 'connect' | 'takeChoices'>,
): void {
  for (const method of METHODS) {
    ipcMain.handle(`customerCare:${method}`, async (event, input: unknown) => {
      if (!isTrustedMarketingSender(event)) throw new Error(PUBLIC_ERROR);
      try {
        if (method === 'getSnapshot') return await service.getSnapshot();
        if (method === 'saveSetup') return await service.saveSetup(input);
        // The renderer never supplies workspace, identity, state or code; main resolves them itself.
        if (method === 'connectFacebookPage') return await facebook.connect();
        if (method === 'selectFacebookPage') return await service.selectFacebookPage(input);
        if (method === 'disconnectFacebookPage') return await service.disconnectFacebookPage();
        // Take-once: the buffered deep-link outcome is cleared as it is handed out.
        if (method === 'takeFacebookPageChoices') return await facebook.takeChoices();
        // Phase B1: only `{ enabled }`, `{ cursor }` or `{ leadId, status }` cross; main parses them strictly.
        if (method === 'getFacebookInbox') return await service.getFacebookInbox();
        if (method === 'setFacebookInbox') return await service.setFacebookInbox(input);
        if (method === 'listLeads') return await service.listLeads(input);
        if (method === 'setLeadStatus') return await service.setLeadStatus(input);
        // B1b: only `{ leadId }` crosses; owner/manager is re-checked in main and on the server.
        if (method === 'purgeLead') return await service.purgeLead(input);
        return await service.assist(input);
      } catch (error) {
        // Fixed public Customer Care strings carry no data; anything else is never serialized.
        const message = error instanceof Error ? error.message : '';
        throw new Error(CUSTOMER_CARE_PUBLIC_ERRORS.includes(message) ? message : PUBLIC_ERROR);
      }
    });
  }
}
