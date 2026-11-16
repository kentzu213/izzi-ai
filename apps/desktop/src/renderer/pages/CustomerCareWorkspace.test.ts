import { describe, expect, it } from 'vitest';
import { parseCustomerCareTranscript, publicError } from './CustomerCareWorkspace';
import {
  CUSTOMER_CARE_AUTH_ERROR,
  CUSTOMER_CARE_PUBLIC_ERRORS,
  CUSTOMER_CARE_UNAVAILABLE_ERROR,
} from '../../shared/customer-care-errors';

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

describe('CustomerCareWorkspace public errors', () => {
  const ipcError = (message: string) =>
    new Error(`Error invoking remote method 'customerCare:getSnapshot': Error: ${message}`);

  it('shows the fixed service error as-is when the server could not be reached', () => {
    expect(publicError(ipcError(CUSTOMER_CARE_UNAVAILABLE_ERROR), 'fallback')).toBe(CUSTOMER_CARE_UNAVAILABLE_ERROR);
  });

  it('passes every known Customer Care error through unchanged', () => {
    for (const message of CUSTOMER_CARE_PUBLIC_ERRORS) {
      expect(publicError(ipcError(message), 'fallback')).toBe(message);
    }
    expect(publicError(new Error(CUSTOMER_CARE_AUTH_ERROR), 'fallback')).toBe(CUSTOMER_CARE_AUTH_ERROR);
  });

  it('keeps generic messages for unknown errors so raw details never reach the screen', () => {
    expect(publicError(ipcError('workspace token sb-secret-123 rejected'), 'fallback'))
      .toBe('Phiên làm việc không còn hợp lệ. Hãy đăng nhập lại hoặc chọn lại workspace.');
    expect(publicError(ipcError('database is locked at C:/Users/x'), 'fallback')).toBe('fallback');
    expect(publicError('not an error', 'fallback')).toBe('fallback');
  });
});
