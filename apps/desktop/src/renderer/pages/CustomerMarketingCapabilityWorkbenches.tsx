import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import {
  ContentIcon,
  DesignIcon,
  PlanningIcon,
  RefreshIcon,
  ReviewIcon,
  SettingsIcon,
  SparkIcon,
  StatusIcon,
  TrendUpIcon,
} from '../components/AppIcons';
import type {
  CustomerBrandProfile,
  CustomerChannel,
  CustomerMarketingAnalyticsReport,
  CustomerMarketingAnalyticsResult,
  CustomerMarketingAnalyticsWindow,
  CustomerMarketingAssetResource,
  CustomerMarketingBridgeStatus,
  CustomerMarketingContentResource,
  CustomerMarketingSnapshot,
  CustomerMarketingWorkflowRecord,
  CustomerMarketingWorkflowSource,
  CustomerMarketingWorkflowTarget,
  CustomerOnboardingInput,
  CustomerRole,
} from '../../shared/customer-marketing-types';
import type {
  CustomerMarketingPageSpeedMetric,
  CustomerMarketingPageSpeedReport,
  CustomerMarketingPageSpeedResult,
  CustomerMarketingPageSpeedStrategy,
} from '../../shared/customer-marketing-pagespeed';
import type { CustomerCapabilityWorkbenchId } from './customer-capability-actions';

export type CapabilityWorkbenchOpenView =
  | 'assets'
  | 'content'
  | 'campaigns'
  | 'director'
  | 'approvals'
  | 'brand';

interface CapabilityWorkbenchProps {
  id: CustomerCapabilityWorkbenchId;
  snapshot: CustomerMarketingSnapshot;
  form: CustomerOnboardingInput;
  onBack: () => void;
  onOpen: (view: CapabilityWorkbenchOpenView) => void;
  onDirector: (goal: string) => Promise<boolean | void>;
}

const BRIDGE_LABELS: Record<CustomerMarketingBridgeStatus, string> = {
  synced: 'Dữ liệu workspace đã xác thực',
  local: 'Chỉ chế độ local',
  forbidden: 'Cần quyền truy cập',
  not_found: 'Không tìm thấy workspace',
  conflict: 'Cần tải lại',
  quota_exceeded: 'Workspace đã hết quota',
  unavailable: 'Bridge chưa sẵn sàng',
};
const CREATIVE_CHANNELS: CustomerChannel[] = [
  'facebook', 'tiktok', 'youtube', 'website', 'telegram', 'x', 'seo',
];
const CHANNEL_LABELS: Record<CustomerChannel, string> = {
  facebook: 'Facebook',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  youtube: 'YouTube',
  website: 'Website',
  email: 'Email',
  crm: 'CRM',
  ads: 'Quảng cáo',
  telegram: 'Telegram',
  x: 'X (Twitter)',
  seo: 'SEO',
};
function channelLabel(channel: string): string {
  return (CHANNEL_LABELS as Record<string, string>)[channel] ?? channel;
}
const CREATIVE_FORMATS = [
  'Short video', 'Social post', 'Carousel', 'Landing page', 'Email sequence',
] as const;
const CREATIVE_FORMAT_LABELS: Record<(typeof CREATIVE_FORMATS)[number], string> = {
  'Short video': 'Video ngắn',
  'Social post': 'Bài đăng mạng xã hội',
  Carousel: 'Carousel',
  'Landing page': 'Landing page',
  'Email sequence': 'Chuỗi email',
};
const ANALYTICS_KIND_KEYS = ['campaign', 'content', 'asset', 'knowledge'] as const;
const ANALYTICS_STATUS_KEYS = ['draft', 'inReview', 'approved', 'rejected', 'archived'] as const;
const ANALYTICS_KIND_LABELS = {
  campaign: 'Chiến dịch',
  content: 'Nội dung',
  asset: 'Tài sản',
  knowledge: 'Kiến thức',
} as const;
const ANALYTICS_STATUS_LABELS = {
  draft: 'Nháp',
  inReview: 'Đang duyệt',
  approved: 'Đã duyệt',
  rejected: 'Bị từ chối',
  archived: 'Đã lưu trữ',
} as const;
/** Vietnamese labels for raw status tokens shown in workbench pills (defect F). */
const PILL_LABELS: Record<string, string> = {
  synced: 'Đã đồng bộ', local: 'Local', forbidden: 'Không có quyền', not_found: 'Không tìm thấy',
  conflict: 'Xung đột', quota_exceeded: 'Hết quota', unavailable: 'Chưa sẵn sàng',
  approved: 'Đã duyệt', ready: 'Sẵn sàng', pass: 'Đạt', available: 'Khả dụng', good: 'Tốt',
  blocked: 'Bị chặn', rejected: 'Bị từ chối', error: 'Lỗi', poor: 'Kém', pending: 'Đang chờ',
  warning: 'Cảnh báo', draft: 'Nháp', in_review: 'Đang duyệt', inReview: 'Đang duyệt',
  'needs-improvement': 'Cần cải thiện', archived: 'Đã lưu trữ', scheduled: 'Đã lên lịch',
  published: 'Đã đăng', active: 'Đang hoạt động', expired: 'Đã hết hạn', registered: 'Đã đăng ký',
  processing: 'Đang xử lý',
};
function pillLabel(value: string): string {
  return PILL_LABELS[value] ?? value.replace(/[_-]+/g, ' ');
}

function customerApi(): ElectronCustomerMarketingApi | null {
  return window.electronAPI?.customerMarketing ?? null;
}
function bridgeMessage(status: CustomerMarketingBridgeStatus): string {
  return BRIDGE_LABELS[status];
}
function roleCanEdit(role: CustomerRole): boolean {
  return role === 'owner' || role === 'manager' || role === 'editor';
}
function roleCanReview(role: CustomerRole): boolean {
  return role === 'owner' || role === 'manager' || role === 'reviewer';
}
function formatCount(value: number): string {
  return new Intl.NumberFormat('vi-VN').format(value);
}
function formatDate(value: string | null | undefined, includeTime = false): string {
  if (!value) return 'Chưa ghi nhận';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Chưa ghi nhận';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
}
function statusTone(value: string): 'positive' | 'warning' | 'negative' | 'neutral' {
  if (['synced', 'approved', 'ready', 'pass', 'available', 'good'].includes(value)) return 'positive';
  if (['forbidden', 'blocked', 'rejected', 'unavailable', 'error', 'poor'].includes(value)) return 'negative';
  if (
    ['pending', 'local', 'warning', 'draft', 'in_review', 'conflict', 'needs-improvement']
      .includes(value)
  ) return 'warning';
  return 'neutral';
}
function WorkbenchPill({ value, label }: { value: string; label?: string }) {
  return (
    <span className={`cmr-pill cmr-pill--${statusTone(value)}`}>
      <span className="cmr-pill__dot" />
      {label ?? pillLabel(value)}
    </span>
  );
}
function WorkbenchEmpty({
  icon: Icon,
  title,
  description,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="cmr-empty cmr-empty--compact">
      <Icon className="cmr-empty__icon" />
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  );
}
function WorkbenchField({
  label,
  value,
  onChange,
  placeholder,
  multiline = false,
  type = 'text',
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  type?: 'text' | 'date';
  disabled?: boolean;
}) {
  return (
    <label className="cmr-field">
      <span className="cmr-field__label">{label}</span>
      {multiline ? (
        <textarea
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      ) : (
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      )}
    </label>
  );
}
function WorkbenchHeader({
  eyebrow,
  title,
  description,
  icon: Icon,
  onBack,
}: {
  eyebrow: string;
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  onBack: () => void;
}) {
  return (
    <div className="cmr-workbench-header">
      <div className="cmr-workbench-header__copy">
        <span className="cmr-eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <div className="cmr-workbench-header__actions">
        <Icon className="cmr-workbench-header__icon" />
        <button type="button" className="cmr-text-button" onClick={onBack}>
          Quay lại Apps
        </button>
      </div>
    </div>
  );
}

const PAGESPEED_LAB_METRICS = [
  ['LCP', 'lcp'],
  ['CLS', 'cls'],
  ['TBT', 'tbt'],
  ['FCP', 'fcp'],
  ['Speed Index', 'speedIndex'],
  ['Server response', 'serverResponse'],
] as const;
const PAGESPEED_FIELD_METRICS = [
  ['LCP', 'lcp'],
  ['CLS', 'cls'],
  ['INP', 'inp'],
  ['TTFB', 'ttfb'],
] as const;
const PAGESPEED_STRATEGIES: CustomerMarketingPageSpeedStrategy[] = ['mobile', 'desktop'];

export function pageSpeedStrategyForKey(
  current: CustomerMarketingPageSpeedStrategy,
  key: string,
): CustomerMarketingPageSpeedStrategy | null {
  const index = PAGESPEED_STRATEGIES.indexOf(current);
  if (key === 'Home') return PAGESPEED_STRATEGIES[0];
  if (key === 'End') return PAGESPEED_STRATEGIES[PAGESPEED_STRATEGIES.length - 1];
  if (key === 'ArrowRight' || key === 'ArrowDown') {
    return PAGESPEED_STRATEGIES[(index + 1) % PAGESPEED_STRATEGIES.length];
  }
  if (key === 'ArrowLeft' || key === 'ArrowUp') {
    return PAGESPEED_STRATEGIES[(index - 1 + PAGESPEED_STRATEGIES.length)
      % PAGESPEED_STRATEGIES.length];
  }
  return null;
}

export function pageSpeedReportAfterResult(
  current: CustomerMarketingPageSpeedReport | null,
  result: CustomerMarketingPageSpeedResult,
): CustomerMarketingPageSpeedReport | null {
  return result.ok ? result : current;
}

function pageSpeedScoreTone(score: number | null): 'positive' | 'warning' | 'negative' | 'neutral' {
  if (score === null) return 'neutral';
  if (score >= 90) return 'positive';
  if (score >= 50) return 'warning';
  return 'negative';
}

function PageSpeedMetricCell({
  label,
  metric,
}: {
  label: string;
  metric: CustomerMarketingPageSpeedMetric;
}) {
  return (
    <div className={`cmr-pagespeed-metric cmr-pagespeed-metric--${metric.rating}`}>
      <span>{label}</span>
      <strong>{metric.display}</strong>
      <small>{pillLabel(metric.rating)}</small>
    </div>
  );
}

export function PageSpeedReportView({ report }: { report: CustomerMarketingPageSpeedReport }) {
  return (
    <>
      <section className="cmr-panel cmr-workbench-panel cmr-pagespeed-result" aria-label="Kết quả PageSpeed trong lab">
        <div className="cmr-section-heading">
          <div>
            <span className="cmr-eyebrow">Lab / Lighthouse</span>
            <h3>Kết quả hiệu năng</h3>
          </div>
          <div className={`cmr-pagespeed-score cmr-pagespeed-score--${pageSpeedScoreTone(report.performanceScore)}`}>
            <strong>{report.performanceScore ?? '--'}</strong>
            <span>/ 100</span>
          </div>
        </div>
        <div className="cmr-pagespeed-meta">
          <span>{report.strategy === 'mobile' ? 'Mobile' : 'Desktop'}</span>
          <span>{formatDate(report.measuredAt, true)}</span>
        </div>
        <div className="cmr-pagespeed-provenance">
          <div>
            <span>URL gửi tới Google</span>
            <strong>{report.url}</strong>
          </div>
          <div>
            <span>URL Lighthouse nhận</span>
            <strong>{report.lighthouseRequestedUrl}</strong>
          </div>
          <div>
            <span>URL cuối Lighthouse</span>
            <strong>{report.finalUrl}</strong>
          </div>
        </div>
        <div className="cmr-pagespeed-metrics">
          {PAGESPEED_LAB_METRICS.map(([label, key]) => {
            const metric = report.lab[key];
            return metric ? <PageSpeedMetricCell key={key} label={label} metric={metric} /> : null;
          })}
        </div>
      </section>

      <section className="cmr-panel cmr-workbench-panel" aria-label="Kết quả trải nghiệm người dùng Chrome">
        <div className="cmr-section-heading">
          <div>
            <span className="cmr-eyebrow">Field / CrUX</span>
            <h3>Dữ liệu người dùng thật</h3>
          </div>
          {report.field && (
            <div className="cmr-pagespeed-field-status">
              <WorkbenchPill value={report.field.overall} />
              <span>{report.field.scope === 'origin' ? 'Phạm vi origin' : 'Phạm vi URL'}</span>
            </div>
          )}
        </div>
        {report.field ? (
          <>
            {report.field.scope === 'origin' && (
              <p className="cmr-workbench-note cmr-pagespeed-origin-note">
                URL này chưa đủ mẫu riêng; Google đã trả dữ liệu tổng hợp ở cấp origin.
              </p>
            )}
            <div className="cmr-pagespeed-provenance cmr-pagespeed-provenance--field">
              <div>
                <span>Phạm vi dữ liệu</span>
                <strong>{report.field.scope === 'origin' ? 'Origin tổng hợp' : 'URL cụ thể'}</strong>
              </div>
              <div>
                <span>URL CrUX yêu cầu</span>
                <strong>{report.field.initialUrl}</strong>
              </div>
              <div>
                <span>Dataset CrUX</span>
                <strong>{report.field.id}</strong>
              </div>
            </div>
            <div className="cmr-pagespeed-metrics cmr-pagespeed-metrics--field">
              {PAGESPEED_FIELD_METRICS.map(([label, key]) => {
                const metric = report.field?.[key];
                return metric ? <PageSpeedMetricCell key={key} label={label} metric={metric} /> : null;
              })}
            </div>
          </>
        ) : (
          <WorkbenchEmpty
            icon={TrendUpIcon}
            title="Chưa có dữ liệu CrUX"
            description="Google chưa có đủ dữ liệu người dùng thật cho URL này. Kết quả Lighthouse phía trên vẫn dùng được."
          />
        )}
      </section>
    </>
  );
}

function SeoPageSpeedView({
  form,
  role,
  onBack,
}: {
  form: CustomerOnboardingInput;
  role: CustomerRole;
  onBack: () => void;
}) {
  const [url, setUrl] = useState(form.business.website);
  const [strategy, setStrategy] = useState<CustomerMarketingPageSpeedStrategy>('mobile');
  const [report, setReport] = useState<CustomerMarketingPageSpeedReport | null>(null);
  const [message, setMessage] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [busy, setBusy] = useState(false);
  const canExecute = roleCanEdit(role);

  const changeStrategyFromKeyboard = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = pageSpeedStrategyForKey(strategy, event.key);
    if (!next) return;
    event.preventDefault();
    setStrategy(next);
    event.currentTarget.parentElement
      ?.querySelector<HTMLButtonElement>(`[data-pagespeed-strategy="${next}"]`)
      ?.focus();
  };

  const measure = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canExecute || busy) return;
    const normalizedUrl = url.trim();
    if (!normalizedUrl) {
      setMessage('Nhập URL công khai cần đo.');
      setAnnouncement('');
      return;
    }
    const api = customerApi();
    if (!api) {
      setMessage('PageSpeed chưa sẵn sàng trong phiên này.');
      setAnnouncement('');
      return;
    }
    setBusy(true);
    setMessage('');
    setAnnouncement('');
    try {
      const next = await api.measurePageSpeed({ url: normalizedUrl, strategy });
      setReport((current) => pageSpeedReportAfterResult(current, next));
      if (next.ok) {
        setAnnouncement(
          `Đã hoàn tất phép đo ${next.strategy === 'mobile' ? 'Mobile' : 'Desktop'} lúc ${formatDate(next.measuredAt, true)}.`,
        );
      } else {
        setMessage(next.error);
      }
    } catch {
      setMessage('Không thể hoàn tất phép đo PageSpeed lúc này.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cmr-view-stack cmr-workbench">
      <WorkbenchHeader
        eyebrow="SEO Workspace / Kiểm tra chỉ đọc"
        title="Google PageSpeed"
        description="Đo Lighthouse lab data và Core Web Vitals thực tế mà không thay đổi website hay tạo hành động bên ngoài."
        icon={TrendUpIcon}
        onBack={onBack}
      />
      <form className="cmr-panel cmr-workbench-panel cmr-pagespeed-form" onSubmit={measure}>
        <div className="cmr-section-heading">
          <div>
            <span className="cmr-eyebrow">01 / Mục tiêu kiểm tra</span>
            <h3>Trang cần kiểm tra</h3>
          </div>
          <WorkbenchPill value="available" label="Chỉ đọc" />
        </div>
        <div className="cmr-pagespeed-controls">
          <WorkbenchField
            label="URL công khai"
            value={url}
            onChange={setUrl}
            placeholder="https://izziapi.com"
            disabled={busy || !canExecute}
          />
          <fieldset className="cmr-pagespeed-strategy">
            <legend>Thiết bị</legend>
            <div role="radiogroup" aria-label="Chiến lược PageSpeed">
              {PAGESPEED_STRATEGIES.map((value) => (
                <button
                  type="button"
                  key={value}
                  role="radio"
                  data-pagespeed-strategy={value}
                  className={strategy === value ? 'is-active' : ''}
                  aria-checked={strategy === value}
                  tabIndex={strategy === value ? 0 : -1}
                  disabled={busy || !canExecute}
                  onClick={() => setStrategy(value)}
                  onKeyDown={changeStrategyFromKeyboard}
                >
                  {value === 'mobile' ? 'Mobile' : 'Desktop'}
                </button>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="cmr-pagespeed-disclosure">
          <StatusIcon className="cmr-icon" />
          <p>URL công khai sẽ được gửi tới Google PageSpeed để chạy phép đo theo yêu cầu. Không gửi cookie, credential hay dữ liệu workspace.</p>
        </div>
        <div className="cmr-workbench-form__footer">
          <span className="cmr-workbench-note">Chỉ chạy khi bạn bấm nút. Kết quả không tự động xuất hiện trong chiến dịch.</span>
          <button
            type="submit"
            className="cmr-button cmr-button--primary"
            disabled={busy || !canExecute || !url.trim()}
          >
            {busy ? 'Đang đo...' : 'Đo tốc độ'} <TrendUpIcon className="cmr-button__icon" />
          </button>
        </div>
        {!canExecute && (
          <p className="cmr-permission-note">Vai trò hiện tại chỉ được xem và không thể chạy phép đo mới.</p>
        )}
      </form>
      <div
        className="cmr-pagespeed-live"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-busy={busy}
      >
        {busy && (
          <div className="cmr-workbench-skeleton">
            <span /><span /><span />
          </div>
        )}
        {!busy && message && <p className="cmr-pagespeed-error">{message}</p>}
        {!busy && announcement && <p className="cmr-pagespeed-success">{announcement}</p>}
      </div>
      {report && <PageSpeedReportView report={report} />}
    </div>
  );
}

export interface CreativeBriefDraft {
  title: string;
  concept: string;
  audience: string;
  channel: string;
  format: string;
  cta: string;
}
export function buildCreativeBriefBody(
  brief: CreativeBriefDraft,
  form: CustomerOnboardingInput,
): string {
  const audience =
    brief.audience.trim() || form.audience.segments.trim() || 'Not specified';
  return [
    'CREATIVE BRIEF',
    `Concept: ${brief.concept.trim()}`,
    `Format: ${brief.format}`,
    `Channel: ${brief.channel}`,
    `Audience: ${audience}`,
    `CTA: ${brief.cta.trim() || 'Not specified'}`,
    `Brand tone: ${form.brand.tone.trim() || 'Use Brand Center'}`,
    `Brand guideline: ${form.brand.guidelines.trim() || 'Use Brand Center'}`,
  ].join('\n');
}
function initialCreativeBrief(form: CustomerOnboardingInput): CreativeBriefDraft {
  return {
    title: '',
    concept: '',
    audience: form.audience.segments,
    channel: form.channels[0] ?? 'website',
    format: CREATIVE_FORMATS[0],
    cta: '',
  };
}

function CreativeStudioView({
  form,
  role,
  onBack,
  onOpen,
}: {
  form: CustomerOnboardingInput;
  role: CustomerRole;
  onBack: () => void;
  onOpen: (view: CapabilityWorkbenchOpenView) => void;
}) {
  const [brief, setBrief] = useState<CreativeBriefDraft>(() => initialCreativeBrief(form));
  const [assets, setAssets] = useState<CustomerMarketingAssetResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<CustomerMarketingBridgeStatus>('unavailable');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const canEdit = roleCanEdit(role);

  const loadAssets = useCallback(async () => {
    const api = customerApi();
    if (!api) {
      setStatus('unavailable');
      setError('Creative Studio cần chạy trong Izzi AI Desktop.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await api.listMarketingResources('asset');
      setStatus(result.status);
      if (!result.ok) {
        setAssets([]);
        setError(result.error || bridgeMessage(result.status));
        return;
      }
      setAssets(result.resources.filter(
        (resource): resource is CustomerMarketingAssetResource =>
          resource.kind === 'asset',
      ));
    } catch (reason) {
      setStatus('unavailable');
      setError(reason instanceof Error ? reason.message : bridgeMessage('unavailable'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  const updateBrief = <Key extends keyof CreativeBriefDraft>(
    key: Key,
    value: CreativeBriefDraft[Key],
  ) => setBrief((current) => ({ ...current, [key]: value }));

  const createBrief = async (event: FormEvent) => {
    event.preventDefault();
    const api = customerApi();
    if (!api || !canEdit) return;
    if (!brief.title.trim() || !brief.concept.trim()) {
      setError('Cần nhập tiêu đề và ý tưởng cốt lõi cho brief.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api.createMarketingResource({
        kind: 'content',
        title: brief.title.trim(),
        body: buildCreativeBriefBody(brief, form),
        channel: brief.channel,
        scheduledAt: null,
        campaignId: null,
        metadata: {
          workflow: 'creative-studio',
          format: brief.format,
          audience:
            brief.audience.trim() || form.audience.segments.trim() || 'unknown',
        },
      });
      setStatus(result.status);
      if (!result.ok || !result.resource) {
        setError(result.error || bridgeMessage(result.status));
        return;
      }
      setNotice(result.duplicate
        ? 'Brief này đã tồn tại; không tạo bản trùng.'
        : 'Đã lưu thành nội dung nháp. Lên lịch và đăng bài vẫn là bước riêng.');
      setBrief(initialCreativeBrief(form));
    } catch (reason) {
      setStatus('unavailable');
      setError(reason instanceof Error ? reason.message : bridgeMessage('unavailable'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cmr-view-stack cmr-workbench">
      <WorkbenchHeader
        eyebrow="Sản xuất sáng tạo"
        title="Creative Studio"
        description="Biến ý tưởng do bạn viết thành brief nội dung và liên kết với tài sản đã đăng ký trong workspace."
        icon={DesignIcon}
        onBack={onBack}
      />
      <div className="cmr-workbench-status">
        <span>
          <span className="cmr-workbench-status__dot" />
          {loading ? 'Đang tải tài sản đã đăng ký...' : bridgeMessage(status)}
        </span>
        <button
          type="button"
          className="cmr-icon-button"
          onClick={() => void loadAssets()}
          disabled={loading || busy}
          title="Tải lại tài sản"
          aria-label="Tải lại tài sản"
        >
          <RefreshIcon className="cmr-icon" />
        </button>
      </div>
      {error && <div className="cmr-alert cmr-alert--error" role="alert">{error}</div>}
      {notice && <div className="cmr-alert cmr-alert--success" role="status">{notice}</div>}
      <div className="cmr-workbench-grid cmr-workbench-grid--creative">
        <section className="cmr-panel cmr-workbench-panel">
          <div className="cmr-section-heading">
            <div><span className="cmr-eyebrow">01 / Brief</span><h3>Tạo brief nội dung</h3></div>
            <WorkbenchPill
              value={canEdit ? 'ready' : 'blocked'}
              label={canEdit ? 'Được tạo nháp' : 'Chỉ xem'}
            />
          </div>
          <form className="cmr-workbench-form" onSubmit={createBrief} aria-busy={busy}>
            <WorkbenchField
              label="Tiêu đề brief"
              value={brief.title}
              onChange={(value) => updateBrief('title', value)}
              placeholder="Video giải thích IzziAPI 30 giây"
              disabled={!canEdit || busy}
            />
            <WorkbenchField
              label="Ý tưởng cốt lõi"
              value={brief.concept}
              onChange={(value) => updateBrief('concept', value)}
              placeholder="Mô tả điểm thu hút và lời hứa dành cho khán giả."
              multiline
              disabled={!canEdit || busy}
            />
            <div className="cmr-workbench-form__row">
              <WorkbenchField
                label="Khán giả"
                value={brief.audience}
                onChange={(value) => updateBrief('audience', value)}
                placeholder={form.audience.segments || 'Dùng Audience Center'}
                disabled={!canEdit || busy}
              />
              <label className="cmr-field">
                <span className="cmr-field__label">Kênh chính</span>
                <select
                  value={brief.channel}
                  onChange={(event) => updateBrief('channel', event.currentTarget.value)}
                  disabled={!canEdit || busy}
                >
                  {Array.from(new Set([...form.channels, ...CREATIVE_CHANNELS])).map(
                    (channel) => (
                      <option key={channel} value={channel}>{channelLabel(channel)}</option>
                    ),
                  )}
                </select>
              </label>
            </div>
            <div className="cmr-workbench-form__row">
              <label className="cmr-field">
                <span className="cmr-field__label">Định dạng</span>
                <select
                  value={brief.format}
                  onChange={(event) => updateBrief('format', event.currentTarget.value)}
                  disabled={!canEdit || busy}
                >
                  {CREATIVE_FORMATS.map((format) => (
                    <option key={format} value={format}>{CREATIVE_FORMAT_LABELS[format]}</option>
                  ))}
                </select>
              </label>
              <WorkbenchField
                label="CTA"
                value={brief.cta}
                onChange={(value) => updateBrief('cta', value)}
                placeholder="Xem demo miễn phí"
                disabled={!canEdit || busy}
              />
            </div>
            <div className="cmr-workbench-form__footer">
              <span className="cmr-muted">Được lưu thành nội dung nháp trong workspace.</span>
              <button
                type="submit"
                className="cmr-button cmr-button--primary"
                disabled={!canEdit || busy}
              >
                {busy ? 'Đang lưu...' : 'Lưu brief'} <ContentIcon className="cmr-button__icon" />
              </button>
            </div>
          </form>
          {!canEdit && <p className="cmr-permission-note">Vai trò hiện tại không thể tạo nháp.</p>}
        </section>
        <section className="cmr-panel cmr-workbench-panel">
          <div className="cmr-section-heading">
            <div><span className="cmr-eyebrow">02 / Kho tài sản</span><h3>Tài sản đã đăng ký</h3></div>
            <strong className="cmr-workbench-count">{assets.length}</strong>
          </div>
          <p className="cmr-workbench-note">
            Đây là metadata đã lưu. Không ngụ ý có file do AI tạo.
          </p>
          {loading ? (
            <div className="cmr-workbench-skeleton" role="status" aria-label="Đang tải tài sản">
              <span /><span /><span />
            </div>
          ) : assets.length === 0 ? (
            <WorkbenchEmpty
              icon={DesignIcon}
              title="Chưa có tài sản đã đăng ký"
              description="Đăng ký tài sản trước khi đưa vào quy trình sáng tạo."
            />
          ) : (
            <div className="cmr-workbench-list">
              {assets.slice(0, 8).map((asset) => (
                <div className="cmr-workbench-list__row" key={asset.id}>
                  <div>
                    <strong>{asset.title}</strong>
                    <span>{asset.mimeType} / {formatCount(asset.sizeBytes)} bytes</span>
                  </div>
                  <WorkbenchPill value={asset.status} />
                </div>
              ))}
            </div>
          )}
          <button
            type="button"
            className="cmr-button cmr-button--quiet cmr-workbench-link"
            onClick={() => onOpen('assets')}
          >
            Mở toàn bộ tài sản <DesignIcon className="cmr-button__icon" />
          </button>
        </section>
      </div>
    </div>
  );
}

export interface AnalyticsDateRange {
  fromDate: string;
  toDate: string;
}
function dateInputValue(date: Date): string {
  return [
    String(date.getFullYear()).padStart(4, '0'),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}
export function currentMonthAnalyticsRange(now = new Date()): AnalyticsDateRange {
  return {
    fromDate: dateInputValue(new Date(now.getFullYear(), now.getMonth(), 1)),
    toDate: dateInputValue(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}
function parseDateOnly(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(time)) return null;
  return new Date(time).toISOString().slice(0, 10) === value ? time : null;
}
export function analyticsWindowFromDates(
  range: AnalyticsDateRange,
): CustomerMarketingAnalyticsWindow | null {
  const fromMs = parseDateOnly(range.fromDate);
  const toMs = parseDateOnly(range.toDate);
  if (fromMs === null || toMs === null || fromMs > toMs) return null;
  const calendarDays = Math.floor((toMs - fromMs) / 86_400_000) + 1;
  if (calendarDays > 366) return null;
  return {
    from: `${range.fromDate}T00:00:00.000Z`,
    to: `${range.toDate}T23:59:59.999Z`,
  };
}
export function buildAnalyticsInsights(
  report: CustomerMarketingAnalyticsReport,
): string[] {
  const insights: string[] = [];
  if (report.inventory.total === 0) {
    insights.push('The workspace has no persisted resources in this window.');
  }
  if (report.attribution.unattributedContent > 0) {
    insights.push(
      `${report.attribution.unattributedContent} content item(s) are not linked to a campaign.`,
    );
  }
  if (report.schedule.contentScheduledInWindow === 0 && report.inventory.content > 0) {
    insights.push('Content exists but none is scheduled in this window.');
  }
  if (report.activity.byStatus.inReview > 0) {
    insights.push(
      `${report.activity.byStatus.inReview} resource(s) are waiting for review.`,
    );
  }
  if (insights.length === 0) {
    insights.push('Inventory, activity, schedule, and direct attribution are consistent.');
  }
  return insights.slice(0, 4);
}
function errorForAnalytics(result: CustomerMarketingAnalyticsResult): string {
  if (result.error) return result.error;
  if (result.status === 'local') {
    return 'Kết nối và đồng bộ IzziAPI để tải báo cáo đã xác thực.';
  }
  if (result.status === 'forbidden') return 'Vai trò hiện tại không được xem analytics.';
  if (result.status === 'not_found') return 'Workspace này chưa có analytics.';
  return 'Không thể tải báo cáo analytics.';
}

function AnalyticsCopilotView({
  onBack,
  onDirector,
}: {
  onBack: () => void;
  onDirector: (goal: string) => Promise<boolean | void>;
}) {
  const initialRange = useMemo(() => currentMonthAnalyticsRange(), []);
  const [range, setRange] = useState<AnalyticsDateRange>(initialRange);
  const [report, setReport] = useState<CustomerMarketingAnalyticsReport | null>(null);
  const [status, setStatus] = useState<CustomerMarketingBridgeStatus>('unavailable');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmInsight, setConfirmInsight] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(async (nextRange: AnalyticsDateRange) => {
    const request = ++requestId.current;
    const window = analyticsWindowFromDates(nextRange);
    if (!window) {
      setReport(null);
      setStatus('unavailable');
      setError('Chọn ngày hợp lệ trong khoảng tối đa 366 ngày.');
      setLoading(false);
      return;
    }
    const api = customerApi();
    if (!api) {
      setReport(null);
      setStatus('unavailable');
      setError('Analytics Copilot cần chạy trong Izzi AI Desktop.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await api.getMarketingAnalytics(window);
      if (request !== requestId.current) return;
      setStatus(result.status);
      if (result.ok && result.status === 'synced' && result.report) {
        setReport(result.report);
      } else {
        setReport(null);
        setError(errorForAnalytics(result));
      }
    } catch (reason) {
      if (request !== requestId.current) return;
      setStatus('unavailable');
      setReport(null);
      setError(reason instanceof Error ? reason.message : 'Yêu cầu analytics thất bại.');
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(initialRange);
    return () => {
      requestId.current += 1;
    };
  }, [initialRange, load]);

  const insights = report ? buildAnalyticsInsights(report) : [];
  const submitRange = (event: FormEvent) => {
    event.preventDefault();
    void load(range);
  };
  const sendInsightToDirector = async () => {
    if (!report || !confirmInsight) return;
    await onDirector(
      `Rà soát dữ liệu marketing đã xác thực từ ${formatDate(report.window.from)} đến ${formatDate(report.window.to)}. ${insights.join(' ')}`,
    );
    setConfirmInsight(false);
  };

  return (
    <div className="cmr-view-stack cmr-workbench">
      <WorkbenchHeader
        eyebrow="Hỗ trợ ra quyết định"
        title="Analytics Copilot"
        description="Đọc kho tài nguyên, hoạt động, lịch và phân bổ chiến dịch trực tiếp đã lưu, không bịa số liệu hiệu suất."
        icon={TrendUpIcon}
        onBack={onBack}
      />
      <section className="cmr-panel cmr-workbench-panel" aria-busy={loading}>
        <div className="cmr-section-heading">
          <div><span className="cmr-eyebrow">Khoảng báo cáo</span><h3>Báo cáo workspace đã xác thực</h3></div>
          <WorkbenchPill
            value={loading ? 'pending' : status}
            label={loading ? 'Đang tải' : bridgeMessage(status)}
          />
        </div>
        <form className="cmr-workbench-controls" onSubmit={submitRange}>
          <WorkbenchField
            label="Từ ngày"
            value={range.fromDate}
            onChange={(value) => setRange((current) => ({ ...current, fromDate: value }))}
            type="date"
            disabled={loading}
          />
          <WorkbenchField
            label="Đến ngày"
            value={range.toDate}
            onChange={(value) => setRange((current) => ({ ...current, toDate: value }))}
            type="date"
            disabled={loading}
          />
          <button type="submit" className="cmr-button cmr-button--primary" disabled={loading}>
            {loading ? 'Đang tải...' : 'Tải báo cáo'} <RefreshIcon className="cmr-button__icon" />
          </button>
        </form>
        {error && <div className="cmr-alert cmr-alert--error" role="alert">{error}</div>}
        {report && (
          <p className="cmr-workbench-note">
            Cập nhật {formatDate(report.generatedAt, true)} / UTC / {report.window.activityBasis}
          </p>
        )}
      </section>
      {loading && !report && (
        <div className="cmr-workbench-skeleton cmr-workbench-skeleton--large" role="status" aria-label="Đang tải báo cáo">
          <span /><span /><span /><span />
        </div>
      )}
      {report && (
        <>
          <div className="cmr-metrics cmr-workbench-metrics" aria-label="Analytics đã xác thực">
            <div className="cmr-metric">
              <span>Tổng tài nguyên</span><strong>{formatCount(report.inventory.total)}</strong>
              <small>{report.inventory.campaigns} chiến dịch / {report.inventory.content} nội dung</small>
            </div>
            <div className="cmr-metric cmr-metric--positive">
              <span>Cập nhật trong kỳ</span><strong>{formatCount(report.activity.updatedInWindow)}</strong>
              <small>theo thời điểm cập nhật tài nguyên</small>
            </div>
            <div className="cmr-metric cmr-metric--warning">
              <span>Nội dung đã lên lịch</span><strong>{formatCount(report.schedule.contentScheduledInWindow)}</strong>
              <small>theo thời điểm lên lịch nội dung</small>
            </div>
            <div className="cmr-metric cmr-metric--positive">
              <span>Gắn với chiến dịch</span><strong>{formatCount(report.attribution.attributedContent)}</strong>
              <small>{report.attribution.unattributedContent} chưa gắn</small>
            </div>
          </div>
          <div className="cmr-workbench-grid cmr-workbench-grid--analytics">
            <section className="cmr-panel cmr-workbench-panel">
              <div className="cmr-section-heading">
                <div><span className="cmr-eyebrow">Hoạt động</span><h3>Theo loại tài nguyên</h3></div>
              </div>
              <div className="cmr-workbench-breakdown">
                {ANALYTICS_KIND_KEYS.map((key) => (
                  <div key={key}>
                    <span>{ANALYTICS_KIND_LABELS[key]}</span>
                    <strong>{formatCount(report.activity.byKind[key])}</strong>
                  </div>
                ))}
              </div>
              <div className="cmr-workbench-status-strip">
                {ANALYTICS_STATUS_KEYS.map((key) => (
                  <span key={key}>
                    {ANALYTICS_STATUS_LABELS[key]} <strong>{formatCount(report.activity.byStatus[key])}</strong>
                  </span>
                ))}
              </div>
            </section>
            <section className="cmr-panel cmr-workbench-panel">
              <div className="cmr-section-heading">
                <div><span className="cmr-eyebrow">Lịch</span><h3>Theo kênh</h3></div>
              </div>
              {report.schedule.byChannel.length === 0 ? (
                <WorkbenchEmpty
                  icon={PlanningIcon}
                  title="Chưa có lịch"
                  description="Không có nội dung nào được lên lịch trong kỳ này."
                />
              ) : (
                <div className="cmr-workbench-breakdown">
                  {report.schedule.byChannel.map((item) => (
                    <div key={item.channel}>
                      <span>{channelLabel(item.channel)}</span><strong>{formatCount(item.count)}</strong>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
          <section className="cmr-panel cmr-workbench-panel">
            <div className="cmr-section-heading">
              <div><span className="cmr-eyebrow">Copilot tổng hợp</span><h3>Điểm cần kiểm tra tiếp theo dựa trên dữ liệu</h3></div>
              <SparkIcon className="cmr-icon" />
            </div>
            <ul className="cmr-workbench-insights">
              {insights.map((insight) => <li key={insight}>{insight}</li>)}
            </ul>
            {!confirmInsight ? (
              <button
                type="button"
                className="cmr-button cmr-button--primary"
                onClick={() => setConfirmInsight(true)}
                disabled={loading}
              >
                Gửi tóm tắt cho AI Director <SparkIcon className="cmr-button__icon" />
              </button>
            ) : (
              <div className="cmr-confirm-strip" role="dialog" aria-label="Xác nhận gửi analytics">
                <span>Gửi tóm tắt đã xác thực này cho AI Director để lập kế hoạch cục bộ?</span>
                <div className="cmr-inline-actions">
                  <button type="button" className="cmr-button cmr-button--quiet" onClick={() => setConfirmInsight(false)}>Hủy</button>
                  <button type="button" className="cmr-button cmr-button--primary" onClick={() => void sendInsightToDirector()}>Xác nhận</button>
                </div>
              </div>
            )}
          </section>
          <section className="cmr-panel cmr-workbench-availability" role="status">
            <StatusIcon className="cmr-icon" />
            <div>
              <strong>Chưa có dữ liệu hiệu suất từ bên ngoài</strong>
              <span>{report.dataAvailability.performanceMetrics.reason}</span>
              <small>Không bịa số impression, reach, click, chuyển đổi hay doanh thu.</small>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export type BrandGuardianFindingLevel = 'pass' | 'warning' | 'block';
export interface BrandGuardianFinding {
  level: BrandGuardianFindingLevel;
  message: string;
}
export interface BrandGuardianScan {
  resourceId: string;
  level: BrandGuardianFindingLevel;
  findings: BrandGuardianFinding[];
  avoidMatches: string[];
  useMatches: string[];
}
export function scanBrandContent(
  resource: CustomerMarketingContentResource,
  brand: CustomerBrandProfile,
): BrandGuardianScan {
  const body = `${resource.title}\n${resource.body}`.toLocaleLowerCase();
  const avoidMatches = brand.wordsToAvoid
    .map((word) => word.trim())
    .filter(Boolean)
    .filter((word) => body.includes(word.toLocaleLowerCase()));
  const useMatches = brand.wordsToUse
    .map((word) => word.trim())
    .filter(Boolean)
    .filter((word) => body.includes(word.toLocaleLowerCase()));
  const findings: BrandGuardianFinding[] = [];
  if (avoidMatches.length > 0) {
    findings.push({
      level: 'block',
      message: `Phát hiện từ cần tránh: ${avoidMatches.join(', ')}.`,
    });
  }
  if (!brand.tone.trim()) {
    findings.push({ level: 'warning', message: 'Brand Center chưa có giọng điệu thương hiệu.' });
  }
  if (brand.wordsToUse.length > 0 && useMatches.length === 0) {
    findings.push({
      level: 'warning',
      message: 'Nội dung này chưa dùng từ khóa thương hiệu nào được khuyến nghị.',
    });
  }
  if (findings.length === 0) {
    findings.push({ level: 'pass', message: 'Không vi phạm quy tắc thương hiệu nào đã cấu hình.' });
  }
  return {
    resourceId: resource.id,
    level: findings.some((finding) => finding.level === 'block')
      ? 'block'
      : findings.some((finding) => finding.level === 'warning')
        ? 'warning'
        : 'pass',
    findings,
    avoidMatches,
    useMatches,
  };
}

function BrandGuardianView({
  snapshot,
  form,
  role,
  onBack,
  onOpen,
}: {
  snapshot: CustomerMarketingSnapshot;
  form: CustomerOnboardingInput;
  role: CustomerRole;
  onBack: () => void;
  onOpen: (view: CapabilityWorkbenchOpenView) => void;
}) {
  const [resources, setResources] = useState<CustomerMarketingContentResource[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [status, setStatus] = useState<CustomerMarketingBridgeStatus>('unavailable');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const canSubmit = roleCanEdit(role);
  const scans = useMemo(
    () => resources.map((resource) => scanBrandContent(resource, form.brand)),
    [form.brand, resources],
  );
  const blockedCount = scans.filter((scan) => scan.level === 'block').length;
  const warningCount = scans.filter((scan) => scan.level === 'warning').length;
  const pendingBrandReviews = snapshot.approvals.filter(
    (approval) => approval.status === 'pending' && approval.kind === 'strategy',
  ).length;

  const load = useCallback(async () => {
    const api = customerApi();
    if (!api) {
      setStatus('unavailable');
      setError('Brand Guardian cần chạy trong Izzi AI Desktop.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await api.listMarketingResources('content');
      setStatus(result.status);
      if (!result.ok) {
        setResources([]);
        setError(result.error || bridgeMessage(result.status));
        return;
      }
      setResources(result.resources.filter(
        (resource): resource is CustomerMarketingContentResource =>
          resource.kind === 'content',
      ));
    } catch (reason) {
      setStatus('unavailable');
      setError(reason instanceof Error ? reason.message : bridgeMessage('unavailable'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submitForReview = async (resource: CustomerMarketingContentResource) => {
    const api = customerApi();
    const scan = scans.find((item) => item.resourceId === resource.id);
    if (
      !api ||
      !canSubmit ||
      !['draft', 'rejected'].includes(resource.status) ||
      !scan ||
      scan.level === 'block'
    ) {
      return;
    }
    setBusyId(resource.id);
    setError('');
    setNotice('');
    try {
      const result = await api.reviewMarketingResource({
        kind: 'content',
        resourceId: resource.id,
        action: 'submit',
        expectedRevision: resource.revision,
      });
      setStatus(result.status);
      if (!result.ok || !result.resource || result.resource.kind !== 'content') {
        setError(result.error || bridgeMessage(result.status));
        return;
      }
      setResources((current) => current.map((item) =>
        item.id === resource.id
          ? (result.resource as CustomerMarketingContentResource)
          : item,
      ));
      setNotice('Đã gửi bản sạch vào hàng đợi duyệt của người.');
    } catch (reason) {
      setStatus('unavailable');
      setError(reason instanceof Error ? reason.message : bridgeMessage('unavailable'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="cmr-view-stack cmr-workbench">
      <WorkbenchHeader
        eyebrow="An toàn thương hiệu"
        title="Brand Guardian"
        description="Quét nội dung đã lưu theo quy tắc Brand Center. Kết quả quét là bằng chứng; con người vẫn là người phê duyệt."
        icon={StatusIcon}
        onBack={onBack}
      />
      <div className="cmr-workbench-status">
        <span>
          <span className="cmr-workbench-status__dot" />
          {loading ? 'Đang quét nội dung...' : bridgeMessage(status)}
        </span>
        <button
          type="button"
          className="cmr-icon-button"
          onClick={() => void load()}
          disabled={loading || busyId !== null}
          title="Quét lại"
          aria-label="Quét lại"
        >
          <RefreshIcon className="cmr-icon" />
        </button>
      </div>
      {error && <div className="cmr-alert cmr-alert--error" role="alert">{error}</div>}
      {notice && <div className="cmr-alert cmr-alert--success" role="status">{notice}</div>}
      <div className="cmr-metrics cmr-workbench-metrics">
        <div className="cmr-metric"><span>Đã quét</span><strong>{formatCount(scans.length)}</strong><small>Nội dung đã lưu</small></div>
        <div className="cmr-metric cmr-metric--positive"><span>Đạt</span><strong>{formatCount(scans.filter((scan) => scan.level === 'pass').length)}</strong><small>Không vi phạm quy tắc</small></div>
        <div className="cmr-metric cmr-metric--warning"><span>Cần xem</span><strong>{formatCount(warningCount)}</strong><small>Cần chú ý</small></div>
        <div className="cmr-metric cmr-metric--negative"><span>Bị chặn</span><strong>{formatCount(blockedCount)}</strong><small>Có từ cần tránh</small></div>
      </div>
      <div className="cmr-workbench-grid cmr-workbench-grid--guardian">
        <section className="cmr-panel cmr-workbench-panel">
          <div className="cmr-section-heading">
            <div><span className="cmr-eyebrow">Quy tắc</span><h3>Brand Center hiện tại</h3></div>
            <span className="cmr-color-preview" style={{ background: form.brand.primaryColor }} />
          </div>
          <dl className="cmr-workbench-definition-list">
            <div><dt>Giọng điệu</dt><dd>{form.brand.tone || 'Chưa cấu hình'}</dd></div>
            <div><dt>Hướng dẫn</dt><dd>{form.brand.guidelines || 'Chưa cấu hình'}</dd></div>
            <div><dt>Nên dùng</dt><dd>{form.brand.wordsToUse.join(', ') || 'Chưa liệt kê'}</dd></div>
            <div><dt>Cần tránh</dt><dd>{form.brand.wordsToAvoid.join(', ') || 'Chưa liệt kê'}</dd></div>
          </dl>
          <button
            type="button"
            className="cmr-button cmr-button--quiet cmr-workbench-link"
            onClick={() => onOpen('brand')}
          >
            Sửa Brand Center <PlanningIcon className="cmr-button__icon" />
          </button>
        </section>
        <section className="cmr-panel cmr-workbench-panel">
          <div className="cmr-section-heading">
            <div><span className="cmr-eyebrow">Hàng đợi duyệt</span><h3>Điểm quyết định của con người</h3></div>
            <WorkbenchPill
              value={pendingBrandReviews > 0 ? 'pending' : 'ready'}
              label={pendingBrandReviews > 0 ? `${pendingBrandReviews} đang chờ` : 'Không có phê duyệt chờ'}
            />
          </div>
          <p className="cmr-workbench-note">
            Quét không bao giờ tự phê duyệt hay đăng nội dung. Hãy dùng hộp thư phê duyệt.
          </p>
          <button
            type="button"
            className="cmr-button cmr-button--primary"
            onClick={() => onOpen('approvals')}
          >
            Mở hộp thư phê duyệt <ReviewIcon className="cmr-button__icon" />
          </button>
          {!roleCanReview(role) && (
            <p className="cmr-permission-note">Vai trò hiện tại chỉ xem được bằng chứng, không được quyết định.</p>
          )}
        </section>
      </div>
      <section className="cmr-panel cmr-workbench-panel">
        <div className="cmr-section-heading">
          <div><span className="cmr-eyebrow">Bằng chứng</span><h3>Kiểm tra nội dung</h3></div>
        </div>
        {loading ? (
          <div className="cmr-workbench-skeleton" role="status" aria-label="Đang quét nội dung">
            <span /><span /><span />
          </div>
        ) : resources.length === 0 ? (
          <WorkbenchEmpty
            icon={ContentIcon}
            title="Chưa có nội dung để quét"
            description="Tạo nội dung nháp trước, rồi chạy Brand Guardian."
          />
        ) : (
          <div className="cmr-guardian-list">
            {resources.map((resource) => {
              const scan = scans.find((item) => item.resourceId === resource.id);
              if (!scan) return null;
              const canSubmitResource =
                canSubmit &&
                ['draft', 'rejected'].includes(resource.status) &&
                scan.level !== 'block';
              return (
                <article className="cmr-guardian-row" key={resource.id}>
                  <div className="cmr-guardian-row__copy">
                    <div className="cmr-guardian-row__title">
                      <ContentIcon className="cmr-icon" />
                      <strong>{resource.title}</strong>
                      <WorkbenchPill
                        value={scan.level}
                        label={scan.level === 'pass' ? 'Đạt' : scan.level === 'warning' ? 'Cần xem' : 'Bị chặn'}
                      />
                    </div>
                    <span>{channelLabel(resource.channel)} / {pillLabel(resource.status)} / bản sửa {resource.revision}</span>
                    <ul>
                      {scan.findings.map((finding) => (
                        <li
                          key={finding.message}
                          className={`cmr-guardian-finding cmr-guardian-finding--${finding.level}`}
                        >
                          {finding.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                  {canSubmitResource && (
                    <button
                      type="button"
                      className="cmr-button cmr-button--quiet"
                      disabled={busyId !== null}
                      onClick={() => void submitForReview(resource)}
                    >
                      {busyId === resource.id ? 'Đang gửi...' : 'Gửi duyệt'} <ReviewIcon className="cmr-button__icon" />
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

const TARGETS: Array<{
  value: CustomerMarketingWorkflowTarget;
  label: string;
}> = [
  { value: 'social', label: 'Social' },
  { value: 'seo', label: 'SEO' },
  { value: 'email', label: 'Email' },
  { value: 'crm', label: 'CRM' },
];
const ALLOWED_WORKFLOW_OPERATIONS = ['read', 'draft', 'validate'] as const;
type AllowedWorkflowOperation = (typeof ALLOWED_WORKFLOW_OPERATIONS)[number];
function operationLabel(operation: AllowedWorkflowOperation): string {
  if (operation === 'read') return 'Đọc nguồn đã lưu';
  if (operation === 'draft') return 'Chuẩn bị bản nháp';
  return 'Kiểm tra cục bộ';
}

function AutomationBuilderView({
  role,
  onBack,
}: {
  role: CustomerRole;
  onBack: () => void;
}) {
  const [target, setTarget] = useState<CustomerMarketingWorkflowTarget>('social');
  const [sources, setSources] = useState<CustomerMarketingWorkflowSource[]>([]);
  const [workflows, setWorkflows] = useState<CustomerMarketingWorkflowRecord[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState('');
  const [operations, setOperations] = useState<AllowedWorkflowOperation[]>([
    'read', 'draft', 'validate',
  ]);
  const [status, setStatus] = useState<CustomerMarketingBridgeStatus>('unavailable');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const canReview = roleCanReview(role);
  const selectedSource =
    sources.find((source) => source.id === selectedSourceId) ?? null;
  const hasPendingWorkflow = workflows.some((workflow) => workflow.status === 'pending');

  const load = useCallback(async (nextTarget: CustomerMarketingWorkflowTarget) => {
    const api = customerApi();
    if (!api) {
      setStatus('unavailable');
      setError('Automation Builder cần chạy trong Izzi AI Desktop.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [sourceResult, workflowResult] = await Promise.all([
        api.listMarketingWorkflowSources(nextTarget),
        api.listMarketingWorkflows(nextTarget),
      ]);
      setStatus(sourceResult.status);
      if (!sourceResult.ok || !workflowResult.ok) {
        setSources([]);
        setWorkflows([]);
        setSelectedSourceId('');
        setError(
          sourceResult.error ||
          workflowResult.error ||
          bridgeMessage(sourceResult.status),
        );
        return;
      }
      setSources(sourceResult.sources);
      setWorkflows(workflowResult.workflows);
      setSelectedSourceId((current) =>
        sourceResult.sources.some((source) => source.id === current)
          ? current
          : sourceResult.sources[0]?.id ?? '',
      );
    } catch (reason) {
      setStatus('unavailable');
      setError(reason instanceof Error ? reason.message : bridgeMessage('unavailable'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(target);
  }, [load, target]);

  const toggleOperation = (operation: AllowedWorkflowOperation) => {
    setOperations((current) =>
      current.includes(operation)
        ? current.filter((item) => item !== operation)
        : [...current, operation],
    );
  };

  const prepare = async () => {
    const api = customerApi();
    if (!api || !selectedSource || operations.length === 0) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api.prepareMarketingWorkflow({
        target,
        resourceId: selectedSource.id,
        expectedRevision: selectedSource.revision,
        operations,
      });
      setStatus(result.status);
      if (!result.ok || !result.workflow) {
        setError(result.error || bridgeMessage(result.status));
        return;
      }
      const workflow = result.workflow;
      setWorkflows((current) => [
        workflow,
        ...current.filter((item) => item.workflowId !== workflow.workflowId),
      ]);
      setNotice('Đã chuẩn bị dry-run cục bộ. Không thực hiện hành động bên ngoài nào.');
    } catch (reason) {
      setStatus('unavailable');
      setError(reason instanceof Error ? reason.message : bridgeMessage('unavailable'));
    } finally {
      setBusy(false);
    }
  };

  const review = async (
    workflow: CustomerMarketingWorkflowRecord,
    decision: 'approved' | 'rejected',
  ) => {
    const api = customerApi();
    if (!api || !canReview || workflow.status !== 'pending') return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api.reviewMarketingWorkflow({
        target,
        workflowId: workflow.workflowId,
        approvalId: workflow.approvalId,
        manifestDigest: workflow.manifestDigest,
        decision,
        note: 'Đã duyệt trong Automation Builder; hành động bên ngoài vẫn bị khóa.',
      });
      setStatus(result.status);
      if (!result.ok || !result.workflow) {
        setError(result.error || bridgeMessage(result.status));
        return;
      }
      const reviewed = result.workflow;
      setWorkflows((current) => current.map((item) =>
        item.workflowId === reviewed.workflowId ? reviewed : item,
      ));
      setNotice(decision === 'approved'
        ? 'Đã duyệt dry-run cục bộ; chưa đăng hay gửi gì.'
        : 'Đã từ chối dry-run cục bộ.');
    } catch (reason) {
      setStatus('unavailable');
      setError(reason instanceof Error ? reason.message : bridgeMessage('unavailable'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cmr-view-stack cmr-workbench">
      <WorkbenchHeader
        eyebrow="Quy trình có rào chắn"
        title="Automation Builder"
        description="Chuẩn bị và duyệt một dry-run cục bộ có giới hạn. Không cho phép đăng, gửi, hàng loạt, chi tiêu, ghi liên hệ hay ghi tích hợp."
        icon={SettingsIcon}
        onBack={onBack}
      />
      <div className="cmr-workbench-status">
        <span>
          <span className="cmr-workbench-status__dot" />
          {loading ? 'Đang tải nguồn quy trình...' : bridgeMessage(status)}
        </span>
        <button
          type="button"
          className="cmr-icon-button"
          onClick={() => void load(target)}
          disabled={loading || busy}
          title="Tải lại nguồn quy trình"
          aria-label="Tải lại nguồn quy trình"
        >
          <RefreshIcon className="cmr-icon" />
        </button>
      </div>
      {error && <div className="cmr-alert cmr-alert--error" role="alert">{error}</div>}
      {notice && <div className="cmr-alert cmr-alert--success" role="status">{notice}</div>}
      <section className="cmr-panel cmr-workbench-panel">
        <div className="cmr-section-heading">
          <div><span className="cmr-eyebrow">01 / Builder</span><h3>Chuẩn bị dry-run cục bộ</h3></div>
          <WorkbenchPill
            value={canReview ? 'ready' : 'blocked'}
            label={canReview ? 'Được duyệt' : 'Chỉ xem'}
          />
        </div>
        <div className="cmr-workbench-controls">
          <label className="cmr-field">
            <span className="cmr-field__label">Mục tiêu</span>
            <select
              value={target}
              onChange={(event) =>
                setTarget(event.currentTarget.value as CustomerMarketingWorkflowTarget)}
              disabled={loading || busy}
            >
              {TARGETS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className="cmr-field">
            <span className="cmr-field__label">Nguồn đã lưu</span>
            <select
              value={selectedSourceId}
              onChange={(event) => setSelectedSourceId(event.currentTarget.value)}
              disabled={loading || busy || sources.length === 0}
            >
              {sources.length === 0 && <option value="">Chưa có nguồn đã duyệt</option>}
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.title} / bản sửa {source.revision}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div
          className="cmr-workbench-operation-grid"
          role="group"
          aria-label="Thao tác dry-run được phép"
        >
          {ALLOWED_WORKFLOW_OPERATIONS.map((operation) => (
            <label className="cmr-workbench-check" key={operation}>
              <input
                type="checkbox"
                checked={operations.includes(operation)}
                onChange={() => toggleOperation(operation)}
                disabled={busy}
              />
              <span>{operationLabel(operation)}</span>
            </label>
          ))}
        </div>
        <div className="cmr-workbench-denylist" role="status">
          <strong>Bị khóa theo chính sách</strong>
          <span>publish / send / bulk / spend / integration.write / contacts.write</span>
        </div>
        <button
          type="button"
          className="cmr-button cmr-button--primary"
          onClick={() => void prepare()}
          disabled={busy || loading || !selectedSource || operations.length === 0}
        >
          {busy ? 'Đang chuẩn bị...' : 'Chuẩn bị dry-run'} <SettingsIcon className="cmr-button__icon" />
        </button>
      </section>
      <section className="cmr-panel cmr-workbench-panel">
        <div className="cmr-section-heading">
          <div><span className="cmr-eyebrow">02 / Duyệt</span><h3>Manifest quy trình</h3></div>
          <strong className="cmr-workbench-count">{workflows.length}</strong>
        </div>
        {workflows.length === 0 ? (
          <WorkbenchEmpty
            icon={PlanningIcon}
            title="Chưa có quy trình cục bộ"
            description="Chuẩn bị dry-run từ một nguồn đã lưu."
          />
        ) : (
          <div className="cmr-automation-list">
            {workflows.slice(0, 6).map((workflow) => (
              <article className="cmr-automation-row" key={workflow.workflowId}>
                <div className="cmr-automation-row__copy">
                  <div className="cmr-guardian-row__title">
                    <PlanningIcon className="cmr-icon" />
                    <strong>{workflow.manifest.title}</strong>
                    <WorkbenchPill value={workflow.status} />
                  </div>
                  <span>
                    {workflow.manifest.kind} / {formatDate(workflow.manifest.createdAt, true)}
                    {' / '}chính sách {workflow.manifest.grant.policyRevision}
                  </span>
                  <ul className="cmr-automation-details">
                    {workflow.manifest.dryRun.steps.map((step) => <li key={step}>{step}</li>)}
                  </ul>
                  <div className="cmr-automation-limits">
                    <span>Số mục: {workflow.manifest.grant.limits.maxItems}</span>
                    <span>Người nhận: {workflow.manifest.grant.limits.maxRecipients}</span>
                    <span>Chi tiêu: {workflow.manifest.grant.limits.maxSpendVnd} VND</span>
                    <span>Hành động bên ngoài: không</span>
                  </div>
                  {workflow.manifest.dryRun.warnings.map((warning) => (
                    <p className="cmr-permission-note" key={warning}>{warning}</p>
                  ))}
                </div>
                {workflow.status === 'pending' && (
                  <div className="cmr-inline-actions">
                    <button
                      type="button"
                      className="cmr-button cmr-button--quiet"
                      disabled={busy || !canReview}
                      onClick={() => void review(workflow, 'rejected')}
                    >
                      Từ chối
                    </button>
                    <button
                      type="button"
                      className="cmr-button cmr-button--primary"
                      disabled={busy || !canReview}
                      onClick={() => void review(workflow, 'approved')}
                    >
                      Duyệt dry-run
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
        {hasPendingWorkflow && !canReview && (
          <p className="cmr-permission-note">
            Cần vai trò reviewer để quyết định các manifest đang chờ.
          </p>
        )}
      </section>
    </div>
  );
}

export function CustomerMarketingCapabilityWorkbench({
  id,
  snapshot,
  form,
  onBack,
  onOpen,
  onDirector,
}: CapabilityWorkbenchProps) {
  if (id === 'seo-workspace') {
    return (
      <SeoPageSpeedView
        form={form}
        role={snapshot.workspace.role}
        onBack={onBack}
      />
    );
  }
  if (id === 'creative-studio') {
    return (
      <CreativeStudioView
        form={form}
        role={snapshot.workspace.role}
        onBack={onBack}
        onOpen={onOpen}
      />
    );
  }
  if (id === 'analytics-copilot') {
    return <AnalyticsCopilotView onBack={onBack} onDirector={onDirector} />;
  }
  if (id === 'brand-guardian') {
    return (
      <BrandGuardianView
        snapshot={snapshot}
        form={form}
        role={snapshot.workspace.role}
        onBack={onBack}
        onOpen={onOpen}
      />
    );
  }
  return <AutomationBuilderView role={snapshot.workspace.role} onBack={onBack} />;
}

