import { useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { CustomerChannel, CustomerRun } from '../../../shared/customer-marketing-types';
import {
  CAMPAIGN_CHANNELS,
  CAMPAIGN_CHANNEL_GROUP_LABELS,
  CAMPAIGN_CHANNEL_INFO,
  CAMPAIGN_PHASES,
  CAMPAIGN_PHASE_INFO,
  campaignFoundationWarning,
  currentCampaignCell,
  deriveCampaignCellStatus,
  isManualCampaignChannel,
  linkedCampaignCells,
  nextCampaignCell,
  parseCampaignEvidence,
  resolveCampaignBoard,
  unclassifiedCampaignRuns,
  upcomingSaleSeasons,
  type CampaignBoard,
  type CampaignCell,
  type CampaignCellStatus,
  type CampaignChannel,
  type CampaignChannelGroup,
  type CampaignLinkKind,
  type CampaignPhase,
  type UpcomingSale,
} from '../../../shared/customer-marketing-campaign-map';
import {
  CAMPAIGN_LINK_KINDS,
  campaignWires,
  wirePath,
  type CampaignWire,
  type WireBox,
} from './campaign-board-wires';

const STATUS_LABELS: Record<CampaignCellStatus, string> = {
  todo: 'Chưa làm',
  in_progress: 'Đang làm',
  awaiting_approval: 'Chờ duyệt',
  done: 'Đã xong',
  blocked: 'Bị chặn',
};

const RUN_STATUS_LABELS: Record<CustomerRun['status'], string> = {
  queued: 'Đang chờ',
  in_progress: 'Đang chạy',
  awaiting_approval: 'Chờ duyệt',
  ready: 'Sẵn sàng',
  completed: 'Hoàn tất',
  blocked: 'Bị chặn',
};

const LINK_LABELS: Record<CampaignLinkKind, string> = {
  previous: 'Bước trước',
  next: 'Bước sau',
  data: 'Đo lường',
  loop: 'Vòng lặp',
};

const PHASE_COLUMNS = CAMPAIGN_PHASES.length + 1;

export interface CampaignBoardV2Props extends CampaignBoard {
  runs: CustomerRun[];
  nextActions?: string[];
  initialSelectedCellId?: string;
  onMarkCellDone?: (cellId: string, evidence: string) => void;
  onAddChannel?: (channel: CampaignChannel) => void;
  today?: Date;
  /** The room is saving; lock inputs so a mark-done is not sent twice. */
  busy?: boolean;
}

export function CampaignBoardV2({
  channels,
  cells,
  progress,
  runs,
  nextActions,
  initialSelectedCellId,
  onMarkCellDone,
  onAddChannel,
  today,
  busy = false,
}: CampaignBoardV2Props) {
  const [selectedId, setSelectedId] = useState<string | undefined>(initialSelectedCellId);
  const [collapsed, setCollapsed] = useState<ReadonlySet<CampaignChannelGroup>>(new Set());
  const visibleCells = cells.filter((item) => channels.includes(item.channel));
  const selected = visibleCells.find((item) => item.id === selectedId);
  const links = selected ? linkedCampaignCells(selected, visibleCells) : new Map<string, CampaignLinkKind>();
  const current = currentCampaignCell(visibleCells, runs, channels);
  const wires = selected
    ? campaignWires(selected, links, visibleCells)
    : current
      ? campaignWires(current, sequenceLinks(linkedCampaignCells(current, visibleCells)), visibleCells)
      : [];
  const scrollRef = useRef<HTMLDivElement>(null);
  const done = CAMPAIGN_PHASES.reduce((sum, phase) => sum + progress[phase].done, 0);
  const total = CAMPAIGN_PHASES.reduce((sum, phase) => sum + progress[phase].total, 0);

  const toggleGroup = (group: CampaignChannelGroup) => {
    const next = new Set(collapsed);
    if (next.has(group)) next.delete(group);
    else next.add(group);
    setCollapsed(next);
  };
  const cellView: CellView = {
    runs,
    selectedId: selected?.id,
    currentId: current?.id,
    links,
    onSelect: (id) => setSelectedId(id === selected?.id ? undefined : id),
  };

  return (
    <section className="v2-campaign-board" aria-label="Bảng kế hoạch chiến dịch">
      <div className="v2-campaign-board__toolbar">
        <p className="v2-campaign-board__summary">Đã xong {done}/{total} việc</p>
        {onAddChannel ? <AddChannelPicker channels={channels} onAddChannel={onAddChannel} /> : null}
      </div>
      <NextWorkBanner next={nextCampaignCell(visibleCells, runs, channels)} nextActions={nextActions} />
      <FoundationWarning cells={campaignFoundationWarning(visibleCells, runs, channels)} />
      <SaleSeasonBanner sales={upcomingSaleSeasons(today ?? new Date())} />
      <WireLegend wires={wires} hasSelection={selected !== undefined} />
      <div className="v2-campaign-board__scroll" ref={scrollRef}>
        <table className="v2-campaign-board__table">
          <PhaseHeader progress={progress} />
          <tbody>
            {channelGroups(channels).map(({ group, members }) => (
              <ChannelGroupRows
                key={group}
                group={group}
                members={members}
                isCollapsed={collapsed.has(group)}
                onToggle={() => toggleGroup(group)}
                cells={visibleCells}
                view={cellView}
              />
            ))}
            <UnclassifiedRow runs={unclassifiedCampaignRuns(cells, runs)} />
          </tbody>
        </table>
        <CampaignWireLayer wires={wires} containerRef={scrollRef} />
      </div>
      {selected ? (
        <CampaignCellDetail
          key={selected.id}
          cell={selected}
          runs={runs}
          wires={wires}
          cells={visibleCells}
          onSelect={cellView.onSelect}
          onMarkCellDone={onMarkCellDone}
          busy={busy}
        />
      ) : null}
    </section>
  );
}

function channelGroups(channels: CampaignChannel[]): { group: CampaignChannelGroup; members: CampaignChannel[] }[] {
  const groups: { group: CampaignChannelGroup; members: CampaignChannel[] }[] = [];
  for (const channel of channels) {
    const group = CAMPAIGN_CHANNEL_INFO[channel].group;
    const last = groups[groups.length - 1];
    if (last?.group === group) last.members.push(channel);
    else groups.push({ group, members: [channel] });
  }
  return groups;
}

// With nothing selected the wires only trace the journey through the current step.
function sequenceLinks(links: Map<string, CampaignLinkKind>): Map<string, CampaignLinkKind> {
  return new Map([...links].filter(([, kind]) => kind === 'previous' || kind === 'next'));
}

function WireLegend({ wires, hasSelection }: { wires: CampaignWire[]; hasSelection: boolean }) {
  if (wires.length === 0) return null;
  const kinds = CAMPAIGN_LINK_KINDS.filter((kind) => wires.some((wire) => wire.kind === kind));
  return (
    <div className="v2-campaign-board__legend">
      <span>
        {hasSelection
          ? 'Các bước liên kết với ô đang chọn:'
          : 'Dây nối chỉ bước đang chạy. Bấm một ô để xem các bước liên kết.'}
      </span>
      {kinds.map((kind) => (
        <span key={kind} className={`v2-campaign-board__legend-item is-${kind}`}>
          {LINK_LABELS[kind]}
        </span>
      ))}
    </div>
  );
}

interface WireLayout {
  width: number;
  height: number;
  boxes: Map<string, WireBox>;
}

const EMPTY_WIRE_LAYOUT: WireLayout = { width: 0, height: 0, boxes: new Map() };

// Box of each cell relative to the scroll content, so the overlay scrolls with the table.
function measureCells(container: HTMLElement, ids: string[]): WireLayout {
  const table = container.querySelector('table');
  const origin = container.getBoundingClientRect();
  const boxes = new Map<string, WireBox>();
  for (const id of ids) {
    const cell = container.querySelector(`[data-cell-id="${CSS.escape(id)}"]`)?.closest('li');
    if (!cell) continue;
    const rect = cell.getBoundingClientRect();
    boxes.set(id, {
      left: rect.left - origin.left + container.scrollLeft - container.clientLeft,
      top: rect.top - origin.top + container.scrollTop - container.clientTop,
      width: rect.width,
      height: rect.height,
    });
  }
  return { width: table?.offsetWidth ?? 0, height: table?.offsetHeight ?? 0, boxes };
}

function CampaignWireLayer({
  wires,
  containerRef,
}: {
  wires: CampaignWire[];
  containerRef: RefObject<HTMLDivElement | null>;
}) {
  const markerPrefix = `wire${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [layout, setLayout] = useState<WireLayout>(EMPTY_WIRE_LAYOUT);
  const cellIds = [...new Set(wires.flatMap((wire) => [wire.from, wire.to]))].join('\n');

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || cellIds === '') return;
    const ids = cellIds.split('\n');
    const measure = () => setLayout(measureCells(container, ids));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    const table = container.querySelector('table');
    if (table) observer.observe(table);
    return () => observer.disconnect();
  }, [cellIds, containerRef]);

  if (wires.length === 0) return null;
  return (
    <svg
      className="v2-campaign-board__wires"
      width={layout.width}
      height={layout.height}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {CAMPAIGN_LINK_KINDS.map((kind) => (
          <marker
            key={kind}
            id={`${markerPrefix}-${kind}`}
            className={`v2-campaign-board__wire-arrow is-${kind}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
        ))}
      </defs>
      {wires.map((wire) => {
        const from = layout.boxes.get(wire.from);
        const to = layout.boxes.get(wire.to);
        if (!from || !to) return null;
        const path = wirePath(from, to);
        return (
          <g key={wire.cellId} className={`v2-campaign-board__wire is-${wire.kind}`}>
            <path className="v2-campaign-board__wire-line" d={path.d} markerEnd={`url(#${markerPrefix}-${wire.kind})`} />
            <circle className="v2-campaign-board__wire-badge" cx={path.labelX} cy={path.labelY} r={9} />
            <text className="v2-campaign-board__wire-number" x={path.labelX} y={path.labelY} textAnchor="middle" dominantBaseline="central">
              {wire.order}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function phasePercent({ done, total }: { done: number; total: number }): number {
  return total === 0 ? 0 : Math.round((done * 100) / total);
}

function PhaseHeader({ progress }: Pick<CampaignBoard, 'progress'>) {
  return (
    <thead>
      <tr>
        <th scope="col" className="v2-campaign-board__corner">Kênh</th>
        {CAMPAIGN_PHASES.map((phase) => {
          const percent = phasePercent(progress[phase]);
          return (
            <th key={phase} scope="col" title={CAMPAIGN_PHASE_INFO[phase].question}>
              <span className="v2-campaign-board__phase">{CAMPAIGN_PHASE_INFO[phase].label}</span>
              <span className="v2-campaign-board__question">{CAMPAIGN_PHASE_INFO[phase].question}</span>
              <span
                className="v2-campaign-board__progress"
                role="progressbar"
                aria-label={`Tiến độ ${CAMPAIGN_PHASE_INFO[phase].label}`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
              >
                <span className="v2-campaign-board__progress-fill" style={{ width: `${percent}%` }} />
              </span>
              <span className="v2-campaign-board__count">
                {progress[phase].done}/{progress[phase].total} · {percent}%
              </span>
            </th>
          );
        })}
      </tr>
    </thead>
  );
}

function cellPlace(cell: Pick<CampaignCell, 'phase' | 'channel'>): string {
  return `${CAMPAIGN_PHASE_INFO[cell.phase].label} · ${CAMPAIGN_CHANNEL_INFO[cell.channel].label}`;
}

function NextWorkBanner({ next, nextActions }: { next?: CampaignCell; nextActions?: string[] }) {
  const text = next ? `${cellPlace(next)} — ${next.tactic}` : nextActions?.find((action) => action.trim());
  if (!text) return null;
  return (
    <p className="v2-campaign-board__next">
      <strong>Việc tiếp theo:</strong> {text}
    </p>
  );
}

function FoundationWarning({ cells }: { cells: CampaignCell[] }) {
  if (cells.length === 0) return null;
  return (
    <p className="v2-campaign-board__warning" role="alert">
      Pha Nền móng chưa xong nhưng quảng cáo trả phí đã chạy: {cells.map(cellPlace).join('; ')}. Hoàn tất nền móng
      trước để không đốt ngân sách vào trang chưa sẵn sàng.
    </p>
  );
}

function SaleSeasonBanner({ sales }: { sales: UpcomingSale[] }) {
  if (sales.length === 0) return null;
  return (
    <div className="v2-campaign-board__sales">
      {sales.map((sale) => (
        <p key={sale.date} className="v2-campaign-board__sale">
          <strong>{sale.label} {sale.daysLeft === 0 ? 'là hôm nay' : `còn ${sale.daysLeft} ngày`}</strong> — nên đẩy{' '}
          {sale.focus.map((phase) => CAMPAIGN_PHASE_INFO[phase].label).join(', ')}.
        </p>
      ))}
    </div>
  );
}

function AddChannelPicker({
  channels,
  onAddChannel,
}: {
  channels: CampaignChannel[];
  onAddChannel: (channel: CampaignChannel) => void;
}) {
  const hidden = CAMPAIGN_CHANNELS.filter((channel) => !channels.includes(channel));
  if (hidden.length === 0) return null;
  return (
    <label className="v2-campaign-board__add">
      <span>+ thêm kênh</span>
      <select
        className="v2-campaign-board__add-select"
        value=""
        onChange={(event) => {
          const channel = hidden.find((item) => item === event.target.value);
          if (channel) onAddChannel(channel);
        }}
      >
        <option value="">Chọn kênh…</option>
        {hidden.map((channel) => (
          <option key={channel} value={channel}>
            {CAMPAIGN_CHANNEL_INFO[channel].label}
          </option>
        ))}
      </select>
    </label>
  );
}

interface CellView {
  runs: CustomerRun[];
  selectedId?: string;
  currentId?: string;
  links: Map<string, CampaignLinkKind>;
  onSelect: (cellId: string) => void;
}

function ChannelGroupRows({
  group,
  members,
  isCollapsed,
  onToggle,
  cells,
  view,
}: {
  group: CampaignChannelGroup;
  members: CampaignChannel[];
  isCollapsed: boolean;
  onToggle: () => void;
  cells: CampaignCell[];
  view: CellView;
}) {
  return (
    <>
      <tr className="v2-campaign-board__group-row">
        <th scope="rowgroup" colSpan={PHASE_COLUMNS}>
          <button type="button" className="v2-campaign-board__group" aria-expanded={!isCollapsed} onClick={onToggle}>
            {isCollapsed ? '▸' : '▾'} {CAMPAIGN_CHANNEL_GROUP_LABELS[group]}
          </button>
        </th>
      </tr>
      {isCollapsed
        ? null
        : members.map((channel) => (
          <tr key={channel}>
            <th scope="row">
              <span className="v2-campaign-board__channel">{CAMPAIGN_CHANNEL_INFO[channel].label}</span>
            </th>
            {CAMPAIGN_PHASES.map((phase) => (
              <td key={phase}>
                <CampaignCellList cells={cellsAt(cells, channel, phase)} view={view} />
              </td>
            ))}
          </tr>
        ))}
    </>
  );
}

function cellsAt(cells: CampaignCell[], channel: CampaignChannel, phase: CampaignPhase): CampaignCell[] {
  return cells.filter((item) => item.channel === channel && item.phase === phase);
}

function cellClassName(status: CampaignCellStatus, id: string, view: CellView): string {
  const classes = ['v2-campaign-board__cell', `is-${status}`];
  const link = view.links.get(id);
  if (id === view.currentId) classes.push('is-current');
  if (id === view.selectedId) classes.push('is-selected');
  else if (link) classes.push('is-linked', `is-linked-${link}`);
  else if (view.selectedId) classes.push('is-dimmed');
  return classes.join(' ');
}

function CampaignCellList({ cells, view }: { cells: CampaignCell[]; view: CellView }) {
  if (cells.length === 0) return <span className="v2-campaign-board__empty">—</span>;

  return (
    <ul className="v2-campaign-board__cells">
      {cells.map((item) => {
        const state = deriveCampaignCellStatus(item, view.runs);
        return (
          <li key={item.id} className={cellClassName(state.status, item.id, view)}>
            <button
              type="button"
              className="v2-campaign-board__cell-button"
              data-cell-id={item.id}
              aria-pressed={item.id === view.selectedId}
              onClick={() => view.onSelect(item.id)}
            >
              <span className={`v2-campaign-board__status is-${state.status}`}>{STATUS_LABELS[state.status]}</span>
              <span className="v2-campaign-board__tactic">{item.tactic}</span>
              {item.id === view.currentId ? <span className="v2-campaign-board__current">▶ Đang ở bước này</span> : null}
              {state.reason ? <span className="v2-campaign-board__reason">{state.reason}</span> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function RunList({ runs }: { runs: CustomerRun[] }) {
  return (
    <ul className="v2-campaign-board__runs">
      {runs.map((item) => (
        <li key={item.id}>
          <span className="v2-campaign-board__run-goal">{item.goal}</span>
          <span className="v2-campaign-board__run-status">{RUN_STATUS_LABELS[item.status]}</span>
        </li>
      ))}
    </ul>
  );
}

function UnclassifiedRow({ runs }: { runs: CustomerRun[] }) {
  if (runs.length === 0) return null;
  return (
    <tr className="v2-campaign-board__unclassified">
      <th scope="row">
        <span className="v2-campaign-board__channel">Chưa phân loại</span>
      </th>
      <td colSpan={CAMPAIGN_PHASES.length}>
        <RunList runs={runs} />
      </td>
    </tr>
  );
}

function CampaignCellDetail({
  cell,
  runs,
  wires,
  cells,
  onSelect,
  onMarkCellDone,
  busy,
}: {
  cell: CampaignCell;
  runs: CustomerRun[];
  wires: CampaignWire[];
  cells: CampaignCell[];
  onSelect: (cellId: string) => void;
  onMarkCellDone?: (cellId: string, evidence: string) => void;
  busy: boolean;
}) {
  const state = deriveCampaignCellStatus(cell, runs);
  const cellRuns = runs.filter((item) => cell.runIds.includes(item.id));
  const isManual = isManualCampaignChannel(cell.channel);

  return (
    <aside className="v2-campaign-board__detail" aria-label="Chi tiết việc">
      <h4 className="v2-campaign-board__detail-title">{cell.tactic}</h4>
      <p className="v2-campaign-board__detail-meta">
        {cellPlace(cell)} · {STATUS_LABELS[state.status]}
      </p>
      {cellRuns.length > 0 ? <RunList runs={cellRuns} /> : null}
      <LinkedCellList wires={wires} cells={cells} onSelect={onSelect} />
      {cell.manualCompletion ? (
        <p className="v2-campaign-board__evidence">Bằng chứng: {cell.manualCompletion.evidence}</p>
      ) : null}
      {isManual && state.status !== 'done' ? (
        <p className="v2-campaign-board__hint">
          Agent chỉ lập kế hoạch cho kênh này; bạn tự đánh dấu khi đã làm và ghi bằng chứng.
        </p>
      ) : null}
      {isManual && state.status !== 'done' && onMarkCellDone ? (
        <EvidenceForm busy={busy} onSubmit={(evidence) => onMarkCellDone(cell.id, evidence)} />
      ) : null}
    </aside>
  );
}

function LinkedCellList({
  wires,
  cells,
  onSelect,
}: {
  wires: CampaignWire[];
  cells: CampaignCell[];
  onSelect: (cellId: string) => void;
}) {
  const byId = new Map(cells.map((item) => [item.id, item]));
  const linked = wires.flatMap((wire) => {
    const item = byId.get(wire.cellId);
    return item ? [{ wire, item }] : [];
  });
  if (linked.length === 0) return null;

  return (
    <div className="v2-campaign-board__links">
      <p className="v2-campaign-board__links-title">Liên kết trong hệ thống</p>
      <ol className="v2-campaign-board__link-list">
        {linked.map(({ wire, item }) => (
          <li key={wire.cellId}>
            <button type="button" className={`v2-campaign-board__link is-${wire.kind}`} onClick={() => onSelect(item.id)}>
              <span className="v2-campaign-board__link-number">{wire.order}</span>
              <span className="v2-campaign-board__link-kind">{LINK_LABELS[wire.kind]}</span>
              <span className="v2-campaign-board__link-place">
                {cellPlace(item)} — {item.tactic}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

function EvidenceForm({ busy, onSubmit }: { busy: boolean; onSubmit: (evidence: string) => void }) {
  const [draft, setDraft] = useState('');
  const evidence = parseCampaignEvidence(draft);

  return (
    <div className="v2-campaign-board__evidence-form">
      <textarea
        className="v2-campaign-board__evidence-input"
        aria-label="Bằng chứng đã làm"
        placeholder="Ví dụ: link bài đăng, ảnh gian hàng, số hợp đồng biển quảng cáo…"
        maxLength={500}
        value={draft}
        disabled={busy}
        onChange={(event) => setDraft(event.target.value)}
      />
      <p className="v2-campaign-board__hint">Tối thiểu 3 ký tự, tối đa 500.</p>
      <button
        type="button"
        className="v2-button"
        disabled={busy || !evidence}
        onClick={() => evidence && onSubmit(evidence)}
      >
        Đã làm
      </button>
    </div>
  );
}

type CampaignPlanView = 'board' | 'sessions';

export interface CampaignPlanV2Props {
  onboardingChannels: CustomerChannel[];
  runs: CustomerRun[];
  cells?: CampaignCell[];
  extraChannels?: CampaignChannel[];
  nextActions?: string[];
  onMarkCellDone?: (cellId: string, evidence: string) => void;
  onAddChannel?: (channel: CampaignChannel) => void;
  today?: Date;
  busy?: boolean;
  sessions: ReactNode;
}

// Both views stay mounted so switching never resets the session list.
export function CampaignPlanV2({
  onboardingChannels,
  runs,
  cells,
  extraChannels,
  nextActions,
  onMarkCellDone,
  onAddChannel,
  today,
  busy,
  sessions,
}: CampaignPlanV2Props) {
  const [view, setView] = useState<CampaignPlanView>('board');
  const board = resolveCampaignBoard(cells, onboardingChannels, runs, undefined, extraChannels);
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
        <CampaignBoardV2
          {...board}
          runs={runs}
          nextActions={nextActions}
          onMarkCellDone={onMarkCellDone}
          onAddChannel={onAddChannel}
          today={today}
          busy={busy}
        />
      </div>
      <div hidden={view !== 'sessions'}>{sessions}</div>
    </div>
  );
}
