import type {
  CustomerCareFacebookError,
  CustomerCareFacebookPageChoice,
  CustomerCareFacebookRejectReason,
  CustomerCarePageConnection,
  CustomerCareSetup,
} from '../../shared/customer-care-types';

/** Same bound the main-process setup parser applies to `pageName`. */
const MAX_SETUP_PAGE_NAME = 120;

export interface CustomerCareFacebookPageChoices {
  choiceId: string;
  expiresAt: string;
  pages: CustomerCareFacebookPageChoice[];
  missingScopes: string[];
}

export interface CustomerCareFacebookPagePanelProps {
  connection: CustomerCarePageConnection;
  /** Display hint from the snapshot; main re-checks the role on every action. */
  canManage: boolean;
  busy: boolean;
  waitingForFacebook: boolean;
  choices: CustomerCareFacebookPageChoices | null;
  selectedPageId: string;
  onConnect: () => void;
  onDisconnect: () => void;
  onSelectPage: (pageId: string) => void;
  onConfirmPage: () => void;
  onCancelChoices: () => void;
}

const ERROR_MESSAGES: Record<CustomerCareFacebookError, string> = {
  auth: 'Hãy đăng nhập và chọn workspace để kết nối Page Facebook.',
  forbidden: 'Chỉ chủ sở hữu và quản lý workspace được kết nối hoặc ngắt kết nối Page Facebook.',
  access_changed: 'Tài khoản hoặc workspace đã thay đổi trong lúc kết nối. Kết quả đã bị loại bỏ, hãy thử lại.',
  invalid_input: 'Lựa chọn Page không hợp lệ. Hãy kết nối lại.',
  declined: 'Bạn đã hủy hoặc từ chối cấp quyền trên Facebook. Page chưa được kết nối.',
  expired: 'Phiên kết nối Facebook đã hết hạn. Hãy bấm kết nối lại.',
  unsupported: 'Máy chủ chưa bật kết nối Page Facebook.',
  unavailable: 'Chưa kết nối được máy chủ izzi. Kiểm tra mạng rồi thử lại sau ít phút.',
  not_configured: 'Máy chủ izzi chưa cấu hình đăng nhập Facebook cho Chăm sóc khách hàng. Hãy liên hệ hỗ trợ izzi.',
  rejected: 'Máy chủ izzi từ chối yêu cầu kết nối Page. Hãy kết nối lại.',
  page_bound_elsewhere: 'Page này đang được kết nối với một workspace khác. Hãy liên hệ hỗ trợ izzi.',
  no_pages: 'Không tìm thấy Page nào mà tài khoản Facebook này quản lý.',
  'invalid-response': 'Phản hồi từ máy chủ không hợp lệ. Page chưa được kết nối.',
};

const REASON_MESSAGES: Partial<Record<CustomerCareFacebookRejectReason, string>> = {
  choice_expired: 'Danh sách Page đã hết hạn. Hãy kết nối lại.',
  expired: 'Phiên kết nối Facebook đã hết hạn. Hãy bấm kết nối lại.',
  choice_consumed: 'Danh sách Page này đã được dùng. Hãy kết nối lại để chọn Page khác.',
  replayed: 'Phiên kết nối này đã được dùng. Hãy kết nối lại.',
  choice_not_found: 'Không tìm thấy danh sách Page đã chọn. Hãy kết nối lại.',
  page_not_eligible: 'Page này chưa đủ điều kiện. Hãy chọn Page khác.',
  token_invalid: 'Facebook báo quyền đã cấp không còn hiệu lực. Hãy kết nối lại Page.',
  token_app_mismatch: 'Facebook không xác nhận quyền này cho izzi. Hãy kết nối lại Page.',
  token_page_mismatch: 'Facebook không xác nhận quyền của bạn trên Page này. Hãy kết nối lại và chọn đúng Page.',
};

const CHOICE_REASON_LABELS: Record<CustomerCareFacebookPageChoice['reason'], string> = {
  eligible: 'Đủ điều kiện',
  missing_moderate_task: 'Tài khoản của bạn chưa có quyền quản lý tin nhắn trên Page này.',
  missing_page_token: 'Facebook không cấp quyền truy cập cho Page này.',
};

export function facebookErrorMessage(error: CustomerCareFacebookError, reason?: CustomerCareFacebookRejectReason): string {
  if (error === 'rejected' && reason && REASON_MESSAGES[reason]) return REASON_MESSAGES[reason]!;
  return ERROR_MESSAGES[error] ?? ERROR_MESSAGES.unavailable;
}

export function pageStatusLabel(connection: CustomerCarePageConnection | undefined): string {
  switch (connection?.state) {
    case 'connected':
      return connection.status === 'active' ? 'Đã kết nối' : 'Cần kết nối lại';
    case 'not_connected':
      return 'Chưa kết nối';
    case 'unavailable':
      return 'Chưa kiểm tra được';
    default:
      return 'Máy chủ chưa hỗ trợ';
  }
}

function pageDisplayName(pageId: string, name: string | null): string {
  return name ?? `Page ${pageId}`;
}

function describeConnection(connection: CustomerCarePageConnection): string {
  switch (connection.state) {
    case 'connected': {
      const name = pageDisplayName(connection.pageId, connection.pageName);
      return connection.status === 'active' ? `Đã kết nối: ${name}` : `Cần kết nối lại: ${name}`;
    }
    case 'not_connected':
      return 'Chưa kết nối Page Facebook.';
    case 'unavailable':
      return 'Chưa kiểm tra được kết nối Page Facebook. Thử lại sau ít phút.';
    case 'unsupported':
      return ERROR_MESSAGES.unsupported;
  }
}

/** The Page saved with the setup always comes from the verified connection, never from typing. */
export function setupForSave(
  setup: CustomerCareSetup,
  connection: CustomerCarePageConnection | undefined,
): CustomerCareSetup {
  if (connection?.state !== 'connected') return setup;
  return {
    ...setup,
    pageId: connection.pageId,
    pageName: (connection.pageName ?? '').slice(0, MAX_SETUP_PAGE_NAME),
  };
}

function PagePicker(props: CustomerCareFacebookPagePanelProps & { choices: CustomerCareFacebookPageChoices }) {
  const { choices, selectedPageId, busy } = props;
  const selected = choices.pages.find((page) => page.pageId === selectedPageId);
  return (
    <fieldset className="ccw__page-picker">
      <legend>Chọn Page dùng cho Chăm sóc khách hàng</legend>
      {choices.pages.length === 0 ? (
        <p className="ccw__hint">Không có Page nào để chọn. Hãy kiểm tra tài khoản Facebook đã quản lý Page của shop.</p>
      ) : (
        <ul>
          {choices.pages.map((page) => (
            <li key={page.pageId}>
              <label className={page.eligible ? 'ccw__page-choice' : 'ccw__page-choice ccw__page-choice--disabled'}>
                <input
                  type="radio"
                  name="ccw-page-choice"
                  value={page.pageId}
                  checked={selectedPageId === page.pageId}
                  disabled={!page.eligible || busy}
                  onChange={() => props.onSelectPage(page.pageId)}
                />
                <span>
                  <strong>{page.name ?? 'Page chưa có tên'}</strong>
                  <small>ID {page.pageId}</small>
                  {!page.eligible && <small className="ccw__page-reason">{CHOICE_REASON_LABELS[page.reason]}</small>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {choices.missingScopes.length > 0 && (
        <p className="ccw__hint">
          Facebook chưa cấp đủ quyền: {choices.missingScopes.join(', ')}. Page vẫn được kết nối nhưng sẽ hiện cảnh báo thiếu quyền.
        </p>
      )}
      <div className="ccw__actions">
        <button type="button" className="cmr-text-button" onClick={props.onCancelChoices} disabled={busy}>Hủy</button>
        <button
          type="button"
          className="cmr-button cmr-button--primary"
          disabled={busy || !selected?.eligible}
          onClick={props.onConfirmPage}
        >
          Dùng Page đã chọn
        </button>
      </div>
    </fieldset>
  );
}

export function CustomerCareFacebookPagePanel(props: CustomerCareFacebookPagePanelProps) {
  const { connection, canManage, busy, waitingForFacebook, choices } = props;
  const connected = connection.state === 'connected';
  return (
    <section className="ccw__section ccw__page" aria-labelledby="ccw-page-title">
      <div className="ccw__section-heading">
        <div>
          <span className="cmr-eyebrow">Page Facebook</span>
          <h3 id="ccw-page-title">Kết nối Page cho Chăm sóc khách hàng</h3>
        </div>
        {canManage && (
          <div className="ccw__page-actions">
            {connected ? (
              <>
                <button type="button" className="cmr-button" disabled={busy} onClick={props.onConnect}>Kết nối lại</button>
                <button type="button" className="cmr-text-button" disabled={busy} onClick={props.onDisconnect}>Ngắt kết nối</button>
              </>
            ) : (
              <button
                type="button"
                className="cmr-button cmr-button--primary"
                disabled={busy || connection.state === 'unsupported'}
                onClick={props.onConnect}
              >
                Kết nối Page Facebook
              </button>
            )}
          </div>
        )}
      </div>
      <p className="ccw__page-status" role="status">{describeConnection(connection)}</p>
      {connected && connection.missingScopes.length > 0 && (
        <p className="ccw__hint">Page còn thiếu quyền: {connection.missingScopes.join(', ')}.</p>
      )}
      <p className="ccw__hint">
        Kết nối chỉ xác minh Page. Chế độ thử vẫn bật: izzi chưa nhận và chưa gửi tin nhắn Messenger.
      </p>
      {!canManage && (
        <p className="ccw__hint">Chỉ chủ sở hữu và quản lý workspace được kết nối hoặc thay đổi Page Facebook.</p>
      )}
      {canManage && waitingForFacebook && (
        <p className="ccw__hint" role="status">Đang chờ bạn cấp quyền trên Facebook trong trình duyệt…</p>
      )}
      {canManage && choices && <PagePicker {...props} choices={choices} />}
    </section>
  );
}
