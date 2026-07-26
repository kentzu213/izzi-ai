import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type FormEvent,
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
  onDirector: (goal: string) => Promise<void>;
}

const BRIDGE_LABELS: Record<CustomerMarketingBridgeStatus, string> = {
  synced: 'Verified workspace data',
  local: 'Local mode only',
  forbidden: 'Permission required',
  not_found: 'Workspace not found',
  conflict: 'Refresh required',
  quota_exceeded: 'Workspace quota exceeded',
  unavailable: 'Bridge unavailable',
};
const CREATIVE_CHANNELS: CustomerChannel[] = [
  'facebook', 'tiktok', 'youtube', 'website', 'telegram', 'x', 'seo',
];
const CREATIVE_FORMATS = [
  'Short video', 'Social post', 'Carousel', 'Landing page', 'Email sequence',
] as const;
const ANALYTICS_KIND_KEYS = ['campaign', 'content', 'asset', 'knowledge'] as const;
const ANALYTICS_STATUS_KEYS = ['draft', 'inReview', 'approved', 'rejected', 'archived'] as const;
const ANALYTICS_KIND_LABELS = {
  campaign: 'Campaigns',
  content: 'Content',
  asset: 'Assets',
  knowledge: 'Knowledge',
} as const;
const ANALYTICS_STATUS_LABELS = {
  draft: 'Draft',
  inReview: 'In review',
  approved: 'Approved',
  rejected: 'Rejected',
  archived: 'Archived',
} as const;

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
  return new Intl.NumberFormat('en-US').format(value);
}
function formatDate(value: string | null | undefined, includeTime = false): string {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not recorded';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
}
function statusTone(value: string): 'positive' | 'warning' | 'negative' | 'neutral' {
  if (['synced', 'approved', 'ready', 'pass', 'available'].includes(value)) return 'positive';
  if (['forbidden', 'blocked', 'rejected', 'unavailable', 'error'].includes(value)) return 'negative';
  if (['pending', 'local', 'warning', 'draft', 'in_review', 'conflict'].includes(value)) return 'warning';
  return 'neutral';
}
function WorkbenchPill({ value, label }: { value: string; label?: string }) {
  return (
    <span className={`cmr-pill cmr-pill--${statusTone(value)}`}>
      <span className="cmr-pill__dot" />
      {label ?? value.replace(/[_-]+/g, ' ')}
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
          Back to Apps
        </button>
      </div>
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
      setError('Creative Studio requires Starizzi Desktop.');
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
      setError('A brief title and concept are required.');
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
        ? 'The brief already exists; no duplicate was created.'
        : 'Saved as a content draft. Scheduling and publishing remain separate.');
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
        eyebrow="Creative production"
        title="Creative Studio"
        description="Turn a user-authored idea into a content brief and connect it to registered workspace assets."
        icon={DesignIcon}
        onBack={onBack}
      />
      <div className="cmr-workbench-status">
        <span>
          <span className="cmr-workbench-status__dot" />
          {loading ? 'Loading registered assets...' : bridgeMessage(status)}
        </span>
        <button
          type="button"
          className="cmr-icon-button"
          onClick={() => void loadAssets()}
          disabled={loading || busy}
          title="Refresh assets"
          aria-label="Refresh assets"
        >
          <RefreshIcon className="cmr-icon" />
        </button>
      </div>
      {error && <div className="cmr-alert cmr-alert--error" role="alert">{error}</div>}
      {notice && <div className="cmr-alert cmr-alert--success" role="status">{notice}</div>}
      <div className="cmr-workbench-grid cmr-workbench-grid--creative">
        <section className="cmr-panel cmr-workbench-panel">
          <div className="cmr-section-heading">
            <div><span className="cmr-eyebrow">01 / Brief</span><h3>Create a content brief</h3></div>
            <WorkbenchPill
              value={canEdit ? 'ready' : 'blocked'}
              label={canEdit ? 'Draft access' : 'View only'}
            />
          </div>
          <form className="cmr-workbench-form" onSubmit={createBrief} aria-busy={busy}>
            <WorkbenchField
              label="Brief title"
              value={brief.title}
              onChange={(value) => updateBrief('title', value)}
              placeholder="IzziAPI 30-second explainer"
              disabled={!canEdit || busy}
            />
            <WorkbenchField
              label="Core concept"
              value={brief.concept}
              onChange={(value) => updateBrief('concept', value)}
              placeholder="Describe the hook and the audience promise."
              multiline
              disabled={!canEdit || busy}
            />
            <div className="cmr-workbench-form__row">
              <WorkbenchField
                label="Audience"
                value={brief.audience}
                onChange={(value) => updateBrief('audience', value)}
                placeholder={form.audience.segments || 'Use Audience Center'}
                disabled={!canEdit || busy}
              />
              <label className="cmr-field">
                <span className="cmr-field__label">Primary channel</span>
                <select
                  value={brief.channel}
                  onChange={(event) => updateBrief('channel', event.currentTarget.value)}
                  disabled={!canEdit || busy}
                >
                  {Array.from(new Set([...form.channels, ...CREATIVE_CHANNELS])).map(
                    (channel) => <option key={channel} value={channel}>{channel}</option>,
                  )}
                </select>
              </label>
            </div>
            <div className="cmr-workbench-form__row">
              <label className="cmr-field">
                <span className="cmr-field__label">Format</span>
                <select
                  value={brief.format}
                  onChange={(event) => updateBrief('format', event.currentTarget.value)}
                  disabled={!canEdit || busy}
                >
                  {CREATIVE_FORMATS.map((format) => (
                    <option key={format} value={format}>{format}</option>
                  ))}
                </select>
              </label>
              <WorkbenchField
                label="CTA"
                value={brief.cta}
                onChange={(value) => updateBrief('cta', value)}
                placeholder="Watch the free demo"
                disabled={!canEdit || busy}
              />
            </div>
            <div className="cmr-workbench-form__footer">
              <span className="cmr-muted">Stored as a workspace content draft.</span>
              <button
                type="submit"
                className="cmr-button cmr-button--primary"
                disabled={!canEdit || busy}
              >
                {busy ? 'Saving...' : 'Save brief'} <ContentIcon className="cmr-button__icon" />
              </button>
            </div>
          </form>
          {!canEdit && <p className="cmr-permission-note">The current role cannot create drafts.</p>}
        </section>
        <section className="cmr-panel cmr-workbench-panel">
          <div className="cmr-section-heading">
            <div><span className="cmr-eyebrow">02 / Registry</span><h3>Registered assets</h3></div>
            <strong className="cmr-workbench-count">{assets.length}</strong>
          </div>
          <p className="cmr-workbench-note">
            This is persisted metadata. No AI-generated file is implied.
          </p>
          {loading ? (
            <div className="cmr-workbench-skeleton" role="status" aria-label="Loading assets">
              <span /><span /><span />
            </div>
          ) : assets.length === 0 ? (
            <WorkbenchEmpty
              icon={DesignIcon}
              title="No registered assets"
              description="Register an asset before handing it to a creative workflow."
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
            Open all assets <DesignIcon className="cmr-button__icon" />
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
    return 'Connect and sync IzziAPI to load a verified report.';
  }
  if (result.status === 'forbidden') return 'The current role cannot view analytics.';
  if (result.status === 'not_found') return 'Analytics are not available for this workspace.';
  return 'The analytics report could not be loaded.';
}

function AnalyticsCopilotView({
  onBack,
  onDirector,
}: {
  onBack: () => void;
  onDirector: (goal: string) => Promise<void>;
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
      setError('Choose valid dates within a 366-day window.');
      setLoading(false);
      return;
    }
    const api = customerApi();
    if (!api) {
      setReport(null);
      setStatus('unavailable');
      setError('Analytics Copilot requires Starizzi Desktop.');
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
      setError(reason instanceof Error ? reason.message : 'Analytics request failed.');
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
      `Review verified marketing data from ${formatDate(report.window.from)} to ${formatDate(report.window.to)}. ${insights.join(' ')}`,
    );
    setConfirmInsight(false);
  };

  return (
    <div className="cmr-view-stack cmr-workbench">
      <WorkbenchHeader
        eyebrow="Decision support"
        title="Analytics Copilot"
        description="Read persisted inventory, activity, schedule, and direct campaign attribution without inventing performance metrics."
        icon={TrendUpIcon}
        onBack={onBack}
      />
      <section className="cmr-panel cmr-workbench-panel" aria-busy={loading}>
        <div className="cmr-section-heading">
          <div><span className="cmr-eyebrow">Report window</span><h3>Verified workspace report</h3></div>
          <WorkbenchPill
            value={loading ? 'pending' : status}
            label={loading ? 'Loading' : bridgeMessage(status)}
          />
        </div>
        <form className="cmr-workbench-controls" onSubmit={submitRange}>
          <WorkbenchField
            label="From"
            value={range.fromDate}
            onChange={(value) => setRange((current) => ({ ...current, fromDate: value }))}
            type="date"
            disabled={loading}
          />
          <WorkbenchField
            label="To"
            value={range.toDate}
            onChange={(value) => setRange((current) => ({ ...current, toDate: value }))}
            type="date"
            disabled={loading}
          />
          <button type="submit" className="cmr-button cmr-button--primary" disabled={loading}>
            {loading ? 'Loading...' : 'Load report'} <RefreshIcon className="cmr-button__icon" />
          </button>
        </form>
        {error && <div className="cmr-alert cmr-alert--error" role="alert">{error}</div>}
        {report && (
          <p className="cmr-workbench-note">
            Updated {formatDate(report.generatedAt, true)} / UTC / {report.window.activityBasis}
          </p>
        )}
      </section>
      {loading && !report && (
        <div className="cmr-workbench-skeleton cmr-workbench-skeleton--large" role="status" aria-label="Loading report">
          <span /><span /><span /><span />
        </div>
      )}
      {report && (
        <>
          <div className="cmr-metrics cmr-workbench-metrics" aria-label="Verified analytics">
            <div className="cmr-metric">
              <span>Total resources</span><strong>{formatCount(report.inventory.total)}</strong>
              <small>{report.inventory.campaigns} campaigns / {report.inventory.content} content</small>
            </div>
            <div className="cmr-metric cmr-metric--positive">
              <span>Updated in window</span><strong>{formatCount(report.activity.updatedInWindow)}</strong>
              <small>resource updated at</small>
            </div>
            <div className="cmr-metric cmr-metric--warning">
              <span>Scheduled content</span><strong>{formatCount(report.schedule.contentScheduledInWindow)}</strong>
              <small>content scheduled at</small>
            </div>
            <div className="cmr-metric cmr-metric--positive">
              <span>Campaign linked</span><strong>{formatCount(report.attribution.attributedContent)}</strong>
              <small>{report.attribution.unattributedContent} unlinked</small>
            </div>
          </div>
          <div className="cmr-workbench-grid cmr-workbench-grid--analytics">
            <section className="cmr-panel cmr-workbench-panel">
              <div className="cmr-section-heading">
                <div><span className="cmr-eyebrow">Activity</span><h3>By resource kind</h3></div>
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
                <div><span className="cmr-eyebrow">Schedule</span><h3>By channel</h3></div>
              </div>
              {report.schedule.byChannel.length === 0 ? (
                <WorkbenchEmpty
                  icon={PlanningIcon}
                  title="Nothing scheduled"
                  description="There is no scheduled content in this window."
                />
              ) : (
                <div className="cmr-workbench-breakdown">
                  {report.schedule.byChannel.map((item) => (
                    <div key={item.channel}>
                      <span>{item.channel}</span><strong>{formatCount(item.count)}</strong>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
          <section className="cmr-panel cmr-workbench-panel">
            <div className="cmr-section-heading">
              <div><span className="cmr-eyebrow">Copilot readout</span><h3>Evidence-based next checks</h3></div>
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
                Send summary to AI Director <SparkIcon className="cmr-button__icon" />
              </button>
            ) : (
              <div className="cmr-confirm-strip" role="dialog" aria-label="Confirm analytics handoff">
                <span>Send this verified summary to AI Director for a local plan?</span>
                <div className="cmr-inline-actions">
                  <button type="button" className="cmr-button cmr-button--quiet" onClick={() => setConfirmInsight(false)}>Cancel</button>
                  <button type="button" className="cmr-button cmr-button--primary" onClick={() => void sendInsightToDirector()}>Confirm</button>
                </div>
              </div>
            )}
          </section>
          <section className="cmr-panel cmr-workbench-availability" role="status">
            <StatusIcon className="cmr-icon" />
            <div>
              <strong>External performance data is unavailable</strong>
              <span>{report.dataAvailability.performanceMetrics.reason}</span>
              <small>No impressions, reach, clicks, conversions, or revenue are invented.</small>
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
      message: `Avoided term(s) found: ${avoidMatches.join(', ')}.`,
    });
  }
  if (!brand.tone.trim()) {
    findings.push({ level: 'warning', message: 'Brand Center has no tone of voice.' });
  }
  if (brand.wordsToUse.length > 0 && useMatches.length === 0) {
    findings.push({
      level: 'warning',
      message: 'No recommended brand term was found in this content.',
    });
  }
  if (findings.length === 0) {
    findings.push({ level: 'pass', message: 'No configured brand rule was violated.' });
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
      setError('Brand Guardian requires Starizzi Desktop.');
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
      setNotice('Submitted the clean revision to the human review queue.');
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
        eyebrow="Brand safety"
        title="Brand Guardian"
        description="Scan persisted content against Brand Center rules. The scan is evidence; a human still owns approval."
        icon={StatusIcon}
        onBack={onBack}
      />
      <div className="cmr-workbench-status">
        <span>
          <span className="cmr-workbench-status__dot" />
          {loading ? 'Scanning content...' : bridgeMessage(status)}
        </span>
        <button
          type="button"
          className="cmr-icon-button"
          onClick={() => void load()}
          disabled={loading || busyId !== null}
          title="Scan again"
          aria-label="Scan again"
        >
          <RefreshIcon className="cmr-icon" />
        </button>
      </div>
      {error && <div className="cmr-alert cmr-alert--error" role="alert">{error}</div>}
      {notice && <div className="cmr-alert cmr-alert--success" role="status">{notice}</div>}
      <div className="cmr-metrics cmr-workbench-metrics">
        <div className="cmr-metric"><span>Scanned</span><strong>{formatCount(scans.length)}</strong><small>Persisted content</small></div>
        <div className="cmr-metric cmr-metric--positive"><span>Passing</span><strong>{formatCount(scans.filter((scan) => scan.level === 'pass').length)}</strong><small>No configured violation</small></div>
        <div className="cmr-metric cmr-metric--warning"><span>Review</span><strong>{formatCount(warningCount)}</strong><small>Needs attention</small></div>
        <div className="cmr-metric cmr-metric--negative"><span>Blocked</span><strong>{formatCount(blockedCount)}</strong><small>Avoided term found</small></div>
      </div>
      <div className="cmr-workbench-grid cmr-workbench-grid--guardian">
        <section className="cmr-panel cmr-workbench-panel">
          <div className="cmr-section-heading">
            <div><span className="cmr-eyebrow">Rules</span><h3>Current Brand Center</h3></div>
            <span className="cmr-color-preview" style={{ background: form.brand.primaryColor }} />
          </div>
          <dl className="cmr-workbench-definition-list">
            <div><dt>Tone</dt><dd>{form.brand.tone || 'Not configured'}</dd></div>
            <div><dt>Guideline</dt><dd>{form.brand.guidelines || 'Not configured'}</dd></div>
            <div><dt>Use</dt><dd>{form.brand.wordsToUse.join(', ') || 'None listed'}</dd></div>
            <div><dt>Avoid</dt><dd>{form.brand.wordsToAvoid.join(', ') || 'None listed'}</dd></div>
          </dl>
          <button
            type="button"
            className="cmr-button cmr-button--quiet cmr-workbench-link"
            onClick={() => onOpen('brand')}
          >
            Edit Brand Center <PlanningIcon className="cmr-button__icon" />
          </button>
        </section>
        <section className="cmr-panel cmr-workbench-panel">
          <div className="cmr-section-heading">
            <div><span className="cmr-eyebrow">Review queue</span><h3>Human decision point</h3></div>
            <WorkbenchPill
              value={pendingBrandReviews > 0 ? 'pending' : 'ready'}
              label={pendingBrandReviews > 0 ? `${pendingBrandReviews} pending` : 'No pending approval'}
            />
          </div>
          <p className="cmr-workbench-note">
            A scan never approves or publishes content. Use the approval inbox.
          </p>
          <button
            type="button"
            className="cmr-button cmr-button--primary"
            onClick={() => onOpen('approvals')}
          >
            Open approval inbox <ReviewIcon className="cmr-button__icon" />
          </button>
          {!roleCanReview(role) && (
            <p className="cmr-permission-note">The current role can view evidence but cannot decide.</p>
          )}
        </section>
      </div>
      <section className="cmr-panel cmr-workbench-panel">
        <div className="cmr-section-heading">
          <div><span className="cmr-eyebrow">Evidence</span><h3>Content checks</h3></div>
        </div>
        {loading ? (
          <div className="cmr-workbench-skeleton" role="status" aria-label="Scanning content">
            <span /><span /><span />
          </div>
        ) : resources.length === 0 ? (
          <WorkbenchEmpty
            icon={ContentIcon}
            title="No content to scan"
            description="Create a content draft first, then run Brand Guardian."
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
                        label={scan.level === 'pass' ? 'Pass' : scan.level === 'warning' ? 'Review' : 'Blocked'}
                      />
                    </div>
                    <span>{resource.channel} / {resource.status} / revision {resource.revision}</span>
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
                      {busyId === resource.id ? 'Submitting...' : 'Submit for review'} <ReviewIcon className="cmr-button__icon" />
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
  if (operation === 'read') return 'Read persisted source';
  if (operation === 'draft') return 'Prepare a draft';
  return 'Validate locally';
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
      setError('Automation Builder requires Starizzi Desktop.');
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
      setNotice('Prepared a local dry-run. No external action was performed.');
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
        note: 'Reviewed in Automation Builder; external actions remain disabled.',
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
        ? 'Dry-run approved locally; nothing was published or sent.'
        : 'Dry-run rejected locally.');
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
        eyebrow="Guardrailed workflows"
        title="Automation Builder"
        description="Prepare and review a bounded local dry-run. Publish, send, bulk, spend, contact, and integration writes are unavailable."
        icon={SettingsIcon}
        onBack={onBack}
      />
      <div className="cmr-workbench-status">
        <span>
          <span className="cmr-workbench-status__dot" />
          {loading ? 'Loading workflow sources...' : bridgeMessage(status)}
        </span>
        <button
          type="button"
          className="cmr-icon-button"
          onClick={() => void load(target)}
          disabled={loading || busy}
          title="Refresh workflow sources"
          aria-label="Refresh workflow sources"
        >
          <RefreshIcon className="cmr-icon" />
        </button>
      </div>
      {error && <div className="cmr-alert cmr-alert--error" role="alert">{error}</div>}
      {notice && <div className="cmr-alert cmr-alert--success" role="status">{notice}</div>}
      <section className="cmr-panel cmr-workbench-panel">
        <div className="cmr-section-heading">
          <div><span className="cmr-eyebrow">01 / Builder</span><h3>Prepare a local dry-run</h3></div>
          <WorkbenchPill
            value={canReview ? 'ready' : 'blocked'}
            label={canReview ? 'Review access' : 'View only'}
          />
        </div>
        <div className="cmr-workbench-controls">
          <label className="cmr-field">
            <span className="cmr-field__label">Target</span>
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
            <span className="cmr-field__label">Persisted source</span>
            <select
              value={selectedSourceId}
              onChange={(event) => setSelectedSourceId(event.currentTarget.value)}
              disabled={loading || busy || sources.length === 0}
            >
              {sources.length === 0 && <option value="">No approved source</option>}
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.title} / rev {source.revision}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div
          className="cmr-workbench-operation-grid"
          role="group"
          aria-label="Allowed dry-run operations"
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
          <strong>Locked by policy</strong>
          <span>publish / send / bulk / spend / integration.write / contacts.write</span>
        </div>
        <button
          type="button"
          className="cmr-button cmr-button--primary"
          onClick={() => void prepare()}
          disabled={busy || loading || !selectedSource || operations.length === 0}
        >
          {busy ? 'Preparing...' : 'Prepare dry-run'} <SettingsIcon className="cmr-button__icon" />
        </button>
      </section>
      <section className="cmr-panel cmr-workbench-panel">
        <div className="cmr-section-heading">
          <div><span className="cmr-eyebrow">02 / Review</span><h3>Workflow manifests</h3></div>
          <strong className="cmr-workbench-count">{workflows.length}</strong>
        </div>
        {workflows.length === 0 ? (
          <WorkbenchEmpty
            icon={PlanningIcon}
            title="No local workflow yet"
            description="Prepare a dry-run from a persisted source."
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
                    {' / '}policy {workflow.manifest.grant.policyRevision}
                  </span>
                  <ul className="cmr-automation-details">
                    {workflow.manifest.dryRun.steps.map((step) => <li key={step}>{step}</li>)}
                  </ul>
                  <div className="cmr-automation-limits">
                    <span>Items: {workflow.manifest.grant.limits.maxItems}</span>
                    <span>Recipients: {workflow.manifest.grant.limits.maxRecipients}</span>
                    <span>Spend: {workflow.manifest.grant.limits.maxSpendVnd} VND</span>
                    <span>External action: no</span>
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
                      Reject
                    </button>
                    <button
                      type="button"
                      className="cmr-button cmr-button--primary"
                      disabled={busy || !canReview}
                      onClick={() => void review(workflow, 'approved')}
                    >
                      Approve dry-run
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
        {hasPendingWorkflow && !canReview && (
          <p className="cmr-permission-note">
            A reviewer role is required to decide pending manifests.
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

