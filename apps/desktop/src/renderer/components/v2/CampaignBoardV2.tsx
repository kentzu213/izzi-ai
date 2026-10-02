import { useState, type ReactNode } from 'react';
import type { CustomerChannel, CustomerRun } from '../../../shared/customer-marketing-types';
import {
  CAMPAIGN_CHANNEL_GROUP_LABELS,
  CAMPAIGN_CHANNEL_INFO,
  CAMPAIGN_PHASES,
  CAMPAIGN_PHASE_INFO,
  deriveCampaignCellStatus,
  resolveCampaignBoard,
  type CampaignBoard,
  type CampaignCell,
  type CampaignCellStatus,
} from '../../../shared/customer-marketing-campaign-map';

const STATUS_LABELS: Record<CampaignCellStatus, string> = {
  todo: 'Chưa làm',
  in_progress: 'Đang làm',
  awaiting_approval: 'Chờ duyệt',
  done: 'Đã xong',
  blocked: 'Bị chặn',
};

export interface CampaignBoardV2Props extends CampaignBoard {
  runs: CustomerRun[];
}

export function CampaignBoardV2({ channels, cells, progress, runs }: CampaignBoardV2Props) {
  const done = CAMPAIGN_PHASES.reduce((sum, phase) => sum + progress[phase].done, 0);
  const total = CAMPAIGN_PHASES.reduce((sum, phase) => sum + progress[phase].total, 0);

  return (
    <section className="v2-campaign-board" aria-label="Bảng kế hoạch chiến dịch">
      <p className="v2-campaign-board__summary">Đã xong {done}/{total} việc</p>
      <div className="v2-campaign-board__scroll">
        <table className="v2-campaign-board__table">
          <thead>
            <tr>
              <th scope="col" className="v2-campaign-board__corner">Kênh</th>
              {CAMPAIGN_PHASES.map((phase) => (
                <th key={phase} scope="col" title={CAMPAIGN_PHASE_INFO[phase].question}>
                  <span className="v2-campaign-board__phase">{CAMPAIGN_PHASE_INFO[phase].label}</span>
                  <span className="v2-campaign-board__question">{CAMPAIGN_PHASE_INFO[phase].question}</span>
                  <span className="v2-campaign-board__count">{progress[phase].done}/{progress[phase].total}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {channels.map((channel) => (
              <tr key={channel}>
                <th scope="row">
                  <span className="v2-campaign-board__channel">{CAMPAIGN_CHANNEL_INFO[channel].label}</span>
                  <span className="v2-campaign-board__group">
                    {CAMPAIGN_CHANNEL_GROUP_LABELS[CAMPAIGN_CHANNEL_INFO[channel].group]}
                  </span>
                </th>
                {CAMPAIGN_PHASES.map((phase) => (
                  <td key={phase}>
                    <CampaignCellList
                      cells={cells.filter((item) => item.channel === channel && item.phase === phase)}
                      runs={runs}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CampaignCellList({ cells, runs }: { cells: CampaignCell[]; runs: CustomerRun[] }) {
  if (cells.length === 0) return <span className="v2-campaign-board__empty">—</span>;

  return (
    <ul className="v2-campaign-board__cells">
      {cells.map((item) => {
        const state = deriveCampaignCellStatus(item, runs);
        return (
          <li key={item.id} className={`v2-campaign-board__cell is-${state.status}`}>
            <span className={`v2-campaign-board__status is-${state.status}`}>{STATUS_LABELS[state.status]}</span>
            <span className="v2-campaign-board__tactic">{item.tactic}</span>
            {state.reason ? <span className="v2-campaign-board__reason">{state.reason}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

type CampaignPlanView = 'board' | 'sessions';

export interface CampaignPlanV2Props {
  onboardingChannels: CustomerChannel[];
  runs: CustomerRun[];
  cells?: CampaignCell[];
  sessions: ReactNode;
}

// Both views stay mounted so switching never resets the session list.
export function CampaignPlanV2({ onboardingChannels, runs, cells, sessions }: CampaignPlanV2Props) {
  const [view, setView] = useState<CampaignPlanView>('board');
  const board = resolveCampaignBoard(cells, onboardingChannels, runs);
  const toggle = (target: CampaignPlanView, label: string) => (
    <button
      type="button"
      className={`v2-tab${view === target ? ' is-active' : ''}`}
      aria-pressed={view === target}
      onClick={() => setView(target)}
    >
      {label}
    </button>
  );

  return (
    <div className="v2-campaign-plan">
      <div className="v2-tabs v2-campaign-plan__toggle">
        {toggle('board', 'Bảng kế hoạch')}
        {toggle('sessions', 'Danh sách phiên')}
      </div>
      <div hidden={view !== 'board'}>
        <CampaignBoardV2 {...board} runs={runs} />
      </div>
      <div hidden={view !== 'sessions'}>{sessions}</div>
    </div>
  );
}
