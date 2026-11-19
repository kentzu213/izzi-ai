import { describe, expect, it } from 'vitest';
import { REDACTED, hasPersonalData, redactPersonalData } from './memory-redact';

describe('redactPersonalData', () => {
  it.each([
    ['Gọi em 0912345678 nhé', 'Gọi em [đã ẩn] nhé'],
    ['SĐT +84 912 345 678', 'SĐT [đã ẩn]'],
    ['số 84-912-345-678', 'số [đã ẩn]'],
    ['bàn (028) 3823 4567 nhé', 'bàn [đã ẩn] nhé'],
    ['gọi (+84) 912 345 678', 'gọi [đã ẩn]'],
    ['gọi +84 (0) 912 345 678', 'gọi [đã ẩn]'],
    ['gọi 0912  345  678 ạ', 'gọi [đã ẩn] ạ'],
    ['gọi 0912\r\n345 678 ạ', 'gọi [đã ẩn] ạ'],
    ['gọi 0912 345 678 ạ', 'gọi [đã ẩn] ạ'],
    ['mail khach.hang@gmail.com giúp', 'mail [đã ẩn] giúp'],
    ['zalo.me/0912345678 hoặc zalo.me/g/abcdef', '[đã ẩn] hoặc [đã ẩn]'],
    ['PSID 7712345678901234 của khách', 'PSID [đã ẩn] của khách'],
    ['thẻ 4111 1111 1111 1111 hết hạn', 'thẻ [đã ẩn] hết hạn'],
    ['key sk-ABCDEFGHIJKLMNOP1234 và izzi-abcdefghijklmnop99', 'key [đã ẩn] và [đã ẩn]'],
    ['Bearer abc.def-ghi_jklmnopqrst', '[đã ẩn]'],
    ['token eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4f', 'token [đã ẩn]'],
    ['bot 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw xong', 'bot [đã ẩn] xong'],
    ['fb EAABwzLixnjYBO1234567890abcdefGHIJ xong', 'fb [đã ẩn] xong'],
    ['gg AIzaSyD-1234567890abcdefghijklmnopqrstu xong', 'gg [đã ẩn] xong'],
    ['gh ghp_1234567890abcdefghijklmnopqrstuvwxyz xong', 'gh [đã ẩn] xong'],
    ['khoá a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7 xong', 'khoá [đã ẩn] xong'],
  ])('hides personal data and secrets: %j', (input, expected) => {
    expect(redactPersonalData(input)).toBe(expected);
  });

  it('keeps ordinary business text, prices, dates, versions and short numbers', () => {
    // Arrange
    const text = 'Bộ đồ thờ 60cm giá 12.500.000đ, giao 3-5 ngày, đơn 2026-11-19, bản 1.14.0-beta.115, mã SP 1234.';

    // Act
    const result = redactPersonalData(text);

    // Assert
    expect(result).toBe(text);
  });

  it.each([
    'Khuyến mãi 01.11.2026 - 05.11.2026',
    'Chạy từ 2026-01-05 - 2026-01-09',
    'giá 0 - 100.000.000đ',
    'tỉ lệ 0.37, 0,5 và 0 đồng',
  ])('leaves date and price ranges alone: %j', (text) => {
    expect(redactPersonalData(text)).toBe(text);
  });

  it('is stable: redacting twice gives the same text', () => {
    const once = redactPersonalData('Gọi 0912345678, mail a@b.vn');
    expect(redactPersonalData(once)).toBe(once);
    expect(once).toContain(REDACTED);
  });
});

describe('hasPersonalData', () => {
  it('detects what redaction would hide, across odd spacing, and passes clean text', () => {
    expect(hasPersonalData('liên hệ 0987 654 321')).toBe(true);
    expect(hasPersonalData('liên hệ 0987  654\n321')).toBe(true);
    expect(hasPersonalData('Sở thích: viết ngắn, giọng thân thiện.')).toBe(false);
    expect(hasPersonalData(redactPersonalData('liên hệ 0987 654 321'))).toBe(false);
  });
});
