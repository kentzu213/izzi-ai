import { useEffect, useState } from 'react';
import type {
  CustomerCareCrmAddressForm,
  CustomerCareCrmAssignee,
  CustomerCareCrmCareStep,
  CustomerCareCrmLostReason,
  CustomerCareCrmOccasion,
  CustomerCareCrmProfileInput,
  CustomerCareCrmRow,
  CustomerCareCrmSalerMember,
  CustomerCareCrmStage,
} from '../../shared/customer-care-types';
import {
  extractEditableFreeNote,
  maxFreeNoteLength,
  splitCrmNote,
} from '../../shared/customer-crm-enterprise';
import {
  CRM_CARE_STEP_META,
  CRM_CARE_STEP_ORDER,
  CRM_SALER_COLOR_PALETTE,
} from '../../shared/customer-crm-saler-routing';
import { formatLeadAbsoluteTime, formatLeadPhone, formatLeadTime, leadDisplayName } from './customer-care-leads-flow';
import {
  CRM_ADDRESS_FORM_OPTIONS,
  CRM_LOST_REASON_OPTIONS,
  CRM_MAX_NEXT_STEP,
  CRM_MAX_PRODUCTS,
  CRM_OCCASION_OPTIONS,
  CRM_STAGE_OPTIONS,
  crmAssigneeLabel,
  crmChangedFields,
  crmDateBounds,
  crmFieldVisibility,
  crmProfilesEqual,
  crmRowReadOnly,
  formatCrmDue,
  isoToLocalInput,
  localInputToIso,
  normalizeCrmProfile,
  profileFromRow,
  resolveCrmRowSaler,
  type CrmProductOption,
  type CrmRowEdit,
} from './customer-crm-flow';
import { crmIdentityView } from './customer-crm-graph';
import { CustomerCrmIdentity, type CrmIdentityHandlers } from './CustomerCrmIdentity';
import { updateCrmRowFreeNote } from './CustomerCrmRow';

export type CrmDrawerTab = 'profile' | 'identity' | 'messages';

export interface CustomerCrmDrawerProps {
  row: CustomerCareCrmRow;
  profile: CustomerCareCrmProfileInput;
  edit: CrmRowEdit | null;
  saving: boolean;
  nowMs: number;
  pageLabel: string;
  assignees: readonly CustomerCareCrmAssignee[];
  salers?: readonly CustomerCareCrmSalerMember[];
  products: readonly CrmProductOption[];
  canDelete: boolean;
  purging: boolean;
  identityHandlers?: CrmIdentityHandlers | null;
  tab?: CrmDrawerTab;
  onTabChange?: (tab: CrmDrawerTab) => void;
  positionLabel?: string;
  hasPrev: boolean;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onChange: (profile: CustomerCareCrmProfileInput) => void;
  onSave: () => void;
  onCopy: () => void;
  onPurge: () => void;
  onReapply: () => void;
  onDiscard: () => void;
}

function nullable<T extends string>(value: string): T | null {
  return value === '' ? null : (value as T);
}

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Unified right-hand slide-over CRM drawer (420px, HubSpot / Attio style):
 * - Tab 1 (`profile`): Hồ sơ & Hẹn gọi (form + 409 conflict resolution)
 * - Tab 2 (`identity`): Nhận diện (AI) (Care CRM S3 I4 card: consent, Xin phép khách, Cập nhật hồ sơ, Duyệt/Sửa/Bỏ)
 * - Tab 3 (`messages`): Tin nhắn & Nguồn (Multi-Page attribution, recent messages, copy phone & owner/manager purge)
 */
export function CustomerCrmDrawer({
  row,
  profile,
  edit,
  saving,
  nowMs,
  pageLabel,
  assignees,
  salers = [],
  products,
  canDelete,
  purging,
  identityHandlers = null,
  tab,
  onTabChange,
  positionLabel,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  onClose,
  onChange,
  onSave,
  onCopy,
  onPurge,
  onReapply,
  onDiscard,
}: CustomerCrmDrawerProps) {
  const [internalTab, setInternalTab] = useState<CrmDrawerTab>(() => (edit?.rejected ? 'profile' : (tab ?? 'profile')));
  const requestedTab = tab ?? internalTab;
  const hasConflict = Boolean(edit?.rejected);
  // Always surface Tab 1 immediately when a 409 profile_conflict needs user action.
  const activeTab: CrmDrawerTab = hasConflict ? 'profile' : requestedTab;

  const selectTab = (next: CrmDrawerTab) => {
    setInternalTab(next);
    onTabChange?.(next);
  };

  useEffect(() => {
    if (hasConflict && requestedTab !== 'profile') {
      setInternalTab('profile');
      onTabChange?.('profile');
    }
  }, [hasConflict, requestedTab, onTabChange]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.key === 'Escape' && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey || isEditableElement(event.target)) return;
      if ((event.key === 'j' || event.key === 'J') && hasNext) {
        event.preventDefault();
        onNext();
      } else if ((event.key === 'k' || event.key === 'K') && hasPrev) {
        event.preventDefault();
        onPrev();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hasNext, hasPrev, onClose, onNext, onPrev]);

  const name = leadDisplayName(row);
  const readOnly = crmRowReadOnly(row);
  const dirty = edit !== null && !crmProfilesEqual(normalizeCrmProfile(edit.draft), profileFromRow(row));
  const status = saving ? 'Đang lưu…' : edit?.rejected ? 'Cần xem lại' : edit?.error ? 'Chưa lưu được' : dirty ? 'Chưa lưu' : '';
  const visible = crmFieldVisibility(profile.stage);
  const bounds = crmDateBounds(nowMs);
  const id = (field: string) => `crm-drawer-${field}-${row.leadId}`;
  const set = (changes: Partial<CustomerCareCrmProfileInput>) => onChange({ ...profile, ...changes });
  const ownerKnown = profile.ownerUserId === null || assignees.some((item) => item.userId === profile.ownerUserId);
  const offered = new Set(products.map((product) => product.id));
  const otherProducts = profile.productFactIds.filter((productId) => !offered.has(productId)).length;
  const productLimitReached = profile.productFactIds.length >= CRM_MAX_PRODUCTS;
  const { ctx: noteCtx } = splitCrmNote(profile.note);
  const noteMaxLength = maxFreeNoteLength(noteCtx);
  const noteValue = extractEditableFreeNote(profile.note);
  const identityPreview = crmIdentityView(row.identity, products);
  const erasePending = Boolean(row.identity?.consent?.eraseRequestedAt);
  const activeSaler = resolveCrmRowSaler(salers, profile);
  const salerPalette = activeSaler ? CRM_SALER_COLOR_PALETTE[activeSaler.color] : null;

  const toggleProduct = (productId: string, checked: boolean) => set({
    productFactIds: checked
      ? [...profile.productFactIds, productId]
      : profile.productFactIds.filter((item) => item !== productId),
  });

  return (
    <aside
      id={`crm-editor-${row.leadId}`}
      className="v2-crm-drawer"
      aria-label={`Ngăn hồ sơ ${name}`}
    >
      <header className="v2-crm-drawer__header">
        <div className="v2-crm-drawer__identity">
          <div className="v2-crm-drawer__title-row">
            <h3 className="v2-crm-drawer__title">{name}</h3>
            {row.zaloMentioned && <span className="v2-badge">Có nhắc Zalo</span>}
            {status && <span className="v2-crm-drawer__status" aria-live="polite">{status}</span>}
          </div>
          <div className="v2-crm-drawer__sub-row">
            <span className="v2-crm__phone">{formatLeadPhone(row.phone)}</span>
            <button
              type="button"
              className="v2-button v2-button--ghost v2-crm-drawer__mini-btn"
              aria-label={`Sao chép số của ${name}`}
              onClick={onCopy}
            >
              Sao chép
            </button>
            <span className="v2-crm__page-tag">{pageLabel}</span>
            {activeSaler && salerPalette && (
              <span
                className="v2-crm-saler-chip"
                style={{ background: salerPalette.bg, borderColor: salerPalette.border, color: salerPalette.text }}
              >
                {activeSaler.name}
              </span>
            )}
            {erasePending ? (
              <span className="v2-crm-chip is-danger">Yêu cầu xoá</span>
            ) : identityPreview?.consent ? (
              <span className={`v2-crm-card__consent is-${identityPreview.consent.tone}`}>
                {identityPreview.consent.label}
              </span>
            ) : null}
          </div>
        </div>

        <div className="v2-crm-drawer__nav" role="group" aria-label="Điều hướng ngăn hồ sơ">
          {positionLabel && <span className="v2-crm__meta">{positionLabel}</span>}
          <button
            type="button"
            className="v2-button v2-button--ghost v2-crm-drawer__icon-btn"
            disabled={!hasPrev}
            aria-label="Khách trước (K)"
            title="Khách trước (K)"
            onClick={onPrev}
          >
            ↑
          </button>
          <button
            type="button"
            className="v2-button v2-button--ghost v2-crm-drawer__icon-btn"
            disabled={!hasNext}
            aria-label="Khách tiếp theo (J)"
            title="Khách tiếp theo (J)"
            onClick={onNext}
          >
            ↓
          </button>
          <button
            type="button"
            className="v2-button v2-button--ghost v2-crm-drawer__icon-btn"
            aria-label="Đóng ngăn hồ sơ (Esc)"
            title="Đóng (Esc)"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
      </header>

      <div className="v2-crm-drawer__tabs" role="tablist" aria-label="Các mục hồ sơ khách">
        <button
          id={id('tab-profile')}
          type="button"
          role="tab"
          aria-selected={activeTab === 'profile'}
          aria-controls={id('panel-profile')}
          className={`v2-crm-drawer__tab${activeTab === 'profile' ? ' is-active' : ''}`}
          onClick={() => selectTab('profile')}
        >
          Hồ sơ &amp; Hẹn gọi
        </button>
        <button
          id={id('tab-identity')}
          type="button"
          role="tab"
          aria-selected={activeTab === 'identity'}
          aria-controls={id('panel-identity')}
          className={`v2-crm-drawer__tab${activeTab === 'identity' ? ' is-active' : ''}`}
          disabled={hasConflict}
          onClick={() => selectTab('identity')}
        >
          {`Nhận diện (AI)${erasePending ? ' !' : ''}`}
        </button>
        <button
          id={id('tab-messages')}
          type="button"
          role="tab"
          aria-selected={activeTab === 'messages'}
          aria-controls={id('panel-messages')}
          className={`v2-crm-drawer__tab${activeTab === 'messages' ? ' is-active' : ''}`}
          disabled={hasConflict}
          onClick={() => selectTab('messages')}
        >
          {`Tin nhắn (${row.recentMessages.length})`}
        </button>
      </div>

      <div className="v2-crm-drawer__body">
        {activeTab === 'profile' && (
          <div
            id={id('panel-profile')}
            role="tabpanel"
            aria-labelledby={id('tab-profile')}
            className="v2-crm-drawer__panel"
          >
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

            <div className="v2-crm-drawer__grid">
              <label className="v2-field" htmlFor={id('stage')}>
                <span className="v2-field__label">Giai đoạn</span>
                <select
                  id={id('stage')}
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

              {salers.length > 0 && (
                <label className="v2-field" htmlFor={id('saler')}>
                  <span className="v2-field__label">Saler phụ trách</span>
                  <select
                    id={id('saler')}
                    className="v2-field__select"
                    disabled={readOnly}
                    value={profile.salerId ?? ''}
                    onChange={(event) => {
                      const sid = nullable<string>(event.currentTarget.value);
                      const chosen = sid ? salers.find((s) => s.id === sid) : null;
                      set({ salerId: sid, ownerUserId: chosen ? chosen.memberUserId : profile.ownerUserId });
                    }}
                  >
                    <option value="">Chưa giao Saler</option>
                    {salers.map((saler) => (
                      <option key={saler.id} value={saler.id}>{saler.name}</option>
                    ))}
                  </select>
                </label>
              )}

              <label className="v2-field" htmlFor={id('care-step')}>
                <span className="v2-field__label">Bước chăm sóc</span>
                <select
                  id={id('care-step')}
                  className="v2-field__select"
                  disabled={readOnly}
                  value={profile.careStep ?? ''}
                  onChange={(event) => set({ careStep: nullable<CustomerCareCrmCareStep>(event.currentTarget.value) })}
                >
                  <option value="">Tự động theo giai đoạn</option>
                  {CRM_CARE_STEP_ORDER.map((step) => (
                    <option key={step} value={step}>{CRM_CARE_STEP_META[step].label}</option>
                  ))}
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

            <div className="v2-crm-drawer__grid">
              {!readOnly && (
                <label className="v2-field" htmlFor={id('next')}>
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
              <fieldset className="v2-crm__products v2-crm-drawer__products">
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
                  maxLength={noteMaxLength}
                  value={noteValue}
                  onChange={(event) => onChange(updateCrmRowFreeNote(profile, event.currentTarget.value))}
                />
              </label>
            )}

            <div className="v2-crm__footer">
              <span className="v2-crm__meta">
                {row.profile.updatedAt
                  ? `Cập nhật ${formatCrmDue(row.profile.updatedAt)}${row.profile.updatedBy
                    ? ` · ${crmAssigneeLabel(assignees, row.profile.updatedBy)}`
                    : ''}`
                  : 'Tự động lưu sau khi ngừng gõ.'}
              </span>
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
        )}

        {activeTab === 'identity' && (
          <div
            id={id('panel-identity')}
            role="tabpanel"
            aria-labelledby={id('tab-identity')}
            className="v2-crm-drawer__panel"
          >
            {!row.identity && !row.identityUnavailable ? (
              <p className="v2-crm__meta">Máy chủ chưa gửi dữ liệu Nhận diện (AI) cho khách này.</p>
            ) : (
              <CustomerCrmIdentity
                key={row.leadId}
                row={row}
                products={products}
                handlers={identityHandlers}
                place="editor"
                canDelete={canDelete}
                onPurge={purging ? undefined : onPurge}
              />
            )}
          </div>
        )}

        {activeTab === 'messages' && (
          <div
            id={id('panel-messages')}
            role="tabpanel"
            aria-labelledby={id('tab-messages')}
            className="v2-crm-drawer__panel"
          >
            <div className="v2-crm-drawer__source-card">
              <div className="v2-crm-drawer__source-row">
                <span className="v2-field__label">Nguồn Page</span>
                <strong>{pageLabel}</strong>
              </div>
              <div className="v2-crm-drawer__source-row">
                <span className="v2-crm__meta">{`Page ID: ${row.pageId}`}</span>
                <time className="v2-crm__meta" dateTime={row.phoneCapturedAt} title={formatLeadAbsoluteTime(row.phoneCapturedAt)}>
                  {`Để lại số: ${formatLeadTime(row.phoneCapturedAt, nowMs)}`}
                </time>
              </div>
              <div className="v2-crm-drawer__phone-bar">
                <span className="v2-crm__phone">{formatLeadPhone(row.phone)}</span>
                <button type="button" className="v2-button v2-button--ghost" onClick={onCopy}>
                  Sao chép SĐT
                </button>
              </div>
            </div>

            <div className="v2-crm__messages">
              <span className="v2-field__label">Lịch sử tin nhắn khách gửi</span>
              {row.recentMessages.length === 0 ? (
                <p className="v2-crm__meta">Chưa có nội dung tin nhắn lưu kèm.</p>
              ) : (
                <ol aria-label={`Tin gần nhất của ${name}`}>
                  {row.recentMessages.map((message, index) => (
                    <li key={`${message.at}-${index}`} className="v2-crm-drawer__msg-item">
                      <p>{message.text}</p>
                      <time className="v2-crm__meta" dateTime={message.at}>{formatLeadTime(message.at, nowMs)}</time>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            {canDelete && (
              <div className="v2-crm-drawer__danger-zone">
                <span className="v2-crm__meta">Xoá vĩnh viễn hồ sơ SĐT và tin nhắn lưu trên máy chủ của khách này.</span>
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
              </div>
            )}
          </div>
        )}
      </div>

      <footer className="v2-crm-drawer__kbd-hint">
        <span className="v2-crm__meta">Phím tắt: J / K chuyển khách · Esc đóng ngăn</span>
      </footer>
    </aside>
  );
}
