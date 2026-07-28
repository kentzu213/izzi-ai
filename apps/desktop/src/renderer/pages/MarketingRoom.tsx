import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import type {
  MarketingHealth,
  MarketingHumanGate,
  MarketingPathSelectionResult,
  MarketingReviewItem,
  MarketingWorkspaceSnapshot,
} from '../../shared/marketing-types';
import type {
  CustomerMarketingAnalyticsReport,
  CustomerMarketingAnalyticsResult,
  CustomerMarketingAnalyticsWindow,
} from '../../shared/customer-marketing-types';
import '../styles/marketing-room.css';

interface MarketingApi {
  getSnapshot: () => Promise<MarketingWorkspaceSnapshot>;
  selectWorkspace: () => Promise<MarketingPathSelectionResult>;
  selectVideoTemplate: () => Promise<MarketingPathSelectionResult>;
  openPath: (relativePath: string) => Promise<{ ok: boolean; error?: string }>;
}

interface CustomerAnalyticsApi {
  getMarketingAnalytics: (input: CustomerMarketingAnalyticsWindow) => Promise<CustomerMarketingAnalyticsResult>;
}

type TabId = 'overview' | 'content' | 'review' | 'video' | 'analytics' | 'integrations';
type ReviewFilter = 'all' | MarketingReviewItem['type'];

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'content', label: 'Content' },
  { id: 'review', label: 'Review' },
  { id: 'video', label: 'Video' },
  { id: 'analytics', label: 'Analytics' },
  { id: 'integrations', label: 'Integrations' },
];

const HEALTH_LABELS: Record<MarketingHealth, string> = {
  ready: 'Sẵn sàng',
  attention: 'Cần chú ý',
  blocked: 'Đang chặn',
  unknown: 'Chưa rõ',
};

const PLATFORM_LABELS: Record<string, string> = {
  telegram: 'Telegram',
  facebook: 'Facebook',
  youtube: 'YouTube',
  x: 'X',
  tiktok: 'TikTok',
  seo: 'SEO / CMS',
};

const STATUS_LABELS: Record<string, string> = {
  approved: 'Đã duyệt',
  verified_zero_spend: 'Đã xác nhận 0 VND',
  approved_local_review: 'Đã duyệt local',
  attention: 'Cần chú ý',
  blocked: 'Đang chặn',
  draft: 'Bản nháp',
  external: 'Bên ngoài',
  in_progress: 'Đang làm',
  needs_proof_check: 'Cần kiểm tra proof',
  not_scheduled: 'Chưa lên lịch',
  pending: 'Đang chờ',
  published: 'Đã xuất bản',
  ready: 'Sẵn sàng',
  rejected: 'Từ chối',
  scheduled: 'Đã lên lịch',
  workflow_ready: 'Workflow sẵn sàng',
  asset_draft: 'Asset nháp',
};

const RECOMMENDATION_LABELS: Record<string, string> = {
  configuration_required: 'Cần hoàn tất cấu hình',
  human_review_and_cms_publish_required: 'Cần người duyệt và xuất bản trên CMS',
  manual_or_autopost_connection_required: 'Cần kết nối thủ công hoặc Auto-Post',
  manual_upload_workflow_required: 'Cần quy trình tải lên thủ công',
  missing_proof: 'Thiếu proof',
  readiness_file_missing: 'Chưa có tệp readiness',
  ready_for_human_review: 'Sẵn sàng để người duyệt',
};

const HUMAN_GATE_TITLES: Record<string, string> = {
  case_study_4_review: 'Case Study 4 · Approval-gated publishing',
  seo_06_review: 'SEO 06 · Izzi AI Auto-Post workflow',
  weekly_spend_close: 'Weekly spend close · 13-19/07/2026',
};

const ANALYTICS_KIND_LABELS: Record<keyof CustomerMarketingAnalyticsReport['activity']['byKind'], string> = {
  campaign: 'Campaign',
  content: 'Nội dung',
  asset: 'Tài sản',
  knowledge: 'Tri thức',
};

const ANALYTICS_STATUS_LABELS: Record<keyof CustomerMarketingAnalyticsReport['activity']['byStatus'], string> = {
  draft: 'Bản nháp',
  inReview: 'Đang duyệt',
  approved: 'Đã duyệt',
  rejected: 'Từ chối',
  archived: 'Lưu trữ',
};

function humanGateOwner(gate: MarketingHumanGate): string {
  if (gate.reviewer) {
    const role = gate.kind === 'spend' ? 'Owner' : 'Reviewer';
    const date = gate.reviewDate ? ' · ' + formatDate(gate.reviewDate) : '';
    return role + ': ' + gate.reviewer + date;
  }
  return gate.kind === 'spend' ? 'Owner chưa xác nhận' : 'Reviewer chưa được chỉ định';
}
function humanize(value: string | undefined): string {
  if (!value) return 'Chưa có dữ liệu';
  const key = value.trim().toLowerCase();
  return RECOMMENDATION_LABELS[key]
    ?? STATUS_LABELS[key]
    ?? value.replace(/[_-]+/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase());
}

function toneForStatus(value: string): 'positive' | 'warning' | 'negative' | 'neutral' {
  const normalized = value.trim().toLowerCase();
  if (['ready', 'approved', 'approved_local_review', 'verified_zero_spend', 'published', 'available', 'quality_gate_pass', 'workflow_ready'].includes(normalized)) {
    return 'positive';
  }
  if (['blocked', 'rejected', 'error', 'failed', 'missing_proof', 'unavailable', 'forbidden'].includes(normalized)) return 'negative';
  if (['local', 'not_found'].includes(normalized)) return 'warning';
  if (
    normalized.includes('attention')
    || normalized.includes('pending')
    || normalized.includes('scheduled')
    || normalized.includes('draft')
    || normalized.includes('needs_')
    || normalized.includes('required')
  ) {
    return 'warning';
  }
  return 'neutral';
}

function formatDate(value: string | undefined, includeTime = false): string {
  if (!value) return 'Chưa ghi nhận';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
}

function formatVnd(value: number): string {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('vi-VN').format(value);
}

interface AnalyticsDateRange {
  fromDate: string;
  toDate: string;
}

const MAX_ANALYTICS_WINDOW_MS = 366 * 24 * 60 * 60 * 1_000;

function dateInputValue(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function currentMonthDateRange(now = new Date()): AnalyticsDateRange {
  return {
    fromDate: dateInputValue(new Date(now.getFullYear(), now.getMonth(), 1)),
    toDate: dateInputValue(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
  };
}

function analyticsWindowFromDates(range: AnalyticsDateRange): CustomerMarketingAnalyticsWindow | null {
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!datePattern.test(range.fromDate) || !datePattern.test(range.toDate)) return null;
  const from = `${range.fromDate}T00:00:00.000Z`;
  const to = `${range.toDate}T23:59:59.999Z`;
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)
    || new Date(fromMs).toISOString().slice(0, 10) !== range.fromDate
    || new Date(toMs).toISOString().slice(0, 10) !== range.toDate
    || fromMs > toMs || toMs - fromMs > MAX_ANALYTICS_WINDOW_MS) return null;
  return { from, to };
}

function analyticsFailureMessage(result: CustomerMarketingAnalyticsResult): string {
  if (result.error) return result.error;
  if (result.status === 'local') return 'Đăng nhập và bật đồng bộ IzziAPI để tải báo cáo.';
  if (result.status === 'forbidden') return 'Vai trò hiện tại không có quyền xem báo cáo này.';
  if (result.status === 'not_found') return 'Workspace analytics không còn khả dụng.';
  return 'Không thể tải báo cáo analytics. Vui lòng thử lại.';
}

function percentage(value: number, total: number): number {
  if (!total) return 0;
  return Math.round((value / total) * 1000) / 10;
}

function StatusBadge({ value, label }: { value: string; label?: string }) {
  const tone = toneForStatus(value);
  return <span className={`mr-badge mr-badge--${tone}`}>{label ?? humanize(value)}</span>;
}

function HealthBadge({ health }: { health: MarketingHealth }) {
  return <span className={`mr-badge mr-badge--${toneForStatus(health)}`}>{HEALTH_LABELS[health]}</span>;
}

function SectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mr-section-heading">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action && <div className="mr-section-heading__action">{action}</div>}
    </div>
  );
}

function MetricCard({
  label,
  value,
  hint,
  progress,
  tone = 'neutral',
}: {
  label: string;
  value: ReactNode;
  hint: string;
  progress?: number;
  tone?: 'positive' | 'warning' | 'negative' | 'neutral';
}) {
  return (
    <article className={`mr-metric mr-metric--${tone}`}>
      <span className="mr-metric__label">{label}</span>
      <strong className="mr-metric__value">{value}</strong>
      <span className="mr-metric__hint">{hint}</span>
      {progress !== undefined && (
        <progress className="mr-progress" max={100} value={Math.max(0, Math.min(progress, 100))}>
          {progress}%
        </progress>
      )}
    </article>
  );
}

function EmptyPanel({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="mr-empty">
      <span className="mr-empty__mark" aria-hidden="true">○</span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

function ReadOnlyNote() {
  return (
    <div className="mr-readonly-note" role="note">
      <span aria-hidden="true">◇</span>
      <span>Chế độ quan sát: Marketing Room không tự publish, render hay phát sinh chi tiêu.</span>
    </div>
  );
}

interface TabProps {
  snapshot: MarketingWorkspaceSnapshot;
  openPath: (relativePath: string) => void;
  busy: boolean;
}

interface AnalyticsTabProps extends TabProps {
  analyticsApi?: CustomerAnalyticsApi;
}

function OverviewTab({ snapshot, openPath, busy }: TabProps) {
  const readyPlatforms = snapshot.platforms.filter((item) => item.health === 'ready').length;
  const readyGates = snapshot.gates.filter((item) => item.health === 'ready').length;

  return (
    <div className="mr-tab-stack">
      <div className="mr-metrics" aria-label="Tổng quan marketing">
        <MetricCard
          label="Backlog hoàn tất"
          value={`${snapshot.backlog.completionPercent}%`}
          hint={`${snapshot.backlog.done}/${snapshot.backlog.total} đầu việc`}
          progress={snapshot.backlog.completionPercent}
          tone={snapshot.backlog.completionPercent >= 80 ? 'positive' : 'neutral'}
        />
        <MetricCard
          label="Nội dung được duyệt"
          value={snapshot.content.approved}
          hint={`${snapshot.content.total} mục trong publishing queue`}
          progress={percentage(snapshot.content.approved, snapshot.content.total)}
          tone={snapshot.content.approved > 0 ? 'positive' : 'warning'}
        />
        <MetricCard
          label="Safety gates"
          value={`${readyGates}/${snapshot.gates.length}`}
          hint="Gate đang ở trạng thái sẵn sàng"
          progress={percentage(readyGates, snapshot.gates.length)}
          tone={readyGates === snapshot.gates.length && snapshot.gates.length > 0 ? 'positive' : 'warning'}
        />
        <MetricCard
          label="Kênh sẵn sàng"
          value={`${readyPlatforms}/${snapshot.platforms.length}`}
          hint="Readiness theo tệp kiểm tra mới nhất"
          progress={percentage(readyPlatforms, snapshot.platforms.length)}
          tone={readyPlatforms > 0 ? 'positive' : 'neutral'}
        />
      </div>

      <div className="mr-split-grid">
        <section className="mr-panel">
          <SectionHeading
            title="Safety gates"
            description="Bằng chứng cần có trước bất kỳ hành động vận hành nào."
          />
          {snapshot.gates.length === 0 ? (
            <EmptyPanel title="Chưa có safety gate" description="Workspace chưa tạo dữ liệu kiểm soát an toàn." />
          ) : (
            <div className="mr-list">
              {snapshot.gates.map((gate) => (
                <div className="mr-list-row" key={gate.id}>
                  <span className={`mr-health-dot mr-health-dot--${gate.health}`} aria-hidden="true" />
                  <div className="mr-list-row__body">
                    <strong>{gate.label}</strong>
                    <span>{gate.detail}</span>
                  </div>
                  <HealthBadge health={gate.health} />
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="mr-panel">
          <SectionHeading title="Nhịp vận hành" description="Ảnh chụp nhanh từ các nguồn dữ liệu workspace." />
          <dl className="mr-summary-list">
            <div>
              <dt>Backlog</dt>
              <dd>{snapshot.backlog.inProgress} đang làm · {snapshot.backlog.external} phụ thuộc ngoài</dd>
            </div>
            <div>
              <dt>Content</dt>
              <dd>{snapshot.content.scheduled} scheduled · {snapshot.content.published} published</dd>
            </div>
            <div>
              <dt>Quality</dt>
              <dd>{snapshot.quality.seoQualityPassed}/{snapshot.quality.seoTotal} SEO pass · {snapshot.content.warnings} cảnh báo</dd>
            </div>
            <div>
              <dt>Spend evidence</dt>
              <dd>{formatVnd(snapshot.spend.actualSpendVnd)} thực chi · {snapshot.spend.verifiedZeroSpendEntries} zero-spend attestations</dd>
            </div>
          </dl>
          <div className="mr-inline-actions">
            <button className="mr-btn mr-btn--quiet" type="button" onClick={() => openPath('tasks/marketing-backlog.csv')} disabled={busy}>
              Mở backlog
            </button>
            <button className="mr-btn mr-btn--quiet" type="button" onClick={() => openPath('campaigns/30-day-content-calendar.csv')} disabled={busy}>
              Mở content calendar
            </button>
          </div>
        </section>
      </div>
      <ReadOnlyNote />
    </div>
  );
}

function ContentTab({ snapshot, openPath, busy }: TabProps) {
  return (
    <div className="mr-tab-stack">
      <div className="mr-metrics mr-metrics--compact" aria-label="Số liệu nội dung">
        <MetricCard label="Campaign items" value={snapshot.campaigns.length} hint="Trong lịch nội dung" />
        <MetricCard label="Đã duyệt" value={snapshot.content.approved} hint="Qua human review" tone="positive" />
        <MetricCard label="Đã lên lịch" value={snapshot.content.scheduled} hint="Chỉ phản ánh dữ liệu" tone="warning" />
        <MetricCard
          label="Cảnh báo QA"
          value={snapshot.content.warnings}
          hint="Cần xử lý trước publish"
          tone={snapshot.content.warnings > 0 ? 'negative' : 'positive'}
        />
      </div>

      <section className="mr-panel mr-panel--table">
        <SectionHeading
          title="30-day content calendar"
          description="Hook, CTA, trạng thái duyệt và bằng chứng theo từng ngày."
          action={(
            <button className="mr-btn mr-btn--quiet" type="button" onClick={() => openPath('campaigns/30-day-content-calendar.csv')} disabled={busy}>
              Mở lịch CSV
            </button>
          )}
        />
        {snapshot.campaigns.length === 0 ? (
          <EmptyPanel
            title="Lịch nội dung đang trống"
            description="Thêm dữ liệu vào 30-day-content-calendar.csv rồi làm mới snapshot."
          />
        ) : (
          <div className="mr-table-wrap">
            <table className="mr-table">
              <thead>
                <tr>
                  <th>Ngày</th>
                  <th>Nội dung</th>
                  <th>Kênh</th>
                  <th>Approval</th>
                  <th>Publish</th>
                  <th>Proof</th>
                </tr>
              </thead>
              <tbody>
                {snapshot.campaigns.map((item, index) => (
                  <tr key={`${item.id}-${index}`}>
                    <td data-label="Ngày">
                      <span className="mr-cell-primary">Day {item.day}</span>
                      <span className="mr-cell-secondary">{formatDate(item.date)}</span>
                    </td>
                    <td data-label="Nội dung" className="mr-content-cell">
                      <span className="mr-cell-primary">{item.format || 'Chưa gán format'} · {item.persona || 'Chưa gán persona'}</span>
                      <span className="mr-cell-secondary mr-clamp" title={item.hook}>{item.hook || 'Chưa có hook'}</span>
                      {item.cta && <span className="mr-cell-tertiary mr-clamp">CTA: {item.cta}</span>}
                    </td>
                    <td data-label="Kênh">
                      <div className="mr-chip-list">
                        {item.platforms.length > 0
                          ? item.platforms.map((platform) => <span className="mr-chip" key={platform}>{platform}</span>)
                          : <span className="mr-cell-secondary">Chưa gán</span>}
                      </div>
                    </td>
                    <td data-label="Approval"><StatusBadge value={item.approvalStatus} /></td>
                    <td data-label="Publish"><StatusBadge value={item.publishStatus} /></td>
                    <td data-label="Proof"><StatusBadge value={item.proofStatus} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <ReadOnlyNote />
    </div>
  );
}

function ReviewTab({ snapshot, openPath, busy }: TabProps) {
  const [filter, setFilter] = useState<ReviewFilter>('all');
  const humanGates = snapshot.humanGates ?? [];
  const filteredReviews = useMemo(
    () => snapshot.reviews.filter((item) => filter === 'all' || item.type === filter),
    [filter, snapshot.reviews],
  );
  const countFor = (type: ReviewFilter) => (
    type === 'all' ? snapshot.reviews.length : snapshot.reviews.filter((item) => item.type === type).length
  );

  return (
    <div className="mr-tab-stack">
      <div className="mr-quality-grid" aria-label="Tổng quan chất lượng">
        <article>
          <span>SEO quality pass</span>
          <strong>{snapshot.quality.seoQualityPassed}/{snapshot.quality.seoTotal}</strong>
          <small>{snapshot.quality.seoPublished} đã published</small>
        </article>
        <article>
          <span>Case studies</span>
          <strong>{snapshot.quality.caseStudyPublishReady}/{snapshot.quality.caseStudyTotal}</strong>
          <small>{snapshot.quality.caseStudyDrafts} bản nháp hiện có</small>
        </article>
        <article>
          <span>Proof available</span>
          <strong>{snapshot.quality.proofAvailable}/{snapshot.quality.proofTotal}</strong>
          <small>Bằng chứng có thể đối chiếu</small>
        </article>
      </div>

      <section className="mr-panel mr-human-gates">
        <SectionHeading
          title="Human gates now"
          description="Ba quyết định cần người thật; Marketing Room chỉ đọc và mở nguồn đối chiếu."
        />
        {humanGates.length === 0 ? (
          <EmptyPanel
            title="Chưa có human gate packet"
            description="Tạo tasks/human-gates-now.json trong marketing workspace để theo dõi các quyết định đang chặn."
          />
        ) : (
          <div className="mr-review-list mr-human-gate-list">
            {humanGates.map((gate) => (
              <article className="mr-review-item mr-review-item--human-gate" key={gate.id}>
                <div className="mr-review-item__topline">
                  <span className="mr-eyebrow">{gate.kind === 'case-study' ? 'Case study' : gate.kind.toUpperCase()}</span>
                  <StatusBadge value={gate.status} />
                </div>
                <h3>{HUMAN_GATE_TITLES[gate.id] ?? humanize(gate.sourceId)}</h3>
                <p>{gate.detail}</p>
                <span className="mr-human-gate__owner">{humanGateOwner(gate)}</span>
                <div className="mr-review-item__footer mr-human-gate__footer">
                  <span
                    className={`mr-gate-safety ${gate.externalActionsAllowed ? 'mr-gate-safety--warning' : 'mr-gate-safety--blocked'}`}
                    role="status"
                  >
                    <strong>{gate.externalActionsAllowed ? 'External actions enabled' : 'External actions blocked'}</strong>
                    <small>{gate.externalActionsAllowed ? 'Kiểm tra quyền trước khi tiếp tục' : 'Không publish, post hoặc spend'}</small>
                  </span>
                  <button className="mr-text-btn mr-human-gate__open" type="button" onClick={() => openPath(gate.sourcePath)} disabled={busy}>
                    Mở hồ sơ local ↗
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="mr-panel mr-panel--table">
        <SectionHeading title="Human review queue" description="Tập hợp social, SEO và case study cần quyết định của người duyệt." />
        <div className="mr-filter-bar" role="group" aria-label="Lọc hàng đợi review">
          {([
            ['all', 'Tất cả'],
            ['social', 'Social'],
            ['seo', 'SEO'],
            ['case-study', 'Case study'],
          ] as Array<[ReviewFilter, string]>).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={filter === id ? 'is-active' : ''}
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
            >
              {label} <span>{countFor(id)}</span>
            </button>
          ))}
        </div>
        {filteredReviews.length === 0 ? (
          <EmptyPanel
            title={snapshot.reviews.length === 0 ? 'Review queue đang trống' : 'Không có mục phù hợp'}
            description={snapshot.reviews.length === 0
              ? 'Chưa có social, SEO hoặc case study nào chờ duyệt.'
              : 'Chọn một nhóm khác để xem các mục review còn lại.'}
          />
        ) : (
          <div className="mr-review-list">
            {filteredReviews.map((item, index) => (
              <article className="mr-review-item" key={`${item.type}-${item.id}-${index}`}>
                <div className="mr-review-item__topline">
                  <span className="mr-eyebrow">{item.type === 'case-study' ? 'Case study' : item.type}</span>
                  <StatusBadge value={item.status} />
                </div>
                <h3>{item.title || item.id || 'Review item'}</h3>
                <p>{humanize(item.recommendation)}</p>
                <div className="mr-review-item__footer">
                  <span className={item.warnings > 0 ? 'mr-warning-text' : 'mr-muted'}>
                    {item.warnings > 0 ? `${item.warnings} cảnh báo` : 'Không có cảnh báo'}
                  </span>
                  <button className="mr-text-btn" type="button" onClick={() => openPath(item.sourcePath)} disabled={busy}>
                    Mở nguồn ↗
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <ReadOnlyNote />
    </div>
  );
}

function VideoTab({ snapshot, openPath, busy }: TabProps) {
  const { toolchain } = snapshot;
  return (
    <div className="mr-tab-stack">
      {toolchain.blockingReason && (
        <div className="mr-alert mr-alert--danger" role="alert">
          <strong>Commercial render đang bị chặn</strong>
          <span>{toolchain.blockingReason}</span>
        </div>
      )}

      <div className="mr-toolchain-grid" aria-label="Video toolchain">
        <article>
          <div><span>HyperFrames</span><StatusBadge value={toolchain.hyperframesInstalled ? 'ready' : 'blocked'} /></div>
          <strong>{toolchain.hyperframesInstalled ? `v${toolchain.hyperframesVersion ?? 'unknown'}` : 'Chưa cài đặt'}</strong>
          <small>Motion composition engine</small>
        </article>
        <article>
          <div><span>FFmpeg</span><StatusBadge value={toolchain.ffmpegConfigured ? 'ready' : 'blocked'} /></div>
          <strong>{toolchain.ffmpegConfigured ? 'Đã kết nối' : 'Chưa cấu hình'}</strong>
          <small>{toolchain.ffmpegBinPath || 'Encoder / media probe'}</small>
        </article>
        <article>
          <div><span>Video template</span><StatusBadge value={toolchain.templateConfigured ? 'ready' : 'blocked'} /></div>
          <strong>{toolchain.templateConfigured ? 'Đã kết nối' : 'Chưa cấu hình'}</strong>
          <small>Yêu cầu video-workflow.json</small>
        </article>
        <article>
          <div><span>F5 voice</span><StatusBadge value={toolchain.f5Configured ? 'ready' : 'attention'} /></div>
          <strong>{toolchain.f5Provider || 'Chưa cấu hình'}</strong>
          <small>{toolchain.f5ModelLicense ? `License: ${toolchain.f5ModelLicense}` : 'Chưa ghi nhận license'}</small>
        </article>
        <article>
          <div><span>Commercial use</span><StatusBadge value={toolchain.commercialRenderAllowed ? 'ready' : 'blocked'} /></div>
          <strong>{toolchain.commercialRenderAllowed ? 'Không phát hiện chặn' : 'Không được phép'}</strong>
          <small>Luôn cần duyệt render riêng cho từng job</small>
        </article>
      </div>

      <section className="mr-panel mr-panel--table">
        <SectionHeading title="Video jobs" description="Workflow và asset đã phát hiện trong workspace; không có lệnh render tại đây." />
        {snapshot.videoJobs.length === 0 ? (
          <EmptyPanel
            title="Chưa có video job"
            description="Kết nối template, sau đó thêm workflow vào campaigns/video-jobs hoặc campaigns/video-assets."
          />
        ) : (
          <div className="mr-table-wrap">
            <table className="mr-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Workflow</th>
                  <th>License</th>
                  <th>Render gate</th>
                  <th>Cập nhật</th>
                  <th aria-label="Hành động" />
                </tr>
              </thead>
              <tbody>
                {snapshot.videoJobs.map((job) => (
                  <tr key={job.id}>
                    <td data-label="Project">
                      <span className="mr-cell-primary">{job.title}</span>
                      <span className="mr-cell-secondary">{job.id}</span>
                    </td>
                    <td data-label="Workflow">
                      <StatusBadge value={job.status} />
                      <span className="mr-cell-secondary">{job.provider} · {job.format}</span>
                    </td>
                    <td data-label="License">
                      <StatusBadge value={job.commercialUseAllowed ? 'ready' : 'blocked'} label={job.license || (job.commercialUseAllowed ? 'Allowed' : 'Blocked')} />
                    </td>
                    <td data-label="Render gate">
                      <StatusBadge value={job.renderApproved ? 'approved' : 'pending'} label={job.renderApproved ? 'Đã duyệt' : 'Chờ duyệt'} />
                    </td>
                    <td data-label="Cập nhật">{formatDate(job.updatedAt, true)}</td>
                    <td data-label="">
                      <button className="mr-text-btn" type="button" onClick={() => openPath(job.projectPath)} disabled={busy}>
                        Mở project ↗
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <ReadOnlyNote />
    </div>
  );
}

function AnalyticsTab({ snapshot, openPath, busy, analyticsApi }: AnalyticsTabProps) {
  const initialRange = useMemo(() => currentMonthDateRange(), []);
  const [fromDate, setFromDate] = useState(initialRange.fromDate);
  const [toDate, setToDate] = useState(initialRange.toDate);
  const [report, setReport] = useState<CustomerMarketingAnalyticsReport | null>(null);
  const [analyticsStatus, setAnalyticsStatus] = useState<CustomerMarketingAnalyticsResult['status']>('local');
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const analyticsRequestId = useRef(0);

  const loadAnalytics = useCallback(async (range: AnalyticsDateRange) => {
    const window = analyticsWindowFromDates(range);
    const requestId = ++analyticsRequestId.current;
    if (!window) {
      setReport(null);
      setAnalyticsStatus('unavailable');
      setAnalyticsError('Khoảng ngày phải hợp lệ và không vượt quá 366 ngày.');
      setAnalyticsLoading(false);
      return;
    }
    if (!analyticsApi) {
      setReport(null);
      setAnalyticsStatus('local');
      setAnalyticsError('Analytics đồng bộ chỉ khả dụng trong Izzi AI Desktop.');
      setAnalyticsLoading(false);
      return;
    }

    setAnalyticsLoading(true);
    setAnalyticsError(null);
    setReport(null);
    try {
      const result = await analyticsApi.getMarketingAnalytics(window);
      if (analyticsRequestId.current !== requestId) return;
      setAnalyticsStatus(result.status);
      if (result.ok && result.status === 'synced' && result.report) {
        setReport(result.report);
      } else {
        setAnalyticsError(analyticsFailureMessage(result));
      }
    } catch (reason) {
      if (analyticsRequestId.current !== requestId) return;
      setAnalyticsStatus('unavailable');
      setAnalyticsError(reason instanceof Error ? reason.message : 'Không thể tải báo cáo analytics.');
    } finally {
      if (analyticsRequestId.current === requestId) setAnalyticsLoading(false);
    }
  }, [analyticsApi]);

  useEffect(() => {
    void loadAnalytics(initialRange);
    return () => {
      analyticsRequestId.current += 1;
    };
  }, [initialRange, loadAnalytics]);

  const budgetUsage = percentage(snapshot.spend.actualSpendVnd, snapshot.spend.monthlyBudgetVnd);
  return (
    <div className="mr-tab-stack">
      <section className="mr-panel mr-analytics-report-controls" aria-busy={analyticsLoading}>
        <SectionHeading
          title="Báo cáo dữ liệu đã lưu"
          description="Inventory, activity, lịch nội dung và direct campaign attribution theo UTC."
          action={(
            <StatusBadge
              value={analyticsLoading ? 'pending' : analyticsStatus}
              label={analyticsLoading ? 'Đang tải' : analyticsStatus === 'synced' ? 'Đã đồng bộ' : humanize(analyticsStatus)}
            />
          )}
        />
        <form
          className="mr-analytics-controls"
          onSubmit={(event) => {
            event.preventDefault();
            void loadAnalytics({ fromDate, toDate });
          }}
        >
          <label>
            <span>Từ ngày</span>
            <input
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.currentTarget.value)}
              disabled={analyticsLoading || busy}
            />
          </label>
          <label>
            <span>Đến ngày</span>
            <input
              type="date"
              value={toDate}
              onChange={(event) => setToDate(event.currentTarget.value)}
              disabled={analyticsLoading || busy}
            />
          </label>
          <button className="mr-btn mr-btn--primary" type="submit" disabled={analyticsLoading || busy}>
            {analyticsLoading ? 'Đang tải…' : 'Tải báo cáo'}
          </button>
        </form>
        <div className="mr-analytics-report-status" aria-live="polite">
          {analyticsError && <span className="mr-analytics-report-status__error">{analyticsError}</span>}
          {report && (
            <span>
              Cập nhật {formatDate(report.generatedAt, true)} · nguồn {report.source}
            </span>
          )}
        </div>
      </section>

      {analyticsLoading && !report && <div className="mr-skeleton mr-skeleton--panel" aria-hidden="true" />}

      {report && (
        <>
          <div className="mr-metrics" aria-label="Chỉ số analytics đã xác minh">
            <MetricCard
              label="Tổng tài nguyên"
              value={formatCount(report.inventory.total)}
              hint={`${report.inventory.campaigns} campaign · ${report.inventory.content} nội dung`}
            />
            <MetricCard
              label="Cập nhật trong kỳ"
              value={formatCount(report.activity.updatedInWindow)}
              hint="Theo resource_updated_at"
              tone="positive"
            />
            <MetricCard
              label="Nội dung đã lên lịch"
              value={formatCount(report.schedule.contentScheduledInWindow)}
              hint="Theo content_scheduled_at"
              tone="warning"
            />
            <MetricCard
              label="Đã gắn campaign"
              value={formatCount(report.attribution.attributedContent)}
              hint={`${report.attribution.unattributedContent} chưa gắn · ${report.attribution.unresolvedCampaignLinks} link lỗi`}
              tone={report.attribution.unresolvedCampaignLinks > 0 ? 'warning' : 'positive'}
            />
          </div>

          <div className="mr-analytics-grid">
            <section className="mr-panel">
              <SectionHeading title="Activity theo loại" description="Tài nguyên cập nhật trong khoảng đã chọn." />
              <div className="mr-analytics-breakdown">
                {(Object.entries(report.activity.byKind) as Array<[
                  keyof CustomerMarketingAnalyticsReport['activity']['byKind'],
                  number,
                ]>).map(([kind, count]) => (
                  <div key={kind}>
                    <span>{ANALYTICS_KIND_LABELS[kind]}</span>
                    <strong>{formatCount(count)}</strong>
                  </div>
                ))}
              </div>
              <div className="mr-analytics-status-strip">
                {(Object.entries(report.activity.byStatus) as Array<[
                  keyof CustomerMarketingAnalyticsReport['activity']['byStatus'],
                  number,
                ]>).map(([status, count]) => (
                  <span key={status}>{ANALYTICS_STATUS_LABELS[status]} <strong>{formatCount(count)}</strong></span>
                ))}
              </div>
            </section>

            <section className="mr-panel">
              <SectionHeading title="Lịch theo kênh" description="Nội dung có scheduledAt trong khoảng đã chọn." />
              {report.schedule.byChannel.length === 0 ? (
                <EmptyPanel title="Chưa có nội dung lên lịch" description="Không có scheduled content trong khoảng này." />
              ) : (
                <div className="mr-analytics-breakdown">
                  {report.schedule.byChannel.map((item) => (
                    <div key={item.channel}>
                      <span>{PLATFORM_LABELS[item.channel] ?? humanize(item.channel)}</span>
                      <strong>{formatCount(item.count)}</strong>
                    </div>
                  ))}
                </div>
              )}
              <div className="mr-analytics-status-strip">
                {(Object.entries(report.schedule.byStatus) as Array<[
                  keyof CustomerMarketingAnalyticsReport['schedule']['byStatus'],
                  number,
                ]>).filter(([, count]) => count > 0).map(([status, count]) => (
                  <span key={status}>{ANALYTICS_STATUS_LABELS[status]} <strong>{formatCount(count)}</strong></span>
                ))}
              </div>
            </section>
          </div>

          <section className="mr-panel mr-panel--table">
            <SectionHeading
              title="Direct campaign attribution"
              description={`${report.attribution.contentConsidered} nội dung · model direct_campaign_id`}
            />
            {report.attribution.campaigns.length === 0 ? (
              <EmptyPanel title="Chưa có attribution" description="Không có nội dung trong kỳ gắn campaignId hợp lệ." />
            ) : (
              <div className="mr-table-wrap">
                <table className="mr-table">
                  <thead>
                    <tr>
                      <th>Campaign</th>
                      <th>Nội dung</th>
                      <th>Đã lên lịch</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.attribution.campaigns.slice(0, 100).map((campaign) => (
                      <tr key={campaign.campaignId}>
                        <td data-label="Campaign">
                          <span className="mr-cell-primary">{campaign.title}</span>
                          <span className="mr-cell-secondary">{campaign.campaignId}</span>
                        </td>
                        <td data-label="Nội dung">{formatCount(campaign.contentCount)}</td>
                        <td data-label="Đã lên lịch">{formatCount(campaign.scheduledContentCount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="mr-panel mr-analytics-availability" role="status">
            <div>
              <span className="mr-eyebrow">Hiệu suất nền tảng</span>
              <h2>Chưa có nguồn ngoài đã xác minh</h2>
              <p>Report không suy diễn các chỉ số chưa được kết nối.</p>
            </div>
            <div className="mr-omitted-metrics" aria-label="Chỉ số chưa khả dụng">
              {report.dataAvailability.performanceMetrics.omittedMetrics.map((metric) => (
                <span key={metric}>{humanize(metric)}</span>
              ))}
            </div>
          </section>
        </>
      )}

      {!report && !analyticsLoading && (
        <section className="mr-panel mr-analytics-availability" role="status">
          <div>
            <span className="mr-eyebrow">Hiệu suất nền tảng</span>
            <h2>Chưa có nguồn ngoài đã xác minh</h2>
            <p>{analyticsError ?? 'Không có nguồn hiệu suất bên ngoài đã xác minh cho workspace này.'}</p>
          </div>
          <div className="mr-omitted-metrics" aria-label="Chỉ số chưa khả dụng">
            {['impressions', 'reach', 'clicks', 'conversions', 'revenue'].map((metric) => (
              <span key={metric}>{humanize(metric)}</span>
            ))}
          </div>
        </section>
      )}

      <div className="mr-analytics-grid">
        <section className="mr-panel mr-spend-panel">
          <SectionHeading
            title="Budget evidence"
            description="Đối chiếu dữ liệu đã ghi nhận; Marketing Room không khởi tạo chi tiêu."
            action={(
              <button className="mr-btn mr-btn--quiet" type="button" onClick={() => openPath('analytics')} disabled={busy}>
                Mở analytics
              </button>
            )}
          />
          <div className="mr-spend-amounts">
            <div>
              <span>Thực chi</span>
              <strong>{formatVnd(snapshot.spend.actualSpendVnd)}</strong>
            </div>
            <div>
              <span>Ngân sách tháng</span>
              <strong>{formatVnd(snapshot.spend.monthlyBudgetVnd)}</strong>
            </div>
          </div>
          <progress className="mr-progress mr-progress--large" max={100} value={Math.max(0, Math.min(budgetUsage, 100))}>
            {budgetUsage}%
          </progress>
          <div className="mr-spend-foot">
            <span>{snapshot.spend.monthlyBudgetVnd > 0 ? `${budgetUsage}% ngân sách đã ghi nhận` : 'Chưa khai báo ngân sách tháng'}</span>
            <strong>{snapshot.spend.verifiedZeroSpendEntries} zero-spend attestations</strong>
          </div>
        </section>

        <section className="mr-panel">
          <SectionHeading title="Content flow" description="Phân bố trạng thái hiện tại trong publishing queue." />
          <div className="mr-distribution">
            {[
              ['Đã duyệt', snapshot.content.approved, 'positive'],
              ['Đã lên lịch', snapshot.content.scheduled, 'warning'],
              ['Đã published', snapshot.content.published, 'neutral'],
              ['Cảnh báo', snapshot.content.warnings, 'negative'],
            ].map(([label, value, tone]) => (
              <div key={String(label)}>
                <span>{label}</span>
                <strong className={`mr-tone-${tone}`}>{value}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="mr-panel">
        <SectionHeading title="Quality coverage" description="Mức bao phủ bằng chứng và readiness theo từng nhóm tài sản." />
        <div className="mr-coverage-list">
          {[
            { label: 'SEO quality gate', value: snapshot.quality.seoQualityPassed, total: snapshot.quality.seoTotal },
            { label: 'Case study publish-ready', value: snapshot.quality.caseStudyPublishReady, total: snapshot.quality.caseStudyTotal },
            { label: 'Proof available', value: snapshot.quality.proofAvailable, total: snapshot.quality.proofTotal },
          ].map((item) => (
            <div className="mr-coverage-row" key={item.label}>
              <div>
                <span>{item.label}</span>
                <strong>{item.value}/{item.total}</strong>
              </div>
              <progress className="mr-progress" max={100} value={percentage(item.value, item.total)}>
                {percentage(item.value, item.total)}%
              </progress>
              <span>{percentage(item.value, item.total)}%</span>
            </div>
          ))}
        </div>
      </section>
      <ReadOnlyNote />
    </div>
  );
}

function IntegrationsTab({ snapshot }: TabProps) {
  return (
    <div className="mr-tab-stack">
      <section className="mr-panel">
        <SectionHeading
          title="Channel readiness"
          description="Trạng thái cấu hình được đọc từ các readiness files; không kết nối hay đăng bài từ màn hình này."
        />
        {snapshot.platforms.length === 0 ? (
          <EmptyPanel title="Chưa có dữ liệu tích hợp" description="Workspace chưa cung cấp trạng thái readiness của các kênh." />
        ) : (
          <div className="mr-integration-grid">
            {snapshot.platforms.map((item) => (
              <article className="mr-integration-card" key={item.platform}>
                <div className="mr-integration-card__head">
                  <span className="mr-platform-mark" aria-hidden="true">{PLATFORM_LABELS[item.platform]?.slice(0, 1) || '•'}</span>
                  <div>
                    <h3>{PLATFORM_LABELS[item.platform] ?? humanize(item.platform)}</h3>
                    <span>{item.checkedAt ? `Kiểm tra ${formatDate(item.checkedAt, true)}` : 'Chưa có thời điểm kiểm tra'}</span>
                  </div>
                  <HealthBadge health={item.health} />
                </div>
                <p>{humanize(item.recommendation)}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="mr-panel">
        <SectionHeading title="Automation boundaries" description="Những ranh giới được giữ cố định trong Marketing Room." />
        <div className="mr-boundary-grid">
          <article>
            <span className="mr-boundary-icon" aria-hidden="true">✓</span>
            <div><strong>Read-only snapshot</strong><p>Chỉ đọc dữ liệu từ workspace đã chọn.</p></div>
          </article>
          <article>
            <span className="mr-boundary-icon" aria-hidden="true">✓</span>
            <div><strong>Human approval visible</strong><p>Gate duyệt và proof luôn được hiển thị.</p></div>
          </article>
          <article>
            <span className="mr-boundary-icon" aria-hidden="true">—</span>
            <div><strong>No publish controls</strong><p>Không có API hay nút publish/schedule.</p></div>
          </article>
          <article>
            <span className="mr-boundary-icon" aria-hidden="true">—</span>
            <div><strong>No spend controls</strong><p>Không tạo campaign trả phí hoặc giao dịch.</p></div>
          </article>
        </div>
      </section>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="mr-page mr-page--loading" aria-busy="true" aria-label="Đang tải Marketing Room">
      <div className="mr-skeleton mr-skeleton--title" />
      <div className="mr-skeleton mr-skeleton--bar" />
      <div className="mr-skeleton-grid">
        {Array.from({ length: 4 }, (_, index) => <div className="mr-skeleton mr-skeleton--card" key={index} />)}
      </div>
      <div className="mr-skeleton mr-skeleton--panel" />
    </div>
  );
}

export function MarketingRoomPage() {
  const desktopWindow = window as Window & {
    electronAPI?: { marketing?: MarketingApi; customerMarketing?: CustomerAnalyticsApi };
  };
  const api = desktopWindow.electronAPI?.marketing;
  const customerAnalyticsApi = desktopWindow.electronAPI?.customerMarketing;
  const [snapshot, setSnapshot] = useState<MarketingWorkspaceSnapshot | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!api) {
      setError('Marketing Room chỉ khả dụng trong ứng dụng Izzi AI Desktop.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setBusyAction('refresh');
    setError(null);
    try {
      setSnapshot(await api.getSnapshot());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể tải marketing snapshot.');
    } finally {
      setLoading(false);
      setBusyAction(null);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const applySelection = useCallback(async (kind: 'workspace' | 'template') => {
    if (!api) return;
    setBusyAction(kind);
    setError(null);
    try {
      const result = kind === 'workspace'
        ? await api.selectWorkspace()
        : await api.selectVideoTemplate();
      if (result.error) {
        setError(result.error);
      } else if (!result.canceled && result.snapshot) {
        setSnapshot(result.snapshot);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể chọn thư mục.');
    } finally {
      setBusyAction(null);
    }
  }, [api]);

  const openPath = useCallback(async (relativePath: string) => {
    if (!api) return;
    setBusyAction(`open:${relativePath}`);
    setError(null);
    try {
      const result = await api.openPath(relativePath);
      if (!result.ok) setError(result.error || 'Không thể mở đường dẫn.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không thể mở đường dẫn.');
    } finally {
      setBusyAction(null);
    }
  }, [api]);

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = TABS.findIndex((tab) => tab.id === activeTab);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = TABS.length - 1;
    else return;
    event.preventDefault();
    setActiveTab(TABS[nextIndex].id);
    const tabButtons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabButtons?.[nextIndex]?.focus();
  };

  if (!snapshot && loading) return <LoadingState />;

  if (!snapshot) {
    return (
      <div className="mr-page">
        <EmptyPanel
          title="Không thể tải Marketing Room"
          description={error || 'Marketing snapshot chưa sẵn sàng.'}
          action={api ? (
            <button className="mr-btn mr-btn--primary" type="button" onClick={() => void refresh()}>
              Thử lại
            </button>
          ) : undefined}
        />
      </div>
    );
  }

  const busy = busyAction !== null;
  const snapshotError = snapshot.error && snapshot.connected ? snapshot.error : null;

  return (
    <div className="mr-page" aria-busy={loading || busy}>
      {(loading || busyAction === 'refresh') && <div className="mr-refresh-line" aria-hidden="true" />}

      <header className="mr-header">
        <div className="mr-header__copy">
          <div className="mr-kicker"><span aria-hidden="true" /> Marketing operations</div>
          <h1>Marketing Room</h1>
          <p>{snapshot.connected ? `Đang vận hành · snapshot ${formatDate(snapshot.generatedAt, true)}` : 'Đang chờ kết nối workspace'}</p>
        </div>
        <div className="mr-header__actions">
          <button className="mr-btn mr-btn--quiet" type="button" onClick={() => void refresh()} disabled={busy}>
            <span aria-hidden="true">↻</span> {busyAction === 'refresh' ? 'Đang tải…' : 'Làm mới'}
          </button>
          <button className="mr-btn mr-btn--quiet" type="button" onClick={() => void applySelection('template')} disabled={busy}>
            {busyAction === 'template' ? 'Đang chọn…' : 'Chọn video template'}
          </button>
          <button className="mr-btn mr-btn--primary" type="button" onClick={() => void applySelection('workspace')} disabled={busy}>
            {busyAction === 'workspace' ? 'Đang kết nối…' : snapshot.connected ? 'Đổi workspace' : 'Chọn workspace'}
          </button>
        </div>
      </header>

      {error && (
        <div className="mr-alert mr-alert--danger" role="alert">
          <div><strong>Thao tác chưa hoàn tất</strong><span>{error}</span></div>
          <button type="button" onClick={() => setError(null)} aria-label="Đóng thông báo">×</button>
        </div>
      )}

      {snapshotError && (
        <div className="mr-alert mr-alert--warning" role="status">
          <strong>Snapshot có cảnh báo</strong><span>{snapshotError}</span>
        </div>
      )}

      {!snapshot.connected ? (
        <section className="mr-connect-state">
          <div className="mr-connect-state__mark" aria-hidden="true">M</div>
          <span className="mr-eyebrow">Workspace required</span>
          <h2>{snapshot.workspacePath ? 'Không thể đọc workspace' : 'Kết nối izziAi Marketing workspace'}</h2>
          <p>{snapshot.error || 'Chọn thư mục chứa tasks/marketing-backlog.csv và campaigns/30-day-content-calendar.csv.'}</p>
          {snapshot.workspacePath && <code>{snapshot.workspacePath}</code>}
          <div className="mr-inline-actions">
            <button className="mr-btn mr-btn--primary" type="button" onClick={() => void applySelection('workspace')} disabled={busy}>
              Chọn workspace
            </button>
            <button className="mr-btn mr-btn--quiet" type="button" onClick={() => void refresh()} disabled={busy}>
              Kiểm tra lại
            </button>
          </div>
          <div className="mr-requirements">
            <span>Yêu cầu tối thiểu</span>
            <code>tasks/marketing-backlog.csv</code>
            <code>campaigns/30-day-content-calendar.csv</code>
          </div>
        </section>
      ) : (
        <>
          <section className="mr-workspace-bar" aria-label="Workspace đang kết nối">
            <span className="mr-health-dot mr-health-dot--ready" aria-hidden="true" />
            <div className="mr-workspace-bar__copy">
              <strong>{snapshot.workspaceName || 'Marketing workspace'}</strong>
              <span title={snapshot.workspacePath}>{snapshot.workspacePath}</span>
            </div>
            <div className="mr-workspace-bar__meta">
              <span>Snapshot {formatDate(snapshot.generatedAt, true)}</span>
              <button className="mr-text-btn" type="button" onClick={() => void openPath('dashboard.html')} disabled={busy}>
                Mở dashboard ↗
              </button>
            </div>
          </section>

          <nav className="mr-tabs" role="tablist" aria-label="Marketing Room sections">
            {TABS.map((tab) => (
              <button
                id={`mr-tab-${tab.id}`}
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                aria-controls={`mr-panel-${tab.id}`}
                tabIndex={activeTab === tab.id ? 0 : -1}
                className={activeTab === tab.id ? 'is-active' : ''}
                onClick={() => setActiveTab(tab.id)}
                onKeyDown={onTabKeyDown}
              >
                {tab.label}
                {tab.id === 'review' && snapshot.reviews.length + (snapshot.humanGates?.length ?? 0) > 0 && (
                  <span>{snapshot.reviews.length + (snapshot.humanGates?.length ?? 0)}</span>
                )}
              </button>
            ))}
          </nav>

          <main
            className="mr-tab-panel"
            id={`mr-panel-${activeTab}`}
            role="tabpanel"
            aria-labelledby={`mr-tab-${activeTab}`}
          >
            {activeTab === 'overview' && <OverviewTab snapshot={snapshot} openPath={(path) => void openPath(path)} busy={busy} />}
            {activeTab === 'content' && <ContentTab snapshot={snapshot} openPath={(path) => void openPath(path)} busy={busy} />}
            {activeTab === 'review' && <ReviewTab snapshot={snapshot} openPath={(path) => void openPath(path)} busy={busy} />}
            {activeTab === 'video' && <VideoTab snapshot={snapshot} openPath={(path) => void openPath(path)} busy={busy} />}
            {activeTab === 'analytics' && (
              <AnalyticsTab
                snapshot={snapshot}
                openPath={(path) => void openPath(path)}
                busy={busy}
                analyticsApi={customerAnalyticsApi}
              />
            )}
            {activeTab === 'integrations' && <IntegrationsTab snapshot={snapshot} openPath={(path) => void openPath(path)} busy={busy} />}
          </main>
        </>
      )}
    </div>
  );
}

export default MarketingRoomPage;
