import {
  CAMPAIGN_CHANNELS,
  CAMPAIGN_PHASES,
  type CampaignCell,
  type CampaignLinkKind,
} from '../../../shared/customer-marketing-campaign-map';

export interface CampaignWire {
  from: string;
  to: string;
  /** The linked cell, the end of the wire that is not the focus. */
  cellId: string;
  kind: CampaignLinkKind;
  /** 1-based number shown on the wire and in the detail list. */
  order: number;
}

export const CAMPAIGN_LINK_KINDS: CampaignLinkKind[] = ['previous', 'next', 'data', 'loop'];

const LAST_PHASE_INDEX = CAMPAIGN_PHASES.length - 1;

// Arrows follow the work: the previous step feeds the focus, the focus feeds the next step and its
// measurement, and the post-purchase loop feeds the start of the journey.
function pointsIntoFocus(kind: CampaignLinkKind, focus: CampaignCell): boolean {
  if (kind === 'previous') return true;
  if (kind === 'loop') return CAMPAIGN_PHASES.indexOf(focus.phase) !== LAST_PHASE_INDEX;
  return false;
}

export function campaignWires(
  focus: CampaignCell,
  links: ReadonlyMap<string, CampaignLinkKind>,
  cells: CampaignCell[],
): CampaignWire[] {
  const byId = new Map(cells.map((cell) => [cell.id, cell]));
  const linked = [...links]
    .map(([id, kind]) => ({ cell: byId.get(id), kind }))
    .filter((item): item is { cell: CampaignCell; kind: CampaignLinkKind } => item.cell !== undefined);

  linked.sort(
    (a, b) =>
      CAMPAIGN_LINK_KINDS.indexOf(a.kind) - CAMPAIGN_LINK_KINDS.indexOf(b.kind) ||
      CAMPAIGN_PHASES.indexOf(a.cell.phase) - CAMPAIGN_PHASES.indexOf(b.cell.phase) ||
      CAMPAIGN_CHANNELS.indexOf(a.cell.channel) - CAMPAIGN_CHANNELS.indexOf(b.cell.channel),
  );

  return linked.map(({ cell, kind }, index) => {
    const isInbound = pointsIntoFocus(kind, focus);
    return {
      from: isInbound ? cell.id : focus.id,
      to: isInbound ? focus.id : cell.id,
      cellId: cell.id,
      kind,
      order: index + 1,
    };
  });
}

export interface WireBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface WirePath {
  d: string;
  labelX: number;
  labelY: number;
}

const MIN_BEND = 24;
const ARCH_HEIGHT = 40;
const ARCH_FLOOR = 4;

function bezier(p0: number[], p1: number[], p2: number[], p3: number[]): WirePath {
  const round = (value: number) => Math.round(value * 10) / 10;
  const point = (p: number[]) => `${round(p[0])} ${round(p[1])}`;
  return {
    d: `M ${point(p0)} C ${point(p1)}, ${point(p2)}, ${point(p3)}`,
    labelX: round((p0[0] + 3 * p1[0] + 3 * p2[0] + p3[0]) / 8),
    labelY: round((p0[1] + 3 * p1[1] + 3 * p2[1] + p3[1]) / 8),
  };
}

// Forward wires run right edge to left edge; backward wires arch over the top; wires inside one
// phase column bow out to the left so they do not cross the cells between them.
export function wirePath(from: WireBox, to: WireBox): WirePath {
  const fromRight = from.left + from.width;
  const toRight = to.left + to.width;
  const fromMidY = from.top + from.height / 2;
  const toMidY = to.top + to.height / 2;

  if (to.left >= fromRight) {
    const bend = Math.max((to.left - fromRight) / 2, MIN_BEND);
    return bezier([fromRight, fromMidY], [fromRight + bend, fromMidY], [to.left - bend, toMidY], [to.left, toMidY]);
  }
  if (toRight <= from.left) {
    const fromX = from.left + from.width / 2;
    const toX = to.left + to.width / 2;
    const archY = Math.max(Math.min(from.top, to.top) - ARCH_HEIGHT, ARCH_FLOOR);
    return bezier([fromX, from.top], [fromX, archY], [toX, archY], [toX, to.top]);
  }
  const bowX = Math.min(from.left, to.left) - MIN_BEND;
  return bezier([from.left, fromMidY], [bowX, fromMidY], [bowX, toMidY], [to.left, toMidY]);
}
