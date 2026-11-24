import type {
  CustomerCareCrmAddressForm,
  CustomerCareCrmAssignee,
  CustomerCareCrmLostReason,
  CustomerCareCrmOccasion,
  CustomerCareCrmProfileInput,
  CustomerCareCrmRow,
  CustomerCareCrmStage,
} from '../../shared/customer-care-types';
import { formatLeadAbsoluteTime, formatLeadPhone, formatLeadTime, leadDisplayName } from './customer-care-leads-flow';
import {
  CRM_ADDRESS_FORM_OPTIONS,
  CRM_LOST_REASON_OPTIONS,
  CRM_MAX_NEXT_STEP,
  CRM_MAX_NOTE,
  CRM_MAX_PRODUCTS,
  CRM_OCCASION_OPTIONS,
  CRM_STAGE_OPTIONS,
  crmAssigneeLabel,
  crmChangedFields,
  crmDateBounds,
  crmDue,
  crmFieldVisibility,
  crmProfilesEqual,
  crmRowReadOnly,
  formatCrmDue,
  isoToLocalInput,
  localInputToIso,
  normalizeCrmProfile,
  profileFromRow,
  type CrmProductOption,
  type CrmRowEdit,
} from './customer-crm-flow';

export interface CustomerCrmRowProps {
  row: CustomerCareCrmRow;
  /** What the row shows: the unsaved draft, or the saved profile. */
  profile: CustomerCareCrmProfileInput;
  edit: CrmRowEdit | null;
  saving: boolean;
  expanded: boolean;
  nowMs: number;
  assignees: readonly CustomerCareCrmAssignee[];
  /** The shop's approved product facts on this machine; empty hides the picker. */
  products: readonly CrmProductOption[];
  /** Display hint from the server and the live role; main and the server re-check the purge. */
  canDelete: boolean;
  purging: boolean;
  onChange: (profile: CustomerCareCrmProfileInput) => void;
  onToggle: () => void;
  onSave: () => void;
  onCopy: () => void;
  onPurge: () => void;
  onReapply: () => void;
  onDiscard: () => void;
}

const DUE_BADGE = { overdue: 'Quá hạn', today: 'Hôm nay' } as const;

function nullable<T extends string>(value: string): T | null {
  return value === '' ? null : value as T;
}

/** One customer: a summary line in the call list, and the full profile form when opened. */
export function CustomerCrmRow(props: CustomerCrmRowProps) {
  const { row, profile, edit, saving, expanded, nowMs, assignees, onToggle, onCopy } = props;
  const name = leadDisplayName(row);
  const due = crmDue(profile, nowMs);
  const editorId = `crm-editor-${row.leadId}`;
  const stageId = `crm-stage-${row.leadId}`;
  const readOnly = crmRowReadOnly(row);
  const dirty = edit !== null && !crmProfilesEqual(normalizeCrmProfile(edit.draft), profileFromRow(row));
  const status = saving ? 'Đang lưu…' : edit?.rejected ? 'Cần xem lại' : edit?.error ? 'Chưa lưu được' : dirty ? 'Chưa lưu' : '';

  return (
    <>
      <tr className={`v2-crm__row${expanded ? ' is-open' : ''}${due === 'overdue' ? ' is-overdue' : ''}`}>
        <td>
          <div className="v2-crm__who">
            <strong>{name}</strong>
            {row.zaloMentioned && <span className="v2-badge">Có nhắc Zalo</span>}
            <span className="v2-crm__phone">{formatLeadPhone(row.phone)}</span>
            <time className="v2-crm__meta" dateTime={row.phoneCapturedAt} title={formatLeadAbsoluteTime(row.phoneCapturedAt)}>
              Để lại số: {formatLeadTime(row.phoneCapturedAt, nowMs)}
            </time>
          </div>
        </td>
        <td>
          <label className="v2-visually-hidden" htmlFor={stageId}>{`Giai đoạn của ${name}`}</label>
          <select
            id={stageId}
            className="v2-field__select"
            value={profile.stage}
            disabled={readOnly}
            onChange={(event) => props.onChange({ ...profile, stage: event.currentTarget.value as CustomerCareCrmStage })}
          >
            {CRM_STAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </td>
        <td className="v2-crm__owner">{crmAssigneeLabel(assignees, profile.ownerUserId)}</td>
        <td>
          <div className="v2-crm__next">
            {due === 'overdue' || due === 'today' ? (
              <span className={`v2-crm__due is-${due}`}>{DUE_BADGE[due]}</span>
            ) : null}
            <span>{profile.nextStep ?? (profile.stage === 'has_phone' ? 'Gọi lần đầu' : '—')}</span>
            {profile.nextStepDueAt && <time className="v2-crm__meta" dateTime={profile.nextStepDueAt}>{formatCrmDue(profile.nextStepDueAt)}</time>}
          </div>
        </td>
        <td className="v2-crm__status" aria-live="polite">{status}</td>
        <td className="v2-crm__actions">
          <button type="button" className="v2-button v2-button--ghost" aria-label={`Sao chép số của ${name}`} onClick={onCopy}>
            Sao chép
          </button>
          <button
            type="button"
            className="v2-button v2-button--ghost"
            aria-expanded={expanded}
            aria-controls={editorId}
            onClick={onToggle}
          >
            {expanded ? 'Đóng' : 'Sửa'}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="v2-crm__editor-row">
          <td colSpan={6}>
            <CrmEditor {...props} name={name} editorId={editorId} dirty={dirty} />
          </td>
        </tr>
      )}
    </>
  );
}

interface CrmEditorProps extends CustomerCrmRowProps {
  name: string;
  editorId: string;
  dirty: boolean;
}

function CrmEditor({
  row, profile, edit, saving, nowMs, assignees, products, canDelete, purging,
  onChange, onSave, onPurge, onReapply, onDiscard, onToggle, name, editorId, dirty,
}: CrmEditorProps) {
  const id = (field: string) => `crm-${field}-${row.leadId}`;
  // Sealed details could not be opened: plain fields only, read-only, never saved.
  const readOnly = crmRowReadOnly(row);
  const visible = crmFieldVisibility(profile.stage);
  const bounds = crmDateBounds(nowMs);
  const set = (changes: Partial<CustomerCareCrmProfileInput>) => onChange({ ...profile, ...changes });
  const ownerKnown = profile.ownerUserId === null || assignees.some((item) => item.userId === profile.ownerUserId);
  const offered = new Set(products.map((product) => product.id));
  const otherProducts = profile.productFactIds.filter((productId) => !offered.has(productId)).length;
  const productLimitReached = profile.productFactIds.length >= CRM_MAX_PRODUCTS;
  const toggleProduct = (productId: string, checked: boolean) => set({
    productFactIds: checked
      ? [...profile.productFactIds, productId]
      : profile.productFactIds.filter((item) => item !== productId),
  });

  return (
    <div id={editorId} className="v2-crm__editor" role="group" aria-label={`Hồ sơ của ${name}`}>
      {edit?.rejected ? (
        <div className="v2-crm__conflict" role="alert">
          <p><strong>{edit.error}</strong> Đang hiện thông tin mới nhất. Bạn đã nhập:</p>
          <ul>
            {crmChangedFields(edit.rejected, profile, assignees, products).map((field) => (
              <li key={field.label}><span>{field.label}:</span> {field.value}</li>
            ))}
          </ul>
          <div className="v2-crm__buttons">
            <button type="button" className="v2-button" onClick={onReapply}>Dùng lại thay đổi của tôi</button>
            <button type="button" className="v2-button v2-button--ghost" onClick={onDiscard}>Bỏ thay đổi của tôi</button>
          </div>
        </div>
      ) : edit?.error ? (
        <p className="v2-crm__error" role="alert">{edit.error}</p>
      ) : null}
      {readOnly && <p className="v2-crm__hint" role="note">Không đọc được chi tiết khách này.</p>}

      <div className="v2-crm__fields">
        <label className="v2-field" htmlFor={id('editor-stage')}>
          <span className="v2-field__label">Giai đoạn</span>
          <select
            id={id('editor-stage')}
            className="v2-field__select"
            value={profile.stage}
            disabled={readOnly}
            onChange={(event) => set({ stage: event.currentTarget.value as CustomerCareCrmStage })}
          >
            {CRM_STAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>

        <label className="v2-field" htmlFor={id('owner')}>
          <span className="v2-field__label">Người phụ trách</span>
          <select
            id={id('owner')}
            className="v2-field__select"
            disabled={readOnly}
            value={profile.ownerUserId ?? ''}
            onChange={(event) => set({ ownerUserId: nullable<string>(event.currentTarget.value) })}
          >
            <option value="">Chưa giao</option>
            {assignees.map((assignee) => (
              <option key={assignee.userId} value={assignee.userId}>{crmAssigneeLabel(assignees, assignee.userId)}</option>
            ))}
            {!ownerKnown && <option value={profile.ownerUserId ?? ''}>Người đã rời dự án</option>}
          </select>
        </label>

        {!readOnly && (
        <label className="v2-field" htmlFor={id('address')}>
          <span className="v2-field__label">Xưng hô</span>
          <select
            id={id('address')}
            className="v2-field__select"
            value={profile.addressForm ?? ''}
            onChange={(event) => set({ addressForm: nullable<CustomerCareCrmAddressForm>(event.currentTarget.value) })}
          >
            <option value="">Chưa chọn</option>
            {CRM_ADDRESS_FORM_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        )}

        {!readOnly && (
        <label className="v2-field" htmlFor={id('occasion')}>
          <span className="v2-field__label">Dịp mua</span>
          <select
            id={id('occasion')}
            className="v2-field__select"
            value={profile.occasion ?? ''}
            onChange={(event) => set({ occasion: nullable<CustomerCareCrmOccasion>(event.currentTarget.value) })}
          >
            <option value="">Chưa rõ</option>
            {CRM_OCCASION_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        )}

        <label className="v2-field" htmlFor={id('needed')}>
          <span className="v2-field__label">Cần trước ngày</span>
          <input
            id={id('needed')}
            type="date"
            disabled={readOnly}
            className="v2-field__input"
            min={bounds.min}
            max={bounds.max}
            value={profile.neededBy ?? ''}
            onChange={(event) => set({ neededBy: nullable<string>(event.currentTarget.value) })}
          />
        </label>

        {visible.lostReason && !readOnly && (
          <label className="v2-field" htmlFor={id('lost')}>
            <span className="v2-field__label">Lý do không mua</span>
            <select
              id={id('lost')}
              className="v2-field__select"
              value={profile.lostReason ?? ''}
              onChange={(event) => set({ lostReason: nullable<CustomerCareCrmLostReason>(event.currentTarget.value) })}
            >
              <option value="">Chưa chọn</option>
              {CRM_LOST_REASON_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
        )}

        {visible.purchasedAt && (
          <label className="v2-field" htmlFor={id('purchased')}>
            <span className="v2-field__label">Ngày mua</span>
            <input
              id={id('purchased')}
              type="date"
              disabled={readOnly}
              className="v2-field__input"
              min={bounds.min}
              max={bounds.max}
              value={profile.purchasedAt ?? ''}
              onChange={(event) => set({ purchasedAt: nullable<string>(event.currentTarget.value) })}
            />
          </label>
        )}
      </div>

      <div className="v2-crm__fields v2-crm__fields--wide">
        {!readOnly && (
        <label className="v2-field v2-crm__grow" htmlFor={id('next')}>
          <span className="v2-field__label">Việc tiếp theo</span>
          <input
            id={id('next')}
            type="text"
            className="v2-field__input"
            maxLength={CRM_MAX_NEXT_STEP}
            placeholder="Ví dụ: gọi báo giá"
            value={profile.nextStep ?? ''}
            onChange={(event) => set({ nextStep: event.currentTarget.value === '' ? null : event.currentTarget.value })}
          />
        </label>
        )}
        <label className="v2-field" htmlFor={id('due')}>
          <span className="v2-field__label">Hạn</span>
          <input
            id={id('due')}
            type="datetime-local"
            disabled={readOnly}
            className="v2-field__input"
            min={`${bounds.min}T00:00`}
            max={`${bounds.max}T23:59`}
            value={isoToLocalInput(profile.nextStepDueAt)}
            onChange={(event) => set({ nextStepDueAt: localInputToIso(event.currentTarget.value) })}
          />
        </label>
      </div>

      {products.length > 0 && !readOnly && (
        <fieldset className="v2-crm__products">
          <legend className="v2-field__label">Sản phẩm quan tâm (tối đa {CRM_MAX_PRODUCTS})</legend>
          {products.map((product, index) => {
            const checked = profile.productFactIds.includes(product.id);
            return (
              <label key={product.id} className="v2-crm__product" htmlFor={id(`product-${index}`)}>
                <input
                  id={id(`product-${index}`)}
                  type="checkbox"
                  checked={checked}
                  disabled={!checked && productLimitReached}
                  onChange={(event) => toggleProduct(product.id, event.currentTarget.checked)}
                />
                <span>{product.label}</span>
              </label>
            );
          })}
          {otherProducts > 0 && <p className="v2-crm__meta">{otherProducts} sản phẩm đã chọn không có trên máy này.</p>}
        </fieldset>
      )}

      {!readOnly && (
      <label className="v2-field v2-crm__note" htmlFor={id('note')}>
        <span className="v2-field__label">Ghi chú</span>
        <textarea
          id={id('note')}
          className="v2-field__input"
          rows={3}
          maxLength={CRM_MAX_NOTE}
          value={profile.note ?? ''}
          onChange={(event) => set({ note: event.currentTarget.value === '' ? null : event.currentTarget.value })}
        />
      </label>
      )}

      {row.recentMessages.length > 0 && (
        <div className="v2-crm__messages">
          <span className="v2-field__label">Tin gần nhất</span>
          <ol aria-label={`Tin gần nhất của ${name}`}>
            {row.recentMessages.map((message, index) => (
              <li key={`${message.at}-${index}`}>
                <p>{message.text}</p>
                <time className="v2-crm__meta" dateTime={message.at}>{formatLeadTime(message.at, nowMs)}</time>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="v2-crm__footer">
        <span className="v2-crm__meta">
          {row.profile.updatedAt
            ? `Cập nhật ${formatCrmDue(row.profile.updatedAt)}${row.profile.updatedBy
              ? ` · ${crmAssigneeLabel(assignees, row.profile.updatedBy)}`
              : ''}`
            : 'Chưa có hồ sơ. Tự lưu sau khi bạn ngừng gõ.'}
        </span>
        <div className="v2-crm__buttons">
          {canDelete && (
            <button
              type="button"
              className="v2-button v2-crm__danger"
              disabled={purging || saving}
              aria-busy={purging || undefined}
              aria-label={`Xoá dữ liệu khách ${name}`}
              onClick={onPurge}
            >
              {purging ? 'Đang xoá…' : 'Xoá dữ liệu khách'}
            </button>
          )}
          <button type="button" className="v2-button v2-button--ghost" onClick={onToggle}>Đóng</button>
          {!readOnly && (
            <button
              type="button"
              className="v2-button v2-button--primary"
              disabled={!dirty || saving}
              onClick={onSave}
            >
              {saving ? 'Đang lưu…' : 'Lưu'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
