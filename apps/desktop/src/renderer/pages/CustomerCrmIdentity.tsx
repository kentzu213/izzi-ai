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

/** What the panel hands the card: the AI switch, the Page name for the consent text, and the two IPC calls. */
export interface CrmIdentityHandlers {
  /** `identityEnabled` from the list; null when the server sent no identity (no S3 there). */
  enabled: boolean | null;
  pageName: string | null;
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
  dropRows: false, removeRow: false, skipTick: false,
};
const ASK_HINT = 'Chỉ xin phép được trong 24 giờ sau tin cuối của khách, tối đa 2 lần cách nhau 7 ngày, '
  + 'và không hỏi lại khách đã từ chối trong 24 tháng.';
const MAX_PRODUCTS = 6;

/**
 * The card's state: the identity `version` when it opened (sent as `expectedVersion`), the action in flight and the
 * last answer. A newer identity from the 60 s refresh does not move the version; a 409 or an answer does.
 */
export function useCrmIdentityController(row: CustomerCareCrmRow, handlers: CrmIdentityHandlers | null): CrmIdentityController {
  const [state, setState] = useState(() => crmIdentityCardStart(row.identity));
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
      if (request.action === 'ask_consent' && !window.confirm(crmConsentConfirmText(handlers.pageName))) return;
      if (request.action === 'withdraw_consent' && !window.confirm(crmWithdrawConfirmText(crmCustomerLabel(row)))) return;
      const input = crmIdentityActionInput(state, row.leadId, request);
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
  const [editing, setEditing] = useState(false);
  const target = crmIdentityLineTarget(line.key);
  if (!target) return null;
  const editor = crmIdentityEditor(target.field, identity, target.index, products);
  const busy = controller.state.pending !== null;
  const id = domId(row.leadId, line.key);
  if (editing && editor) {
    return (
      <IdentityEditForm
        id={id}
        label={line.label}
        field={target.field}
        editor={editor}
        busy={busy}
        onSave={(value) => {
          setEditing(false);
          controller.run(line.key, { action: 'correct', ...target, value });
        }}
        onCancel={() => setEditing(false)}
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
          aria-label={`Sửa ${line.label}`} onClick={() => setEditing(true)}>
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
  showOccasion: boolean;
  /** The graph card shares one controller with its "Dịp mua" row. */
  controller?: CrmIdentityController;
}

/**
 * "Nhận diện (AI)" for one customer: the consent chip, each shown field with its badge, confidence and evidence
 * quote, the age as an estimate, and the staff actions the consent and the AI switch allow. Without the customer's
 * "Đồng ý" only the order layer is shown. Links are plain text, never clickable.
 */
export function CustomerCrmIdentity({ row, products, handlers = null, showOccasion, controller }: CustomerCrmIdentityProps) {
  const own = useCrmIdentityController(row, handlers);
  const control = controller ?? own;
  const identity = row.identity;
  const view = crmIdentityView(identity, products);
  if (!identity || !view) return null;
  const enabled = handlers?.enabled ?? null;
  const permissions = crmIdentityPermissions(identity, enabled, handlers !== null);
  const occasion = showOccasion ? crmIdentityOccasionLine(row) : null;
  const lines = occasion ? [occasion, ...view.lines] : view.lines;
  const state = identity.consent?.state;
  const askShown = handlers !== null && enabled === true && (state === 'unknown' || state === 'asked');
  const anyAction = permissions.canRefresh || askShown || permissions.canWithdraw;
  if (view.consent === null && lines.length === 0 && view.age === null && !anyAction && enabled !== false) return null;

  const headingId = `crm-identity-${row.leadId}`;
  const askHintId = `crm-identity-ask-${row.leadId}`;
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
          {askShown && (
            <button type="button" className="v2-button v2-crm-card__act" disabled={busy || !permissions.canAsk}
              aria-describedby={permissions.canAsk ? undefined : askHintId}
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
      {askShown && !permissions.canAsk && <p id={askHintId} className="v2-crm__meta">{ASK_HINT}</p>}
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
