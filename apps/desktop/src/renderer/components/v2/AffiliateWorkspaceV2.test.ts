import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AffiliateWorkspaceV2, type AffiliateWorkspaceV2Props } from './AffiliateWorkspaceV2';

const noop = () => undefined;

function props(overrides: Partial<AffiliateWorkspaceV2Props> = {}): AffiliateWorkspaceV2Props {
  return {
    loading: false,
    stats: null,
    commissions: [],
    withdrawals: [],
    notice: null,
    copied: false,
    submitting: false,
    amount: '',
    method: 'bank_transfer',
    bankName: '',
    accountNo: '',
    accountName: '',
    onCopy: noop,
    onOpenWeb: noop,
    onSubmit: noop,
    onMethodChange: noop,
    onAmountChange: noop,
    onBankNameChange: noop,
    onAccountNoChange: noop,
    onAccountNameChange: noop,
    ...overrides,
  };
}

const stats: AffiliateStats = {
  code: 'IZZI42',
  referralLink: 'https://izziapi.com/r/IZZI42',
  totalReferrals: 3,
  pendingVnd: 100000,
  availableVnd: 600000,
  paidVnd: 0,
  totalEarningsVnd: 700000,
};

const render = (overrides: Partial<AffiliateWorkspaceV2Props> = {}) =>
  renderToStaticMarkup(createElement(AffiliateWorkspaceV2, props(overrides)));
const count = (html: string, needle: string) => html.split(needle).length - 1;
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

describe('AffiliateWorkspaceV2', () => {
  it('renders only a busy status while loading', () => {
    const html = render({ loading: true, stats });

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('role="status"');
    expect(html).toContain('Đang tải dữ liệu affiliate…');
    expect(html).not.toContain('Rút tiền / Đổi credit');
  });

  it('disables copy and shows the sign-in hint without a referral link', () => {
    const html = render();

    expect(html).toContain('Đăng nhập để nhận link giới thiệu');
    expect(html).toMatch(/<button type="button" class="v2-button v2-button--primary" disabled="">Sao chép<\/button>/);
    expect(html).not.toContain('Mã của bạn');
  });

  it('shows the referral link, code and copied state when signed in', () => {
    const html = render({ stats, copied: true });

    expect(html).toContain('https://izziapi.com/r/IZZI42');
    expect(html).toContain('Mã của bạn: <strong>IZZI42</strong>');
    expect(html).toContain('Đã sao chép ✓');
    expect(html).not.toMatch(/disabled="">Đã sao chép/);
  });

  it('renders both empty states', () => {
    const html = render({ stats });

    expect(html).toContain('Chưa có hoa hồng nào. Chia sẻ link để bắt đầu kiếm tiền.');
    expect(html).toContain('Chưa có yêu cầu rút tiền nào.');
  });

  it('shows bank fields only for bank transfer and marks the active method', () => {
    const bank = render({ method: 'bank_transfer' });
    const credit = render({ method: 'credit_convert' });

    expect(bank).toContain('Ngân hàng');
    expect(bank).toContain('Số tài khoản');
    expect(bank).toContain('Chủ tài khoản');
    expect(bank).toMatch(/aria-pressed="true">Chuyển khoản/);
    expect(bank).toMatch(/aria-pressed="false">Đổi thành credit/);
    expect(credit).not.toContain('Ngân hàng');
    expect(credit).not.toContain('Chủ tài khoản');
    expect(credit).toMatch(/aria-pressed="false">Chuyển khoản/);
    expect(credit).toMatch(/aria-pressed="true">Đổi thành credit/);
  });

  it('keeps the button-only submit with no form element', () => {
    const html = render();

    expect(html).not.toContain('<form');
    expect(count(html, 'type="submit"')).toBe(0);
    expect(html).toContain('min="500000"');
    expect(html).toContain('step="50000"');
  });

  it('labels the submit button per method and disables it while submitting', () => {
    expect(render({ method: 'bank_transfer' })).toContain('>Gửi yêu cầu rút</button>');
    expect(render({ method: 'credit_convert' })).toContain('>Đổi credit</button>');

    const busy = render({ submitting: true });
    expect(busy).toContain('disabled="">Đang gửi…</button>');
    expect(busy).not.toContain('Gửi yêu cầu rút');
  });

  it('announces error notices as alerts and success notices as status', () => {
    const err = render({ notice: { kind: 'err', text: 'Số dư khả dụng không đủ' } });
    const ok = render({ notice: { kind: 'ok', text: 'Yêu cầu rút tiền đã gửi!' } });

    expect(err).toMatch(/class="v2-affiliate__notice v2-affiliate__notice--err" role="alert">Số dư khả dụng không đủ/);
    expect(ok).toMatch(/class="v2-affiliate__notice v2-affiliate__notice--ok" role="status">Yêu cầu rút tiền đã gửi!/);
  });

  it('lists commissions and withdrawals with admin notes and raw unknown statuses', () => {
    const html = render({
      stats,
      commissions: [
        { id: 'c1', referred_email: 'a@example.com', amount_vnd: 1000000, commission_vnd: 200000,
          status: 'available', available_at: '', created_at: '2026-09-01T00:00:00Z' },
        { id: 'c2', referred_email: '', amount_vnd: 500000, commission_vnd: 100000,
          status: 'on_hold', available_at: '', created_at: '' },
      ],
      withdrawals: [
        { id: 'w1', amount_vnd: 600000, method: 'credit_convert', status: 'rejected',
          created_at: '2026-09-02T00:00:00Z', admin_note: 'Sai số tài khoản' },
      ],
    });

    expect(count(html, 'class="v2-affiliate__row"')).toBe(3);
    expect(html).toContain('a@example.com');
    expect(html).toContain('ẩn danh');
    expect(html).toContain('v2-affiliate__badge--available">Khả dụng');
    expect(html).toContain('v2-affiliate__badge--on_hold">on_hold');
    expect(html).toContain('v2-affiliate__badge--rejected">Từ chối');
    // Adjacent text nodes may be separated by an <!-- --> marker; the pattern accepts both.
    expect(html).toMatch(/Ghi chú: (?:<!-- -->)?Sai số tài khoản/);
    expect(html).toMatch(/Đổi credit(?:<!-- -->)? · /);
  });
});

describe('Affiliate V2 wiring', () => {
  const app = read('../../App.tsx');
  const page = read('../../pages/Affiliate.tsx');
  const component = read('./AffiliateWorkspaceV2.tsx');

  it('passes the shell flag from App and defaults the page to legacy', () => {
    expect(app).toContain('<AffiliatePage v2={isShellV2} />');
    expect(page).toContain('export function AffiliatePage({ v2 = false }');
  });

  it('branches to V2 only after every hook has run', () => {
    const body = page.slice(page.indexOf('export function AffiliatePage'));
    const branch = body.indexOf('if (v2) {');
    const hooks = [...body.matchAll(/\buse[A-Z]\w*(?:<[^>()]*>)?\(/g)].map((match) => match.index ?? 0);

    expect(branch).toBeGreaterThan(0);
    expect(hooks.length).toBeGreaterThan(0);
    expect(Math.max(...hooks)).toBeLessThan(branch);
    expect(body.indexOf('if (loading) {')).toBeGreaterThan(branch);
  });

  it('keeps all IPC in the page and none in the V2 component', () => {
    expect(page).toContain('window.electronAPI?.affiliate');
    expect(page).toContain('api.convertCredit(amount)');
    expect(page).toContain('api.withdraw({');
    expect(component).not.toMatch(/window\.|electronAPI|ipcRenderer|invoke\(|navigator\./);
  });

  it('always leaves the loading state, even when IPC fails', () => {
    const body = page.slice(page.indexOf('const loadAll'), page.indexOf('useEffect('));

    expect(body).toContain('try {');
    expect(body).toMatch(/catch \{/);
    expect(body).toMatch(/finally \{\s*setLoading\(false\);\s*\}/);
  });

  it('always resets submitting after a withdraw attempt', () => {
    const body = page.slice(page.indexOf('const submitWithdraw'), page.indexOf('const openWeb'));

    expect(body).toMatch(/finally \{\s*setSubmitting\(false\);\s*\}/);
    expect(body.split('setSubmitting(false)').length - 1).toBe(1);
    expect(body.indexOf('setSubmitting(true)')).toBeLessThan(body.indexOf('try {'));
  });
});
