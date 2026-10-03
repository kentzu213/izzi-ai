import { describe, expect, it } from 'vitest';
import { directorReplyPlainText, parseDirectorReply } from './customer-marketing-director-reply';

describe('parseDirectorReply', () => {
  it('turns markdown headings, bold, bullets and rules into blocks without the markers', () => {
    const blocks = parseDirectorReply([
      '### Kế hoạch 30 ngày',
      '',
      '**Mục tiêu:** Tăng khách mới.',
      '---',
      '#### Tuần 1',
      '- **Vai trò:** Chiến lược',
      '  - Video ngắn trên TikTok',
      '1. Duyệt bước 1',
    ].join('\n'));

    expect(blocks).toEqual([
      { kind: 'heading', inlines: [{ text: 'Kế hoạch 30 ngày', strong: false }] },
      { kind: 'text', inlines: [{ text: 'Mục tiêu:', strong: true }, { text: ' Tăng khách mới.', strong: false }] },
      { kind: 'rule' },
      { kind: 'heading', inlines: [{ text: 'Tuần 1', strong: false }] },
      { kind: 'item', depth: 0, marker: '•', inlines: [{ text: 'Vai trò:', strong: true }, { text: ' Chiến lược', strong: false }] },
      { kind: 'item', depth: 1, marker: '•', inlines: [{ text: 'Video ngắn trên TikTok', strong: false }] },
      { kind: 'item', depth: 0, marker: '1.', inlines: [{ text: 'Duyệt bước 1', strong: false }] },
    ]);
  });

  it('keeps plain text replies and CRLF input as text blocks', () => {
    expect(parseDirectorReply('Kế hoạch cục bộ\r\nBước 1')).toEqual([
      { kind: 'text', inlines: [{ text: 'Kế hoạch cục bộ', strong: false }] },
      { kind: 'text', inlines: [{ text: 'Bước 1', strong: false }] },
    ]);
  });

  it('leaves an unmatched bold marker as literal text', () => {
    expect(parseDirectorReply('Giá **chưa chốt')).toEqual([
      { kind: 'text', inlines: [{ text: 'Giá **chưa chốt', strong: false }] },
    ]);
  });

  it('flattens a reply to one marker-free line for compact rows', () => {
    expect(directorReplyPlainText('### Kế hoạch\n---\n- **Tuần 1:** video')).toBe('Kế hoạch Tuần 1: video');
  });

  it('caps list nesting so a deeply indented line cannot push off the card', () => {
    expect(parseDirectorReply('          - sâu')).toEqual([
      { kind: 'item', depth: 3, marker: '•', inlines: [{ text: 'sâu', strong: false }] },
    ]);
  });
});
