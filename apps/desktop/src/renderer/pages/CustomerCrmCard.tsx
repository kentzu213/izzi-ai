import type { Ref } from 'react';
import type { CustomerCareCrmAssignee, CustomerCareCrmRow } from '../../shared/customer-care-types';
import { formatLeadPhone } from './customer-care-leads-flow';
import {
  CRM_OCCASION_OPTIONS,
  crmAssigneeLabel,
  crmDue,
  crmRowReadOnly,
  crmStageLabel,
  formatCrmDay,
  formatCrmDue,
  type CrmProductOption,
} from './customer-crm-flow';
import { CRM_STAGE_COLORS, crmCustomerLabel, crmIdentityView, type CrmIdentityLine } from './customer-crm-graph';

export interface CustomerCrmCardProps {
  row: CustomerCareCrmRow;
  nowMs: number;
  assignees: readonly CustomerCareCrmAssignee[];
  /** The shop's approved product facts on this machine. */
  products: readonly CrmProductOption[];
  onCopy: () => void;
  onOpenProfile: () => void;
  onClose: () => void;
  /** Focus moves here when the card opens. */
  cardRef?: Ref<HTMLElement>;
}

const DUE_BADGE = { overdue: 'Quá hạn', today: 'Hôm nay' } as const;

/** Whether staff reviewed the value, and how sure the server is (low confidence is never shown). */
function IdentityMarks({ line }: { line: CrmIdentityLine }) {
  return (
    <>
      <span className={`v2-crm-card__badge${line.badge === 'AI' ? ' is-ai' : ' is-reviewed'}`}>{line.badge}</span>
      <span className="v2-crm__meta">{`tin cậy ${line.confidence}`}</span>
    </>
  );
}

/**
 * "Thẻ nhận diện khách": the customer clicked in the graph, read-only, from the saved row the table shows.
 * Editing stays in the table ("Mở hồ sơ").
 */
export function CustomerCrmCard({
  row, nowMs, assignees, products, onCopy, onOpenProfile, onClose, cardRef,
}: CustomerCrmCardProps) {
  const { profile } = row;
  const name = crmCustomerLabel(row);
  const headingId = `crm-card-title-${row.leadId}`;
  const due = crmDue(profile, nowMs);
  const known = products.filter((product) => profile.productFactIds.includes(product.id));
  const otherProducts = profile.productFactIds.length - known.length;
  const occasion = CRM_OCCASION_OPTIONS.find((option) => option.value === profile.occasion)?.label ?? null;
  const identity = crmIdentityView(row.identity, products);
  const identityId = `crm-card-identity-${row.leadId}`;

  return (
    <aside ref={cardRef} className="v2-crm-card" aria-labelledby={headingId} tabIndex={-1}>
      <header className="v2-crm-card__header">
        <div className="v2-crm-card__who">
          <h3 id={headingId} className="v2-crm-card__name">{name}</h3>
          {row.zaloMentioned && <span className="v2-badge">Có nhắc Zalo</span>}
        </div>
        <button type="button" className="v2-button v2-button--ghost v2-crm-card__close" aria-label="Đóng thẻ khách" onClick={onClose}>
          ✕
        </button>
      </header>

      <div className="v2-crm-card__phone">
        <span>{formatLeadPhone(row.phone)}</span>
        <button type="button" className="v2-button v2-button--ghost" aria-label={`Sao chép số của ${name}`} onClick={onCopy}>
          Sao chép
        </button>
      </div>

      <dl className="v2-crm-card__facts">
        <div>
          <dt>Giai đoạn</dt>
          <dd>
            <span className="v2-crm-card__dot" style={{ background: CRM_STAGE_COLORS[profile.stage] }} aria-hidden="true" />
            {crmStageLabel(profile.stage)}
          </dd>
        </div>
        <div>
          <dt>Phụ trách</dt>
          <dd>{crmAssigneeLabel(assignees, profile.ownerUserId)}</dd>
        </div>
        <div>
          <dt>Việc tiếp theo</dt>
          <dd>
            {(due === 'overdue' || due === 'today') && <span className={`v2-crm__due is-${due}`}>{DUE_BADGE[due]}</span>}
            <span>{profile.nextStep ?? (profile.stage === 'has_phone' ? 'Gọi lần đầu' : '—')}</span>
            {profile.nextStepDueAt && <time className="v2-crm__meta" dateTime={profile.nextStepDueAt}>{formatCrmDue(profile.nextStepDueAt)}</time>}
          </dd>
        </div>
        {(known.length > 0 || otherProducts > 0) && (
          <div>
            <dt>Sản phẩm</dt>
            <dd>
              <ul className="v2-crm-card__list">
                {known.map((product) => <li key={product.id}>{product.label}</li>)}
                {otherProducts > 0 && <li className="v2-crm__meta">{`${otherProducts} sản phẩm khác`}</li>}
              </ul>
            </dd>
          </div>
        )}
        {(occasion !== null || profile.neededBy !== null) && (
          <div>
            <dt>Dịp mua</dt>
            <dd>
              {occasion ?? '—'}
              {profile.neededBy !== null && <span className="v2-crm__meta">{` · cần trước ${formatCrmDay(profile.neededBy)}`}</span>}
            </dd>
          </div>
        )}
      </dl>

      {crmRowReadOnly(row) && <p className="v2-crm__hint">Không đọc được chi tiết khách này.</p>}

      {identity && (identity.consent !== null || identity.lines.length > 0 || identity.age !== null) && (
        <section className="v2-crm-card__identity" aria-labelledby={identityId}>
          <div className="v2-crm-card__identity-head">
            <h4 id={identityId} className="v2-crm-card__section">Nhận diện</h4>
            {identity.consent && (
              <span className={`v2-crm-card__consent is-${identity.consent.tone}`}>
                <span className="v2-visually-hidden">Xin phép lưu hồ sơ: </span>
                {identity.consent.label}
              </span>
            )}
          </div>
          {identity.lines.length > 0 && (
            <ul className="v2-crm-card__layers">
              {identity.lines.map((line) => (
                <li key={line.key}>
                  <span className="v2-crm-card__layer-label">{line.label}</span>
                  <span className="v2-crm-card__layer-value">{line.value}</span>
                  <IdentityMarks line={line} />
                  {line.quote && <q className="v2-crm-card__quote">{line.quote}</q>}
                </li>
              ))}
            </ul>
          )}
          {identity.age && (
            <p className="v2-crm-card__age">
              <span>{`${identity.age.label}: ${identity.age.value}`}</span>
              <IdentityMarks line={identity.age} />
            </p>
          )}
        </section>
      )}

      <div className="v2-crm-card__actions">
        <button type="button" className="v2-button v2-button--primary" onClick={onOpenProfile}>Mở hồ sơ</button>
      </div>
    </aside>
  );
}
