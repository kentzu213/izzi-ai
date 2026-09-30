import { describe, expect, it } from 'vitest';
import { agentReplyErrorMessage, customEndpointErrorMessage } from './agentGateway-errors';

// Chat bubbles render plain text, so these notices must never carry markdown markers.
describe('customEndpointErrorMessage', () => {
  it('names the unreachable endpoint and offers the Izzi model picker as the quick fix', () => {
    const text = customEndpointErrorMessage('fetch failed', 'codex-lb (local)');

    expect(text).toContain('Không kết nối được codex-lb (local)');
    expect(text).toContain('Lỗi: fetch failed');
    expect(text).toContain('model Izzi');
    expect(text).toContain('Kết nối Model');
    expect(text).not.toContain('**');
  });

  it('asks to pick a model when no connection is configured', () => {
    const text = customEndpointErrorMessage('not-configured', 'Custom endpoint');

    expect(text).toContain('Chưa cấu hình kết nối model');
    expect(text).toContain('model Izzi');
    expect(text).not.toContain('**');
  });

  it('reports other provider errors verbatim', () => {
    const text = customEndpointErrorMessage('401 invalid key', 'codex-lb (local)');

    expect(text).toContain('Model chưa trả lời được');
    expect(text).toContain('Lỗi: 401 invalid key');
    expect(text).not.toContain('**');
  });
});

describe('agentReplyErrorMessage', () => {
  it.each([
    ['connect ECONNREFUSED 127.0.0.1:18789', 'chưa kết nối được'],
    ['phản hồi rỗng', 'phản hồi rỗng'],
    ['boom', 'chưa trả lời được'],
  ])('keeps the %s notice free of markdown markers', (rawErr, phrase) => {
    const text = agentReplyErrorMessage('Agent mặc định', rawErr);

    expect(text).toContain(`Agent mặc định ${phrase}`);
    expect(text).toContain(`Lỗi: ${rawErr}`);
    expect(text).not.toContain('**');
  });
});
