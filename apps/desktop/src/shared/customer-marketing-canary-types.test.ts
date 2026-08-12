import { describe, expect, it } from 'vitest';
import { parseCustomerMarketingTelegramSandboxSetupInput } from './customer-marketing-canary-types';

const TOKEN = ['123456789', 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef_123456'].join(':');
const CHAT_ID = '-1001234567890';

describe('parseCustomerMarketingTelegramSandboxSetupInput', () => {
  it('accepts only the exact bounded Telegram setup payload', () => {
    expect(parseCustomerMarketingTelegramSandboxSetupInput({
      token: TOKEN,
      privateSandboxChatId: CHAT_ID,
    })).toEqual({ token: TOKEN, privateSandboxChatId: CHAT_ID });
  });

  it.each([
    null,
    {},
    { token: TOKEN },
    { token: 'invalid', privateSandboxChatId: CHAT_ID },
    { token: TOKEN, privateSandboxChatId: '123456' },
    { token: TOKEN, privateSandboxChatId: CHAT_ID, workspaceId: 'renderer-controlled' },
    { token: TOKEN, privateSandboxChatId: CHAT_ID, enabled: true },
  ])('rejects invalid or expanded payload %#', (input) => {
    expect(parseCustomerMarketingTelegramSandboxSetupInput(input)).toBeNull();
  });
});
