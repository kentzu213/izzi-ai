import { useMemo, useState } from 'react';
import type { CustomerCareCrmRow, CustomerCareCrmSalerMember } from '../../shared/customer-care-types';
import {
  CRM_CARE_STEP_META,
  CRM_SALER_COLOR_PALETTE,
  buildSalerSupervisionMatrix,
} from '../../shared/customer-crm-saler-routing';
import type { CrmFilter, CrmStepFilter } from './customer-crm-flow';

export interface CustomerCrmSalerBarProps {
  rows: readonly CustomerCareCrmRow[];
  salers: readonly CustomerCareCrmSalerMember[];
  filter: CrmFilter;
  nowMs: number;
  canManageTeam: boolean;
  showMatrix: boolean;
  mySalerId: string | null;
  onSelectMySalerId: (salerId: string | null) => void;
  onChangeFilter: (patch: Partial<CrmFilter>) => void;
  onOpenTeamModal: () => void;
  onOpenRescueModal: (salerId: string | null) => void;
}

const STEP_FILTER_PILLS: ReadonlyArray<{
  key: CrmStepFilter;
  label: string;
  countKey: 'total' | 'unassigned' | 'step1Uncalled' | 'step2NoAnswer' | 'step2Called' | 'step3Zalo' | 'wonCount' | 'step1BadPhone';
}> = [
  { key: 'any', label: 'Tất cả', countKey: 'total' },
  { key: 'unassigned', label: 'Chưa giao', countKey: 'unassigned' },
  { key: 'step1_uncalled', label: 'B1 · Chưa gọi', countKey: 'step1Uncalled' },
  { key: 'step2_no_answer', label: 'B2 · Gọi chưa nghe', countKey: 'step2NoAnswer' },
  { key: 'step2_called', label: 'B2 · Đã gọi', countKey: 'step2Called' },
  { key: 'step3_zalo', label: 'B3 · Đã KB Zalo', countKey: 'step3Zalo' },
  { key: 'won', label: 'Đã cọc/Giao', countKey: 'wonCount' },
  { key: 'step1_bad_phone', label: 'Sai số', countKey: 'step1BadPhone' },
];

/**
 * Color Tag Rail 2.0 (3-step quick filter + Pancake-style colored Saler pills)
 * and the Collapsible Saler Supervision Matrix.
 */
export function CustomerCrmSalerBar({
  rows,
  salers,
  filter,
  nowMs,
  canManageTeam,
  showMatrix,
  mySalerId,
  onSelectMySalerId,
  onChangeFilter,
  onOpenTeamModal,
  onOpenRescueModal,
}: CustomerCrmSalerBarProps) {
  const [pickingIdentity, setPickingIdentity] = useState(false);
  const matrix = useMemo(() => buildSalerSupervisionMatrix(rows, salers, nowMs), [rows, salers, nowMs]);

  const countMap = useMemo(() => ({
    total: matrix.totals.total,
    unassigned: matrix.unassigned.total,
    step1Uncalled: matrix.totals.step1Uncalled,
    step2NoAnswer: matrix.totals.step2NoAnswer,
    step2Called: matrix.totals.step2Called,
    step3Zalo: matrix.totals.step3Zalo,
    wonCount: matrix.totals.wonCount,
    step1BadPhone: matrix.totals.step1BadPhone,
  }), [matrix]);

  const activeStep = filter.careStep ?? 'any';
  const activeSaler = filter.salerId ?? 'any';
  const mySaler = mySalerId ? salers.find((s) => s.id === mySalerId) ?? null : null;

  const handleMyClick = () => {
    if (!mySaler) {
      if (salers.length === 1) {
        const only = salers[0]!;
        onSelectMySalerId(only.id);
        onChangeFilter({ salerId: activeSaler === only.id ? 'any' : only.id });
      } else {
        setPickingIdentity((v) => !v);
      }
      return;
    }
    onChangeFilter({ salerId: activeSaler === mySaler.id ? 'any' : mySaler.id });
  };

  const applyCellFilter = (salerId: string | 'unassigned', careStep: CrmStepFilter, staleOnly = false) => {
    onChangeFilter({
      view: 'all',
      salerId,
      careStep,
      staleOnly,
    });
  };

  return (
    <div className="v2-crm-saler-bar">
      <div className="v2-crm-rail" aria-label="Thanh lọc nhanh bước chăm sóc và Saler">
        <div className="v2-crm-rail__row" role="group" aria-label="Lọc theo bước chăm sóc 3 bước">
          {STEP_FILTER_PILLS.map((pill) => {
            const count = countMap[pill.countKey];
            const isSelected = activeStep === pill.key && !filter.staleOnly;
            const stepMeta = pill.key !== 'any' && pill.key !== 'unassigned' && pill.key !== 'won'
              ? CRM_CARE_STEP_META[pill.key]
              : null;
            return (
              <button
                key={pill.key}
                type="button"
                className={`v2-crm-step-pill${isSelected ? ' is-active' : ''}`}
                aria-pressed={isSelected}
                style={isSelected && stepMeta ? { background: stepMeta.bg, borderColor: stepMeta.border, color: stepMeta.text } : undefined}
                onClick={() => onChangeFilter({
                  careStep: isSelected ? 'any' : pill.key,
                  staleOnly: false,
                  ...(pill.key !== 'any' ? { view: 'all' } : {}),
                })}
              >
                <span>{pill.label}</span>
                <span className="v2-crm-pill-count">{count}</span>
                {pill.key === 'step1_uncalled' && matrix.totals.step1StaleOver2h > 0 && (
                  <span className="v2-crm-pill-stale" title="Khách chưa gọi quá 2 giờ">
                    {`⚠ ${matrix.totals.step1StaleOver2h} >2h`}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="v2-crm-rail__row" role="group" aria-label="Dải lọc nhân viên Saler">
          {salers.length > 0 && (
            <button
              type="button"
              className={`v2-crm-saler-pill is-mine${mySaler && activeSaler === mySaler.id ? ' is-active' : ''}`}
              aria-pressed={Boolean(mySaler && activeSaler === mySaler.id)}
              onClick={handleMyClick}
            >
              {mySaler ? `👤 Của tôi (${mySaler.name})` : '👤 Của tôi'}
            </button>
          )}

          {(pickingIdentity && salers.length > 0) && (
            <label className="v2-crm-inline-id" htmlFor="v2-crm-my-saler-pick">
              <span className="v2-visually-hidden">Chọn Saler của bạn</span>
              <select
                id="v2-crm-my-saler-pick"
                className="v2-field__select"
                value={mySalerId ?? ''}
                onChange={(event) => {
                  const val = event.currentTarget.value || null;
                  onSelectMySalerId(val);
                  setPickingIdentity(false);
                  if (val) onChangeFilter({ salerId: val });
                }}
              >
                <option value="">Chọn tên bạn…</option>
                {salers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
          )}

          {matrix.rows.map((item) => {
            const saler = item.saler!;
            const palette = CRM_SALER_COLOR_PALETTE[saler.color];
            const isSelected = activeSaler === saler.id;
            return (
              <button
                key={saler.id}
                type="button"
                className={`v2-crm-saler-pill${isSelected ? ' is-active' : ''}${!saler.active ? ' is-inactive' : ''}`}
                aria-pressed={isSelected}
                style={{
                  background: palette.bg,
                  borderColor: isSelected ? '#ffffff' : palette.border,
                  color: palette.text,
                }}
                onClick={() => onChangeFilter({ salerId: isSelected ? 'any' : saler.id })}
              >
                <span>{saler.name}</span>
                <span className="v2-crm-saler-pill__count">{item.total}</span>
              </button>
            );
          })}

          {canManageTeam && (
            <button
              type="button"
              className="v2-button v2-button--ghost v2-crm-rail__team-btn"
              onClick={onOpenTeamModal}
            >
              ⚙ Đội Saler
            </button>
          )}
        </div>
      </div>

      {showMatrix && (
        <section className="v2-crm-matrix" aria-label="Ma trận bao quát nhân viên Saler">
          <div className="v2-crm__table-wrap">
            <table className="v2-crm__table v2-crm-matrix__table">
              <thead>
                <tr>
                  <th scope="col">Nhân viên</th>
                  <th scope="col">Tổng</th>
                  <th scope="col">B1 Chưa gọi (&gt;2h)</th>
                  <th scope="col">B2 Chưa nghe</th>
                  <th scope="col">B2 Đã gọi</th>
                  <th scope="col">B3 Đã KB Zalo (%)</th>
                  <th scope="col">Đã cọc</th>
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map((item) => {
                  const saler = item.saler!;
                  const palette = CRM_SALER_COLOR_PALETTE[saler.color];
                  return (
                    <tr key={saler.id}>
                      <td>
                        <span
                          className="v2-crm-saler-chip"
                          style={{ background: palette.bg, borderColor: palette.border, color: palette.text }}
                        >
                          {saler.name}
                        </span>
                      </td>
                      <td>
                        <button type="button" className="v2-crm-matrix__num" onClick={() => applyCellFilter(saler.id, 'any')}>
                          {item.total}
                        </button>
                      </td>
                      <td>
                        <div className="v2-crm-matrix__b1">
                          <button type="button" className="v2-crm-matrix__num" onClick={() => applyCellFilter(saler.id, 'step1_uncalled')}>
                            {item.step1Uncalled}
                          </button>
                          {item.step1StaleOver2h > 0 && (
                            <>
                              <button
                                type="button"
                                className="v2-crm-matrix__stale-btn"
                                title="Lọc khách ngâm > 2h chưa gọi"
                                onClick={() => applyCellFilter(saler.id, 'step1_uncalled', true)}
                              >
                                {`⚠ ${item.step1StaleOver2h} >2h`}
                              </button>
                              {canManageTeam && (
                                <button
                                  type="button"
                                  className="v2-button v2-button--ghost v2-crm-matrix__rescue-btn"
                                  onClick={() => onOpenRescueModal(saler.id)}
                                >
                                  Rút số ngâm
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                      <td>
                        <button type="button" className="v2-crm-matrix__num" onClick={() => applyCellFilter(saler.id, 'step2_no_answer')}>
                          {item.step2NoAnswer}
                        </button>
                      </td>
                      <td>
                        <button type="button" className="v2-crm-matrix__num" onClick={() => applyCellFilter(saler.id, 'step2_called')}>
                          {item.step2Called}
                        </button>
                      </td>
                      <td>
                        <button type="button" className="v2-crm-matrix__num" onClick={() => applyCellFilter(saler.id, 'step3_zalo')}>
                          {`${item.step3Zalo} (${item.zaloRatePct}%)`}
                        </button>
                      </td>
                      <td>
                        <button type="button" className="v2-crm-matrix__num" onClick={() => applyCellFilter(saler.id, 'won')}>
                          {item.wonCount}
                        </button>
                      </td>
                    </tr>
                  );
                })}
                <tr className="v2-crm-matrix__unassigned">
                  <td><span className="v2-crm__meta">Chưa giao</span></td>
                  <td>
                    <button type="button" className="v2-crm-matrix__num" onClick={() => applyCellFilter('unassigned', 'any')}>
                      {matrix.unassigned.total}
                    </button>
                  </td>
                  <td>
                    <button type="button" className="v2-crm-matrix__num" onClick={() => applyCellFilter('unassigned', 'step1_uncalled')}>
                      {matrix.unassigned.step1Uncalled}
                      {matrix.unassigned.step1StaleOver2h > 0 ? ` (⚠ ${matrix.unassigned.step1StaleOver2h} >2h)` : ''}
                    </button>
                  </td>
                  <td>
                    <button type="button" className="v2-crm-matrix__num" onClick={() => applyCellFilter('unassigned', 'step2_no_answer')}>
                      {matrix.unassigned.step2NoAnswer}
                    </button>
                  </td>
                  <td>
                    <button type="button" className="v2-crm-matrix__num" onClick={() => applyCellFilter('unassigned', 'step2_called')}>
                      {matrix.unassigned.step2Called}
                    </button>
                  </td>
                  <td>
                    <button type="button" className="v2-crm-matrix__num" onClick={() => applyCellFilter('unassigned', 'step3_zalo')}>
                      {`${matrix.unassigned.step3Zalo} (${matrix.unassigned.zaloRatePct}%)`}
                    </button>
                  </td>
                  <td>
                    <button type="button" className="v2-crm-matrix__num" onClick={() => applyCellFilter('unassigned', 'won')}>
                      {matrix.unassigned.wonCount}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
