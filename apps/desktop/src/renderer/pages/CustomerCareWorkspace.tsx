import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  CustomerCareAssistInput,
  CustomerCareAssistResult,
  CustomerCareFact,
  CustomerCareMutationResult,
  CustomerCareSetup,
  CustomerCareSnapshot,
} from '../../shared/customer-care-types';
import '../styles/customer-care.css';

type CustomerCareApi = {
  getSnapshot: () => Promise<CustomerCareSnapshot>;
  saveSetup: (input: CustomerCareSetup) => Promise<CustomerCareMutationResult>;
  assist: (input: CustomerCareAssistInput) => Promise<CustomerCareAssistResult>;
};

type FactTopic = CustomerCareFact['topic'];

const FACT_TOPICS: Array<{ value: FactTopic; label: string }> = [
  { value: 'catalog', label: 'Sản phẩm' },
  { value: 'price', label: 'Giá' },
  { value: 'quality', label: 'Chất lượng' },
  { value: 'policy', label: 'Chính sách' },
  { value: 'contact', label: 'Liên hệ' },
];

const EMPTY_SETUP: CustomerCareSetup = {
  merchantName: '',
  pageId: '',
  pageName: '',
  handoffTarget: '',
  facts: [],
};

function getCustomerCareApi(): CustomerCareApi | null {
  const electronApi = window.electronAPI as typeof window.electronAPI & {
    customerCare?: CustomerCareApi;
  };
  return electronApi.customerCare ?? null;
}

function publicError(reason: unknown, fallback: string): string {
  const message = reason instanceof Error ? reason.message.toLowerCase() : '';
  if (message.includes('auth') || message.includes('identity') || message.includes('workspace')) {
    return 'Phiên làm việc không còn hợp lệ. Hãy đăng nhập lại hoặc chọn lại workspace.';
  }
  if (message.includes('encrypt') || message.includes('crypto') || message.includes('secure storage')) {
    return 'Kho lưu trữ bảo mật chưa sẵn sàng. Cấu hình chưa được lưu.';
  }
  return fallback;
}

function newFact(): CustomerCareFact {
  return {
    id: `fact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    topic: 'catalog',
    text: '',
    source: '',
    approvedAt: '',
  };
}

function inputDate(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function isoDate(value: string): string {
  return value ? new Date(`${value}T00:00:00.000Z`).toISOString() : '';
}

export function parseCustomerCareTranscript(value: string): CustomerCareAssistInput['messages'] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const customer = line.match(/^(?:khách(?: hàng)?|customer)\s*:\s*(.+)$/i);
      if (customer) return { role: 'customer' as const, text: customer[1].trim() };
      const sale = line.match(/^(?:sale|nhân viên|tư vấn)\s*:\s*(.+)$/i);
      if (sale) return { role: 'sale' as const, text: sale[1].trim() };
      return { role: 'customer' as const, text: line };
    });
}

export function CustomerCareWorkspace({ scopeKey }: { scopeKey: string }) {
  const [snapshot, setSnapshot] = useState<CustomerCareSnapshot | null>(null);
  const [setup, setSetup] = useState<CustomerCareSetup>(EMPTY_SETUP);
  const [transcript, setTranscript] = useState('');
  const [permission, setPermission] = useState<CustomerCareAssistInput['contactPermission']>('unknown');
  const [request, setRequest] = useState<CustomerCareAssistInput['request']>('reply');
  const [result, setResult] = useState<CustomerCareAssistResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [assisting, setAssisting] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const operationRef = useRef(0);
  const shadowSafe = snapshot?.mode === 'shadow' && snapshot.outboundEnabled === false;

  const loadSnapshot = useCallback(async () => {
    const operation = ++operationRef.current;
    const api = getCustomerCareApi();
    setLoading(true);
    setSnapshot(null);
    setSetup(EMPTY_SETUP);
    setSaving(false);
    setAssisting(false);
    setResult(null);
    setNotice('');
    setError('');
    if (!api) {
      setError('Chăm sóc khách hàng cần chạy trong Izzi AI Desktop.');
      setLoading(false);
      return;
    }
    try {
      const next = await api.getSnapshot();
      if (operation !== operationRef.current) return;
      if (next.workspaceId !== scopeKey) {
        setError('Phạm vi chăm sóc khách hàng không khớp workspace hiện tại. Hãy tải lại workspace.');
        return;
      }
      setSnapshot(next);
      setSetup(next.setup ?? EMPTY_SETUP);
    } catch (reason) {
      if (operation === operationRef.current) {
        setError(publicError(reason, 'Không tải được cấu hình chăm sóc khách hàng.'));
      }
    } finally {
      if (operation === operationRef.current) setLoading(false);
    }
  }, [scopeKey]);

  useEffect(() => {
    void loadSnapshot();
    return () => {
      operationRef.current += 1;
    };
  }, [loadSnapshot]);

  const updateFact = (id: string, patch: Partial<CustomerCareFact>) => {
    setSetup((current) => ({
      ...current,
      facts: current.facts.map((fact) => (fact.id === id ? { ...fact, ...patch } : fact)),
    }));
  };

  const saveSetup = async (event: FormEvent) => {
    event.preventDefault();
    const api = getCustomerCareApi();
    if (!api) {
      setError('Không tìm thấy kết nối chăm sóc khách hàng trong phiên này.');
      return;
    }
    const operation = ++operationRef.current;
    setSaving(true);
    setNotice('');
    setError('');
    try {
      const response = await api.saveSetup(setup);
      if (operation !== operationRef.current) return;
      if (!response.ok) {
        setError(response.error || 'Cấu hình chưa được lưu.');
        return;
      }
      if (response.snapshot) {
        setSnapshot(response.snapshot);
        setSetup(response.snapshot.setup ?? setup);
      }
      setNotice('Đã lưu cấu hình bảo mật cho workspace hiện tại.');
    } catch (reason) {
      if (operation === operationRef.current) {
        setError(publicError(reason, 'Không lưu được cấu hình. Dữ liệu trước đó vẫn được giữ lại.'));
      }
    } finally {
      if (operation === operationRef.current) setSaving(false);
    }
  };

  const assist = async (event: FormEvent) => {
    event.preventDefault();
    const api = getCustomerCareApi();
    if (!api) {
      setError('Không tìm thấy kết nối chăm sóc khách hàng trong phiên này.');
      return;
    }
    const messages = parseCustomerCareTranscript(transcript);
    if (messages.length === 0) {
      setError('Hãy nhập ít nhất một dòng hội thoại tổng hợp để thử bản nháp.');
      return;
    }
    const operation = ++operationRef.current;
    setAssisting(true);
    setResult(null);
    setNotice('');
    setError('');
    try {
      const response = await api.assist({
        messages,
        contactPermission: permission,
        request,
        synthetic: true,
      });
      if (operation !== operationRef.current) return;
      setResult(response);
      if (response.status === 'error') setError(response.error || 'Không tạo được bản nháp.');
    } catch (reason) {
      if (operation === operationRef.current) {
        setError(publicError(reason, 'Không tạo được bản nháp chăm sóc khách hàng.'));
      }
    } finally {
      if (operation === operationRef.current) setAssisting(false);
    }
  };

  const copyDraft = async () => {
    if (!result || result.status !== 'draft' || !result.text) return;
    try {
      await navigator.clipboard.writeText(result.text);
      setNotice('Đã sao chép bản nháp. Izzi chưa gửi tin nhắn nào.');
    } catch {
      setError('Không sao chép được. Bạn vẫn có thể chọn và sao chép nội dung thủ công.');
    }
  };

  return (
    <section className="ccw" aria-labelledby="ccw-title">
      <header className="ccw__header">
        <div>
          <span className="cmr-eyebrow">AI Customer Care · Shadow</span>
          <h2 id="ccw-title">Chăm sóc khách hàng</h2>
          <p>Tạo bản nháp từ tri thức đã duyệt. Không gửi tin, không gọi điện và không tự chuyển khách.</p>
        </div>
        <span className="ccw__mode" aria-label="Chế độ shadow, gửi tin đã tắt">Shadow · Gửi tắt</span>
      </header>

      {error && <div className="cmr-alert cmr-alert--error" role="alert">{error}</div>}
      {notice && <div className="cmr-alert cmr-alert--success" role="status">{notice}</div>}

      {loading ? (
        <div className="ccw__loading" role="status">Đang tải cấu hình theo workspace…</div>
      ) : (
        <>
          <div className="ccw__status-grid" aria-label="Trạng thái sẵn sàng">
            <article>
              <span>Phạm vi</span>
              <strong>{snapshot?.workspaceId || 'Không khả dụng'}</strong>
            </article>
            <article>
              <span>Lưu trữ bảo mật</span>
              <strong>{snapshot?.encryptedStorageAvailable ? 'Sẵn sàng' : 'Chưa sẵn sàng'}</strong>
            </article>
            <article>
              <span>Hành động bên ngoài</span>
              <strong>{snapshot?.outboundEnabled ? 'Bật' : 'Tắt'}</strong>
            </article>
            <article>
              <span>Kết nối Page</span>
              <strong>Chưa xác minh</strong>
            </article>
          </div>

          {snapshot?.blockers.length ? (
            <div className="ccw__blockers">
              <strong>Chưa sẵn sàng</strong>
              <ul>{snapshot.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
            </div>
          ) : null}
          {snapshot && !shadowSafe && (
            <div className="ccw__blockers" role="alert">
              <strong>Trạng thái an toàn không hợp lệ. Lưu cấu hình và tạo bản nháp đã bị khóa.</strong>
            </div>
          )}

          <form className="ccw__section" onSubmit={saveSetup}>
            <div className="ccw__section-heading">
              <div>
                <span className="cmr-eyebrow">Thiết lập người bán</span>
                <h3>Danh tính và bàn giao</h3>
              </div>
              <button
                type="button"
                className="cmr-button"
                onClick={() => setSetup((current) => ({ ...current, merchantName: 'Đồ Đồng Hoàng Hưng' }))}
              >
                Thiết lập mẫu Hoàng Hưng
              </button>
            </div>
            <p className="ccw__hint">Nút mẫu chỉ điền tên người bán. Page ID và tên Page vẫn trống cho tới khi được xác minh.</p>
            <div className="ccw__fields">
              <label>
                <span>Tên người bán</span>
                <input value={setup.merchantName} onChange={(event) => setSetup({ ...setup, merchantName: event.currentTarget.value })} />
              </label>
              <label>
                <span>Page ID (chưa xác minh kết nối)</span>
                <input value={setup.pageId} onChange={(event) => setSetup({ ...setup, pageId: event.currentTarget.value })} placeholder="Để trống nếu chưa xác minh" />
              </label>
              <label>
                <span>Tên Page tham chiếu</span>
                <input value={setup.pageName} onChange={(event) => setSetup({ ...setup, pageName: event.currentTarget.value })} placeholder="Không suy ra từ tên người bán" />
              </label>
              <label>
                <span>Đích bàn giao cho Sale</span>
                <input value={setup.handoffTarget} onChange={(event) => setSetup({ ...setup, handoffTarget: event.currentTarget.value })} placeholder="Ví dụ: Nhóm Sale miền Bắc" />
              </label>
            </div>

            <div className="ccw__facts-heading">
              <div>
                <h3>Tri thức đã duyệt</h3>
                <p>Mỗi thông tin cần nguồn và một thao tác phê duyệt rõ ràng.</p>
              </div>
              <button type="button" className="cmr-button" onClick={() => setSetup((current) => ({ ...current, facts: [...current.facts, newFact()] }))}>
                Thêm thông tin
              </button>
            </div>

            {setup.facts.length === 0 ? (
              <div className="ccw__empty">Chưa có thông tin đã duyệt. Agent sẽ hỏi lại hoặc đề nghị bàn giao thay vì tự bịa giá hay chất lượng.</div>
            ) : (
              <div className="ccw__facts">
                {setup.facts.map((fact, index) => (
                  <fieldset key={fact.id} className="ccw__fact">
                    <legend>Thông tin {index + 1}</legend>
                    <label>
                      <span>Chủ đề</span>
                      <select value={fact.topic} onChange={(event) => updateFact(fact.id, { topic: event.currentTarget.value as FactTopic })}>
                        {FACT_TOPICS.map((topic) => <option key={topic.value} value={topic.value}>{topic.label}</option>)}
                      </select>
                    </label>
                    <label className="ccw__fact-text">
                      <span>Nội dung chính xác</span>
                      <textarea value={fact.text} onChange={(event) => updateFact(fact.id, { text: event.currentTarget.value })} rows={3} />
                    </label>
                    <label>
                      <span>Nguồn kiểm chứng</span>
                      <input value={fact.source} onChange={(event) => updateFact(fact.id, { source: event.currentTarget.value })} placeholder="Tài liệu, URL hoặc người chịu trách nhiệm" />
                    </label>
                    <label>
                      <span>Ngày duyệt</span>
                      <input type="date" value={inputDate(fact.approvedAt)} onChange={(event) => updateFact(fact.id, { approvedAt: isoDate(event.currentTarget.value) })} />
                    </label>
                    <label>
                      <span>Hết hiệu lực (không bắt buộc)</span>
                      <input type="date" value={inputDate(fact.expiresAt)} onChange={(event) => updateFact(fact.id, { expiresAt: event.currentTarget.value ? isoDate(event.currentTarget.value) : undefined })} />
                    </label>
                    <div className="ccw__fact-actions">
                      <button type="button" className="cmr-button" onClick={() => updateFact(fact.id, { approvedAt: new Date().toISOString() })}>Phê duyệt hôm nay</button>
                      <button type="button" className="cmr-text-button" onClick={() => setSetup((current) => ({ ...current, facts: current.facts.filter((item) => item.id !== fact.id) }))}>Xóa</button>
                    </div>
                  </fieldset>
                ))}
              </div>
            )}
            <div className="ccw__actions">
              <button type="submit" className="cmr-button cmr-button--primary" disabled={saving || assisting || !snapshot?.encryptedStorageAvailable || !shadowSafe}>
                {saving ? 'Đang lưu…' : 'Lưu thiết lập'}
              </button>
            </div>
          </form>

          <form className="ccw__section" onSubmit={assist}>
            <div className="ccw__section-heading">
              <div>
                <span className="cmr-eyebrow">Phòng thử tổng hợp</span>
                <h3>Tạo bản nháp cho Sale</h3>
              </div>
              <span className="ccw__synthetic">Synthetic · Không dùng dữ liệu khách thật</span>
            </div>
            <label className="ccw__transcript">
              <span>Hội thoại, mỗi lượt một dòng</span>
              <textarea
                value={transcript}
                onChange={(event) => setTranscript(event.currentTarget.value)}
                rows={7}
                placeholder={'Khách: Giá bộ này bao nhiêu?\nSale: Anh/chị đang quan tâm kích thước nào ạ?'}
              />
              <small>Dùng tiền tố “Khách:” hoặc “Sale:”. Dòng không có tiền tố được coi là lời khách.</small>
            </label>
            <div className="ccw__fields ccw__fields--assist">
              <label>
                <span>Quyền liên hệ do người vận hành chọn</span>
                <select value={permission} onChange={(event) => setPermission(event.currentTarget.value as CustomerCareAssistInput['contactPermission'])}>
                  <option value="unknown">Chưa rõ quyền</option>
                  <option value="zalo_only">Chỉ Zalo</option>
                  <option value="call_allowed">Chỉ gọi điện</option>
                  <option value="declined">Khách từ chối liên hệ</option>
                </select>
              </label>
              <label>
                <span>Loại hỗ trợ</span>
                <select value={request} onChange={(event) => setRequest(event.currentTarget.value as CustomerCareAssistInput['request'])}>
                  <option value="reply">Trả lời yêu cầu</option>
                  <option value="price_objection">Xử lý phản đối giá</option>
                  <option value="handoff">Soạn bàn giao Sale</option>
                </select>
              </label>
            </div>
            <div className="ccw__actions">
              <button type="submit" className="cmr-button cmr-button--primary" disabled={assisting || saving || !shadowSafe}>
                {assisting ? 'Đang tạo bản nháp…' : 'Tạo bản nháp'}
              </button>
            </div>
          </form>

          {result && (
            <section className="ccw__result" aria-live="polite" aria-labelledby="ccw-result-title">
              <div className="ccw__section-heading">
                <div>
                  <span className="cmr-eyebrow">Kết quả · {result.engine === 'model' ? 'Bộ chọn tri thức' : 'Luật an toàn'}</span>
                  <h3 id="ccw-result-title">Bản nháp chưa gửi</h3>
                </div>
                {result.status === 'draft' && result.text && result.synthetic && !result.externalActionPerformed && (
                  <button type="button" className="cmr-button" onClick={() => { void copyDraft(); }}>Sao chép bản nháp</button>
                )}
              </div>
              <div className="ccw__draft">{result.text || result.error || 'Không có nội dung an toàn để đề xuất.'}</div>
              <dl className="ccw__result-grid">
                <div><dt>Phát hiện liên hệ</dt><dd>{result.contactDetected ? 'Có' : 'Không'}</dd></div>
                <div><dt>Được phép gọi</dt><dd>{result.callAllowed ? 'Có' : 'Không'}</dd></div>
                <div><dt>Được phép Zalo</dt><dd>{result.zaloAllowed ? 'Có' : 'Không'}</dd></div>
                <div><dt>Đã gửi/gọi/chuyển khách</dt><dd>{result.externalActionPerformed ? 'Có' : 'Không'}</dd></div>
                <div><dt>Dữ liệu tổng hợp</dt><dd>{result.synthetic ? 'Có' : 'Không'}</dd></div>
                <div><dt>Bước tiếp theo</dt><dd>{result.nextAction}</dd></div>
              </dl>
              <div className="ccw__evidence">
                <strong>Thông tin được dùng</strong>
                <p>{result.factIds.length ? result.factIds.join(', ') : 'Không dùng thông tin đã duyệt nào.'}</p>
                <strong>Câu hỏi còn thiếu</strong>
                {result.unresolvedQuestions.length ? (
                  <ul>{result.unresolvedQuestions.map((question) => <li key={question}>{question}</li>)}</ul>
                ) : <p>Không còn câu hỏi được ghi nhận.</p>}
              </div>
            </section>
          )}
        </>
      )}
    </section>
  );
}
