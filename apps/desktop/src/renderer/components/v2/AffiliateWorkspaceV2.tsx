import React from 'react';
import { MIN_WITHDRAW_VND, fmtDate, fmtVnd, methodLabel, statusLabel } from './affiliateFormat';

export type AffiliateWithdrawMethod = 'bank_transfer' | 'credit_convert';

export interface AffiliateNotice {
  kind: 'ok' | 'err';
  text: string;
}

export interface AffiliateWorkspaceV2Props {
  loading: boolean;
  stats: AffiliateStats | null;
  commissions: AffiliateCommission[];
  withdrawals: AffiliateWithdrawal[];
  notice: AffiliateNotice | null;
  copied: boolean;
  submitting: boolean;
  amount: string;
  method: AffiliateWithdrawMethod;
  bankName: string;
  accountNo: string;
  accountName: string;
  onCopy: () => void;
  onOpenWeb: () => void;
  onSubmit: () => void;
  onMethodChange: (method: AffiliateWithdrawMethod) => void;
  onAmountChange: (value: string) => void;
  onBankNameChange: (value: string) => void;
  onAccountNoChange: (value: string) => void;
  onAccountNameChange: (value: string) => void;
}

/**
 * V2 layout for the Affiliate page (M6). Presentational only: the page keeps every IPC call,
 * the withdrawal validation and the auth fail-closed behaviour, and passes state in as props.
 * Copy, limits and the button-only submit (no Enter-to-submit form) match the legacy page.
 */
export function AffiliateWorkspaceV2(props: AffiliateWorkspaceV2Props) {
  const { loading, stats, notice } = props;

  if (loading) {
    return (
      <section className="v2-surface v2-affiliate" aria-busy="true">
        <p className="v2-surface__status" role="status">Đang tải dữ liệu affiliate…</p>
      </section>
    );
  }

  return (
    <section className="v2-surface v2-affiliate" aria-labelledby="v2-affiliate-title">
      <header className="v2-surface__header">
        <div className="v2-affiliate__intro">
          <p className="v2-affiliate__kicker">Affiliate Program</p>
          <h1 id="v2-affiliate-title" className="v2-surface__title">Kiếm 20% hoa hồng trọn đời</h1>
          <p className="v2-affiliate__lead">
            Chia sẻ link giới thiệu — nhận 20% mỗi giao dịch của người bạn mời. Không giới hạn, không hết hạn.
          </p>
        </div>
        <button type="button" className="v2-button v2-button--ghost" onClick={props.onOpenWeb}>
          Mở trên web ↗
        </button>
      </header>

      {notice && (
        <p className={`v2-affiliate__notice v2-affiliate__notice--${notice.kind}`}
          role={notice.kind === 'err' ? 'alert' : 'status'}>
          {notice.text}
        </p>
      )}

      <section className="v2-affiliate__card" aria-labelledby="v2-affiliate-referral">
        <h2 id="v2-affiliate-referral" className="v2-affiliate__label">Link giới thiệu của bạn</h2>
        <div className="v2-affiliate__link-row">
          <code className="v2-affiliate__link">{stats?.referralLink || 'Đăng nhập để nhận link giới thiệu'}</code>
          <button type="button" className="v2-button v2-button--primary" onClick={props.onCopy}
            disabled={!stats?.referralLink}>
            {props.copied ? 'Đã sao chép ✓' : 'Sao chép'}
          </button>
        </div>
        {stats?.code && (
          <p className="v2-affiliate__meta">Mã của bạn: <strong>{stats.code}</strong></p>
        )}
      </section>

      <dl className="v2-affiliate__tiles">
        <AffiliateTile label="Đã giới thiệu" value={String(stats?.totalReferrals ?? 0)} />
        <AffiliateTile label="Chờ duyệt" value={fmtVnd(stats?.pendingVnd ?? 0)} />
        <AffiliateTile label="Khả dụng" value={fmtVnd(stats?.availableVnd ?? 0)} highlight />
        <AffiliateTile label="Tổng thu nhập" value={fmtVnd(stats?.totalEarningsVnd ?? 0)} />
      </dl>

      <AffiliateWithdrawPanel {...props} />

      <section className="v2-surface__section" aria-labelledby="v2-affiliate-commissions">
        <h2 id="v2-affiliate-commissions" className="v2-surface__section-title">Hoa hồng gần đây</h2>
        {props.commissions.length === 0 ? (
          <div className="v2-empty"><p>Chưa có hoa hồng nào. Chia sẻ link để bắt đầu kiếm tiền.</p></div>
        ) : (
          <ul className="v2-affiliate__rows">
            {props.commissions.map((c) => (
              <li key={c.id} className="v2-affiliate__row">
                <div className="v2-affiliate__row-main">
                  <strong>{c.referred_email || 'ẩn danh'}</strong>
                  <span>{fmtVnd(c.amount_vnd)} · {fmtDate(c.created_at)}</span>
                </div>
                <strong className="v2-affiliate__amount">+{fmtVnd(c.commission_vnd)}</strong>
                <span className={`v2-affiliate__badge v2-affiliate__badge--${c.status}`}>{statusLabel(c.status)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="v2-surface__section" aria-labelledby="v2-affiliate-withdrawals">
        <h2 id="v2-affiliate-withdrawals" className="v2-surface__section-title">Lịch sử rút tiền</h2>
        {props.withdrawals.length === 0 ? (
          <div className="v2-empty"><p>Chưa có yêu cầu rút tiền nào.</p></div>
        ) : (
          <ul className="v2-affiliate__rows">
            {props.withdrawals.map((w) => (
              <li key={w.id} className="v2-affiliate__row">
                <div className="v2-affiliate__row-main">
                  <strong>{fmtVnd(w.amount_vnd)}</strong>
                  <span>{methodLabel(w.method)} · {fmtDate(w.created_at)}</span>
                  {w.admin_note && <span>Ghi chú: {w.admin_note}</span>}
                </div>
                <span className={`v2-affiliate__badge v2-affiliate__badge--${w.status}`}>{statusLabel(w.status)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </section>
  );
}

function AffiliateTile({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={highlight ? 'v2-affiliate__tile v2-affiliate__tile--highlight' : 'v2-affiliate__tile'}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function AffiliateWithdrawPanel(props: AffiliateWorkspaceV2Props) {
  const { method, submitting } = props;
  const isBank = method === 'bank_transfer';
  const submitLabel = submitting ? 'Đang gửi…' : method === 'credit_convert' ? 'Đổi credit' : 'Gửi yêu cầu rút';

  return (
    <section className="v2-affiliate__card" aria-labelledby="v2-affiliate-withdraw">
      <h2 id="v2-affiliate-withdraw" className="v2-surface__section-title">Rút tiền / Đổi credit</h2>
      <p className="v2-affiliate__meta">
        Số dư khả dụng: <strong>{fmtVnd(props.stats?.availableVnd ?? 0)}</strong> · tối thiểu {fmtVnd(MIN_WITHDRAW_VND)}
      </p>
      <div className="v2-affiliate__methods" role="group" aria-label="Phương thức">
        <button type="button" className={`v2-button${isBank ? ' v2-button--primary' : ' v2-button--ghost'}`}
          aria-pressed={isBank} onClick={() => props.onMethodChange('bank_transfer')}>
          Chuyển khoản
        </button>
        <button type="button" className={`v2-button${isBank ? ' v2-button--ghost' : ' v2-button--primary'}`}
          aria-pressed={!isBank} onClick={() => props.onMethodChange('credit_convert')}>
          Đổi thành credit
        </button>
      </div>
      <div className="v2-affiliate__fields">
        <label className="v2-field">
          <span className="v2-field__label">Số tiền (VND)</span>
          <input className="v2-field__input" type="number" min={MIN_WITHDRAW_VND} step={50000}
            placeholder={String(MIN_WITHDRAW_VND)} value={props.amount}
            onChange={(e) => props.onAmountChange(e.target.value)} />
        </label>
        {isBank && (
          <>
            <label className="v2-field">
              <span className="v2-field__label">Ngân hàng</span>
              <input className="v2-field__input" placeholder="VD: Vietcombank" value={props.bankName}
                onChange={(e) => props.onBankNameChange(e.target.value)} />
            </label>
            <label className="v2-field">
              <span className="v2-field__label">Số tài khoản</span>
              <input className="v2-field__input" placeholder="0123456789" value={props.accountNo}
                onChange={(e) => props.onAccountNoChange(e.target.value)} />
            </label>
            <label className="v2-field">
              <span className="v2-field__label">Chủ tài khoản</span>
              <input className="v2-field__input" placeholder="NGUYEN VAN A" value={props.accountName}
                onChange={(e) => props.onAccountNameChange(e.target.value)} />
            </label>
          </>
        )}
      </div>
      <div>
        <button type="button" className="v2-button v2-button--primary" onClick={props.onSubmit} disabled={submitting}>
          {submitLabel}
        </button>
      </div>
    </section>
  );
}
