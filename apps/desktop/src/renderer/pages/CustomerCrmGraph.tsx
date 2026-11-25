import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d';
import { colorWithAlpha, drawGraphViewCanvasField, mixTagColors } from '@kentzu213/graph-view';
import type { CustomerCareCrmAssignee, CustomerCareCrmRow } from '../../shared/customer-care-types';
import { CRM_STAGE_OPTIONS, type CrmProductOption } from './customer-crm-flow';
import {
  CRM_GRAPH_KIND_COLORS,
  CRM_GRAPH_KIND_LABELS,
  CRM_NO_SELECTION,
  CRM_STAGE_COLORS,
  crmGraphReuse,
  crmGraphSearch,
  crmSelectedRow,
  crmSelectionOnClick,
  crmSelectionOnClose,
  crmSelectionOnSearch,
  type CrmGraphEntry,
  type CrmGraphLink,
  type CrmGraphNode,
  type CrmGraphRow,
} from './customer-crm-graph';
import { CustomerCrmCard } from './CustomerCrmCard';
import type { CrmIdentityHandlers } from './CustomerCrmIdentity';

export interface CustomerCrmGraphProps {
  /** The rows the table holds (stage filter applied). The graph never loads or stores anything itself. */
  rows: readonly CustomerCareCrmRow[];
  products: readonly CrmProductOption[];
  assignees: readonly CustomerCareCrmAssignee[];
  nowMs: number;
  onCopy: (row: CustomerCareCrmRow) => void;
  onOpenProfile: (leadId: string) => void;
  /** Care CRM S3 staff actions on the card's identity; absent shows it read-only. */
  identityHandlers?: CrmIdentityHandlers | null;
  /** Owner or manager with the purge available. */
  canDelete?: boolean;
  /** The existing purge, for a customer's erase request. */
  onPurge?: (row: CustomerCareCrmRow) => void;
  renderExtraCard?: (row: CrmGraphRow) => ReactNode;
}

/** The engine adds positions and speeds to these copies; pill sizes are kept for hit-testing. */
type GraphNode = CrmGraphNode & { x?: number; y?: number; vx?: number; vy?: number; pillW?: number; pillH?: number };
type GraphLink = Omit<CrmGraphLink, 'source' | 'target'> & { source: string | GraphNode; target: string | GraphNode };

const FIT_PADDING = 48;
const FIT_MS = 400;
const CENTER_MS = 500;
const SEARCH_ZOOM = 2.4;
const CHARGE_STRENGTH = -260;
const CHARGE_RANGE = 600;
const LINK_DISTANCE = 80;
/** Below this zoom a customer is drawn as a dot so 500 names do not pile up. */
const LABEL_MIN_SCALE = 0.7;
const TEXT_COLOR = 'rgba(246, 250, 255, 0.94)';
const SELECTED_STROKE = 'rgba(35, 232, 255, 0.86)';
const KIND_ORDER = ['product', 'occasion', 'owner', 'ad', 'persona', 'interest'] as const;

function endpointId(endpoint: string | GraphNode): string {
  return typeof endpoint === 'string' ? endpoint : endpoint.id;
}

function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : text;
}

/**
 * MyGraph → CRM → "Sơ đồ": customers and what links them (stage, products, occasion, owner and, once rows carry
 * identity, persona, source ad and shared-link domains), drawn in the Memory graph's style. Clicking a customer
 * opens the card: the staff profile read-only, the AI identity with its staff actions.
 */
export default function CustomerCrmGraph({
  rows, products, assignees, nowMs, onCopy, onOpenProfile, identityHandlers = null, canDelete = false, onPurge, renderExtraCard,
}: CustomerCrmGraphProps) {
  // A refresh that changed nothing the graph is drawn from keeps the same graph object, so the layout does not
  // restart; the 60 s tick hands over new row arrays every time.
  const lastGraphRef = useRef<CrmGraphEntry | null>(null);
  const entry = useMemo(() => crmGraphReuse(lastGraphRef.current, rows, products, assignees), [rows, products, assignees]);
  useEffect(() => {
    lastGraphRef.current = entry;
  }, [entry]);
  const { graph } = entry;
  const [selection, setSelection] = useState(CRM_NO_SELECTION);
  const selectedId = selection.nodeId;
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [size, setSize] = useState({ width: 0, height: 0 });
  const stageRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const cardRef = useRef<HTMLElement | null>(null);
  const graphRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined);
  const lastDataRef = useRef<{ nodes: GraphNode[]; links: GraphLink[] } | null>(null);
  const fittedRef = useRef(false);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    const update = () => setSize({ width: stage.clientWidth, height: stage.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  // Copies for the engine. A node that was already on screen keeps its place, so a refresh does not reshuffle.
  const graphData = useMemo(() => {
    const previous = new Map((lastDataRef.current?.nodes ?? []).map((node) => [node.id, node]));
    return {
      nodes: graph.nodes.map((node): GraphNode => {
        const old = previous.get(node.id);
        return old ? { ...node, x: old.x, y: old.y, vx: old.vx, vy: old.vy } : { ...node };
      }),
      links: graph.links.map((link): GraphLink => ({ ...link })),
    };
  }, [graph]);

  useEffect(() => {
    lastDataRef.current = graphData;
  }, [graphData]);

  const ready = size.width > 0 && size.height > 0;
  useEffect(() => {
    const engine = graphRef.current;
    if (!ready || !engine) return;
    // Pills are wide, so nodes push apart harder than the engine's default; customers sit around their hubs.
    // Set once: the engine keeps its forces when the rows refresh.
    engine.d3Force('charge')?.strength(CHARGE_STRENGTH).distanceMax(CHARGE_RANGE);
    engine.d3Force('link')?.distance(LINK_DISTANCE);
    engine.d3ReheatSimulation();
  }, [ready]);

  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const add = (from: string, to: string) => {
      const set = map.get(from) ?? new Set<string>();
      set.add(to);
      map.set(from, set);
    };
    for (const link of graph.links) {
      add(link.source, link.target);
      add(link.target, link.source);
    }
    return map;
  }, [graph]);
  const colors = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node.color])), [graph]);

  const selectedNode = graph.nodes.find((node) => node.id === selectedId) ?? null;
  const selectedRow = crmSelectedRow(rows, selectedNode?.kind === 'customer' ? selectedNode.leadId ?? null : null);
  const focusId = hoveredId ?? selectedNode?.id ?? null;
  const focus = useMemo(
    () => (focusId === null ? null : new Set([focusId, ...(neighbors.get(focusId) ?? [])])),
    [focusId, neighbors],
  );

  // The card takes focus when a customer is chosen (node click or search), so it can be read and closed by keyboard.
  const selectedLeadId = selectedRow?.leadId ?? null;
  useEffect(() => {
    if (selectedLeadId !== null) cardRef.current?.focus({ preventScroll: true });
  }, [selectedLeadId]);

  const results = useMemo(() => crmGraphSearch(graph, query), [graph, query]);

  const chooseFromSearch = (node: CrmGraphNode) => {
    setSelection(crmSelectionOnSearch(node.id));
    const placed = graphData.nodes.find((item) => item.id === node.id);
    if (placed?.x !== undefined && placed.y !== undefined) {
      graphRef.current?.centerAt(placed.x, placed.y, CENTER_MS);
      graphRef.current?.zoom(SEARCH_ZOOM, CENTER_MS);
    }
  };

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && results.length > 0) {
      event.preventDefault();
      chooseFromSearch(results[0]);
    }
  };

  /** Escape or ✕: the card closes and focus goes back to the search box or the canvas it was opened from. */
  const closeCard = () => {
    const { next, focus: target } = crmSelectionOnClose(selection);
    setSelection(next);
    if (target === 'search') searchRef.current?.focus();
    else if (target === 'stage') stageRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && selectedId !== null) {
      event.stopPropagation();
      closeCard();
    }
  };

  const drawNode = useCallback((node: GraphNode, ctx: CanvasRenderingContext2D, scale: number) => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const hub = node.kind !== 'customer';
    const selected = node.id === selectedId;
    const active = selected || node.id === hoveredId;
    const dimmed = focus !== null && !focus.has(node.id);
    ctx.save();
    ctx.globalAlpha = dimmed ? 0.16 : 1;
    if (!hub && !active && scale < LABEL_MIN_SCALE) {
      const radius = 3.2 / scale;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = colorWithAlpha(node.color, 0.9);
      ctx.fill();
      node.pillW = radius * 2;
      node.pillH = radius * 2;
      ctx.restore();
      return;
    }
    const text = hub ? `${truncate(node.label, 26)} · ${node.degree}` : truncate(node.label, 22);
    const fontSize = (hub ? 12 : 10.5) / scale;
    ctx.font = `${hub ? 700 : 600} ${fontSize}px 'Inter', sans-serif`;
    const padX = 7 / scale;
    const dotSpace = 10 / scale;
    const width = ctx.measureText(text).width + padX * 2 + dotSpace;
    const height = (hub ? 21 : 17) / scale;
    node.pillW = width;
    node.pillH = height;
    const left = x - width / 2;
    const shell = ctx.createLinearGradient(left, y - height / 2, x + width / 2, y + height / 2);
    shell.addColorStop(0, colorWithAlpha(node.color, active ? 0.52 : 0.38));
    shell.addColorStop(0.18, colorWithAlpha(node.color, active ? 0.32 : 0.22));
    shell.addColorStop(0.55, 'rgba(9, 16, 23, 0.95)');
    shell.addColorStop(1, 'rgba(2, 6, 10, 0.96)');
    ctx.shadowColor = colorWithAlpha(node.color, active ? 0.56 : 0.34);
    ctx.shadowBlur = (active ? 22 : 13) / scale;
    ctx.beginPath();
    ctx.roundRect(left, y - height / 2, width, height, height / 2);
    ctx.fillStyle = shell;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = selected ? SELECTED_STROKE : active ? 'rgba(246, 255, 255, 0.52)' : colorWithAlpha(node.color, hub ? 0.72 : 0.48);
    ctx.lineWidth = (selected ? 1.4 : hub ? 1.15 : 0.85) / scale;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(left + padX + 2 / scale, y, (hub ? 3.2 : 2.4) / scale, 0, 2 * Math.PI);
    ctx.fillStyle = colorWithAlpha(node.color, 0.92);
    ctx.fill();
    ctx.fillStyle = TEXT_COLOR;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, left + padX + dotSpace, y + 0.3 / scale);
    ctx.restore();
  }, [focus, hoveredId, selectedId]);

  const paintPointerArea = useCallback((node: GraphNode, paint: string, ctx: CanvasRenderingContext2D, scale: number) => {
    const width = node.pillW ?? 24 / scale;
    const height = node.pillH ?? 16 / scale;
    ctx.fillStyle = paint;
    ctx.fillRect((node.x ?? 0) - width / 2, (node.y ?? 0) - height / 2, width, height);
  }, []);

  const linkColor = useCallback((link: GraphLink) => {
    const source = endpointId(link.source);
    const target = endpointId(link.target);
    const mixed = mixTagColors(colors.get(source) ?? '#22dcc2', colors.get(target) ?? '#22dcc2', 0.5);
    if (focus === null) return colorWithAlpha(mixed, 0.3);
    return focus.has(source) && focus.has(target) ? colorWithAlpha(mixed, 0.82) : colorWithAlpha(mixed, 0.05);
  }, [colors, focus]);

  const linkWidth = useCallback((link: GraphLink) => (
    focus !== null && focus.has(endpointId(link.source)) && focus.has(endpointId(link.target)) ? 1.9 : 0.8
  ), [focus]);

  const drawField = useCallback((ctx: CanvasRenderingContext2D) => {
    const ratio = window.devicePixelRatio || 1;
    ctx.save();
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawGraphViewCanvasField(ctx, size.width, size.height);
    ctx.restore();
  }, [size.width, size.height]);

  const fitOnce = useCallback(() => {
    if (fittedRef.current) return;
    fittedRef.current = true;
    graphRef.current?.zoomToFit(FIT_MS, FIT_PADDING);
  }, []);

  const stagesShown = CRM_STAGE_OPTIONS.filter((option) => graph.nodes.some((node) => node.id === `stage:${option.value}`));
  const kindsShown = KIND_ORDER.filter((kind) => graph.nodes.some((node) => node.kind === kind));
  const customerCount = graph.nodes.filter((node) => node.kind === 'customer').length;

  return (
    <div className="v2-crm-graph" onKeyDown={onKeyDown}>
      <div
        className="v2-crm-graph__stage"
        ref={stageRef}
        role="group"
        aria-label="Sơ đồ CRM"
        aria-describedby="v2-crm-graph-summary"
        tabIndex={-1}
      >
        <p id="v2-crm-graph-summary" className="v2-visually-hidden">
          {`Sơ đồ có ${customerCount} khách. Bấm vào một khách để mở thẻ, hoặc tìm khách bằng ô Tìm khách. Chế độ Bảng có đủ mọi thông tin.`}
        </p>
        {ready && (
          <ForceGraph2D<GraphNode, GraphLink>
            ref={graphRef}
            graphData={graphData}
            width={size.width}
            height={size.height}
            backgroundColor="rgba(0,0,0,0)"
            nodeLabel={() => ''}
            linkLabel={() => ''}
            nodeCanvasObject={drawNode}
            nodePointerAreaPaint={paintPointerArea}
            linkColor={linkColor}
            linkWidth={linkWidth}
            onRenderFramePre={drawField}
            onNodeClick={(node) => setSelection((current) => crmSelectionOnClick(current, node))}
            onNodeHover={(node) => setHoveredId(node?.id ?? null)}
            onBackgroundClick={() => setSelection(CRM_NO_SELECTION)}
            cooldownTicks={200}
            warmupTicks={30}
            d3VelocityDecay={0.3}
            minZoom={0.3}
            maxZoom={4}
            onEngineStop={fitOnce}
          />
        )}

        <div className="v2-crm-graph__search">
          <label className="v2-visually-hidden" htmlFor="v2-crm-graph-search">Tìm khách trên sơ đồ</label>
          <input
            id="v2-crm-graph-search"
            ref={searchRef}
            className="v2-field__input"
            type="search"
            placeholder="Tìm khách…"
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={onSearchKey}
          />
          {query.trim() !== '' && (
            <ul className="v2-crm-graph__results" aria-label="Khách tìm thấy">
              {results.length === 0 ? <li className="v2-crm__meta">Không thấy khách nào.</li> : results.map((node) => (
                <li key={node.id}>
                  <button type="button" onClick={() => chooseFromSearch(node)}>
                    <span className="v2-crm-card__dot" style={{ background: node.color }} aria-hidden="true" />
                    {node.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <button
          type="button"
          className="v2-button v2-button--ghost v2-crm-graph__fit"
          onClick={() => graphRef.current?.zoomToFit(FIT_MS, FIT_PADDING)}
        >
          Vừa khung
        </button>

        <ul className="v2-crm-graph__legend" aria-label="Chú giải">
          {stagesShown.map((option) => (
            <li key={option.value}>
              <span className="v2-crm-card__dot" style={{ background: CRM_STAGE_COLORS[option.value] }} aria-hidden="true" />
              {option.label}
            </li>
          ))}
          {kindsShown.map((kind) => (
            <li key={kind}>
              <span className="v2-crm-card__dot is-hub" style={{ background: CRM_GRAPH_KIND_COLORS[kind] }} aria-hidden="true" />
              {CRM_GRAPH_KIND_LABELS[kind]}
            </li>
          ))}
        </ul>
      </div>

      {selectedRow ? (
        <CustomerCrmCard
          // A card per customer: its identity state (the version it opened with) never carries over to another.
          key={selectedRow.leadId}
          cardRef={cardRef}
          row={selectedRow}
          nowMs={nowMs}
          assignees={assignees}
          products={products}
          extraSection={renderExtraCard ? renderExtraCard(selectedRow) : undefined}
          onCopy={() => onCopy(selectedRow)}
          onOpenProfile={() => onOpenProfile(selectedRow.leadId)}
          onClose={closeCard}
          identityHandlers={identityHandlers}
          canDelete={canDelete}
          onPurge={onPurge ? () => onPurge(selectedRow) : undefined}
        />
      ) : (
        <p className="v2-crm-graph__hint v2-crm__hint">Bấm vào một khách trên sơ đồ để xem thẻ nhận diện.</p>
      )}
    </div>
  );
}
