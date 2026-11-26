import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CustomerRole } from '../../shared/customer-marketing-types';
import {
  ADS_DATE_PRESETS,
  ADS_DATE_PRESET_LABELS,
  type AdsDatePreset,
  type AdsHealthStatus,
  type AdsOverviewPayload,
  type AdsPageBreakdown,
  type AdsProvider,
  type AdsStatusPayload,
  type UnifiedAdAccount,
  type UnifiedAdCampaign,
} from '../../shared/marketing-ads-types';
import {
  CloseIcon,
  CostIcon,
  RefreshIcon,
  ResearchIcon,
  SettingsIcon,
  SetupIcon,
  StatusIcon,
  TrendUpIcon,
} from '../components/AppIcons';
import '../styles/v2/customer-ads.css';

export interface CustomerAdsHubPanelProps {
  workspaceId: string;
  role: CustomerRole;
}

export const ADS_HEALTH_META: Record<AdsHealthStatus, { label: string; tone: 'good' | 'warn' | 'danger' | 'neutral' }> = {
  good: { label: 'Ổn định', tone: 'good' },
  high_cost: { label: 'Giá cao', tone: 'danger' },
  high_frequency: { label: 'Tần suất cao', tone: 'warn' },
  learning: { label: 'Đang học máy', tone: 'neutral' },
  paused: { label: 'Tạm dừng', tone: 'neutral' },
};

const CHANNEL_TABS: ReadonlyArray<{ id: AdsProvider | 'all'; label: string }> = [
  { id: 'all', label: 'Tất cả' },
  { id: 'facebook_ads', label: 'Facebook Ads' },
  { id: 'youtube_ads', label: 'YouTube Ads' },
  { id: 'tiktok_ads', label: 'TikTok Ads' },
];

type CampaignSegment = 'spending' | 'active' | 'all';
type CampaignHealthFilter = 'all' | 'high_cost' | 'high_frequency' | 'unmapped';
type CampaignSortKey = 'spend' | 'messaging' | 'costPerMsg' | 'ctr' | 'frequency';
type ModalAccountFilter = 'all' | 'enabled' | 'active';

const CAMPAIGN_PAGE_SIZE = 25;

interface PageOption {
  pageId: string;
  pageName: string;
}

export function formatAdsCurrency(amount: number, currency = 'VND'): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const upper = currency.toUpperCase();
  if (upper === 'VND') {
    return `${Math.round(safe).toLocaleString('vi-VN')} đ`;
  }
  if (upper === 'USD') {
    return `$${safe.toLocaleString('vi-VN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
  }
  return `${safe.toLocaleString('vi-VN', { maximumFractionDigits: 2 })} ${upper}`;
}

export function formatAdsMetricCost(amount: number | null, currency = 'VND'): string {
  if (amount === null || !Number.isFinite(amount)) return '-';
  return formatAdsCurrency(amount, currency);
}

export function formatCompactCurrency(amount: number, currency = 'VND'): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  if (currency.toUpperCase() === 'VND') {
    if (safe >= 1_000_000) return `${(safe / 1_000_000).toFixed(1).replace('.', ',')}M`;
    if (safe >= 1_000) return `${Math.round(safe / 1_000)}K`;
    return `${Math.round(safe)}`;
  }
  return formatAdsCurrency(safe, currency);
}

export function formatOriginalSpendSummary(
  originalSpendByCurrency: Record<string, number> | undefined,
  reportingCurrency = 'VND',
): string | null {
  if (!originalSpendByCurrency) return null;
  const target = reportingCurrency.toUpperCase();
  const entries = Object.entries(originalSpendByCurrency)
    .filter(([code, val]) => code.toUpperCase() !== target && Number.isFinite(val) && val > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return null;
  return `Gồm ${entries.map(([code, val]) => formatAdsCurrency(val, code)).join(' + ')}`;
}

export function splitActivePages(pages: readonly AdsPageBreakdown[]): {
  active: AdsPageBreakdown[];
  inactive: AdsPageBreakdown[];
} {
  const active: AdsPageBreakdown[] = [];
  const inactive: AdsPageBreakdown[] = [];
  for (const page of pages) {
    if (page.spend > 0 || page.crmPhoneLeads > 0 || page.messagingConversations > 0) {
      active.push(page);
    } else {
      inactive.push(page);
    }
  }
  return { active, inactive };
}

export function formatMetaAccountStatus(accountStatus: number): {
  label: string;
  tone: 'good' | 'warn' | 'danger' | 'neutral';
} {
  switch (accountStatus) {
    case 1:
      return { label: 'Hoạt động', tone: 'good' };
    case 3:
      return { label: 'Nợ cước', tone: 'danger' };
    case 2:
      return { label: 'Vô hiệu hóa', tone: 'danger' };
    case 7:
      return { label: 'Chờ duyệt', tone: 'warn' };
    case 9:
      return { label: 'Gia hạn', tone: 'warn' };
    case 101:
      return { label: 'Đã đóng', tone: 'neutral' };
    default:
      return { label: 'Tạm dừng', tone: 'neutral' };
  }
}

export function formatCampaignEffectiveStatus(effectiveStatus: string): {
  label: string;
  tone: 'good' | 'warn' | 'danger' | 'neutral';
} {
  const normalized = effectiveStatus.trim().toUpperCase();
  switch (normalized) {
    case 'ACTIVE':
      return { label: 'Đang chạy', tone: 'good' };
    case 'WITH_ISSUES':
    case 'DISAPPROVED':
      return { label: 'Có lỗi', tone: 'danger' };
    case 'PENDING_REVIEW':
    case 'IN_PROCESS':
      return { label: 'Chờ duyệt', tone: 'warn' };
    case 'ARCHIVED':
      return { label: 'Lưu trữ', tone: 'neutral' };
    case 'CAMPAIGN_PAUSED':
    case 'PAUSED':
    default:
      return { label: 'Tạm dừng', tone: 'neutral' };
  }
}

export function sortAdAccountsForModal(accounts: readonly UnifiedAdAccount[]): UnifiedAdAccount[] {
  return [...accounts].sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    const aActive = a.accountStatus === 1 ? 0 : 1;
    const bActive = b.accountStatus === 1 ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    if (a.amountSpent !== b.amountSpent) return b.amountSpent - a.amountSpent;
    return a.name.localeCompare(b.name, 'vi');
  });
}

function getAdsApi() {
  return window.electronAPI?.marketingAds;
}

function getCareSnapshotApi() {
  return window.electronAPI?.customerCare;
}

function formatClock(iso: string | null | undefined): string {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  return new Date(ts).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
}

function formatFxBadge(fxRates: Record<string, number> | undefined, reportingCurrency: string): string | null {
  if (!fxRates) return null;
  const target = reportingCurrency.toUpperCase();
  const entries = Object.entries(fxRates).filter(([code, rate]) => code.toUpperCase() !== target && Number.isFinite(rate) && rate > 0);
  if (entries.length === 0) return null;
  return entries.map(([code, rate]) => `1 ${code} = ${Math.round(rate).toLocaleString('vi-VN')} đ`).join(' · ');
}

function formatAdsErrorMessage(error: string, reason?: string): string {
  if (reason && reason.trim().length > 0) return reason.trim();
  switch (error) {
    case 'auth':
      return 'Cần đăng nhập lại tài khoản để đồng bộ Quảng cáo.';
    case 'forbidden':
      return 'Vai trò hiện tại chỉ được xem số liệu, không có quyền cấu hình TKQC.';
    case 'declined':
      return 'Bạn đã đóng hoặc từ chối cấp quyền đọc Meta Ads.';
    case 'expired':
      return 'Phiên kết nối Meta Ads đã hết hạn, vui lòng kết nối lại.';
    case 'not_configured':
      return 'Server chưa bật cấu hình Meta Ads OAuth.';
    case 'unavailable':
      return 'Chưa kết nối được tới máy chủ Marketing API.';
    default:
      return 'Không tải được dữ liệu Quảng cáo Ads.';
  }
}

function normalizePageOptions(snapshot: Awaited<ReturnType<NonNullable<ReturnType<typeof getCareSnapshotApi>>['getSnapshot']>> | null, overview: AdsOverviewPayload | null): PageOption[] {
  const byId = new Map<string, string>();
  const conn = snapshot?.pageConnection;
  if (conn && conn.state === 'connected') {
    byId.set(conn.pageId, conn.pageName || `Page ${conn.pageId.slice(-6)}`);
    for (const p of conn.crmPages ?? []) {
      if (!byId.has(p.pageId)) {
        byId.set(p.pageId, p.pageName || `Page ${p.pageId.slice(-6)}`);
      }
    }
  }
  for (const p of snapshot?.crmPages ?? []) {
    if (!byId.has(p.pageId)) {
      byId.set(p.pageId, p.pageName || `Page ${p.pageId.slice(-6)}`);
    }
  }
  for (const p of overview?.pages ?? []) {
    if (!byId.has(p.pageId)) {
      byId.set(p.pageId, p.pageName || `Page ${p.pageId.slice(-6)}`);
    }
  }
  return Array.from(byId.entries())
    .map(([pageId, pageName]) => ({ pageId, pageName }))
    .sort((a, b) => a.pageName.localeCompare(b.pageName, 'vi'));
}

function mergePageOptions(prev: PageOption[], incoming: PageOption[]): PageOption[] {
  const byId = new Map<string, string>();
  const isFallback = (id: string, name: string) => name === `Page ${id.slice(-6)}`;
  for (const item of [...prev, ...incoming]) {
    const existing = byId.get(item.pageId);
    if (!existing || (isFallback(item.pageId, existing) && !isFallback(item.pageId, item.pageName))) {
      byId.set(item.pageId, item.pageName);
    }
  }
  return Array.from(byId.entries())
    .map(([pageId, pageName]) => ({ pageId, pageName }))
    .sort((a, b) => a.pageName.localeCompare(b.pageName, 'vi'));
}

function isSpendingCampaign(campaign: UnifiedAdCampaign): boolean {
  return campaign.spend > 0 || campaign.messagingConversations > 0 || campaign.impressions > 0;
}

function DualAxisDailyChart({
  daily,
  currency,
}: {
  daily: AdsOverviewPayload['daily'];
  currency: string;
}) {
  const [showSpend, setShowSpend] = useState(true);
  const [showLeads, setShowLeads] = useState(true);
  const [showMessages, setShowMessages] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const visiblePoint = useMemo(() => {
    if (daily.length === 0) return null;
    if (activeIndex !== null && daily[activeIndex]) return daily[activeIndex];
    return daily[daily.length - 1];
  }, [activeIndex, daily]);

  const maxSpend = Math.max(1, ...daily.map((d) => d.spend));
  const maxRight = Math.max(
    1,
    ...daily.map((d) => Math.max(showLeads ? d.crmPhoneLeads : 0, showMessages ? d.messagingConversations : 0)),
  );

  const chartWidth = 680;
  const chartHeight = 210;
  const padLeft = 48;
  const padRight = 38;
  const padTop = 14;
  const padBottom = 26;
  const plotW = chartWidth - padLeft - padRight;
  const plotH = chartHeight - padTop - padBottom;
  const groupW = daily.length > 0 ? plotW / daily.length : plotW;
  const gridSteps = [0, 0.25, 0.5, 0.75, 1];
  const visibleCostPerLead =
    visiblePoint && visiblePoint.spend > 0 && visiblePoint.crmPhoneLeads > 0
      ? visiblePoint.spend / visiblePoint.crmPhoneLeads
      : null;

  return (
    <section className="v2-ads__panel v2-ads__chart-panel" aria-label="Biểu đồ chi tiêu và SĐT theo ngày">
      <div className="v2-ads__panel-head">
        <div>
          <h3 className="v2-ads__panel-title">Xu hướng Chi tiêu &amp; SĐT CRM theo ngày</h3>
          {visiblePoint && (
            <p className="v2-ads__chart-readout">
              <strong>{visiblePoint.date.slice(5)}</strong>
              <span>Chi tiêu: {formatAdsCurrency(visiblePoint.spend, currency)}</span>
              <span>SĐT CRM: {visiblePoint.crmPhoneLeads}</span>
              <span>Tin nhắn: {visiblePoint.messagingConversations}</span>
              {visibleCostPerLead !== null && (
                <span>Giá/SĐT: {formatAdsMetricCost(visibleCostPerLead, currency)}</span>
              )}
            </p>
          )}
        </div>
        <div className="v2-ads__series-toggles" role="group" aria-label="Loại số liệu trên biểu đồ">
          <button
            type="button"
            className={`v2-ads__series-pill${showSpend ? ' is-active' : ''}`}
            aria-pressed={showSpend}
            onClick={() => setShowSpend((v) => !v)}
          >
            <i className="v2-ads__swatch v2-ads__swatch--spend" />
            Chi tiêu
          </button>
          <button
            type="button"
            className={`v2-ads__series-pill${showLeads ? ' is-active' : ''}`}
            aria-pressed={showLeads}
            onClick={() => setShowLeads((v) => !v)}
          >
            <i className="v2-ads__swatch v2-ads__swatch--leads" />
            SĐT CRM
          </button>
          <button
            type="button"
            className={`v2-ads__series-pill${showMessages ? ' is-active' : ''}`}
            aria-pressed={showMessages}
            onClick={() => setShowMessages((v) => !v)}
          >
            <i className="v2-ads__swatch v2-ads__swatch--msgs" />
            Tin nhắn
          </button>
        </div>
      </div>

      {daily.length === 0 ? (
        <div className="v2-ads__empty-inline">Chưa có dữ liệu theo ngày trong khoảng thời gian đã chọn.</div>
      ) : (
        <div className="v2-ads__chart-wrap">
          <svg
            className="v2-ads__chart-svg"
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
            role="img"
            aria-label="Biểu đồ cột đôi Chi tiêu Ads và SĐT thật CRM theo ngày"
          >
            {gridSteps.map((ratio) => {
              const y = padTop + plotH * (1 - ratio);
              const leftLabel = formatCompactCurrency(maxSpend * ratio, currency);
              const rightLabel = Math.round(maxRight * ratio).toString();
              return (
                <g key={ratio}>
                  <line
                    x1={padLeft}
                    y1={y}
                    x2={chartWidth - padRight}
                    y2={y}
                    className="v2-ads__gridline"
                  />
                  {ratio > 0 && (
                    <>
                      <text x={padLeft - 6} y={y + 3} textAnchor="end" className="v2-ads__axis-label">
                        {leftLabel}
                      </text>
                      <text x={chartWidth - padRight + 6} y={y + 3} textAnchor="start" className="v2-ads__axis-label">
                        {rightLabel}
                      </text>
                    </>
                  )}
                </g>
              );
            })}

            {daily.map((pt, idx) => {
              const cx = padLeft + groupW * idx + groupW / 2;
              const isSelected = activeIndex === idx;
              const barCount = (showSpend ? 1 : 0) + (showLeads ? 1 : 0) + (showMessages ? 1 : 0);
              const barW = Math.min(18, Math.max(6, Math.floor((groupW * 0.62) / Math.max(1, barCount))));
              const gap = 3;
              const totalBarsW = barCount * barW + Math.max(0, barCount - 1) * gap;
              let cursorX = cx - totalBarsW / 2;

              const spendH = showSpend ? Math.max(pt.spend > 0 ? 3 : 0, (pt.spend / maxSpend) * plotH) : 0;
              const spendX = cursorX;
              if (showSpend) cursorX += barW + gap;

              const msgH = showMessages ? Math.max(pt.messagingConversations > 0 ? 3 : 0, (pt.messagingConversations / maxRight) * plotH) : 0;
              const msgX = cursorX;
              if (showMessages) cursorX += barW + gap;

              const leadH = showLeads ? Math.max(pt.crmPhoneLeads > 0 ? 3 : 0, (pt.crmPhoneLeads / maxRight) * plotH) : 0;
              const leadX = cursorX;

              const baseY = padTop + plotH;
              const stepSkip = daily.length > 14 ? Math.ceil(daily.length / 10) : 1;
              const showTick = idx % stepSkip === 0 || idx === daily.length - 1;

              return (
                <g
                  key={pt.date}
                  className={`v2-ads__chart-day${isSelected ? ' is-selected' : ''}`}
                  tabIndex={0}
                  onMouseEnter={() => setActiveIndex(idx)}
                  onMouseLeave={() => setActiveIndex(null)}
                  onFocus={() => setActiveIndex(idx)}
                  onBlur={() => setActiveIndex(null)}
                >
                  <rect
                    x={padLeft + groupW * idx + 1}
                    y={padTop}
                    width={Math.max(4, groupW - 2)}
                    height={plotH}
                    rx={4}
                    className="v2-ads__day-hit"
                  />
                  {showSpend && (
                    <rect
                      x={spendX}
                      y={baseY - spendH}
                      width={barW}
                      height={spendH}
                      rx={3}
                      className="v2-ads__bar-spend-svg"
                    />
                  )}
                  {showMessages && (
                    <rect
                      x={msgX}
                      y={baseY - msgH}
                      width={barW}
                      height={msgH}
                      rx={3}
                      className="v2-ads__bar-msgs-svg"
                    />
                  )}
                  {showLeads && (
                    <rect
                      x={leadX}
                      y={baseY - leadH}
                      width={barW}
                      height={leadH}
                      rx={3}
                      className="v2-ads__bar-leads-svg"
                    />
                  )}
                  {showTick && (
                    <text x={cx} y={chartHeight - 6} textAnchor="middle" className="v2-ads__axis-label">
                      {pt.date.slice(5)}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </section>
  );
}

export function CustomerAdsHubPanel({ workspaceId, role }: CustomerAdsHubPanelProps) {
  const [datePreset, setDatePreset] = useState<AdsDatePreset>('last_7d');
  const [platform, setPlatform] = useState<AdsProvider | 'all'>('all');
  const [accountId, setAccountId] = useState<string>('all');
  const [pageId, setPageId] = useState<string>('all');
  const [status, setStatus] = useState<AdsStatusPayload | null>(null);
  const [overview, setOverview] = useState<AdsOverviewPayload | null>(null);
  const [pageOptions, setPageOptions] = useState<PageOption[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [connecting, setConnecting] = useState<boolean>(false);
  const [savingAccounts, setSavingAccounts] = useState<boolean>(false);
  const [savingCampaignId, setSavingCampaignId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [draftAccounts, setDraftAccounts] = useState<UnifiedAdAccount[]>([]);
  const [modalSearch, setModalSearch] = useState<string>('');
  const [modalFilter, setModalFilter] = useState<ModalAccountFilter>('all');

  const [showInactivePages, setShowInactivePages] = useState<boolean>(false);
  const [campaignSegment, setCampaignSegment] = useState<CampaignSegment>('spending');
  const [healthFilter, setHealthFilter] = useState<CampaignHealthFilter>('all');
  const [campaignSearch, setCampaignSearch] = useState<string>('');
  const [sortKey, setSortKey] = useState<CampaignSortKey>('spend');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');
  const [campaignPage, setCampaignPage] = useState<number>(1);

  const seqRef = useRef(0);
  const hasOverviewRef = useRef(false);
  const modalTriggerRef = useRef<HTMLButtonElement | null>(null);
  const canManage = role !== 'viewer' && role !== 'editor';
  const canMapCampaignPage = role !== 'viewer';

  useEffect(() => {
    hasOverviewRef.current = overview !== null;
  }, [overview]);

  useEffect(() => {
    setStatus(null);
    setOverview(null);
    setPageOptions([]);
    setAccountId('all');
    setPageId('all');
    setPlatform('all');
    setError(null);
    setNotice(null);
    setModalOpen(false);
    setShowInactivePages(false);
    setCampaignSegment('spending');
    setHealthFilter('all');
    setCampaignSearch('');
    setCampaignPage(1);
    hasOverviewRef.current = false;
  }, [workspaceId]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const loadData = useCallback(async (forceRefresh = false) => {
    const adsApi = getAdsApi();
    if (!adsApi) {
      setLoading(false);
      setError('Bản Desktop hiện tại chưa kích hoạt API Quảng cáo.');
      return;
    }
    const seq = ++seqRef.current;
    if (forceRefresh) {
      setRefreshing(true);
    } else if (!hasOverviewRef.current) {
      setLoading(true);
    }
    setError(null);

    try {
      const [statusRes, overviewRes, snapshotRes] = await Promise.all([
        adsApi.getStatus(),
        adsApi.getOverview({
          datePreset,
          platform,
          accountId: accountId === 'all' ? undefined : accountId,
          pageId: pageId === 'all' ? undefined : pageId,
          refresh: forceRefresh,
        }),
        getCareSnapshotApi()?.getSnapshot().catch(() => null) ?? Promise.resolve(null),
      ]);
      if (seq !== seqRef.current) return;

      if (statusRes.ok) {
        setStatus(statusRes.status);
      }
      if (overviewRes.ok) {
        setOverview(overviewRes.overview);
        setPageOptions((prev) => mergePageOptions(prev, normalizePageOptions(snapshotRes, overviewRes.overview)));
      } else {
        setError(formatAdsErrorMessage(overviewRes.error, overviewRes.reason));
        setPageOptions((prev) => mergePageOptions(prev, normalizePageOptions(snapshotRes, null)));
      }
    } finally {
      if (seq === seqRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [accountId, datePreset, pageId, platform]);

  useEffect(() => {
    void loadData(false);
  }, [loadData, workspaceId]);

  const handleOAuthEvent = useCallback((event: { ok: boolean; error?: string; reason?: string; adAccounts?: UnifiedAdAccount[] }) => {
    setConnecting(false);
    if (!event.ok) {
      setError(formatAdsErrorMessage(event.error ?? 'unavailable', event.reason));
      return;
    }
    setError(null);
    setNotice('Đã kết nối Meta Ads (chế độ chỉ đọc ads_read). Hãy chọn các TKQC muốn theo dõi.');
    if (Array.isArray(event.adAccounts)) {
      setDraftAccounts(sortAdAccountsForModal(event.adAccounts));
      setModalSearch('');
      setModalFilter('all');
      setModalOpen(true);
    }
    void loadData(true);
  }, [loadData]);

  useEffect(() => {
    const adsApi = getAdsApi();
    if (!adsApi) return undefined;
    void adsApi.takeOAuthEvent().then((pending) => {
      if (pending) handleOAuthEvent(pending);
    }).catch(() => undefined);
    return adsApi.onOAuthEvent((event) => {
      handleOAuthEvent(event);
    });
  }, [handleOAuthEvent, workspaceId]);

  useEffect(() => {
    if (!modalOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setModalOpen(false);
        modalTriggerRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modalOpen]);

  const closeModal = useCallback(() => {
    setModalOpen(false);
    modalTriggerRef.current?.focus();
  }, []);

  const connectMetaAds = useCallback(async () => {
    const adsApi = getAdsApi();
    if (!adsApi || !canManage) return;
    setConnecting(true);
    setError(null);
    setNotice(null);
    const res = await adsApi.connectMetaAds();
    if (!res.ok) {
      setConnecting(false);
      setError(formatAdsErrorMessage(res.error, res.reason));
      return;
    }
    setNotice('Đã mở trình duyệt Facebook để cấp quyền đọc Quảng cáo (ads_read). Hoàn tất trong trình duyệt rồi quay đây.');
  }, [canManage]);

  const openManageModal = useCallback(() => {
    const accounts = status?.providers.facebook_ads.adAccounts ?? overview?.accounts ?? [];
    setDraftAccounts(sortAdAccountsForModal(accounts));
    setModalSearch('');
    setModalFilter('all');
    setModalOpen(true);
  }, [overview?.accounts, status]);

  const saveAccountsModal = useCallback(async () => {
    const adsApi = getAdsApi();
    if (!adsApi || !canManage) return;
    setSavingAccounts(true);
    setError(null);
    const res = await adsApi.saveMetaAccounts({
      accounts: draftAccounts.map((acc) => ({
        id: acc.id,
        enabled: acc.enabled,
        defaultPageId: acc.defaultPageId,
      })),
    });
    setSavingAccounts(false);
    if (!res.ok) {
      setError(formatAdsErrorMessage(res.error, res.reason));
      return;
    }
    setStatus(res.status);
    setModalOpen(false);
    modalTriggerRef.current?.focus();
    setNotice('Đã lưu danh sách tài khoản quảng cáo và Page mặc định.');
    void loadData(true);
  }, [canManage, draftAccounts, loadData]);

  const disconnectMeta = useCallback(async () => {
    const adsApi = getAdsApi();
    if (!adsApi || !canManage) return;
    const confirmed = window.confirm('Ngắt kết nối Meta Ads khỏi workspace này? Số liệu CRM vẫn được giữ nguyên.');
    if (!confirmed) return;
    setSavingAccounts(true);
    const res = await adsApi.disconnectMetaAds();
    setSavingAccounts(false);
    if (!res.ok) {
      setError(formatAdsErrorMessage(res.error, res.reason));
      return;
    }
    setModalOpen(false);
    setNotice('Đã ngắt kết nối Meta Ads.');
    void loadData(true);
  }, [canManage, loadData]);

  const assignCampaignPage = useCallback(async (campaignId: string, nextPageId: string) => {
    const adsApi = getAdsApi();
    if (!adsApi || !canMapCampaignPage) return;
    setSavingCampaignId(campaignId);
    setError(null);
    const res = await adsApi.saveMetaAccounts({
      campaignPageMap: { [campaignId]: nextPageId || null },
    });
    setSavingCampaignId(null);
    if (!res.ok) {
      setError(formatAdsErrorMessage(res.error, res.reason));
      return;
    }
    setStatus(res.status);
    setNotice('Đã cập nhật Page đối soát cho chiến dịch.');
    void loadData(true);
  }, [canMapCampaignPage, loadData]);

  const resetAllFilters = useCallback(() => {
    setPlatform('all');
    setDatePreset('last_7d');
    setAccountId('all');
    setPageId('all');
    setCampaignSegment('spending');
    setHealthFilter('all');
    setCampaignSearch('');
    setCampaignPage(1);
  }, []);

  const metaStatus = status?.providers.facebook_ads;
  const isMetaConnected = Boolean(metaStatus?.connected || overview?.connectedProviders.includes('facebook_ads'));
  const allAccounts = useMemo(
    () => overview?.accounts ?? metaStatus?.adAccounts ?? [],
    [metaStatus?.adAccounts, overview?.accounts],
  );
  const enabledAccounts = useMemo(() => allAccounts.filter((a) => a.enabled), [allAccounts]);
  const accountOptions = useMemo(() => {
    const pool = enabledAccounts.length > 0 ? enabledAccounts : allAccounts;
    return [...pool].sort((a, b) => a.name.localeCompare(b.name, 'vi'));
  }, [allAccounts, enabledAccounts]);

  const accountCurrencyById = useMemo(
    () => new Map<string, string>(allAccounts.map((a) => [a.id, a.currency])),
    [allAccounts],
  );

  const reportingCurrency = overview?.reportingCurrency ?? 'VND';
  const fxBadge = useMemo(
    () => (overview?.hasMixedCurrencies ? formatFxBadge(overview.fxRates, reportingCurrency) : null),
    [overview?.fxRates, overview?.hasMixedCurrencies, reportingCurrency],
  );

  const blended = overview?.blended;

  const { active: activePages, inactive: inactivePages } = useMemo(
    () => splitActivePages(overview?.pages ?? []),
    [overview?.pages],
  );

  // Aggregate attributed vs unattributed CRM leads safely even if older backend payload lacks new fields.
  const leadAttribution = useMemo(() => {
    const totalCrm = blended?.crmPhoneLeads ?? 0;
    const totalMsgs = blended?.messagingConversations ?? 0;
    const totalSpend = blended?.spend ?? 0;
    const hasExplicitAttributed = blended?.attributedCrmPhoneLeads !== undefined;

    const attributedLeads = hasExplicitAttributed
      ? (blended?.attributedCrmPhoneLeads ?? 0)
      : activePages
          .filter((p) => p.spend > 0 || p.messagingConversations > 0)
          .reduce((sum, p) => sum + p.crmPhoneLeads, 0);

    const unattributedLeads = blended?.unattributedCrmPhoneLeads ?? Math.max(0, totalCrm - attributedLeads);
    const attributedCostPerLead = blended?.attributedCostPerPhoneLead !== undefined
      ? blended.attributedCostPerPhoneLead
      : (attributedLeads > 0 ? totalSpend / attributedLeads : null);
    const attributedRate = blended?.attributedPhoneCaptureRate !== undefined
      ? blended.attributedPhoneCaptureRate
      : (totalMsgs > 0 ? (attributedLeads / totalMsgs) * 100 : null);

    return {
      totalCrm,
      attributedLeads,
      unattributedLeads,
      attributedCostPerLead,
      attributedRate,
    };
  }, [activePages, blended]);

  const totalForeignSpendSummary = useMemo(() => {
    const map: Record<string, number> = {};
    for (const page of activePages) {
      if (!page.originalSpendByCurrency) continue;
      for (const [code, val] of Object.entries(page.originalSpendByCurrency)) {
        if (code.toUpperCase() === reportingCurrency.toUpperCase() || !Number.isFinite(val)) continue;
        map[code] = (map[code] ?? 0) + val;
      }
    }
    return formatOriginalSpendSummary(map, reportingCurrency);
  }, [activePages, reportingCurrency]);

  // Campaign filtering, segmentation & sorting.
  const allCampaigns = useMemo(() => overview?.campaigns ?? [], [overview?.campaigns]);
  const spendingCampaignsCount = useMemo(
    () => allCampaigns.filter(isSpendingCampaign).length,
    [allCampaigns],
  );
  const activeCampaignsCount = useMemo(
    () => allCampaigns.filter((c) => c.effectiveStatus.toUpperCase() === 'ACTIVE').length,
    [allCampaigns],
  );

  const filteredCampaigns = useMemo(() => {
    const needle = campaignSearch.trim().toLowerCase();
    const list = allCampaigns.filter((camp) => {
      if (campaignSegment === 'spending' && !isSpendingCampaign(camp)) return false;
      if (campaignSegment === 'active' && camp.effectiveStatus.toUpperCase() !== 'ACTIVE') return false;
      if (healthFilter === 'high_cost' && camp.health !== 'high_cost') return false;
      if (healthFilter === 'high_frequency' && camp.health !== 'high_frequency') return false;
      if (healthFilter === 'unmapped' && camp.pageId !== null) return false;
      if (needle) {
        const hay = `${camp.name} ${camp.adAccountName} ${camp.pageName ?? ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });

    const factor = sortDir === 'desc' ? -1 : 1;
    return [...list].sort((a, b) => {
      let aVal = 0;
      let bVal = 0;
      switch (sortKey) {
        case 'spend':
          aVal = a.spend;
          bVal = b.spend;
          break;
        case 'messaging':
          aVal = a.messagingConversations;
          bVal = b.messagingConversations;
          break;
        case 'costPerMsg':
          aVal = a.costPerMessagingConversation ?? (sortDir === 'desc' ? -1 : Number.MAX_SAFE_INTEGER);
          bVal = b.costPerMessagingConversation ?? (sortDir === 'desc' ? -1 : Number.MAX_SAFE_INTEGER);
          break;
        case 'ctr':
          aVal = a.ctr;
          bVal = b.ctr;
          break;
        case 'frequency':
          aVal = a.frequency;
          bVal = b.frequency;
          break;
      }
      if (aVal !== bVal) return (aVal - bVal) * factor;
      return a.name.localeCompare(b.name, 'vi');
    });
  }, [allCampaigns, campaignSearch, campaignSegment, healthFilter, sortDir, sortKey]);

  const totalCampaignPages = Math.max(1, Math.ceil(filteredCampaigns.length / CAMPAIGN_PAGE_SIZE));
  const safeCampaignPage = Math.min(campaignPage, totalCampaignPages);
  const pagedCampaigns = useMemo(() => {
    const start = (safeCampaignPage - 1) * CAMPAIGN_PAGE_SIZE;
    return filteredCampaigns.slice(start, start + CAMPAIGN_PAGE_SIZE);
  }, [filteredCampaigns, safeCampaignPage]);

  const campaignTotals = useMemo(() => {
    const spend = filteredCampaigns.reduce((s, c) => s + c.spend, 0);
    const impressions = filteredCampaigns.reduce((s, c) => s + c.impressions, 0);
    const clicks = filteredCampaigns.reduce((s, c) => s + c.clicks, 0);
    const messaging = filteredCampaigns.reduce((s, c) => s + c.messagingConversations, 0);
    const costPerMsg = messaging > 0 ? spend / messaging : null;
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
    const freqList = filteredCampaigns.filter((c) => c.frequency > 0);
    const avgFreq = freqList.length > 0 ? freqList.reduce((s, c) => s + c.frequency, 0) / freqList.length : 0;
    return { spend, messaging, costPerMsg, ctr, avgFreq };
  }, [filteredCampaigns]);

  const toggleSort = useCallback((key: CampaignSortKey) => {
    setCampaignPage(1);
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }, [sortKey]);

  const filteredModalAccounts = useMemo(() => {
    const needle = modalSearch.trim().toLowerCase();
    return draftAccounts.filter((acc) => {
      if (modalFilter === 'enabled' && !acc.enabled) return false;
      if (modalFilter === 'active' && acc.accountStatus !== 1) return false;
      if (needle) {
        const hay = `${acc.name} ${acc.id} ${acc.accountId} ${acc.businessName ?? ''}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }, [draftAccounts, modalFilter, modalSearch]);

  const hasNonDefaultFilters =
    platform !== 'all'
    || datePreset !== 'last_7d'
    || accountId !== 'all'
    || pageId !== 'all'
    || campaignSegment !== 'spending'
    || healthFilter !== 'all'
    || campaignSearch.trim() !== '';

  const isFuturePlatformSelected = platform === 'youtube_ads' || platform === 'tiktok_ads';

  return (
    <section className="v2-ads" aria-labelledby="v2-ads-title">
      {/* Tier 1A: Single-Line Command Header */}
      <header className="v2-ads__command-bar">
        <div className="v2-ads__command-left">
          <div className="v2-ads__title-row">
            <h2 id="v2-ads-title" className="v2-ads__title">Quảng cáo Ads &amp; Đối soát SĐT CRM</h2>
            <span className="v2-ads__meta-chip" title="Chỉ sử dụng quyền đọc ads_read, không tự sửa ngân sách hay tắt chiến dịch">
              <StatusIcon className="v2-ads__chip-icon" />
              Chỉ đọc
            </span>
            {fxBadge && (
              <span className="v2-ads__meta-chip v2-ads__meta-chip--info" title="Tỷ giá quy đổi tài khoản ngoại tệ sang VND">
                <CostIcon className="v2-ads__chip-icon" />
                {fxBadge}
              </span>
            )}
          </div>
          <p className="v2-ads__subtitle">
            Theo dõi chi phí Meta Ads, YouTube Ads, TikTok Ads và đối soát SĐT thật từ CRM trên cùng một bảng.
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
            className="v2-button v2-button--ghost v2-ads__btn"
            disabled={loading || refreshing}
            onClick={() => { void loadData(true); }}
          >
            <RefreshIcon className={`v2-ads__btn-icon${refreshing ? ' is-spinning' : ''}`} />
            {refreshing ? 'Đang tải...' : 'Làm mới'}
          </button>
          {canManage && (
            isMetaConnected ? (
              <button
                ref={modalTriggerRef}
                type="button"
                className="v2-button v2-button--primary v2-ads__btn"
                onClick={openManageModal}
              >
                <SettingsIcon className="v2-ads__btn-icon" />
                Quản lý TKQC ({enabledAccounts.length}/{allAccounts.length})
              </button>
            ) : (
              <button
                type="button"
                className="v2-button v2-button--primary v2-ads__btn"
                disabled={connecting}
                onClick={() => { void connectMetaAds(); }}
              >
                <SetupIcon className="v2-ads__btn-icon" />
                {connecting ? 'Đang chờ trình duyệt...' : 'Kết nối Facebook Ads'}
              </button>
            )
          )}
        </div>
      </header>

      {/* Tier 1B: Context Filter Strip */}
      <div className="v2-ads__filter-bar">
        <div className="v2-project-tabs v2-ads__channel-tabs" role="group" aria-label="Kênh quảng cáo">
          {CHANNEL_TABS.map((item) => {
            const metaCountText = item.id === 'facebook_ads' && enabledAccounts.length > 0 ? ` (${enabledAccounts.length})` : '';
            const isSoon = item.id === 'youtube_ads' || item.id === 'tiktok_ads';
            return (
              <button
                key={item.id}
                type="button"
                className={`v2-tab${platform === item.id ? ' is-active' : ''}`}
                aria-pressed={platform === item.id}
                onClick={() => {
                  setPlatform(item.id);
                  setCampaignPage(1);
                }}
              >
                <span>{item.label}{metaCountText}</span>
                {isSoon && <small className="v2-ads__soon-tag">Sắp mở</small>}
              </button>
            );
          })}
        </div>

        <div className="v2-ads__filter-selects">
          <label htmlFor="v2-ads-date">
            <span>Thời gian</span>
            <select
              id="v2-ads-date"
              value={datePreset}
              onChange={(e) => {
                setDatePreset(e.currentTarget.value as AdsDatePreset);
                setCampaignPage(1);
              }}
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
              onChange={(e) => {
                setAccountId(e.currentTarget.value);
                setCampaignPage(1);
              }}
            >
              <option value="all">Tất cả TKQC</option>
              {accountOptions.map((acc) => (
                <option key={acc.id} value={acc.id}>
                  {acc.name} ({acc.currency})
                </option>
              ))}
            </select>
          </label>

          <label htmlFor="v2-ads-page">
            <span>Page</span>
            <select
              id="v2-ads-page"
              value={pageId}
              onChange={(e) => {
                setPageId(e.currentTarget.value);
                setCampaignPage(1);
              }}
            >
              <option value="all">Tất cả Page</option>
              {pageOptions.map((p) => (
                <option key={p.pageId} value={p.pageId}>{p.pageName}</option>
              ))}
            </select>
          </label>

          {hasNonDefaultFilters && (
            <button type="button" className="v2-button v2-button--ghost v2-ads__reset-btn" onClick={resetAllFilters}>
              Xóa lọc
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="cmr-alert cmr-alert--error v2-ads__banner" role="alert">
          <span>{error}</span>
          <button type="button" className="v2-ads__banner-close" aria-label="Đóng thông báo lỗi" onClick={() => setError(null)}>
            <CloseIcon className="v2-ads__btn-icon" />
          </button>
        </div>
      )}

      {notice && (
        <div className="cmr-alert cmr-alert--success v2-ads__banner" role="status">
          <span>{notice}</span>
          <button type="button" className="v2-ads__banner-close" aria-label="Đóng thông báo" onClick={() => setNotice(null)}>
            <CloseIcon className="v2-ads__btn-icon" />
          </button>
        </div>
      )}

      {loading && !overview ? (
        <div className="v2-ads__skeleton" role="status" aria-busy="true">
          <div className="v2-ads__skeleton-strip" />
          <div className="v2-ads__skeleton-grid">
            <div className="v2-ads__skeleton-box" />
            <div className="v2-ads__skeleton-box" />
          </div>
          <div className="v2-ads__skeleton-table" />
          <span className="v2-ads__sr-status">Đang tải số liệu Quảng cáo...</span>
        </div>
      ) : isFuturePlatformSelected ? (
        <section className="v2-ads__panel v2-ads__future-state">
          <div className="v2-ads__future-head">
            <TrendUpIcon className="v2-ads__future-icon" />
            <div>
              <h3>{platform === 'youtube_ads' ? 'YouTube Ads (Google Ads)' : 'TikTok Ads'} đang ở trạng thái sẵn sàng</h3>
              <p>
                Cổng đọc chi phí, lượt nhấp và gán chiến dịch về CRM đã chuẩn hóa sẵn trong schema.
                Kết nối trực tiếp qua OAuth sẽ được mở khi kích hoạt nhà cung cấp trên máy chủ.
              </p>
            </div>
          </div>
          <div className="v2-ads__header-actions">
            <button type="button" className="v2-button v2-button--primary" onClick={() => setPlatform('facebook_ads')}>
              Xem Facebook Ads
            </button>
            <button type="button" className="v2-button v2-button--ghost" onClick={() => setPlatform('all')}>
              Xem tất cả kênh
            </button>
          </div>
        </section>
      ) : (
        <>
          {/* Tier 2: Executive KPI Strip (5 hairline-divided cells) */}
          <div className="v2-ads__kpi-strip" role="region" aria-label="Chỉ số tổng hợp Ads và CRM">
            <article className="v2-ads__kpi-cell">
              <span className="v2-ads__kpi-label">Tổng Chi tiêu ({reportingCurrency})</span>
              <strong className="v2-ads__kpi-value">{formatAdsCurrency(blended?.spend ?? 0, reportingCurrency)}</strong>
              <span className="v2-ads__kpi-sub">
                {(blended?.impressions ?? 0).toLocaleString('vi-VN')} hiển thị · CTR {(blended?.ctr ?? 0).toFixed(2)}%
              </span>
              {totalForeignSpendSummary && (
                <span className="v2-ads__kpi-sub v2-ads__kpi-sub--muted">{totalForeignSpendSummary}</span>
              )}
            </article>

            <article className="v2-ads__kpi-cell">
              <span className="v2-ads__kpi-label">Tin nhắn Ads &amp; Giá / Tin</span>
              <strong className="v2-ads__kpi-value">
                {(blended?.messagingConversations ?? 0).toLocaleString('vi-VN')} tin
              </strong>
              <span className="v2-ads__kpi-sub">
                Giá/Tin: {formatAdsMetricCost(blended?.costPerMessagingConversation ?? null, reportingCurrency)}
              </span>
              <span className="v2-ads__kpi-sub v2-ads__kpi-sub--muted">
                CPC {formatAdsCurrency(blended?.cpc ?? 0, reportingCurrency)}
              </span>
            </article>

            <article className="v2-ads__kpi-cell v2-ads__kpi-cell--northstar">
              <span className="v2-ads__kpi-label">SĐT đối soát Ads &amp; Giá / SĐT</span>
              <strong className="v2-ads__kpi-value">
                {leadAttribution.attributedLeads.toLocaleString('vi-VN')} SĐT
              </strong>
              <span className="v2-ads__kpi-sub">
                Giá/SĐT: {formatAdsMetricCost(leadAttribution.attributedCostPerLead, reportingCurrency)}
              </span>
              {leadAttribution.unattributedLeads > 0 && (
                <span className="v2-ads__kpi-sub v2-ads__kpi-sub--muted">
                  +{leadAttribution.unattributedLeads.toLocaleString('vi-VN')} SĐT chưa gắn Ads (Tổng CRM: {leadAttribution.totalCrm.toLocaleString('vi-VN')})
                </span>
              )}
            </article>

            <article className="v2-ads__kpi-cell">
              <span className="v2-ads__kpi-label">Tỷ lệ ra SĐT (Ads)</span>
              <strong className="v2-ads__kpi-value">
                {leadAttribution.attributedRate !== null && Number.isFinite(leadAttribution.attributedRate)
                  ? `${leadAttribution.attributedRate.toFixed(1)}%`
                  : '-'}
              </strong>
              <span className="v2-ads__kpi-sub">SĐT đối soát / Tin nhắn Ads</span>
              <span className="v2-ads__kpi-sub v2-ads__kpi-sub--muted">
                CPM {formatAdsCurrency(blended?.cpm ?? 0, reportingCurrency)}
              </span>
            </article>

            <article className="v2-ads__kpi-cell">
              <span className="v2-ads__kpi-label">Khách cọc / Chốt</span>
              <strong className="v2-ads__kpi-value">{(blended?.crmDeposits ?? 0).toLocaleString('vi-VN')} đơn</strong>
              <span className="v2-ads__kpi-sub">
                Giá/Cọc: {formatAdsMetricCost(blended?.costPerDeposit ?? null, reportingCurrency)}
              </span>
            </article>
          </div>

          {/* Tier 3: Balanced 61/39 Analytics Row (Dual-Axis Chart + Compact Active Page Reconciliation) */}
          <div className="v2-ads__analytics-row">
            <DualAxisDailyChart daily={overview?.daily ?? []} currency={reportingCurrency} />

            <section className="v2-ads__panel v2-ads__page-panel" aria-label="Đối soát theo từng Page">
              <div className="v2-ads__panel-head">
                <div>
                  <h3 className="v2-ads__panel-title">
                    Đối soát theo Page ({activePages.length})
                  </h3>
                  <p className="v2-ads__panel-hint">Bấm vào 1 Page để lọc nhanh bảng chiến dịch bên dưới.</p>
                </div>
                {pageId !== 'all' && (
                  <button
                    type="button"
                    className="v2-button v2-button--ghost v2-ads__reset-btn"
                    onClick={() => {
                      setPageId('all');
                      setCampaignPage(1);
                    }}
                  >
                    Bỏ chọn Page
                  </button>
                )}
              </div>

              {(overview?.pages.length ?? 0) === 0 ? (
                <div className="v2-ads__empty-inline">
                  Chưa có dữ liệu theo Page. Hãy gán chiến dịch vào Page ở bảng bên dưới để đối soát SĐT thật.
                </div>
              ) : (
                <>
                  <div className="v2-ads__page-table-wrap">
                    <table className="v2-ads__page-table">
                      <thead>
                        <tr>
                          <th>Page</th>
                          <th className="is-num">Chi tiêu</th>
                          <th className="is-num">Tin / SĐT</th>
                          <th className="is-num">Giá / SĐT</th>
                        </tr>
                      </thead>
                      <tbody>
                        {activePages.map((p) => {
                          const selected = pageId === p.pageId;
                          const displayName = p.pageName || `Page ${p.pageId.slice(-6)}`;
                          const foreignNote = formatOriginalSpendSummary(p.originalSpendByCurrency, reportingCurrency);
                          const noAdsAccount = p.spend === 0 && p.campaignsCount === 0 && p.crmPhoneLeads > 0;
                          const unnamed = !p.pageName;

                          return (
                            <tr
                              key={p.pageId}
                              className={selected ? 'is-selected' : undefined}
                              tabIndex={0}
                              aria-selected={selected}
                              onClick={() => {
                                setPageId(selected ? 'all' : p.pageId);
                                setCampaignPage(1);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  setPageId(selected ? 'all' : p.pageId);
                                  setCampaignPage(1);
                                }
                              }}
                            >
                              <td>
                                <div className="v2-ads__page-name-cell">
                                  <strong>{displayName}</strong>
                                  <div className="v2-ads__page-badges">
                                    <span>{p.campaignsCount} CD</span>
                                    {unnamed && <span className="v2-ads__pill v2-ads__pill--warn">Chưa đồng bộ tên</span>}
                                    {noAdsAccount && <span className="v2-ads__pill">Chưa gắn TKQC</span>}
                                  </div>
                                </div>
                              </td>
                              <td className="is-num">
                                <div className="v2-ads__metric-stack">
                                  <strong>{formatAdsCurrency(p.spend, reportingCurrency)}</strong>
                                  {foreignNote && <small>{foreignNote}</small>}
                                </div>
                              </td>
                              <td className="is-num">
                                <div className="v2-ads__metric-stack">
                                  <strong>{p.messagingConversations} tin</strong>
                                  <small>
                                    {p.crmPhoneLeads} SĐT
                                    {p.phoneCaptureRate !== null ? ` (${p.phoneCaptureRate.toFixed(1)}%)` : ''}
                                  </small>
                                </div>
                              </td>
                              <td className="is-num">
                                <strong>{p.spend > 0 ? formatAdsMetricCost(p.costPerPhoneLead, reportingCurrency) : '-'}</strong>
                              </td>
                            </tr>
                          );
                        })}

                        {showInactivePages && inactivePages.map((p) => (
                          <tr
                            key={p.pageId}
                            className={`v2-ads__page-inactive${pageId === p.pageId ? ' is-selected' : ''}`}
                            onClick={() => {
                              setPageId(pageId === p.pageId ? 'all' : p.pageId);
                              setCampaignPage(1);
                            }}
                          >
                            <td>
                              <div className="v2-ads__page-name-cell">
                                <span>{p.pageName || `Page ${p.pageId.slice(-6)}`}</span>
                                <div className="v2-ads__page-badges"><span>{p.campaignsCount} CD</span></div>
                              </div>
                            </td>
                            <td className="is-num">0 đ</td>
                            <td className="is-num">0 tin / 0 SĐT</td>
                            <td className="is-num">-</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {inactivePages.length > 0 && (
                    <button
                      type="button"
                      className="v2-ads__collapse-toggle"
                      aria-expanded={showInactivePages}
                      onClick={() => setShowInactivePages((v) => !v)}
                    >
                      {showInactivePages
                        ? `Ẩn ${inactivePages.length} Page không phát sinh`
                        : `Hiện ${inactivePages.length} Page không phát sinh`}
                    </button>
                  )}
                </>
              )}
            </section>
          </div>

          {/* Tier 4: Full-Width Actionable Campaign Performance Table */}
          <section className="v2-ads__panel v2-ads__campaigns-panel" aria-label="Bảng chiến dịch quảng cáo">
            <div className="v2-ads__table-toolbar">
              <div className="v2-ads__table-toolbar-left">
                <div className="v2-project-tabs v2-ads__segment-tabs" role="group" aria-label="Lọc theo trạng thái chi tiêu">
                  <button
                    type="button"
                    className={`v2-tab${campaignSegment === 'spending' ? ' is-active' : ''}`}
                    aria-pressed={campaignSegment === 'spending'}
                    onClick={() => {
                      setCampaignSegment('spending');
                      setCampaignPage(1);
                    }}
                  >
                    Có chi tiêu ({spendingCampaignsCount})
                  </button>
                  <button
                    type="button"
                    className={`v2-tab${campaignSegment === 'active' ? ' is-active' : ''}`}
                    aria-pressed={campaignSegment === 'active'}
                    onClick={() => {
                      setCampaignSegment('active');
                      setCampaignPage(1);
                    }}
                  >
                    Đang chạy ({activeCampaignsCount})
                  </button>
                  <button
                    type="button"
                    className={`v2-tab${campaignSegment === 'all' ? ' is-active' : ''}`}
                    aria-pressed={campaignSegment === 'all'}
                    onClick={() => {
                      setCampaignSegment('all');
                      setCampaignPage(1);
                    }}
                  >
                    Tất cả ({allCampaigns.length})
                  </button>
                </div>

                <div className="v2-ads__health-filters" role="group" aria-label="Lọc nhanh cảnh báo">
                  {(
                    [
                      ['all', 'Tất cả'],
                      ['high_cost', 'Giá cao'],
                      ['high_frequency', 'Tần suất cao'],
                      ['unmapped', 'Chưa gán Page'],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      className={`v2-ads__filter-chip${healthFilter === id ? ' is-active' : ''}`}
                      aria-pressed={healthFilter === id}
                      onClick={() => {
                        setHealthFilter(id);
                        setCampaignPage(1);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <label className="v2-ads__search-box" htmlFor="v2-ads-campaign-search">
                <ResearchIcon className="v2-ads__search-icon" />
                <input
                  id="v2-ads-campaign-search"
                  type="search"
                  placeholder="Tìm chiến dịch, TKQC..."
                  value={campaignSearch}
                  onChange={(e) => {
                    setCampaignSearch(e.currentTarget.value);
                    setCampaignPage(1);
                  }}
                />
              </label>
            </div>

            {allCampaigns.length === 0 ? (
              <div className="v2-empty">
                {isMetaConnected
                  ? 'Chưa có chiến dịch nào trong khoảng thời gian đã chọn. Hãy kiểm tra bộ lọc hoặc Quản lý TKQC.'
                  : 'Kết nối Facebook Ads để xem chiến dịch và đối soát SĐT thật từ CRM.'}
              </div>
            ) : filteredCampaigns.length === 0 ? (
              <div className="v2-ads__empty-inline">
                <span>Không có chiến dịch nào khớp bộ lọc hiện tại.</span>
                <button
                  type="button"
                  className="v2-button v2-button--ghost"
                  onClick={() => {
                    setCampaignSegment('all');
                    setHealthFilter('all');
                    setCampaignSearch('');
                  }}
                >
                  Xem tất cả ({allCampaigns.length})
                </button>
              </div>
            ) : (
              <>
                <div className="v2-ads__table-wrap">
                  <table className="v2-ads__table">
                    <thead>
                      <tr>
                        <th className="v2-ads__col-sticky">Chiến dịch</th>
                        <th>Page đối soát</th>
                        <th>Trạng thái</th>
                        <th
                          className="is-num is-sortable"
                          aria-sort={sortKey === 'spend' ? (sortDir === 'desc' ? 'descending' : 'ascending') : 'none'}
                        >
                          <button type="button" className="v2-ads__sort-btn" onClick={() => toggleSort('spend')}>
                            Chi tiêu {sortKey === 'spend' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                          </button>
                        </th>
                        <th
                          className="is-num is-sortable"
                          aria-sort={sortKey === 'messaging' ? (sortDir === 'desc' ? 'descending' : 'ascending') : 'none'}
                        >
                          <button type="button" className="v2-ads__sort-btn" onClick={() => toggleSort('messaging')}>
                            Tin nhắn {sortKey === 'messaging' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                          </button>
                        </th>
                        <th
                          className="is-num is-sortable"
                          aria-sort={sortKey === 'costPerMsg' ? (sortDir === 'desc' ? 'descending' : 'ascending') : 'none'}
                        >
                          <button type="button" className="v2-ads__sort-btn" onClick={() => toggleSort('costPerMsg')}>
                            Giá / Tin {sortKey === 'costPerMsg' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                          </button>
                        </th>
                        <th
                          className="is-num is-sortable"
                          aria-sort={sortKey === 'ctr' ? (sortDir === 'desc' ? 'descending' : 'ascending') : 'none'}
                        >
                          <button type="button" className="v2-ads__sort-btn" onClick={() => toggleSort('ctr')}>
                            CTR {sortKey === 'ctr' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                          </button>
                        </th>
                        <th
                          className="is-num is-sortable"
                          aria-sort={sortKey === 'frequency' ? (sortDir === 'desc' ? 'descending' : 'ascending') : 'none'}
                        >
                          <button type="button" className="v2-ads__sort-btn" onClick={() => toggleSort('frequency')}>
                            Tần suất {sortKey === 'frequency' ? (sortDir === 'desc' ? '↓' : '↑') : ''}
                          </button>
                        </th>
                        <th>Sức khỏe</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedCampaigns.map((camp) => {
                        const health = ADS_HEALTH_META[camp.health];
                        const statusMeta = formatCampaignEffectiveStatus(camp.effectiveStatus);
                        const campOriginCurrency = camp.currency ?? accountCurrencyById.get(camp.adAccountId) ?? reportingCurrency;
                        const isForeignCurrency = campOriginCurrency.toUpperCase() !== reportingCurrency.toUpperCase();
                        const showNativeSpend = isForeignCurrency && (camp.originalSpend ?? 0) > 0;
                        const showNativeCost =
                          isForeignCurrency
                          && camp.originalCostPerMessagingConversation !== undefined
                          && camp.originalCostPerMessagingConversation !== null;

                        return (
                          <tr key={camp.id}>
                            <td className="v2-ads__col-sticky">
                              <div className="v2-ads__camp-name">
                                <strong title={camp.name}>{camp.name}</strong>
                                <small>
                                  {camp.adAccountName} ({campOriginCurrency})
                                </small>
                              </div>
                            </td>
                            <td>
                              <select
                                className="v2-ads__table-select"
                                aria-label={`Gán Page cho ${camp.name}`}
                                value={camp.pageId ?? ''}
                                disabled={!canMapCampaignPage || savingCampaignId === camp.id}
                                onChange={(e) => { void assignCampaignPage(camp.id, e.currentTarget.value); }}
                              >
                                <option value="">Chưa gán Page</option>
                                {pageOptions.map((p) => (
                                  <option key={p.pageId} value={p.pageId}>{p.pageName}</option>
                                ))}
                              </select>
                            </td>
                            <td>
                              <span className={`v2-ads__pill v2-ads__pill--${statusMeta.tone}`}>
                                {statusMeta.label}
                              </span>
                            </td>
                            <td className="is-num">
                              <div className="v2-ads__metric-stack">
                                <strong>{formatAdsCurrency(camp.spend, reportingCurrency)}</strong>
                                {showNativeSpend && (
                                  <small>{formatAdsCurrency(camp.originalSpend!, campOriginCurrency)}</small>
                                )}
                              </div>
                            </td>
                            <td className="is-num">{camp.messagingConversations.toLocaleString('vi-VN')}</td>
                            <td className="is-num">
                              <div className="v2-ads__metric-stack">
                                <span>{formatAdsMetricCost(camp.costPerMessagingConversation, reportingCurrency)}</span>
                                {showNativeCost && (
                                  <small>{formatAdsMetricCost(camp.originalCostPerMessagingConversation!, campOriginCurrency)}</small>
                                )}
                              </div>
                            </td>
                            <td className="is-num">{camp.ctr.toFixed(2)}%</td>
                            <td className="is-num">{camp.frequency.toFixed(2)}</td>
                            <td>
                              <span className={`v2-ads__pill ${health.tone !== 'neutral' ? `v2-ads__pill--${health.tone}` : ''}`}>
                                {health.label}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td className="v2-ads__col-sticky">
                          <strong>Tổng ({filteredCampaigns.length} chiến dịch)</strong>
                        </td>
                        <td colSpan={2} />
                        <td className="is-num">
                          <strong>{formatAdsCurrency(campaignTotals.spend, reportingCurrency)}</strong>
                        </td>
                        <td className="is-num">
                          <strong>{campaignTotals.messaging.toLocaleString('vi-VN')}</strong>
                        </td>
                        <td className="is-num">
                          <strong>{formatAdsMetricCost(campaignTotals.costPerMsg, reportingCurrency)}</strong>
                        </td>
                        <td className="is-num">
                          <strong>{campaignTotals.ctr.toFixed(2)}%</strong>
                        </td>
                        <td className="is-num">
                          <strong>{campaignTotals.avgFreq.toFixed(2)}</strong>
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>

                {totalCampaignPages > 1 && (
                  <div className="v2-ads__pagination">
                    <span>
                      Hiển thị {(safeCampaignPage - 1) * CAMPAIGN_PAGE_SIZE + 1}-
                      {Math.min(safeCampaignPage * CAMPAIGN_PAGE_SIZE, filteredCampaigns.length)} / {filteredCampaigns.length}
                    </span>
                    <div className="v2-ads__header-actions">
                      <button
                        type="button"
                        className="v2-button v2-button--ghost"
                        disabled={safeCampaignPage <= 1}
                        onClick={() => setCampaignPage((p) => Math.max(1, p - 1))}
                      >
                        Trước
                      </button>
                      <span>Trang {safeCampaignPage} / {totalCampaignPages}</span>
                      <button
                        type="button"
                        className="v2-button v2-button--ghost"
                        disabled={safeCampaignPage >= totalCampaignPages}
                        onClick={() => setCampaignPage((p) => Math.min(totalCampaignPages, p + 1))}
                      >
                        Sau
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </>
      )}

      {modalOpen && (
        <div
          className="v2-ads__modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="v2-ads-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModal();
          }}
        >
          <div className="v2-ads__modal">
            <div className="v2-ads__modal-head">
              <div>
                <h3 id="v2-ads-modal-title">Chọn Tài khoản quảng cáo Meta (ads_read)</h3>
                <p className="v2-ads__subtitle">
                  Tích chọn các TKQC muốn theo dõi và gắn Page mặc định để đối soát SĐT từ CRM.
                </p>
              </div>
              <button
                type="button"
                className="v2-button v2-button--ghost v2-ads__modal-close"
                aria-label="Đóng hộp thoại"
                onClick={closeModal}
              >
                <CloseIcon className="v2-ads__btn-icon" />
                Đóng
              </button>
            </div>

            <div className="v2-ads__modal-controls">
              <label className="v2-ads__search-box" htmlFor="v2-ads-modal-search">
                <ResearchIcon className="v2-ads__search-icon" />
                <input
                  id="v2-ads-modal-search"
                  type="search"
                  placeholder="Tìm tên TKQC, act_ID, Business..."
                  value={modalSearch}
                  onChange={(e) => setModalSearch(e.currentTarget.value)}
                />
              </label>

              <div className="v2-ads__health-filters" role="group" aria-label="Lọc tài khoản trong hộp thoại">
                <button
                  type="button"
                  className={`v2-ads__filter-chip${modalFilter === 'all' ? ' is-active' : ''}`}
                  aria-pressed={modalFilter === 'all'}
                  onClick={() => setModalFilter('all')}
                >
                  Tất cả ({draftAccounts.length})
                </button>
                <button
                  type="button"
                  className={`v2-ads__filter-chip${modalFilter === 'enabled' ? ' is-active' : ''}`}
                  aria-pressed={modalFilter === 'enabled'}
                  onClick={() => setModalFilter('enabled')}
                >
                  Đang bật ({draftAccounts.filter((a) => a.enabled).length})
                </button>
                <button
                  type="button"
                  className={`v2-ads__filter-chip${modalFilter === 'active' ? ' is-active' : ''}`}
                  aria-pressed={modalFilter === 'active'}
                  onClick={() => setModalFilter('active')}
                >
                  Hoạt động ({draftAccounts.filter((a) => a.accountStatus === 1).length})
                </button>
              </div>
            </div>

            <ul className="v2-ads__modal-list">
              {filteredModalAccounts.length === 0 ? (
                <li className="v2-ads__modal-item v2-ads__modal-item--empty">
                  Không tìm thấy tài khoản quảng cáo phù hợp.
                </li>
              ) : (
                filteredModalAccounts.map((acc) => {
                  const statusInfo = formatMetaAccountStatus(acc.accountStatus);
                  return (
                    <li key={acc.id} className={`v2-ads__modal-item${acc.enabled ? ' is-enabled' : ''}`}>
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
                        <div className="v2-ads__modal-acc-info">
                          <div className="v2-ads__modal-acc-title">
                            <strong>{acc.name}</strong>
                            <span className="v2-ads__pill">{acc.currency}</span>
                            <span className={`v2-ads__pill v2-ads__pill--${statusInfo.tone}`}>{statusInfo.label}</span>
                          </div>
                          <small>
                            {acc.id}
                            {acc.businessName ? ` · ${acc.businessName}` : ''}
                            {acc.amountSpent > 0 ? ` · Lũy kế ${formatAdsCurrency(acc.amountSpent, acc.currency)}` : ''}
                          </small>
                        </div>
                      </label>
                      <select
                        className="v2-ads__modal-select"
                        aria-label={`Page mặc định cho ${acc.name}`}
                        value={acc.defaultPageId ?? ''}
                        onChange={(e) => {
                          const defaultPageId = e.currentTarget.value || null;
                          setDraftAccounts((prev) =>
                            prev.map((item) => (item.id === acc.id ? { ...item, defaultPageId } : item)),
                          );
                        }}
                      >
                        <option value="">Chọn Page mặc định</option>
                        {pageOptions.map((p) => (
                          <option key={p.pageId} value={p.pageId}>{p.pageName}</option>
                        ))}
                      </select>
                    </li>
                  );
                })
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
                <button type="button" className="v2-button v2-button--ghost" onClick={closeModal}>
                  Huỷ
                </button>
                <button
                  type="button"
                  className="v2-button v2-button--primary"
                  disabled={savingAccounts || !canManage}
                  onClick={() => { void saveAccountsModal(); }}
                >
                  {savingAccounts ? 'Đang lưu...' : 'Lưu cấu hình TKQC'}
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
