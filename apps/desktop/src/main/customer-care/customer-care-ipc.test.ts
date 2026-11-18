import { beforeEach, describe, expect, it, vi } from 'vitest';
const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>());
const trusted = vi.hoisted(() => vi.fn(() => true));
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn((name, handler) => handlers.set(name, handler)) } }));
vi.mock('../marketing/marketing-ipc', () => ({ isTrustedMarketingSender: trusted }));
import { registerCustomerCareIpc } from './customer-care-ipc';
import { CUSTOMER_CARE_AUTH_ERROR, CUSTOMER_CARE_UNAVAILABLE_ERROR } from '../../shared/customer-care-errors';

describe('customer care IPC boundary', () => {
  const service = {
    getSnapshot: vi.fn(), saveSetup: vi.fn(), assist: vi.fn(),
    selectFacebookPage: vi.fn(), disconnectFacebookPage: vi.fn(),
    getFacebookInbox: vi.fn(), setFacebookInbox: vi.fn(), listLeads: vi.fn(), setLeadStatus: vi.fn(),
    purgeLead: vi.fn(),
  };
  const facebook = { connect: vi.fn(), takeChoices: vi.fn() };
  const invoke = (channel: string, ...args: unknown[]) => handlers.get(`customerCare:${channel}`)!({}, ...args);
  const CHANNELS = [
    ['getSnapshot', service.getSnapshot],
    ['saveSetup', service.saveSetup],
    ['assist', service.assist],
    ['connectFacebookPage', facebook.connect],
    ['selectFacebookPage', service.selectFacebookPage],
    ['disconnectFacebookPage', service.disconnectFacebookPage],
    ['takeFacebookPageChoices', facebook.takeChoices],
    ['getFacebookInbox', service.getFacebookInbox],
    ['setFacebookInbox', service.setFacebookInbox],
    ['listLeads', service.listLeads],
    ['setLeadStatus', service.setLeadStatus],
    ['purgeLead', service.purgeLead],
  ] as const;

  beforeEach(() => {
    handlers.clear(); vi.clearAllMocks(); trusted.mockReturnValue(true);
    registerCustomerCareIpc(service, facebook);
  });
  it('rejects untrusted senders on every channel before accessing data', async () => {
    trusted.mockReturnValue(false);
    for (const [channel, target] of CHANNELS) {
      await expect(invoke(channel, {})).rejects.toThrow('Không thể truy cập');
      expect(target).not.toHaveBeenCalled();
    }
    expect(handlers.size).toBe(CHANNELS.length);
  });
  it('passes opaque inputs to the main service parser', async () => {
    const payload = { workspaceId: 'injected' };
    service.saveSetup.mockResolvedValue({ ok: false, error: 'invalid' });
    expect(await invoke('saveSetup', payload)).toEqual({ ok: false, error: 'invalid' });
    expect(service.saveSetup).toHaveBeenCalledWith(payload);
  });
  it('forwards only the opaque Page selection and nothing else from the renderer', async () => {
    const selection = { choiceId: 'c', pageId: 'p' };
    service.selectFacebookPage.mockResolvedValue({ ok: false, error: 'invalid_input' });
    expect(await invoke('selectFacebookPage', selection, 'extra')).toEqual({ ok: false, error: 'invalid_input' });
    expect(service.selectFacebookPage).toHaveBeenCalledWith(selection);

    facebook.connect.mockResolvedValue({ ok: true });
    service.disconnectFacebookPage.mockResolvedValue({ ok: false, error: 'forbidden' });
    expect(await invoke('connectFacebookPage', { workspaceId: 'injected' })).toEqual({ ok: true });
    expect(await invoke('disconnectFacebookPage', { workspaceId: 'injected' })).toEqual({ ok: false, error: 'forbidden' });
    expect(facebook.connect).toHaveBeenCalledWith();
    expect(service.disconnectFacebookPage).toHaveBeenCalledWith();
  });
  it('registers the Phase B1 inbox and lead channels and forwards only their opaque input', async () => {
    service.getFacebookInbox.mockResolvedValue({ ok: false, error: 'forbidden' });
    service.setFacebookInbox.mockResolvedValue({ ok: false, error: 'invalid_input' });
    service.listLeads.mockResolvedValue({ ok: false, error: 'invalid_input' });
    service.setLeadStatus.mockResolvedValue({ ok: false, error: 'invalid_input' });

    expect(await invoke('getFacebookInbox', { workspaceId: 'injected' })).toEqual({ ok: false, error: 'forbidden' });
    expect(service.getFacebookInbox).toHaveBeenCalledWith();
    const toggle = { enabled: true };
    expect(await invoke('setFacebookInbox', toggle, 'extra')).toEqual({ ok: false, error: 'invalid_input' });
    expect(service.setFacebookInbox).toHaveBeenCalledWith(toggle);
    const page = { cursor: null };
    await invoke('listLeads', page);
    expect(service.listLeads).toHaveBeenCalledWith(page);
    const status = { leadId: 'l', status: 'closed' };
    await invoke('setLeadStatus', status);
    expect(service.setLeadStatus).toHaveBeenCalledWith(status);
    const purge = { leadId: 'l' };
    await invoke('purgeLead', purge, 'extra');
    expect(service.purgeLead).toHaveBeenCalledWith(purge);
  });
  it('hands the buffered Page choices out without any renderer input', async () => {
    const choices = { ok: true, choiceId: 'c', expiresAt: 'e', pages: [], missingScopes: [] };
    facebook.takeChoices.mockReturnValueOnce(choices).mockReturnValueOnce(null);
    expect(await invoke('takeFacebookPageChoices', { identityId: 'injected' })).toEqual(choices);
    expect(await invoke('takeFacebookPageChoices')).toBeNull();
    expect(facebook.takeChoices).toHaveBeenCalledWith();
  });
  it.each([CUSTOMER_CARE_AUTH_ERROR, CUSTOMER_CARE_UNAVAILABLE_ERROR])(
    'passes the fixed public error %s through unchanged',
    async (message) => {
      service.getSnapshot.mockRejectedValue(new Error(message));
      await expect(invoke('getSnapshot')).rejects.toThrow(message);
    },
  );
  it('redacts rejected service errors on all channels', async () => {
    for (const [channel, target] of CHANNELS) {
      target.mockRejectedValue(new Error('private database or provider details'));
      await expect(invoke(channel, {})).rejects.toThrow(/^Không thể truy cập/);
    }
  });
});
