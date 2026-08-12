import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CustomerMarketingBridgeStatus,
  CustomerMarketingWorkflowDecision,
  CustomerMarketingWorkflowRecord,
  CustomerMarketingWorkflowSource,
  CustomerMarketingWorkflowTarget,
  CustomerRole,
} from '../../shared/customer-marketing-types';
import type {
  CustomerMarketingCredentialConnectionState,
  CustomerMarketingCredentialStatus,
  CustomerMarketingCredentialVaultState,
  CustomerMarketingIntegrationProvider,
} from '../../shared/customer-marketing-credential-types';
import type {
  CustomerMarketingCanaryReadinessResult,
  CustomerMarketingTelegramCanaryCandidate,
} from '../../shared/customer-marketing-canary-types';
import { CloseIcon, ContentIcon, RefreshIcon, ReviewIcon, StatusIcon } from '../components/AppIcons';

const TARGETS: Array<{ value: CustomerMarketingWorkflowTarget; label: string; source: string }> = [
  { value: 'social', label: 'Social', source: 'nội dung' },
  { value: 'seo', label: 'SEO', source: 'nội dung' },
  { value: 'email', label: 'Email', source: 'nội dung' },
  { value: 'crm', label: 'CRM', source: 'chiến dịch' },
];
const AUTHOR_ROLES: CustomerRole[] = ['owner', 'manager', 'editor'];
const REVIEW_ROLES: CustomerRole[] = ['owner', 'manager', 'reviewer'];
const CREDENTIAL_REVOKE_ROLES: CustomerRole[] = ['owner', 'manager'];
const PROVIDER_META: Record<CustomerMarketingIntegrationProvider, { label: string }> = {
  facebook: { label: 'Facebook' },
  instagram: { label: 'Instagram' },
  tiktok: { label: 'TikTok' },
  youtube: { label: 'YouTube' },
  telegram: { label: 'Telegram' },
  x: { label: 'X' },
  google: { label: 'Google' },
  email: { label: 'Email' },
  crm: { label: 'CRM' },
};

function shortDigest(value: string): string {
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(date)
    : value;
}

function recordLabel(record: CustomerMarketingWorkflowRecord): string {
  if (record.status === 'approved') return 'Đã duyệt';
  if (record.status === 'rejected') return 'Đã từ chối';
  return Date.now() >= Date.parse(record.manifest.grant.expiresAt) ? 'Đã hết hạn' : 'Chờ duyệt';
}

function bridgeLabel(status: CustomerMarketingBridgeStatus): string {
  if (status === 'synced') return 'Đã xác minh';
  if (status === 'forbidden') return 'Không có quyền';
  if (status === 'conflict') return 'Cần tải lại';
  return 'Không khả dụng';
}

function credentialStateLabel(state: CustomerMarketingCredentialConnectionState): string {
  if (state === 'connected') return 'Đã kết nối';
  if (state === 'locked') return 'Đã khóa';
  if (state === 'invalid') return 'Cần kiểm tra';
  return 'Chưa kết nối';
}

function vaultStateLabel(state: CustomerMarketingCredentialVaultState): string {
  return state === 'ready' ? 'Vault sẵn sàng' : 'Vault bị khóa';
}

function credentialBridgeLabel(
  status: CustomerMarketingBridgeStatus,
  vaultState: CustomerMarketingCredentialVaultState,
): string {
  if (status === 'synced') return vaultStateLabel(vaultState);
  if (status === 'forbidden') return 'Không có quyền';
  if (status === 'conflict') return 'Cần tải lại';
  return 'Bridge gián đoạn';
}

function credentialEmptyLabel(
  status: CustomerMarketingBridgeStatus,
  vaultState: CustomerMarketingCredentialVaultState,
): string {
  if (status === 'forbidden') return 'Bạn không có quyền xem trạng thái provider.';
  if (status === 'conflict') return 'Workspace đã thay đổi. Hãy tải lại trạng thái.';
  if (status !== 'synced') return 'Chưa kết nối được workspace API.';
  if (vaultState === 'locked') return 'Vault đang khóa; chưa thể đọc trạng thái provider.';
  return 'Chưa có trạng thái provider.';
}

export function CustomerMarketingChannels({ role }: { role: CustomerRole }) {
  const [target, setTarget] = useState<CustomerMarketingWorkflowTarget>('social');
  const [sources, setSources] = useState<CustomerMarketingWorkflowSource[]>([]);
  const [workflows, setWorkflows] = useState<CustomerMarketingWorkflowRecord[]>([]);
  const [sourceId, setSourceId] = useState('');
  const [workflowId, setWorkflowId] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<CustomerMarketingBridgeStatus>('unavailable');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [credentials, setCredentials] = useState<CustomerMarketingCredentialStatus[]>([]);
  const [credentialVaultState, setCredentialVaultState] = useState<CustomerMarketingCredentialVaultState>('locked');
  const [credentialBridgeStatus, setCredentialBridgeStatus] = useState<CustomerMarketingBridgeStatus>('unavailable');
  const [credentialError, setCredentialError] = useState('');
  const [credentialLoading, setCredentialLoading] = useState(true);
  const [revokingProvider, setRevokingProvider] = useState<CustomerMarketingIntegrationProvider | null>(null);
  const [canaryReadiness, setCanaryReadiness] = useState<CustomerMarketingCanaryReadinessResult | null>(null);
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [telegramSetupBusy, setTelegramSetupBusy] = useState(false);
  const [telegramSetupNotice, setTelegramSetupNotice] = useState('');
  const [telegramCandidate, setTelegramCandidate] = useState<CustomerMarketingTelegramCanaryCandidate | null>(null);
  const [telegramCandidateBusy, setTelegramCandidateBusy] = useState(false);
  const [telegramCandidateError, setTelegramCandidateError] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const requestId = useRef(0);
  const manifestHeading = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async () => {
    const api = window.electronAPI?.customerMarketing;
    if (!api) {
      setError('Kênh marketing cần chạy trong Izzi AI Desktop.');
      setLoading(false);
      return;
    }
    const request = ++requestId.current;
    setLoading(true);
    setError('');
    setNotice('');
    try {
      const [sourceResult, workflowResult] = await Promise.all([
        api.listMarketingWorkflowSources(target),
        api.listMarketingWorkflows(target),
      ]);
      if (request !== requestId.current) return;
      setStatus(sourceResult.ok ? workflowResult.status : sourceResult.status);
      if (!sourceResult.ok || !workflowResult.ok) {
        setSources([]);
        setWorkflows([]);
        setSourceId('');
        setWorkflowId('');
        setError(sourceResult.error || workflowResult.error || 'Không tải được workflow kênh.');
        return;
      }
      setSources(sourceResult.sources);
      setWorkflows(workflowResult.workflows);
      setSourceId((current) => sourceResult.sources.some((item) => item.id === current)
        ? current : sourceResult.sources[0]?.id || '');
      setWorkflowId((current) => workflowResult.workflows.some((item) => item.workflowId === current)
        ? current : workflowResult.workflows[0]?.workflowId || '');
    } catch (reason) {
      if (request !== requestId.current) return;
      setStatus('unavailable');
      setError(reason instanceof Error ? reason.message : 'Bridge workflow không phản hồi.');
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [target]);

  useEffect(() => {
    void load();
    return () => { requestId.current += 1; };
  }, [load]);

  const loadCredentials = useCallback(async () => {
    const api = window.electronAPI?.customerMarketing;
    if (!api) {
      setCredentialLoading(false);
      setCredentialError('Kênh marketing cần chạy trong Izzi AI Desktop.');
      return;
    }
    setCredentialLoading(true);
    setCredentialError('');
    try {
      const [result, readiness] = await Promise.all([
        api.listIntegrationCredentials(),
        api.getCanaryReadiness(),
      ]);
      setCredentialBridgeStatus(result.status);
      setCredentialVaultState(result.vaultState);
      setCredentials(result.credentials);
      setCanaryReadiness(readiness);
      if (!result.ok) setCredentialError(result.error || 'Không tải được trạng thái kết nối.');
    } catch (reason) {
      setCredentialBridgeStatus('unavailable');
      setCredentialVaultState('locked');
      setCredentials([]);
      setCanaryReadiness(null);
      setCredentialError(reason instanceof Error ? reason.message : 'Vault không phản hồi.');
    } finally {
      setCredentialLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCredentials();
  }, [loadCredentials]);

  const filteredSources = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('vi-VN');
    return term ? sources.filter((source) => (
      source.title.toLocaleLowerCase('vi-VN').includes(term)
      || Boolean(source.channel?.toLocaleLowerCase('vi-VN').includes(term))
      || source.sha256.includes(term)
    )) : sources;
  }, [query, sources]);

  const source = sources.find((item) => item.id === sourceId) ?? null;
  const workflow = workflows.find((item) => item.workflowId === workflowId) ?? workflows[0] ?? null;
  const targetMeta = TARGETS.find((item) => item.value === target)!;
  const canPrepare = AUTHOR_ROLES.includes(role);
  const canReview = REVIEW_ROLES.includes(role);
  const canRevokeCredentials = CREDENTIAL_REVOKE_ROLES.includes(role);
  const canConfigureTelegram = CREDENTIAL_REVOKE_ROLES.includes(role);
  const connectedCredentialCount = credentials.filter((item) => item.state === 'connected').length;
  const credentialAnnouncement = credentialLoading
    ? 'Đang kiểm tra trạng thái provider.'
    : credentialError
      ? ''
      : credentialBridgeStatus === 'synced'
        ? `Đã cập nhật ${credentials.length} provider, ${connectedCredentialCount} đã kết nối.`
        : credentialBridgeLabel(credentialBridgeStatus, credentialVaultState);
  const pendingExpiry = workflow?.status === 'pending'
    ? workflow.manifest.grant.expiresAt
    : null;

  useEffect(() => {
    const expiry = pendingExpiry ? Date.parse(pendingExpiry) : Number.NaN;
    setNow(Date.now());
    if (!Number.isFinite(expiry)) return undefined;
    const remaining = expiry - Date.now();
    if (remaining <= 0) return undefined;
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.min(remaining + 50, 2_147_483_647),
    );
    return () => window.clearTimeout(timer);
  }, [workflow?.workflowId, pendingExpiry]);

  const expired = Boolean(pendingExpiry)
    && now >= Date.parse(pendingExpiry!);

  useEffect(() => {
    setTelegramCandidate(null);
    setTelegramCandidateError('');
  }, [target, workflow?.workflowId, workflow?.manifestDigest]);

  const revokeCredential = async (provider: CustomerMarketingIntegrationProvider) => {
    const api = window.electronAPI?.customerMarketing;
    if (!api || !canRevokeCredentials || revokingProvider) return;
    const label = PROVIDER_META[provider].label;
    if (!window.confirm(`Thu hồi kết nối ${label}?`)) return;
    setRevokingProvider(provider);
    setCredentialError('');
    try {
      const result = await api.revokeIntegrationCredential({ provider });
      setCredentialBridgeStatus(result.status);
      if (!result.ok || !result.credential) {
        setCredentialError(result.error || 'Không thể thu hồi kết nối.');
        return;
      }
      setCredentials((current) => current.map((item) => (
        item.provider === provider ? result.credential! : item
      )));
    } catch (reason) {
      setCredentialError(reason instanceof Error ? reason.message : 'Không thể thu hồi kết nối.');
    } finally {
      setRevokingProvider(null);
    }
  };

  const configureTelegramSandbox = async () => {
    const api = window.electronAPI?.customerMarketing;
    if (!api || !canConfigureTelegram || telegramSetupBusy) return;
    setTelegramSetupBusy(true);
    setCredentialError('');
    setTelegramSetupNotice('');
    try {
      const result = await api.configureTelegramSandbox({
        token: telegramToken,
        privateSandboxChatId: telegramChatId,
      });
      setTelegramToken('');
      setTelegramChatId('');
      if (!result.ok) {
        setCredentialError(result.error || 'Không thể lưu cấu hình Telegram sandbox.');
        return;
      }
      setTelegramSetupNotice('Đã lưu an toàn. Canary vẫn tắt và chưa gửi tin nhắn.');
      await loadCredentials();
    } catch (reason) {
      setTelegramToken('');
      setTelegramChatId('');
      setCredentialError(reason instanceof Error ? reason.message : 'Không thể lưu cấu hình Telegram sandbox.');
    } finally {
      setTelegramSetupBusy(false);
    }
  };

  const prepare = async () => {
    const api = window.electronAPI?.customerMarketing;
    if (!api || !source || !canPrepare) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api.prepareMarketingWorkflow({
        target, resourceId: source.id, expectedRevision: source.revision,
      });
      setStatus(result.status);
      if (!result.ok || !result.workflow) {
        setError(result.error || 'Không tạo được manifest dry-run.');
        return;
      }
      setWorkflows((current) => [result.workflow!, ...current.filter(
        (item) => item.workflowId !== result.workflow!.workflowId,
      )]);
      setWorkflowId(result.workflow.workflowId);
      setNotice('Đã tạo manifest dry-run và chuyển sang trạng thái chờ duyệt.');
      window.requestAnimationFrame(() => manifestHeading.current?.focus());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không tạo được manifest dry-run.');
    } finally { setBusy(false); }
  };

  const review = async (decision: CustomerMarketingWorkflowDecision) => {
    const api = window.electronAPI?.customerMarketing;
    if (!api || !workflow || !canReview || expired) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api.reviewMarketingWorkflow({
        target,
        workflowId: workflow.workflowId,
        approvalId: workflow.approvalId,
        manifestDigest: workflow.manifestDigest,
        decision,
      });
      setStatus(result.status);
      if (!result.ok || !result.workflow) {
        setError(result.error || 'Không lưu được quyết định dry-run.');
        return;
      }
      setWorkflows((current) => current.map((item) => (
        item.workflowId === result.workflow!.workflowId ? result.workflow! : item
      )));
      setNotice(decision === 'approved'
        ? 'Đã duyệt dry-run. Không có hành động bên ngoài nào được thực hiện.'
        : 'Đã từ chối dry-run.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không lưu được quyết định dry-run.');
    } finally { setBusy(false); }
  };

  const prepareTelegramCandidate = async () => {
    const api = window.electronAPI?.customerMarketing;
    if (!api || !workflow || target !== 'social' || workflow.status !== 'approved' || telegramCandidateBusy) return;
    setTelegramCandidateBusy(true);
    setTelegramCandidateError('');
    setTelegramCandidate(null);
    try {
      const result = await api.prepareTelegramCanaryCandidate({
        workflowId: workflow.workflowId,
        manifestDigest: workflow.manifestDigest,
      });
      if (!result.ok || !result.candidate) {
        setTelegramCandidateError(result.error || 'Không thể chuẩn bị Telegram preview.');
        return;
      }
      setTelegramCandidate(result.candidate);
    } catch (reason) {
      setTelegramCandidateError(reason instanceof Error ? reason.message : 'Không thể chuẩn bị Telegram preview.');
    } finally {
      setTelegramCandidateBusy(false);
    }
  };

  const sourceColumn = (
    <section className="cmr-channel-column cmr-channel-column--sources" aria-labelledby="cmr-channel-sources-heading">
      <div className="cmr-channel-column__heading">
        <div><span>01</span><h3 id="cmr-channel-sources-heading">Nguồn đã duyệt</h3></div>
        <button type="button" className="cmr-icon-button" aria-label="Tải lại nguồn và workflow" title="Tải lại" disabled={loading || busy} onClick={() => void load()}>
          <RefreshIcon className="cmr-icon" />
        </button>
      </div>
      <label className="cmr-channel-search">
        <span className="cmr-sr-only">Tìm nguồn đã duyệt</span>
        <ContentIcon className="cmr-icon" />
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Tìm ${targetMeta.source}…`} />
      </label>
      <div className="cmr-channel-source-list" role="radiogroup" aria-label="Nguồn đã duyệt">
        {!loading && filteredSources.length === 0 && (
          <div className="cmr-channel-empty">
            <StatusIcon className="cmr-icon" />
            <strong>Chưa có {targetMeta.source} đã duyệt</strong>
            <span>Hãy duyệt một revision trong Chiến dịch hoặc Nội dung trước.</span>
          </div>
        )}
        {filteredSources.map((item) => (
          <label key={item.id} className={`cmr-channel-source ${sourceId === item.id ? 'is-selected' : ''}`}>
            <input type="radio" name="cmr-workflow-source" value={item.id} checked={sourceId === item.id} onChange={() => setSourceId(item.id)} />
            <span className="cmr-channel-source__copy">
              <strong>{item.title}</strong>
              <small>Revision {item.revision}{item.channel ? ` · ${item.channel}` : ''}</small>
              <code title={item.sha256}>{shortDigest(item.sha256)}</code>
            </span>
          </label>
        ))}
      </div>
      <button type="button" className="cmr-button cmr-button--primary cmr-channel-prepare" disabled={!source || !canPrepare || loading || busy || status !== 'synced'} onClick={() => void prepare()}>
        <ContentIcon className="cmr-button__icon" />
        {busy ? 'Đang xử lý…' : 'Tạo manifest dry-run'}
      </button>
      {!canPrepare && (
        <small className="cmr-permission-note">
          {canReview
            ? 'Vai trò hiện tại chỉ xem và quyết định dry-run.'
            : 'Viewer chỉ xem khi workspace cấp capability; không thể tạo hoặc duyệt.'}
        </small>
      )}
    </section>
  );

  const manifestColumn = (
    <section className="cmr-channel-column cmr-channel-column--manifest" aria-labelledby="cmr-channel-manifest-heading">
      <div className="cmr-channel-column__heading cmr-channel-column__heading--stack">
        <div>
          <span>02</span>
          <h3 id="cmr-channel-manifest-heading" ref={manifestHeading} tabIndex={-1}>Manifest & grant</h3>
        </div>
        {workflows.length > 0 && (
          <label className="cmr-channel-workflow-select">
            <span>Dry-run</span>
            <select value={workflow?.workflowId || ''} onChange={(event) => setWorkflowId(event.target.value)}>
              {workflows.map((item) => (
                <option key={item.workflowId} value={item.workflowId}>
                  {recordLabel(item)} · {formatTime(item.manifest.createdAt)}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {!workflow ? (
        <div className="cmr-channel-empty cmr-channel-empty--manifest">
          <ContentIcon className="cmr-icon" />
          <strong>Chưa có manifest</strong>
          <span>Chọn nguồn đã duyệt rồi tạo dry-run để xem phạm vi quyền.</span>
        </div>
      ) : (
        <div className="cmr-channel-manifest">
          <div className="cmr-channel-manifest__title">
            <div><strong>{workflow.manifest.title}</strong><code>{shortDigest(workflow.manifestDigest)}</code></div>
            <span className={`cmr-channel-state cmr-channel-state--${workflow.status}${expired ? ' is-expired' : ''}`}>
              {recordLabel(workflow)}
            </span>
          </div>
          <dl className="cmr-channel-facts">
            <div><dt>Wrapper</dt><dd>{workflow.manifest.kind.toUpperCase()}</dd></div>
            <div><dt>Nguồn</dt><dd>{workflow.manifest.inputRef.kind} · r{workflow.manifest.inputRef.revision}</dd></div>
            <div><dt>Hết hạn</dt><dd>{formatTime(workflow.manifest.grant.expiresAt)}</dd></div>
            <div><dt>Policy</dt><dd><code>{workflow.manifest.grant.policyRevision}</code></dd></div>
          </dl>
          <div className="cmr-channel-block">
            <h4>Dry-run</h4>
            <ol>{workflow.manifest.dryRun.steps.map((step) => <li key={step}>{step}</li>)}</ol>
          </div>
          <div className="cmr-channel-block cmr-channel-block--grant">
            <h4>Scoped grant</h4>
            <dl>
              <div><dt>Operations</dt><dd><code>{workflow.manifest.grant.operations.join(', ')}</code></dd></div>
              <div><dt>Target</dt><dd>{workflow.manifest.grant.channels.join(', ')}</dd></div>
              <div><dt>Max items</dt><dd>1</dd></div>
              <div><dt>Max recipients</dt><dd>0</dd></div>
              <div><dt>Max spend</dt><dd>0 VND</dd></div>
            </dl>
          </div>
          <div className="cmr-channel-warning">
            <StatusIcon className="cmr-icon" />
            <span>{workflow.manifest.dryRun.warnings[0]}</span>
          </div>
        </div>
      )}
    </section>
  );

  const decisionColumn = (
    <section className="cmr-channel-column cmr-channel-column--decision" aria-labelledby="cmr-channel-decision-heading">
      <div className="cmr-channel-column__heading">
        <div><span>03</span><h3 id="cmr-channel-decision-heading">Quyết định & receipt</h3></div>
        <ReviewIcon className="cmr-icon" />
      </div>
      {!workflow ? (
        <div className="cmr-channel-empty">
          <ReviewIcon className="cmr-icon" />
          <strong>Chưa có quyết định</strong>
          <span>Receipt chỉ được tạo cùng một quyết định hợp lệ.</span>
        </div>
      ) : workflow.receipt ? (
        <div className="cmr-channel-receipt">
          <div className={`cmr-channel-receipt__decision cmr-channel-receipt__decision--${workflow.receipt.decision}`}>
            <StatusIcon className="cmr-icon" />
            <div><span>Decision</span><strong>{workflow.receipt.decision === 'approved' ? 'Đã duyệt' : 'Đã từ chối'}</strong></div>
          </div>
          <dl>
            <div><dt>Thời điểm</dt><dd>{formatTime(workflow.receipt.reviewedAt)}</dd></div>
            <div><dt>Reviewer hash</dt><dd><code title={workflow.receipt.reviewerHash}>{shortDigest(workflow.receipt.reviewerHash)}</code></dd></div>
            <div><dt>Manifest digest</dt><dd><code title={workflow.receipt.manifestDigest}>{shortDigest(workflow.receipt.manifestDigest)}</code></dd></div>
            <div><dt>Receipt digest</dt><dd><code title={workflow.receipt.receiptDigest}>{shortDigest(workflow.receipt.receiptDigest)}</code></dd></div>
            <div><dt>externalActionPerformed</dt><dd><code>false</code></dd></div>
          </dl>
        </div>
      ) : (
        <div className="cmr-channel-pending">
          <StatusIcon className="cmr-channel-pending__icon" />
          <strong>{expired ? 'Grant đã hết hạn' : 'Đang chờ phê duyệt'}</strong>
          <span>{expired
            ? 'Tạo manifest mới từ revision đã duyệt để tiếp tục.'
            : 'Quyết định này chỉ đóng dry-run và tạo receipt cục bộ.'}</span>
        </div>
      )}
      {workflow?.status === 'pending' && (
        <div className="cmr-channel-actions">
          <button type="button" className="cmr-button cmr-button--quiet" disabled={!canReview || expired || busy} onClick={() => void review('rejected')}>Từ chối</button>
          <button type="button" className="cmr-button cmr-button--primary" disabled={!canReview || expired || busy} onClick={() => void review('approved')}>
            <ReviewIcon className="cmr-button__icon" />Duyệt dry-run
          </button>
        </div>
      )}
      {!canReview && workflow?.status === 'pending' && (
        <small className="cmr-permission-note">Chỉ Owner, Manager hoặc Reviewer có thể quyết định.</small>
      )}
      {target === 'social' && workflow?.status === 'approved' && canConfigureTelegram && (
        <div className="cmr-telegram-candidate">
          <button
            type="button"
            className="cmr-button cmr-button--quiet"
            disabled={telegramCandidateBusy}
            onClick={() => void prepareTelegramCandidate()}
          >
            <ContentIcon className="cmr-button__icon" />
            {telegramCandidateBusy ? 'Đang chuẩn bị…' : 'Chuẩn bị Telegram preview'}
          </button>
          {telegramCandidate && (
            <div className="cmr-telegram-candidate__preview" role="status">
              <div>
                <span>Tin nhắn private sandbox</span>
                <code title={telegramCandidate.resourceDigest}>{shortDigest(telegramCandidate.resourceDigest)}</code>
              </div>
              <p>{telegramCandidate.text}</p>
              <small>Source r{telegramCandidate.expectedRevision} · Chưa có hành động bên ngoài · Chờ named approval</small>
            </div>
          )}
          {telegramCandidateError && <div className="cmr-credential-error" role="alert">{telegramCandidateError}</div>}
        </div>
      )}
      {target === 'social' && workflow?.status === 'approved' && !canConfigureTelegram && (
        <small className="cmr-permission-note cmr-telegram-candidate__permission">
          Chỉ Owner hoặc Manager có thể chuẩn bị Telegram preview.
        </small>
      )}
    </section>
  );

  return (
    <div className="cmr-channel-view">
      <header className="cmr-view-intro cmr-view-intro--row">
        <div>
          <span className="cmr-eyebrow">Workflow wrappers · CMR-306</span>
          <h2>Chuẩn bị và duyệt workflow kênh</h2>
          <p>Chỉ đọc và mô phỏng. Không publish, gửi, chi tiêu hoặc ghi CRM.</p>
        </div>
        <div className={`cmr-channel-bridge cmr-channel-bridge--${status}`}>
          <span aria-hidden="true" />{bridgeLabel(status)}
        </div>
      </header>
      <section className="cmr-credential-panel" aria-labelledby="cmr-credential-heading">
        <div className="cmr-credential-panel__heading">
          <div>
            <span className="cmr-eyebrow">Provider vault</span>
            <h3 id="cmr-credential-heading">Kết nối kênh</h3>
          </div>
          <div className={'cmr-credential-vault cmr-credential-vault--' + credentialBridgeStatus}>
            <span aria-hidden="true" />
            {credentialBridgeLabel(credentialBridgeStatus, credentialVaultState)}
          </div>
          <button
            type="button"
            className="cmr-icon-button"
            aria-label="Tải lại trạng thái kết nối"
            title="Tải lại"
            disabled={credentialLoading || Boolean(revokingProvider)}
            onClick={() => void loadCredentials()}
          >
            <RefreshIcon className="cmr-icon" />
          </button>
        </div>
        <div className="cmr-sr-only" role="status" aria-live="polite" aria-atomic="true">
          {credentialAnnouncement}
        </div>
        <div className="cmr-credential-grid" aria-busy={credentialLoading}>
          {credentialLoading && <div className="cmr-credential-empty">Đang kiểm tra kết nối...</div>}
          {!credentialLoading && credentials.map((item) => {
            const providerLabel = PROVIDER_META[item.provider].label;
            const canRevoke = canRevokeCredentials && item.state !== 'disconnected';
            return (
              <div key={item.provider} className={'cmr-credential-row cmr-credential-row--' + item.state}>
                <div className="cmr-credential-row__identity">
                  <StatusIcon className="cmr-icon" />
                  <span>
                    <strong>{providerLabel}</strong>
                    <small>{credentialStateLabel(item.state)}</small>
                  </span>
                </div>
                {canRevoke && (
                  <button
                    type="button"
                    className="cmr-icon-button cmr-credential-revoke"
                    aria-label={'Thu hồi ' + providerLabel}
                    title={'Thu hồi ' + providerLabel}
                    disabled={Boolean(revokingProvider)}
                    onClick={() => void revokeCredential(item.provider)}
                  >
                    <CloseIcon className="cmr-icon" />
                  </button>
                )}
              </div>
            );
          })}
          {!credentialLoading && credentials.length === 0 && (
            <div className="cmr-credential-empty">
              {credentialEmptyLabel(credentialBridgeStatus, credentialVaultState)}
            </div>
          )}
        </div>
        <div className="cmr-canary-readiness" aria-label="Trạng thái Telegram canary">
          {[
            ['Credential', canaryReadiness?.credentialState === 'connected'],
            ['Private chat', Boolean(canaryReadiness && !canaryReadiness.missingRequirements.includes('private_sandbox_chat'))],
            ['Named approval', Boolean(canaryReadiness && !canaryReadiness.missingRequirements.includes('named_approval'))],
            ['Canary', canaryReadiness?.liveReady === true],
          ].map(([label, ready]) => (
            <span key={String(label)} className={ready ? 'is-ready' : ''}>
              <StatusIcon className="cmr-icon" />{label}
            </span>
          ))}
        </div>
        {canConfigureTelegram ? (
          <form
            className="cmr-telegram-setup"
            onSubmit={(event) => { event.preventDefault(); void configureTelegramSandbox(); }}
          >
            <label>
              <span>Telegram bot token</span>
              <input
                type="password"
                autoComplete="off"
                value={telegramToken}
                disabled={telegramSetupBusy || credentialVaultState !== 'ready'}
                onChange={(event) => setTelegramToken(event.target.value)}
                placeholder="123456789:..."
                required
              />
            </label>
            <label>
              <span>Private sandbox chat ID</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={telegramChatId}
                disabled={telegramSetupBusy || credentialVaultState !== 'ready'}
                onChange={(event) => setTelegramChatId(event.target.value)}
                placeholder="-100..."
                required
              />
            </label>
            <button
              type="submit"
              className="cmr-button cmr-button--primary"
              disabled={telegramSetupBusy || credentialVaultState !== 'ready' || !telegramToken || !telegramChatId}
            >
              {telegramSetupBusy ? 'Đang lưu…' : 'Lưu Telegram sandbox'}
            </button>
          </form>
        ) : (
          <small className="cmr-permission-note">Chỉ Owner hoặc Manager có thể cấu hình Telegram sandbox.</small>
        )}
        {telegramSetupNotice && <div className="cmr-telegram-setup__notice" role="status">{telegramSetupNotice}</div>}
        {!canRevokeCredentials && (
          <small className="cmr-permission-note">Chỉ Owner hoặc Manager có thể thu hồi kết nối.</small>
        )}
        {credentialError && <div className="cmr-credential-error" role="alert">{credentialError}</div>}
      </section>
      <fieldset className="cmr-channel-targets" disabled={busy}>
        <legend className="cmr-sr-only">Chọn workflow wrapper</legend>
        {TARGETS.map((item) => (
          <label key={item.value} className={target === item.value ? 'is-active' : ''}>
            <input
              type="radio"
              name="cmr-workflow-target"
              value={item.value}
              checked={target === item.value}
              onChange={() => { setTarget(item.value); setQuery(''); }}
            />
            <span>{item.label}</span>
          </label>
        ))}
      </fieldset>
      <div className="cmr-channel-live" aria-live="polite">
        {loading ? 'Đang xác minh nguồn và workflow…' : notice}
      </div>
      {error && <div className="cmr-alert cmr-alert--error" role="alert">{error}</div>}
      <div className="cmr-channel-workspace" aria-busy={loading || busy}>
        {sourceColumn}
        {manifestColumn}
        {decisionColumn}
      </div>
    </div>
  );
}
