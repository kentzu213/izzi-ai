import { useEffect, useMemo, useState } from 'react';
import {
  CUSTOMER_CARE_CRM_SALER_COLORS,
  type CustomerCareCrmAssignee,
  type CustomerCareCrmBulkAssignInput,
  type CustomerCareCrmRow,
  type CustomerCareCrmSalerColor,
  type CustomerCareCrmSalerMember,
  type CustomerCareCrmSalerRoutingConfig,
  type CustomerCareCrmTeamSaveInput,
} from '../../shared/customer-care-types';
import {
  CRM_SALER_COLOR_PALETTE,
  buildDefaultDaiLongSalerPreset,
  buildQuickSalersFromNames,
  createSalerMember,
  planSalerAutoDistribution,
  type CrmAutoDistributionMode,
  type CrmAutoDistributionScope,
} from '../../shared/customer-crm-saler-routing';
import { crmAssigneeLabel, type CrmPageOption } from './customer-crm-flow';

export type CrmSalerModalTab = 'distribute' | 'team';

export interface CustomerCrmSalerModalProps {
  open: boolean;
  initialTab?: CrmSalerModalTab;
  initialMode?: CrmAutoDistributionMode;
  initialRescueSalerId?: string | null;
  rows: readonly CustomerCareCrmRow[];
  filteredRows: readonly CustomerCareCrmRow[];
  salers: readonly CustomerCareCrmSalerMember[];
  routing: CustomerCareCrmSalerRoutingConfig;
  teamRevision: number;
  pageOptions: readonly CrmPageOption[];
  assignees: readonly CustomerCareCrmAssignee[];
  nowMs: number;
  busy: boolean;
  modalError: string;
  onClose: () => void;
  onBulkAssign: (input: CustomerCareCrmBulkAssignInput) => Promise<boolean>;
  onSaveTeam: (input: CustomerCareCrmTeamSaveInput) => Promise<boolean>;
}

export default function CustomerCrmSalerModal({
  open,
  initialTab = 'distribute',
  initialMode,
  initialRescueSalerId = null,
  rows,
  filteredRows,
  salers,
  routing,
  teamRevision,
  pageOptions,
  assignees,
  nowMs,
  busy,
  modalError,
  onClose,
  onBulkAssign,
  onSaveTeam,
}: CustomerCrmSalerModalProps) {
  const [tab, setTab] = useState<CrmSalerModalTab>(initialTab);
  const [mode, setMode] = useState<CrmAutoDistributionMode>(initialMode ?? routing.mode);
  const [scope, setScope] = useState<CrmAutoDistributionScope>('unassigned');
  const [rescueSalerId, setRescueSalerId] = useState<string>(initialRescueSalerId ?? '');
  const [protectZaloAndWon, setProtectZaloAndWon] = useState<boolean>(routing.protectZaloAndWon);
  const [shiftActiveIds, setShiftActiveIds] = useState<ReadonlySet<string>>(
    () => new Set(salers.filter((s) => s.active).map((s) => s.id)),
  );

  // Team editor draft state
  const [draftSalers, setDraftSalers] = useState<CustomerCareCrmSalerMember[]>(() =>
    salers.map((s) => ({ ...s, assignedPageIds: [...s.assignedPageIds] })),
  );
  const [draftRouting, setDraftRouting] = useState<CustomerCareCrmSalerRoutingConfig>(() => ({ ...routing }));
  const [quickNames, setQuickNames] = useState('');
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    setMode(initialMode ?? routing.mode);
    setRescueSalerId(initialRescueSalerId ?? '');
    setProtectZaloAndWon(routing.protectZaloAndWon);
    setShiftActiveIds(new Set(salers.filter((s) => s.active).map((s) => s.id)));
    setDraftSalers(salers.map((s) => ({ ...s, assignedPageIds: [...s.assignedPageIds] })));
    setDraftRouting({ ...routing });
    setLocalError('');
  }, [open, initialTab, initialMode, initialRescueSalerId, salers, routing]);

  useEffect(() => {
    if (!open || typeof window === 'undefined') return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, busy, onClose]);

  const effectiveShiftSalers = useMemo(
    () => salers.map((s) => ({ ...s, active: shiftActiveIds.has(s.id) })),
    [salers, shiftActiveIds],
  );

  const filteredLeadIds = useMemo(
    () => new Set(filteredRows.map((row) => row.leadId)),
    [filteredRows],
  );

  const plan = useMemo(
    () =>
      planSalerAutoDistribution({
        rows,
        salers: effectiveShiftSalers,
        mode,
        sourceScope: scope,
        filteredLeadIds: scope === 'filtered' ? filteredLeadIds : undefined,
        rescueSalerId: mode === 'rescue_stale' && rescueSalerId !== '' ? rescueSalerId : null,
        protectZaloAndWon,
        nowMs,
      }),
    [rows, effectiveShiftSalers, mode, scope, filteredLeadIds, rescueSalerId, protectZaloAndWon, nowMs],
  );

  const pageLabelById = useMemo(
    () => new Map(pageOptions.map((p) => [p.pageId, p.label])),
    [pageOptions],
  );

  if (!open) return null;

  const toggleShiftSaler = (id: string, checked: boolean) => {
    setShiftActiveIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleApplyPreset = () => {
    setLocalError('');
    setDraftSalers(buildDefaultDaiLongSalerPreset(pageOptions));
  };

  const handleQuickAdd = () => {
    setLocalError('');
    const added = buildQuickSalersFromNames(quickNames, draftSalers);
    if (added.length === 0) {
      setLocalError('Nhập ít nhất một tên Saler mới (cách nhau bằng dấu phẩy hoặc xuống dòng).');
      return;
    }
    setDraftSalers((current) => [...current, ...added]);
    setQuickNames('');
  };

  const updateDraftSaler = (id: string, patch: Partial<CustomerCareCrmSalerMember>) => {
    setDraftSalers((current) => current.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const toggleSalerPage = (salerId: string, pageId: string, checked: boolean) => {
    setDraftSalers((current) =>
      current.map((s) => {
        if (s.id !== salerId) return s;
        const nextPages = checked
          ? (s.assignedPageIds.includes(pageId) ? s.assignedPageIds : [...s.assignedPageIds, pageId])
          : s.assignedPageIds.filter((id) => id !== pageId);
        return { ...s, assignedPageIds: nextPages };
      }),
    );
  };

  const handleSaveTeam = async () => {
    setLocalError('');
    const cleaned = draftSalers
      .map((s) => ({ ...s, name: s.name.trim() }))
      .filter((s) => s.name.length > 0);
    if (cleaned.length === 0 && draftSalers.length > 0) {
      setLocalError('Tên Saler không được để trống.');
      return;
    }
    const ok = await onSaveTeam({
      expectedRevision: teamRevision,
      salers: cleaned,
      routing: draftRouting,
    });
    if (ok && cleaned.length > 0) {
      setShiftActiveIds(new Set(cleaned.filter((s) => s.active).map((s) => s.id)));
      setTab('distribute');
    }
  };

  const handleRunBulkAssign = async () => {
    setLocalError('');
    if (plan.assignments.length === 0) return;
    await onBulkAssign({ assignments: plan.assignments });
  };

  const displayError = localError || modalError;

  return (
    <div className="v2-crm-modal-backdrop" role="presentation" onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div
        className="v2-crm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="v2-crm-saler-modal-title"
      >
        <header className="v2-crm-modal__head">
          <div>
            <h3 id="v2-crm-saler-modal-title" className="v2-crm-modal__title">
              ⚡ Phân bổ &amp; Điều tiết Saler tự động
            </h3>
            <p className="v2-crm__meta">
              Chia số 1 chạm cho đội Saler theo Page hoặc cân bằng tải — bảo vệ khách đã KB Zalo &amp; Đã cọc.
            </p>
          </div>
          <button
            type="button"
            className="v2-button v2-button--ghost"
            disabled={busy}
            aria-label="Đóng hộp thoại phân bổ Saler"
            onClick={onClose}
          >
            ✕
          </button>
        </header>

        <div className="v2-crm-modal__tabs" role="tablist" aria-label="Chức năng phân bổ Saler">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'distribute'}
            className={`v2-crm-drawer__tab${tab === 'distribute' ? ' is-active' : ''}`}
            onClick={() => setTab('distribute')}
          >
            Chia số tự động (1-Click)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'team'}
            className={`v2-crm-drawer__tab${tab === 'team' ? ' is-active' : ''}`}
            onClick={() => setTab('team')}
          >
            {`Đội Saler & Phân Page (${draftSalers.length})`}
          </button>
        </div>

        <div className="v2-crm-modal__body">
          {displayError && <p className="v2-crm__error" role="alert">{displayError}</p>}

          {tab === 'distribute' ? (
            salers.length === 0 ? (
              <div className="v2-empty">
                <p>Chưa có thành viên nào trong Đội Saler. Hãy nạp mẫu nhanh hoặc thêm tên Saler trước khi phân bổ.</p>
                <button type="button" className="v2-button v2-button--primary" onClick={() => setTab('team')}>
                  Thiết lập Đội Saler ngay
                </button>
              </div>
            ) : (
              <div className="v2-crm-modal__section">
                <div className="v2-crm-modal__grid">
                  <label className="v2-field" htmlFor="v2-crm-dist-mode">
                    <span className="v2-field__label">Chế độ chia số</span>
                    <select
                      id="v2-crm-dist-mode"
                      className="v2-field__select"
                      value={mode}
                      onChange={(e) => setMode(e.currentTarget.value as CrmAutoDistributionMode)}
                    >
                      <option value="round_robin">Chia đều cân bằng tải</option>
                      <option value="by_page">Chia chuyên trách theo Page</option>
                      <option value="rescue_stale">Rút khách ngâm &gt; 2h chia lại</option>
                    </select>
                  </label>

                  {mode === 'rescue_stale' ? (
                    <label className="v2-field" htmlFor="v2-crm-rescue-saler">
                      <span className="v2-field__label">Rút số ngâm từ Saler</span>
                      <select
                        id="v2-crm-rescue-saler"
                        className="v2-field__select"
                        value={rescueSalerId}
                        onChange={(e) => setRescueSalerId(e.currentTarget.value)}
                      >
                        <option value="">Tất cả Saler có số ngâm &gt; 2h</option>
                        {salers.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <label className="v2-field" htmlFor="v2-crm-dist-scope">
                      <span className="v2-field__label">Phạm vi khách</span>
                      <select
                        id="v2-crm-dist-scope"
                        className="v2-field__select"
                        value={scope}
                        onChange={(e) => setScope(e.currentTarget.value as CrmAutoDistributionScope)}
                      >
                        <option value="unassigned">Chỉ khách chưa giao</option>
                        <option value="filtered">{`Theo bộ lọc hiện tại (${filteredRows.length} khách)`}</option>
                      </select>
                    </label>
                  )}
                </div>

                <label className="v2-crm__product">
                  <input
                    type="checkbox"
                    checked={protectZaloAndWon}
                    disabled={mode === 'rescue_stale'}
                    onChange={(e) => setProtectZaloAndWon(e.currentTarget.checked)}
                  />
                  <span>Bảo vệ khách đã KB Zalo (B3) &amp; Đã cọc/Đã giao</span>
                </label>

                <fieldset className="v2-crm__products">
                  <legend className="v2-field__label">Saler trực ca nhận số</legend>
                  {salers.map((saler) => {
                    const palette = CRM_SALER_COLOR_PALETTE[saler.color];
                    const checked = shiftActiveIds.has(saler.id);
                    return (
                      <label key={saler.id} className="v2-crm__product">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => toggleShiftSaler(saler.id, e.currentTarget.checked)}
                        />
                        <span
                          className="v2-crm-saler-chip"
                          style={{ background: palette.bg, borderColor: palette.border, color: palette.text }}
                        >
                          {saler.name}
                        </span>
                      </label>
                    );
                  })}
                </fieldset>

                <div className="v2-crm-modal__preview">
                  <div className="v2-crm-modal__preview-head">
                    <strong>Xem trước kết quả chia số (Dry-Run)</strong>
                    <span className="v2-crm__meta">
                      {`Dự kiến chia ${plan.assignments.length} khách${plan.skippedLockedCount > 0 ? ` · bỏ qua ${plan.skippedLockedCount} khách được bảo vệ` : ''}`}
                    </span>
                  </div>
                  {plan.bySaler.length === 0 ? (
                    <p className="v2-crm__hint">Hãy chọn ít nhất 1 Saler trực ca để xem trước phân bổ.</p>
                  ) : (
                    <div className="v2-crm__table-wrap">
                      <table className="v2-crm__table">
                        <thead>
                          <tr>
                            <th scope="col">Saler</th>
                            <th scope="col">Hiện có</th>
                            <th scope="col">Nhận thêm</th>
                            <th scope="col">Sau chia</th>
                            <th scope="col">Phân bổ theo Page</th>
                          </tr>
                        </thead>
                        <tbody>
                          {plan.bySaler.map((entry) => {
                            const palette = CRM_SALER_COLOR_PALETTE[entry.saler.color];
                            const breakdown = Object.entries(entry.pageBreakdown)
                              .map(([pid, cnt]) => `${pageLabelById.get(pid) ?? pid}: +${cnt}`)
                              .join(' · ');
                            return (
                              <tr key={entry.saler.id}>
                                <td>
                                  <span
                                    className="v2-crm-saler-chip"
                                    style={{ background: palette.bg, borderColor: palette.border, color: palette.text }}
                                  >
                                    {entry.saler.name}
                                  </span>
                                </td>
                                <td>{entry.beforeCount}</td>
                                <td><strong>{entry.addedCount > 0 ? `+${entry.addedCount}` : '0'}</strong></td>
                                <td>{entry.afterCount}</td>
                                <td className="v2-crm__meta">{breakdown || '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <footer className="v2-crm__footer">
                  <span className="v2-crm__meta">
                    {plan.assignments.length > 500
                      ? `Tự động gửi theo lô 500 khách (${Math.ceil(plan.assignments.length / 500)} lô).`
                      : 'Xác nhận là chia ngay trên máy chủ, có kiểm tra xung đột phiên bản.'}
                  </span>
                  <div className="v2-crm__buttons">
                    <button type="button" className="v2-button v2-button--ghost" disabled={busy} onClick={onClose}>
                      Đóng
                    </button>
                    <button
                      type="button"
                      className="v2-button v2-button--primary"
                      disabled={busy || plan.assignments.length === 0}
                      onClick={() => { void handleRunBulkAssign(); }}
                    >
                      {busy ? 'Đang phân bổ…' : `⚡ Phân bổ ngay ${plan.assignments.length} khách`}
                    </button>
                  </div>
                </footer>
              </div>
            )
          ) : (
            <div className="v2-crm-modal__section">
              <div className="v2-crm-modal__quick-bar">
                <button type="button" className="v2-button v2-button--ghost" onClick={handleApplyPreset}>
                  Nạp nhanh đội Saler mẫu (8 người)
                </button>
                <button
                  type="button"
                  className="v2-button v2-button--ghost"
                  onClick={() => setDraftSalers((current) => [...current, createSalerMember('', current)])}
                >
                  + Thêm 1 Saler
                </button>
              </div>

              <div className="v2-crm-modal__quick-names">
                <label className="v2-field v2-crm__grow" htmlFor="v2-crm-quick-names">
                  <span className="v2-field__label">Nhập nhanh nhiều tên (cách nhau bằng dấu phẩy hoặc xuống dòng)</span>
                  <textarea
                    id="v2-crm-quick-names"
                    className="v2-field__input"
                    rows={2}
                    placeholder="Ví dụ: Tuấn Thần Đèn, Đại, Nga, Hà My, Hoa"
                    value={quickNames}
                    onChange={(e) => setQuickNames(e.currentTarget.value)}
                  />
                </label>
                <button type="button" className="v2-button v2-button--ghost" onClick={handleQuickAdd}>
                  Thêm nhanh
                </button>
              </div>

              <div className="v2-crm-modal__grid">
                <label className="v2-field" htmlFor="v2-crm-default-routing">
                  <span className="v2-field__label">Chế độ mặc định của workspace</span>
                  <select
                    id="v2-crm-default-routing"
                    className="v2-field__select"
                    value={draftRouting.mode}
                    onChange={(e) => setDraftRouting((c) => ({ ...c, mode: e.currentTarget.value as 'round_robin' | 'by_page' }))}
                  >
                    <option value="by_page">Chia chuyên trách theo Page</option>
                    <option value="round_robin">Chia đều cân bằng tải</option>
                  </select>
                </label>
                <label className="v2-crm__product">
                  <input
                    type="checkbox"
                    checked={draftRouting.protectZaloAndWon}
                    onChange={(e) => setDraftRouting((c) => ({ ...c, protectZaloAndWon: e.currentTarget.checked }))}
                  />
                  <span>Mặc định bảo vệ khách đã KB Zalo &amp; Đã cọc</span>
                </label>
              </div>

              <div className="v2-crm-team-list">
                {draftSalers.length === 0 ? (
                  <p className="v2-crm__hint">Chưa có Saler nào. Bấm &ldquo;Nạp nhanh đội Saler mẫu&rdquo; hoặc nhập tên ở trên.</p>
                ) : (
                  draftSalers.map((saler, index) => {
                    const palette = CRM_SALER_COLOR_PALETTE[saler.color];
                    return (
                      <div key={saler.id} className="v2-crm-team-card">
                        <div className="v2-crm-team-card__top">
                          <input
                            type="text"
                            className="v2-field__input"
                            aria-label={`Tên Saler ${index + 1}`}
                            maxLength={80}
                            value={saler.name}
                            onChange={(e) => updateDraftSaler(saler.id, { name: e.currentTarget.value })}
                          />
                          <span
                            className="v2-crm-saler-chip"
                            style={{ background: palette.bg, borderColor: palette.border, color: palette.text }}
                          >
                            {saler.name || 'Chưa đặt tên'}
                          </span>
                          <label className="v2-crm__product">
                            <input
                              type="checkbox"
                              checked={saler.active}
                              onChange={(e) => updateDraftSaler(saler.id, { active: e.currentTarget.checked })}
                            />
                            <span>Trực ca</span>
                          </label>
                          <button
                            type="button"
                            className="v2-button v2-crm__danger"
                            onClick={() => setDraftSalers((c) => c.filter((item) => item.id !== saler.id))}
                          >
                            Xoá
                          </button>
                        </div>

                        <div className="v2-crm-team-card__colors" role="group" aria-label={`Chọn màu cho ${saler.name || `Saler ${index + 1}`}`}>
                          {CUSTOMER_CARE_CRM_SALER_COLORS.map((c: CustomerCareCrmSalerColor) => {
                            const token = CRM_SALER_COLOR_PALETTE[c];
                            const selected = saler.color === c;
                            return (
                              <button
                                key={c}
                                type="button"
                                className={`v2-crm-color-dot${selected ? ' is-selected' : ''}`}
                                style={{ background: token.bg }}
                                title={token.label}
                                aria-label={`Màu ${token.label}`}
                                aria-pressed={selected}
                                onClick={() => updateDraftSaler(saler.id, { color: c })}
                              />
                            );
                          })}
                        </div>

                        <div className="v2-crm-team-card__meta">
                          {pageOptions.length > 0 && (
                            <div className="v2-crm-team-card__pages">
                              <span className="v2-crm__meta">Phụ trách Page:</span>
                              {pageOptions.map((page) => (
                                <label key={page.pageId} className="v2-crm__product">
                                  <input
                                    type="checkbox"
                                    checked={saler.assignedPageIds.includes(page.pageId)}
                                    onChange={(e) => toggleSalerPage(saler.id, page.pageId, e.currentTarget.checked)}
                                  />
                                  <span>{page.label}</span>
                                </label>
                              ))}
                            </div>
                          )}

                          {assignees.length > 0 && (
                            <label className="v2-field" htmlFor={`v2-crm-member-${saler.id}`}>
                              <span className="v2-field__label">Liên kết tài khoản</span>
                              <select
                                id={`v2-crm-member-${saler.id}`}
                                className="v2-field__select"
                                value={saler.memberUserId ?? ''}
                                onChange={(e) => updateDraftSaler(saler.id, { memberUserId: e.currentTarget.value || null })}
                              >
                                <option value="">Không gắn tài khoản</option>
                                {assignees.map((a) => (
                                  <option key={a.userId} value={a.userId}>{crmAssigneeLabel(assignees, a.userId)}</option>
                                ))}
                              </select>
                            </label>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <footer className="v2-crm__footer">
                <span className="v2-crm__meta">{`Phiên bản đội Saler: #${teamRevision}`}</span>
                <div className="v2-crm__buttons">
                  <button type="button" className="v2-button v2-button--ghost" disabled={busy} onClick={onClose}>
                    Huỷ
                  </button>
                  <button
                    type="button"
                    className="v2-button v2-button--primary"
                    disabled={busy}
                    onClick={() => { void handleSaveTeam(); }}
                  >
                    {busy ? 'Đang lưu…' : 'Lưu đội Saler'}
                  </button>
                </div>
              </footer>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
