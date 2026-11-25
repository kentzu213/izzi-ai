import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CustomerRole } from '../../shared/customer-marketing-types';
import type { CustomerCareSnapshot } from '../../shared/customer-care-types';
import {
  ADS_DATE_PRESETS,
  ADS_DATE_PRESET_LABELS,
  ADS_PROVIDERS,
  ADS_PROVIDER_LABELS,
  type AdsDatePreset,
  type AdsHealthStatus,
  type AdsOverviewPayload,
  type AdsProvider,
  type AdsStatusPayload,
  type MarketingAdsConnectResult,
  type MarketingAdsDisconnectResult,
  type MarketingAdsErrorCode,
  type MarketingAdsOAuthEvent,
  type MarketingAdsOverviewInput,
  type MarketingAdsOverviewResult,
  type MarketingAdsSaveMetaAccountsInput,
  type MarketingAdsSaveMetaAccountsResult,
  type MarketingAdsStatusResult,
  type UnifiedAdAccount,
} from '../../shared/marketing-ads-types';
import { usePanelVisible } from '../lib/panel-visibility';
import '../styles/v2/customer-ads.css';

type MarketingAdsApi = {
  getStatus: () => Promise<MarketingAdsStatusResult>;
  connectMetaAds: () => Promise<MarketingAdsConnectResult>;
  saveMetaAccounts: (input: MarketingAdsSaveMetaAccountsInput) => Promise<MarketingAdsSaveMetaAccountsResult>;
  disconnectMetaAds: () => Promise<MarketingAdsDisconnectResult>;
  getOverview: (input?: MarketingAdsOverviewInput) => Promise<MarketingAdsOverviewResult>;
  takeOAuthEvent: () => Promise<MarketingAdsOAuthEvent | null>;
  onOAuthEvent: (listener: (event: MarketingAdsOAuthEvent) => void) => () => void;
};

type CarePagesLookupApi = {
  getSnapshot?: () => Promise<CustomerCareSnapshot>;
};

export interface CustomerAdsHubPanelProps {
  workspaceId: string;
  role: CustomerRole;
}

const CHANNEL_TABS: ReadonlyArray<{ id: AdsProvider | 'all'; label: string }> = [
  { id: 'all', label: 'Tổng hợp đa kênh' },
  { id: 'facebook_ads', label: 'Facebook Ads' },
  { id: 'youtube_ads', label: 'YouTube Ads' },
  { id: 'tiktok_ads', label: 'TikTok Ads' },
];

export const ADS_HEALTH_META: Record<AdsHealthStatus, { label: string; tone: 'good' | 'warn' | 'danger' | 'neutral' }> = {
  good: { label: 'Tốt', tone: 'good' },
  high_frequency: { label: 'Tần suất cao', tone: 'warn' },
  high_cost: { label: 'Giá cao', tone: 'danger' },
  paused: { label: 'Đang tắt', tone: 'neutral' },
  learning: { label: 'Đang học', tone: 'warn' },
};

const ERROR_COPY: Record<MarketingAdsErrorCode, string> = {
  auth: 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.',
  forbidden: 'Vai trò của bạn chưa có quyền truy cập hoặc cấu hình Quảng cáo.',
  access_changed: 'Workspace hoặc tài khoản vừa thay đổi. Đang tải lại.',
  invalid_input: 'Tham số lọc không hợp lệ.',
  declined: 'Bạn đã huỷ cấp quyền Facebook Ads.',
  expired: 'Phiên kết nối Facebook Ads đã hết hạn. Hãy thử kết nối lại.',
  unsupported: 'Máy chủ chưa bật API Quản lý Quảng cáo (/api/marketing/ads).',
  unavailable: 'Không kết nối được máy chủ Quảng cáo. Thử lại sau ít phút.',
  not_configured: 'Máy chủ chưa cấu hình Meta Ads App.',
  rejected: 'Yêu cầu Quảng cáo bị từ chối. Hãy kiểm tra quyền tài khoản quảng cáo.',
  'invalid-response': 'Dữ liệu phản hồi từ máy chủ Quảng cáo không hợp lệ.',
};

function getAdsApi(): MarketingAdsApi | null {
  const api = (window.electronAPI as typeof window.electronAPI & { marketingAds?: Partial<MarketingAdsApi> })?.marketingAds;
  if (
    !api?.getStatus || !api.connectMetaAds || !api.saveMetaAccounts
    || !api.disconnectMetaAds || !api.getOverview || !api.takeOAuthEvent || !api.onOAuthEvent
  ) {
    return null;
  }
  return api as MarketingAdsApi;
}

function getCareSnapshotApi(): CarePagesLookupApi | null {
  const care = (window.electronAPI as typeof window.electronAPI & { customerCare?: CarePagesLookupApi })?.customerCare;
  return care?.getSnapshot ? care : null;
}

export function formatAdsCurrency(amount: number, currency = 'VND'): string {
  if (!Number.isFinite(amount)) return '0 đ';
  if (currency.toUpperCase() === 'VND') {
    return `${Math.round(amount).toLocaleString('vi-VN')} đ`;
  }
  return `${amount.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} ${currency}`;
}

export function formatAdsMetricCost(amount: number | null, currency = 'VND'): string {
  if (amount === null || !Number.isFinite(amount)) return '—';
  return formatAdsCurrency(amount, currency);
}

function formatClock(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function normalizePageOptions(
  status: AdsStatusPayload | null,
  overview: AdsOverviewPayload | null,
  careSnapshot: CustomerCareSnapshot | null,
): Array<{ pageId: string; pageName: string }> {
  const map = new Map<string, string>();
  const add = (id: string, name: string | null | undefined) => {
    if (!id) return;
    if (!map.has(id) || (name && name.trim())) {
      map.set(id, name?.trim() || `Page ${id.slice(-6)}`);
    }
  };
  if (careSnapshot?.pageConnection.state === 'connected') {
    add(careSnapshot.pageConnection.pageId, careSnapshot.pageConnection.pageName);
    for (const p of careSnapshot.pageConnection.crmPages ?? []) add(p.pageId, p.pageName);
  }
  for (const p of careSnapshot?.crmPages ?? []) add(p.pageId, p.pageName);
  for (const p of overview?.pages ?? []) add(p.pageId, p.pageName);
  for (const c of overview?.campaigns ?? []) {
    if (c.pageId) add(c.pageId, c.pageName);
  }
  for (const acc of status?.providers.facebook_ads.adAccounts ?? []) {
    if (acc.defaultPageId && !map.has(acc.defaultPageId)) add(acc.defaultPageId, null);
  }
  return Array.from(map.entries()).map(([pageId, pageName]) => ({ pageId, pageName }));
}

export function CustomerAdsHubPanel({ workspaceId, role }: CustomerAdsHubPanelProps) {
  const visible = usePanelVisible();
  const canManage = role === 'owner' || role === 'manager';
  const canMapCampaignPage = canManage || role === 'editor';

  const [datePreset, setDatePreset] = useState<AdsDatePreset>('last_7d');
  const [platform, setPlatform] = useState<AdsProvider | 'all'>('all');
  const [accountId, setAccountId] = useState<string>('all');
  const [pageId, setPageId] = useState<string>('all');

  const [status, setStatus] = useState<AdsStatusPayload | null>(null);
  const [overview, setOverview] = useState<AdsOverviewPayload | null>(null);
  const [careSnapshot, setCareSnapshot] = useState<CustomerCareSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [savingAccounts, setSavingAccounts] = useState(false);
  const [savingCampaignId, setSavingCampaignId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [draftAccounts, setDraftAccounts] = useState<UnifiedAdAccount[]>([]);

  const mountedRef = useRef(true);
  const seqRef = useRef(0);
  const hasOverviewRef = useRef(false);
  hasOverviewRef.current = overview !== null;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    setAccountId('all');
    setPageId('all');
    setStatus(null);
    setOverview(null);
    setCareSnapshot(null);
    setDraftAccounts([]);
    setModalOpen(false);
    setError('');
    setNotice('');
  }, [workspaceId]);

  const loadData = useCallback(async (forceRefresh = false) => {
    const api = getAdsApi();
    if (!api) {
      setError('Quản lý Quảng cáo cần chạy trong Izzi AI Desktop.');
      setLoading(false);
      return;
    }
    const seq = ++seqRef.current;
    if (forceRefresh) setRefreshing(true);
    else if (!hasOverviewRef.current) setLoading(true);
    setError('');

    try {
      const [statusRes, overviewRes, careRes] = await Promise.all([
        api.getStatus(),
        api.getOverview({
          datePreset,
          platform,
          accountId: accountId === 'all' ? null : accountId,
          pageId: pageId === 'all' ? null : pageId,
          ...(forceRefresh ? { refresh: true } : {}),
        }),
        getCareSnapshotApi()?.getSnapshot?.().catch(() => null) ?? Promise.resolve(null),
      ]);
      if (!mountedRef.current || seq !== seqRef.current) return;

      if (careRes && careRes.workspaceId === workspaceId) {
        setCareSnapshot(careRes);
      }

      if (!statusRes.ok) {
        setError(ERROR_COPY[statusRes.error]);
      } else if (statusRes.status.workspaceId === workspaceId) {
        setStatus(statusRes.status);
      }

      if (!overviewRes.ok) {
        setError((prev) => prev || ERROR_COPY[overviewRes.error]);
      } else if (overviewRes.overview.workspaceId === workspaceId) {
        setOverview(overviewRes.overview);
      }
    } catch {
      if (mountedRef.current && seq === seqRef.current) {
        setError('Chưa tải được dữ liệu Quảng cáo. Thử lại sau ít phút.');
      }
    } finally {
      if (mountedRef.current && seq === seqRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [workspaceId, datePreset, platform, accountId, pageId]);

  useEffect(() => {
    if (!visible) return;
    void loadData(false);
  }, [visible, loadData]);

  const handleOAuthEvent = useCallback((event: MarketingAdsOAuthEvent | null) => {
    if (!event || !mountedRef.current) return;
    setConnecting(false);
    if (!event.ok) {
      setError(ERROR_COPY[event.error]);
      return;
    }
    if (event.workspaceId !== workspaceId) return;
    setError('');
    setNotice(`Đã kết nối Facebook Ads (${event.adAccounts.length} tài khoản quảng cáo). Hãy chọn TKQC muốn theo dõi.`);
    setDraftAccounts(event.adAccounts.map((item) => ({ ...item })));
    setModalOpen(true);
    void loadData(true);
  }, [workspaceId, loadData]);

  useEffect(() => {
    const api = getAdsApi();
    if (!api) return undefined;
    void api.takeOAuthEvent().then(handleOAuthEvent, () => undefined);
    const unsub = api.onOAuthEvent(handleOAuthEvent);
    return () => unsub();
  }, [handleOAuthEvent]);

  const metaStatus = status?.providers.facebook_ads;
  const isMetaConnected = Boolean(metaStatus?.connected);
  const pageOptions = useMemo(
    () => normalizePageOptions(status, overview, careSnapshot),
    [status, overview, careSnapshot],
  );
  const accountOptions = useMemo(
    () => (status?.providers.facebook_ads.adAccounts ?? overview?.accounts ?? []).filter((a) => a.enabled),
    [status, overview],
  );

  const openManageModal = () => {
    const source = status?.providers.facebook_ads.adAccounts ?? overview?.accounts ?? [];
    setDraftAccounts(source.map((item) => ({ ...item })));
    setModalOpen(true);
  };

  const connectMetaAds = async () => {
    const api = getAdsApi();
    if (!api || !canManage || connecting) return;
    setConnecting(true);
    setError('');
    setNotice('');
    try {
      const res = await api.connectMetaAds();
      if (!mountedRef.current) return;
      if (!res.ok) {
        setConnecting(false);
        setError(ERROR_COPY[res.error]);
        return;
      }
      setNotice('Đã mở trình duyệt Facebook để cấp quyền đọc Quảng cáo (ads_read). Hoàn tất trong trình duyệt rồi quay lại đây.');
    } catch {
      if (mountedRef.current) {
        setConnecting(false);
        setError(ERROR_COPY.unavailable);
      }
    }
  };

  const saveAccountsModal = async () => {
    const api = getAdsApi();
    if (!api || !canManage || savingAccounts) return;
    setSavingAccounts(true);
    setError('');
    setNotice('');
    try {
      const res = await api.saveMetaAccounts({
        accounts: draftAccounts.map((item) => ({
          id: item.id,
          enabled: item.enabled,
          defaultPageId: item.defaultPageId,
        })),
      });
      if (!mountedRef.current) return;
      if (!res.ok) {
        setError(ERROR_COPY[res.error]);
        return;
      }
      setStatus(res.status);
      setModalOpen(false);
      setNotice('Đã lưu danh sách tài khoản quảng cáo và Page mặc định.');
      await loadData(true);
    } catch {
      if (mountedRef.current) setError(ERROR_COPY.unavailable);
    } finally {
      if (mountedRef.current) setSavingAccounts(false);
    }
  };

  const disconnectMeta = async () => {
    const api = getAdsApi();
    if (!api || !canManage || savingAccounts) return;
    if (!window.confirm('Ngắt kết nối Facebook Ads khỏi workspace này? Dữ liệu CRM và khách hàng vẫn được giữ nguyên.')) {
      return;
    }
    setSavingAccounts(true);
    setError('');
    try {
      const res = await api.disconnectMetaAds();
      if (!mountedRef.current) return;
      if (!res.ok) {
        setError(ERROR_COPY[res.error]);
        return;
      }
      if (res.status) setStatus(res.status);
      setModalOpen(false);
      setNotice('Đã ngắt kết nối Facebook Ads.');
      await loadData(false);
    } catch {
      if (mountedRef.current) setError(ERROR_COPY.unavailable);
    } finally {
      if (mountedRef.current) setSavingAccounts(false);
    }
  };

  const assignCampaignPage = async (campaignId: string, nextPageId: string) => {
    const api = getAdsApi();
    if (!api || !canMapCampaignPage || savingCampaignId) return;
    setSavingCampaignId(campaignId);
    setError('');
    try {
      const res = await api.saveMetaAccounts({
        campaignPageMap: { [campaignId]: nextPageId || null },
      });
      if (!mountedRef.current) return;
      if (!res.ok) {
        setError(ERROR_COPY[res.error]);
        return;
      }
      setStatus(res.status);
      setNotice('Đã cập nhật gán Page cho chiến dịch.');
      await loadData(false);
    } catch {
      if (mountedRef.current) setError(ERROR_COPY.unavailable);
    } finally {
      if (mountedRef.current) setSavingCampaignId(null);
    }
  };

  const selectedAccountCurrency = accountId !== 'all'
    ? overview?.accounts.find((a) => a.id === accountId)?.currency
    : undefined;
  const currency = selectedAccountCurrency ?? overview?.accounts[0]?.currency ?? 'VND';
  const accountCurrencyById = useMemo(
    () => new Map((overview?.accounts ?? []).map((a) => [a.id, a.currency])),
    [overview],
  );
  const blended = overview?.blended;
  const maxSpend = useMemo(
    () => Math.max(1, ...(overview?.daily.map((d) => d.spend) ?? [1])),
    [overview],
  );
  const maxLeads = useMemo(
    () => Math.max(1, ...(overview?.daily.map((d) => d.crmPhoneLeads) ?? [1])),
    [overview],
  );

  const channels = useMemo(() => {
    if (overview?.channels.length) return overview.channels;
    return ADS_PROVIDERS.map((p) => {
      const st = status?.providers[p];
      return {
        provider: p,
        label: ADS_PROVIDER_LABELS[p],
        status: st?.connected ? 'connected' as const : 'ready_to_connect' as const,
        adAccountsCount: st?.adAccounts.filter((a) => a.enabled).length ?? 0,
        activeCampaignsCount: 0,
        spend: 0,
        impressions: 0,
        clicks: 0,
        reach: 0,
        ctr: 0,
        cpc: 0,
        cpm: 0,
        messagingConversations: 0,
        costPerMessagingConversation: null,
        crmPhoneLeads: null,
        costPerPhoneLead: null,
      };
    });
  }, [overview, status]);

  return (
    <section className="v2-ads" aria-labelledby="v2-ads-title">
      <header className="v2-ads__header">
        <div>
          <span className="cmr-eyebrow">Ads Intelligence · Read-only (ads_read)</span>
          <h2 id="v2-ads-title" className="v2-ads__title">Quảng cáo Ads &amp; Đối soát SĐT CRM</h2>
          <p className="v2-ads__subtitle">
            Theo dõi chi phí Meta Ads (thái mai t6, Sline 3…), YouTube Ads &amp; TikTok Ads đối soát trực tiếp với SĐT thật từ CRM.
          </p>
        </div>
        <div className="v2-ads__header-actions">
          {overview?.syncedAt && (
            <span className="v2-ads__sync-meta">
              Cập nhật {formatClock(overview.syncedAt)}{overview.cached ? ' (cache)' : ''}
            </span>
          )}
          <button
            type="button"
            className="v2-button v2-button--ghost"
            disabled={loading || refreshing}
            onClick={() => { void loadData(true); }}
          >
            {refreshing ? 'Đang tải…' : 'Làm mới'}
          </button>
          {canManage && (
            isMetaConnected ? (
              <button type="button" className="v2-button v2-button--primary" onClick={openManageModal}>
                Quản lý TKQC
              </button>
            ) : (
              <button
                type="button"
                className="v2-button v2-button--primary"
                disabled={connecting}
                onClick={() => { void connectMetaAds(); }}
              >
                {connecting ? 'Đang chờ trình duyệt…' : 'Kết nối Facebook Ads'}
              </button>
            )
          )}
        </div>
      </header>

      <div className="v2-ads__filters">
        <div className="v2-project-tabs" role="group" aria-label="Kênh quảng cáo">
          {CHANNEL_TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`v2-tab${platform === item.id ? ' is-active' : ''}`}
              aria-pressed={platform === item.id}
              onClick={() => setPlatform(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="v2-ads__filter-selects">
          <label htmlFor="v2-ads-date">
            <span>Thời gian</span>
            <select
              id="v2-ads-date"
              value={datePreset}
              onChange={(e) => setDatePreset(e.currentTarget.value as AdsDatePreset)}
            >
              {ADS_DATE_PRESETS.map((preset) => (
                <option key={preset} value={preset}>{ADS_DATE_PRESET_LABELS[preset]}</option>
              ))}
            </select>
          </label>

          <label htmlFor="v2-ads-account">
            <span>Tài khoản</span>
            <select
              id="v2-ads-account"
              value={accountId}
              onChange={(e) => setAccountId(e.currentTarget.value)}
            >
              <option value="all">Tất cả TKQC</option>
              {accountOptions.map((acc) => (
                <option key={acc.id} value={acc.id}>{acc.name}</option>
              ))}
            </select>
          </label>

          <label htmlFor="v2-ads-page">
            <span>Page</span>
            <select
              id="v2-ads-page"
              value={pageId}
              onChange={(e) => setPageId(e.currentTarget.value)}
            >
              <option value="all">Tất cả Page</option>
              {pageOptions.map((p) => (
                <option key={p.pageId} value={p.pageId}>{p.pageName}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {error && <div className="cmr-alert cmr-alert--error" role="alert">{error}</div>}
      {notice && <div className="cmr-alert cmr-alert--success" role="status">{notice}</div>}

      {loading && !overview ? (
        <div className="v2-empty" role="status">Đang tải số liệu Quảng cáo…</div>
      ) : (
        <>
          {/* Tầng 1: Blended KPI Ribbon */}
          <div className="v2-ads__kpi-ribbon" aria-label="Chỉ số tổng hợp Ads và CRM">
            <article className="v2-ads__kpi-card">
              <span className="v2-ads__kpi-label">Tổng Chi tiêu</span>
              <strong className="v2-ads__kpi-value">{formatAdsCurrency(blended?.spend ?? 0, currency)}</strong>
              <span className="v2-ads__kpi-sub">
                {(blended?.impressions ?? 0).toLocaleString('vi-VN')} hiển thị · CTR {(blended?.ctr ?? 0).toFixed(2)}%
              </span>
            </article>

            <article className="v2-ads__kpi-card">
              <span className="v2-ads__kpi-label">Tin nhắn Ads &amp; Giá/Tin</span>
              <strong className="v2-ads__kpi-value">{(blended?.messagingConversations ?? 0).toLocaleString('vi-VN')} tin</strong>
              <span className="v2-ads__kpi-sub">
                Giá/Tin: {formatAdsMetricCost(blended?.costPerMessagingConversation ?? null, currency)}
              </span>
            </article>

            <article className="v2-ads__kpi-card v2-ads__kpi-card--highlight">
              <span className="v2-ads__kpi-label">SĐT thật từ CRM &amp; Giá / 1 SĐT</span>
              <strong className="v2-ads__kpi-value">{(blended?.crmPhoneLeads ?? 0).toLocaleString('vi-VN')} SĐT</strong>
              <span className="v2-ads__kpi-sub">
                Giá/SĐT: {formatAdsMetricCost(blended?.costPerPhoneLead ?? null, currency)}
              </span>
            </article>

            <article className="v2-ads__kpi-card">
              <span className="v2-ads__kpi-label">Tỷ lệ ra SĐT</span>
              <strong className="v2-ads__kpi-value">
                {blended?.phoneCaptureRate !== null && blended?.phoneCaptureRate !== undefined
                  ? `${blended.phoneCaptureRate.toFixed(1)}%`
                  : '—'}
              </strong>
              <span className="v2-ads__kpi-sub">SĐT thật / Tin nhắn Ads</span>
            </article>

            <article className="v2-ads__kpi-card">
              <span className="v2-ads__kpi-label">Khách cọc / chốt</span>
              <strong className="v2-ads__kpi-value">{(blended?.crmDeposits ?? 0).toLocaleString('vi-VN')} đơn</strong>
              <span className="v2-ads__kpi-sub">
                Giá/Cọc: {formatAdsMetricCost(blended?.costPerDeposit ?? null, currency)}
              </span>
            </article>
          </div>

          {/* Tầng 2: Channel Comparison & Page Breakdown */}
          <div className="v2-ads__tier-grid">
            <section className="v2-ads__card" aria-label="So sánh kênh quảng cáo">
              <h3>Hiệu suất theo kênh</h3>
              <div className="v2-ads__channels">
                {channels.map((ch) => (
                  <article key={ch.provider} className="v2-ads__channel-tile">
                    <div className="v2-ads__tile-head">
                      <strong>{ch.label}</strong>
                      <span className={`v2-ads__pill ${ch.status === 'connected' ? 'v2-ads__pill--good' : ''}`}>
                        {ch.status === 'connected' ? 'Đang chạy' : ch.status === 'error' ? 'Lỗi kết nối' : 'Sẵn sàng kết nối'}
                      </span>
                    </div>
                    <div className="v2-ads__tile-metrics">
                      <span>Chi tiêu</span><strong>{formatAdsCurrency(ch.spend, currency)}</strong>
                      <span>Tin nhắn</span><strong>{ch.messagingConversations.toLocaleString('vi-VN')}</strong>
                      <span>SĐT CRM</span><strong>{ch.crmPhoneLeads !== null ? ch.crmPhoneLeads.toLocaleString('vi-VN') : '—'}</strong>
                      <span>Giá / SĐT</span><strong>{formatAdsMetricCost(ch.costPerPhoneLead, currency)}</strong>
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section className="v2-ads__card" aria-label="Hiệu suất theo từng Page">
              <h3>Đối soát theo từng Page</h3>
              {(overview?.pages.length ?? 0) === 0 ? (
                <p className="ccw__hint">
                  Chưa có dữ liệu theo Page. Hãy gán chiến dịch vào Page ở bảng bên dưới để đối soát SĐT thật.
                </p>
              ) : (
                <div className="v2-ads__pages-list">
                  {overview!.pages.map((p) => (
                    <article key={p.pageId} className="v2-ads__page-tile">
                      <div className="v2-ads__tile-head">
                        <strong>{p.pageName || `Page ${p.pageId.slice(-6)}`}</strong>
                        <span className="v2-ads__pill">{p.campaignsCount} CD</span>
                      </div>
                      <div className="v2-ads__tile-metrics">
                        <span>Chi tiêu</span><strong>{formatAdsCurrency(p.spend, currency)}</strong>
                        <span>SĐT CRM</span><strong>{p.crmPhoneLeads.toLocaleString('vi-VN')}</strong>
                        <span>Giá / SĐT</span><strong>{formatAdsMetricCost(p.costPerPhoneLead, currency)}</strong>
                        <span>Ra SĐT / Cọc</span>
                        <strong>
                          {p.phoneCaptureRate !== null ? `${p.phoneCaptureRate.toFixed(1)}%` : '—'} · {p.crmDeposits} cọc
                        </strong>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>

          {/* Tầng 3: Campaign Table + Daily Trend */}
          <div className="v2-ads__tier-grid">
            <section className="v2-ads__card" aria-label="Bảng chiến dịch quảng cáo">
              <h3>Chiến dịch ({overview?.campaigns.length ?? 0})</h3>
              {(overview?.campaigns.length ?? 0) === 0 ? (
                <div className="v2-empty">
                  {isMetaConnected
                    ? 'Chưa có chiến dịch nào trong khoảng thời gian đã chọn. Hãy kiểm tra bộ lọc hoặc Quản lý TKQC.'
                    : 'Kết nối Facebook Ads để xem chiến dịch và đối soát SĐT thật từ CRM.'}
                </div>
              ) : (
                <div className="v2-ads__table-wrap">
                  <table className="v2-ads__table">
                    <thead>
                      <tr>
                        <th>Chiến dịch</th>
                        <th>Page gán</th>
                        <th>Trạng thái</th>
                        <th>Ngân sách</th>
                        <th>Chi tiêu</th>
                        <th>CPM / CTR / TS</th>
                        <th>Tin nhắn</th>
                        <th>Giá / Tin</th>
                        <th>Sức khỏe</th>
                      </tr>
                    </thead>
                    <tbody>
                      {overview!.campaigns.map((camp) => {
                        const health = ADS_HEALTH_META[camp.health];
                        const budget = camp.dailyBudget ?? camp.lifetimeBudget;
                        const campCurrency = accountCurrencyById.get(camp.adAccountId) ?? currency;
                        return (
                          <tr key={camp.id}>
                            <td>
                              <div className="v2-ads__camp-name">
                                <strong>{camp.name}</strong>
                                <small>{camp.adAccountName}</small>
                              </div>
                            </td>
                            <td>
                              <select
                                aria-label={`Gán Page cho ${camp.name}`}
                                value={camp.pageId ?? ''}
                                disabled={!canMapCampaignPage || savingCampaignId === camp.id}
                                onChange={(e) => { void assignCampaignPage(camp.id, e.currentTarget.value); }}
                              >
                                <option value="">— Chưa gán Page —</option>
                                {pageOptions.map((p) => (
                                  <option key={p.pageId} value={p.pageId}>{p.pageName}</option>
                                ))}
                              </select>
                            </td>
                            <td>{camp.effectiveStatus}</td>
                            <td>{budget !== null ? formatAdsCurrency(budget, campCurrency) : '—'}</td>
                            <td>{formatAdsCurrency(camp.spend, campCurrency)}</td>
                            <td>
                              {formatAdsCurrency(camp.cpm, campCurrency)} · {camp.ctr.toFixed(2)}% · {camp.frequency.toFixed(2)}
                            </td>
                            <td>{camp.messagingConversations.toLocaleString('vi-VN')}</td>
                            <td>{formatAdsMetricCost(camp.costPerMessagingConversation, campCurrency)}</td>
                            <td>
                              <span className={`v2-ads__pill ${health.tone !== 'neutral' ? `v2-ads__pill--${health.tone}` : ''}`}>
                                {health.label}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="v2-ads__card" aria-label="Biểu đồ chi tiêu và SĐT theo ngày">
              <h3>Xu hướng Chi tiêu vs SĐT CRM theo ngày</h3>
              <div className="v2-ads__daily-legend">
                <span><i className="v2-ads__legend-swatch" style={{ background: '#38d6ff' }} />Chi tiêu Ads</span>
                <span><i className="v2-ads__legend-swatch" style={{ background: '#39d98a' }} />SĐT thật CRM</span>
              </div>
              {(overview?.daily.length ?? 0) === 0 ? (
                <p className="ccw__hint">Chưa có dữ liệu theo ngày.</p>
              ) : (
                <div className="v2-ads__daily">
                  {overview!.daily.map((pt) => {
                    const spendH = Math.round((pt.spend / maxSpend) * 88);
                    const leadH = Math.round((pt.crmPhoneLeads / maxLeads) * 88);
                    return (
                      <div
                        key={pt.date}
                        className="v2-ads__daily-col"
                        title={`${pt.date}: ${formatAdsCurrency(pt.spend, currency)} · ${pt.crmPhoneLeads} SĐT`}
                      >
                        <div className="v2-ads__daily-bars">
                          <div className="v2-ads__bar-spend" style={{ height: `${Math.max(2, spendH)}px` }} />
                          <div className="v2-ads__bar-leads" style={{ height: `${Math.max(2, leadH)}px` }} />
                        </div>
                        <span className="v2-ads__daily-label">{pt.date.slice(5)}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        </>
      )}

      {modalOpen && (
        <div className="v2-ads__modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="v2-ads-modal-title">
          <div className="v2-ads__modal">
            <div className="v2-ads__tile-head">
              <h3 id="v2-ads-modal-title">Chọn Tài khoản quảng cáo Meta (ads_read)</h3>
              <button type="button" className="v2-button v2-button--ghost" onClick={() => setModalOpen(false)}>Đóng</button>
            </div>
            <p className="v2-ads__subtitle">
              Tích chọn các TKQC muốn theo dõi (ví dụ: thái mai t6, Sline 3) và chọn Page mặc định để đối soát SĐT từ CRM.
            </p>
            <ul className="v2-ads__modal-list">
              {draftAccounts.length === 0 ? (
                <li className="v2-ads__modal-item">Không tìm thấy tài khoản quảng cáo nào từ phiên Meta Ads vừa kết nối.</li>
              ) : (
                draftAccounts.map((acc) => (
                  <li key={acc.id} className="v2-ads__modal-item">
                    <label className="v2-ads__modal-check">
                      <input
                        type="checkbox"
                        checked={acc.enabled}
                        onChange={(e) => {
                          const enabled = e.currentTarget.checked;
                          setDraftAccounts((prev) =>
                            prev.map((item) => (item.id === acc.id ? { ...item, enabled } : item)),
                          );
                        }}
                      />
                      <span>
                        <strong>{acc.name}</strong>
                        <small>{acc.id} · {acc.currency}{acc.businessName ? ` · ${acc.businessName}` : ''}</small>
                      </span>
                    </label>
                    <select
                      aria-label={`Page mặc định cho ${acc.name}`}
                      value={acc.defaultPageId ?? ''}
                      onChange={(e) => {
                        const defaultPageId = e.currentTarget.value || null;
                        setDraftAccounts((prev) =>
                          prev.map((item) => (item.id === acc.id ? { ...item, defaultPageId } : item)),
                        );
                      }}
                    >
                      <option value="">— Chọn Page mặc định —</option>
                      {pageOptions.map((p) => (
                        <option key={p.pageId} value={p.pageId}>{p.pageName}</option>
                      ))}
                    </select>
                  </li>
                ))
              )}
            </ul>
            <div className="v2-ads__modal-actions">
              {isMetaConnected && canManage ? (
                <button
                  type="button"
                  className="v2-button v2-button--ghost"
                  disabled={savingAccounts}
                  onClick={() => { void disconnectMeta(); }}
                >
                  Ngắt kết nối Meta Ads
                </button>
              ) : <span />}
              <div className="v2-ads__header-actions">
                <button type="button" className="v2-button v2-button--ghost" onClick={() => setModalOpen(false)}>
                  Huỷ
                </button>
                <button
                  type="button"
                  className="v2-button v2-button--primary"
                  disabled={savingAccounts || !canManage}
                  onClick={() => { void saveAccountsModal(); }}
                >
                  {savingAccounts ? 'Đang lưu…' : 'Lưu cấu hình TKQC'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default CustomerAdsHubPanel;
