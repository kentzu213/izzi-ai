// Display helpers for the V2 Affiliate workspace. They mirror the legacy page helpers in
// pages/Affiliate.tsx exactly; the main process (affiliate-client.ts) stays the authority on
// the withdrawal minimum, this value only drives the form hint and input attributes.

export const MIN_WITHDRAW_VND = 500000;

export function fmtVnd(n: number): string {
  return (n || 0).toLocaleString('vi-VN') + ' đ';
}

export function fmtDate(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('vi-VN');
}

export const STATUS_LABEL: Readonly<Record<string, string>> = {
  pending: 'Chờ duyệt',
  available: 'Khả dụng',
  paid: 'Đã trả',
  processing: 'Đang xử lý',
  rejected: 'Từ chối',
  completed: 'Hoàn tất',
};

// Unknown statuses from the backend are shown raw rather than guessed.
export function statusLabel(status: string): string {
  return Object.prototype.hasOwnProperty.call(STATUS_LABEL, status) ? STATUS_LABEL[status] : status;
}

export function methodLabel(method: string): string {
  return method === 'credit_convert' ? 'Đổi credit' : 'Chuyển khoản';
}
