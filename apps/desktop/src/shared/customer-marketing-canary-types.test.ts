import { describe, expect, it } from 'vitest';
import {
  parseCustomerMarketingTelegramCanaryEnableRequest,
  parseCustomerMarketingTelegramSandboxSetupInput,
} from './customer-marketing-canary-types';

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

describe('parseCustomerMarketingTelegramCanaryEnableRequest', () => {
  const request = {
    workflowId: 'cmr306-social-workflow-1',
    manifestDigest: 'a'.repeat(64),
    resourceDigest: 'b'.repeat(64),
    expectedRevision: 3,
    expectedStateRevision: 0,
  };

  it('accepts only the exact non-sending canary binding and state revision', () => {
    expect(parseCustomerMarketingTelegramCanaryEnableRequest(request)).toEqual(request);
    [
      { ...request, reviewer: 'renderer' },
      { ...request, enabled: true },
      { ...request, chatId: CHAT_ID },
      { ...request, expectedStateRevision: -1 },
      { ...request, expectedStateRevision: 0.5 },
    ].forEach((value) => expect(parseCustomerMarketingTelegramCanaryEnableRequest(value)).toBeNull());
  });
});
