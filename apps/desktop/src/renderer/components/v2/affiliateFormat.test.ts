import { describe, expect, it } from 'vitest';
import { MIN_WITHDRAW_VND, fmtDate, fmtVnd, methodLabel, statusLabel } from './affiliateFormat';

describe('affiliateFormat', () => {
  it('keeps the withdrawal minimum the page enforces', () => {
    expect(MIN_WITHDRAW_VND).toBe(500000);
  });

  it('formats VND amounts and treats 0 and NaN as zero', () => {
    expect(fmtVnd(500000)).toBe(`${(500000).toLocaleString('vi-VN')} đ`);
    expect(fmtVnd(0)).toBe(`${(0).toLocaleString('vi-VN')} đ`);
    expect(fmtVnd(Number.NaN)).toBe(`${(0).toLocaleString('vi-VN')} đ`);
  });

  it('shows a dash for an empty or invalid date', () => {
    expect(fmtDate('')).toBe('—');
    expect(fmtDate('not-a-date')).toBe('—');
    expect(fmtDate('2026-09-28T00:00:00Z')).toBe(new Date('2026-09-28T00:00:00Z').toLocaleDateString('vi-VN'));
  });

  it('labels known statuses and shows unknown ones raw', () => {
    expect(statusLabel('pending')).toBe('Chờ duyệt');
    expect(statusLabel('available')).toBe('Khả dụng');
    expect(statusLabel('paid')).toBe('Đã trả');
    expect(statusLabel('processing')).toBe('Đang xử lý');
    expect(statusLabel('rejected')).toBe('Từ chối');
    expect(statusLabel('completed')).toBe('Hoàn tất');
    expect(statusLabel('on_hold')).toBe('on_hold');
  });

  it('does not resolve inherited object keys as status labels', () => {
    expect(statusLabel('toString')).toBe('toString');
    expect(statusLabel('__proto__')).toBe('__proto__');
    expect(statusLabel('constructor')).toBe('constructor');
  });

  it('labels credit conversion and falls back to bank transfer', () => {
    expect(methodLabel('credit_convert')).toBe('Đổi credit');
    expect(methodLabel('bank_transfer')).toBe('Chuyển khoản');
    expect(methodLabel('')).toBe('Chuyển khoản');
  });
});
