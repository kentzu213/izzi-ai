import { promises as fs } from 'fs';
import * as path from 'path';
import type {
  MarketingCampaignItem,
  MarketingHumanGate,
  MarketingPlatformReadiness,
  MarketingReviewItem,
  MarketingSafetyGate,
  MarketingToolchainStatus,
  MarketingVideoJob,
  MarketingWorkspaceSnapshot,
} from '../../shared/marketing-types';

type CsvRow = Record<string, string>;

interface MarketingRoomConfig {
  workspacePath?: string;
  videoTemplatePath?: string;
  ffmpegBinPath?: string;
}

const REQUIRED_WORKSPACE_FILES = [
  'tasks/marketing-backlog.csv',
  'campaigns/30-day-content-calendar.csv',
] as const;

const SAFE_OPEN_ROOTS = new Set([
  'analytics',
  'campaigns',
  'case-studies',
  'docs',
  'exports',
  'proof',
  'reviews',
  'seo',
  'tasks',
]);

const SAFE_OPEN_FILES = new Set([
  'dashboard.html',
  'BAO-CAO-DANH-GIA-2026-07-14.md',
  'BAO-CAO-TIEN-DO.md',
  'MARKETING-ROADMAP.md',
  '.',
]);

const EMPTY_SNAPSHOT: Omit<MarketingWorkspaceSnapshot, 'generatedAt' | 'toolchain'> = {
  connected: false,
  backlog: { total: 0, done: 0, inProgress: 0, external: 0, completionPercent: 0 },
  content: { total: 0, approved: 0, scheduled: 0, published: 0, warnings: 0 },
  quality: {
    seoQualityPassed: 0,
    seoTotal: 0,
    seoPublished: 0,
    caseStudyDrafts: 0,
    caseStudyTotal: 0,
    caseStudyPublishReady: 0,
    proofAvailable: 0,
    proofTotal: 0,
  },
  spend: { monthlyBudgetVnd: 0, actualSpendVnd: 0, verifiedZeroSpendEntries: 0 },
  campaigns: [],
  reviews: [],
  humanGates: [],
  platforms: [],
  videoJobs: [],
  gates: [],
};

export function parseCsv(input: string): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }

  const headers = (rows.shift() ?? []).map((header, index) =>
    index === 0 ? header.replace(/^\uFEFF/, '').trim() : header.trim(),
  );
  return rows
    .filter((values) => values.some((value) => value.trim().length > 0))
    .map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
}

function count(rows: CsvRow[], predicate: (row: CsvRow) => boolean): number {
  return rows.reduce((total, row) => total + (predicate(row) ? 1 : 0), 0);
}

function numberValue(value: string | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeStatus(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function hasNamedReviewer(value: string | undefined): boolean {
  const reviewer = normalizeStatus(value);
  if (!reviewer || reviewer.includes('<') || reviewer.includes('>')) return false;
  return !/(^|[\s_-])(ai|agent|automation|bot|codex|test|fixture|owner_name|your_name)([\s_-]|$)/i.test(reviewer);
}

function safeHumanGatePath(value: unknown): string {
  const fallback = 'tasks/HUMAN-GATES-NOW.md';
  if (typeof value !== 'string') return fallback;
  const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
  const firstSegment = normalized.split('/')[0];
  if (!SAFE_OPEN_ROOTS.has(firstSegment) && !SAFE_OPEN_FILES.has(normalized)) return fallback;
  return normalized;
}

export function parseHumanGates(input: string): MarketingHumanGate[] {
  try {
    const parsed = JSON.parse(input) as { external_actions_allowed?: unknown; gates?: unknown };
    if (!Array.isArray(parsed.gates)) return [];
    const externalActionsAllowed = parsed.external_actions_allowed === true;
    return parsed.gates.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const gate = item as Record<string, unknown>;
      if (typeof gate.id !== 'string' || typeof gate.source_id !== 'string' || typeof gate.status !== 'string') return [];
      const kind: MarketingHumanGate['kind'] = gate.id.startsWith('case_study')
        ? 'case-study'
        : gate.id.startsWith('seo_')
          ? 'seo'
          : 'spend';
      const proof = Number(gate.local_proof_available ?? gate.proof_assets ?? 0);
      const required = Number(gate.local_proof_required ?? gate.proof_assets ?? 0);
      const detail = kind === 'case-study'
        ? `${proof}/${required} local proof · publish ${gate.publish_allowed === true ? 'allowed' : 'blocked'}`
        : kind === 'seo'
          ? `${proof} proof · ${gate.noindex === true ? 'noindex' : 'indexable'} · publish ${gate.publish_allowed === true ? 'allowed' : 'blocked'}`
          : `Verified spend: ${typeof gate.verified_actual_spend_vnd === 'number' ? `${gate.verified_actual_spend_vnd} VND` : 'missing'} · new spend ${gate.new_spend_allowed === true ? 'allowed' : 'blocked'}`;
      return [{
        id: gate.id,
        sourceId: gate.source_id,
        kind,
        status: gate.status,
        sourcePath: safeHumanGatePath(gate.source ?? gate.packet),
        detail,
        externalActionsAllowed,
        decision: typeof gate.decision === "string" ? gate.decision : undefined,
        reviewer: typeof gate.reviewer === "string" ? gate.reviewer : undefined,
        reviewDate: typeof gate.review_date === "string" ? gate.review_date : undefined,
        notes: typeof gate.notes === "string" ? gate.notes : undefined,
      }];
    });
  } catch {
    return [];
  }
}

export function isVerifiedZeroSpend(row: CsvRow): boolean {
  const verified = ['true', 'yes', '1'].includes(normalizeStatus(row.verified_no_spend));
  return verified && hasNamedReviewer(row.reviewer) && Boolean(row.review_date?.trim()) && Boolean(row.source_checked?.trim());
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export class MarketingWorkspaceService {
  constructor(
    private readonly configPath: string,
    private readonly appRoot: string,
  ) {}

  async getConfig(): Promise<MarketingRoomConfig> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.configPath, 'utf8')) as MarketingRoomConfig;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }

  async setWorkspacePath(candidate: string): Promise<MarketingWorkspaceSnapshot> {
    const workspacePath = path.resolve(candidate);
    await this.assertWorkspace(workspacePath);
    const config = await this.getConfig();
    await this.writeConfig({ ...config, workspacePath });
    return this.getSnapshot();
  }

  async setVideoTemplatePath(candidate: string): Promise<MarketingWorkspaceSnapshot> {
    const videoTemplatePath = path.resolve(candidate);
    if (!(await fileExists(path.join(videoTemplatePath, 'video-workflow.json')))) {
      throw new Error('Thư mục chưa có video-workflow.json.');
    }
    const config = await this.getConfig();
    await this.writeConfig({ ...config, videoTemplatePath });
    return this.getSnapshot();
  }

  async getWorkspacePath(): Promise<string | null> {
    const envPath = process.env.STARIZZI_MARKETING_WORKSPACE?.trim();
    const config = await this.getConfig();
    const candidate = envPath || config.workspacePath;
    if (!candidate) return null;
    try {
      await this.assertWorkspace(candidate);
      return path.resolve(candidate);
    } catch {
      return null;
    }
  }

  async resolveWorkspaceItem(relativePath: string): Promise<string> {
    const root = await this.getWorkspacePath();
    if (!root) throw new Error('Marketing workspace chưa được kết nối.');
    const normalized = relativePath.replace(/\\/g, '/').replace(/^\.\//, '');
    const firstSegment = normalized.split('/')[0];
    if (!SAFE_OPEN_ROOTS.has(firstSegment) && !SAFE_OPEN_FILES.has(normalized)) {
      throw new Error('Đường dẫn không thuộc danh sách marketing được phép mở.');
    }
    const target = path.resolve(root, relativePath);
    const relation = path.relative(root, target);
    if (relation.startsWith('..') || path.isAbsolute(relation)) {
      throw new Error('Đường dẫn nằm ngoài marketing workspace.');
    }
    if (!(await fileExists(target))) throw new Error('Không tìm thấy tệp hoặc thư mục.');
    return this.resolveContainedPath(root, relativePath);
  }

  async getSnapshot(): Promise<MarketingWorkspaceSnapshot> {
    const generatedAt = new Date().toISOString();
    const config = await this.getConfig();
    const toolchain = await this.readToolchain(config.videoTemplatePath, config.ffmpegBinPath);
    const workspacePath = await this.getWorkspacePath();
    if (!workspacePath) {
      return {
        ...EMPTY_SNAPSHOT,
        generatedAt,
        toolchain,
        error: 'Chọn thư mục izziAi Marketing để bắt đầu.',
      };
    }

    try {
      const [
        backlogRows,
        calendarRows,
        publishingRows,
        socialReviewRows,
        seoRows,
        caseRows,
        proofRows,
        budgetRows,
        actualSpendRows,
        zeroSpendRows,
        humanGates,
        platforms,
        videoJobs,
      ] = await Promise.all([
        this.readRows(workspacePath, 'tasks/marketing-backlog.csv'),
        this.readRows(workspacePath, 'campaigns/30-day-content-calendar.csv'),
        this.readRows(workspacePath, 'campaigns/publishing-queue.generated.csv'),
        this.readRows(workspacePath, 'campaigns/approval-review-queue.generated.csv'),
        this.readRows(workspacePath, 'seo/seo-review-queue.generated.csv'),
        this.readRows(workspacePath, 'case-studies/case-study-review-workbook.generated.csv'),
        this.readRows(workspacePath, 'proof/proof-assets-inventory.csv'),
        this.readRows(workspacePath, 'analytics/budget-tracker.csv'),
        this.readRows(workspacePath, 'analytics/actual-spend-log.csv'),
        this.readRows(workspacePath, 'analytics/zero-spend-attestation.csv'),
        this.readHumanGates(workspacePath),
        this.readPlatforms(workspacePath),
        this.readVideoJobs(workspacePath, toolchain),
      ]);

      const done = count(backlogRows, (row) => normalizeStatus(row.status) === 'done');
      const inProgress = count(backlogRows, (row) => normalizeStatus(row.status) === 'in_progress');
      const external = count(backlogRows, (row) => normalizeStatus(row.status) === 'external');
      const campaigns = this.buildCampaigns(calendarRows, publishingRows);
      const reviews = this.buildReviews(socialReviewRows, seoRows, caseRows);
      const approved = count(publishingRows, (row) => normalizeStatus(row.approval_status) === 'approved');
      const scheduled = count(publishingRows, (row) => normalizeStatus(row.publish_status) === 'scheduled');
      const published = count(publishingRows, (row) => normalizeStatus(row.publish_status) === 'published');
      const warnings = socialReviewRows.reduce((total, row) => total + numberValue(row.qa_warnings), 0);
      const actualSpendVnd = actualSpendRows.reduce((total, row) => total + numberValue(row.amount_vnd), 0);
      const monthlyBudgetVnd = budgetRows.reduce((total, row) => total + numberValue(row.amount_vnd), 0);
      const verifiedZeroSpendRows = zeroSpendRows.filter(isVerifiedZeroSpend);

      const snapshot: MarketingWorkspaceSnapshot = {
        connected: true,
        workspacePath,
        workspaceName: path.basename(workspacePath),
        generatedAt,
        backlog: {
          total: backlogRows.length,
          done,
          inProgress,
          external,
          completionPercent: backlogRows.length ? Math.round((done / backlogRows.length) * 1000) / 10 : 0,
        },
        content: { total: publishingRows.length, approved, scheduled, published, warnings },
        quality: {
          seoQualityPassed: count(seoRows, (row) => normalizeStatus(row.quality_readiness) === 'quality_gate_pass'),
          seoTotal: seoRows.length,
          seoPublished: count(seoRows, (row) => normalizeStatus(row.publish_status) === 'published'),
          caseStudyDrafts: count(caseRows, (row) => normalizeStatus(row.draft_exists) === 'true'),
          caseStudyTotal: caseRows.length,
          caseStudyPublishReady: count(caseRows, (row) => normalizeStatus(row.final_decision) === 'approved'),
          proofAvailable: count(proofRows, (row) => normalizeStatus(row.status) === 'available'),
          proofTotal: proofRows.length,
        },
        spend: { monthlyBudgetVnd, actualSpendVnd, verifiedZeroSpendEntries: verifiedZeroSpendRows.length },
        campaigns,
        reviews,
        humanGates,
        platforms,
        videoJobs,
        toolchain,
        gates: this.buildGates({ approved, scheduled, published, actualSpendVnd, zeroSpendRows: verifiedZeroSpendRows, toolchain }),
      };
      return snapshot;
    } catch (error) {
      return {
        ...EMPTY_SNAPSHOT,
        connected: false,
        workspacePath,
        generatedAt,
        toolchain,
        error: error instanceof Error ? error.message : 'Không thể đọc marketing workspace.',
      };
    }
  }

  private async writeConfig(config: MarketingRoomConfig): Promise<void> {
    await fs.mkdir(path.dirname(this.configPath), { recursive: true });
    await fs.writeFile(this.configPath, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  }

  private async assertWorkspace(workspacePath: string): Promise<void> {
    for (const relativePath of REQUIRED_WORKSPACE_FILES) {
      if (!(await fileExists(path.join(workspacePath, relativePath)))) {
        throw new Error(`Thiếu tệp bắt buộc: ${relativePath}`);
      }
    }
  }

  private async resolveContainedPath(root: string, relativePath: string): Promise<string> {
    const [realRoot, realTarget] = await Promise.all([
      fs.realpath(root),
      fs.realpath(path.resolve(root, relativePath)),
    ]);
    const relation = path.relative(realRoot, realTarget);
    if (relation.startsWith('..') || path.isAbsolute(relation)) {
      throw new Error('Symlink trỏ ra ngoài marketing workspace.');
    }
    return realTarget;
  }

  private async readWorkspaceText(root: string, relativePath: string): Promise<string> {
    return fs.readFile(await this.resolveContainedPath(root, relativePath), 'utf8');
  }

  private async readRows(root: string, relativePath: string): Promise<CsvRow[]> {
    if (!(await fileExists(path.join(root, relativePath)))) return [];
    return parseCsv(await this.readWorkspaceText(root, relativePath));
  }

  private buildCampaigns(calendarRows: CsvRow[], publishingRows: CsvRow[]): MarketingCampaignItem[] {
    const publishingById = new Map(publishingRows.map((row) => [row.queue_id, row]));
    return calendarRows.map((row, index) => {
      const day = numberValue(row.day) || index + 1;
      const id = `day${String(day).padStart(2, '0')}-${(row.primary_format || 'content').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      const publish = publishingRows[index] ?? publishingById.get(id) ?? {};
      return {
        id: publish.queue_id || id,
        day,
        date: row.date || publish.date || '',
        phase: row.phase || publish.phase || '',
        persona: row.persona || publish.persona || '',
        platforms: (row.platforms || publish.platforms || '').split(';').map((item) => item.trim()).filter(Boolean),
        format: row.primary_format || publish.format || '',
        hook: row.hook || publish.hook || '',
        cta: row.cta || publish.cta || '',
        approvalStatus: publish.approval_status || 'draft',
        publishStatus: publish.publish_status || 'not_scheduled',
        proofStatus: publish.proof_status || 'needs_proof_check',
      };
    });
  }

  private buildReviews(social: CsvRow[], seo: CsvRow[], cases: CsvRow[]): MarketingReviewItem[] {
    const socialItems = social.map((row) => ({
      id: row.queue_id,
      type: 'social' as const,
      title: `${row.format || 'Content'} / ${row.platforms || ''}`,
      status: row.approval_status || 'draft',
      recommendation: row.recommendation || '',
      warnings: numberValue(row.qa_warnings),
      sourcePath: 'campaigns/approval-review-queue.generated.csv',
    }));
    const seoItems = seo.map((row) => ({
      id: row.file,
      type: 'seo' as const,
      title: row.keyword || row.file,
      status: row.review_status || 'pending',
      recommendation: row.quality_readiness || '',
      warnings: row.quality_issues ? 1 : 0,
      sourcePath: `seo/${row.file}`,
    }));
    const caseItems = cases.map((row) => ({
      id: row.case_id,
      type: 'case-study' as const,
      title: row.title || row.case_id,
      status: row.final_decision || 'pending',
      recommendation: row.missing_proof_ids ? 'missing_proof' : 'ready_for_human_review',
      warnings: row.missing_proof_ids ? row.missing_proof_ids.split(';').filter(Boolean).length : 0,
      sourcePath: row.draft_path || 'case-studies',
    }));
    return [...socialItems, ...seoItems, ...caseItems];
  }

  private async readHumanGates(root: string): Promise<MarketingHumanGate[]> {
    const relativePath = 'tasks/human-gates-now.json';
    if (!(await fileExists(path.join(root, relativePath)))) return [];
    return parseHumanGates(await this.readWorkspaceText(root, relativePath));
  }

  private async readPlatforms(root: string): Promise<MarketingPlatformReadiness[]> {
    const definitions: Array<[MarketingPlatformReadiness['platform'], string]> = [
      ['telegram', 'docs/telegram-sandbox-readiness.generated.json'],
      ['facebook', 'docs/facebook-oauth-readiness.generated.json'],
      ['youtube', 'docs/youtube-oauth-readiness.generated.json'],
    ];
    const external = await Promise.all(definitions.map(async ([platform, relativePath]) => {
      try {
        const data = JSON.parse(await this.readWorkspaceText(root, relativePath)) as Record<string, unknown>;
        const ready = data.ready === true;
        return {
          platform,
          health: ready ? 'ready' as const : 'blocked' as const,
          recommendation: String(data.recommendation || (ready ? 'ready' : 'configuration_required')),
          checkedAt: typeof data.generated_at === 'string' ? data.generated_at : undefined,
        };
      } catch {
        return { platform, health: 'unknown' as const, recommendation: 'readiness_file_missing' };
      }
    }));
    return [
      ...external,
      { platform: 'x', health: 'attention', recommendation: 'manual_or_autopost_connection_required' },
      { platform: 'tiktok', health: 'attention', recommendation: 'manual_upload_workflow_required' },
      { platform: 'seo', health: 'attention', recommendation: 'human_review_and_cms_publish_required' },
    ];
  }

  private async readToolchain(templatePath?: string, ffmpegBinPath?: string): Promise<MarketingToolchainStatus> {
    const packageCandidates = [
      path.join(this.appRoot, 'node_modules', 'hyperframes', 'package.json'),
      ...(templatePath ? [path.join(templatePath, 'node_modules', 'hyperframes', 'package.json')] : []),
    ];
    let hyperframesVersion: string | undefined;
    for (const packagePath of packageCandidates) {
      try {
        const pkg = JSON.parse(await fs.readFile(packagePath, 'utf8')) as { version?: string };
        hyperframesVersion = pkg.version;
        if (hyperframesVersion) break;
      } catch {
        // Try the next supported local installation location.
      }
    }

    let workflow: Record<string, any> = {};
    if (templatePath) {
      try {
        workflow = JSON.parse(await fs.readFile(path.join(templatePath, 'video-workflow.json'), 'utf8'));
      } catch {
        workflow = {};
      }
    }
    const license = typeof workflow.voice?.model_license === 'string' ? workflow.voice.model_license : undefined;
    const f5Configured = Boolean(templatePath && String(workflow.voice?.provider || '').toLowerCase().includes('f5'));
    const commercialRenderAllowed = Boolean(
      f5Configured
      && license
      && workflow.authorization?.commercial_use_allowed === true
      && !/(^|-)NC($|-)/i.test(license),
    );
    const ffmpegConfigured = Boolean(
      ffmpegBinPath
      && await fileExists(path.join(ffmpegBinPath, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'))
      && await fileExists(path.join(ffmpegBinPath, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')),
    );
    return {
      hyperframesInstalled: Boolean(hyperframesVersion),
      hyperframesVersion,
      ffmpegConfigured,
      ffmpegBinPath: ffmpegConfigured ? ffmpegBinPath : undefined,
      templateConfigured: Boolean(templatePath && Object.keys(workflow).length),
      f5Configured,
      f5Provider: typeof workflow.voice?.provider === 'string' ? workflow.voice.provider : undefined,
      f5ModelLicense: license,
      commercialRenderAllowed,
      blockingReason: !ffmpegConfigured
        ? 'Chưa cấu hình FFmpeg/FFprobe cho tiến trình Izzi AI.'
        : !f5Configured
          ? 'Chưa kết nối F5 video template.'
          : !commercialRenderAllowed
            ? 'F5 model hiện tại chưa chứng minh quyền dùng thương mại; cần model hoặc giấy phép phù hợp trước khi render quảng cáo.'
            : undefined,
    };
  }

  private async readVideoJobs(root: string, toolchain: MarketingToolchainStatus): Promise<MarketingVideoJob[]> {
    const jobs: MarketingVideoJob[] = [];
    const roots = ['campaigns/video-jobs', 'campaigns/video-assets'];
    for (const relativeRoot of roots) {
      let directory: string;
      let entries: Array<{ name: string; isDirectory(): boolean }> = [];
      try {
        directory = await this.resolveContainedPath(root, relativeRoot);
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const projectPath = `${relativeRoot}/${entry.name}`;
        const workflowRelativePath = projectPath + '/video-workflow.json';
        const metadataRelativePath = projectPath + '/metadata.json';
        let data: Record<string, any> = {};
        let sourcePath: string;
        let isWorkflow = false;
        try {
          sourcePath = await this.resolveContainedPath(root, workflowRelativePath);
          data = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
          isWorkflow = true;
        } catch {
          try {
            sourcePath = await this.resolveContainedPath(root, metadataRelativePath);
            data = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
          } catch {
            continue;
          }
        }
        const stat = await fs.stat(sourcePath);
        const license = typeof data.voice?.model_license === 'string' ? data.voice.model_license : toolchain.f5ModelLicense;
        jobs.push({
          id: data.project?.id || data.id || entry.name,
          title: data.title || data.project?.id || entry.name.replace(/[-_]/g, ' '),
          status: data.status || (isWorkflow ? 'workflow_ready' : 'asset_draft'),
          projectPath,
          provider: data.voice?.provider || (isWorkflow ? 'configured' : 'unassigned'),
          format: data.project ? `${data.project.width}x${data.project.height} @ ${data.project.fps}fps` : '9:16',
          updatedAt: stat.mtime.toISOString(),
          renderApproved: data.authorization?.render_approved === true,
          commercialUseAllowed: data.authorization?.commercial_use_allowed === true
            && Boolean(license)
            && !/(^|-)NC($|-)/i.test(String(license)),
          license,
        });
      }
    }
    return jobs.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }

  private buildGates(input: {
    approved: number;
    scheduled: number;
    published: number;
    actualSpendVnd: number;
    zeroSpendRows: CsvRow[];
    toolchain: MarketingToolchainStatus;
  }): MarketingSafetyGate[] {
    const gates: MarketingSafetyGate[] = [
      {
        id: 'human-review',
        label: 'Human review',
        health: input.approved > 0 ? 'ready' : 'blocked',
        detail: `${input.approved} nội dung được duyệt`,
      },
      {
        id: 'publishing',
        label: 'Publishing',
        health: input.published > 0 || input.scheduled > 0 ? 'attention' : 'blocked',
        detail: `${input.scheduled} scheduled / ${input.published} published`,
      },
      {
        id: 'spend',
        label: 'Spend evidence',
        health: input.actualSpendVnd > 0 || input.zeroSpendRows.length > 0 ? 'ready' : 'blocked',
        detail: input.actualSpendVnd > 0 ? `${input.actualSpendVnd} VND có log` : 'Chưa có receipt hoặc zero-spend attestation',
      },
      {
        id: 'video-license',
        label: 'Video license',
        health: input.toolchain.commercialRenderAllowed ? 'ready' : 'blocked',
        detail: input.toolchain.blockingReason || 'Không phát hiện chặn giấy phép',
      },
    ];
    return gates;
  }
}





