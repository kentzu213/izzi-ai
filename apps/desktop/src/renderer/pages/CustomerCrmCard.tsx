import type { Ref } from 'react';
import type { CustomerCareCrmAssignee, CustomerCareCrmRow } from '../../shared/customer-care-types';
import { formatLeadPhone } from './customer-care-leads-flow';
import {
  crmAssigneeLabel,
  crmDue,
  crmRowReadOnly,
  crmStageLabel,
  formatCrmDay,
  formatCrmDue,
  type CrmProductOption,
} from './customer-crm-flow';
import { CRM_STAGE_COLORS, crmCardOccasion, crmCustomerLabel, crmIdentityOccasionLine } from './customer-crm-graph';
import { crmIdentityPermissions } from './customer-crm-identity';
import { CrmIdentityFieldActions, CustomerCrmIdentity, useCrmIdentityController, type CrmIdentityHandlers } from './CustomerCrmIdentity';

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
  /** Care CRM S3 staff actions on the identity; absent shows the identity read-only. */
  identityHandlers?: CrmIdentityHandlers | null;
  /** Owner or manager with the purge available (an erase request then offers "Xoá dữ liệu khách"). */
  canDelete?: boolean;
  /** The existing purge for this customer. */
  onPurge?: () => void;
}

const DUE_BADGE = { overdue: 'Quá hạn', today: 'Hôm nay' } as const;

/**
 * "Thẻ nhận diện khách": the customer clicked in the graph, from the saved row the table shows. The staff profile
 * is read-only here (editing stays in the table, "Mở hồ sơ"); the AI identity takes Duyệt / Sửa / Bỏ, the consent
 * question and "Cập nhật hồ sơ".
 */
export function CustomerCrmCard({
  row, nowMs, assignees, products, onCopy, onOpenProfile, onClose, cardRef, identityHandlers = null, canDelete = false, onPurge,
}: CustomerCrmCardProps) {
  const { profile } = row;
  const name = crmCustomerLabel(row);
  const headingId = `crm-card-title-${row.leadId}`;
  const due = crmDue(profile, nowMs);
  const known = products.filter((product) => profile.productFactIds.includes(product.id));
  const otherProducts = profile.productFactIds.length - known.length;
  // One "Dịp mua": the staff value, or the AI suggestion when staff left it empty.
  const occasion = crmCardOccasion(row);
  // The AI occasion is acted on in that same row, through the controller the identity section uses.
  const identityControl = useCrmIdentityController(row, identityHandlers);
  const aiOccasion = crmIdentityOccasionLine(row);
  const occasionActions = row.identity && aiOccasion
    && crmIdentityPermissions(row.identity, identityHandlers?.enabled ?? null, identityHandlers !== null, identityHandlers?.consentAsk ?? null)
      .fieldActions;

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
              {occasion?.label ?? '—'}
              {occasion?.badge && (
                <span className={`v2-crm-card__badge${occasion.badge === 'AI gợi ý' ? ' is-ai' : ' is-reviewed'}`}>{occasion.badge}</span>
              )}
              {profile.neededBy !== null && <span className="v2-crm__meta">{` · cần trước ${formatCrmDay(profile.neededBy)}`}</span>}
              {occasionActions && row.identity && aiOccasion && (
                <CrmIdentityFieldActions row={row} identity={row.identity} line={aiOccasion} products={products} controller={identityControl} />
              )}
            </dd>
          </div>
        )}
      </dl>

      {crmRowReadOnly(row) && <p className="v2-crm__hint">Không đọc được chi tiết khách này.</p>}

      <CustomerCrmIdentity
        row={row}
        products={products}
        handlers={identityHandlers}
        place="card"
        canDelete={canDelete}
        onPurge={onPurge}
        controller={identityControl}
      />

      <div className="v2-crm-card__actions">
        <button type="button" className="v2-button v2-button--primary" onClick={onOpenProfile}>Mở hồ sơ</button>
      </div>
    </aside>
  );
}
