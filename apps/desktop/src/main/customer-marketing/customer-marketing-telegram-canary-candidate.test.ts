import { describe, expect, it } from 'vitest';
import {
  buildCustomerMarketingTelegramCanaryCandidate,
  parseCustomerMarketingTelegramCanaryCandidateRequest,
} from './customer-marketing-telegram-canary-candidate';

const MANIFEST_DIGEST = 'a'.repeat(64);
const CHAT_ID = '-1001234567890';

describe('Customer Marketing Telegram canary candidate', () => {
  it('builds a deterministic private-sandbox resource digest without returning the chat ID', () => {
    const candidate = buildCustomerMarketingTelegramCanaryCandidate({
      workflowId: 'cmr306-social-workflow-1',
      manifestDigest: MANIFEST_DIGEST,
      resourceId: '55555555-5555-4555-8555-555555555555',
      expectedRevision: 3,
      sourceBody: '  Approved launch copy.  ',
      privateSandboxChatId: CHAT_ID,
    });

    expect(candidate).toEqual({
      provider: 'telegram',
      operation: 'private_sandbox_send',
      workflowId: 'cmr306-social-workflow-1',
      manifestDigest: MANIFEST_DIGEST,
      resourceId: '55555555-5555-4555-8555-555555555555',
      expectedRevision: 3,
      text: 'Approved launch copy.',
      resourceDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      externalActionPerformed: false,
    });
    expect(JSON.stringify(candidate)).not.toContain(CHAT_ID);
    expect(buildCustomerMarketingTelegramCanaryCandidate({
      workflowId: 'cmr306-social-workflow-1',
      manifestDigest: MANIFEST_DIGEST,
      resourceId: '55555555-5555-4555-8555-555555555555',
      expectedRevision: 3,
      sourceBody: 'Approved launch copy.',
      privateSandboxChatId: CHAT_ID,
    }).resourceDigest).toBe(candidate.resourceDigest);
  });

  it('rejects empty, control-character and oversized source bodies', () => {
    const base = {
      workflowId: 'cmr306-social-workflow-1',
      manifestDigest: MANIFEST_DIGEST,
      resourceId: '55555555-5555-4555-8555-555555555555',
      expectedRevision: 3,
      privateSandboxChatId: CHAT_ID,
    };
    expect(() => buildCustomerMarketingTelegramCanaryCandidate({ ...base, sourceBody: '   ' }))
      .toThrow('Invalid Telegram canary source');
    expect(() => buildCustomerMarketingTelegramCanaryCandidate({ ...base, sourceBody: 'bad\0text' }))
      .toThrow('Invalid Telegram canary source');
    expect(() => buildCustomerMarketingTelegramCanaryCandidate({ ...base, sourceBody: 'x'.repeat(4_097) }))
      .toThrow('Invalid Telegram canary source');
  });

  it('parses only an exact workflow and manifest request from the renderer', () => {
    const request = { workflowId: 'cmr306-social-workflow-1', manifestDigest: MANIFEST_DIGEST };
    expect(parseCustomerMarketingTelegramCanaryCandidateRequest(request)).toEqual(request);
    expect(parseCustomerMarketingTelegramCanaryCandidateRequest({ ...request, text: 'renderer' })).toBeNull();
    expect(parseCustomerMarketingTelegramCanaryCandidateRequest({ ...request, chatId: CHAT_ID })).toBeNull();
    expect(parseCustomerMarketingTelegramCanaryCandidateRequest({ ...request, manifestDigest: 'bad' })).toBeNull();
  });
});
