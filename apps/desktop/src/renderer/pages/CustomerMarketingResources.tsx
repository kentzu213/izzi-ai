import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type SetStateAction,
} from 'react';
import {
  CloseIcon,
  ContentIcon,
  DesignIcon,
  KnowledgeIcon,
  PlanningIcon,
  RefreshIcon,
  ReviewIcon,
  StatusIcon,
} from '../components/AppIcons';
import type {
  CustomerMarketingBridgeStatus,
  CustomerMarketingCampaignResource,
  CustomerMarketingContentResource,
  CustomerMarketingResource,
  CustomerMarketingResourceCreateInput,
  CustomerMarketingResourceKind,
  CustomerMarketingResourceLifecycleStatus,
  CustomerMarketingResourceUpdateInput,
  CustomerRole,
} from '../../shared/customer-marketing-types';
import '../styles/customer-marketing-resources.css';

interface CustomerMarketingResourcesProps {
  kind: CustomerMarketingResourceKind;
  role: CustomerRole;
}

interface ResourceDraft {
  title: string;
  tags: string;
  description: string;
  objective: string;
  startsAt: string;
  endsAt: string;
  body: string;
  channel: string;
  scheduledAt: string;
  campaignId: string;
  mimeType: string;
  sizeBytes: string;
  altText: string;
  checksum: string;
  sourceUrl: string;
}

const KIND_COPY: Record<CustomerMarketingResourceKind, {
  eyebrow: string;
  title: string;
  description: string;
  create: string;
  empty: string;
}> = {
  campaign: {
    eyebrow: 'Campaign operations',
    title: 'Chiến dịch',
    description: 'Tổ chức mục tiêu, thời gian và vòng phê duyệt của từng chiến dịch.',
    create: 'Tạo chiến dịch',
    empty: 'Chưa có chiến dịch trong workspace này.',
  },
  content: {
    eyebrow: 'Content operations',
    title: 'Nội dung & Lịch',
    description: 'Soạn nội dung, gắn chiến dịch và quản lý lịch dự kiến theo revision.',
    create: 'Tạo nội dung',
    empty: 'Chưa có nội dung trong workspace này.',
  },
  asset: {
    eyebrow: 'Asset registry',
    title: 'Tài sản',
    description: 'Quản lý metadata, quyền sử dụng và dung lượng tài sản theo workspace.',
    create: 'Khai báo tài sản',
    empty: 'Chưa có tài sản trong workspace này.',
  },
  knowledge: {
    eyebrow: 'Business knowledge',
    title: 'Tri thức',
    description: 'Lưu nguồn, nội dung và ngữ cảnh doanh nghiệp cho phòng Marketing AI.',
    create: 'Thêm tri thức',
    empty: 'Chưa có tri thức trong workspace này.',
  },
};

const STATUS_LABELS: Record<CustomerMarketingResourceLifecycleStatus, string> = {
  draft: 'Bản nháp',
  in_review: 'Chờ duyệt',
  approved: 'Đã duyệt',
  rejected: 'Cần chỉnh sửa',
  archived: 'Đã lưu trữ',
};

const STATUS_FILTERS: Array<{ value: 'all' | CustomerMarketingResourceLifecycleStatus; label: string }> = [
  { value: 'all', label: 'Tất cả trạng thái' },
  { value: 'draft', label: 'Bản nháp' },
  { value: 'in_review', label: 'Chờ duyệt' },
  { value: 'approved', label: 'Đã duyệt' },
  { value: 'rejected', label: 'Cần chỉnh sửa' },
];

const CONTENT_CHANNELS = [
  'facebook',
  'tiktok',
  'instagram',
  'youtube',
  'website',
  'email',
  'telegram',
  'x',
  'seo',
] as const;

const WEEKDAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'] as const;

const KIND_ICONS = {
  campaign: PlanningIcon,
  content: ContentIcon,
  asset: DesignIcon,
  knowledge: KnowledgeIcon,
} as const;

function customerApi(): ElectronCustomerMarketingApi | null {
  return window.electronAPI?.customerMarketing ?? null;
}

function emptyDraft(kind: CustomerMarketingResourceKind): ResourceDraft {
  return {
    title: '',
    tags: '',
    description: '',
    objective: '',
    startsAt: '',
    endsAt: '',
    body: '',
    channel: kind === 'content' ? 'website' : '',
    scheduledAt: '',
    campaignId: '',
    mimeType: kind === 'asset' ? 'image/png' : '',
    sizeBytes: kind === 'asset' ? '1' : '',
    altText: '',
    checksum: '',
    sourceUrl: '',
  };
}

function localDateTime(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

function isoDateTime(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function draftFromResource(resource: CustomerMarketingResource): ResourceDraft {
  const base = {
    ...emptyDraft(resource.kind),
    title: resource.title,
    tags: typeof resource.metadata.tags === 'string' ? resource.metadata.tags : '',
  };
  if (resource.kind === 'campaign') {
    return {
      ...base,
      description: resource.description ?? '',
      objective: resource.objective ?? '',
      startsAt: localDateTime(resource.startsAt),
      endsAt: localDateTime(resource.endsAt),
    };
  }
  if (resource.kind === 'content') {
    return {
      ...base,
      body: resource.body,
      channel: resource.channel,
      scheduledAt: localDateTime(resource.scheduledAt),
      campaignId: resource.campaignId ?? '',
    };
  }
  if (resource.kind === 'asset') {
    return {
      ...base,
      mimeType: resource.mimeType,
      sizeBytes: String(resource.sizeBytes),
      altText: resource.altText ?? '',
      checksum: resource.checksum ?? '',
    };
  }
  return {
    ...base,
    body: resource.body,
    sourceUrl: resource.sourceUrl ?? '',
  };
}

function metadataFromDraft(draft: ResourceDraft): Record<string, string> {
  const tags = draft.tags
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .join(', ');
  return tags ? { tags } : {};
}

function createInput(kind: CustomerMarketingResourceKind, draft: ResourceDraft): CustomerMarketingResourceCreateInput {
  const metadata = metadataFromDraft(draft);
  if (kind === 'campaign') {
    return {
      kind,
      title: draft.title.trim(),
      description: draft.description.trim() || null,
      objective: draft.objective.trim() || null,
      startsAt: isoDateTime(draft.startsAt),
      endsAt: isoDateTime(draft.endsAt),
      metadata,
    };
  }
  if (kind === 'content') {
    return {
      kind,
      title: draft.title.trim(),
      body: draft.body,
      channel: draft.channel,
      scheduledAt: isoDateTime(draft.scheduledAt),
      campaignId: draft.campaignId || null,
      metadata,
    };
  }
  if (kind === 'asset') {
    return {
      kind,
      title: draft.title.trim(),
      mimeType: draft.mimeType.trim(),
      sizeBytes: Number(draft.sizeBytes),
      altText: draft.altText.trim() || null,
      checksum: draft.checksum.trim() || null,
      metadata,
    };
  }
  return {
    kind,
    title: draft.title.trim(),
    body: draft.body,
    sourceUrl: draft.sourceUrl.trim() || null,
    metadata,
  };
}

function updateInput(resource: CustomerMarketingResource, draft: ResourceDraft): CustomerMarketingResourceUpdateInput {
  const metadata = metadataFromDraft(draft);
  if (resource.kind === 'campaign') {
    return {
      kind: resource.kind,
      resourceId: resource.id,
      expectedRevision: resource.revision,
      patch: {
        title: draft.title.trim(),
        description: draft.description.trim() || null,
        objective: draft.objective.trim() || null,
        startsAt: isoDateTime(draft.startsAt),
        endsAt: isoDateTime(draft.endsAt),
        metadata,
      },
    };
  }
  if (resource.kind === 'content') {
    return {
      kind: resource.kind,
      resourceId: resource.id,
      expectedRevision: resource.revision,
      patch: {
        title: draft.title.trim(),
        body: draft.body,
        channel: draft.channel,
        scheduledAt: isoDateTime(draft.scheduledAt),
        campaignId: draft.campaignId || null,
        metadata,
      },
    };
  }
  if (resource.kind === 'asset') {
    return {
      kind: resource.kind,
      resourceId: resource.id,
      expectedRevision: resource.revision,
      patch: {
        title: draft.title.trim(),
        mimeType: draft.mimeType.trim(),
        sizeBytes: Number(draft.sizeBytes),
        altText: draft.altText.trim() || null,
        checksum: draft.checksum.trim() || null,
        metadata,
      },
    };
  }
  return {
    kind: resource.kind,
    resourceId: resource.id,
    expectedRevision: resource.revision,
    patch: {
      title: draft.title.trim(),
      body: draft.body,
      sourceUrl: draft.sourceUrl.trim() || null,
      metadata,
    },
  };
}

function formatDate(value: string | null, includeTime = false): string {
  if (!value) return 'Chưa đặt';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Chưa đặt';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function resourceSummary(resource: CustomerMarketingResource): string {
  if (resource.kind === 'campaign') return resource.objective || 'Chưa đặt mục tiêu';
  if (resource.kind === 'content') return `${resource.channel} · ${formatDate(resource.scheduledAt, true)}`;
  if (resource.kind === 'asset') return `${resource.mimeType} · ${formatBytes(resource.sizeBytes)}`;
  return resource.sourceUrl || 'Tri thức nội bộ';
}

function bridgeMessage(status: CustomerMarketingBridgeStatus): string {
  const messages: Record<CustomerMarketingBridgeStatus, string> = {
    synced: 'Đã đồng bộ với IzziAPI.',
    local: 'Tính năng này cần workspace IzziAPI đã đồng bộ.',
    forbidden: 'Vai trò hiện tại không có quyền thực hiện thao tác này.',
    not_found: 'Không tìm thấy dữ liệu trong workspace hiện tại.',
    conflict: 'Dữ liệu đã có revision mới. Bản nháp của bạn vẫn được giữ lại.',
    quota_exceeded: 'Workspace đã chạm giới hạn tài nguyên của gói hiện tại.',
    unavailable: 'Không thể xác nhận dữ liệu với IzziAPI. Thao tác đã được chặn.',
  };
  return messages[status];
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function monthRange(month: string): { from: string; to: string } {
  const [year, monthNumber] = month.split('-').map(Number);
  const safeYear = Number.isInteger(year) ? year : new Date().getFullYear();
  const safeMonth = Number.isInteger(monthNumber) ? monthNumber - 1 : new Date().getMonth();
  return {
    from: new Date(safeYear, safeMonth, 1).toISOString(),
    to: new Date(safeYear, safeMonth + 1, 1).toISOString(),
  };
}

function calendarCells(month: string): Array<{ key: string; day: number } | null> {
  const [year, monthNumber] = month.split('-').map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(monthNumber) || monthNumber < 1 || monthNumber > 12) {
    return Array.from({ length: 42 }, () => null);
  }
  const monthIndex = monthNumber - 1;
  const dayCount = new Date(year, monthIndex + 1, 0).getDate();
  const mondayOffset = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
  return Array.from({ length: 42 }, (_, index) => {
    const day = index - mondayOffset + 1;
    if (day < 1 || day > dayCount) return null;
    return { key: `${year}-${String(monthNumber).padStart(2, '0')}-${String(day).padStart(2, '0')}`, day };
  });
}

function localDateKey(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function calendarTime(value: string | null): string {
  if (!value) return '--:--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' }).format(date);
}

function ResourceStatus({ status }: { status: CustomerMarketingResourceLifecycleStatus }) {
  return <span className={`cmrr-status cmrr-status--${status}`}>{STATUS_LABELS[status]}</span>;
}

function ResourceFields({
  kind,
  draft,
  setDraft,
  campaigns,
}: {
  kind: CustomerMarketingResourceKind;
  draft: ResourceDraft;
  setDraft: Dispatch<SetStateAction<ResourceDraft>>;
  campaigns: CustomerMarketingCampaignResource[];
}) {
  const field = (key: keyof ResourceDraft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };
  return (
    <div className="cmrr-editor-fields">
      <label className="cmrr-field cmrr-field--wide">
        <span>Tiêu đề</span>
        <input value={draft.title} maxLength={160} required onChange={(event) => field('title', event.target.value)} />
      </label>

      {kind === 'campaign' && (
        <>
          <label className="cmrr-field cmrr-field--wide">
            <span>Mô tả</span>
            <textarea value={draft.description} maxLength={4000} rows={5} onChange={(event) => field('description', event.target.value)} />
          </label>
          <label className="cmrr-field cmrr-field--wide">
            <span>Mục tiêu</span>
            <input value={draft.objective} maxLength={240} onChange={(event) => field('objective', event.target.value)} />
          </label>
          <label className="cmrr-field">
            <span>Bắt đầu</span>
            <input type="datetime-local" value={draft.startsAt} onChange={(event) => field('startsAt', event.target.value)} />
          </label>
          <label className="cmrr-field">
            <span>Kết thúc</span>
            <input type="datetime-local" value={draft.endsAt} onChange={(event) => field('endsAt', event.target.value)} />
          </label>
        </>
      )}

      {kind === 'content' && (
        <>
          <label className="cmrr-field cmrr-field--wide">
            <span>Nội dung</span>
            <textarea value={draft.body} maxLength={32000} rows={10} onChange={(event) => field('body', event.target.value)} />
          </label>
          <label className="cmrr-field">
            <span>Kênh</span>
            <select value={draft.channel} onChange={(event) => field('channel', event.target.value)}>
              {CONTENT_CHANNELS.map((channel) => <option key={channel} value={channel}>{channel.toUpperCase()}</option>)}
            </select>
          </label>
          <label className="cmrr-field">
            <span>Lịch dự kiến</span>
            <input type="datetime-local" value={draft.scheduledAt} onChange={(event) => field('scheduledAt', event.target.value)} />
          </label>
          <label className="cmrr-field cmrr-field--wide">
            <span>Chiến dịch</span>
            <select value={draft.campaignId} onChange={(event) => field('campaignId', event.target.value)}>
              <option value="">Không gắn chiến dịch</option>
              {campaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.title}</option>)}
            </select>
          </label>
        </>
      )}

      {kind === 'asset' && (
        <>
          <div className="cmrr-boundary-note cmrr-field--wide" role="note">
            <StatusIcon className="cmr-icon" />
            <span>Thao tác này đăng ký metadata và quota; chưa truyền tệp ra khỏi máy.</span>
          </div>
          <label className="cmrr-field">
            <span>MIME type</span>
            <input value={draft.mimeType} maxLength={120} required onChange={(event) => field('mimeType', event.target.value)} />
          </label>
          <label className="cmrr-field">
            <span>Dung lượng (byte)</span>
            <input type="number" min="1" max={50 * 1024 * 1024} value={draft.sizeBytes} required onChange={(event) => field('sizeBytes', event.target.value)} />
          </label>
          <label className="cmrr-field cmrr-field--wide">
            <span>Alt text</span>
            <textarea value={draft.altText} maxLength={1000} rows={3} onChange={(event) => field('altText', event.target.value)} />
          </label>
          <label className="cmrr-field cmrr-field--wide">
            <span>Checksum SHA/MD5 (nếu có)</span>
            <input value={draft.checksum} maxLength={128} onChange={(event) => field('checksum', event.target.value)} />
          </label>
        </>
      )}

      {kind === 'knowledge' && (
        <>
          <label className="cmrr-field cmrr-field--wide">
            <span>Nội dung tri thức</span>
            <textarea value={draft.body} maxLength={64000} rows={12} onChange={(event) => field('body', event.target.value)} />
          </label>
          <label className="cmrr-field cmrr-field--wide">
            <span>Nguồn tham chiếu</span>
            <input type="url" value={draft.sourceUrl} maxLength={1024} placeholder="https://" onChange={(event) => field('sourceUrl', event.target.value)} />
          </label>
        </>
      )}

      <label className="cmrr-field cmrr-field--wide">
        <span>Tags</span>
        <input value={draft.tags} maxLength={1024} placeholder="launch, product, vietnam" onChange={(event) => field('tags', event.target.value)} />
      </label>
    </div>
  );
}

function ResourceDetail({
  resource,
  role,
  busy,
  onEdit,
  onReview,
}: {
  resource: CustomerMarketingResource;
  role: CustomerRole;
  busy: boolean;
  onEdit: () => void;
  onReview: (action: 'submit' | 'approve' | 'reject') => Promise<void>;
}) {
  const canEdit = role === 'owner' || role === 'manager' || role === 'editor';
  const canReview = role === 'owner' || role === 'manager' || role === 'reviewer';
  const canSeeArchiveLock = role === 'owner'
    || role === 'manager'
    || (role === 'editor' && (resource.status === 'draft' || resource.status === 'rejected'));
  return (
    <div className="cmrr-detail">
      <div className="cmrr-detail__heading">
        <div>
          <span className="cmr-eyebrow">Revision {resource.revision}</span>
          <h3>{resource.title}</h3>
        </div>
        <ResourceStatus status={resource.status} />
      </div>
      <div className="cmrr-detail__meta">
        <span>Cập nhật {formatDate(resource.updatedAt, true)}</span>
        <span>{resourceSummary(resource)}</span>
      </div>

      {resource.kind === 'campaign' && (
        <div className="cmrr-detail__body">
          <DetailRow label="Mục tiêu" value={resource.objective || 'Chưa đặt'} />
          <DetailRow label="Thời gian" value={`${formatDate(resource.startsAt)} - ${formatDate(resource.endsAt)}`} />
          <DetailText value={resource.description || 'Chưa có mô tả.'} />
        </div>
      )}
      {resource.kind === 'content' && (
        <div className="cmrr-detail__body">
          <DetailRow label="Kênh" value={resource.channel.toUpperCase()} />
          <DetailRow label="Lịch dự kiến" value={formatDate(resource.scheduledAt, true)} />
          <DetailText value={resource.body || 'Nội dung đang trống.'} />
        </div>
      )}
      {resource.kind === 'asset' && (
        <div className="cmrr-detail__body">
          <DetailRow label="Loại" value={resource.mimeType} />
          <DetailRow label="Dung lượng" value={formatBytes(resource.sizeBytes)} />
          <DetailText value={resource.altText || 'Chưa có alt text.'} />
        </div>
      )}
      {resource.kind === 'knowledge' && (
        <div className="cmrr-detail__body">
          <DetailRow label="Nguồn" value={resource.sourceUrl || 'Nội bộ'} />
          <DetailText value={resource.body || 'Nội dung đang trống.'} />
        </div>
      )}

      {typeof resource.metadata.tags === 'string' && resource.metadata.tags && (
        <div className="cmrr-tags" aria-label="Tags">
          {resource.metadata.tags.split(',').map((tag) => tag.trim()).filter(Boolean).map((tag) => <span key={tag}>{tag}</span>)}
        </div>
      )}

      <div className="cmrr-detail__actions">
        {canEdit && <button type="button" className="cmr-button" disabled={busy} onClick={onEdit}><DesignIcon className="cmr-button__icon" /> Sửa</button>}
        {canEdit && (resource.status === 'draft' || resource.status === 'rejected') && (
          <button type="button" className="cmr-button cmr-button--primary" disabled={busy} onClick={() => void onReview('submit')}>
            <ReviewIcon className="cmr-button__icon" /> Gửi duyệt
          </button>
        )}
        {canReview && resource.status === 'in_review' && (
          <>
            <button type="button" className="cmr-button cmr-button--primary" disabled={busy} onClick={() => void onReview('approve')}>
              <StatusIcon className="cmr-button__icon" /> Phê duyệt
            </button>
            <button type="button" className="cmr-button cmr-button--danger" disabled={busy} onClick={() => void onReview('reject')}>
              Yêu cầu sửa
            </button>
          </>
        )}
        {canSeeArchiveLock && (
          <span className="cmrr-archive-lock" role="status">
            <StatusIcon className="cmr-button__icon" />
            Lưu trữ hiện đang bị khóa
          </span>
        )}
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return <div className="cmrr-detail-row"><span>{label}</span><strong>{value}</strong></div>;
}

function DetailText({ value }: { value: string }) {
  return <p className="cmrr-detail-text">{value}</p>;
}

export function CustomerMarketingResources({ kind, role }: CustomerMarketingResourcesProps) {
  const copy = KIND_COPY[kind];
  const Icon = KIND_ICONS[kind];
  const [resources, setResources] = useState<CustomerMarketingResource[]>([]);
  const [campaigns, setCampaigns] = useState<CustomerMarketingCampaignResource[]>([]);
  const [calendarResources, setCalendarResources] = useState<CustomerMarketingContentResource[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | CustomerMarketingResourceLifecycleStatus>('all');
  const [displayMode, setDisplayMode] = useState<'list' | 'calendar'>('list');
  const [calendarMonth, setCalendarMonth] = useState(currentMonth);
  const [loading, setLoading] = useState(true);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [bridgeStatus, setBridgeStatus] = useState<CustomerMarketingBridgeStatus>('unavailable');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ResourceDraft>(() => emptyDraft(kind));
  const editorRef = useRef<HTMLFormElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const canEdit = role === 'owner' || role === 'manager' || role === 'editor';

  const closeEditor = useCallback(() => {
    setEditorOpen(false);
    window.requestAnimationFrame(() => returnFocusRef.current?.focus());
  }, []);

  const load = useCallback(async () => {
    const api = customerApi();
    if (!api) {
      setBridgeStatus('unavailable');
      setError('Customer Marketing resources cần chạy trong Izzi AI Desktop.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await api.listMarketingResources(kind);
      setBridgeStatus(result.status);
      if (!result.ok) {
        setResources([]);
        setError(result.error || bridgeMessage(result.status));
        return;
      }
      const next = result.resources.filter((resource) => resource.kind === kind);
      setResources(next);
      setSelectedId((current) => next.some((resource) => resource.id === current) ? current : next[0]?.id || '');
      if (kind === 'content') {
        const campaignResult = await api.listMarketingResources('campaign');
        setCampaigns(campaignResult.ok
          ? campaignResult.resources.filter((resource): resource is CustomerMarketingCampaignResource => resource.kind === 'campaign')
          : []);
      }
    } catch (reason) {
      setBridgeStatus('unavailable');
      setError(reason instanceof Error ? reason.message : bridgeMessage('unavailable'));
    } finally {
      setLoading(false);
    }
  }, [kind]);

  const loadCalendar = useCallback(async () => {
    if (kind !== 'content') return;
    const api = customerApi();
    if (!api) return;
    setCalendarLoading(true);
    setError('');
    try {
      const result = await api.listMarketingCalendar(monthRange(calendarMonth));
      setBridgeStatus(result.status);
      if (!result.ok) {
        setCalendarResources([]);
        setError(result.error || bridgeMessage(result.status));
        return;
      }
      setCalendarResources(result.resources.filter((resource): resource is CustomerMarketingContentResource => resource.kind === 'content'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : bridgeMessage('unavailable'));
    } finally {
      setCalendarLoading(false);
    }
  }, [calendarMonth, kind]);

  useEffect(() => {
    setDisplayMode('list');
    setEditorOpen(false);
    setEditingId(null);
    setDraft(emptyDraft(kind));
    void load();
  }, [kind, load]);

  useEffect(() => {
    if (displayMode === 'calendar') void loadCalendar();
  }, [displayMode, loadCalendar]);

  useEffect(() => {
    if (!editorOpen) return;
    const editor = editorRef.current;
    const focusableSelector = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const firstField = editor?.querySelector<HTMLElement>('input:not([disabled]), select:not([disabled]), textarea:not([disabled])');
    (firstField ?? editor?.querySelector<HTMLElement>(focusableSelector))?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        closeEditor();
        return;
      }
      if (event.key !== 'Tab' || !editor) return;
      const focusable = [...editor.querySelectorAll<HTMLElement>(focusableSelector)]
        .filter((element) => element.offsetParent !== null);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [busy, closeEditor, editorOpen]);

  const visibleResources = useMemo(() => {
    const source = kind === 'content' && displayMode === 'calendar' ? calendarResources : resources;
    const normalizedQuery = query.trim().toLowerCase();
    return source.filter((resource) => {
      if (statusFilter !== 'all' && resource.status !== statusFilter) return false;
      if (!normalizedQuery) return true;
      return `${resource.title} ${resourceSummary(resource)}`.toLowerCase().includes(normalizedQuery);
    });
  }, [calendarResources, displayMode, kind, query, resources, statusFilter]);

  const calendarGridCells = useMemo(() => calendarCells(calendarMonth), [calendarMonth]);
  const calendarByDay = useMemo(() => {
    const grouped = new Map<string, CustomerMarketingContentResource[]>();
    if (kind !== 'content' || displayMode !== 'calendar') return grouped;
    visibleResources.forEach((resource) => {
      if (resource.kind !== 'content') return;
      const key = localDateKey(resource.scheduledAt);
      if (!key) return;
      grouped.set(key, [...(grouped.get(key) ?? []), resource]);
    });
    grouped.forEach((items) => items.sort((left, right) => Date.parse(left.scheduledAt || '') - Date.parse(right.scheduledAt || '')));
    return grouped;
  }, [displayMode, kind, visibleResources]);

  const selected = useMemo(
    () => [...resources, ...calendarResources].find((resource) => resource.id === selectedId) ?? null,
    [calendarResources, resources, selectedId],
  );

  const openCreate = () => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setEditingId(null);
    setDraft(emptyDraft(kind));
    setError('');
    setNotice('');
    setEditorOpen(true);
  };

  const openEdit = () => {
    if (!selected || selected.kind !== kind) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setEditingId(selected.id);
    setDraft(draftFromResource(selected));
    setError('');
    setNotice('');
    setEditorOpen(true);
  };

  const replaceResource = (resource: CustomerMarketingResource) => {
    setResources((current) => {
      const exists = current.some((item) => item.id === resource.id);
      return exists
        ? current.map((item) => item.id === resource.id ? resource : item)
        : [resource, ...current];
    });
    setCalendarResources((current) => resource.kind === 'content'
      ? current.map((item) => item.id === resource.id ? resource : item)
      : current);
    setSelectedId(resource.id);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const api = customerApi();
    if (!api) return;
    if (!draft.title.trim()) {
      setError('Cần nhập tiêu đề.');
      return;
    }
    if (kind === 'asset' && (!Number.isSafeInteger(Number(draft.sizeBytes)) || Number(draft.sizeBytes) < 1)) {
      setError('Dung lượng tài sản không hợp lệ.');
      return;
    }
    const editing = editingId ? resources.find((resource) => resource.id === editingId) ?? selected : null;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = editing
        ? await api.updateMarketingResource(updateInput(editing, draft))
        : await api.createMarketingResource(createInput(kind, draft));
      setBridgeStatus(result.status);
      if (!result.ok || !result.resource) {
        setError(result.error || bridgeMessage(result.status));
        return;
      }
      replaceResource(result.resource);
      setNotice(result.duplicate ? 'Yêu cầu trước đó đã được xác nhận, không tạo bản trùng.' : 'Đã lưu dữ liệu vào workspace.');
      closeEditor();
      if (kind === 'content' && displayMode === 'calendar') void loadCalendar();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : bridgeMessage('unavailable'));
    } finally {
      setBusy(false);
    }
  };

  const review = async (action: 'submit' | 'approve' | 'reject') => {
    const api = customerApi();
    if (!api || !selected || (selected.kind !== 'campaign' && selected.kind !== 'content')) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api.reviewMarketingResource({
        kind: selected.kind,
        resourceId: selected.id,
        action,
        expectedRevision: selected.revision,
      });
      setBridgeStatus(result.status);
      if (!result.ok || !result.resource) {
        setError(result.error || bridgeMessage(result.status));
        return;
      }
      replaceResource(result.resource);
      setNotice(action === 'submit' ? 'Đã gửi revision để phê duyệt.' : action === 'approve' ? 'Đã phê duyệt revision hiện tại.' : 'Đã trả revision về để chỉnh sửa.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : bridgeMessage('unavailable'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cmr-view-stack cmrr-root">
      <div className="cmrr-main" aria-hidden={editorOpen || undefined} inert={editorOpen ? true : undefined}>
      <div className="cmr-view-intro cmr-view-intro--row">
        <div>
          <span className="cmr-eyebrow">{copy.eyebrow}</span>
          <h2>{copy.title}</h2>
          <p>{copy.description}</p>
        </div>
        <div className="cmrr-intro-actions">
          {loading
            ? <span className="cmrr-sync cmrr-sync--loading"><span />Đang tải dữ liệu...</span>
            : <span className={`cmrr-sync cmrr-sync--${bridgeStatus}`}><span />{bridgeMessage(bridgeStatus)}</span>}
          <button type="button" className="cmr-icon-button" onClick={() => void load()} disabled={loading || busy} title="Làm mới dữ liệu" aria-label="Làm mới dữ liệu">
            <RefreshIcon className="cmr-icon" />
          </button>
          {canEdit && <button type="button" className="cmr-button cmr-button--primary" onClick={openCreate}><Icon className="cmr-button__icon" /> {copy.create}</button>}
        </div>
      </div>

      {error && <div className="cmr-alert cmr-alert--error" role="alert">{error}</div>}
      {notice && <div className="cmr-alert cmr-alert--success" role="status">{notice}</div>}

      <div className="cmrr-toolbar" aria-label="Bộ lọc tài nguyên">
        <label className="cmrr-search">
          <span className="cmr-sr-only">Tìm kiếm</span>
          <input type="search" value={query} placeholder="Tìm theo tiêu đề hoặc kênh" onChange={(event) => setQuery(event.target.value)} />
        </label>
        <label className="cmrr-filter">
          <span className="cmr-sr-only">Lọc trạng thái</span>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
            {STATUS_FILTERS.map((filter) => <option key={filter.value} value={filter.value}>{filter.label}</option>)}
          </select>
        </label>
        {kind === 'content' && (
          <div className="cmrr-segmented" role="group" aria-label="Chế độ xem nội dung">
            <button type="button" className={displayMode === 'list' ? 'is-active' : ''} aria-pressed={displayMode === 'list'} onClick={() => setDisplayMode('list')}>Danh sách</button>
            <button type="button" className={displayMode === 'calendar' ? 'is-active' : ''} aria-pressed={displayMode === 'calendar'} onClick={() => setDisplayMode('calendar')}>Lịch</button>
          </div>
        )}
        {kind === 'content' && displayMode === 'calendar' && (
          <label className="cmrr-month">
            <span className="cmr-sr-only">Tháng hiển thị</span>
            <input type="month" value={calendarMonth} onChange={(event) => setCalendarMonth(event.target.value)} />
          </label>
        )}
      </div>

      <section className={`cmrr-workspace ${displayMode === 'calendar' ? 'cmrr-workspace--calendar' : ''}`} aria-label={`${copy.title} workspace`}>
        <div className="cmrr-list-pane">
          <div className="cmrr-list-heading">
            <strong>{displayMode === 'calendar' ? `Lịch ${calendarMonth}` : `${visibleResources.length} mục`}</strong>
            <span>{displayMode === 'calendar' ? `${visibleResources.length} nội dung` : statusFilter === 'all' ? 'Đang hoạt động' : STATUS_LABELS[statusFilter]}</span>
          </div>
          {(loading || calendarLoading) ? (
            <div className="cmrr-skeleton" role="status" aria-label="Đang tải dữ liệu">
              {[0, 1, 2, 3].map((item) => <span key={item} />)}
            </div>
          ) : displayMode === 'calendar' && kind === 'content' ? (
            <div className="cmrr-calendar-scroll">
              <section className="cmrr-calendar" aria-label={`Lịch nội dung tháng ${calendarMonth}`}>
                {WEEKDAY_LABELS.map((label) => <div key={label} className="cmrr-calendar__weekday" aria-hidden="true">{label}</div>)}
                {calendarGridCells.map((cell, index) => {
                  if (!cell) return <div key={`empty-${index}`} className="cmrr-calendar__day cmrr-calendar__day--empty" aria-hidden="true" />;
                  const dayResources = calendarByDay.get(cell.key) ?? [];
                  return (
                    <div key={cell.key} className="cmrr-calendar__day">
                      <span className="cmrr-calendar__date">{cell.day}</span>
                      <div className="cmrr-calendar__events">
                        {dayResources.map((resource) => (
                          <button
                            type="button"
                            key={resource.id}
                            className={`cmrr-calendar-event ${selectedId === resource.id ? 'is-active' : ''}`}
                            aria-label={`${resource.title}, ${calendarTime(resource.scheduledAt)}, ${resource.channel}`}
                            aria-pressed={selectedId === resource.id}
                            aria-controls="cmrr-resource-detail"
                            onClick={() => setSelectedId(resource.id)}
                          >
                            <span><b>{calendarTime(resource.scheduledAt)}</b>{resource.channel.toUpperCase()}</span>
                            <strong>{resource.title}</strong>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </section>
            </div>
          ) : visibleResources.length === 0 ? (
            <div className="cmrr-empty">
              <Icon className="cmrr-empty__icon" />
              <strong>{copy.empty}</strong>
              {canEdit && <button type="button" className="cmr-button" onClick={openCreate}>{copy.create}</button>}
            </div>
          ) : (
            <div className="cmrr-list" aria-label={`Danh sách ${copy.title.toLowerCase()}`}>
              {visibleResources.map((resource) => (
                <button
                  type="button"
                  key={resource.id}
                  className={`cmrr-list-row ${selectedId === resource.id ? 'is-active' : ''}`}
                  aria-pressed={selectedId === resource.id}
                  aria-controls="cmrr-resource-detail"
                  onClick={() => setSelectedId(resource.id)}
                >
                  <span className="cmrr-list-row__icon"><Icon className="cmr-icon" /></span>
                  <span className="cmrr-list-row__copy">
                    <strong>{resource.title}</strong>
                    <small>{resourceSummary(resource)}</small>
                  </span>
                  <span className="cmrr-list-row__tail"><ResourceStatus status={resource.status} /><small>r{resource.revision}</small></span>
                </button>
              ))}
            </div>
          )}
        </div>
        <aside id="cmrr-resource-detail" className="cmrr-detail-pane" aria-live="polite">
          {selected ? (
            <ResourceDetail resource={selected} role={role} busy={busy} onEdit={openEdit} onReview={review} />
          ) : (
            <div className="cmrr-empty cmrr-empty--detail">
              <StatusIcon className="cmrr-empty__icon" />
              <strong>Chọn một mục để xem chi tiết</strong>
            </div>
          )}
        </aside>
      </section>
      </div>

      {editorOpen && (
        <div className="cmrr-editor-overlay" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !busy) closeEditor();
        }}>
          <form ref={editorRef} className="cmrr-editor" role="dialog" aria-modal="true" aria-labelledby="cmrr-editor-title" onSubmit={(event) => void save(event)}>
            <div className="cmrr-editor__header">
              <div>
                <span className="cmr-eyebrow">{editingId ? 'Chỉnh sửa revision' : 'Tạo mới'}</span>
                <h3 id="cmrr-editor-title">{editingId ? 'Cập nhật dữ liệu' : copy.create}</h3>
              </div>
              <button type="button" className="cmr-icon-button" aria-label="Đóng" title="Đóng" disabled={busy} onClick={closeEditor}>
                <CloseIcon className="cmr-icon" />
              </button>
            </div>
            {error && <div className="cmr-alert cmr-alert--error cmrr-editor__feedback" role="alert">{error}</div>}
            <div className="cmrr-editor__body">
              <ResourceFields kind={kind} draft={draft} setDraft={setDraft} campaigns={campaigns} />
            </div>
            <div className="cmrr-editor__footer">
              <span>{editingId && selected ? `Lưu dựa trên revision ${selected.revision}` : 'Tạo trong workspace hiện tại'}</span>
              <div>
                <button type="button" className="cmr-button" disabled={busy} onClick={closeEditor}>Hủy</button>
                <button type="submit" className="cmr-button cmr-button--primary" disabled={busy}>{busy ? 'Đang lưu...' : 'Lưu'}</button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
