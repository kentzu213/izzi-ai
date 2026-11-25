import { useMemo, useState } from 'react';
import type {
  CustomerCareCrmAssignee,
  CustomerCareCrmProfileInput,
  CustomerCareCrmRow,
} from '../../shared/customer-care-types';
import {
  buildCustomerPortrait,
  buildLifecyclePlan,
  buildSalerPlaybook,
  crmAdsExportBlock,
  selectMetaAudience,
  summarizeAdsAudiences,
  type CrmAdsBucket,
  type CrmAdsExportBlock,
  type CrmAdsIdentityState,
  type CrmEnterpriseProduct,
  type CrmLifecycleCategory,
  type CrmLifecycleItem,
  type CrmMetaAudienceTarget,
  type CrmSalerPriorityBand,
} from '../../shared/customer-crm-enterprise';
import { formatLeadPhone, leadDisplayName } from './customer-care-leads-flow';
import {
  CRM_CONFLICT_MESSAGE,
  crmAssigneeLabel,
  crmCallTodayCount,
  crmDue,
  crmRowReadOnly,
  crmStageLabel,
  formatCrmDay,
  formatCrmDue,
  profileFromRow,
  type CrmRowEdit,
} from './customer-crm-flow';
import type { CrmAdsExportOutcome } from './customer-crm-ads-export';
import type { CrmDisplay } from './customer-crm-graph';

// ---------------------------------------------------------------------------
// Shared display helpers
// ---------------------------------------------------------------------------

const PRIORITY_META: Readonly<Record<CrmSalerPriorityBand, { label: string; tone: 'hot' | 'warm' | 'normal' | 'closed' }>> = {
  hot: { label: 'Ưu tiên nóng', tone: 'hot' },
  warm: { label: 'Ấm', tone: 'warm' },
  normal: { label: 'Thường', tone: 'normal' },
  closed: { label: 'Không gọi', tone: 'closed' },
};

const ADS_EXPORT_OPTIONS: ReadonlyArray<{ value: CrmMetaAudienceTarget; label: string }> = [
  { value: 'all', label: 'Tất cả đủ điều kiện' },
  { value: 'high_intent', label: 'Khách ấm chưa chốt (high_intent)' },
  { value: 'vip_lookalike', label: 'VIP Lookalike 1%–3% (vip_lookalike)' },
  { value: 'reengage_lost', label: 'Winback · Đánh thức khách cũ (reengage_lost)' },
  { value: 'P1', label: 'P1 · Gia chủ nhà mới / Sắm chính' },
  { value: 'P2', label: 'P2 · Gia đình truyền thống / Lễ Tết' },
  { value: 'P3', label: 'P3 · Khách mua Quà biếu / Tri ân' },
  { value: 'P4', label: 'P4 · Khách khảo giá / Ngân sách' },
];

const BUCKET_TITLES: Readonly<Record<CrmAdsBucket, { title: string; subtitle: string }>> = {
  high_intent: {
    title: 'Khách ấm chưa chốt (high_intent)',
    subtitle: 'Retargeting bám đuổi chốt đơn bằng video thực tế & chứng thực chất lượng',
  },
  vip_lookalike: {
    title: 'Hạt giống khách đã cọc / đã mua (vip_lookalike)',
    subtitle: 'Tạo Lookalike 1%–3% tìm khách mới đồng gu & loại trừ khỏi phễu lạnh',
  },
  reengage_lost: {
    title: 'Đánh thức khách cũ (reengage_lost)',
    subtitle: 'Chiến dịch ưu đãi đợt xưởng & nhắc mua sắm dịp Lễ / Tết',
  },
  suppressed: {
    title: 'Tệp loại trừ bắt buộc (suppressed)',
    subtitle: 'Chống lãng phí ngân sách & tuân thủ nghiêm quyền từ chối liên hệ',
  },
};

const TRUNCATED_NOTE = ' Chỉ gồm 500 khách mới nhất.';

const ADS_EXPORT_BLOCK_NOTES: Readonly<Record<CrmAdsExportBlock, string>> = {
  identity_off:
    'Xuất tệp Ads đang khoá: AI hồ sơ khách chưa bật cho dự án này, nên chưa có khách nào bấm "Đồng ý" qua izzi.',
  identity_unavailable:
    'Xuất tệp Ads tạm khoá: AI hồ sơ khách chưa tải được nên chưa kiểm tra được khách nào đã đồng ý. Bấm "Làm mới" rồi thử lại.',
};

// ---------------------------------------------------------------------------
// 1. Enterprise CRM KPI Strip
// ---------------------------------------------------------------------------

export interface CrmEnterpriseKpiStripProps {
  rows: readonly CustomerCareCrmRow[];
  /** Canonical server-saved rows for Ads consent counts (defaults to `rows`). */
  savedRows?: readonly CustomerCareCrmRow[];
  products: readonly CrmEnterpriseProduct[];
  nowMs: number;
  /** The list answer's identity state: the Ads count follows the export gate. */
  identityState: CrmAdsIdentityState;
  display: CrmDisplay;
  onSelectDisplay: (display: CrmDisplay) => void;
}

export function CrmEnterpriseKpiStrip({
  rows,
  savedRows,
  products,
  nowMs,
  identityState,
  display,
  onSelectDisplay,
}: CrmEnterpriseKpiStripProps) {
  const stats = useMemo(() => {
    const todayCount = crmCallTodayCount(rows, nowMs);
    const liveAds = summarizeAdsAudiences(rows, identityState);
    const persistedRows = savedRows ?? rows;
    const persistedAds = savedRows ? summarizeAdsAudiences(savedRows, identityState) : liveAds;
    const classifiedCount =
      liveAds.byPersona.P1.count + liveAds.byPersona.P2.count + liveAds.byPersona.P3.count + liveAds.byPersona.P4.count;
    const lifecycle = buildLifecyclePlan(rows, products, nowMs, { identityEnabled: identityState.identityEnabled });
    const overdueLifecycle = lifecycle.filter((item) => item.isOverdue).length;
    return {
      total: rows.length,
      todayCount,
      classifiedCount,
      byPersona: liveAds.byPersona,
      consentedAds: selectMetaAudience(persistedRows, 'all', identityState).phones.length,
      warmLeads: persistedAds.buckets.high_intent.count,
      lifecycleTotal: lifecycle.length,
      overdueLifecycle,
    };
  }, [rows, savedRows, products, nowMs, identityState]);

  return (
    <div className="v2-crm-kpis" role="region" aria-label="Chỉ số tổng quan Enterprise CRM">
      <button
        type="button"
        className={`v2-crm-kpi${display === 'table' ? ' is-active' : ''}`}
        aria-pressed={display === 'table'}
        onClick={() => onSelectDisplay('table')}
      >
        <span className="v2-crm-kpi__label">Tổng khách</span>
        <strong className="v2-crm-kpi__value">{stats.total}</strong>
        <span className="v2-crm-kpi__sub">Hồ sơ SĐT trong dự án</span>
      </button>

      <button
        type="button"
        className={`v2-crm-kpi${display === 'saler' ? ' is-active' : ''}${stats.todayCount > 0 ? ' is-alert' : ''}`}
        aria-pressed={display === 'saler'}
        onClick={() => onSelectDisplay('saler')}
      >
        <span className="v2-crm-kpi__label">Cần gọi hôm nay</span>
        <strong className="v2-crm-kpi__value">{stats.todayCount}</strong>
        <span className="v2-crm-kpi__sub">Ưu tiên kịch bản Saler</span>
      </button>

      <button
        type="button"
        className={`v2-crm-kpi${display === 'graph' ? ' is-active' : ''}`}
        aria-pressed={display === 'graph'}
        onClick={() => onSelectDisplay('graph')}
      >
        <span className="v2-crm-kpi__label">Chân dung P1–P4</span>
        <strong className="v2-crm-kpi__value">{stats.classifiedCount}</strong>
        <span className="v2-crm-kpi__sub">
          {`P1:${stats.byPersona.P1.count} · P2:${stats.byPersona.P2.count} · P3:${stats.byPersona.P3.count} · P4:${stats.byPersona.P4.count}`}
        </span>
      </button>

      <button
        type="button"
        className={`v2-crm-kpi${display === 'ads' ? ' is-active' : ''}`}
        aria-pressed={display === 'ads'}
        onClick={() => onSelectDisplay('ads')}
      >
        <span className="v2-crm-kpi__label">Đủ điều kiện Ads</span>
        <strong className="v2-crm-kpi__value">{stats.consentedAds}</strong>
        <span className="v2-crm-kpi__sub">{`Đã đồng ý · ${stats.warmLeads} khách ấm`}</span>
      </button>

      <button
        type="button"
        className={`v2-crm-kpi${display === 'lifecycle' ? ' is-active' : ''}${stats.overdueLifecycle > 0 ? ' is-alert' : ''}`}
        aria-pressed={display === 'lifecycle'}
        onClick={() => onSelectDisplay('lifecycle')}
      >
        <span className="v2-crm-kpi__label">Lịch Hậu mãi / Remarketing</span>
        <strong className="v2-crm-kpi__value">{stats.overdueLifecycle > 0 ? stats.overdueLifecycle : stats.lifecycleTotal}</strong>
        <span className="v2-crm-kpi__sub">
          {stats.overdueLifecycle > 0
            ? `${stats.overdueLifecycle} đến hạn / quá hạn (${stats.lifecycleTotal} mốc)`
            : `${stats.lifecycleTotal} mốc chăm sóc dự kiến`}
        </span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Enterprise View 1 — Saler Workspace ("Phục vụ Saler")
// ---------------------------------------------------------------------------

export interface CrmSalerWorkspaceProps {
  rows: readonly CustomerCareCrmRow[];
  products: readonly CrmEnterpriseProduct[];
  assignees: readonly CustomerCareCrmAssignee[];
  savingIds: ReadonlySet<string>;
  edits?: Readonly<Record<string, CrmRowEdit>>;
  nowMs: number;
  /** The list answer's identityEnabled: unless true, the order layer (products, occasion, timeline) is guessed from the chat. */
  identityEnabled: boolean | null;
  onChangeProfile: (row: CustomerCareCrmRow, nextProfile: CustomerCareCrmProfileInput) => void;
  onCopyText: (text: string, successMessage: string) => void;
  onOpenProfile: (leadId: string) => void;
}

type SalerBandFilter = 'all' | 'hot' | 'warm' | 'normal';

export function CrmSalerWorkspace({
  rows,
  products,
  assignees,
  savingIds,
  edits,
  nowMs,
  identityEnabled,
  onChangeProfile,
  onCopyText,
  onOpenProfile,
}: CrmSalerWorkspaceProps) {
  const [bandFilter, setBandFilter] = useState<SalerBandFilter>('all');

  const items = useMemo(() => {
    const built = rows.map((row) => {
      const portrait = buildCustomerPortrait(row, products, nowMs, { identityEnabled });
      const playbook = buildSalerPlaybook(row, portrait, products, nowMs);
      const due = crmDue(row.profile, nowMs);
      return { row, playbook, due };
    });

    return built.sort((a, b) => (
      b.playbook.priorityScore - a.playbook.priorityScore
      || (a.due === 'overdue' ? -1 : 0) - (b.due === 'overdue' ? -1 : 0)
      || Date.parse(b.row.phoneCapturedAt) - Date.parse(a.row.phoneCapturedAt)
    ));
  }, [rows, products, nowMs, identityEnabled]);

  const counts = useMemo(() => ({
    all: items.length,
    hot: items.filter((item) => item.playbook.priorityBand === 'hot').length,
    warm: items.filter((item) => item.playbook.priorityBand === 'warm').length,
    normal: items.filter((item) => item.playbook.priorityBand === 'normal').length,
  }), [items]);

  const visibleItems = useMemo(
    () => (bandFilter === 'all' ? items : items.filter((item) => item.playbook.priorityBand === bandFilter)),
    [items, bandFilter],
  );

  return (
    <div className="v2-crm-workspace" role="region" aria-label="Phân hệ Phục vụ Saler">
      <div className="v2-crm-workspace__bar">
        <div className="v2-project-tabs" role="group" aria-label="Lọc mức ưu tiên gọi điện">
          <button
            type="button"
            className={`v2-tab${bandFilter === 'all' ? ' is-active' : ''}`}
            aria-pressed={bandFilter === 'all'}
            onClick={() => setBandFilter('all')}
          >
            {`Tất cả (${counts.all})`}
          </button>
          <button
            type="button"
            className={`v2-tab${bandFilter === 'hot' ? ' is-active' : ''}`}
            aria-pressed={bandFilter === 'hot'}
            onClick={() => setBandFilter('hot')}
          >
            {`Ưu tiên nóng (${counts.hot})`}
          </button>
          <button
            type="button"
            className={`v2-tab${bandFilter === 'warm' ? ' is-active' : ''}`}
            aria-pressed={bandFilter === 'warm'}
            onClick={() => setBandFilter('warm')}
          >
            {`Ấm (${counts.warm})`}
          </button>
          <button
            type="button"
            className={`v2-tab${bandFilter === 'normal' ? ' is-active' : ''}`}
            aria-pressed={bandFilter === 'normal'}
            onClick={() => setBandFilter('normal')}
          >
            {`Thường (${counts.normal})`}
          </button>
        </div>
        <span className="v2-crm__meta">
          Sắp xếp theo điểm ưu tiên giảm dần · Kịch bản theo xưng hô và nhu cầu trên hồ sơ
        </span>
      </div>

      {visibleItems.length === 0 ? (
        <div className="v2-empty">
          <p>Không có khách nào thuộc nhóm mức ưu tiên đang chọn.</p>
        </div>
      ) : (
        <div className="v2-crm-saler-list">
          {visibleItems.map(({ row, playbook, due }) => {
            const name = leadDisplayName(row);
            const priority = PRIORITY_META[playbook.priorityBand];
            const readOnly = crmRowReadOnly(row);
            const profile = profileFromRow(row);

            return (
              <article key={row.leadId} className="v2-crm-saler-card" aria-label={`Kịch bản Saler cho ${name}`}>
                <header className="v2-crm-saler-card__header">
                  <div className="v2-crm-saler-card__who">
                    <span className={`v2-crm-priority is-${priority.tone}`}>
                      {`${priority.label} · ${playbook.priorityScore}đ`}
                    </span>
                    <h3 className="v2-crm-saler-card__name">{name}</h3>
                    {row.zaloMentioned && <span className="v2-badge">Có nhắc Zalo</span>}
                    <span className="v2-crm__phone">{formatLeadPhone(row.phone)}</span>
                    <button
                      type="button"
                      className="v2-button v2-button--ghost"
                      aria-label={`Sao chép số của ${name}`}
                      onClick={() => onCopyText(row.phone, `Đã sao chép số của ${name}.`)}
                    >
                      Sao chép số
                    </button>
                  </div>
                  <div className="v2-crm-saler-card__meta">
                    <span className="v2-crm-chip">{crmStageLabel(row.profile.stage)}</span>
                    <span className="v2-crm__meta">{crmAssigneeLabel(assignees, row.profile.ownerUserId)}</span>
                    {savingIds.has(row.leadId) && <span className="v2-crm__meta">Đang lưu…</span>}
                  </div>
                </header>

                <div className="v2-crm-saler-card__script">
                  <div className="v2-crm-saler-card__script-head">
                    <span className="v2-field__label">Kịch bản mở lời gọi điện / Zalo</span>
                    {playbook.canContact && (
                      <button
                        type="button"
                        className="v2-button v2-button--ghost"
                        onClick={() => onCopyText(playbook.opener, `Đã sao chép kịch bản mở lời cho ${name}.`)}
                      >
                        Sao chép kịch bản
                      </button>
                    )}
                  </div>
                  <p className="v2-crm-saler-card__opener">{playbook.opener}</p>
                </div>

                {playbook.discoveryQuestions.length > 0 && (
                  <div className="v2-crm-saler-card__block">
                    <span className="v2-field__label">Câu hỏi khai thác phần còn thiếu</span>
                    <ul className="v2-crm-saler-card__questions">
                      {playbook.discoveryQuestions.map((question, idx) => (
                        <li key={idx}>{question}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="v2-crm-saler-card__block">
                  <span className="v2-field__label">Gợi ý xử lý từ chối & chốt đơn</span>
                  <p className="v2-crm-saler-card__hint">{playbook.objectionHint}</p>
                  <details className="v2-crm-disclosure">
                    <summary>{`Checklist chốt đơn (${playbook.closingChecklist.length} bước)`}</summary>
                    <ul className="v2-crm-saler-card__questions">
                      {playbook.closingChecklist.map((step, idx) => (
                        <li key={idx}>{step}</li>
                      ))}
                    </ul>
                  </details>
                </div>

                <footer className="v2-crm-saler-card__footer">
                  <div className="v2-crm-saler-card__next">
                    {(due === 'overdue' || due === 'today') && (
                      <span className={`v2-crm__due is-${due}`}>{due === 'overdue' ? 'Quá hạn' : 'Hôm nay'}</span>
                    )}
                    <span className="v2-crm__meta">
                      {row.profile.nextStep
                        ? `Hiện tại: ${row.profile.nextStep}${row.profile.nextStepDueAt ? ` (${formatCrmDue(row.profile.nextStepDueAt)})` : ''}`
                        : `Đề xuất: ${playbook.suggestedNextStep}`}
                    </span>
                  </div>
                  <div className="v2-crm__buttons">
                    <button
                      type="button"
                      className="v2-button v2-button--primary"
                      disabled={readOnly || !playbook.canContact}
                      onClick={() => onChangeProfile(row, applyLifecycleNextStep(profile, playbook))}
                    >
                      Áp dụng việc tiếp theo
                    </button>
                    <button
                      type="button"
                      className="v2-button v2-button--ghost"
                      onClick={() => onOpenProfile(row.leadId)}
                    >
                      Mở hồ sơ
                    </button>
                  </div>
                </footer>

                {edits?.[row.leadId]?.rejected ? (
                  <div className="v2-crm__conflict" role="alert">
                    <p>
                      <strong>{edits[row.leadId]!.error || CRM_CONFLICT_MESSAGE}</strong>{' '}
                      Bấm &ldquo;Mở hồ sơ&rdquo; để xem và xử lý xung đột trên Bảng.
                    </p>
                  </div>
                ) : edits?.[row.leadId]?.error ? (
                  <p className="v2-crm__error" role="alert">{edits[row.leadId]!.error}</p>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// 4. Enterprise View 2 — Ads Workspace ("Phục vụ Ads")
// ---------------------------------------------------------------------------

export interface CrmAdsWorkspaceProps {
  rows: readonly CustomerCareCrmRow[];
  /** The list answer's identity state: the export fails closed without a readable, enabled identity. */
  identityState: CrmAdsIdentityState;
  /** Unsaved drafts by lead: the preview withholds a customer a draft would (e.g. "Không liên hệ" not saved yet). */
  drafts: Readonly<Record<string, CustomerCareCrmProfileInput>>;
  /** Builds the file from a fresh full read with identity, never from the rows on screen. */
  onExport: (target: CrmMetaAudienceTarget) => Promise<CrmAdsExportOutcome>;
  onNotify: (kind: 'notice' | 'error', message: string) => void;
}

const ORDERED_ADS_BUCKETS: readonly CrmAdsBucket[] = [
  'high_intent',
  'vip_lookalike',
  'reengage_lost',
  'suppressed',
];

export function CrmAdsWorkspace({
  rows,
  identityState,
  drafts,
  onExport,
  onNotify,
}: CrmAdsWorkspaceProps) {
  const [exportTarget, setExportTarget] = useState<CrmMetaAudienceTarget>('all');
  const [exporting, setExporting] = useState(false);

  const summary = useMemo(
    () => summarizeAdsAudiences(rows, identityState),
    [rows, identityState],
  );

  // The preview runs the same selection as the export on the rows on screen; the export itself reads them again.
  const preview = useMemo(
    () => selectMetaAudience(rows, exportTarget, identityState, drafts),
    [rows, exportTarget, identityState, drafts],
  );
  const exportBlock = crmAdsExportBlock(identityState);

  /** The fresh export's file, or null after saying why there is none. */
  const freshCsv = async (emptyMessage: string) => {
    const outcome = await onExport(exportTarget);
    if (!outcome.ok) {
      onNotify('error', outcome.message);
      return null;
    }
    const { result } = outcome;
    if (result.blockedReason !== null) {
      onNotify('error', ADS_EXPORT_BLOCK_NOTES[result.blockedReason]);
      return null;
    }
    if (result.includedCount === 0) {
      onNotify('error', emptyMessage);
      return null;
    }
    return { result, truncated: outcome.truncated };
  };

  const handleCopyCsv = async () => {
    setExporting(true);
    try {
      const fresh = await freshCsv('Chưa có khách nào đủ điều kiện (đã đồng ý nhận tin) trong tệp này để xuất CSV.');
      if (fresh === null) return;
      const { result } = fresh;
      await navigator.clipboard.writeText(result.csv);
      onNotify(
        'notice',
        `Đã sao chép CSV SHA-256 (${result.includedCount} mã băm ẩn danh, loại trừ ${result.excludedNoConsent + result.excludedSuppressed} hồ sơ bảo vệ quyền riêng tư).${fresh.truncated ? TRUNCATED_NOTE : ''}`,
      );
    } catch {
      onNotify('error', 'Không sao chép được CSV SHA-256. Hãy thử tải file trực tiếp.');
    } finally {
      setExporting(false);
    }
  };

  const handleDownloadCsv = async () => {
    setExporting(true);
    try {
      const fresh = await freshCsv('Chưa có khách nào đủ điều kiện (đã đồng ý nhận tin) trong tệp này để tải CSV.');
      if (fresh === null) return;
      const { result } = fresh;
      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `izzi-meta-audience-${exportTarget.toLowerCase()}-sha256.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      onNotify(
        'notice',
        `Đã tải file CSV SHA-256 (${result.includedCount} khách đủ điều kiện, 0% dữ liệu cá nhân thô).${fresh.truncated ? TRUNCATED_NOTE : ''}`,
      );
    } catch {
      onNotify('error', 'Không tải được file CSV SHA-256.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="v2-crm-workspace" role="region" aria-label="Phân hệ Phục vụ Ads">
      <div className="v2-crm-ads-buckets" aria-label="4 tệp chiến dịch quảng cáo">
        {ORDERED_ADS_BUCKETS.map((bucketKey) => {
          const bucket = summary.buckets[bucketKey];
          const meta = BUCKET_TITLES[bucketKey];
          const angle = bucket.adAngles[0];
          const isSuppressed = bucketKey === 'suppressed';
          return (
            <section
              key={bucketKey}
              className={`v2-crm-ads-card${isSuppressed ? ' is-suppressed' : ''}`}
              aria-label={meta.title}
            >
              <header className="v2-crm-ads-card__head">
                <div>
                  <h3 className="v2-crm-ads-card__title">{meta.title}</h3>
                  <p className="v2-crm__meta">{meta.subtitle}</p>
                </div>
                <strong className="v2-crm-ads-card__count">{bucket.count}</strong>
              </header>

              <div className="v2-crm-ads-card__stats">
                {isSuppressed ? (
                  <span className="v2-crm-chip is-danger">Khóa xuất 100% (Bảo vệ ngân sách & quyền từ chối)</span>
                ) : (
                  <span className="v2-crm-chip is-granted">
                    {`${bucket.consentedCount}/${bucket.count} khách đã đồng ý nhận tin`}
                  </span>
                )}
              </div>

              {angle && (
                <div className="v2-crm-ads-card__angle">
                  <p className="v2-crm-ads-card__headline">{angle.headline}</p>
                  <p className="v2-crm__meta">{angle.hook}</p>
                  <p className="v2-crm__meta"><strong>Định dạng:</strong> {angle.recommendedFormat}</p>
                </div>
              )}

              {!isSuppressed && (
                <div className="v2-crm-ads-card__actions">
                  <button
                    type="button"
                    className={`v2-button v2-button--ghost${exportTarget === bucketKey ? ' is-selected' : ''}`}
                    onClick={() => setExportTarget(bucketKey)}
                  >
                    {exportTarget === bucketKey ? 'Đang chọn xuất CSV' : 'Chọn tệp xuất CSV'}
                  </button>
                </div>
              )}
            </section>
          );
        })}
      </div>

      <section className="v2-crm-ads-personas" aria-labelledby="v2-crm-ads-personas-title">
        <div className="v2-crm-ads-personas__head">
          <h3 id="v2-crm-ads-personas-title" className="v2-crm-section-title">
            Phân cụm Chân dung P1 – P4 & Góc nội dung quảng cáo (Ad Angles)
          </h3>
          {summary.unclassifiedCount > 0 && (
            <span className="v2-crm__meta">
              {`Còn ${summary.unclassifiedCount} khách chưa có nhóm P1–P4 (chỉ xếp nhóm khi khách đã đồng ý)`}
            </span>
          )}
        </div>

        <div className="v2-crm__table-wrap">
          <table className="v2-crm__table v2-crm-ads-table">
            <thead>
              <tr>
                <th scope="col">Chân dung</th>
                <th scope="col">Quy mô tệp</th>
                <th scope="col">Tiêu đề quảng cáo gợi ý</th>
                <th scope="col">Hook sáng tạo & Định dạng</th>
              </tr>
            </thead>
            <tbody>
              {(['P1', 'P2', 'P3', 'P4'] as const).map((personaKey) => {
                const item = summary.byPersona[personaKey];
                const angle = item.adAngles[0];
                return (
                  <tr key={personaKey}>
                    <td>
                      <strong>{item.label}</strong>
                    </td>
                    <td>
                      <div className="v2-crm-ads-table__counts">
                        <span>{`${item.count} khách`}</span>
                        <span className="v2-crm__meta">{`${item.consentedCount} đủ điều kiện Ads`}</span>
                      </div>
                    </td>
                    <td>{angle?.headline ?? '—'}</td>
                    <td>
                      <p className="v2-crm-ads-table__hook">{angle?.hook ?? '—'}</p>
                      {angle && <span className="v2-crm__meta">{`Định dạng: ${angle.recommendedFormat}`}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="v2-crm-ads-export" aria-labelledby="v2-crm-ads-export-title">
        <div className="v2-crm-ads-export__head">
          <div>
            <h3 id="v2-crm-ads-export-title" className="v2-crm-section-title">
              Xuất tệp Custom Audience mã hóa SHA-256 chuẩn Meta
            </h3>
            <p className="v2-crm__meta">
              Chỉ băm một chiều SHA-256 số 84… của khách đã bấm &ldquo;Đồng ý&rdquo; (máy chủ ghi nhận), không từ chối nhận tin và không yêu cầu xoá. Tệp chỉ có cột phone: không tên, tuổi, gia đình hay chân dung. Khi xuất, izzi đọc lại toàn bộ danh sách để kiểm tra đồng ý mới nhất.
            </p>
          </div>
        </div>

        {exportBlock !== null && (
          <p className="v2-crm__hint" role="status">{ADS_EXPORT_BLOCK_NOTES[exportBlock]}</p>
        )}

        <div className="v2-crm-ads-export__controls">
          <label className="v2-field v2-crm-ads-export__picker" htmlFor="v2-crm-ads-export-target">
            <span className="v2-field__label">Chọn tệp đối tượng xuất</span>
            <select
              id="v2-crm-ads-export-target"
              className="v2-field__select"
              value={exportTarget}
              onChange={(event) => setExportTarget(event.currentTarget.value as CrmMetaAudienceTarget)}
            >
              {ADS_EXPORT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </label>

          <div className="v2-crm-ads-export__summary" role="status" aria-live="polite">
            <span className="v2-crm-chip is-granted">
              {`Đủ điều kiện xuất: ${preview.phones.length} khách`}
            </span>
            <span className="v2-crm-chip">
              {`Loại bảo vệ quyền riêng tư: ${preview.excludedNoConsent} chưa đồng ý · ${preview.excludedSuppressed} đã chặn`}
            </span>
          </div>

          <div className="v2-crm__buttons">
            <button
              type="button"
              className="v2-button v2-button--ghost"
              disabled={exporting || preview.phones.length === 0}
              onClick={() => { void handleCopyCsv(); }}
            >
              Sao chép CSV SHA-256
            </button>
            <button
              type="button"
              className="v2-button v2-button--primary"
              disabled={exporting || preview.phones.length === 0}
              onClick={() => { void handleDownloadCsv(); }}
            >
              Tải file CSV SHA-256
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 5. Enterprise View 3 — Post-Sale & Remarketing ("Hậu bán & Remarketing")
// ---------------------------------------------------------------------------

/**
 * Applies a Lifecycle / Remarketing next step to a row's profile.
 * If the customer was in `stage === 'lost'`, reopens `stage: 'consulting'` and clears `lostReason` so the
 * scheduled follow-up returns to "Cần gọi hôm nay" (`crmDue`).
 */
export function applyLifecycleNextStep(
  profile: CustomerCareCrmProfileInput,
  item: Pick<CrmLifecycleItem, 'suggestedNextStep' | 'suggestedDueIso'>,
): CustomerCareCrmProfileInput {
  const reopen = profile.stage === 'lost';
  return {
    ...profile,
    stage: reopen ? 'consulting' : profile.stage,
    lostReason: reopen ? null : profile.lostReason,
    nextStep: item.suggestedNextStep,
    nextStepDueAt: item.suggestedDueIso,
  };
}

export interface CrmLifecycleWorkspaceProps {
  rows: readonly CustomerCareCrmRow[];
  products: readonly CrmEnterpriseProduct[];
  nowMs: number;
  /** The list answer's identityEnabled: unless true, the order layer (products, occasion, timeline) is guessed from the chat. */
  identityEnabled: boolean | null;
  onChangeProfile: (row: CustomerCareCrmRow, nextProfile: CustomerCareCrmProfileInput) => void;
  onCopyText: (text: string, successMessage: string) => void;
  onOpenProfile: (leadId: string) => void;
}

type LifecycleFilter = 'all' | CrmLifecycleCategory;

export function CrmLifecycleWorkspace({
  rows,
  products,
  nowMs,
  identityEnabled,
  onChangeProfile,
  onCopyText,
  onOpenProfile,
}: CrmLifecycleWorkspaceProps) {
  const [categoryFilter, setCategoryFilter] = useState<LifecycleFilter>('all');

  const rowMap = useMemo(() => new Map(rows.map((r) => [r.leadId, r])), [rows]);

  const allItems = useMemo(() => {
    const raw = buildLifecyclePlan(rows, products, nowMs, { identityEnabled });
    return [...raw].sort((a, b) => (
      Number(b.isOverdue) - Number(a.isOverdue)
      || a.dueDay.localeCompare(b.dueDay)
    ));
  }, [rows, products, nowMs, identityEnabled]);

  const counts = useMemo(() => ({
    all: allItems.length,
    postSale: allItems.filter((item) => item.category === 'post_sale').length,
    remarketing: allItems.filter((item) => item.category === 'remarketing').length,
  }), [allItems]);

  const visibleItems = useMemo(
    () => (categoryFilter === 'all' ? allItems : allItems.filter((item) => item.category === categoryFilter)),
    [allItems, categoryFilter],
  );

  return (
    <div className="v2-crm-workspace" role="region" aria-label="Phân hệ Hậu bán và Remarketing">
      <div className="v2-crm-workspace__bar">
        <div className="v2-project-tabs" role="group" aria-label="Bộ lọc chăm sóc vòng đời">
          <button
            type="button"
            className={`v2-tab${categoryFilter === 'all' ? ' is-active' : ''}`}
            aria-pressed={categoryFilter === 'all'}
            onClick={() => setCategoryFilter('all')}
          >
            {`Tất cả (${counts.all})`}
          </button>
          <button
            type="button"
            className={`v2-tab${categoryFilter === 'post_sale' ? ' is-active' : ''}`}
            aria-pressed={categoryFilter === 'post_sale'}
            onClick={() => setCategoryFilter('post_sale')}
          >
            {`Chăm sóc sau bán (N+1, N+7, N+30) (${counts.postSale})`}
          </button>
          <button
            type="button"
            className={`v2-tab${categoryFilter === 'remarketing' ? ' is-active' : ''}`}
            aria-pressed={categoryFilter === 'remarketing'}
            onClick={() => setCategoryFilter('remarketing')}
          >
            {`Remarketing khách chưa chốt (${counts.remarketing})`}
          </button>
        </div>
        <span className="v2-crm__meta">
          Kiểm tra tự động khung 24h Messenger · Tự loại trừ khách từ chối liên hệ
        </span>
      </div>

      {visibleItems.length === 0 ? (
        <div className="v2-empty">
          <p>Chưa có lịch chăm sóc hậu bán hoặc remarketing nào trong nhóm đang chọn.</p>
        </div>
      ) : (
        <div className="v2-crm-lifecycle-list">
          {visibleItems.map((item, idx) => {
            const row = rowMap.get(item.leadId);
            if (!row) return null;
            const name = leadDisplayName(row);
            const readOnly = crmRowReadOnly(row);
            const profile = profileFromRow(row);
            const safeMessenger = item.channel === 'messenger_24h';

            return (
              <article
                key={`${item.leadId}-${item.category}-${item.dueDay}-${idx}`}
                className="v2-crm-lifecycle-card"
                aria-label={`${name} · ${item.milestoneLabel}`}
              >
                <header className="v2-crm-lifecycle-card__head">
                  <div className="v2-crm-lifecycle-card__who">
                    <h3 className="v2-crm-lifecycle-card__name">{name}</h3>
                    <span className="v2-crm-chip">{crmStageLabel(row.profile.stage)}</span>
                    <span className="v2-crm__phone">{formatLeadPhone(row.phone)}</span>
                    <button
                      type="button"
                      className="v2-button v2-button--ghost"
                      aria-label={`Sao chép số của ${name}`}
                      onClick={() => onCopyText(row.phone, `Đã sao chép số của ${name}.`)}
                    >
                      Sao chép số
                    </button>
                  </div>

                  <div className="v2-crm-lifecycle-card__badges">
                    {item.isOverdue && <span className="v2-crm__due is-overdue">Quá hạn</span>}
                    <span className="v2-crm-chip">{`Hạn: ${formatCrmDay(item.dueDay)}`}</span>
                    <span
                      className={`v2-crm-channel ${safeMessenger ? 'is-safe-24h' : 'is-outside-24h'}`}
                      title={item.channelLabel}
                    >
                      {safeMessenger ? 'Trong cửa sổ 24h Messenger' : 'Zalo / Gọi điện (ngoài 24h)'}
                    </span>
                  </div>
                </header>

                <p className="v2-crm-lifecycle-card__milestone">{item.milestoneLabel}</p>
                <p className="v2-crm__meta">{item.channelLabel}</p>

                <div className="v2-crm-lifecycle-card__template">
                  <div className="v2-crm-saler-card__script-head">
                    <span className="v2-field__label">Mẫu tin nhắn gợi ý</span>
                    <button
                      type="button"
                      className="v2-button v2-button--ghost"
                      onClick={() => onCopyText(item.messageTemplate, `Đã sao chép mẫu tin nhắn cho ${name}.`)}
                    >
                      Sao chép tin nhắn
                    </button>
                  </div>
                  <p className="v2-crm-saler-card__opener">{item.messageTemplate}</p>
                </div>

                <footer className="v2-crm-lifecycle-card__footer">
                  <span className="v2-crm__meta">{`Gợi ý việc tiếp theo: ${item.suggestedNextStep}`}</span>
                  <div className="v2-crm__buttons">
                    <button
                      type="button"
                      className="v2-button v2-button--primary"
                      disabled={readOnly}
                      onClick={() => onChangeProfile(row, applyLifecycleNextStep(profile, item))}
                    >
                      Đặt thành việc tiếp theo
                    </button>
                    <button
                      type="button"
                      className="v2-button v2-button--ghost"
                      onClick={() => onOpenProfile(row.leadId)}
                    >
                      Mở hồ sơ
                    </button>
                  </div>
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
