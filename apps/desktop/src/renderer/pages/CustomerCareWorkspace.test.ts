import { describe, expect, it } from 'vitest';
import { parseCustomerCareTranscript } from './CustomerCareWorkspace';

describe('CustomerCareWorkspace transcript parsing', () => {
  it('keeps explicit customer and sale turns in order', () => {
    expect(parseCustomerCareTranscript([
      'Khách: Giá bộ này bao nhiêu?',
      'Sale: Anh/chị đang xem kích thước nào ạ?',
      'Customer: Tôi cần loại cao 1m2',
    ].join('\n'))).toEqual([
      { role: 'customer', text: 'Giá bộ này bao nhiêu?' },
      { role: 'sale', text: 'Anh/chị đang xem kích thước nào ạ?' },
      { role: 'customer', text: 'Tôi cần loại cao 1m2' },
    ]);
  });

  it('treats unlabeled non-empty lines as customer text without inferring permission', () => {
    expect(parseCustomerCareTranscript('  0901234567  \n\nTư vấn: Em đã ghi nhận.')).toEqual([
      { role: 'customer', text: '0901234567' },
      { role: 'sale', text: 'Em đã ghi nhận.' },
    ]);
  });
});
