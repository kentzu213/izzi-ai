import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type {
  CustomerCareCrmIdentity,
  CustomerCareCrmIdentityActionInput,
  CustomerCareCrmIdentityField,
  CustomerCareCrmRow,
} from '../../shared/customer-care-types';
import { formatCrmDue, type CrmProductOption } from './customer-crm-flow';
import { crmCustomerLabel, crmIdentityOccasionLine, crmIdentityView, type CrmIdentityLine } from './customer-crm-graph';
import {
  CRM_IDENTITY_EMPTY_HINT,
  CRM_IDENTITY_OFF_MESSAGE,
  crmClearEraseConfirmText,
  crmConsentConfirmText,
  crmIdentityActionInput,
  crmIdentityCardBegin,
  crmIdentityCardSettle,
  crmIdentityCardStart,
  crmIdentityEditor,
  crmIdentityEditValue,
  crmIdentityLineTarget,
  crmIdentityPermissions,
  crmWithdrawConfirmText,
  type CrmIdentityCardState,
  type CrmIdentityEditor,
  type CrmIdentityOutcomeView,
  type CrmIdentityRequest,
} from './customer-crm-identity';

/** What the panel hands the card: the AI switch, the server's consent question, and the two IPC calls. */
export interface CrmIdentityHandlers {
  /** `identityEnabled` from the list; null when the server sent no identity (no S3 there). */
  enabled: boolean | null;
  /** `consentAsk.text` from the list: exactly what "Xin phép khách" sends; null while asks are off. */
  consentAsk: string | null;
  /** Never rejects: a failure comes back as a view with its message. */
  act: (input: CustomerCareCrmIdentityActionInput) => Promise<CrmIdentityOutcomeView>;
  refresh: (leadId: string) => Promise<CrmIdentityOutcomeView>;
}

export interface CrmIdentityController {
  state: CrmIdentityCardState;
  /** Starts one staff action; ignored while another runs. Asking and withdrawing confirm first. */
  run: (key: string, request: CrmIdentityRequest) => void;
  refresh: () => void;
}

const UNREACHABLE: CrmIdentityOutcomeView = {
  identity: null, workspaceId: null, message: 'Chưa kết nối được máy chủ izzi. Thử lại sau ít phút.', tone: 'error',
  dropRows: false, removeRow: false, skipTick: false, reloadList: false,
};
const UNAVAILABLE_HINT = 'AI hồ sơ khách tạm không tải được.';
const MAX_PRODUCTS = 6;

/**
 * The card's state: the action in flight and the last answer. It keeps no version of its own: an action is sent
 * against the identity on screen (`row.identity`, which the panel updates from answers and refreshes), so it is
 * never sent against a version the user was not looking at.
 */
export function useCrmIdentityController(row: CustomerCareCrmRow, handlers: CrmIdentityHandlers | null): CrmIdentityController {
  const [state, setState] = useState(crmIdentityCardStart);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const settle = (view: CrmIdentityOutcomeView) => {
    if (mountedRef.current) setState((current) => crmIdentityCardSettle(current, view));
  };

  const start = (key: string, call: () => Promise<CrmIdentityOutcomeView>) => {
    setState((current) => crmIdentityCardBegin(current, key));
    void call().then(settle, () => settle(UNREACHABLE));
  };

  return {
    state,
    run: (key, request) => {
      if (!handlers || state.pending !== null) return;
      if (request.action === 'ask_consent') {
        // The dialog shows exactly what the server will send; without it there is nothing to ask with.
        if (handlers.consentAsk === null || !window.confirm(crmConsentConfirmText(handlers.consentAsk))) return;
      }
      if (request.action === 'withdraw_consent' && !window.confirm(crmWithdrawConfirmText(crmCustomerLabel(row)))) return;
      if (request.action === 'clear_erase_request' && !window.confirm(crmClearEraseConfirmText(crmCustomerLabel(row)))) return;
      const input = crmIdentityActionInput(row.identity?.version ?? null, row.leadId, request);
      start(key, () => handlers.act(input));
    },
    refresh: () => {
      if (!handlers || state.pending !== null) return;
      start('refresh', () => handlers.refresh(row.leadId));
    },
  };
}

/** Whether staff reviewed the value, and how sure the server is (low confidence is never shown). */
export function IdentityMarks({ line }: { line: CrmIdentityLine }) {
  return (
    <>
      <span className={`v2-crm-card__badge${line.badge === 'AI' ? ' is-ai' : ' is-reviewed'}`}>{line.badge}</span>
      <span className="v2-crm__meta">{`tin cậy ${line.confidence}`}</span>
    </>
  );
}

function IdentityQuote({ line }: { line: CrmIdentityLine }) {
  if (line.quote === null) return null;
  if (line.quoteBy === null) return <q className="v2-crm-card__quote">{line.quote}</q>;
  return (
    <span className="v2-crm-card__quote">
      {`${line.quoteBy}: `}
      <q>{line.quote}</q>
    </span>
  );
}

const domId = (leadId: string, key: string) => `crm-id-${leadId}-${key.replace(/[^A-Za-z0-9-]/g, '-')}`;

interface EditFormProps {
  id: string;
  label: string;
  field: CustomerCareCrmIdentityField;
  editor: CrmIdentityEditor;
  busy: boolean;
  onSave: (value: unknown) => void;
  onCancel: () => void;
}

/** "Sửa": the field's own control, then Lưu / Huỷ. Escape cancels without closing the card. */
function IdentityEditForm({ id, label, field, editor, busy, onSave, onCancel }: EditFormProps) {
  const [choice, setChoice] = useState(editor.kind === 'select' ? editor.current : '');
  const [picked, setPicked] = useState<string[]>(editor.kind === 'products' ? editor.current : []);
  const [title, setTitle] = useState(editor.kind === 'link' ? editor.title : '');
  const [domain, setDomain] = useState(editor.kind === 'link' ? editor.domain : '');
  const [invalid, setInvalid] = useState(false);
  const formRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    formRef.current?.querySelector<HTMLElement>('select, input')?.focus();
  }, []);

  const save = () => {
    const raw = editor.kind === 'select' ? choice : editor.kind === 'products' ? picked : { title, domain };
    const value = crmIdentityEditValue(field, raw);
    if (value === null) {
      setInvalid(true);
      return;
    }
    onSave(value);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onCancel();
    }
  };

  return (
    <div ref={formRef} className="v2-crm-card__edit" role="group" aria-label={`Sửa ${label}`} onKeyDown={onKeyDown}>
      {editor.kind === 'select' && (
        <>
          <label className="v2-visually-hidden" htmlFor={`${id}-value`}>{`${label} mới`}</label>
          <select id={`${id}-value`} className="v2-field__select" value={choice} onChange={(event) => setChoice(event.currentTarget.value)}>
            <option value="">Chọn…</option>
            {editor.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </>
      )}
      {editor.kind === 'products' && (
        <fieldset className="v2-crm-card__edit-products">
          <legend className="v2-visually-hidden">{`${label} (tối đa ${MAX_PRODUCTS})`}</legend>
          {editor.options.map((product, index) => {
            const checked = picked.includes(product.id);
            return (
              <label key={product.id} className="v2-crm__product" htmlFor={`${id}-product-${index}`}>
                <input
                  id={`${id}-product-${index}`}
                  type="checkbox"
                  checked={checked}
                  disabled={!checked && picked.length >= MAX_PRODUCTS}
                  onChange={(event) => {
                    const on = event.currentTarget.checked;
                    setPicked((current) => (on ? [...current, product.id] : current.filter((item) => item !== product.id)));
                  }}
                />
                <span>{product.label}</span>
              </label>
            );
          })}
        </fieldset>
      )}
      {editor.kind === 'link' && (
        <>
          <label className="v2-field" htmlFor={`${id}-title`}>
            <span className="v2-field__label">Tiêu đề</span>
            <input id={`${id}-title`} type="text" className="v2-field__input" maxLength={120} value={title}
              onChange={(event) => setTitle(event.currentTarget.value)} />
          </label>
          <label className="v2-field" htmlFor={`${id}-domain`}>
            <span className="v2-field__label">Tên miền</span>
            <input id={`${id}-domain`} type="text" className="v2-field__input" placeholder="shopee.vn" value={domain}
              onChange={(event) => setDomain(event.currentTarget.value)} />
          </label>
        </>
      )}
      {invalid && <p className="v2-crm__error" role="alert">Giá trị chưa hợp lệ.</p>}
      <div className="v2-crm-card__edit-buttons">
        <button type="button" className="v2-button v2-button--primary v2-crm-card__act" disabled={busy} aria-label={`Lưu ${label}`} onClick={save}>Lưu</button>
        <button type="button" className="v2-button v2-button--ghost v2-crm-card__act" aria-label={`Huỷ sửa ${label}`} onClick={onCancel}>Huỷ</button>
      </div>
    </div>
  );
}

interface FieldActionsProps {
  row: CustomerCareCrmRow;
  identity: CustomerCareCrmIdentity;
  line: CrmIdentityLine;
  products: readonly CrmProductOption[];
  controller: CrmIdentityController;
}

/** Duyệt (only an AI suggestion), Sửa (when this field can be corrected here) and Bỏ for one shown field. */
export function CrmIdentityFieldActions({ row, identity, line, products, controller }: FieldActionsProps) {
  /** The version on screen when "Sửa" was pressed: the correction is sent against what the user was looking at. */
  const [editing, setEditing] = useState<{ version: string | null } | null>(null);
  const target = crmIdentityLineTarget(line.key);
  if (!target) return null;
  const editor = crmIdentityEditor(target.field, identity, target.index, products);
  const busy = controller.state.pending !== null;
  const id = domId(row.leadId, line.key);
  if (editing !== null && editor) {
    return (
      <IdentityEditForm
        id={id}
        label={line.label}
        field={target.field}
        editor={editor}
        busy={busy}
        onSave={(value) => {
          setEditing(null);
          controller.run(line.key, { action: 'correct', ...target, value, expectedVersion: editing.version });
        }}
        onCancel={() => setEditing(null)}
      />
    );
  }
  const working = controller.state.pending === line.key;
  return (
    <span className="v2-crm-card__field-actions" role="group" aria-label={`Thao tác: ${line.label}`} aria-busy={working || undefined}>
      {line.badge === 'AI' && (
        <button type="button" className="v2-button v2-button--ghost v2-crm-card__act" disabled={busy}
          aria-label={`Duyệt ${line.label}: ${line.value}`} onClick={() => controller.run(line.key, { action: 'confirm', ...target })}>
          Duyệt
        </button>
      )}
      {editor && (
        <button type="button" className="v2-button v2-button--ghost v2-crm-card__act" disabled={busy}
          aria-label={`Sửa ${line.label}`} onClick={() => setEditing({ version: identity.version })}>
          Sửa
        </button>
      )}
      <button type="button" className="v2-button v2-button--ghost v2-crm-card__act" disabled={busy}
        aria-label={`Bỏ ${line.label}: ${line.value}`} onClick={() => controller.run(line.key, { action: 'reject', ...target })}>
        Bỏ
      </button>
    </span>
  );
}

export interface CustomerCrmIdentityProps {
  row: CustomerCareCrmRow;
  products: readonly CrmProductOption[];
  /** Absent (an older preload or a read-only view): the identity is shown without any action. */
  handlers?: CrmIdentityHandlers | null;
  /** The table editor lists the AI occasion as its own line; the graph card shows it in its "Dịp mua" row. */
  place: 'editor' | 'card';
  /** Owner or manager with the purge available: an erase request offers "Xoá dữ liệu khách" and "Bỏ yêu cầu". */
  canDelete?: boolean;
  /** The existing purge ("Xoá dữ liệu khách", behind its own confirm); absent hides that choice. */
  onPurge?: () => void;
  /** The graph card shares one controller with its "Dịp mua" row. */
  controller?: CrmIdentityController;
}

/**
 * "Nhận diện (AI)" for one customer: the consent chip, each shown field with its badge, confidence and evidence
 * quote, the age as an estimate, and the staff actions the consent and the AI switch allow. Without the customer's
 * "Đồng ý" only the order layer is shown. Links are plain text, never clickable.
 */
export function CustomerCrmIdentity({
  row, products, handlers = null, place, canDelete = false, onPurge, controller,
}: CustomerCrmIdentityProps) {
  const own = useCrmIdentityController(row, handlers);
  const control = controller ?? own;
  const identity = row.identity;
  const headingId = `crm-identity-${row.leadId}`;
  const view = crmIdentityView(identity, products);
  if (!identity || !view) {
    // The server sent this row's identity but it could not be read: the row works, the card says so.
    if (!row.identityUnavailable) return null;
    return (
      <section className="v2-crm-card__identity" aria-labelledby={headingId}>
        <h4 id={headingId} className="v2-crm-card__section">Nhận diện (AI)</h4>
        <p className="v2-crm__hint">{UNAVAILABLE_HINT}</p>
      </section>
    );
  }
  const enabled = handlers?.enabled ?? null;
  const permissions = crmIdentityPermissions(identity, enabled, handlers !== null, handlers?.consentAsk ?? null);
  const occasion = place === 'editor' ? crmIdentityOccasionLine(row) : null;
  const lines = occasion ? [occasion, ...view.lines] : view.lines;
  const eraseAt = identity.consent?.eraseRequestedAt ?? null;
  const anyAction = permissions.canRefresh || permissions.canAsk || permissions.canWithdraw;
  if (view.consent === null && lines.length === 0 && view.age === null && !anyAction && enabled !== false && eraseAt === null) {
    return null;
  }

  const { pending, message } = control.state;
  const busy = pending !== null;
  const refreshing = pending === 'refresh';
  const actions = (line: CrmIdentityLine) => (permissions.fieldActions
    ? <CrmIdentityFieldActions row={row} identity={identity} line={line} products={products} controller={control} />
    : null);

  return (
    <section className="v2-crm-card__identity" aria-labelledby={headingId}>
      <div className="v2-crm-card__identity-head">
        <h4 id={headingId} className="v2-crm-card__section">Nhận diện (AI)</h4>
        {view.consent && (
          <span className={`v2-crm-card__consent is-${view.consent.tone}`}>
            <span className="v2-visually-hidden">Xin phép lưu hồ sơ: </span>
            {view.consent.label}
          </span>
        )}
      </div>
      {eraseAt !== null && (
        <p className="v2-crm-card__erase">
          <span className="v2-crm-card__erase-chip">
            {'Khách yêu cầu xoá dữ liệu · '}
            <time dateTime={eraseAt}>{formatCrmDue(eraseAt)}</time>
          </span>
          {/* Owners and managers decide: delete everything, or drop the request when the customer changed their mind. */}
          {canDelete && onPurge && (
            <button type="button" className="v2-button v2-crm__danger v2-crm-card__act" disabled={busy} onClick={onPurge}>
              Xoá dữ liệu khách
            </button>
          )}
          {canDelete && handlers !== null && (
            <button type="button" className="v2-button v2-button--ghost v2-crm-card__act" disabled={busy}
              onClick={() => control.run('clear-erase', { action: 'clear_erase_request' })}>
              {pending === 'clear-erase' ? 'Đang bỏ yêu cầu…' : 'Bỏ yêu cầu (khách đổi ý)'}
            </button>
          )}
        </p>
      )}
      {enabled === false && <p className="v2-crm__hint">{CRM_IDENTITY_OFF_MESSAGE}</p>}
      {identity.consent?.noMarketing && <p className="v2-crm__meta">Khách không muốn nhận ưu đãi.</p>}

      {lines.length > 0 ? (
        <ul className="v2-crm-card__layers">
          {lines.map((line) => (
            <li key={line.key}>
              <span className="v2-crm-card__layer-label">{line.label}</span>
              <span className="v2-crm-card__layer-value">{line.value}</span>
              <IdentityMarks line={line} />
              {actions(line)}
              <IdentityQuote line={line} />
            </li>
          ))}
        </ul>
      ) : view.age === null && permissions.fieldActions ? <p className="v2-crm__meta">{CRM_IDENTITY_EMPTY_HINT}</p> : null}

      {view.age && (
        <div className="v2-crm-card__age">
          <span>{`${view.age.label}: ${view.age.value}`}</span>
          <IdentityMarks line={view.age} />
          {actions(view.age)}
          <IdentityQuote line={view.age} />
        </div>
      )}

      {anyAction && (
        <div className="v2-crm-card__identity-actions">
          {permissions.canRefresh && (
            <button type="button" className="v2-button v2-button--ghost v2-crm-card__act" disabled={busy}
              aria-busy={refreshing || undefined} onClick={control.refresh}>
              {refreshing && <span className="v2-crm-card__spinner" aria-hidden="true" />}
              {refreshing ? 'Đang cập nhật…' : 'Cập nhật hồ sơ'}
            </button>
          )}
          {permissions.canAsk && (
            <button type="button" className="v2-button v2-crm-card__act" disabled={busy}
              onClick={() => control.run('ask', { action: 'ask_consent' })}>
              {pending === 'ask' ? 'Đang gửi…' : 'Xin phép khách'}
            </button>
          )}
          {permissions.canWithdraw && (
            <button type="button" className="v2-button v2-crm__danger v2-crm-card__act" disabled={busy}
              onClick={() => control.run('withdraw', { action: 'withdraw_consent' })}>
              Khách rút đồng ý
            </button>
          )}
        </div>
      )}
      {identity.lastRunAt && <p className="v2-crm__meta">{`AI đọc hội thoại lúc ${formatCrmDue(identity.lastRunAt)}`}</p>}
      <p
        className={message ? `v2-crm-card__identity-message ${message.tone === 'error' ? 'v2-crm__error' : 'v2-crm__notice'}` : 'v2-crm-card__identity-message'}
        role="status"
        aria-live="polite"
      >
        {message?.text ?? ''}
      </p>
    </section>
  );
}
