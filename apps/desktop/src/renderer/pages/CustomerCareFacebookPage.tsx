import { useState } from 'react';
import type {
  CustomerCareBackfillJobSnapshot,
  CustomerCareCrmSyncedPage,
  CustomerCareFacebookError,
  CustomerCareFacebookPageChoice,
  CustomerCareFacebookRejectReason,
  CustomerCarePageConnection,
  CustomerCareSetup,
} from '../../shared/customer-care-types';
import { formatBackfillProgressText } from './customer-care-page-flow';

/** Same bound the main-process setup parser applies to `pageName`. */
const MAX_SETUP_PAGE_NAME = 120;

export interface CustomerCareFacebookPageChoices {
  choiceId: string;
  expiresAt: string;
  pages: CustomerCareFacebookPageChoice[];
  missingScopes: string[];
}

export interface CustomerCareConfirmPageOptions {
  pageId?: string;
  backfillPageIds?: string[];
  importOnly?: boolean;
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
  onConfirmPage: (options?: CustomerCareConfirmPageOptions) => void;
  onCancelChoices: () => void;
  onBackfillCurrent?: () => void;
  backfillJob?: CustomerCareBackfillJobSnapshot | null;
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
  setup_required: 'Hãy lưu thiết lập chăm sóc khách hàng trước.',
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
  missing_messaging_scope: "Chưa tích cấp quyền Tin nhắn trên Facebook (bấm 'Chỉnh sửa cài đặt trước đó' để bật)",
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

function extraCrmPages(connection: CustomerCarePageConnection): CustomerCareCrmSyncedPage[] {
  if (connection.state !== 'connected' || !connection.crmPages?.length) return [];
  const seen = new Set<string>([connection.pageId]);
  const out: CustomerCareCrmSyncedPage[] = [];
  for (const page of connection.crmPages) {
    if (seen.has(page.pageId)) continue;
    seen.add(page.pageId);
    out.push(page);
  }
  return out;
}

function describeConnection(connection: CustomerCarePageConnection): string {
  switch (connection.state) {
    case 'connected': {
      const name = pageDisplayName(connection.pageId, connection.pageName);
      const crmPages = extraCrmPages(connection);
      if (crmPages.length === 0) {
        return connection.status === 'active' ? `Đã kết nối: ${name}` : `Cần kết nối lại: ${name}`;
      }
      const totalPages = 1 + crmPages.length;
      const crmNames = crmPages.map((page) => pageDisplayName(page.pageId, page.pageName)).join(', ');
      return connection.status === 'active'
        ? `Đã kết nối ${totalPages} Page: ${name} (Trực trả lời) · ${crmNames} (Đồng bộ CRM)`
        : `Cần kết nối lại (${totalPages} Page): ${name} (Trực trả lời) · ${crmNames} (Đồng bộ CRM)`;
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

/** Long Page lists get a filter; short ones stay a plain list. */
const PAGE_FILTER_THRESHOLD = 8;

function foldForSearch(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase();
}

/** Pages whose name (ignoring accents and case) or ID contains the query. */
export function filterPageChoices(
  pages: readonly CustomerCareFacebookPageChoice[],
  query: string,
): CustomerCareFacebookPageChoice[] {
  const needle = foldForSearch(query.trim());
  if (!needle) return [...pages];
  return pages.filter((page) => page.pageId.includes(needle) || foldForSearch(page.name ?? '').includes(needle));
}

const MAX_BACKFILL_PAGES = 10;

function PagePicker(props: CustomerCareFacebookPagePanelProps & { choices: CustomerCareFacebookPageChoices }) {
  const { choices, connection, selectedPageId, busy } = props;
  const connected = connection.state === 'connected';
  const eligibleIds = choices.pages.filter((page) => page.eligible).map((page) => page.pageId);
  const missingMessagingPages = choices.pages.filter((page) => page.reason === 'missing_messaging_scope');
  const effectiveSelectedPageId = selectedPageId
    || (connected && eligibleIds.includes(connection.pageId) ? connection.pageId : '');
  const [filter, setFilter] = useState('');
  const [checkedIds, setCheckedIds] = useState<string[]>(() => eligibleIds.slice(0, MAX_BACKFILL_PAGES));
  const visiblePages = filterPageChoices(choices.pages, filter);
  // Only a Page the merchant can currently see may be confirmed as the primary Page.
  const selected = visiblePages.find((page) => page.pageId === effectiveSelectedPageId);
  const sameHealthyPrimary = connected
    && connection.status === 'active'
    && connection.missingScopes.length === 0
    && selected?.pageId === connection.pageId;
  const checkedSet = new Set(checkedIds);
  const validCheckedIds = choices.pages
    .filter((page) => page.eligible && checkedSet.has(page.pageId))
    .map((page) => page.pageId)
    .slice(0, MAX_BACKFILL_PAGES);
  const checkedCount = validCheckedIds.length;
  const maxSelectable = Math.min(eligibleIds.length, MAX_BACKFILL_PAGES);

  const toggleBackfillPage = (pageId: string, nextChecked: boolean) => {
    setCheckedIds((current) => {
      if (nextChecked) {
        if (current.includes(pageId) || current.length >= MAX_BACKFILL_PAGES) return current;
        return [...current, pageId];
      }
      return current.filter((id) => id !== pageId);
    });
  };

  return (
    <fieldset className="ccw__page-picker">
      <legend>Chọn Page dùng cho Chăm sóc khách hàng</legend>
      {missingMessagingPages.length > 0 && (
        <div className="ccw__scope-warning" role="alert">
          <p>
            {`Có ${missingMessagingPages.length} Page chưa được tích cấp quyền Tin nhắn ở cửa sổ Facebook vừa rồi (Facebook giữ danh sách Page cũ khi bạn bấm 'Tiếp tục'). Hãy bấm `}
            <strong>‘Mở lại Facebook để tích thêm Page’</strong>
            {' → chọn '}
            <strong>‘Chỉnh sửa cài đặt trước đó’</strong>
            {' → tích đủ các Page cần trích xuất.'}
          </p>
          <button
            type="button"
            className="cmr-button"
            disabled={busy}
            onClick={props.onConnect}
          >
            Mở lại Facebook để tích thêm Page
          </button>
        </div>
      )}
      {choices.pages.length === 0 ? (
        <p className="ccw__hint">Không có Page nào để chọn. Hãy kiểm tra tài khoản Facebook đã quản lý Page của shop.</p>
      ) : (
        <>
          {choices.pages.length > PAGE_FILTER_THRESHOLD && (
            <input
              id="ccw-page-filter"
              type="search"
              className="ccw__page-filter"
              placeholder={`Tìm trong ${choices.pages.length} Page theo tên hoặc ID`}
              aria-label="Tìm Page theo tên hoặc ID"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
          )}
          {visiblePages.length === 0 && <p className="ccw__hint">Không có Page nào khớp với từ khóa.</p>}
          <ul>
            {visiblePages.map((page) => (
              <li key={page.pageId}>
                <label className={page.eligible ? 'ccw__page-choice' : 'ccw__page-choice ccw__page-choice--disabled'}>
                  <input
                    type="radio"
                    name="ccw-page-choice"
                    value={page.pageId}
                    checked={effectiveSelectedPageId === page.pageId}
                    disabled={!page.eligible || busy}
                    onChange={() => props.onSelectPage(page.pageId)}
                  />
                  <span>
                    <strong>{page.name ?? 'Page chưa có tên'}</strong>
                    <small>ID {page.pageId}</small>
                    {connected && page.pageId === connection.pageId && (
                      <small className="ccw__page-current">Đang trực trả lời</small>
                    )}
                    {!page.eligible && <small className="ccw__page-reason">{CHOICE_REASON_LABELS[page.reason]}</small>}
                  </span>
                </label>
              </li>
            ))}
          </ul>

          {eligibleIds.length > 0 && (
            <div className="ccw__backfill-box" role="group" aria-label="Trích xuất lịch sử đa Page vào CRM">
              <div className="ccw__backfill-head">
                <strong>
                  {`Trích xuất SĐT & lịch sử khách hàng (90 ngày) vào CRM (${checkedCount}/${maxSelectable} Page, tối đa ${MAX_BACKFILL_PAGES} Page/lần):`}
                </strong>
                {eligibleIds.length > 1 && (
                  <button
                    type="button"
                    className="cmr-text-button"
                    disabled={busy}
                    onClick={() => setCheckedIds(checkedCount > 0 ? [] : eligibleIds.slice(0, MAX_BACKFILL_PAGES))}
                  >
                    {checkedCount > 0
                      ? 'Bỏ chọn tất cả'
                      : (eligibleIds.length > MAX_BACKFILL_PAGES ? `Chọn ${MAX_BACKFILL_PAGES} Page đầu` : 'Chọn tất cả đủ điều kiện')}
                  </button>
                )}
              </div>
              <ul className="ccw__backfill-list">
                {choices.pages.filter((page) => page.eligible).map((page) => (
                  <li key={`bf-${page.pageId}`}>
                    <label className="ccw__backfill-item">
                      <input
                        type="checkbox"
                        checked={checkedSet.has(page.pageId)}
                        disabled={busy || (!checkedSet.has(page.pageId) && checkedCount >= MAX_BACKFILL_PAGES)}
                        onChange={(event) => toggleBackfillPage(page.pageId, event.currentTarget.checked)}
                      />
                      <span>
                        <strong>{page.name ?? 'Page chưa có tên'}</strong>
                        <small>ID {page.pageId}</small>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <p className="ccw__hint">
        Không thấy Page? Page thuộc Business (Trình quản lý kinh doanh) chỉ hiện khi bạn được chỉ định vào Page đó:
        vào Cài đặt doanh nghiệp → Trang → chọn Page → Chỉ định người → chọn bạn với quyền truy cập đầy đủ.
        Sau đó bấm kết nối lại và tích chọn Page trong hộp thoại Facebook.
      </p>
      {choices.missingScopes.length > 0 && (
        <p className="ccw__hint">
          Facebook chưa cấp đủ quyền: {choices.missingScopes.join(', ')}. Page vẫn được kết nối nhưng sẽ hiện cảnh báo thiếu quyền.
        </p>
      )}
      <div className="ccw__actions">
        <button type="button" className="cmr-text-button" onClick={props.onCancelChoices} disabled={busy}>Hủy</button>
        {connected ? (
          <>
            <button
              type="button"
              className="cmr-button"
              disabled={busy || !selected?.eligible || sameHealthyPrimary}
              onClick={() => props.onConfirmPage({
                pageId: effectiveSelectedPageId,
                backfillPageIds: validCheckedIds.length > 0 ? validCheckedIds : undefined,
                importOnly: false,
              })}
            >
              Đổi Page chính &amp; Trích xuất
            </button>
            <button
              type="button"
              className="cmr-button cmr-button--primary"
              disabled={busy || checkedCount === 0}
              onClick={() => props.onConfirmPage({
                backfillPageIds: validCheckedIds,
                importOnly: true,
              })}
            >
              {`Trích xuất ${checkedCount} Page vào CRM (Giữ Page đang trực)`}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="cmr-button cmr-button--primary"
            disabled={busy || !selected?.eligible}
            onClick={() => props.onConfirmPage({
              pageId: effectiveSelectedPageId,
              backfillPageIds: validCheckedIds.length > 0 ? validCheckedIds : undefined,
              importOnly: false,
            })}
          >
            Dùng Page đã chọn
          </button>
        )}
      </div>
    </fieldset>
  );
}

export function CustomerCareFacebookPagePanel(props: CustomerCareFacebookPagePanelProps) {
  const { connection, canManage, busy, waitingForFacebook, choices, backfillJob } = props;
  const connected = connection.state === 'connected';
  const crmPages = extraCrmPages(connection);
  const totalConnectedPages = connected ? 1 + crmPages.length : 0;
  const backfillRunning = backfillJob?.status === 'running';
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
                <button
                  type="button"
                  className="cmr-button cmr-button--primary"
                  disabled={busy || backfillRunning}
                  onClick={props.onBackfillCurrent}
                >
                  {totalConnectedPages > 1
                    ? `Đồng bộ khách cũ (${totalConnectedPages} Page · 90 ngày)`
                    : 'Đồng bộ khách cũ (90 ngày)'}
                </button>
                <button type="button" className="cmr-button" disabled={busy || backfillRunning} onClick={props.onConnect}>
                  Kết nối lại / Thêm Page CRM
                </button>
                <button type="button" className="cmr-text-button" disabled={busy || backfillRunning} onClick={props.onDisconnect}>Ngắt kết nối</button>
              </>
            ) : (
              <button
                type="button"
                className="cmr-button cmr-button--primary"
                disabled={busy || backfillRunning || connection.state === 'unsupported'}
                onClick={props.onConnect}
              >
                Kết nối Page Facebook
              </button>
            )}
          </div>
        )}
      </div>
      <p className="ccw__page-status" role="status">{describeConnection(connection)}</p>
      {connected && crmPages.length > 0 && (
        <ul className="ccw__connected-pages" aria-label="Danh sách Page đã kết nối">
          <li className="ccw__connected-chip ccw__connected-chip--primary">
            {connection.status === 'active'
              ? `🟢 ${pageDisplayName(connection.pageId, connection.pageName)} · Đang trực trả lời`
              : `🟠 ${pageDisplayName(connection.pageId, connection.pageName)} · Cần kết nối lại`}
          </li>
          {crmPages.map((crmPage) => (
            <li key={crmPage.pageId} className="ccw__connected-chip ccw__connected-chip--crm">
              {`🟣 ${pageDisplayName(crmPage.pageId, crmPage.pageName)} · Đồng bộ CRM`}
            </li>
          ))}
        </ul>
      )}
      {backfillRunning && backfillJob && (
        <div className="ccw__backfill-progress" role="status" aria-live="polite">
          <div className="ccw__backfill-progress-head">
            <strong>{formatBackfillProgressText(backfillJob)}</strong>
            <span>
              {`${Math.min(
                100,
                Math.round((backfillJob.pagesProcessed / Math.max(1, backfillJob.pagesTotal)) * 100),
              )}%`}
            </span>
          </div>
          <div className="ccw__backfill-progress-bar" aria-hidden="true">
            <div
              className="ccw__backfill-progress-fill"
              style={{
                width: `${Math.max(
                  12,
                  Math.min(
                    100,
                    Math.round(((backfillJob.pagesProcessed + 0.35) / Math.max(1, backfillJob.pagesTotal)) * 100),
                  ),
                )}%`,
              }}
            />
          </div>
        </div>
      )}
      {connected && connection.missingScopes.length > 0 && (
        <p className="ccw__hint">Page còn thiếu quyền: {connection.missingScopes.join(', ')}.</p>
      )}
      {connected && canManage && (
        <p className="ccw__hint ccw__hint--callout">
          <strong>Quan trọng trên cửa sổ Facebook:</strong>
          {' '}
          Đừng bấm ngay ‘Tiếp tục dưới tên...’ — khi bấm “Kết nối lại / Thêm Page CRM”, hãy bấm
          {' '}
          <strong>‘Chỉnh sửa cài đặt trước đó’ (hoặc ‘Chỉnh sửa quyền truy cập’)</strong>
          {' '}
          rồi tích chọn thêm các Page cần lấy data (như Xưởng tranh đồng Đại Long, Đồ đồng Đại Long) trước khi bấm Tiếp tục.
        </p>
      )}
      <p className="ccw__hint">
        Kết nối chỉ xác minh Page. izzi chỉ đọc tin nhắn khi bạn bật “Nhận tin nhắn từ Page”, và chỉ gửi tin cho khách khi chủ sở hữu hoặc quản lý bật “Tự động trả lời khách”.
      </p>
      {!canManage && (
        <p className="ccw__hint">Chỉ chủ sở hữu và quản lý workspace được kết nối hoặc thay đổi Page Facebook.</p>
      )}
      {canManage && waitingForFacebook && (
        <div className="ccw__waiting-callout" role="status">
          <p>Đang chờ bạn cấp quyền trên Facebook trong trình duyệt…</p>
          <p>
            <strong>Quan trọng trên cửa sổ Facebook:</strong>
            {' '}
            Đừng bấm ngay ‘Tiếp tục dưới tên...’ — hãy bấm
            {' '}
            <strong>‘Chỉnh sửa cài đặt trước đó’ (hoặc ‘Chỉnh sửa quyền truy cập’)</strong>
            {' '}
            rồi tích chọn thêm các Page cần lấy data (như Xưởng tranh đồng Đại Long, Đồ đồng Đại Long) trước khi bấm Tiếp tục.
          </p>
        </div>
      )}
      {canManage && choices && <PagePicker key={choices.choiceId} {...props} choices={choices} />}
    </section>
  );
}
