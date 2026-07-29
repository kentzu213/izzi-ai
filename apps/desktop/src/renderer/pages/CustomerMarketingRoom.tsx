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
  AgentHubIcon,
  CloseIcon,
  ContentIcon,
  DesignIcon,
  ExtensionIcon,
  KnowledgeIcon,
  OverviewIcon,
  PlanningIcon,
  RefreshIcon,
  ResearchIcon,
  ReviewIcon,
  SettingsIcon,
  SparkIcon,
  StatusIcon,
  TrendUpIcon,
} from '../components/AppIcons';
import type {
  CustomerAssignableRole,
  CustomerAutomationMode,
  CustomerApproval,
  CustomerCapability,
  CustomerChannel,
  CustomerDirectorInput,
  CustomerMarketingSnapshot,
  CustomerMutationResult,
  CustomerObjective,
  CustomerOnboardingInput,
  CustomerOnboardingProfile,
  CustomerProductMarketingContextSaveInput,
  CustomerProductMarketingContextV1,
  CustomerRole,
  CustomerRun,
  CustomerWorkspaceMember,
  CustomerWorkspaceMembersResult,
  CustomerWorkspaceInvitationAcceptanceResult,
} from '../../shared/customer-marketing-types';
import { CustomerMarketingResources } from './CustomerMarketingResources';
import { CustomerMarketingChannels } from './CustomerMarketingChannels';
import { CustomerMarketingCapabilityWorkbench } from './CustomerMarketingCapabilityWorkbenches';
import {
  customerPlanMeetsMinimum,
  resolveCustomerCapabilitySurface,
  type CustomerCapabilityAction,
  type CustomerCapabilitySurface,
  type CustomerCapabilitySurfaceState,
  type CustomerCapabilityWorkbenchId,
} from './customer-capability-actions';
import {
  isMarketingWorkspaceReferenceEnabled,
  setMarketingWorkspaceReferenceEnabled,
} from '../shell/featureFlags';
import {
  MARKETING_REFERENCE_SETUP_GROUPS,
  MARKETING_REFERENCE_SURFACES,
  trapDialogTabFocus,
} from '../marketing-workspace/reference-contract';
import '../styles/customer-marketing-room.css';

type ReferenceSurface = typeof MARKETING_REFERENCE_SURFACES[number]['id'];
type ReferenceSetupGroup = typeof MARKETING_REFERENCE_SETUP_GROUPS[number]['id'];

type ViewId =
  | 'home'
  | 'campaigns'
  | 'content'
  | 'channels'
  | 'assets'
  | 'knowledge'
  | 'approvals'
  | 'director'
  | 'goals'
  | 'video'
  | 'team'
  | 'apps'
  | 'brand';

type MutationOperation = (
  api: ElectronCustomerMarketingApi,
) => Promise<CustomerMutationResult>;

const STEP_LABELS = [
  'Doanh nghiệp',
  'Thương hiệu',
  'Khách hàng',
  'Mục tiêu',
  'Kênh',
  'Tài nguyên',
  'Vận hành',
] as const;

const OBJECTIVE_OPTIONS: Array<{
  value: CustomerObjective;
  label: string;
  hint: string;
}> = [
  { value: 'brand_awareness', label: 'Nhận diện thương hiệu', hint: 'Được biết đến đúng nhóm khách hàng.' },
  { value: 'engagement', label: 'Tăng tương tác', hint: 'Tạo cuộc trò chuyện và cộng đồng.' },
  { value: 'traffic', label: 'Tăng traffic', hint: 'Đưa đúng người về website hoặc landing page.' },
  { value: 'leads', label: 'Thu lead', hint: 'Tạo và nuôi dưỡng cơ hội bán hàng.' },
  { value: 'revenue', label: 'Tăng doanh thu', hint: 'Tập trung vào chuyển đổi có thể đo lường.' },
  { value: 'launch', label: 'Ra mắt sản phẩm', hint: 'Điều phối nội dung và chiến dịch ra mắt.' },
  { value: 'community', label: 'Xây dựng cộng đồng', hint: 'Tăng độ gắn kết dài hạn.' },
];

const CHANNEL_OPTIONS: Array<{ value: CustomerChannel; label: string }> = [
  { value: 'facebook', label: 'Facebook' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'instagram', label: 'Instagram' },
  { value: 'youtube', label: 'YouTube' },
  { value: 'website', label: 'Website' },
  { value: 'email', label: 'Email' },
  { value: 'crm', label: 'CRM' },
  { value: 'ads', label: 'Quảng cáo' },
  { value: 'telegram', label: 'Telegram' },
  { value: 'x', label: 'X' },
  { value: 'seo', label: 'SEO' },
];

const MODE_OPTIONS: Array<{
  value: CustomerAutomationMode;
  label: string;
  description: string;
}> = [
  {
    value: 'copilot',
    label: 'AI hỗ trợ',
    description: 'AI đề xuất, bạn quyết định từng bước.',
  },
  {
    value: 'semi_autonomous',
    label: 'Bán tự động',
    description: 'AI xử lý việc nội bộ, chờ duyệt trước khi xuất bản hoặc chi tiêu.',
  },
  {
    value: 'guardrailed_autonomous',
    label: 'Tự động có giới hạn',
    description: 'AI vận hành theo rule, ngân sách, kênh và approval policy.',
  },
];

const MEMBER_ROLE_LABELS: Record<CustomerRole, string> = {
  owner: 'Chủ sở hữu',
  manager: 'Quản lý',
  editor: 'Biên tập',
  reviewer: 'Phê duyệt',
  viewer: 'Chỉ xem',
};

const INVITATION_ROLE_OPTIONS: CustomerAssignableRole[] = [
  'manager',
  'editor',
  'reviewer',
  'viewer',
];

const VIEW_ITEMS: Array<{
  id: ViewId;
  label: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  { id: 'home', label: 'Tổng quan', icon: OverviewIcon },
  { id: 'campaigns', label: 'Chiến dịch', icon: PlanningIcon },
  { id: 'content', label: 'Nội dung & Lịch', icon: ContentIcon },
  { id: 'channels', label: 'Kênh', icon: TrendUpIcon },
  { id: 'assets', label: 'Tài sản', icon: DesignIcon },
  { id: 'knowledge', label: 'Tri thức', icon: KnowledgeIcon },
  { id: 'approvals', label: 'Phê duyệt', icon: ReviewIcon },
  { id: 'director', label: 'AI Director', icon: SparkIcon },
  { id: 'goals', label: 'Mục tiêu', icon: TrendUpIcon },
  { id: 'video', label: 'Video Studio', icon: DesignIcon },
  { id: 'team', label: 'AI Team', icon: AgentHubIcon },
  { id: 'apps', label: 'Apps', icon: ExtensionIcon },
  { id: 'brand', label: 'Thương hiệu', icon: DesignIcon },
];

const REFERENCE_SURFACES: ReadonlyArray<{
  id: ReferenceSurface;
  label: string;
  icon: ComponentType<{ className?: string }>;
}> = MARKETING_REFERENCE_SURFACES.map((surface) => ({
  ...surface,
  icon: {
    brief: OverviewIcon,
    work: PlanningIcon,
    deliverables: DesignIcon,
    approvals: ReviewIcon,
  }[surface.id],
}));

const REFERENCE_SETUP_GROUPS: ReadonlyArray<{
  id: ReferenceSetupGroup;
  label: string;
  description: string;
}> = MARKETING_REFERENCE_SETUP_GROUPS;

const CATEGORY_LABELS: Record<CustomerCapability['category'], string> = {
  strategy: 'Chiến lược',
  content: 'Nội dung',
  social: 'Mạng xã hội',
  creative: 'Sáng tạo',
  analytics: 'Phân tích',
  automation: 'Tự động hóa',
  research: 'Nghiên cứu',
  customer_support: 'Hỗ trợ',
};

const CATEGORY_ICONS: Record<
  CustomerCapability['category'],
  ComponentType<{ className?: string }>
> = {
  strategy: PlanningIcon,
  content: ContentIcon,
  social: TrendUpIcon,
  creative: DesignIcon,
  analytics: TrendUpIcon,
  automation: SettingsIcon,
  research: ResearchIcon,
  customer_support: StatusIcon,
};

const CAPABILITY_PLAN_LABELS: Record<CustomerCapability['minimumPlan'], string> = {
  free: 'Free',
  starter: 'Starter',
  pro: 'Pro',
  max: 'Max',
  ultra: 'Ultra',
};

const CAPABILITY_PERMISSION_LABELS: Record<CustomerCapability['permission'], string> = {
  view: 'Chỉ xem',
  edit: 'Biên tập',
  execute: 'Thực thi',
  approve: 'Phê duyệt',
  manage: 'Quản trị',
};

const CAPABILITY_STABILITY_LABELS: Record<CustomerCapability['stability'], string> = {
  stable: 'Stable',
  beta: 'Beta',
  preview: 'Preview',
};

function emptyOnboarding(): CustomerOnboardingInput {
  return {
    business: {
      name: '',
      industry: '',
      website: '',
      offer: '',
      region: '',
    },
    brand: {
      logoUrl: '',
      primaryColor: '#18c7b5',
      accentColor: '#f0b35b',
      font: 'Inter',
      tone: '',
      guidelines: '',
      wordsToUse: [],
      wordsToAvoid: [],
    },
    audience: {
      segments: '',
      needs: '',
      painPoints: '',
      behaviors: '',
      market: '',
    },
    objectives: [],
    channels: [],
    resources: [],
    automationMode: 'copilot',
    completedSteps: [],
  };
}

function profileToInput(profile: CustomerOnboardingProfile): CustomerOnboardingInput {
  return {
    business: { ...profile.business },
    brand: {
      ...profile.brand,
      wordsToUse: [...profile.brand.wordsToUse],
      wordsToAvoid: [...profile.brand.wordsToAvoid],
    },
    audience: { ...profile.audience },
    objectives: [...profile.objectives],
    channels: [...profile.channels],
    resources: [...profile.resources],
    automationMode: profile.automationMode,
    completedSteps: [...profile.completedSteps],
  };
}

type ProductContextDraft = Omit<CustomerProductMarketingContextSaveInput, 'authorityToken'>;
type ProductContextLocalizedKey =
  | 'category'
  | 'positioning'
  | 'targetAudience'
  | 'valueProposition'
  | 'brandVoice'
  | 'callToAction';

function productContextToDraft(
  context: CustomerProductMarketingContextV1,
): ProductContextDraft {
  return {
    expectedRevision: context.revision,
    product: {
      ...context.product,
      category: { ...context.product.category },
      positioning: { ...context.product.positioning },
      targetAudience: { ...context.product.targetAudience },
      valueProposition: { ...context.product.valueProposition },
      brandVoice: { ...context.product.brandVoice },
      callToAction: { ...context.product.callToAction },
      proofClaims: context.product.proofClaims.map((claim) => ({
        ...claim,
        text: { ...claim.text },
        sourceIds: [...claim.sourceIds],
      })),
      prohibitedClaims: context.product.prohibitedClaims.map((claim) => ({
        ...claim,
        text: { ...claim.text },
        reason: { ...claim.reason },
      })),
    },
    sources: context.sources.map(({ sha256: _sha256, ...source }) => ({ ...source })),
  };
}

function onboardingProductContextDraft(form: CustomerOnboardingInput): ProductContextDraft {
  return {
    expectedRevision: 0,
    product: {
      productName: form.business.name.trim().slice(0, 160),
      category: {
        vi: form.business.industry.trim(),
        en: '',
      },
      positioning: {
        vi: form.business.offer.trim(),
        en: '',
      },
      targetAudience: {
        vi: form.audience.segments.trim(),
        en: '',
      },
      valueProposition: {
        vi: form.audience.needs.trim(),
        en: '',
      },
      brandVoice: {
        vi: form.brand.tone.trim(),
        en: '',
      },
      callToAction: {
        vi: '',
        en: '',
      },
      proofClaims: [],
      prohibitedClaims: [],
    },
    sources: [],
  };
}

function validateProductContextDraft(draft: ProductContextDraft): string {
  if (draft.product.productName.trim().length < 2) {
    return 'Nhập tên sản phẩm trước khi lưu Product Marketing Context.';
  }
  const localizedFields: Array<[string, ProductContextLocalizedKey]> = [
    ['Danh mục', 'category'],
    ['Định vị', 'positioning'],
    ['Khách hàng mục tiêu', 'targetAudience'],
    ['Giá trị cốt lõi', 'valueProposition'],
    ['Giọng thương hiệu', 'brandVoice'],
    ['Kêu gọi hành động', 'callToAction'],
  ];
  for (const [label, key] of localizedFields) {
    if (!draft.product[key].vi.trim() || !draft.product[key].en.trim()) {
      return `${label} cần đủ nội dung tiếng Việt và tiếng Anh.`;
    }
  }
  if (draft.sources.length === 0) return 'Thêm ít nhất một nguồn bằng chứng HTTPS.';
  const sourceIds = new Set<string>();
  for (const source of draft.sources) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(source.id)) {
      return 'Mỗi nguồn cần ID chữ thường hợp lệ, ví dụ source-product-site.';
    }
    if (sourceIds.has(source.id)) return `ID nguồn '${source.id}' đang bị trùng.`;
    sourceIds.add(source.id);
    if (!source.title.trim() || source.excerpt.trim().length < 10) {
      return `Nguồn '${source.id}' cần tiêu đề và đoạn trích bằng chứng rõ ràng.`;
    }
    try {
      const url = new URL(source.url);
      if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
    } catch {
      return `Nguồn '${source.id}' phải dùng URL HTTPS hợp lệ.`;
    }
  }
  if (draft.product.proofClaims.length === 0) {
    return 'Thêm ít nhất một claim được phép và gắn với nguồn bằng chứng.';
  }
  const proofIds = new Set<string>();
  for (const claim of draft.product.proofClaims) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(claim.id) || proofIds.has(claim.id)) {
      return 'Claim được phép cần ID chữ thường, duy nhất.';
    }
    proofIds.add(claim.id);
    if (!claim.text.vi.trim() || !claim.text.en.trim()) {
      return `Claim '${claim.id}' cần đủ tiếng Việt và tiếng Anh.`;
    }
    if (
      claim.sourceIds.length === 0
      || claim.sourceIds.some((sourceId) => !sourceIds.has(sourceId))
    ) {
      return `Claim '${claim.id}' phải tham chiếu ít nhất một nguồn đang có.`;
    }
  }
  if (draft.product.prohibitedClaims.length === 0) {
    return 'Thêm ít nhất một claim bị cấm để Brand Guardian chặn nội dung rủi ro.';
  }
  const prohibitedIds = new Set<string>();
  for (const claim of draft.product.prohibitedClaims) {
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(claim.id) || prohibitedIds.has(claim.id)) {
      return 'Claim bị cấm cần ID chữ thường, duy nhất.';
    }
    prohibitedIds.add(claim.id);
    if (
      !claim.text.vi.trim()
      || !claim.text.en.trim()
      || !claim.reason.vi.trim()
      || !claim.reason.en.trim()
    ) {
      return `Claim bị cấm '${claim.id}' cần đủ nội dung và lý do VI/EN.`;
    }
  }
  return '';
}

function formatDate(value: string, includeTime = false): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Chưa ghi nhận';
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit' } : {}),
  }).format(date);
}

function getCustomerApi(): ElectronCustomerMarketingApi | null {
  return window.electronAPI?.customerMarketing ?? null;
}

function humanize(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (letter) => letter.toUpperCase());
}

function memberInitials(email: string): string {
  const localPart = email.split('@')[0] || email;
  return localPart
    .split(/[._-]+/)
    .map((part) => part.charAt(0))
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'M';
}

function statusLabel(value: string): string {
  const labels: Record<string, string> = {
    queued: 'Đang xếp hàng',
    in_progress: 'Đang thực hiện',
    awaiting_approval: 'Chờ duyệt',
    ready: 'Sẵn sàng',
    completed: 'Hoàn tất',
    blocked: 'Đang chặn',
    pending: 'Chờ xử lý',
    approved: 'Đã duyệt',
    rejected: 'Đã từ chối',
    available: 'Có sẵn',
    installed: 'Đã cài',
    running: 'Đang chạy',
    needs_setup: 'Cần thiết lập',
    surface_ready: 'Có thể dùng',
    surface_setup: 'Cần thiết lập',
    surface_plan_required: 'Chưa đủ gói',
    surface_permission_required: 'Không đủ quyền',
    surface_catalog_only: 'Chưa có màn hình riêng',
    awaiting_preview_approval: 'Chờ duyệt preview',
    checking: 'Đang kiểm tra',
    preview_ready: 'Preview sẵn sàng',
    failed: 'Kiểm tra lỗi',
  };
  return labels[value] ?? humanize(value);
}

function toneForStatus(value: string): 'positive' | 'warning' | 'negative' | 'neutral' {
  if (['completed', 'ready', 'approved', 'available', 'running', 'preview_ready', 'surface_ready'].includes(value)) return 'positive';
  if (['blocked', 'rejected', 'failed'].includes(value)) return 'negative';
  if (['pending', 'awaiting_approval', 'awaiting_preview_approval', 'checking', 'in_progress', 'needs_setup', 'queued', 'surface_setup', 'surface_plan_required', 'surface_permission_required'].includes(value)) return 'warning';
  return 'neutral';
}


function StatusPill({ value, id }: { value: string; id?: string }) {
  return (
    <span id={id} className={`cmr-pill cmr-pill--${toneForStatus(value)}`}>
      <span className="cmr-pill__dot" />
      {statusLabel(value)}
    </span>
  );
}

function approvalRiskLabel(value: CustomerApproval['risk']): string {
  return { low: 'Thấp', medium: 'Trung bình', high: 'Cao' }[value];
}

function approvalActionLabel(kind: CustomerApproval['kind']): string {
  if (kind === 'media_preview') return 'Cho phép kiểm tra';
  if (kind === 'media_render') return 'Cho phép render';
  if (kind === 'media_publish') return 'Cho phép xuất bản';
  return 'Duyệt kế hoạch';
}

function ProgressBar({ value }: { value: number }) {
  const safeValue = Math.min(100, Math.max(0, Math.round(value)));
  return (
    <div
      className="cmr-progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={safeValue}
      aria-label={`Tiến độ ${safeValue}%`}
    >
      <span style={{ width: `${safeValue}%` }} />
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  hint,
  multiline = false,
  placeholder,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  multiline?: boolean;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="cmr-field">
      <span className="cmr-field__label">
        {label}
        {required && <b aria-hidden="true">*</b>}
      </span>
      {multiline ? (
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          rows={4}
        />
      ) : (
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          required={required}
        />
      )}
      {hint && <span className="cmr-field__hint">{hint}</span>}
    </label>
  );
}

function CheckOption({
  checked,
  label,
  hint,
  onChange,
}: {
  checked: boolean;
  label: string;
  hint?: string;
  onChange: () => void;
}) {
  return (
    <label className={`cmr-option ${checked ? 'is-checked' : ''}`}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span className="cmr-option__mark" aria-hidden="true">
        {checked ? '✓' : ''}
      </span>
      <span className="cmr-option__copy">
        <strong>{label}</strong>
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

interface OnboardingProps {
  form: CustomerOnboardingInput;
  setForm: React.Dispatch<React.SetStateAction<CustomerOnboardingInput>>;
  busy: boolean;
  error?: string;
  onComplete: (input: CustomerOnboardingInput) => Promise<void>;
}

function OnboardingRoom({ form, setForm, busy, error, onComplete }: OnboardingProps) {
  const [step, setStep] = useState(1);
  const [localError, setLocalError] = useState('');

  const updateBusiness = (key: keyof CustomerOnboardingInput['business'], value: string) => {
    setForm((current) => ({
      ...current,
      business: { ...current.business, [key]: value },
    }));
  };

  const updateBrand = <Key extends keyof CustomerOnboardingInput['brand']>(
    key: Key,
    value: CustomerOnboardingInput['brand'][Key],
  ) => {
    setForm((current) => ({
      ...current,
      brand: { ...current.brand, [key]: value },
    }));
  };

  const updateAudience = (key: keyof CustomerOnboardingInput['audience'], value: string) => {
    setForm((current) => ({
      ...current,
      audience: { ...current.audience, [key]: value },
    }));
  };

  const toggleObjective = (value: CustomerObjective) => {
    setForm((current) => ({
      ...current,
      objectives: current.objectives.includes(value)
        ? current.objectives.filter((item) => item !== value)
        : [...current.objectives, value],
    }));
  };

  const toggleChannel = (value: CustomerChannel) => {
    setForm((current) => ({
      ...current,
      channels: current.channels.includes(value)
        ? current.channels.filter((item) => item !== value)
        : [...current.channels, value],
    }));
  };

  const validateStep = (currentStep: number): string => {
    if (currentStep === 1) {
      if (!form.business.name.trim() || !form.business.industry.trim() || !form.business.offer.trim()) {
        return 'Hãy nhập tên doanh nghiệp, lĩnh vực và sản phẩm/dịch vụ.';
      }
    }
    if (currentStep === 4 && form.objectives.length === 0) {
      return 'Chọn ít nhất một mục tiêu để AI ưu tiên kế hoạch.';
    }
    if (currentStep === 5 && form.channels.length === 0) {
      return 'Chọn ít nhất một kênh triển khai.';
    }
    return '';
  };

  const moveNext = () => {
    const message = validateStep(step);
    if (message) {
      setLocalError(message);
      return;
    }
    setLocalError('');
    setStep((current) => Math.min(7, current + 1));
  };

  const moveBack = () => {
    setLocalError('');
    setStep((current) => Math.max(1, current - 1));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const message = validateStep(step);
    if (message) {
      setLocalError(message);
      return;
    }
    if (step < 7) {
      moveNext();
      return;
    }
    setLocalError('');
    const completedForm: CustomerOnboardingInput = {
      ...form,
      completedSteps: [1, 2, 3, 4, 5, 6, 7],
    };
    setForm(completedForm);
    await onComplete(completedForm);
  };

  const currentError = localError || error;

  return (
    <div className="cmr-page cmr-page--onboarding">
      <div className="cmr-onboarding-shell">
        <header className="cmr-onboarding-header">
          <div>
            <span className="cmr-eyebrow">Customer workspace / AI Marketing</span>
            <h1>Thiết lập phòng Marketing AI</h1>
            <p>
              Cho AI biết doanh nghiệp, thương hiệu và ưu tiên của bạn. Sau đó bạn có thể giao mục tiêu bằng một câu lệnh.
            </p>
          </div>
          <div className="cmr-onboarding-progress">
            <strong>{step}/7</strong>
            <span>Bước thiết lập</span>
          </div>
        </header>

        <div className="cmr-step-rail" aria-label="Các bước onboarding">
          {STEP_LABELS.map((label, index) => {
            const stepNumber = index + 1;
            const isDone = form.completedSteps.includes(stepNumber);
            const isCurrent = step === stepNumber;
            return (
              <button
                type="button"
                key={label}
                className={`cmr-step ${isCurrent ? 'is-current' : ''} ${isDone ? 'is-done' : ''}`}
                onClick={() => {
                  if (stepNumber <= step || isDone) {
                    setLocalError('');
                    setStep(stepNumber);
                  }
                }}
                aria-current={isCurrent ? 'step' : undefined}
              >
                <span className="cmr-step__number">{isDone ? '✓' : stepNumber}</span>
                <span className="cmr-step__label">{label}</span>
              </button>
            );
          })}
        </div>

        <form className="cmr-onboarding-panel" onSubmit={submit}>
          <div className="cmr-onboarding-panel__heading">
            <div>
              <span className="cmr-eyebrow">Bước {step}</span>
              <h2>{STEP_LABELS[step - 1]}</h2>
            </div>
            <span className="cmr-muted">Thông tin chỉ dùng cho workspace của bạn</span>
          </div>

          {step === 1 && (
            <div className="cmr-form-grid">
              <Field label="Tên doanh nghiệp" value={form.business.name} onChange={(value) => updateBusiness('name', value)} required placeholder="Ví dụ: Công ty của bạn" />
              <Field label="Lĩnh vực" value={form.business.industry} onChange={(value) => updateBusiness('industry', value)} required placeholder="SaaS, giáo dục, bán lẻ..." />
              <Field label="Website" value={form.business.website} onChange={(value) => updateBusiness('website', value)} placeholder="https://..." />
              <Field label="Khu vực hoạt động" value={form.business.region} onChange={(value) => updateBusiness('region', value)} placeholder="Việt Nam, Đông Nam Á..." />
              <div className="cmr-field cmr-field--wide">
                <Field label="Sản phẩm hoặc dịch vụ" value={form.business.offer} onChange={(value) => updateBusiness('offer', value)} multiline required placeholder="Bạn đang bán gì, cho ai và giá trị chính là gì?" />
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="cmr-form-grid">
              <Field label="Logo URL" value={form.brand.logoUrl} onChange={(value) => updateBrand('logoUrl', value)} placeholder="https://..." />
              <Field label="Font thương hiệu" value={form.brand.font} onChange={(value) => updateBrand('font', value)} placeholder="Inter, Manrope..." />
              <label className="cmr-field">
                <span className="cmr-field__label">Màu chính</span>
                <span className="cmr-color-field">
                  <input type="color" value={form.brand.primaryColor} onChange={(event) => updateBrand('primaryColor', event.target.value)} />
                  <input value={form.brand.primaryColor} onChange={(event) => updateBrand('primaryColor', event.target.value)} aria-label="Mã màu chính" />
                </span>
              </label>
              <label className="cmr-field">
                <span className="cmr-field__label">Màu nhấn</span>
                <span className="cmr-color-field">
                  <input type="color" value={form.brand.accentColor} onChange={(event) => updateBrand('accentColor', event.target.value)} />
                  <input value={form.brand.accentColor} onChange={(event) => updateBrand('accentColor', event.target.value)} aria-label="Mã màu nhấn" />
                </span>
              </label>
              <div className="cmr-field cmr-field--wide">
                <Field label="Tone of voice" value={form.brand.tone} onChange={(value) => updateBrand('tone', value)} placeholder="Rõ ràng, thân thiện, chuyên gia..." />
              </div>
              <div className="cmr-field cmr-field--wide">
                <Field label="Brand guideline" value={form.brand.guidelines} onChange={(value) => updateBrand('guidelines', value)} multiline placeholder="Các nguyên tắc AI cần tuân thủ..." />
              </div>
              <div className="cmr-field">
                <Field label="Từ nên dùng" value={form.brand.wordsToUse.join(', ')} onChange={(value) => updateBrand('wordsToUse', value.split(',').map((item) => item.trim()).filter(Boolean))} placeholder="tin cậy, thực tế, nhanh" />
              </div>
              <div className="cmr-field">
                <Field label="Từ nên tránh" value={form.brand.wordsToAvoid.join(', ')} onChange={(value) => updateBrand('wordsToAvoid', value.split(',').map((item) => item.trim()).filter(Boolean))} placeholder="cam kết 100%, rẻ nhất" />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="cmr-form-grid">
              <div className="cmr-field cmr-field--wide">
                <Field label="Nhóm khách hàng" value={form.audience.segments} onChange={(value) => updateAudience('segments', value)} multiline placeholder="Ai là người mua hoặc người dùng chính?" />
              </div>
              <Field label="Nhu cầu" value={form.audience.needs} onChange={(value) => updateAudience('needs', value)} multiline placeholder="Họ đang muốn đạt điều gì?" />
              <Field label="Vấn đề / pain points" value={form.audience.painPoints} onChange={(value) => updateAudience('painPoints', value)} multiline placeholder="Điều gì đang cản trở họ?" />
              <Field label="Hành vi" value={form.audience.behaviors} onChange={(value) => updateAudience('behaviors', value)} multiline placeholder="Họ tìm hiểu và quyết định như thế nào?" />
              <Field label="Thị trường" value={form.audience.market} onChange={(value) => updateAudience('market', value)} placeholder="Việt Nam, quốc tế..." />
            </div>
          )}

          {step === 4 && (
            <div className="cmr-choice-grid">
              {OBJECTIVE_OPTIONS.map((option) => (
                <CheckOption
                  key={option.value}
                  checked={form.objectives.includes(option.value)}
                  label={option.label}
                  hint={option.hint}
                  onChange={() => toggleObjective(option.value)}
                />
              ))}
            </div>
          )}

          {step === 5 && (
            <div className="cmr-choice-grid cmr-choice-grid--channels">
              {CHANNEL_OPTIONS.map((option) => (
                <CheckOption
                  key={option.value}
                  checked={form.channels.includes(option.value)}
                  label={option.label}
                  onChange={() => toggleChannel(option.value)}
                />
              ))}
            </div>
          )}

          {step === 6 && (
            <div className="cmr-form-grid">
              <div className="cmr-field cmr-field--wide">
                <Field
                  label="Tài nguyên sẵn có"
                  value={form.resources.join('\n')}
                  onChange={(value) => setForm((current) => ({
                    ...current,
                    resources: value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
                  }))}
                  multiline
                  placeholder="Mỗi dòng một URL, tài liệu hoặc mô tả tài nguyên..."
                />
              </div>
              <div className="cmr-info-strip cmr-info-strip--wide">
                <StatusIcon className="cmr-info-strip__icon" />
                <span>Chỉ lưu mô tả và đường dẫn bạn cung cấp. AI sẽ không tự truy cập hay xuất bản tài nguyên nếu chưa có quyền.</span>
              </div>
            </div>
          )}

          {step === 7 && (
            <div className="cmr-mode-grid">
              {MODE_OPTIONS.map((option) => (
                <label key={option.value} className={`cmr-mode-card ${form.automationMode === option.value ? 'is-selected' : ''}`}>
                  <input
                    type="radio"
                    name="automation-mode"
                    value={option.value}
                    checked={form.automationMode === option.value}
                    onChange={() => setForm((current) => ({ ...current, automationMode: option.value }))}
                  />
                  <span className="cmr-mode-card__mark" />
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </span>
                </label>
              ))}
              <div className="cmr-safety-note">
                <ReviewIcon className="cmr-safety-note__icon" />
                <div>
                  <strong>Approval luôn bật cho hành động nhạy cảm</strong>
                  <span>Không chế độ nào tự ý chi tiền, publish, gửi email hàng loạt hoặc đổi integration.</span>
                </div>
              </div>
            </div>
          )}

          {currentError && <div className="cmr-alert cmr-alert--error" role="alert">{currentError}</div>}

          <div className="cmr-onboarding-actions">
            <button type="button" className="cmr-button cmr-button--quiet" onClick={moveBack} disabled={step === 1 || busy}>
              Quay lại
            </button>
            <span className="cmr-muted">Bạn có thể điều chỉnh Brand Center sau khi hoàn tất.</span>
            <button type="submit" className="cmr-button cmr-button--primary" disabled={busy}>
              {busy ? 'Đang lưu...' : step === 7 ? 'Hoàn tất thiết lập' : 'Tiếp tục'}
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface DirectorComposerProps {
  onSubmit: (goal: string) => Promise<void>;
  busy: boolean;
  compact?: boolean;
}

function DirectorComposer({ onSubmit, busy, compact = false }: DirectorComposerProps) {
  const [goal, setGoal] = useState('');
  const [localError, setLocalError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const value = goal.trim();
    if (value.length < 8) {
      setLocalError('Viết mục tiêu cụ thể hơn để AI lập workflow.');
      return;
    }
    setLocalError('');
    await onSubmit(value);
  };

  const quickPrompts = [
    'Lên kế hoạch marketing cho 30 ngày tới',
    'Tạo nội dung cho 7 ngày trên các kênh chính',
    'Phân tích cơ hội tăng traffic và lead',
  ];

  return (
    <form className={`cmr-director-composer ${compact ? 'cmr-director-composer--compact' : ''}`} onSubmit={submit}>
      <div className="cmr-director-composer__topline">
        <span className="cmr-agent-mark"><SparkIcon className="cmr-icon" /></span>
        <div>
          <span className="cmr-eyebrow">AI Marketing Director</span>
          <strong>Giao việc cho phòng Marketing AI</strong>
        </div>
        <span className="cmr-live-state"><span /> Sẵn sàng</span>
      </div>
      <label className="cmr-director-input">
        <span className="cmr-sr-only">Mục tiêu marketing</span>
        <textarea
          value={goal}
          onChange={(event) => setGoal(event.target.value)}
          placeholder="Hôm nay bạn muốn phòng Marketing AI làm gì?"
          rows={compact ? 3 : 4}
        />
      </label>
      <div className="cmr-prompt-row">
        {quickPrompts.map((prompt) => (
          <button type="button" key={prompt} className="cmr-prompt-chip" onClick={() => setGoal(prompt)}>
            {prompt}
          </button>
        ))}
      </div>
      {localError && <span className="cmr-inline-error">{localError}</span>}
      <div className="cmr-director-composer__footer">
        <span className="cmr-muted">AI sẽ lập kế hoạch và tạo điểm phê duyệt trước hành động bên ngoài.</span>
        <button type="submit" className="cmr-button cmr-button--primary" disabled={busy || !goal.trim()}>
          {busy ? 'Đang điều phối...' : 'Bắt đầu workflow'}
          <SparkIcon className="cmr-button__icon" />
        </button>
      </div>
    </form>
  );
}

function WorkspaceHeader({
  snapshot,
  onRefresh,
  onOpenSettings,
  settingsOpen,
  busy,
}: {
  snapshot: CustomerMarketingSnapshot;
  onRefresh: () => Promise<void>;
  onOpenSettings: () => void;
  settingsOpen: boolean;
  busy: boolean;
}) {
  const profileSyncStatus = snapshot.workspace.profileSyncStatus;
  const syncLabel = profileSyncStatus === 'synced'
    ? 'Hồ sơ đã đồng bộ'
    : profileSyncStatus === 'conflict'
      ? 'Hồ sơ có xung đột, cần xem lại'
      : profileSyncStatus === 'unavailable'
        ? 'Chưa xác nhận đồng bộ'
        : 'Hồ sơ lưu trên thiết bị';
  return (
    <header className="cmr-header">
      <div className="cmr-header__copy">
        <span className="cmr-eyebrow">Customer workspace / AI Marketing</span>
        <h1>{snapshot.workspace.name}</h1>
        <p>Phòng Marketing AI của bạn tập trung vào mục tiêu, workflow và quyết định cần duyệt.</p>
      </div>
      <div className="cmr-header__meta">
        <span className={`cmr-workspace-status cmr-workspace-status--${profileSyncStatus}`}>
          <span /> {syncLabel}
        </span>
        <span className="cmr-credit-balance">
          {snapshot.workspace.creditBalance.toLocaleString('vi-VN')} credit
          <small>/ {snapshot.workspace.monthlyQuota.toLocaleString('vi-VN')} credit/tháng</small>
        </span>
        {(snapshot.workspace.role === 'owner' || snapshot.workspace.role === 'manager') && (
          <button
            type="button"
            className="cmr-icon-button"
            onClick={onOpenSettings}
            aria-label="Mở cài đặt workspace"
            aria-haspopup="dialog"
            aria-expanded={settingsOpen}
            aria-controls="cmr-workspace-settings"
            title="Cài đặt workspace"
          >
            <SettingsIcon className="cmr-icon" />
          </button>
        )}
        <button type="button" className="cmr-icon-button" onClick={() => void onRefresh()} disabled={busy} aria-label="Tải lại workspace" title="Tải lại workspace">
          <RefreshIcon className="cmr-icon" />
        </button>
      </div>
    </header>
  );
}

function WorkspaceSettingsDrawer({
  open,
  snapshot,
  onClose,
}: {
  open: boolean;
  snapshot: CustomerMarketingSnapshot;
  onClose: () => void;
}) {
  const [members, setMembers] = useState<CustomerWorkspaceMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingUserId, setSavingUserId] = useState('');
  const [loadError, setLoadError] = useState('');
  const [mutationError, setMutationError] = useState('');
  const [failedUpdate, setFailedUpdate] = useState<{
    memberUserId: string;
    role: CustomerAssignableRole;
  } | null>(null);
  const [notice, setNotice] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<CustomerAssignableRole>('viewer');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteNotice, setInviteNotice] = useState('');
  const [inviteError, setInviteError] = useState('');
  const [inviteCopyPending, setInviteCopyPending] = useState(false);
  const drawerRef = useRef<HTMLElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const canManage = snapshot.workspace.role === 'owner' || snapshot.workspace.role === 'manager';
  const canInvite = snapshot.workspace.role === 'owner';

  const refreshMembers = useCallback(async () => {
    setLoadError('');
    setMutationError('');
    setFailedUpdate(null);
    setNotice('');
    if (!canManage) {
      setMembers([]);
      setLoadError(`Vai trò ${MEMBER_ROLE_LABELS[snapshot.workspace.role]} không có quyền quản lý thành viên.`);
      return;
    }
    const api = getCustomerApi();
    if (!api) {
      setMembers([]);
      setLoadError('Không tìm thấy kết nối Customer Marketing trong phiên này.');
      return;
    }
    setLoading(true);
    try {
      const result = await api.listWorkspaceMembers();
      if (!result.ok) {
        setMembers([]);
        setLoadError(result.error || 'Không tải được danh sách thành viên.');
        return;
      }
      setMembers(result.members);
    } catch {
      setMembers([]);
      setLoadError('Không tải được danh sách thành viên. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  }, [canManage, snapshot.workspace.role]);

  useEffect(() => {
    if (!open) return;
    void refreshMembers();
  }, [open, refreshMembers]);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const page = drawerRef.current?.closest<HTMLElement>('.cmr-page') ?? null;
    const previousOverflow = document.body.style.overflow;
    const previousPageOverflow = page?.style.overflow ?? '';
    document.body.style.overflow = 'hidden';
    if (page) page.style.overflow = 'hidden';
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !drawerRef.current) return;
      const focusable = Array.from(drawerRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.getClientRects().length > 0);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (page) page.style.overflow = previousPageOverflow;
      previousFocusRef.current?.focus();
    };
  }, [open, onClose]);

  const updateRole = async (member: CustomerWorkspaceMember, role: CustomerAssignableRole) => {
    if (role === member.role || !member.editableRoles.includes(role)) return;
    const api = getCustomerApi();
    if (!api) {
      setMutationError('Không tìm thấy kết nối Customer Marketing trong phiên này.');
      setFailedUpdate({ memberUserId: member.userId, role });
      return;
    }
    setSavingUserId(member.userId);
    setMutationError('');
    setFailedUpdate(null);
    setNotice('');
    try {
      const result: CustomerWorkspaceMembersResult = await api.updateWorkspaceMemberRole({
        memberUserId: member.userId,
        role,
      });
      if (!result.ok) {
        setMutationError(result.error || 'Không cập nhật được vai trò. Dữ liệu hiện tại vẫn được giữ lại.');
        setFailedUpdate({ memberUserId: member.userId, role });
        return;
      }
      setMembers(result.members);
      setFailedUpdate(null);
      setNotice(`Đã cập nhật ${member.email} thành ${MEMBER_ROLE_LABELS[role]}.`);
    } catch {
      setMutationError('Không cập nhật được vai trò. Dữ liệu hiện tại vẫn được giữ lại.');
      setFailedUpdate({ memberUserId: member.userId, role });
    } finally {
      setSavingUserId('');
    }
  };

  const createInvitation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canInvite || inviteBusy) return;
    const api = getCustomerApi();
    if (!api) {
      setInviteError('Không tìm thấy kết nối Customer Marketing trong phiên này.');
      return;
    }
    setInviteBusy(true);
    setInviteError('');
    setInviteNotice('');
    setInviteCopyPending(false);
    try {
      const result = await api.createWorkspaceInvitation({
        email: inviteEmail,
        role: inviteRole,
      });
      if (!result.ok) {
        setInviteError(result.error || 'Không tạo được lời mời.');
        return;
      }
      const expiry = result.expiresAt ? ` Hết hạn ${formatDate(result.expiresAt, true)}.` : '';
      setInviteNotice(`Đã tạo lời mời cho ${result.email || inviteEmail}.${expiry}`);
      if (result.copied) {
        setInviteEmail('');
      } else {
        setInviteCopyPending(true);
        setInviteError(result.error || 'Đã tạo lời mời nhưng chưa sao chép được liên kết.');
      }
    } catch {
      setInviteError('Không tạo được lời mời. Vui lòng thử lại.');
    } finally {
      setInviteBusy(false);
    }
  };

  const retryInvitationCopy = async () => {
    const api = getCustomerApi();
    if (!api || inviteBusy) return;
    setInviteBusy(true);
    setInviteError('');
    try {
      const result = await api.retryWorkspaceInvitationCopy();
      if (!result.ok || !result.copied) {
        setInviteCopyPending(result.ok);
        setInviteError(result.error || 'Chưa sao chép được liên kết lời mời.');
        return;
      }
      setInviteCopyPending(false);
      setInviteEmail('');
      setInviteNotice(`Đã sao chép liên kết mời cho ${result.email || 'thành viên mới'}.`);
    } catch {
      setInviteCopyPending(true);
      setInviteError('Chưa sao chép được liên kết lời mời. Vui lòng thử lại.');
    } finally {
      setInviteBusy(false);
    }
  };

  if (!open) return null;

  return (
    <div
      className="cmr-settings-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={drawerRef}
        id="cmr-workspace-settings"
        className="cmr-settings-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cmr-settings-title"
      >
        <header className="cmr-settings-drawer__header">
          <div>
            <span className="cmr-eyebrow">Workspace settings</span>
            <h2 id="cmr-settings-title">Thành viên và vai trò</h2>
            <p>{snapshot.workspace.name}</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="cmr-icon-button"
            onClick={onClose}
            aria-label="Đóng cài đặt workspace"
            title="Đóng"
          >
            <CloseIcon className="cmr-icon" />
          </button>
        </header>

        <div className="cmr-settings-drawer__body">
          {canInvite && (
            <section className="cmr-invite-section" aria-labelledby="cmr-invite-title">
              <div className="cmr-invite-section__heading">
                <div>
                  <span className="cmr-eyebrow">Mời thành viên</span>
                  <h3 id="cmr-invite-title">Tạo liên kết dùng một lần</h3>
                </div>
                <span>7 ngày</span>
              </div>
              <form className="cmr-invite-form" onSubmit={(event) => void createInvitation(event)}>
                <label className="cmr-invite-field cmr-invite-field--email">
                  <span>Email</span>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    placeholder="thanhvien@doanhnghiep.vn"
                    autoComplete="email"
                    maxLength={320}
                    required
                    disabled={inviteBusy}
                  />
                </label>
                <label className="cmr-invite-field">
                  <span>Vai trò</span>
                  <select
                    value={inviteRole}
                    onChange={(event) => setInviteRole(event.target.value as CustomerAssignableRole)}
                    disabled={inviteBusy}
                  >
                    {INVITATION_ROLE_OPTIONS.map((role) => (
                      <option key={role} value={role}>{MEMBER_ROLE_LABELS[role]}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  className="cmr-button cmr-button--primary cmr-invite-submit"
                  disabled={inviteBusy || !inviteEmail.trim()}
                >
                  {inviteBusy ? 'Đang xử lý...' : 'Tạo liên kết mời'}
                </button>
              </form>
              {inviteNotice && (
                <div className="cmr-alert cmr-alert--success" role="status" aria-live="polite">
                  {inviteNotice}
                </div>
              )}
              {inviteError && (
                <div className="cmr-alert cmr-alert--error cmr-invite-error" role="alert">
                  <span>{inviteError}</span>
                  {inviteCopyPending && (
                    <button
                      type="button"
                      className="cmr-text-button"
                      onClick={() => void retryInvitationCopy()}
                      disabled={inviteBusy}
                    >
                      Sao chép lại
                    </button>
                  )}
                </div>
              )}
            </section>
          )}
          <div className="cmr-member-summary">
            <div>
              <AgentHubIcon className="cmr-icon" />
              <span>Thành viên</span>
            </div>
            <strong>{loading ? '...' : members.length}</strong>
          </div>

          {loadError && (
            <div className="cmr-settings-state cmr-settings-state--error" role="alert">
              <StatusIcon className="cmr-settings-state__icon" />
              <strong>Không tải được thành viên</strong>
              <span>{loadError}</span>
              {canManage && (
                <button type="button" className="cmr-button cmr-button--quiet" onClick={() => void refreshMembers()} disabled={loading}>
                  Thử lại <RefreshIcon className="cmr-button__icon" />
                </button>
              )}
            </div>
          )}
          {notice && <div className="cmr-alert cmr-alert--success" role="status" aria-live="polite">{notice}</div>}
          {mutationError && (
            <div className="cmr-alert cmr-alert--error" role="alert">
              {mutationError}
              {failedUpdate && (
                <button
                  type="button"
                  className="cmr-text-button"
                  disabled={Boolean(savingUserId)}
                  onClick={() => {
                    const member = members.find((item) => item.userId === failedUpdate.memberUserId);
                    if (member) void updateRole(member, failedUpdate.role);
                  }}
                >
                  Thử lại
                </button>
              )}
            </div>
          )}

          {loading && !loadError && (
            <div className="cmr-settings-state" role="status" aria-busy="true">
              <span className="cmr-loading-orbit" />
              <strong>Đang tải thành viên</strong>
              <span>Đang xác nhận quyền với IzziAPI...</span>
            </div>
          )}

          {!loading && !loadError && members.length === 0 && (
            <div className="cmr-settings-state">
              <AgentHubIcon className="cmr-settings-state__icon" />
              <strong>Chưa có thành viên</strong>
              <span>Workspace chưa trả về thành viên đang hoạt động.</span>
            </div>
          )}

          {!loading && !loadError && members.length > 0 && (
            <div className="cmr-member-list" aria-label="Danh sách thành viên workspace">
              {members.map((member) => {
                const saving = savingUserId === member.userId;
                return (
                  <div className="cmr-member-row" key={member.userId}>
                    <span className="cmr-member-avatar" aria-hidden="true">{memberInitials(member.email)}</span>
                    <div className="cmr-member-copy">
                      <div>
                        <strong>{member.email}</strong>
                        {member.isCurrentUser && <span className="cmr-member-you">Bạn</span>}
                      </div>
                      <span className={`cmr-member-status cmr-member-status--${member.status}`}>
                        <span /> {member.status === 'active' ? 'Đang hoạt động' : 'Tạm ngưng'}
                      </span>
                      <small>Tham gia {formatDate(member.joinedAt)}</small>
                    </div>
                    <div className="cmr-member-role">
                      {member.editableRoles.length > 0 ? (
                        <label>
                          <span className="cmr-sr-only">Vai trò của {member.email}</span>
                          <select
                            value={member.role}
                            onChange={(event) => void updateRole(member, event.target.value as CustomerAssignableRole)}
                            disabled={Boolean(savingUserId)}
                            aria-label={`Vai trò của ${member.email}`}
                          >
                            {member.editableRoles.map((role) => <option key={role} value={role}>{MEMBER_ROLE_LABELS[role]}</option>)}
                          </select>
                        </label>
                      ) : (
                        <span className="cmr-member-role__locked">{MEMBER_ROLE_LABELS[member.role]}</span>
                      )}
                      <small>{saving ? 'Đang lưu...' : member.editableRoles.length > 0 ? 'Có thể chỉnh sửa' : 'Được bảo vệ'}</small>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function WorkspaceNav({
  view,
  setView,
  pendingCount,
  videoStudioAvailable,
}: {
  view: ViewId;
  setView: (view: ViewId) => void;
  pendingCount: number;
  videoStudioAvailable: boolean;
}) {
  const navRef = useRef<HTMLDivElement>(null);
  const visibleItems = videoStudioAvailable ? VIEW_ITEMS : VIEW_ITEMS.filter((item) => item.id !== 'video');

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const revealActive = () => {
      const active = nav.querySelector<HTMLElement>('[aria-selected="true"]');
      if (!active || nav.scrollWidth <= nav.clientWidth) return;
      const navRect = nav.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      nav.scrollTo({
        left: Math.max(0, nav.scrollLeft + activeRect.left - navRect.left - 3),
        behavior: 'auto',
      });
    };
    revealActive();
    const observer = new ResizeObserver(revealActive);
    observer.observe(nav);
    return () => observer.disconnect();
  }, [view]);

  const moveTabFocus = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...(navRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])];
    const currentIndex = tabs.indexOf(event.currentTarget);
    if (currentIndex < 0 || tabs.length === 0) return;
    event.preventDefault();
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[nextIndex]?.focus();
    tabs[nextIndex]?.click();
  };

  return (
    <div ref={navRef} className="cmr-nav" role="tablist" aria-label="Customer Marketing Room">
      {visibleItems.map(({ id, label, icon: Icon }) => (
        <button
          type="button"
          role="tab"
          key={id}
          id={`cmr-tab-${id}`}
          className={`cmr-nav__item ${view === id ? 'is-active' : ''}`}
          onClick={() => setView(id)}
          onKeyDown={moveTabFocus}
          aria-selected={view === id}
          aria-controls={view === id ? `cmr-view-${id}` : undefined}
          tabIndex={view === id ? 0 : -1}
        >
          <Icon className="cmr-icon" />
          <span>{label}</span>
          {id === 'approvals' && pendingCount > 0 && <b>{pendingCount}</b>}
        </button>
      ))}
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string | number;
  hint: string;
  tone?: 'positive' | 'warning' | 'negative' | 'neutral';
}) {
  return (
    <div className={`cmr-metric cmr-metric--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{hint}</small>
    </div>
  );
}

function WorkflowCard({ run, onOpenGoals }: { run: CustomerRun; onOpenGoals: () => void }) {
  return (
    <section className="cmr-panel cmr-workflow-panel">
      <div className="cmr-section-heading">
        <div>
          <span className="cmr-eyebrow">Workflow gần nhất</span>
          <h2>{run.goal}</h2>
        </div>
        <button type="button" className="cmr-text-button" onClick={onOpenGoals}>Xem chi tiết →</button>
      </div>
      <div className="cmr-workflow-meta">
        <StatusPill value={run.status} />
        <span>{run.stage.replace(/_/g, ' ')}</span>
        <span>Cập nhật {formatDate(run.updatedAt, true)}</span>
      </div>
      <ProgressBar value={run.progress} />
      <div className="cmr-workflow-progress-label"><span>Tiến độ workflow</span><strong>{run.progress}%</strong></div>
      <ol className="cmr-run-steps">
        {run.steps.map((step) => (
          <li key={step.id} className={`cmr-run-step cmr-run-step--${step.status}`}>
            <span className="cmr-run-step__marker">{step.status === 'done' ? '✓' : step.status === 'in_progress' ? '•' : ''}</span>
            <span className="cmr-run-step__copy"><strong>{step.label}</strong><small>{step.owner}{step.requiresApproval ? ' · cần duyệt' : ''}</small></span>
            <span className="cmr-run-step__status">{statusLabel(step.status)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ApprovalPreview({
  snapshot,
  onReview,
  busy,
  onOpenApprovals,
}: {
  snapshot: CustomerMarketingSnapshot;
  onReview: (approvalId: string, decision: 'approved' | 'rejected') => Promise<void>;
  busy: boolean;
  onOpenApprovals: () => void;
}) {
  const pending = snapshot.approvals.filter((approval) => approval.status === 'pending');
  const canReview = ['owner', 'manager', 'reviewer'].includes(snapshot.workspace.role);

  return (
    <section className="cmr-panel cmr-approval-preview">
      <div className="cmr-section-heading">
        <div>
          <span className="cmr-eyebrow">Action inbox</span>
          <h2>Điểm cần bạn quyết định</h2>
        </div>
        <button type="button" className="cmr-text-button" onClick={onOpenApprovals}>Mở inbox →</button>
      </div>
      {pending.length === 0 ? (
        <div className="cmr-empty cmr-empty--compact">
          <StatusIcon className="cmr-empty__icon" />
          <strong>Chưa có approval đang chờ</strong>
          <span>AI sẽ dừng lại trước publish, spend hoặc thay đổi integration.</span>
        </div>
      ) : (
        <div className="cmr-approval-list">
          {pending.slice(0, 3).map((approval) => (
            <div className="cmr-approval-row" key={approval.id}>
              <div className="cmr-approval-row__copy">
                <div className="cmr-approval-row__title"><ReviewIcon className="cmr-icon" /><strong>{approval.title}</strong></div>
                <span>{approval.summary}</span>
                <small>{formatDate(approval.requestedAt, true)} · Rủi ro {approval.risk}</small>
              </div>
              <div className="cmr-inline-actions">
                <button type="button" className="cmr-button cmr-button--quiet" disabled={busy || !canReview} onClick={() => void onReview(approval.id, 'rejected')}>Từ chối</button>
                <button type="button" className="cmr-button cmr-button--primary" disabled={busy || !canReview} onClick={() => void onReview(approval.id, 'approved')}>Duyệt</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {!canReview && <span className="cmr-permission-note">Vai trò Viewer/Editor chỉ xem được approval.</span>}
    </section>
  );
}

function HomeView({
  snapshot,
  onDirector,
  onReview,
  onOpen,
  busy,
}: {
  snapshot: CustomerMarketingSnapshot;
  onDirector: (goal: string) => Promise<void>;
  onReview: (approvalId: string, decision: 'approved' | 'rejected') => Promise<void>;
  onOpen: (view: ViewId) => void;
  busy: boolean;
}) {
  const activeRun = snapshot.runs[0];
  const pendingCount = snapshot.approvals.filter((approval) => approval.status === 'pending').length;
  const usedPercentage = snapshot.workspace.monthlyQuota
    ? Math.round((snapshot.workspace.usedCredits / snapshot.workspace.monthlyQuota) * 100)
    : 0;

  return (
    <>
      <div className="cmr-metrics">
        <Metric label="Workflow đang theo dõi" value={snapshot.runs.filter((run) => !['completed', 'blocked'].includes(run.status)).length} hint="Mục tiêu đang được xử lý" tone="positive" />
        <Metric label="Cần bạn duyệt" value={pendingCount} hint={pendingCount ? 'Action inbox đang chờ' : 'Không có việc bị dừng'} tone={pendingCount ? 'warning' : 'positive'} />
        <Metric label="Credit đã dùng" value={snapshot.workspace.usedCredits} hint={`${usedPercentage}% quota tháng`} tone={usedPercentage > 80 ? 'warning' : 'neutral'} />
        <Metric label="Năng lực sẵn sàng" value={snapshot.capabilities.length} hint="Core và extension đang hoạt động" tone="neutral" />
      </div>

      <div className="cmr-home-grid">
        <div className="cmr-home-main">
          <DirectorComposer onSubmit={onDirector} busy={busy} />
          {activeRun ? (
            <WorkflowCard run={activeRun} onOpenGoals={() => onOpen('goals')} />
          ) : (
            <section className="cmr-panel cmr-empty-panel">
              <div className="cmr-empty">
                <TrendUpIcon className="cmr-empty__icon" />
                <span className="cmr-eyebrow">Bước tiếp theo</span>
                <h2>Đưa mục tiêu đầu tiên vào workflow</h2>
                <p>AI Marketing Director sẽ biến mục tiêu kinh doanh thành kế hoạch, bước thực hiện và approval gate.</p>
                <button type="button" className="cmr-button cmr-button--primary" onClick={() => onOpen('director')}>Mở AI Director <SparkIcon className="cmr-button__icon" /></button>
              </div>
            </section>
          )}
        </div>
        <aside className="cmr-home-side">
          <section className="cmr-panel cmr-next-panel">
            <div className="cmr-section-heading">
              <div><span className="cmr-eyebrow">Next actions</span><h2>Việc nên làm tiếp</h2></div>
            </div>
            <ul className="cmr-next-list">
              {snapshot.nextActions.map((action) => <li key={action}><span>→</span><span>{action}</span></li>)}
            </ul>
            <div className="cmr-setup-health">
              <span className="cmr-setup-health__ring">{snapshot.workspace.onboardingComplete ? '✓' : '!'}</span>
              <div><strong>{snapshot.workspace.onboardingComplete ? 'Workspace đã sẵn sàng' : 'Cần hoàn tất setup'}</strong><span>Brand, audience và policy đã được lưu riêng.</span></div>
            </div>
          </section>
          <section className="cmr-panel cmr-guardrail-panel">
            <div className="cmr-guardrail-panel__icon"><StatusIcon className="cmr-icon" /></div>
            <div><strong>External actions đang khóa</strong><span>Approval chỉ cập nhật workflow local. Không có publish hoặc spend tự động.</span></div>
          </section>
        </aside>
      </div>

      <ApprovalPreview snapshot={snapshot} onReview={onReview} busy={busy} onOpenApprovals={() => onOpen('approvals')} />
    </>
  );
}

function DirectorView({
  snapshot,
  onDirector,
  busy,
}: {
  snapshot: CustomerMarketingSnapshot;
  onDirector: (goal: string) => Promise<void>;
  busy: boolean;
}) {
  const latestWithReply = snapshot.runs.find((run) => run.directorReply);
  return (
    <div className="cmr-view-stack">
      <div className="cmr-view-intro">
        <span className="cmr-eyebrow">Điều phối mục tiêu</span>
        <h2>AI Marketing Director</h2>
        <p>Một nơi để giao mục tiêu, nhận kế hoạch và theo dõi điểm cần bạn duyệt.</p>
      </div>
      <DirectorComposer onSubmit={onDirector} busy={busy} />
      {latestWithReply?.directorReply ? (
        <section className="cmr-panel cmr-director-result">
          <div className="cmr-section-heading">
            <div><span className="cmr-eyebrow">Kết quả mới nhất</span><h2>Kế hoạch đề xuất</h2></div>
            <StatusPill value={latestWithReply.status} />
          </div>
          <div className="cmr-director-result__body">{latestWithReply.directorReply}</div>
          <div className="cmr-result-footnote"><ReviewIcon className="cmr-icon" /><span>Đây là đề xuất để bạn xem xét. Workflow vẫn chờ approval trước hành động bên ngoài.</span></div>
        </section>
      ) : (
        <section className="cmr-panel cmr-empty-panel"><div className="cmr-empty"><SparkIcon className="cmr-empty__icon" /><h2>Chưa có kế hoạch từ AI Director</h2><p>Gửi một mục tiêu cụ thể để bắt đầu vòng điều phối đầu tiên.</p></div></section>
      )}
    </div>
  );
}

function GoalsView({ snapshot, onOpenDirector }: { snapshot: CustomerMarketingSnapshot; onOpenDirector: () => void }) {
  return (
    <div className="cmr-view-stack">
      <div className="cmr-view-intro cmr-view-intro--row">
        <div><span className="cmr-eyebrow">Outcome tracking</span><h2>Mục tiêu và workflow</h2><p>Mỗi mục tiêu có trạng thái, người phụ trách và bước cần duyệt.</p></div>
        <button type="button" className="cmr-button cmr-button--primary" onClick={onOpenDirector}>Giao mục tiêu mới <SparkIcon className="cmr-button__icon" /></button>
      </div>
      {snapshot.runs.length === 0 ? (
        <section className="cmr-panel cmr-empty-panel"><div className="cmr-empty"><TrendUpIcon className="cmr-empty__icon" /><h2>Chưa có mục tiêu</h2><p>Giao mục tiêu đầu tiên cho AI Marketing Director.</p></div></section>
      ) : (
        <div className="cmr-goal-list">
          {snapshot.runs.map((run) => (
            <section className="cmr-panel cmr-goal-card" key={run.id}>
              <div className="cmr-goal-card__top">
                <div><span className="cmr-eyebrow">{formatDate(run.createdAt)}</span><h3>{run.goal}</h3></div>
                <StatusPill value={run.status} />
              </div>
              <div className="cmr-goal-card__meta"><span>{run.stage.replace(/_/g, ' ')}</span><span>{run.progress}% hoàn thành</span><span>Cập nhật {formatDate(run.updatedAt, true)}</span></div>
              <ProgressBar value={run.progress} />
              <ol className="cmr-run-steps cmr-run-steps--dense">
                {run.steps.map((step) => <li className={`cmr-run-step cmr-run-step--${step.status}`} key={step.id}><span className="cmr-run-step__marker">{step.status === 'done' ? '✓' : ''}</span><span className="cmr-run-step__copy"><strong>{step.label}</strong><small>{step.owner}</small></span><span className="cmr-run-step__status">{statusLabel(step.status)}</span></li>)}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function ApprovalsView({
  snapshot,
  onReview,
  busy,
}: {
  snapshot: CustomerMarketingSnapshot;
  onReview: (approvalId: string, decision: 'approved' | 'rejected') => Promise<void>;
  busy: boolean;
}) {
  const canReview = ['owner', 'manager', 'reviewer'].includes(snapshot.workspace.role);
  return (
    <div className="cmr-view-stack">
      <div className="cmr-view-intro"><span className="cmr-eyebrow">Có người phê duyệt</span><h2>Điểm cần duyệt</h2><p>Quyết định của bạn chỉ thay đổi trạng thái workflow local; hệ thống không tự xuất bản hay chi tiêu.</p></div>
      {!canReview && <div className="cmr-alert cmr-alert--info">Vai trò hiện tại là {snapshot.workspace.role}. Bạn có thể xem approval nhưng không có quyền quyết định.</div>}
      {snapshot.approvals.length === 0 ? (
        <section className="cmr-panel cmr-empty-panel"><div className="cmr-empty"><ReviewIcon className="cmr-empty__icon" /><h2>Inbox đang trống</h2><p>Các điểm cần duyệt sẽ xuất hiện tại đây khi workflow tạo ra.</p></div></section>
      ) : (
        <div className="cmr-approval-full-list">
          {snapshot.approvals.map((approval) => (
            <section className="cmr-panel cmr-approval-card" key={approval.id}>
              <div className="cmr-approval-card__top"><div><span className="cmr-eyebrow">Yêu cầu {formatDate(approval.requestedAt, true)}</span><h3>{approval.title}</h3></div><StatusPill value={approval.status} /></div>
              <p>{approval.summary}</p>
              <div className="cmr-approval-card__meta"><span className={`cmr-risk cmr-risk--${approval.risk}`}>Rủi ro: {approvalRiskLabel(approval.risk)}</span><span>Thuộc workspace hiện tại</span>{approval.reviewedAt && <span>Đã xử lý {formatDate(approval.reviewedAt, true)}</span>}</div>
              {approval.status === 'pending' && <div className="cmr-inline-actions"><button type="button" className="cmr-button cmr-button--quiet" disabled={busy || !canReview} onClick={() => void onReview(approval.id, 'rejected')}>Từ chối</button><button type="button" className="cmr-button cmr-button--primary" disabled={busy || !canReview} onClick={() => void onReview(approval.id, 'approved')}>{approvalActionLabel(approval.kind)}</button></div>}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function VideoStudioView({
  snapshot,
  onImport,
  onPreview,
  onReview,
  busy,
}: {
  snapshot: CustomerMarketingSnapshot;
  onImport: () => Promise<void>;
  onPreview: (jobId: string) => Promise<void>;
  onReview: (approvalId: string, decision: 'approved' | 'rejected') => Promise<void>;
  busy: boolean;
}) {
  const { toolchain, jobs, artifacts } = snapshot.media;
  const canReview = ['owner', 'manager', 'reviewer'].includes(snapshot.workspace.role);
  const planAllowsImport = customerPlanMeetsMinimum(snapshot.workspace.plan, 'pro');
  const roleAllowsImport = ['owner', 'manager', 'editor'].includes(snapshot.workspace.role);
  const canImport = planAllowsImport && roleAllowsImport;
  const importBlockedMessage = planAllowsImport
    ? 'Vai trò hiện tại chỉ có quyền xem Video Studio.'
    : 'Video Studio cần gói Pro trở lên.';
  const toolItems = [
    ['HyperFrames', toolchain.hyperframes],
    ['Node runtime', toolchain.node],
    ['FFmpeg', toolchain.ffmpeg],
    ['F5-TTS', toolchain.f5Tts],
    ['Voice Studio', toolchain.voiceStudio],
  ] as const;

  return (
    <div className="cmr-view-stack">
      <div className="cmr-view-intro cmr-view-intro--row">
        <div>
          <span className="cmr-eyebrow">Creative production</span>
          <h2>Video Studio</h2>
          <p>Project, preview receipt và approval thuộc riêng workspace hiện tại.</p>
        </div>
        <button type="button" className="cmr-button cmr-button--primary" onClick={() => void onImport()} disabled={busy || !canImport}>
          {busy ? 'Đang xử lý...' : 'Import HyperFrames'} <DesignIcon className="cmr-button__icon" />
        </button>
      </div>

      <div className="cmr-media-tool-grid" aria-label="Media toolchain">
        {toolItems.map(([label, item]) => (
          <section className="cmr-media-tool" key={label}>
            <div><span>{label}</span><StatusPill value={item.status} /></div>
            <strong>{item.version || statusLabel(item.status)}</strong>
            <small>{item.detail}</small>
          </section>
        ))}
      </div>

      <div className="cmr-media-gate-strip">
        <div><span>Local preview</span><strong>{toolchain.previewAvailable ? 'Sẵn sàng' : 'Đang chặn'}</strong></div>
        <div><span>Commercial render</span><strong>{toolchain.commercialRenderAvailable ? 'Đã xác minh' : 'Chưa được phép'}</strong></div>
        <div><span>External actions</span><strong>{snapshot.externalActionsAllowed ? 'Được phép' : 'Đang khóa'}</strong></div>
      </div>

      {jobs.length === 0 ? (
        <section className="cmr-panel cmr-empty-panel">
          <div className="cmr-empty">
            <DesignIcon className="cmr-empty__icon" />
            <h2>Chưa có video project</h2>
            <p>{canImport ? 'Chọn một HyperFrames project đáng tin cậy để đưa vào workspace.' : importBlockedMessage}</p>
            {canImport && <button type="button" className="cmr-button cmr-button--primary" onClick={() => void onImport()} disabled={busy}>Import project</button>}
          </div>
        </section>
      ) : (
        <div className="cmr-media-job-list">
          {jobs.map((job) => {
            const approval = snapshot.approvals.find((item) => item.mediaJobId === job.id && item.kind === 'media_preview');
            const jobArtifacts = artifacts.filter((item) => item.jobId === job.id);
            const canRunPreview = job.gates.previewApproved && toolchain.previewAvailable && job.status !== 'checking';
            return (
              <section className="cmr-panel cmr-media-job" key={job.id}>
                <div className="cmr-media-job__header">
                  <div><span className="cmr-eyebrow">{job.projectId}</span><h3>{job.title}</h3></div>
                  <StatusPill value={job.status} />
                </div>
                <div className="cmr-media-job__metrics">
                  <div><span>Khung hình</span><strong>{job.width} x {job.height}</strong></div>
                  <div><span>Frame rate</span><strong>{job.fps} fps</strong></div>
                  <div><span>Thời lượng</span><strong>{job.durationSeconds ? `${job.durationSeconds}s` : 'Chưa đặt'}</strong></div>
                  <div><span>Cảnh</span><strong>{job.sceneCount}</strong></div>
                </div>
                <div className="cmr-media-job__policy">
                  <div><span>Voice provider</span><strong>{job.voice.provider}</strong></div>
                  <div><span>Model license</span><strong>{job.voice.license || 'Chưa ghi nhận'}</strong></div>
                  <div><span>Voice consent</span><strong>{job.voice.referenceVoiceConsent ? 'Đã khai báo' : 'Chưa có'}</strong></div>
                  <div><span>Commercial use</span><strong>{job.voice.commercialUseAllowed ? 'Đã xác minh' : 'Đang chặn'}</strong></div>
                </div>
                {job.preview && <div className="cmr-media-receipt"><StatusIcon className="cmr-icon" /><div><strong>{job.preview.summary}</strong><span>{job.preview.snapshotCount} snapshot · {formatDate(job.preview.checkedAt, true)}</span></div></div>}
                {job.error && <div className="cmr-alert cmr-alert--error" role="alert">{job.error}</div>}
                {jobArtifacts.length > 0 && (
                  <div className="cmr-media-artifacts">
                    <span className="cmr-eyebrow">Artifacts</span>
                    {jobArtifacts.slice(0, 6).map((artifact) => <div key={artifact.id}><strong>{artifact.name}</strong><span>{artifact.kind.replace(/_/g, ' ')}{artifact.sha256 ? ` · ${artifact.sha256.slice(0, 12)}` : ''}</span></div>)}
                  </div>
                )}
                <div className="cmr-inline-actions cmr-media-job__actions">
                  {approval?.status === 'pending' && (
                    <>
                      <button type="button" className="cmr-button cmr-button--quiet" disabled={busy || !canReview} onClick={() => void onReview(approval.id, 'rejected')}>Từ chối</button>
                      <button type="button" className="cmr-button cmr-button--primary" disabled={busy || !canReview} onClick={() => void onReview(approval.id, 'approved')}>Duyệt local preview</button>
                    </>
                  )}
                  {approval?.status === 'approved' && <button type="button" className="cmr-button cmr-button--primary" disabled={busy || !canRunPreview} onClick={() => void onPreview(job.id)}>{job.status === 'checking' ? 'Đang kiểm tra...' : job.preview ? 'Chạy lại kiểm tra' : 'Chạy HyperFrames check'}</button>}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
function TeamView({ capabilities }: { capabilities: CustomerCapability[] }) {
  const team = useMemo(() => {
    const byRole = new Map<string, CustomerCapability[]>();
    capabilities.forEach((capability) => {
      const current = byRole.get(capability.role) ?? [];
      current.push(capability);
      byRole.set(capability.role, current);
    });
    return Array.from(byRole.entries()).map(([role, items]) => ({ role, items }));
  }, [capabilities]);

  return (
    <div className="cmr-view-stack">
      <div className="cmr-view-intro"><span className="cmr-eyebrow">Marketing department</span><h2>AI Team</h2><p>Bạn giao mục tiêu; hệ thống chọn năng lực phù hợp theo cấu hình thật của workspace.</p></div>
      <div className="cmr-team-grid">
        {team.map(({ role, items }) => {
          const primary = items[0];
          const Icon = CATEGORY_ICONS[primary.category];
          return <section className="cmr-panel cmr-team-card" key={role}><div className="cmr-team-card__icon"><Icon className="cmr-icon" /></div><div className="cmr-team-card__copy"><span className="cmr-eyebrow">{CATEGORY_LABELS[primary.category]}</span><h3>{role}</h3><p>{primary.description}</p><div className="cmr-team-card__meta"><span>{items.length} capability</span><span>{primary.automationModes.includes('semi_autonomous') ? 'Bán tự động' : 'AI hỗ trợ'}</span></div></div><StatusPill value={primary.status} /></section>;
        })}
      </div>
    </div>
  );
}

function capabilityTokenLabel(value: string): string {
  return value.replace(/[_-]+/g, ' ');
}

function capabilityCreditLabel(capability: CustomerCapability): string {
  const { minimum, maximum } = capability.creditEstimate;
  return minimum === maximum ? `${minimum}` : `${minimum}–${maximum}`;
}

function capabilitySurfaceLabel(
  capability: CustomerCapability,
  state: CustomerCapabilitySurfaceState,
): string {
  if (state === 'surface_plan_required') {
    return `Cần gói ${CAPABILITY_PLAN_LABELS[capability.minimumPlan]}`;
  }
  return statusLabel(state);
}

interface CapabilityCatalogEntry {
  capability: CustomerCapability;
  surface: CustomerCapabilitySurface;
}

function CapabilityCatalogRows({
  entries,
  sectionId,
  eyebrow,
  title,
}: {
  entries: CapabilityCatalogEntry[];
  sectionId: string;
  eyebrow: string;
  title: string;
}) {
  if (entries.length === 0) return null;
  const headingId = `${sectionId}-title`;
  return (
    <section className="cmr-catalog-only" aria-labelledby={headingId}>
      <div className="cmr-catalog-only__heading">
        <span className="cmr-eyebrow">{eyebrow}</span>
        <h3 id={headingId}>{title}</h3>
      </div>
      <div className="cmr-catalog-only__list">
        {entries.map(({ capability, surface }) => {
          const Icon = CATEGORY_ICONS[capability.category];
          const titleId = `${sectionId}-${capability.id}-title`;
          return (
            <article className="cmr-catalog-only__row" key={capability.id} aria-labelledby={titleId}>
              <span className="cmr-app-card__icon"><Icon className="cmr-icon" /></span>
              <div className="cmr-catalog-only__copy">
                <h4 id={titleId}>{capability.name}</h4>
                <p>{capability.description}</p>
                <span>{CATEGORY_LABELS[capability.category]} · {CAPABILITY_PLAN_LABELS[capability.minimumPlan]}</span>
              </div>
              <StatusPill value={surface.state} />
              <span className="cmr-visually-hidden">{capabilitySurfaceLabel(capability, surface.state)}</span>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function AppsView({
  capabilities,
  catalog,
  workspace,
  onOpen,
}: {
  capabilities: CustomerCapability[];
  catalog: CustomerMarketingSnapshot['capabilityCatalog'];
  workspace: Pick<CustomerMarketingSnapshot['workspace'], 'plan' | 'role'>;
  onOpen: (action: CustomerCapabilityAction) => void;
}) {
  const [filter, setFilter] = useState<'all' | CustomerCapability['category']>('all');
  const categories = Array.from(new Set(capabilities.map((capability) => capability.category)));
  const activeFilter = filter === 'all' || categories.includes(filter) ? filter : 'all';
  const visible = activeFilter === 'all'
    ? capabilities
    : capabilities.filter((capability) => capability.category === activeFilter);
  const surfaced = visible.map((capability) => ({
    capability,
    surface: resolveCustomerCapabilitySurface(capability, workspace),
  }));
  const actionableCount = surfaced.filter(({ surface }) => surface.action !== null).length;
  const catalogOnly = surfaced.filter(({ surface }) => surface.state === 'surface_catalog_only');
  const accessRestricted = surfaced.filter(({ surface }) => (
    surface.action === null && surface.state !== 'surface_catalog_only'
  ));
  const catalogUnavailable = catalog.status === 'unavailable' || catalog.status === 'forbidden';

  return (
    <div className="cmr-view-stack">
      <div className="cmr-view-intro">
        <span className="cmr-eyebrow">Capability catalog</span>
        <h2>Apps cho công việc marketing</h2>
        <p>Danh mục theo gói và quyền hiện tại của workspace.</p>
      </div>

      {catalogUnavailable ? (
        <section className="cmr-catalog-state" role="status" aria-live="polite">
          <ExtensionIcon className="cmr-catalog-state__icon" />
          <div>
            <h3>{catalog.status === 'forbidden' ? 'Không có quyền xem catalog' : 'Chưa xác minh được catalog'}</h3>
            <p>Dữ liệu capability được ẩn cho đến khi IzziAPI xác nhận lại workspace.</p>
          </div>
        </section>
      ) : (
        <>
          <div className="cmr-filter-row" role="group" aria-label="Lọc capability">
            <button
              type="button"
              className={`cmr-filter ${activeFilter === 'all' ? 'is-active' : ''}`}
              aria-pressed={activeFilter === 'all'}
              onClick={() => setFilter('all')}
            >
              Tất cả <b>{capabilities.length}</b>
            </button>
            {categories.map((category) => (
              <button
                type="button"
                key={category}
                className={`cmr-filter ${activeFilter === category ? 'is-active' : ''}`}
                aria-pressed={activeFilter === category}
                onClick={() => setFilter(category)}
              >
                {CATEGORY_LABELS[category]} <b>{capabilities.filter((item) => item.category === category).length}</b>
              </button>
            ))}
          </div>

          {visible.length === 0 ? (
            <section className="cmr-panel cmr-empty-panel">
              <div className="cmr-empty">
                <ExtensionIcon className="cmr-empty__icon" />
                <h2>Chưa có capability phù hợp</h2>
                <p>{capabilities.length === 0 ? 'Gói và vai trò hiện tại chưa có capability.' : 'Nhóm đang lọc chưa có capability.'}</p>
              </div>
            </section>
          ) : (
            <>
              {actionableCount > 0 && (
                <div className="cmr-app-grid">
                  {surfaced.map(({ capability, surface }) => {
                    const action = surface.action;
                    if (!action) return null;
                    const Icon = CATEGORY_ICONS[capability.category];
                    const titleId = `cmr-capability-${capability.id}-title`;
                    const descriptionId = `cmr-capability-${capability.id}-description`;
                    const stateId = `cmr-capability-${capability.id}-surface`;
                    return (
                      <article className="cmr-panel cmr-app-card" key={capability.id} aria-labelledby={titleId}>
                        <div className="cmr-app-card__top">
                          <span className="cmr-app-card__icon"><Icon className="cmr-icon" /></span>
                          <StatusPill value={surface.state} id={stateId} />
                        </div>
                        <div className="cmr-app-card__heading">
                          <h3 id={titleId}>{capability.name}</h3>
                          <span className={`cmr-app-card__stability cmr-app-card__stability--${capability.stability}`}>
                            {CAPABILITY_STABILITY_LABELS[capability.stability]}
                          </span>
                        </div>
                        <p id={descriptionId}>{capability.description}</p>
                        <div className="cmr-app-card__meta">
                          <span>{CATEGORY_LABELS[capability.category]}</span>
                          <span>{CAPABILITY_PLAN_LABELS[capability.minimumPlan]}</span>
                          <span>{CAPABILITY_PERMISSION_LABELS[capability.permission]}</span>
                        </div>
                        <details className="cmr-app-card__details">
                          <summary>Chi tiết chạy</summary>
                          <dl>
                            <div>
                              <dt>Credit / run</dt>
                              <dd>{capabilityCreditLabel(capability)}</dd>
                            </div>
                            <div>
                              <dt>Đầu vào</dt>
                              <dd>{capability.inputs.slice(0, 3).map(capabilityTokenLabel).join(', ') || 'Không yêu cầu'}</dd>
                            </div>
                            <div>
                              <dt>Đầu ra</dt>
                              <dd>{capability.outputs.slice(0, 3).map(capabilityTokenLabel).join(', ') || 'Không khai báo'}</dd>
                            </div>
                          </dl>
                        </details>
                        {capability.requiredIntegrations.length > 0 && (
                          <div className="cmr-tag-row" aria-label="Tích hợp cần thiết">
                            {capability.requiredIntegrations.slice(0, 4).map((integration) => (
                              <span key={integration}>{capabilityTokenLabel(integration)}</span>
                            ))}
                          </div>
                        )}
                        <button
                          type="button"
                          className="cmr-button cmr-button--primary cmr-app-card__action"
                          aria-describedby={`${descriptionId} ${stateId}`}
                          onClick={() => onOpen(action)}
                        >
                          {action.label}
                        </button>
                      </article>
                    );
                  })}
                </div>
              )}

              <CapabilityCatalogRows
                entries={catalogOnly}
                sectionId="cmr-catalog-only"
                eyebrow="Catalog"
                title="Chưa có màn hình riêng"
              />
              <CapabilityCatalogRows
                entries={accessRestricted}
                sectionId="cmr-access-restricted"
                eyebrow="Quyền truy cập"
                title="Chưa thể sử dụng"
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

interface BrandViewProps {
  form: CustomerOnboardingInput;
  setForm: React.Dispatch<React.SetStateAction<CustomerOnboardingInput>>;
  onSave: () => Promise<void>;
  context: CustomerProductMarketingContextV1 | null;
  contextAuthority: CustomerMarketingSnapshot['productMarketingContextAuthority'];
  onSnapshot: (snapshot: CustomerMarketingSnapshot) => void;
  busy: boolean;
}

function LocalizedContextField({
  label,
  value,
  onChange,
  multiline = true,
}: {
  label: string;
  value: { vi: string; en: string };
  onChange: (locale: 'vi' | 'en', value: string) => void;
  multiline?: boolean;
}) {
  return (
    <fieldset className="cmr-localized-field">
      <legend>{label}</legend>
      <div className="cmr-localized-field__grid">
        <Field
          label="Tiếng Việt"
          value={value.vi}
          onChange={(next) => onChange('vi', next)}
          multiline={multiline}
        />
        <Field
          label="English"
          value={value.en}
          onChange={(next) => onChange('en', next)}
          multiline={multiline}
        />
      </div>
    </fieldset>
  );
}

function BrandView({
  form,
  setForm,
  onSave,
  context,
  contextAuthority,
  onSnapshot,
  busy,
}: BrandViewProps) {
  const updateBrand = <Key extends keyof CustomerOnboardingInput['brand']>(
    key: Key,
    value: CustomerOnboardingInput['brand'][Key],
  ) => setForm((current) => ({ ...current, brand: { ...current.brand, [key]: value } }));
  const updateBusiness = (key: keyof CustomerOnboardingInput['business'], value: string) => setForm((current) => ({ ...current, business: { ...current.business, [key]: value } }));
  const updateAudience = (key: keyof CustomerOnboardingInput['audience'], value: string) => setForm((current) => ({ ...current, audience: { ...current.audience, [key]: value } }));
  const initialContextDraft = context
    ? productContextToDraft(context)
    : onboardingProductContextDraft(form);
  const [contextDraft, setContextDraft] = useState<ProductContextDraft>(initialContextDraft);
  const [contextBaseline, setContextBaseline] = useState<ProductContextDraft>(initialContextDraft);
  const [loadedContextSha, setLoadedContextSha] = useState(context?.sha256 ?? 'missing');
  const [serverConflict, setServerConflict] =
    useState<CustomerProductMarketingContextV1 | null>(null);
  const [contextBusy, setContextBusy] = useState(false);
  const [contextError, setContextError] = useState('');
  const [contextNotice, setContextNotice] = useState('');
  const contextDirty = useMemo(
    () => JSON.stringify(contextDraft) !== JSON.stringify(contextBaseline),
    [contextBaseline, contextDraft],
  );

  useEffect(() => {
    const nextSha = context?.sha256 ?? 'missing';
    if (nextSha === loadedContextSha) return;
    setLoadedContextSha(nextSha);
    if (contextDirty) {
      setServerConflict(context);
      setContextError(
        context
          ? 'Context trên workspace đã đổi revision trong khi bạn đang sửa. Bản nháp vẫn được giữ.'
          : 'Context đang lưu không còn hợp lệ. Bản nháp vẫn được giữ để bạn rà soát.',
      );
      return;
    }
    const nextDraft = context
      ? productContextToDraft(context)
      : onboardingProductContextDraft(form);
    setContextDraft(nextDraft);
    setContextBaseline(nextDraft);
    setServerConflict(null);
    setContextError('');
  }, [context, contextDirty, form, loadedContextSha]);

  const updateLocalizedProduct = (
    key: ProductContextLocalizedKey,
    locale: 'vi' | 'en',
    value: string,
  ) => {
    setContextDraft((current) => ({
      ...current,
      product: {
        ...current.product,
        [key]: {
          ...current.product[key],
          [locale]: value,
        },
      },
    }));
  };

  const updateSource = (
    index: number,
    key: keyof ProductContextDraft['sources'][number],
    value: string,
  ) => {
    setContextDraft((current) => {
      const previousId = current.sources[index]?.id ?? '';
      return {
        ...current,
        product: key === 'id' && previousId
          ? {
            ...current.product,
            proofClaims: current.product.proofClaims.map((claim) => ({
              ...claim,
              sourceIds: claim.sourceIds.map((sourceId) => (
                sourceId === previousId ? value : sourceId
              )),
            })),
          }
          : current.product,
        sources: current.sources.map((source, sourceIndex) => (
          sourceIndex === index ? { ...source, [key]: value } : source
        )),
      };
    });
  };

  const removeSource = (index: number) => {
    setContextDraft((current) => {
      const removedId = current.sources[index]?.id;
      return {
        ...current,
        sources: current.sources.filter((_source, sourceIndex) => sourceIndex !== index),
        product: {
          ...current.product,
          proofClaims: current.product.proofClaims.map((claim) => ({
            ...claim,
            sourceIds: removedId
              ? claim.sourceIds.filter((sourceId) => sourceId !== removedId)
              : claim.sourceIds,
          })),
        },
      };
    });
  };

  const updateProofClaim = (
    index: number,
    updater: (claim: ProductContextDraft['product']['proofClaims'][number]) =>
      ProductContextDraft['product']['proofClaims'][number],
  ) => {
    setContextDraft((current) => ({
      ...current,
      product: {
        ...current.product,
        proofClaims: current.product.proofClaims.map((claim, claimIndex) => (
          claimIndex === index ? updater(claim) : claim
        )),
      },
    }));
  };

  const updateProhibitedClaim = (
    index: number,
    updater: (claim: ProductContextDraft['product']['prohibitedClaims'][number]) =>
      ProductContextDraft['product']['prohibitedClaims'][number],
  ) => {
    setContextDraft((current) => ({
      ...current,
      product: {
        ...current.product,
        prohibitedClaims: current.product.prohibitedClaims.map((claim, claimIndex) => (
          claimIndex === index ? updater(claim) : claim
        )),
      },
    }));
  };

  const fillFromOnboarding = () => {
    const seeded = onboardingProductContextDraft(form);
    setContextDraft((current) => ({
      ...current,
      product: {
        ...current.product,
        productName: current.product.productName || seeded.product.productName,
        category: {
          vi: current.product.category.vi || seeded.product.category.vi,
          en: current.product.category.en,
        },
        positioning: {
          vi: current.product.positioning.vi || seeded.product.positioning.vi,
          en: current.product.positioning.en,
        },
        targetAudience: {
          vi: current.product.targetAudience.vi || seeded.product.targetAudience.vi,
          en: current.product.targetAudience.en,
        },
        valueProposition: {
          vi: current.product.valueProposition.vi || seeded.product.valueProposition.vi,
          en: current.product.valueProposition.en,
        },
        brandVoice: {
          vi: current.product.brandVoice.vi || seeded.product.brandVoice.vi,
          en: current.product.brandVoice.en,
        },
      },
    }));
    setContextNotice('Đã điền các trường tiếng Việt còn trống từ hồ sơ onboarding.');
    setContextError('');
  };

  const useServerRevision = () => {
    if (!serverConflict) return;
    setContextDraft((current) => ({
      ...current,
      expectedRevision: serverConflict.revision,
    }));
    setLoadedContextSha(serverConflict.sha256);
    setServerConflict(null);
    setContextError('');
    setContextNotice(
      `Bản nháp đang dùng revision ${serverConflict.revision}; hãy rà soát rồi lưu lại.`,
    );
  };

  const loadServerContext = () => {
    if (!serverConflict) return;
    const nextDraft = productContextToDraft(serverConflict);
    setContextDraft(nextDraft);
    setContextBaseline(nextDraft);
    setLoadedContextSha(serverConflict.sha256);
    setServerConflict(null);
    setContextError('');
    setContextNotice('Đã tải nội dung context đang lưu trên workspace.');
  };

  const saveProductContext = async () => {
    const validationError = validateProductContextDraft(contextDraft);
    if (validationError) {
      setContextError(validationError);
      setContextNotice('');
      return;
    }
    const api = getCustomerApi();
    if (!api) {
      setContextError('Product Marketing Context cần chạy trong Izzi AI Desktop.');
      return;
    }
    if (!contextAuthority.canSave || !contextAuthority.authorityToken) {
      setContextError(
        contextAuthority.status === 'forbidden'
          ? 'Vai trò hiện tại không có quyền lưu Product Marketing Context.'
          : 'IzziAPI chưa xác nhận quyền lưu. Bản nháp vẫn được giữ trên màn hình.',
      );
      return;
    }
    setContextBusy(true);
    setContextError('');
    setContextNotice('');
    try {
      const result = await api.saveProductMarketingContext({
        ...contextDraft,
        authorityToken: contextAuthority.authorityToken,
      });
      if (result.snapshot) onSnapshot(result.snapshot);
      if (result.ok && result.context) {
        const savedDraft = productContextToDraft(result.context);
        setContextDraft(savedDraft);
        setContextBaseline(savedDraft);
        setLoadedContextSha(result.context.sha256);
        setServerConflict(null);
        setContextNotice(
          result.duplicate
            ? `Context revision ${result.context.revision} không đổi; người ký vẫn là ${result.context.reviewer.name}.`
            : `Đã lưu và ký Product Marketing Context revision ${result.context.revision} bằng ${result.context.reviewer.name}.`,
        );
        return;
      }
      if (result.status === 'conflict') {
        setServerConflict(result.context);
        if (result.context) setLoadedContextSha(result.context.sha256);
      }
      setContextError(result.error || 'Chưa lưu được Product Marketing Context.');
    } catch (reason) {
      setContextError(
        reason instanceof Error
          ? reason.message
          : 'Không lưu được Product Marketing Context; bản nháp vẫn được giữ.',
      );
    } finally {
      setContextBusy(false);
    }
  };

  const openAccountSettings = async () => {
    const openExternal = window.electronAPI?.shell.openExternal;
    if (!openExternal) {
      setContextError('Không mở được trang tài khoản trong phiên này.');
      return;
    }
    try {
      await openExternal('https://izziapi.com/dashboard/settings');
    } catch (reason) {
      setContextError(
        reason instanceof Error
          ? reason.message
          : 'Không mở được trang tài khoản IzziAPI.',
      );
    }
  };

  const receiptContext = serverConflict ?? context;

  return (
    <div className="cmr-view-stack">
      <div className="cmr-view-intro cmr-view-intro--row">
        <div>
          <span className="cmr-eyebrow">Brand boundary</span>
          <h2>Brand Center</h2>
          <p>Giữ mọi đề xuất của AI nhất quán với doanh nghiệp và khách hàng mục tiêu.</p>
        </div>
        <button
          type="button"
          className="cmr-button cmr-button--primary"
          onClick={() => void onSave()}
          disabled={busy || contextBusy}
        >
          {busy ? 'Đang lưu...' : 'Lưu hồ sơ'}
          <StatusIcon className="cmr-button__icon" />
        </button>
      </div>
      <div className="cmr-brand-grid">
        <section className="cmr-panel cmr-brand-panel">
          <div className="cmr-section-heading">
            <div><span className="cmr-eyebrow">Identity</span><h3>Thương hiệu</h3></div>
            <span className="cmr-color-preview" style={{ background: form.brand.primaryColor }} />
          </div>
          <div className="cmr-form-grid">
            <Field label="Logo URL" value={form.brand.logoUrl} onChange={(value) => updateBrand('logoUrl', value)} />
            <Field label="Font" value={form.brand.font} onChange={(value) => updateBrand('font', value)} />
            <Field label="Màu chính" value={form.brand.primaryColor} onChange={(value) => updateBrand('primaryColor', value)} />
            <Field label="Màu nhấn" value={form.brand.accentColor} onChange={(value) => updateBrand('accentColor', value)} />
            <div className="cmr-field cmr-field--wide"><Field label="Tone of voice" value={form.brand.tone} onChange={(value) => updateBrand('tone', value)} /></div>
            <div className="cmr-field cmr-field--wide"><Field label="Guideline" value={form.brand.guidelines} onChange={(value) => updateBrand('guidelines', value)} multiline /></div>
            <div className="cmr-field"><Field label="Từ nên dùng" value={form.brand.wordsToUse.join(', ')} onChange={(value) => updateBrand('wordsToUse', value.split(',').map((item) => item.trim()).filter(Boolean))} /></div>
            <div className="cmr-field"><Field label="Từ nên tránh" value={form.brand.wordsToAvoid.join(', ')} onChange={(value) => updateBrand('wordsToAvoid', value.split(',').map((item) => item.trim()).filter(Boolean))} /></div>
          </div>
        </section>
        <section className="cmr-panel cmr-brand-panel">
          <div className="cmr-section-heading">
            <div><span className="cmr-eyebrow">Context</span><h3>Doanh nghiệp và khách hàng</h3></div>
          </div>
          <div className="cmr-form-grid">
            <Field label="Tên doanh nghiệp" value={form.business.name} onChange={(value) => updateBusiness('name', value)} required />
            <Field label="Lĩnh vực" value={form.business.industry} onChange={(value) => updateBusiness('industry', value)} required />
            <div className="cmr-field cmr-field--wide"><Field label="Sản phẩm/dịch vụ" value={form.business.offer} onChange={(value) => updateBusiness('offer', value)} multiline required /></div>
            <div className="cmr-field cmr-field--wide"><Field label="Nhóm khách hàng" value={form.audience.segments} onChange={(value) => updateAudience('segments', value)} multiline /></div>
            <Field label="Nhu cầu" value={form.audience.needs} onChange={(value) => updateAudience('needs', value)} multiline />
            <Field label="Thị trường" value={form.audience.market} onChange={(value) => updateAudience('market', value)} />
          </div>
        </section>
      </div>
      <section className="cmr-panel cmr-product-context">
        <div className="cmr-product-context__header">
          <div>
            <span className="cmr-eyebrow">Approved evidence</span>
            <h3>Product Marketing Context</h3>
            <p>
              Workflow, AI Director và Brand Guardian chỉ dùng claim đã gắn với nguồn này.
            </p>
          </div>
          <div className="cmr-product-context__header-actions">
            <StatusPill value={receiptContext ? 'approved' : 'needs_setup'} />
            <button
              type="button"
              className="cmr-button cmr-button--quiet"
              onClick={fillFromOnboarding}
              disabled={contextBusy}
            >
              Điền từ hồ sơ
            </button>
          </div>
        </div>

        <dl className="cmr-context-receipt">
          <div><dt>Revision</dt><dd>{receiptContext?.revision ?? 0}</dd></div>
          <div><dt>Người ký revision hiện tại</dt><dd>{receiptContext?.reviewer.name ?? 'Chưa có revision đã ký'}</dd></div>
          <div>
            <dt>Digest</dt>
            <dd><code>{receiptContext ? `${receiptContext.sha256.slice(0, 16)}…` : 'Chưa có'}</code></dd>
          </div>
          <div>
            <dt>Trạng thái bản nháp</dt>
            <dd>{contextDirty ? 'Có thay đổi chưa lưu' : 'Đồng bộ'}</dd>
          </div>
        </dl>

        {contextError && <div className="cmr-alert cmr-alert--error" role="alert">{contextError}</div>}
        {contextNotice && <div className="cmr-alert cmr-alert--success" role="status">{contextNotice}</div>}
        {serverConflict && (
          <div className="cmr-context-conflict">
            <div>
              <strong>Workspace đang ở revision {serverConflict.revision}</strong>
              <span>Bản nháp trên màn hình chưa bị ghi đè.</span>
            </div>
            <div className="cmr-inline-actions">
              <button type="button" className="cmr-button cmr-button--quiet" onClick={loadServerContext}>
                Tải bản workspace
              </button>
              <button type="button" className="cmr-button cmr-button--primary" onClick={useServerRevision}>
                Giữ nháp, dùng revision mới
              </button>
            </div>
          </div>
        )}

        <div className="cmr-context-section">
          <div className="cmr-context-section__heading">
            <div><span className="cmr-eyebrow">Message system</span><h4>Thông điệp song ngữ</h4></div>
          </div>
          <Field
            label="Tên sản phẩm"
            value={contextDraft.product.productName}
            onChange={(value) => setContextDraft((current) => ({
              ...current,
              product: { ...current.product, productName: value },
            }))}
            required
          />
          <div className="cmr-context-localized-grid">
            {([
              ['Danh mục', 'category'],
              ['Định vị', 'positioning'],
              ['Khách hàng mục tiêu', 'targetAudience'],
              ['Giá trị cốt lõi', 'valueProposition'],
              ['Giọng thương hiệu', 'brandVoice'],
              ['Kêu gọi hành động', 'callToAction'],
            ] as Array<[string, ProductContextLocalizedKey]>).map(([label, key]) => (
              <LocalizedContextField
                key={key}
                label={label}
                value={contextDraft.product[key]}
                onChange={(locale, value) => updateLocalizedProduct(key, locale, value)}
                multiline={key !== 'category'}
              />
            ))}
          </div>
        </div>

        <div className="cmr-context-section">
          <div className="cmr-context-section__heading">
            <div><span className="cmr-eyebrow">Evidence registry</span><h4>Nguồn bằng chứng</h4></div>
            <button
              type="button"
              className="cmr-button cmr-button--quiet"
              onClick={() => setContextDraft((current) => ({
                ...current,
                sources: [...current.sources, { id: '', title: '', url: '', excerpt: '' }],
              }))}
            >
              Thêm nguồn
            </button>
          </div>
          {contextDraft.sources.length === 0 ? (
            <div className="cmr-context-empty">
              Chưa có nguồn. Thêm trang sản phẩm, tài liệu hoặc repository HTTPS có thể kiểm chứng.
            </div>
          ) : (
            <div className="cmr-context-list">
              {contextDraft.sources.map((source, index) => (
                <div className="cmr-context-row" key={`source-${index}`}>
                  <div className="cmr-context-row__heading">
                    <strong>Nguồn {index + 1}</strong>
                    <button
                      type="button"
                      className="cmr-icon-button cmr-context-remove"
                      onClick={() => removeSource(index)}
                      aria-label={`Xóa nguồn ${index + 1}`}
                      title="Xóa nguồn"
                    >
                      <CloseIcon className="cmr-icon" />
                    </button>
                  </div>
                  <div className="cmr-form-grid">
                    <Field label="ID nguồn" value={source.id} onChange={(value) => updateSource(index, 'id', value)} placeholder="source-product-site" />
                    <Field label="Tiêu đề" value={source.title} onChange={(value) => updateSource(index, 'title', value)} />
                    <div className="cmr-field cmr-field--wide">
                      <Field label="URL HTTPS" value={source.url} onChange={(value) => updateSource(index, 'url', value)} placeholder="https://..." />
                    </div>
                    <div className="cmr-field cmr-field--wide">
                      <Field label="Đoạn trích bằng chứng" value={source.excerpt} onChange={(value) => updateSource(index, 'excerpt', value)} multiline />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="cmr-context-section">
          <div className="cmr-context-section__heading">
            <div><span className="cmr-eyebrow">Proof boundary</span><h4>Claim được phép</h4></div>
            <button
              type="button"
              className="cmr-button cmr-button--quiet"
              onClick={() => setContextDraft((current) => ({
                ...current,
                product: {
                  ...current.product,
                  proofClaims: [
                    ...current.product.proofClaims,
                    { id: '', text: { vi: '', en: '' }, sourceIds: [] },
                  ],
                },
              }))}
            >
              Thêm claim
            </button>
          </div>
          {contextDraft.product.proofClaims.length === 0 ? (
            <div className="cmr-context-empty">
              Chưa có claim được phép. AI sẽ không được dùng tuyên bố sản phẩm chưa có bằng chứng.
            </div>
          ) : (
            <div className="cmr-context-list">
              {contextDraft.product.proofClaims.map((claim, index) => (
                <div className="cmr-context-row" key={`proof-${index}`}>
                  <div className="cmr-context-row__heading">
                    <strong>Claim {index + 1}</strong>
                    <button
                      type="button"
                      className="cmr-icon-button cmr-context-remove"
                      onClick={() => setContextDraft((current) => ({
                        ...current,
                        product: {
                          ...current.product,
                          proofClaims: current.product.proofClaims.filter(
                            (_claim, claimIndex) => claimIndex !== index,
                          ),
                        },
                      }))}
                      aria-label={`Xóa claim được phép ${index + 1}`}
                      title="Xóa claim"
                    >
                      <CloseIcon className="cmr-icon" />
                    </button>
                  </div>
                  <Field
                    label="ID claim"
                    value={claim.id}
                    onChange={(value) => updateProofClaim(index, (current) => ({
                      ...current,
                      id: value,
                    }))}
                    placeholder="proof-api-catalog"
                  />
                  <div className="cmr-context-localized-grid">
                    <LocalizedContextField
                      label="Nội dung claim"
                      value={claim.text}
                      onChange={(locale, value) => updateProofClaim(index, (current) => ({
                        ...current,
                        text: { ...current.text, [locale]: value },
                      }))}
                    />
                  </div>
                  <fieldset className="cmr-source-picker">
                    <legend>Nguồn chứng minh</legend>
                    {contextDraft.sources.filter((source) => source.id).length === 0 ? (
                      <span>Nhập ID nguồn trước để liên kết.</span>
                    ) : contextDraft.sources.filter((source) => source.id).map((source) => (
                      <label key={source.id}>
                        <input
                          type="checkbox"
                          checked={claim.sourceIds.includes(source.id)}
                          onChange={() => updateProofClaim(index, (current) => ({
                            ...current,
                            sourceIds: current.sourceIds.includes(source.id)
                              ? current.sourceIds.filter((sourceId) => sourceId !== source.id)
                              : [...current.sourceIds, source.id],
                          }))}
                        />
                        <span>{source.title || source.id}</span>
                      </label>
                    ))}
                  </fieldset>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="cmr-context-section">
          <div className="cmr-context-section__heading">
            <div><span className="cmr-eyebrow">Safety boundary</span><h4>Claim bị cấm</h4></div>
            <button
              type="button"
              className="cmr-button cmr-button--quiet"
              onClick={() => setContextDraft((current) => ({
                ...current,
                product: {
                  ...current.product,
                  prohibitedClaims: [
                    ...current.product.prohibitedClaims,
                    { id: '', text: { vi: '', en: '' }, reason: { vi: '', en: '' } },
                  ],
                },
              }))}
            >
              Thêm rule
            </button>
          </div>
          {contextDraft.product.prohibitedClaims.length === 0 ? (
            <div className="cmr-context-empty">
              Chưa có claim bị cấm. Khai báo các cam kết tuyệt đối hoặc tuyên bố không được phép.
            </div>
          ) : (
            <div className="cmr-context-list">
              {contextDraft.product.prohibitedClaims.map((claim, index) => (
                <div className="cmr-context-row" key={`prohibited-${index}`}>
                  <div className="cmr-context-row__heading">
                    <strong>Rule {index + 1}</strong>
                    <button
                      type="button"
                      className="cmr-icon-button cmr-context-remove"
                      onClick={() => setContextDraft((current) => ({
                        ...current,
                        product: {
                          ...current.product,
                          prohibitedClaims: current.product.prohibitedClaims.filter(
                            (_claim, claimIndex) => claimIndex !== index,
                          ),
                        },
                      }))}
                      aria-label={`Xóa claim bị cấm ${index + 1}`}
                      title="Xóa rule"
                    >
                      <CloseIcon className="cmr-icon" />
                    </button>
                  </div>
                  <Field
                    label="ID rule"
                    value={claim.id}
                    onChange={(value) => updateProhibitedClaim(index, (current) => ({
                      ...current,
                      id: value,
                    }))}
                    placeholder="no-guaranteed-results"
                  />
                  <div className="cmr-context-localized-grid">
                    <LocalizedContextField
                      label="Tuyên bố bị cấm"
                      value={claim.text}
                      onChange={(locale, value) => updateProhibitedClaim(index, (current) => ({
                        ...current,
                        text: { ...current.text, [locale]: value },
                      }))}
                    />
                    <LocalizedContextField
                      label="Lý do"
                      value={claim.reason}
                      onChange={(locale, value) => updateProhibitedClaim(index, (current) => ({
                        ...current,
                        reason: { ...current.reason, [locale]: value },
                      }))}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="cmr-product-context__footer">
          <div className="cmr-product-context__footer-info">
            <div className="cmr-context-signature" id="cmr-context-signer">
              <ReviewIcon className="cmr-icon" />
              <div>
                <span>Revision mới sẽ được ký bằng tài khoản</span>
                <strong>{contextAuthority.reviewerName}</strong>
                <small>
                  {contextAuthority.status === 'confirmed'
                    ? 'IzziAPI đã xác nhận tên và quyền ký cho lần lưu này.'
                    : contextAuthority.status === 'local'
                      ? 'Tên và quyền ký đang được xác nhận bởi phiên local.'
                      : contextAuthority.status === 'forbidden'
                        ? 'Vai trò hiện tại không có quyền tạo revision mới.'
                        : 'IzziAPI chưa xác nhận quyền; chức năng lưu đang khóa.'}
                </small>
              </div>
              <button
                type="button"
                className="cmr-button cmr-button--quiet"
                onClick={() => void openAccountSettings()}
                aria-label="Mở cài đặt tài khoản trên IzziAPI, mở cửa sổ mới"
              >
                Mở cài đặt tài khoản
                <SettingsIcon className="cmr-button__icon" />
              </button>
            </div>
            <div className="cmr-context-impact">
              <StatusIcon className="cmr-icon" />
              <span>
                Lưu context tạo evidence digest mới. Approval chiến lược cũ sẽ không được dùng cho revision mới.
              </span>
            </div>
          </div>
          <button
            type="button"
            className="cmr-button cmr-button--primary"
            onClick={() => void saveProductContext()}
            aria-describedby="cmr-context-signer"
            disabled={
              busy
              || contextBusy
              || !contextDirty
              || Boolean(serverConflict)
              || !contextAuthority.canSave
            }
          >
            {!contextAuthority.canSave
              ? 'Không có quyền lưu'
              : contextBusy
                ? 'Đang lưu và ký...'
                : 'Lưu và ký Product Context'}
            <StatusIcon className="cmr-button__icon" />
          </button>
        </div>
      </section>
    </div>
  );
}

function ReferenceSetupDrawer({
  open,
  snapshot,
  form,
  setForm,
  busy,
  onSave,
  onSnapshot,
  onClose,
  onOpenLegacy,
}: {
  open: boolean;
  snapshot: CustomerMarketingSnapshot;
  form: CustomerOnboardingInput;
  setForm: React.Dispatch<React.SetStateAction<CustomerOnboardingInput>>;
  busy: boolean;
  onSave: () => Promise<void>;
  onSnapshot: (snapshot: CustomerMarketingSnapshot) => void;
  onClose: () => void;
  onOpenLegacy: () => void;
}) {
  const [group, setGroup] = useState<ReferenceSetupGroup>('context');
  const panelRef = useRef<HTMLElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    restoreRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>('button')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
      )).filter((element) => element.getClientRects().length > 0);
      trapDialogTabFocus(event, focusable, document.activeElement);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      restoreRef.current?.focus?.();
    };
  }, [onClose, open]);

  if (!open) return null;
  const runningCapabilities = snapshot.capabilities.filter((item) => (
    item.status === 'running' || item.status === 'available'
  ));

  return (
    <div className="cmr-reference-drawer-layer">
      <button
        type="button"
        className="cmr-reference-drawer-backdrop"
        onClick={onClose}
        aria-label="Close setup"
      />
      <aside
        ref={panelRef}
        className="cmr-reference-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`Setup for ${snapshot.workspace.name}`}
      >
        <header className="cmr-reference-drawer__header">
          <div>
            <span className="cmr-eyebrow">Occasional configuration</span>
            <h2>Setup</h2>
          </div>
          <button type="button" className="cmr-icon-button" onClick={onClose} aria-label="Close setup">
            <CloseIcon className="cmr-icon" />
          </button>
        </header>
        <div className="cmr-reference-setup-tabs" role="tablist" aria-label="Setup groups">
          {REFERENCE_SETUP_GROUPS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={group === item.id}
              className={group === item.id ? 'is-active' : ''}
              onClick={() => setGroup(item.id)}
            >
              <strong>{item.label}</strong>
              <span>{item.description}</span>
            </button>
          ))}
        </div>
        <div className="cmr-reference-drawer__body" role="tabpanel">
          {group === 'context' && (
            <BrandView
              key={snapshot.productMarketingContextAuthority.scopeToken}
              form={form}
              setForm={setForm}
              onSave={onSave}
              context={snapshot.productMarketingContext}
              contextAuthority={snapshot.productMarketingContextAuthority}
              onSnapshot={onSnapshot}
              busy={busy}
            />
          )}
          {group === 'connections' && (
            <div className="cmr-view-stack">
              <div className="cmr-view-intro">
                <span className="cmr-eyebrow">Capability-specific</span>
                <h2>Connections</h2>
                <p>Unneeded channels stay deferred. Credential values never enter this page.</p>
              </div>
              <CustomerMarketingChannels role={snapshot.workspace.role} />
              <section className="cmr-panel">
                <div className="cmr-section-heading">
                  <div><span className="cmr-eyebrow">Host status</span><h3>Installed capabilities</h3></div>
                  <StatusPill value={snapshot.capabilityCatalog.status} />
                </div>
                <div className="cmr-reference-capability-list">
                  {snapshot.capabilities.map((capability) => (
                    <div key={capability.id}>
                      <span><strong>{capability.name}</strong><small>{capability.description}</small></span>
                      <StatusPill value={capability.status} />
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
          {group === 'automation' && (
            <div className="cmr-view-stack">
              <div className="cmr-view-intro">
                <span className="cmr-eyebrow">Guardrailed by default</span>
                <h2>Automation</h2>
                <p>External publish, spend, send and delete remain approval-bound.</p>
              </div>
              <section className="cmr-panel cmr-reference-automation">
                <div>
                  <span>Current mode</span>
                  <strong>{MODE_OPTIONS.find((item) => item.value === form.automationMode)?.label ?? form.automationMode}</strong>
                </div>
                <div>
                  <span>Pending approvals</span>
                  <strong>{snapshot.approvals.filter((item) => item.status === 'pending').length}</strong>
                </div>
                <div>
                  <span>Ready capabilities</span>
                  <strong>{runningCapabilities.length}/{snapshot.capabilities.length}</strong>
                </div>
              </section>
              <TeamView capabilities={snapshot.capabilities} />
            </div>
          )}
        </div>
        <footer className="cmr-reference-drawer__footer">
          <button type="button" className="cmr-button cmr-button--ghost" onClick={onOpenLegacy}>
            Open legacy room
          </button>
          <span>Rollback changes presentation only; source records stay untouched.</span>
        </footer>
      </aside>
    </div>
  );
}

function ReferenceCustomerRoom({
  snapshot,
  form,
  setForm,
  onRefresh,
  onMutation,
  onSnapshot,
  onSelectMedia,
  onOpenLegacy,
  busy,
  error,
  notice,
}: {
  snapshot: CustomerMarketingSnapshot;
  form: CustomerOnboardingInput;
  setForm: React.Dispatch<React.SetStateAction<CustomerOnboardingInput>>;
  onRefresh: () => Promise<void>;
  onMutation: (operation: MutationOperation, successNotice?: string | null) => Promise<CustomerMutationResult | null>;
  onSnapshot: (snapshot: CustomerMarketingSnapshot) => void;
  onSelectMedia: () => Promise<void>;
  onOpenLegacy: () => void;
  busy: boolean;
  error: string;
  notice: string;
}) {
  const [surface, setSurface] = useState<ReferenceSurface>('brief');
  const [setupOpen, setSetupOpen] = useState(false);
  const [deliverableKind, setDeliverableKind] = useState<'campaign' | 'content' | 'asset' | 'knowledge' | 'media'>('content');
  const tabsRef = useRef<HTMLDivElement | null>(null);
  const pendingCount = snapshot.approvals.filter((approval) => approval.status === 'pending').length;

  const director = async (goal: string) => {
    const input: CustomerDirectorInput = {
      goal,
      channels: form.channels,
      automationMode: form.automationMode,
    };
    const result = await onMutation((api) => api.askDirector(input), 'Work created and waiting at its real approval gate.');
    if (result?.ok) setSurface('work');
  };
  const review = async (approvalId: string, decision: 'approved' | 'rejected') => {
    await onMutation((api) => api.reviewApproval({ approvalId, decision }));
  };
  const saveContext = async () => {
    await onMutation((api) => api.saveOnboarding(form));
  };
  const onTabKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = REFERENCE_SURFACES.findIndex((item) => item.id === surface);
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? REFERENCE_SURFACES.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + REFERENCE_SURFACES.length) % REFERENCE_SURFACES.length;
    const target = REFERENCE_SURFACES[next];
    setSurface(target.id);
    tabsRef.current?.querySelector<HTMLElement>(`#cmr-reference-tab-${target.id}`)?.focus();
  };

  return (
    <div className="cmr-page cmr-reference">
      <div className="cmr-page__inner" inert={setupOpen || undefined} aria-hidden={setupOpen || undefined}>
        <header className="cmr-reference-header">
          <div>
            <span className="cmr-eyebrow">Personal Office / Marketing</span>
            <h1>{snapshot.workspace.name}</h1>
            <p>One operator, one work loop, with the full Customer Marketing capability underneath.</p>
          </div>
          <div className="cmr-reference-header__actions">
            <span className={`cmr-workspace-status cmr-workspace-status--${snapshot.workspace.syncStatus}`}>
              {snapshot.workspace.syncStatus}
            </span>
            <button type="button" className="cmr-button cmr-button--ghost" onClick={() => void onRefresh()} disabled={busy}>
              <RefreshIcon className="cmr-button__icon" /> Refresh
            </button>
            <button type="button" className="cmr-button cmr-button--primary" onClick={() => setSetupOpen(true)}>
              <SettingsIcon className="cmr-button__icon" /> Setup
            </button>
          </div>
        </header>

        <div className="cmr-reference-summary" aria-label="Workspace summary">
          <Metric label="Active work" value={snapshot.runs.filter((run) => !['completed', 'blocked'].includes(run.status)).length} hint="Real Customer Marketing runs" />
          <Metric label="Needs you" value={pendingCount} hint="Role-aware approvals" tone={pendingCount > 0 ? 'warning' : 'neutral'} />
          <Metric label="Delivered" value={snapshot.runs.filter((run) => run.status === 'completed').length + snapshot.media.artifacts.length} hint="Runs and artifacts" />
        </div>

        <div
          ref={tabsRef}
          className="cmr-reference-tabs"
          role="tablist"
          aria-label="Marketing workspace surfaces"
          onKeyDown={onTabKeyDown}
        >
          {REFERENCE_SURFACES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              id={`cmr-reference-tab-${id}`}
              type="button"
              role="tab"
              aria-selected={surface === id}
              aria-controls={`cmr-reference-panel-${id}`}
              tabIndex={surface === id ? 0 : -1}
              className={surface === id ? 'is-active' : ''}
              onClick={() => setSurface(id)}
            >
              <Icon className="cmr-icon" />
              <span>{label}</span>
              {id === 'approvals' && pendingCount > 0 && <b>{pendingCount}</b>}
            </button>
          ))}
        </div>

        {error && <div className="cmr-alert cmr-alert--error" role="alert">{error}</div>}
        {notice && <div className="cmr-alert cmr-alert--success" role="status">{notice}</div>}

        <main
          id={`cmr-reference-panel-${surface}`}
          className="cmr-reference-panel"
          role="tabpanel"
          aria-labelledby={`cmr-reference-tab-${surface}`}
        >
          {surface === 'brief' && (
            <div className="cmr-reference-brief">
              <section className="cmr-panel">
                <span className="cmr-eyebrow">Current brief</span>
                <h2>{snapshot.onboarding?.business.name || 'Marketing workspace'}</h2>
                <p>{snapshot.onboarding?.business.offer || 'Add the offer and audience in Setup → Context.'}</p>
                <dl className="cmr-reference-facts">
                  <div><dt>Objective</dt><dd>{snapshot.onboarding?.objectives.join(', ') || 'Not set'}</dd></div>
                  <div><dt>Audience</dt><dd>{snapshot.onboarding?.audience.segments || 'Not set'}</dd></div>
                  <div><dt>Channels</dt><dd>{snapshot.onboarding?.channels.join(', ') || 'Deferred'}</dd></div>
                  <div><dt>Automation</dt><dd>{snapshot.onboarding?.automationMode || 'copilot'}</dd></div>
                </dl>
              </section>
              <section className="cmr-panel cmr-reference-delegate">
                <span className="cmr-eyebrow">Delegate to Director</span>
                <h2>What outcome do you need?</h2>
                <p>The Director creates one durable Customer Marketing workflow and its real approval gate.</p>
                <DirectorComposer onSubmit={director} busy={busy} />
              </section>
            </div>
          )}
          {surface === 'work' && (
            <div className="cmr-view-stack">
              <div className="cmr-view-intro cmr-view-intro--row">
                <div><span className="cmr-eyebrow">Execution timeline</span><h2>Work</h2><p>Specialists appear inside each run, not in primary navigation.</p></div>
                <DirectorComposer onSubmit={director} busy={busy} compact />
              </div>
              <GoalsView snapshot={snapshot} onOpenDirector={() => setSurface('brief')} />
            </div>
          )}
          {surface === 'deliverables' && (
            <div className="cmr-view-stack">
              <div className="cmr-view-intro">
                <span className="cmr-eyebrow">Source-backed outputs</span>
                <h2>Deliverables</h2>
                <p>Only current revision, preview and export affordances supported by the source are shown.</p>
              </div>
              <div className="cmr-reference-filter" role="group" aria-label="Deliverable type">
                {(['content', 'campaign', 'asset', 'knowledge', 'media'] as const).map((kind) => (
                  <button key={kind} type="button" aria-pressed={deliverableKind === kind} onClick={() => setDeliverableKind(kind)}>
                    {humanize(kind)}
                  </button>
                ))}
              </div>
              {deliverableKind !== 'media' ? (
                <CustomerMarketingResources kind={deliverableKind} role={snapshot.workspace.role} />
              ) : (
                <section className="cmr-panel">
                  <div className="cmr-section-heading">
                    <div><span className="cmr-eyebrow">Media receipts</span><h3>Artifacts</h3></div>
                    <button type="button" className="cmr-button cmr-button--ghost" onClick={() => void onSelectMedia()} disabled={busy}>Import project</button>
                  </div>
                  {snapshot.media.artifacts.length === 0 ? (
                    <div className="cmr-empty"><DesignIcon className="cmr-empty__icon" /><h3>No media artifacts</h3><p>Imported projects and local previews leave evidence here.</p></div>
                  ) : (
                    <div className="cmr-reference-artifacts">
                      {snapshot.media.artifacts.map((artifact) => (
                        <article key={artifact.id}>
                          <div><strong>{artifact.name}</strong><span>{artifact.kind} · {formatDate(artifact.createdAt, true)}</span></div>
                          <span>{artifact.sizeBytes ? `${Math.round(artifact.sizeBytes / 1024)} KB` : 'Metadata only'}</span>
                        </article>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </div>
          )}
          {surface === 'approvals' && <ApprovalsView snapshot={snapshot} onReview={review} busy={busy} />}
        </main>
      </div>
      <ReferenceSetupDrawer
        open={setupOpen}
        snapshot={snapshot}
        form={form}
        setForm={setForm}
        busy={busy}
        onSave={saveContext}
        onSnapshot={onSnapshot}
        onClose={() => setSetupOpen(false)}
        onOpenLegacy={onOpenLegacy}
      />
    </div>
  );
}

function CustomerRoom({
  snapshot,
  view,
  setView,
  form,
  setForm,
  onRefresh,
  onMutation,
  onSnapshot,
  onSelectMedia,
  busy,
  error,
  notice,
}: {
  snapshot: CustomerMarketingSnapshot;
  view: ViewId;
  setView: (view: ViewId) => void;
  form: CustomerOnboardingInput;
  setForm: React.Dispatch<React.SetStateAction<CustomerOnboardingInput>>;
  onRefresh: () => Promise<void>;
  onMutation: (operation: MutationOperation, successNotice?: string | null) => Promise<CustomerMutationResult | null>;
  onSnapshot: (snapshot: CustomerMarketingSnapshot) => void;
  onSelectMedia: () => Promise<void>;
  busy: boolean;
  error: string;
  notice: string;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeCapability, setActiveCapability] =
    useState<CustomerCapabilityWorkbenchId | null>(null);
  const videoStudioAvailable = customerPlanMeetsMinimum(snapshot.workspace.plan, 'pro');
  const activeView = view === 'video' && !videoStudioAvailable ? 'home' : view;
  const selectView = useCallback((target: ViewId) => {
    setActiveCapability(null);
    setView(target === 'video' && !videoStudioAvailable ? 'home' : target);
  }, [setView, videoStudioAvailable]);

  useEffect(() => {
    if (view === activeView) return;
    setView(activeView);
  }, [activeView, setView, view]);

  const director = async (goal: string) => {
    const input: CustomerDirectorInput = { goal, channels: form.channels, automationMode: form.automationMode };
    const result = await onMutation((api) => api.askDirector(input), 'Đã tạo kế hoạch đề xuất.');
    if (result?.ok) selectView('director');
  };

  const review = async (approvalId: string, decision: 'approved' | 'rejected') => {
    await onMutation((api) => api.reviewApproval({ approvalId, decision }));
  };

  const saveBrand = async () => {
    await onMutation((api) => api.saveOnboarding(form));
  };

  const previewMedia = async (jobId: string) => {
    await onMutation((api) => api.runMediaPreview({ jobId }));
  };

  const pendingCount = snapshot.approvals.filter((approval) => approval.status === 'pending').length;
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const pendingCapabilityViewRef = useRef<ViewId | null>(null);
  const openCapabilityView = useCallback((action: CustomerCapabilityAction) => {
    if (action.view === 'capability') {
      if (!action.capabilityId) return;
      pendingCapabilityViewRef.current = 'apps';
      setActiveCapability(action.capabilityId);
      setView('apps');
      return;
    }
    if (action.view === 'video' && !videoStudioAvailable) {
      pendingCapabilityViewRef.current = null;
      selectView('home');
      return;
    }
    pendingCapabilityViewRef.current = action.view;
    selectView(action.view);
  }, [selectView, setView, videoStudioAvailable]);

  useEffect(() => {
    if (!activeCapability) return;
    const capability = snapshot.capabilities.find(
      (item) => item.id === activeCapability,
    );
    const action = capability
      ? resolveCustomerCapabilitySurface(capability, snapshot.workspace).action
      : null;
    if (
      action?.view !== 'capability' ||
      action.capabilityId !== activeCapability
    ) {
      setActiveCapability(null);
    }
  }, [
    activeCapability,
    snapshot.capabilities,
    snapshot.workspace,
  ]);

  useEffect(() => {
    if (pendingCapabilityViewRef.current !== activeView) return;
    pendingCapabilityViewRef.current = null;
    const frame = window.requestAnimationFrame(() => {
      const selector = activeCapability
        ? `#cmr-view-${activeView} .cmr-workbench-header h2`
        : `#cmr-view-${activeView} .cmr-view-intro h2`;
      const heading = document.querySelector<HTMLElement>(selector);
      if (!heading) return;
      heading.tabIndex = -1;
      heading.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeCapability, activeView]);

  return (
    <div className="cmr-page">
      <div className="cmr-page__inner" inert={settingsOpen || undefined} aria-hidden={settingsOpen || undefined}>
        <WorkspaceHeader
          snapshot={snapshot}
          onRefresh={onRefresh}
          onOpenSettings={() => setSettingsOpen(true)}
          settingsOpen={settingsOpen}
          busy={busy}
        />
        <WorkspaceNav
          view={activeView}
          setView={selectView}
          pendingCount={pendingCount}
          videoStudioAvailable={videoStudioAvailable}
        />
        {error && <div className="cmr-alert cmr-alert--error" role="alert">{error}</div>}
        {notice && <div className="cmr-alert cmr-alert--success" role="status">{notice}</div>}
        <div
          id={`cmr-view-${activeView}`}
          className="cmr-active-view"
          role="tabpanel"
          aria-labelledby={`cmr-tab-${activeView}`}
        >
          {activeView === 'home' && <HomeView snapshot={snapshot} onDirector={director} onReview={review} onOpen={selectView} busy={busy} />}
          {activeView === 'campaigns' && <CustomerMarketingResources kind="campaign" role={snapshot.workspace.role} />}
          {activeView === 'content' && <CustomerMarketingResources kind="content" role={snapshot.workspace.role} />}
          {activeView === 'channels' && <CustomerMarketingChannels role={snapshot.workspace.role} />}
          {activeView === 'assets' && <CustomerMarketingResources kind="asset" role={snapshot.workspace.role} />}
          {activeView === 'knowledge' && <CustomerMarketingResources kind="knowledge" role={snapshot.workspace.role} />}
          {activeView === 'director' && <DirectorView snapshot={snapshot} onDirector={director} busy={busy} />}
          {activeView === 'goals' && <GoalsView snapshot={snapshot} onOpenDirector={() => selectView('director')} />}
          {activeView === 'approvals' && <ApprovalsView snapshot={snapshot} onReview={review} busy={busy} />}
          {activeView === 'video' && <VideoStudioView snapshot={snapshot} onImport={onSelectMedia} onPreview={previewMedia} onReview={review} busy={busy} />}
          {activeView === 'team' && <TeamView capabilities={snapshot.capabilities} />}
          {activeView === 'apps' && (
            activeCapability ? (
              <CustomerMarketingCapabilityWorkbench
                id={activeCapability}
                snapshot={snapshot}
                form={form}
                onBack={() => setActiveCapability(null)}
                onOpen={(target) => selectView(target)}
                onDirector={director}
              />
            ) : (
              <AppsView
                capabilities={snapshot.capabilities}
                catalog={snapshot.capabilityCatalog}
                workspace={snapshot.workspace}
                onOpen={openCapabilityView}
              />
            )
          )}
          <div
            hidden={activeView !== 'brand'}
            aria-hidden={activeView !== 'brand'}
          >
            <BrandView
              key={snapshot.productMarketingContextAuthority.scopeToken}
              form={form}
              setForm={setForm}
              onSave={saveBrand}
              context={snapshot.productMarketingContext}
              contextAuthority={snapshot.productMarketingContextAuthority}
              onSnapshot={onSnapshot}
              busy={busy}
            />
          </div>
        </div>
      </div>
      <WorkspaceSettingsDrawer open={settingsOpen} snapshot={snapshot} onClose={closeSettings} />
    </div>
  );
}

export function CustomerMarketingRoomPage() {
  const [snapshot, setSnapshot] = useState<CustomerMarketingSnapshot | null>(null);
  const [form, setForm] = useState<CustomerOnboardingInput>(emptyOnboarding);
  const [view, setView] = useState<ViewId>('home');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [referenceEnabled, setReferenceEnabled] = useState(
    isMarketingWorkspaceReferenceEnabled,
  );
  const invitationStatusRef = useRef('');

  const loadSnapshot = useCallback(async () => {
    const api = getCustomerApi();
    if (!api) {
      setError('Customer AI Marketing Room cần chạy trong Izzi AI Desktop để kết nối workspace thật.');
      setLoading(false);
      return;
    }
    try {
      setError('');
      const next = await api.getSnapshot();
      setSnapshot(next);
      if (next.onboarding) setForm(profileToInput(next.onboarding));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không tải được Customer Marketing workspace.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    const api = getCustomerApi();
    if (!api) return;
    let active = true;
    const handleInvitationStatus = (result: CustomerWorkspaceInvitationAcceptanceResult) => {
      if (!active) return;
      const signature = JSON.stringify([
        result.ok,
        result.pending,
        result.workspaceId,
        result.role,
        result.error,
      ]);
      if (signature === invitationStatusRef.current) return;
      invitationStatusRef.current = signature;
      if (result.pending) {
        setError('');
        setNotice('Liên kết mời đang chờ xác nhận sau khi đăng nhập.');
        return;
      }
      if (result.ok) {
        setError('');
        setNotice('Đã tham gia workspace Marketing thành công.');
        void loadSnapshot();
        return;
      }
      setNotice('');
      setError(result.error || 'Không nhận được lời mời workspace.');
    };
    const unsubscribe = api.onWorkspaceInvitationStatus(handleInvitationStatus);
    void api.consumeWorkspaceInvitationStatus()
      .then((result) => {
        if (result) handleInvitationStatus(result);
      })
      .catch(() => {
        // The live event remains available if buffered status retrieval fails.
      });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [loadSnapshot]);

  const runMutation = useCallback(async (
    operation: MutationOperation,
    successNotice?: string | null,
  ): Promise<CustomerMutationResult | null> => {
    const api = getCustomerApi();
    if (!api) {
      setError('Không tìm thấy kết nối Customer Marketing trong phiên này.');
      return null;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await operation(api);
      if (result.snapshot) {
        setSnapshot(result.snapshot);
        if (result.snapshot.onboarding) setForm(profileToInput(result.snapshot.onboarding));
      }
      if (result.ok) {
        setNotice(successNotice === null ? '' : successNotice || result.reply || 'Đã cập nhật workspace.');
      } else {
        setError(result.error || 'Thao tác chưa hoàn tất.');
      }
      return result;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Thao tác thất bại. Dữ liệu hiện tại vẫn được giữ lại.');
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const selectMediaProject = useCallback(async () => {
    const api = getCustomerApi();
    if (!api) {
      setError('Không tìm thấy kết nối Video Studio trong phiên này.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const selection = await api.selectMediaProject();
      if (selection.canceled) return;
      if (selection.result?.snapshot) setSnapshot(selection.result.snapshot);
      if (selection.result?.ok) setNotice('Đã import project và tạo approval cho local preview.');
      else setError(selection.result?.error || selection.error || 'Không import được media project.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Không mở được media project.');
    } finally {
      setBusy(false);
    }
  }, []);
  const saveOnboarding = async (input: CustomerOnboardingInput) => {
    await runMutation((api) => api.saveOnboarding(input));
  };

  if (loading) {
    return (
      <div className="cmr-page cmr-page--state">
        <div className="cmr-state"><span className="cmr-loading-orbit" /><strong>Đang mở Customer Marketing workspace</strong><span>Đang lấy cấu hình theo tài khoản hiện tại...</span></div>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="cmr-page cmr-page--state">
        <div className="cmr-state">
          <StatusIcon className="cmr-state__icon" />
          <strong>Chưa mở được workspace</strong>
          <span>{error || 'Không có dữ liệu workspace.'}</span>
          <button type="button" className="cmr-button cmr-button--primary" onClick={() => { setLoading(true); void loadSnapshot(); }}>Thử lại <RefreshIcon className="cmr-button__icon" /></button>
        </div>
      </div>
    );
  }

  if (!snapshot.onboarding?.completed) {
    return <OnboardingRoom form={form} setForm={setForm} busy={busy} error={error} onComplete={saveOnboarding} />;
  }

  if (referenceEnabled) {
    return (
      <ReferenceCustomerRoom
        snapshot={snapshot}
        form={form}
        setForm={setForm}
        onRefresh={loadSnapshot}
        onMutation={runMutation}
        onSnapshot={setSnapshot}
        onSelectMedia={selectMediaProject}
        onOpenLegacy={() => {
          setMarketingWorkspaceReferenceEnabled(false);
          setReferenceEnabled(false);
        }}
        busy={busy}
        error={error}
        notice={notice}
      />
    );
  }

  return (
    <div className="cmr-legacy-host">
      <div className="cmr-legacy-host__notice" role="status">
        <span>Legacy Customer Marketing room</span>
        <button
          type="button"
          className="cmr-button cmr-button--primary"
          onClick={() => {
            setMarketingWorkspaceReferenceEnabled(true);
            setReferenceEnabled(true);
          }}
        >
          Return to reference workspace
        </button>
      </div>
      <CustomerRoom
        snapshot={snapshot}
        view={view}
        setView={setView}
        form={form}
        setForm={setForm}
        onRefresh={loadSnapshot}
        onMutation={runMutation}
        onSnapshot={setSnapshot}
        onSelectMedia={selectMediaProject}
        busy={busy}
        error={error}
        notice={notice}
      />
    </div>
  );
}
