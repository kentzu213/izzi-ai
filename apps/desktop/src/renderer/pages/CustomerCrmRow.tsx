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
  crmConsentedPersona,
  crmProfileLayerAllowed,
  crmServerIdentity,
  extractEditableFreeNote,
  maxFreeNoteLength,
  replaceEditableFreeNote,
  splitCrmNote,
} from '../../shared/customer-crm-enterprise';
import {
  CRM_CARE_STEP_META,
  CRM_CARE_STEP_ORDER,
  CRM_SALER_COLOR_PALETTE,
  applyCareStepTransition,
  resolveEffectiveCareStepFromProfile,
  type CrmCareStepAction,
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
  crmDue,
  crmFieldVisibility,
  crmProfilesEqual,
  crmRowReadOnly,
  crmStageLabel,
  formatCrmDue,
  isoToLocalInput,
  localInputToIso,
  normalizeCrmProfile,
  profileFromRow,
  resolveCrmRowSaler,
  type CrmProductOption,
  type CrmRowEdit,
} from './customer-crm-flow';
import { CustomerCrmIdentity, type CrmIdentityHandlers } from './CustomerCrmIdentity';

export interface CustomerCrmRowProps {
  row: CustomerCareCrmRow;
  /** What the row shows: the unsaved draft, or the saved profile. */
  profile: CustomerCareCrmProfileInput;
  edit: CrmRowEdit | null;
  saving: boolean;
  expanded: boolean;
  nowMs: number;
  assignees: readonly CustomerCareCrmAssignee[];
  salers?: readonly CustomerCareCrmSalerMember[];
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
  /** Care CRM S3: the AI identity card in the editor; absent shows it read-only. */
  identityHandlers?: CrmIdentityHandlers | null;
  /** Multi-Page source label (`Đồng Thờ Hồng Hưng`, `Xưởng tranh đồng Đại Long`, …) for the dense table. */
  pageLabel?: string;
  /** Renders the compact 1-line segment summary cell (`P1..P4`, occasion, Ads consent) in the dense table. */
  showSegmentColumn?: boolean;
  /** Highlights the row currently opened in the right-hand slide-over Drawer. */
  selected?: boolean;
}

const DUE_BADGE = { overdue: 'Quá hạn', today: 'Hôm nay' } as const;

function nullable<T extends string>(value: string): T | null {
  return value === '' ? null : value as T;
}

interface QuickStepButton {
  action: CrmCareStepAction;
  label: string;
  tone?: 'primary' | 'warn' | 'danger' | 'success';
}

function quickStepButtonsFor(profile: CustomerCareCrmProfileInput, step: CustomerCareCrmCareStep): QuickStepButton[] {
  if (profile.stage === 'deposit') {
    return [
      { action: 'lost', label: 'Không mua', tone: 'danger' },
    ];
  }
  if (profile.stage === 'delivered' || profile.stage === 'do_not_contact') {
    return [];
  }
  if (profile.stage === 'lost' || step === 'step1_bad_phone') {
    return [{ action: 'step1_uncalled', label: 'Mở lại B1' }];
  }
  switch (step) {
    case 'step1_uncalled':
      return [
        { action: 'step2_called', label: 'Đã gọi', tone: 'primary' },
        { action: 'step2_no_answer', label: 'Chưa nghe', tone: 'warn' },
        { action: 'step1_bad_phone', label: 'Sai số', tone: 'danger' },
      ];
    case 'step2_no_answer':
      return [
        { action: 'step2_called', label: 'Đã gọi', tone: 'primary' },
        { action: 'step3_zalo', label: 'Đã KB Zalo', tone: 'success' },
        { action: 'step1_bad_phone', label: 'Sai số', tone: 'danger' },
      ];
    case 'step2_called':
      return [
        { action: 'step3_zalo', label: 'Đã KB Zalo', tone: 'success' },
        { action: 'won', label: 'Đã cọc', tone: 'primary' },
        { action: 'step2_no_answer', label: 'Chưa nghe', tone: 'warn' },
      ];
    case 'step3_zalo':
      return [
        { action: 'won', label: 'Đã cọc', tone: 'success' },
        { action: 'lost', label: 'Không mua', tone: 'danger' },
      ];
  }
}

function resolveStepBadge(profile: CustomerCareCrmProfileInput): {
  label: string;
  bg: string;
  border: string;
  text: string;
  step: CustomerCareCrmCareStep;
} {
  const step = resolveEffectiveCareStepFromProfile(profile);
  if (profile.stage === 'deposit' || profile.stage === 'delivered') {
    return {
      step,
      label: crmStageLabel(profile.stage),
      bg: '#047857',
      border: '#059669',
      text: '#ffffff',
    };
  }
  if (profile.stage === 'lost' && step !== 'step1_bad_phone') {
    return {
      step,
      label: 'Không mua',
      bg: '#475569',
      border: '#64748b',
      text: '#ffffff',
    };
  }
  if (profile.stage === 'do_not_contact') {
    return {
      step,
      label: 'Không liên hệ',
      bg: '#991b1b',
      border: '#dc2626',
      text: '#ffffff',
    };
  }
  const meta = CRM_CARE_STEP_META[step];
  const triesSuffix = step === 'step2_no_answer' && (profile.callTries ?? 0) > 0 ? ` L${profile.callTries}` : '';
  return {
    step,
    label: `${meta.label}${triesSuffix}`,
    bg: meta.bg,
    border: meta.border,
    text: meta.text,
  };
}

function resolveOccasionChip(row: CustomerCareCrmRow, profile: CustomerCareCrmProfileInput): string | null {
  const staff = profile.occasion;
  const identityOccasion = crmServerIdentity(row)?.occasion;
  const ai = identityOccasion && (identityOccasion.confidence === 'high' || identityOccasion.confidence === 'medium')
    ? identityOccasion.value
    : null;
  const code = staff ?? ai;
  if (!code) return null;
  return CRM_OCCASION_OPTIONS.find((item) => item.value === code)?.label ?? null;
}

/** Updates staff-visible free note text while preserving any `[izzi-ctx: ...]` metadata line. */
export function updateCrmRowFreeNote(
  profile: CustomerCareCrmProfileInput,
  nextFreeNote: string,
): CustomerCareCrmProfileInput {
  return { ...profile, note: replaceEditableFreeNote(profile.note, nextFreeNote) };
}

/** One customer: a summary line in the call list, and the full profile form when opened. */
export function CustomerCrmRow(props: CustomerCrmRowProps) {
  const {
    row,
    profile,
    edit,
    saving,
    expanded,
    nowMs,
    assignees,
    salers = [],
    onToggle,
    onCopy,
    pageLabel,
    showSegmentColumn = false,
    selected,
  } = props;
  const name = leadDisplayName(row);
  const due = crmDue(profile, nowMs);
  const editorId = `crm-editor-${row.leadId}`;
  const stageId = `crm-stage-${row.leadId}`;
  const inlineOwnerId = `crm-inline-owner-${row.leadId}`;
  const readOnly = crmRowReadOnly(row);
  const dirty = edit !== null && !crmProfilesEqual(normalizeCrmProfile(edit.draft), profileFromRow(row));
  const status = saving ? 'Đang lưu…' : edit?.rejected ? 'Cần xem lại' : edit?.error ? 'Chưa lưu được' : dirty ? 'Chưa lưu' : '';
  const isOpen = selected ?? expanded;

  const stepBadge = resolveStepBadge(profile);
  const quickButtons = readOnly ? [] : quickStepButtonsFor(profile, stepBadge.step);
  const activeSaler = resolveCrmRowSaler(salers, profile);
  const salerPalette = activeSaler ? CRM_SALER_COLOR_PALETTE[activeSaler.color] : null;

  const persona = showSegmentColumn ? crmConsentedPersona(row) : null;
  const occasionChip = showSegmentColumn ? resolveOccasionChip(row, profile) : null;
  const serverIdentity = showSegmentColumn ? crmServerIdentity(row) : null;
  const erasePending = Boolean(serverIdentity?.consent?.eraseRequestedAt);
  const adsConsented = showSegmentColumn
    && !erasePending
    && crmProfileLayerAllowed(row)
    && serverIdentity?.consent?.noMarketing !== true
    && profile.stage !== 'do_not_contact';

  const handleInlineSalerChange = (value: string) => {
    if (salers.length > 0) {
      if (value === '') {
        props.onChange({ ...profile, salerId: null, ownerUserId: null });
        return;
      }
      const chosen = salers.find((s) => s.id === value);
      if (chosen) {
        props.onChange({ ...profile, salerId: chosen.id, ownerUserId: chosen.memberUserId });
        return;
      }
    }
    props.onChange({ ...profile, salerId: null, ownerUserId: nullable<string>(value) });
  };

  const ownerSelectValue = salers.length > 0
    ? (activeSaler?.id ?? (profile.ownerUserId ? `__user:${profile.ownerUserId}` : ''))
    : (profile.ownerUserId ?? '');

  return (
    <>
      <tr className={`v2-crm__row${expanded ? ' is-open' : ''}${selected ? ' is-selected' : ''}${due === 'overdue' ? ' is-overdue' : ''}`}>
        <td>
          <div className="v2-crm__who">
            <strong>{name}</strong>
            {pageLabel && <span className="v2-crm__page-tag">{pageLabel}</span>}
            {row.zaloMentioned && <span className="v2-badge">Có nhắc Zalo</span>}
            <span className="v2-crm__phone">{formatLeadPhone(row.phone)}</span>
            <time className="v2-crm__meta" dateTime={row.phoneCapturedAt} title={formatLeadAbsoluteTime(row.phoneCapturedAt)}>
              Để lại số: {formatLeadTime(row.phoneCapturedAt, nowMs)}
            </time>
          </div>
        </td>
        {showSegmentColumn && (
          <td className="v2-crm__segment">
            <div className="v2-crm__segment-chips">
              {persona && <span className="v2-crm-chip is-persona">{persona}</span>}
              {occasionChip && <span className="v2-crm-chip">{occasionChip}</span>}
              {erasePending && <span className="v2-crm-chip is-danger">Yêu cầu xoá</span>}
              {adsConsented && <span className="v2-crm-chip is-granted">Đã đồng ý Ads</span>}
              {!persona && !occasionChip && !erasePending && !adsConsented && <span className="v2-crm__meta">—</span>}
            </div>
          </td>
        )}
        <td>
          <div className="v2-crm-step-cell">
            <div className="v2-crm-step-cell__head">
              <span
                className="v2-crm-step-badge"
                style={{ background: stepBadge.bg, borderColor: stepBadge.border, color: stepBadge.text }}
              >
                {stepBadge.label}
              </span>
              <label className="v2-visually-hidden" htmlFor={stageId}>{`Giai đoạn của ${name}`}</label>
              <select
                id={stageId}
                className="v2-field__select v2-crm-step-cell__select"
                value={profile.stage}
                disabled={readOnly}
                onChange={(event) => props.onChange({ ...profile, stage: event.currentTarget.value as CustomerCareCrmStage })}
              >
                {CRM_STAGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
            {quickButtons.length > 0 && (
              <div className="v2-crm-step-cell__actions" role="group" aria-label={`Chuyển bước nhanh cho ${name}`}>
                {quickButtons.map((btn) => (
                  <button
                    key={btn.action}
                    type="button"
                    className={`v2-crm-quick-btn${btn.tone ? ` is-${btn.tone}` : ''}`}
                    onClick={() => props.onChange(applyCareStepTransition(profile, btn.action, nowMs))}
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </td>
        <td className="v2-crm__owner">
          <label className="v2-visually-hidden" htmlFor={inlineOwnerId}>{`Phụ trách của ${name}`}</label>
          <select
            id={inlineOwnerId}
            className={`v2-crm-owner-pill-select${salerPalette ? ' has-color' : ''}`}
            disabled={readOnly}
            value={ownerSelectValue}
            style={salerPalette ? { background: salerPalette.bg, borderColor: salerPalette.border, color: salerPalette.text } : undefined}
            onChange={(event) => {
              const raw = event.currentTarget.value;
              if (raw.startsWith('__user:')) return;
              handleInlineSalerChange(raw);
            }}
          >
            <option value="">Chưa giao</option>
            {salers.map((saler) => (
              <option key={saler.id} value={saler.id}>{saler.name}</option>
            ))}
            {salers.length === 0 && assignees.map((assignee) => (
              <option key={assignee.userId} value={assignee.userId}>{crmAssigneeLabel(assignees, assignee.userId)}</option>
            ))}
            {salers.length > 0 && !activeSaler && profile.ownerUserId && (
              <option value={`__user:${profile.ownerUserId}`}>{crmAssigneeLabel(assignees, profile.ownerUserId)}</option>
            )}
          </select>
        </td>
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
            aria-expanded={isOpen}
            aria-controls={editorId}
            onClick={onToggle}
          >
            {isOpen ? 'Đóng' : 'Sửa'}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="v2-crm__editor-row">
          <td colSpan={showSegmentColumn ? 7 : 6}>
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
  row, profile, edit, saving, nowMs, assignees, salers = [], products, canDelete, purging,
  onChange, onSave, onPurge, onReapply, onDiscard, onToggle, name, editorId, dirty, identityHandlers,
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
  const { ctx: noteCtx } = splitCrmNote(profile.note);
  const noteMaxLength = maxFreeNoteLength(noteCtx);
  const noteValue = extractEditableFreeNote(profile.note);
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
          maxLength={noteMaxLength}
          value={noteValue}
          onChange={(event) => onChange(updateCrmRowFreeNote(profile, event.currentTarget.value))}
        />
      </label>
      )}

      <CustomerCrmIdentity
        row={row}
        products={products}
        handlers={identityHandlers}
        place="editor"
        canDelete={canDelete}
        onPurge={purging ? undefined : onPurge}
      />

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
