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
  CustomerMarketingConnectorOperationOutcome,
  CustomerMarketingConnectorOperationReceipt,
} from '../../shared/customer-marketing-connector-operation-types';
import type {
  CustomerMarketingCanaryReadinessResult,
  CustomerMarketingTelegramCanaryCandidate,
  CustomerMarketingTelegramCanaryEnableResult,
  CustomerMarketingTelegramCanaryNamedApprovalResult,
  CustomerMarketingTelegramCanaryRollbackResult,
  CustomerMarketingTelegramCanarySendResult,
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

type AutopostChannel = 'facebook' | 'youtube';
const CHANNEL_CONNECT_ROLES: CustomerRole[] = ['owner', 'manager'];
type ChannelConnectionState = 'connected' | 'attention' | 'disconnected' | 'unknown';

interface MarketingAutopostAccountSummary {
  platform: string;
  label: string;
  active: boolean;
}

function firstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function readAutopostAccounts(rows: unknown[]): MarketingAutopostAccountSummary[] {
  const accounts: MarketingAutopostAccountSummary[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const platform = firstString(record, ['platform', 'provider', 'network'])
      .toLocaleLowerCase('en-US');
    if (!platform) continue;
    const status = firstString(record, ['status', 'state']).toLocaleLowerCase('en-US');
    const inactive = record.isActive === false
      || record.active === false
      || status === 'inactive'
      || status === 'expired'
      || status === 'revoked';
    accounts.push({
      platform,
      label: firstString(record, ['name', 'accountName', 'displayName', 'channelTitle', 'username'])
        || 'Tài khoản đã liên kết',
      active: !inactive,
    });
  }
  return accounts;
}

function matchesChannel(platform: string, channel: AutopostChannel): boolean {
  return channel === 'youtube'
    ? platform.includes('youtube') || platform.includes('google')
    : platform.includes('facebook');
}

function channelStateLabel(state: ChannelConnectionState): string {
  if (state === 'connected') return 'Đã kết nối';
  if (state === 'attention') return 'Cần kết nối lại';
  if (state === 'unknown') return 'Chưa xác định';
  return 'Chưa kết nối';
}

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

function connectorOutcomeLabel(outcome: CustomerMarketingConnectorOperationOutcome): string {
  if (outcome === 'ready') return 'Sẵn sàng';
  if (outcome === 'unavailable') return 'Không khả dụng';
  if (outcome === 'revoked') return 'Đã thu hồi';
  if (outcome === 'not_found') return 'Không tìm thấy';
  if (outcome === 'performed') return 'Đã thực hiện';
  if (outcome === 'unknown') return 'Chưa xác định';
  return 'Không thực hiện';
}

function connectorOperationLabel(receipt: CustomerMarketingConnectorOperationReceipt): string {
  if (receipt.operation === 'health') return 'Health';
  if (receipt.operation === 'revoke') return 'Thu hồi';
  return 'Private canary';
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
  const [healthCheckingProvider, setHealthCheckingProvider] = useState<CustomerMarketingIntegrationProvider | null>(null);
  const [connectorReceipts, setConnectorReceipts] = useState<CustomerMarketingConnectorOperationReceipt[]>([]);
  const [canaryReadiness, setCanaryReadiness] = useState<CustomerMarketingCanaryReadinessResult | null>(null);
  const [telegramToken, setTelegramToken] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [telegramSetupBusy, setTelegramSetupBusy] = useState(false);
  const [telegramSetupNotice, setTelegramSetupNotice] = useState('');
  const [telegramCandidate, setTelegramCandidate] = useState<CustomerMarketingTelegramCanaryCandidate | null>(null);
  const [telegramCandidateBusy, setTelegramCandidateBusy] = useState(false);
  const [telegramCandidateError, setTelegramCandidateError] = useState('');
  const [telegramApproval, setTelegramApproval] = useState<CustomerMarketingTelegramCanaryNamedApprovalResult['approval']>(null);
  const [telegramApprovalBusy, setTelegramApprovalBusy] = useState(false);
  const [telegramApprovalError, setTelegramApprovalError] = useState('');
  const [telegramEnableReceipt, setTelegramEnableReceipt] = useState<CustomerMarketingTelegramCanaryEnableResult['receipt']>(null);
  const [telegramEnableBusy, setTelegramEnableBusy] = useState(false);
  const [telegramEnableError, setTelegramEnableError] = useState('');
  const [telegramEnableAnnouncement, setTelegramEnableAnnouncement] = useState('');
  const [telegramRollbackReceipt, setTelegramRollbackReceipt] = useState<CustomerMarketingTelegramCanaryRollbackResult['receipt']>(null);
  const [telegramRollbackBusy, setTelegramRollbackBusy] = useState(false);
  const [telegramRollbackError, setTelegramRollbackError] = useState('');
  const [telegramRollbackAnnouncement, setTelegramRollbackAnnouncement] = useState('');
  const [telegramSendResult, setTelegramSendResult] = useState<CustomerMarketingTelegramCanarySendResult | null>(null);
  const [telegramSendBusy, setTelegramSendBusy] = useState(false);
  const [telegramSendError, setTelegramSendError] = useState('');
  const [telegramSendAnnouncement, setTelegramSendAnnouncement] = useState('');
  const [autopostAccounts, setAutopostAccounts] = useState<MarketingAutopostAccountSummary[]>([]);
  const [autopostReady, setAutopostReady] = useState(false);
  const [autopostLoading, setAutopostLoading] = useState(true);
  const [autopostError, setAutopostError] = useState('');
  const [autopostMaster, setAutopostMaster] = useState<{ enabled: boolean; connected: boolean } | null>(null);
  const [nativeMarketingMode, setNativeMarketingMode] = useState(false);
  const [nativeWorkspaceId, setNativeWorkspaceId] = useState('');
  const [connectingChannel, setConnectingChannel] = useState<AutopostChannel | null>(null);
  const [connectNotice, setConnectNotice] = useState('');
  const [now, setNow] = useState(() => Date.now());
  const requestId = useRef(0);
  const autopostRequestId = useRef(0);
  const telegramTokenInput = useRef<HTMLInputElement>(null);
  const manifestHeading = useRef<HTMLHeadingElement>(null);
  const telegramCandidatePreview = useRef<HTMLDivElement>(null);
  const telegramApprovalReceipt = useRef<HTMLDivElement>(null);
  const telegramEnableReceiptRef = useRef<HTMLDivElement>(null);
  const telegramRollbackReceiptRef = useRef<HTMLDivElement>(null);
  const telegramSendReceiptRef = useRef<HTMLDivElement>(null);

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
      const [result, operations, readiness] = await Promise.all([
        api.listIntegrationCredentials(),
        api.listConnectorOperations(),
        api.getCanaryReadiness(),
      ]);
      setCredentialBridgeStatus(result.status);
      setCredentialVaultState(result.vaultState);
      setCredentials(result.credentials);
      setConnectorReceipts(operations.receipts);
      setCanaryReadiness(readiness);
      if (!result.ok) setCredentialError(result.error || 'Không tải được trạng thái kết nối.');
      else if (!operations.ok) setCredentialError(operations.error || 'Không tải được nhật ký connector.');
    } catch (reason) {
      setCredentialBridgeStatus('unavailable');
      setCredentialVaultState('locked');
      setCredentials([]);
      setConnectorReceipts([]);
      setCanaryReadiness(null);
      setCredentialError(reason instanceof Error ? reason.message : 'Vault không phản hồi.');
    } finally {
      setCredentialLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCredentials();
  }, [loadCredentials]);

  const loadAutopostAccounts = useCallback(async () => {
    const nativeApi = window.electronAPI?.nativeMarketing;
    if (nativeApi) {
      const request = ++autopostRequestId.current;
      setNativeMarketingMode(true);
      setAutopostLoading(true);
      setAutopostError('');
      try {
        const workspaces = await nativeApi.listWorkspaces();
        if (request !== autopostRequestId.current) return;
        if (!workspaces.ok) {
          setNativeWorkspaceId('');
          setAutopostMaster({ enabled: true, connected: false });
          setAutopostReady(false);
          setAutopostAccounts([]);
          setAutopostError(workspaces.error);
          return;
        }
        let workspace = workspaces.workspaces[0];
        if (!workspace) {
          const created = await nativeApi.createWorkspace({ name: 'Izzi Marketing' });
          if (request !== autopostRequestId.current) return;
          if (!created.ok) {
            setNativeWorkspaceId('');
            setAutopostMaster({ enabled: true, connected: false });
            setAutopostReady(false);
            setAutopostAccounts([]);
            setAutopostError(created.error);
            return;
          }
          workspace = created.workspace;
        }
        const workspaceId = workspace.id;
        setNativeWorkspaceId(workspaceId);
        const accounts = await nativeApi.listAccounts(workspaceId);
        if (request !== autopostRequestId.current) return;
        setAutopostMaster({ enabled: true, connected: accounts.ok });
        if (!accounts.ok) {
          setAutopostReady(false);
          setAutopostAccounts([]);
          setAutopostError(accounts.error);
          return;
        }
        setAutopostReady(true);
        setAutopostAccounts(readAutopostAccounts(accounts.accounts));
      } catch {
        if (request !== autopostRequestId.current) return;
        setAutopostMaster({ enabled: true, connected: false });
        setAutopostReady(false);
        setAutopostAccounts([]);
        setAutopostError('Native Marketing API không phản hồi.');
      } finally {
        if (request === autopostRequestId.current) setAutopostLoading(false);
      }
      return;
    }
    setNativeMarketingMode(false);
    setNativeWorkspaceId('');
    setAutopostMaster(null);
    setAutopostReady(false);
    setAutopostAccounts([]);
    setAutopostLoading(false);
    setAutopostError('Native Marketing API chưa khả dụng trong bản Izzi AI này.');
  }, []);

  useEffect(() => {
    void loadAutopostAccounts();
    return () => { autopostRequestId.current += 1; };
  }, [loadAutopostAccounts]);

  useEffect(() => {
    const onFocus = () => { void loadAutopostAccounts(); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadAutopostAccounts]);

  useEffect(() => {
    const nativeApi = window.electronAPI?.nativeMarketing;
    if (!nativeApi?.onOAuthStatus) return undefined;
    return nativeApi.onOAuthStatus((result) => {
      setConnectingChannel(null);
      if (result.ok && result.exchange === 'linked') {
        setConnectNotice(`${result.platform === 'facebook' ? 'Facebook Test Page' : 'YouTube Private'} đã kết nối thành công.`);
        setAutopostError('');
      } else if (result.ok) {
        setAutopostError('OAuth đã hoàn tất nhưng provider chưa trả về tài khoản để lưu.');
      } else {
        setAutopostError(result.error === 'request-rejected'
          ? 'Kết nối OAuth đã bị hủy hoặc không hợp lệ. Chưa lưu tài khoản nào.'
          : 'Không hoàn tất được kết nối native. Chưa lưu tài khoản nào.');
      }
      void loadAutopostAccounts();
    });
  }, [loadAutopostAccounts]);

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
  const canConnectChannels = CHANNEL_CONNECT_ROLES.includes(role);
  const connectedCredentialCount = credentials.filter((item) => item.state === 'connected').length;
  const canaryEnabled = Boolean(
    canaryReadiness?.controlPlane?.enabled && !canaryReadiness.controlPlane.killSwitch,
  );
  const namedApprovalReady = Boolean(
    canaryReadiness && !canaryReadiness.missingRequirements.includes('named_approval'),
  );
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
    setTelegramApproval(null);
    setTelegramApprovalError('');
    setTelegramEnableReceipt(null);
    setTelegramEnableError('');
    setTelegramEnableAnnouncement('');
    setTelegramRollbackReceipt(null);
    setTelegramRollbackError('');
    setTelegramRollbackAnnouncement('');
    setTelegramSendResult(null);
    setTelegramSendError('');
    setTelegramSendAnnouncement('');
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
      if (result.operationReceipt) {
        setConnectorReceipts((current) => [...current, result.operationReceipt!].slice(-50));
      }
    } catch (reason) {
      setCredentialError(reason instanceof Error ? reason.message : 'Không thể thu hồi kết nối.');
    } finally {
      setRevokingProvider(null);
    }
  };

  const checkIntegrationHealth = async (provider: CustomerMarketingIntegrationProvider) => {
    const api = window.electronAPI?.customerMarketing;
    if (!api || healthCheckingProvider || revokingProvider) return;
    setHealthCheckingProvider(provider);
    setCredentialError('');
    try {
      const result = await api.checkIntegrationHealth({ provider });
      setCredentialBridgeStatus(result.status);
      if (!result.ok || !result.operationReceipt) {
        setCredentialError(result.error || 'Không thể kiểm tra trạng thái connector.');
        return;
      }
      setConnectorReceipts((current) => [...current, result.operationReceipt!].slice(-50));
    } catch (reason) {
      setCredentialError(reason instanceof Error ? reason.message : 'Không thể kiểm tra trạng thái connector.');
    } finally {
      setHealthCheckingProvider(null);
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

  const connectChannel = async (channel: AutopostChannel) => {
    const nativeApi = window.electronAPI?.nativeMarketing;
    if (!nativeApi || !canConnectChannels || connectingChannel) return;
    if (!nativeWorkspaceId) {
      setAutopostError('Chưa có native Marketing workspace. Bấm Tải lại rồi thử lại.');
      return;
    }
    setConnectingChannel(channel);
    setAutopostError('');
    setConnectNotice('');
    try {
      const result = await nativeApi.beginConnect(nativeWorkspaceId, channel);
      if (!result.ok) {
        setAutopostError(result.error);
        return;
      }
      setConnectNotice(
        `${channel === 'facebook' ? 'Facebook Test Page' : 'YouTube Private'}: đã mở cửa sổ cấp quyền. Hoàn tất trên trình duyệt rồi quay lại Izzi AI.`,
      );
    } catch {
      setAutopostError('Native Marketing API không tạo được phiên kết nối.');
    } finally {
      setConnectingChannel(null);
    }
  };

  const focusTelegramSetup = () => {
    if (!canConfigureTelegram) return;
    setConnectNotice('Nhập khóa Telegram trong phần cấu hình sandbox bên dưới.');
    window.requestAnimationFrame(() => {
      telegramTokenInput.current?.scrollIntoView({ block: 'center' });
      telegramTokenInput.current?.focus();
    });
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
    setTelegramApproval(null);
    setTelegramApprovalError('');
    setTelegramEnableReceipt(null);
    setTelegramEnableError('');
    setTelegramEnableAnnouncement('');
    setTelegramRollbackReceipt(null);
    setTelegramRollbackError('');
    setTelegramRollbackAnnouncement('');
    setTelegramSendResult(null);
    setTelegramSendError('');
    setTelegramSendAnnouncement('');
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
      window.requestAnimationFrame(() => telegramCandidatePreview.current?.focus());
    } catch (reason) {
      setTelegramCandidateError(reason instanceof Error ? reason.message : 'Không thể chuẩn bị Telegram preview.');
    } finally {
      setTelegramCandidateBusy(false);
    }
  };

  const approveTelegramCandidate = async () => {
    const api = window.electronAPI?.customerMarketing;
    if (!api || !telegramCandidate || telegramApprovalBusy) return;
    setTelegramApprovalBusy(true);
    setTelegramApprovalError('');
    try {
      const result = await api.approveTelegramCanaryCandidate({
        workflowId: telegramCandidate.workflowId,
        manifestDigest: telegramCandidate.manifestDigest,
        resourceDigest: telegramCandidate.resourceDigest,
        expectedRevision: telegramCandidate.expectedRevision,
      });
      if (!result.ok || !result.approval) {
        setTelegramApprovalError(result.error || 'Không thể tạo named approval.');
        return;
      }
      setTelegramApproval(result.approval);
      window.requestAnimationFrame(() => telegramApprovalReceipt.current?.focus());
      await loadCredentials();
    } catch (reason) {
      setTelegramApprovalError(reason instanceof Error ? reason.message : 'Không thể tạo named approval.');
    } finally {
      setTelegramApprovalBusy(false);
    }
  };

  const enableTelegramCanary = async () => {
    const api = window.electronAPI?.customerMarketing;
    const controlPlane = canaryReadiness?.controlPlane;
    if (!api || !telegramCandidate || !telegramApproval || !controlPlane || telegramEnableBusy) return;
    setTelegramEnableBusy(true);
    setTelegramEnableError('');
    setTelegramEnableAnnouncement('');
    try {
      const result = await api.enableTelegramCanary({
        workflowId: telegramCandidate.workflowId,
        manifestDigest: telegramCandidate.manifestDigest,
        resourceDigest: telegramCandidate.resourceDigest,
        expectedRevision: telegramCandidate.expectedRevision,
        expectedStateRevision: controlPlane.stateRevision,
      });
      if (!result.ok || !result.receipt || !result.controlPlane) {
        setTelegramEnableError(result.error || 'Không thể bật Telegram canary.');
        return;
      }
      setTelegramEnableReceipt(result.receipt);
      setTelegramRollbackReceipt(null);
      setTelegramApproval(null);
      setTelegramEnableAnnouncement('Canary nội bộ đã bật. Chưa gửi Telegram.');
      setCanaryReadiness((current) => {
        if (!current) return current;
        const missingRequirements = current.missingRequirements.filter(
          (item) => item !== 'named_approval' && item !== 'canary_enablement',
        );
        return {
          ...current,
          controlPlane: result.controlPlane,
          missingRequirements,
          liveReady: missingRequirements.length === 0,
        };
      });
      window.requestAnimationFrame(() => telegramEnableReceiptRef.current?.focus());
    } catch (reason) {
      setTelegramEnableError(reason instanceof Error ? reason.message : 'Không thể bật Telegram canary.');
    } finally {
      setTelegramEnableBusy(false);
    }
  };

  const rollbackTelegramCanary = async () => {
    const api = window.electronAPI?.customerMarketing;
    const controlPlane = canaryReadiness?.controlPlane;
    if (!api || !controlPlane?.enabled || telegramRollbackBusy) return;
    if (!window.confirm('Rollback canary nội bộ? Binding hiện tại sẽ bị gỡ và không gửi Telegram.')) return;
    setTelegramRollbackBusy(true);
    setTelegramRollbackError('');
    setTelegramRollbackAnnouncement('');
    try {
      const result = await api.rollbackTelegramCanary({
        expectedStateRevision: controlPlane.stateRevision,
      });
      if (!result.ok || !result.receipt || !result.controlPlane) {
        setTelegramRollbackError(result.error || 'Không thể rollback Telegram canary.');
        return;
      }
      setTelegramRollbackReceipt(result.receipt);
      setTelegramEnableReceipt(null);
      setTelegramRollbackAnnouncement('Canary đã rollback. Không gửi Telegram.');
      setCanaryReadiness((current) => current ? {
        ...current,
        controlPlane: result.controlPlane,
        liveReady: false,
        missingRequirements: Array.from(new Set([
          ...current.missingRequirements,
          'named_approval' as const,
          'canary_enablement' as const,
        ])),
      } : current);
      window.requestAnimationFrame(() => telegramRollbackReceiptRef.current?.focus());
    } catch (reason) {
      setTelegramRollbackError(reason instanceof Error ? reason.message : 'Không thể rollback Telegram canary.');
    } finally {
      setTelegramRollbackBusy(false);
    }
  };

  const sendTelegramCanary = async () => {
    const api = window.electronAPI?.customerMarketing;
    const controlPlane = canaryReadiness?.controlPlane;
    if (!api || !telegramCandidate || !controlPlane?.enabled
      || controlPlane.killSwitch || telegramSendBusy || telegramSendResult) return;
    setTelegramSendBusy(true);
    setTelegramSendError('');
    setTelegramSendAnnouncement('');
    try {
      const result = await api.sendTelegramCanary({
        workflowId: telegramCandidate.workflowId,
        manifestDigest: telegramCandidate.manifestDigest,
        resourceDigest: telegramCandidate.resourceDigest,
        expectedRevision: telegramCandidate.expectedRevision,
        expectedStateRevision: controlPlane.stateRevision,
      });
      setTelegramSendResult(result);
      if (result.outcome === 'performed') {
        setTelegramSendAnnouncement('Đã gửi đúng một tin Telegram private canary.');
      } else if (result.outcome === 'unknown') {
        setTelegramSendError('Không xác định được kết quả. Không thử lại. Hãy rollback và kiểm tra Telegram thủ công.');
        setTelegramSendAnnouncement('Kết quả gửi không xác định. Không được thử lại.');
      } else {
        setTelegramSendAnnouncement('Telegram chưa được gửi. Lần thử này đã khóa.');
      }
      window.requestAnimationFrame(() => telegramSendReceiptRef.current?.focus());
    } catch (reason) {
      setTelegramSendResult({
        ok: false,
        status: 'unavailable',
        outcome: 'unknown',
        controlPlane,
        receipt: null,
        detail: 'renderer-bridge-failed',
        externalActionPerformed: null,
        error: reason instanceof Error ? reason.message : 'Bridge gửi Telegram không phản hồi.',
      });
      setTelegramSendError('Không xác định được kết quả. Không thử lại. Hãy rollback và kiểm tra Telegram thủ công.');
      setTelegramSendAnnouncement('Kết quả gửi không xác định. Không được thử lại.');
      window.requestAnimationFrame(() => telegramSendReceiptRef.current?.focus());
    } finally {
      setTelegramSendBusy(false);
    }
  };

  const masterChecking = autopostLoading && !autopostMaster;
  const masterConnected = Boolean(autopostMaster?.connected);
  const masterEnabled = Boolean(autopostMaster?.enabled);
  const masterStateClass: ChannelConnectionState = masterChecking
    ? 'unknown'
    : masterConnected ? 'connected' : masterEnabled ? 'attention' : 'disconnected';
  const masterLabel = masterChecking
    ? 'Đang kiểm tra…'
    : masterConnected ? 'Đã kết nối' : masterEnabled ? 'Đã bật, chưa xác thực' : 'Chưa kết nối';
  const masterMeta = masterConnected
      ? 'Native Marketing API đang đọc trực tiếp workspace và tài khoản từ IzziAPI.'
    : masterEnabled
      ? 'Tài khoản chưa có native Marketing workspace.'
      : 'Native Marketing API chưa khả dụng trong bản Izzi AI này.';

  const autopostChannelState = (channel: AutopostChannel): ChannelConnectionState => {
    if (masterChecking) return 'unknown';
    if (!masterConnected) return 'disconnected';
    if (!autopostReady) return 'unknown';
    const matched = autopostAccounts.filter((item) => matchesChannel(item.platform, channel));
    if (matched.length === 0) return 'disconnected';
    return matched.some((item) => item.active) ? 'connected' : 'attention';
  };

  const autopostChannelDetail = (channel: AutopostChannel): string => {
    if (autopostLoading) return 'Đang đọc trạng thái từ Native Marketing API…';
    if (!masterConnected) return nativeMarketingMode
      ? 'Chưa có native Marketing workspace.'
      : 'Native Marketing API chưa khả dụng.';
    if (!autopostReady) return 'Chưa đọc được trạng thái từ Native Marketing API.';
    const matched = autopostAccounts.filter((item) => matchesChannel(item.platform, channel));
    if (matched.length === 0) return 'Chưa có tài khoản nào cho kênh này.';
    return matched.map((item) => `${item.label}${item.active ? '' : ' · cần cấp quyền lại'}`).join(' · ');
  };

  const facebookState = autopostChannelState('facebook');
  const youtubeState = autopostChannelState('youtube');
  const telegramCredential = credentials.find((item) => item.provider === 'telegram') ?? null;
  const telegramState: ChannelConnectionState = telegramCredential
    ? telegramCredential.state === 'connected'
      ? 'connected'
      : telegramCredential.state === 'disconnected' ? 'disconnected' : 'attention'
    : credentialLoading || credentialBridgeStatus !== 'synced' ? 'unknown' : 'disconnected';
  const telegramDetail = credentialLoading
    ? 'Đang đọc trạng thái vault cục bộ…'
    : telegramCredential
      ? `Vault cục bộ · ${credentialStateLabel(telegramCredential.state)}`
      : 'Chưa có khóa Telegram trong vault cục bộ.';

  const connectionCards: Array<{
    key: AutopostChannel | 'telegram';
    label: string;
    scope: string;
    state: ChannelConnectionState;
    detail: string;
    actionLabel: string;
    onAction: () => void;
    busy: boolean;
    disabled: boolean;
    note: string;
  }> = [
    {
      key: 'facebook',
      label: 'Facebook Test Page',
      scope: 'Chỉ dùng Trang thử nghiệm (Test Page). IzziAPI giữ khóa; Izzi AI không lưu token Facebook.',
      state: facebookState,
      detail: autopostChannelDetail('facebook'),
      actionLabel: facebookState === 'connected' ? 'Kết nối lại Facebook' : 'Kết nối Facebook',
      onAction: () => { void connectChannel('facebook'); },
      busy: connectingChannel === 'facebook',
      disabled: !canConnectChannels || !masterConnected || autopostLoading || Boolean(connectingChannel),
      note: !canConnectChannels
        ? 'Chỉ Owner hoặc Manager có thể kết nối kênh.'
        : !masterConnected ? 'Cần native Marketing workspace trước.' : '',
    },
    {
      key: 'youtube',
      label: 'YouTube Private',
      scope: 'Video thử nghiệm luôn ở chế độ Riêng tư (Private). IzziAPI giữ khóa; Izzi AI không lưu token YouTube.',
      state: youtubeState,
      detail: autopostChannelDetail('youtube'),
      actionLabel: youtubeState === 'connected' ? 'Kết nối lại YouTube' : 'Kết nối YouTube',
      onAction: () => { void connectChannel('youtube'); },
      busy: connectingChannel === 'youtube',
      disabled: !canConnectChannels || !masterConnected || autopostLoading || Boolean(connectingChannel),
      note: !canConnectChannels
        ? 'Chỉ Owner hoặc Manager có thể kết nối kênh.'
        : !masterConnected ? 'Cần native Marketing workspace trước.' : '',
    },
    {
      key: 'telegram',
      label: 'Telegram Sandbox',
      scope: 'Chỉ chat sandbox riêng tư. Khóa nằm trong vault cục bộ của Izzi AI.',
      state: telegramState,
      detail: telegramDetail,
      actionLabel: telegramState === 'connected' ? 'Cập nhật khóa Telegram' : 'Nhập khóa Telegram',
      onAction: focusTelegramSetup,
      busy: false,
      disabled: !canConfigureTelegram,
      note: canConfigureTelegram ? '' : 'Chỉ Owner hoặc Manager có thể cấu hình Telegram sandbox.',
    },
  ];

  const connectAnnouncement = autopostLoading
    ? 'Đang kiểm tra trạng thái kết nối kênh.'
    : connectNotice
      || autopostError
      || `Native Marketing ${masterLabel}. Facebook ${channelStateLabel(facebookState)}. `
        + `YouTube ${channelStateLabel(youtubeState)}. Telegram ${channelStateLabel(telegramState)}.`;

  const connectionCenter = (
    <section className="cmr-connect-center" aria-labelledby="cmr-connect-heading">
      <div className="cmr-connect-center__heading">
        <div>
          <span className="cmr-eyebrow">Kết nối kênh · IzziAPI native</span>
          <h3 id="cmr-connect-heading">Trung tâm kết nối</h3>
          <p>Izzi AI đọc trạng thái native trực tiếp từ IzziAPI. Kết nối không tự đăng nội dung.</p>
        </div>
        <button
          type="button"
          className="cmr-icon-button cmr-connect-center__reload"
          aria-label="Tải lại trạng thái kết nối kênh"
          title="Tải lại"
          disabled={autopostLoading || Boolean(connectingChannel)}
          onClick={() => void loadAutopostAccounts()}
        >
          <RefreshIcon className="cmr-icon" />
          <span>Tải lại</span>
        </button>
      </div>
      <div className="cmr-sr-only" role="status" aria-live="polite" aria-atomic="true">
        {connectAnnouncement}
      </div>
      <div className={`cmr-connect-master is-${masterStateClass}`} aria-busy={masterChecking}>
        <div className="cmr-connect-master__status">
          <span className="cmr-eyebrow">Native Marketing API</span>
          <strong className={`cmr-connect-state cmr-connect-state--${masterStateClass}`}>{masterLabel}</strong>
          <p>{masterMeta}</p>
        </div>
        {nativeMarketingMode ? (
          <small className="cmr-permission-note">Workspace: {nativeWorkspaceId || 'chưa có'}</small>
        ) : (
          <small className="cmr-permission-note">Cập nhật Izzi AI Desktop để dùng Native Marketing API.</small>
        )}
        {!canConnectChannels && (
          <small className="cmr-permission-note">Chỉ Owner hoặc Manager có thể kết nối kênh.</small>
        )}
      </div>
      {connectNotice && <div className="cmr-connect-notice" role="status">{connectNotice}</div>}
      {autopostError && <div className="cmr-credential-error" role="alert">{autopostError}</div>}
      <ol className="cmr-connect-flow">
        <li>Native Marketing API đã được tích hợp trong Izzi AI.</li>
        <li>Bấm kết nối Facebook Test Page hoặc YouTube Private.</li>
        <li>Hoàn tất đăng nhập trên trình duyệt rồi quay lại Izzi AI.</li>
        <li>Bấm Tải lại để cập nhật trạng thái.</li>
      </ol>
      <div className="cmr-connect-grid" aria-busy={autopostLoading}>
        {connectionCards.map((card) => (
          <article key={card.key} className={`cmr-connect-card cmr-connect-card--${card.key} is-${card.state}`}>
            <div className="cmr-connect-card__identity">
              <StatusIcon className="cmr-icon" />
              <span>
                <strong>{card.label}</strong>
                <small className={`cmr-connect-state cmr-connect-state--${card.state}`}>
                  {channelStateLabel(card.state)}
                </small>
              </span>
            </div>
            <p className="cmr-connect-card__scope">{card.scope}</p>
            <p className="cmr-connect-card__detail">{card.detail}</p>
            <button
              type="button"
              className="cmr-button cmr-button--primary cmr-connect-card__action"
              disabled={card.disabled || card.busy}
              aria-busy={card.busy}
              onClick={card.onAction}
            >
              {card.busy ? 'Đang mở trình duyệt…' : card.actionLabel}
            </button>
            {card.note && <small className="cmr-permission-note">{card.note}</small>}
          </article>
        ))}
      </div>
    </section>
  );

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
            <div
              className="cmr-telegram-candidate__preview"
              ref={telegramCandidatePreview}
              tabIndex={-1}
            >
              <div>
                <span>Tin nhắn private sandbox</span>
                <code title={telegramCandidate.resourceDigest}>{shortDigest(telegramCandidate.resourceDigest)}</code>
              </div>
              <p>{telegramCandidate.text}</p>
              <small>
                Source r{telegramCandidate.expectedRevision} · Chưa có hành động bên ngoài ·{' '}
                {telegramEnableReceipt
                  ? 'Canary đã bật · Chưa gửi Telegram'
                  : telegramApproval ? 'Named approval đã cấp' : 'Chờ named approval'}
              </small>
            </div>
          )}
          {telegramCandidate && !telegramApproval && !telegramEnableReceipt && (
            <div className="cmr-telegram-approval-action">
              <small>Chỉ tạo receipt phê duyệt. Canary vẫn tắt và không gửi tin nhắn.</small>
              <button
                type="button"
                className="cmr-button cmr-button--primary"
                disabled={telegramApprovalBusy}
                onClick={() => void approveTelegramCandidate()}
              >
                <ReviewIcon className="cmr-button__icon" />
                {telegramApprovalBusy ? 'Đang phê duyệt…' : 'Phê duyệt candidate này'}
              </button>
            </div>
          )}
          {telegramApproval && (
            <div
              className="cmr-telegram-approval"
              ref={telegramApprovalReceipt}
              tabIndex={-1}
              role="status"
            >
              <div><span>Named approval</span><code title={telegramApproval.receiptDigest}>{shortDigest(telegramApproval.receiptDigest)}</code></div>
              <strong>{telegramApproval.reviewer}</strong>
              <small>Hiệu lực đến {formatTime(telegramApproval.expiresAt)} · Canary vẫn tắt · Chưa gửi tin nhắn</small>
            </div>
          )}
          {telegramApproval && !telegramEnableReceipt && (
            <div className="cmr-telegram-enable-action">
              <small>Chỉ bind candidate đã duyệt vào control plane. Không gửi Telegram.</small>
              <button
                type="button"
                className="cmr-button cmr-button--primary"
                disabled={telegramEnableBusy
                  || !canaryReadiness?.controlPlane
                  || canaryReadiness.controlPlane.enabled
                  || canaryReadiness.controlPlane.killSwitch}
                onClick={() => void enableTelegramCanary()}
              >
                <StatusIcon className="cmr-button__icon" />
                {telegramEnableBusy ? 'Đang bật canary…' : 'Bật canary nội bộ'}
              </button>
            </div>
          )}
          {telegramEnableReceipt && (
            <div
              className="cmr-telegram-enable-receipt"
              ref={telegramEnableReceiptRef}
              tabIndex={-1}
              role="status"
            >
              <div>
                <span>Canary nội bộ đã bật</span>
                <code title={telegramEnableReceipt.receiptDigest}>{shortDigest(telegramEnableReceipt.receiptDigest)}</code>
              </div>
              <small>Named approval đã consume · Chưa gửi Telegram · State r{telegramEnableReceipt.stateRevision}</small>
            </div>
          )}
          {canaryEnabled && telegramCandidate && !telegramSendResult && (
            <div className="cmr-telegram-send-action">
              <small>
                Cửa sổ xác nhận riêng sẽ mở trước khi gửi đúng một tin thật. Nếu kết quả không xác định,
                không thử lại; hãy rollback và kiểm tra Telegram thủ công.
              </small>
              <button
                type="button"
                className="cmr-button cmr-button--danger"
                disabled={telegramSendBusy || canaryReadiness?.controlPlane?.killSwitch}
                onClick={() => void sendTelegramCanary()}
              >
                <StatusIcon className="cmr-button__icon" />
                {telegramSendBusy ? 'Đang chờ xác nhận…' : 'Gửi đúng 1 tin private'}
              </button>
            </div>
          )}
          {telegramSendResult && (
            <div
              className={`cmr-telegram-send-receipt cmr-telegram-send-receipt--${telegramSendResult.outcome}`}
              ref={telegramSendReceiptRef}
              tabIndex={-1}
            >
              <div>
                <span>{telegramSendResult.outcome === 'performed'
                  ? 'Đã gửi đúng 1 tin'
                  : telegramSendResult.outcome === 'unknown' ? 'Kết quả chưa xác định' : 'Chưa gửi tin'}</span>
                {telegramSendResult.receipt && (
                  <code title={telegramSendResult.receipt.receiptDigest}>
                    {shortDigest(telegramSendResult.receipt.receiptDigest)}
                  </code>
                )}
              </div>
              <small>{telegramSendResult.detail}</small>
              {telegramSendResult.outcome === 'unknown' && (
                <strong>Không thử lại. Hãy rollback và kiểm tra Telegram thủ công.</strong>
              )}
            </div>
          )}
          <div className="cmr-sr-only" role="status" aria-live="polite" aria-atomic="true">
            {telegramEnableAnnouncement}
          </div>
          <div className="cmr-sr-only" role="status" aria-live="assertive" aria-atomic="true">
            {telegramSendAnnouncement}
          </div>
          {telegramSendError && <div className="cmr-credential-error" role="alert">{telegramSendError}</div>}
          {telegramEnableError && <div className="cmr-credential-error" role="alert">{telegramEnableError}</div>}
          {telegramApprovalError && <div className="cmr-credential-error" role="alert">{telegramApprovalError}</div>}
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
          <p>Workflow an toàn mặc định; hành động bên ngoài chỉ chạy qua xác nhận riêng.</p>
        </div>
        <div className={`cmr-channel-bridge cmr-channel-bridge--${status}`}>
          <span aria-hidden="true" />{bridgeLabel(status)}
        </div>
      </header>
      {connectionCenter}
      <section className="cmr-credential-panel" aria-labelledby="cmr-credential-heading">
        <div className="cmr-credential-panel__heading">
          <div>
            <span className="cmr-eyebrow">Provider vault</span>
            <h3 id="cmr-credential-heading">Kho khóa provider</h3>
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
            const providerReceipts = connectorReceipts.filter((receipt) => receipt.provider === item.provider);
            const lastReceipt = providerReceipts.at(-1) ?? null;
            const lastHealth = [...providerReceipts].reverse().find((receipt) => (
              receipt.operation === 'health'
            )) ?? null;
            return (
              <div key={item.provider} className={'cmr-credential-row cmr-credential-row--' + item.state}>
                <div className="cmr-credential-row__identity">
                  <StatusIcon className="cmr-icon" />
                  <span>
                    <strong>{providerLabel}</strong>
                    <small>{credentialStateLabel(item.state)}</small>
                  </span>
                </div>
                <div className="cmr-credential-row__evidence">
                  <span>
                    <small>Lần kiểm tra</small>
                    <strong className={lastHealth?.outcome === 'ready' ? 'is-ready' : ''}>
                      {lastHealth
                        ? `${connectorOutcomeLabel(lastHealth.outcome)} · ${formatTime(lastHealth.occurredAt)}`
                        : 'Chưa kiểm tra'}
                    </strong>
                  </span>
                  <span>
                    <small>Receipt gần nhất</small>
                    {lastReceipt ? (
                      <strong title={lastReceipt.receiptDigest}>
                        {connectorOperationLabel(lastReceipt)} · {connectorOutcomeLabel(lastReceipt.outcome)} ·{' '}
                        {formatTime(lastReceipt.occurredAt)} · <code>{shortDigest(lastReceipt.receiptDigest)}</code>
                      </strong>
                    ) : <strong>Chưa có bằng chứng</strong>}
                  </span>
                </div>
                <div className="cmr-credential-row__actions">
                  <button
                    type="button"
                    className="cmr-icon-button cmr-credential-health"
                    aria-label={'Kiểm tra cục bộ ' + providerLabel}
                    title={'Kiểm tra cục bộ ' + providerLabel}
                    disabled={Boolean(healthCheckingProvider) || Boolean(revokingProvider)}
                    onClick={() => void checkIntegrationHealth(item.provider)}
                  >
                    <RefreshIcon className="cmr-icon" />
                  </button>
                  {canRevoke && (
                    <button
                      type="button"
                      className="cmr-icon-button cmr-credential-revoke"
                      aria-label={'Thu hồi ' + providerLabel}
                      title={'Thu hồi ' + providerLabel}
                      disabled={Boolean(revokingProvider) || Boolean(healthCheckingProvider)}
                      onClick={() => void revokeCredential(item.provider)}
                    >
                      <CloseIcon className="cmr-icon" />
                    </button>
                  )}
                </div>
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
            ['Credential đã kết nối', canaryReadiness?.credentialState === 'connected'],
            ['Private chat sẵn sàng', Boolean(canaryReadiness && !canaryReadiness.missingRequirements.includes('private_sandbox_chat'))],
            [canaryEnabled ? 'Named approval đã xử lý' : namedApprovalReady ? 'Named approval đã cấp' : 'Chưa có named approval', namedApprovalReady],
            [canaryReadiness?.controlPlane?.killSwitch ? 'Kill switch đang bật' : canaryEnabled ? 'Canary đã bật' : 'Canary chưa bật', canaryEnabled],
          ].map(([label, ready]) => (
            <span key={String(label)} className={ready ? 'is-ready' : ''}>
              <StatusIcon className="cmr-icon" />{label}
            </span>
          ))}
        </div>
        {canConfigureTelegram && canaryReadiness?.controlPlane?.enabled && (
          <div className="cmr-telegram-rollback-action">
            <small>Gỡ binding khỏi control plane. Không gửi Telegram.</small>
            <button
              type="button"
              className="cmr-button cmr-button--quiet"
              disabled={telegramRollbackBusy}
              onClick={() => void rollbackTelegramCanary()}
            >
              <CloseIcon className="cmr-button__icon" />
              {telegramRollbackBusy ? 'Đang rollback…' : 'Rollback canary'}
            </button>
          </div>
        )}
        {telegramRollbackReceipt && (
          <div
            className="cmr-telegram-rollback-receipt"
            ref={telegramRollbackReceiptRef}
            tabIndex={-1}
          >
            <div>
              <span>Canary đã rollback</span>
              <code title={telegramRollbackReceipt.receiptDigest}>{shortDigest(telegramRollbackReceipt.receiptDigest)}</code>
            </div>
            <small>
              {telegramRollbackReceipt.reason} · {formatTime(telegramRollbackReceipt.createdAt)} ·{' '}
              Binding đã gỡ · Không gửi Telegram · State r{telegramRollbackReceipt.stateRevision}
            </small>
          </div>
        )}
        <div className="cmr-sr-only" role="status" aria-live="polite" aria-atomic="true">
          {telegramRollbackAnnouncement}
        </div>
        {telegramRollbackError && <div className="cmr-credential-error" role="alert">{telegramRollbackError}</div>}
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
                ref={telegramTokenInput}
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
