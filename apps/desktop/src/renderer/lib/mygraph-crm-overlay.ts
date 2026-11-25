/**
 * In-memory MyGraph CRM Overlay (`crm-virtual:*`).
 *
 * Loads CRM leads strictly into RAM (when the signed-in user has owner/manager/editor CRM access)
 * and overlays virtual Hub/Page/Saler/Persona/Lead nodes onto `GraphApi` reads & searches.
 *
 * Security invariants:
 *   - 0% PII ever leaves RAM to Cloud `user_nodes`, local SQLite, Web Storage, or `graphAgent`.
 *   - Virtual node titles mask phone prefix/middle digits (`Name · •••789`); full phone shows
 *     only inside node detail `content` in RAM.
 *   - Persona links (`P1`–`P4`) are attached only when `identity.consent.state === 'granted'`.
 *   - `updateNode('crm-virtual:...', patch)` allows ONLY `{ x, y }` in RAM; mutating any content,
 *     title, url or metadata, or calling `removeNode`/`createLink`/`updateLink`/`removeLink` on
 *     `crm-virtual:*` fails closed without calling IPC.
 *   - Cache is cleared immediately on workspace switch, role downgrade, sign-out, or
 *     `CRM_BACKFILL_UPDATED_EVENT`.
 *
 * @module renderer/lib/mygraph-crm-overlay
 */
import type { GraphApi, SearchHit, UserLink, UserNode } from '@kentzu213/graph-view';
import {
  CUSTOMER_CARE_CRM_ROLES,
  type CustomerCareCrmListInput,
  type CustomerCareCrmListResult,
  type CustomerCareCrmPageSource,
  type CustomerCareCrmRow,
  type CustomerCareCrmSalerMember,
  type CustomerCareCrmStage,
  type CustomerCareSnapshot,
} from '../../shared/customer-care-types';
import { CRM_CARE_STEP_META, resolveEffectiveCareStep } from '../../shared/customer-crm-saler-routing';
import { CRM_BACKFILL_UPDATED_EVENT } from '../pages/customer-care-page-flow';
import { CRM_MAX_PAGES } from '../pages/customer-crm-flow';

export const CRM_VIRTUAL_PREFIX = 'crm-virtual:';
export const CRM_VIRTUAL_HUB_ID = 'crm-virtual:hub';
export const CRM_VIRTUAL_PAGE_PREFIX = 'crm-virtual:page:';
export const CRM_VIRTUAL_SALER_PREFIX = 'crm-virtual:saler:';
export const CRM_VIRTUAL_PERSONA_PREFIX = 'crm-virtual:persona:';
export const CRM_VIRTUAL_LEAD_PREFIX = 'crm-virtual:lead:';
export const CRM_VIRTUAL_LINK_PREFIX = 'crm-virtual:link:';

const CACHE_TTL_MS = 15_000;
export const MAX_CANVAS_LEAD_NODES = 240;
const READONLY_ERROR = 'Node CRM chỉ đọc trong RAM — không thể sửa đổi hoặc đồng bộ lên Cloud.';

const STAGE_LABELS: Record<CustomerCareCrmStage, string> = {
  has_phone: 'Có số',
  consulting: 'Đang tư vấn',
  deposit: 'Đã cọc',
  delivered: 'Đã giao',
  lost: 'Không mua',
  do_not_contact: 'Không liên hệ',
};

const STAGE_COLORS: Record<CustomerCareCrmStage, string> = {
  has_phone: '#5ca7ff',
  consulting: '#25d7c1',
  deposit: '#39d98a',
  delivered: '#39d98a',
  lost: '#ff6b72',
  do_not_contact: '#ff6b72',
};

export interface OverlayElectronApi {
  auth?: {
    getUser?: () => Promise<unknown>;
  };
  customerCare?: {
    listCrm?: (input: CustomerCareCrmListInput) => Promise<CustomerCareCrmListResult>;
    getSnapshot?: () => Promise<CustomerCareSnapshot>;
  };
}

export interface MyGraphCrmOverlayOptions {
  getElectronApi?: () => OverlayElectronApi | null | undefined;
  now?: () => number;
}

export type MyGraphWithCrmApi = GraphApi & {
  invalidateCrmOverlay(): void;
  dispose(): void;
};

interface CrmOverlayDataset {
  identityId: string | null;
  workspaceId: string;
  loadedAt: number;
  nodes: UserNode[];
  links: UserLink[];
  searchEntries: Array<{
    node: UserNode;
    searchText: string;
    phoneDigits: string;
    phoneLast4: string;
    snippet: string;
  }>;
}

export function isVirtualCrmId(id: unknown): boolean {
  return typeof id === 'string' && id.startsWith(CRM_VIRTUAL_PREFIX);
}

function slugTag(prefix: string, raw: string): string {
  const normalized = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return normalized ? `${prefix}-${normalized}` : prefix;
}

function normalizeSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizePhoneDigits(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('84') && digits.length >= 10 && digits.length <= 12) {
    return `0${digits.slice(2)}`;
  }
  return digits;
}

function selectBalancedCanvasRows(rows: readonly CustomerCareCrmRow[], cap: number): CustomerCareCrmRow[] {
  if (rows.length <= cap) return [...rows];
  const byPage = new Map<string, CustomerCareCrmRow[]>();
  for (const r of rows) {
    const bucket = byPage.get(r.pageId);
    if (bucket) bucket.push(r);
    else byPage.set(r.pageId, [r]);
  }
  for (const bucket of byPage.values()) {
    bucket.sort((a, b) => Date.parse(b.lastMessageAt || b.phoneCapturedAt) - Date.parse(a.lastMessageAt || a.phoneCapturedAt));
  }
  const pageQueues = [...byPage.values()];
  const selected: CustomerCareCrmRow[] = [];
  let cursor = 0;
  while (selected.length < cap) {
    let pushedAny = false;
    for (const q of pageQueues) {
      if (cursor < q.length) {
        selected.push(q[cursor]!);
        pushedAny = true;
        if (selected.length >= cap) break;
      }
    }
    if (!pushedAny) break;
    cursor += 1;
  }
  return selected;
}

function formatMaskedLeadTitle(row: CustomerCareCrmRow): string {
  const name = row.customerName?.trim() || 'Khách FB';
  const tail = row.phone.slice(-3);
  return `${name} · •••${tail}`;
}

function formatTimeVn(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return 'Chưa rõ';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function isPositionOnlyPatch(patch: Record<string, unknown>): { ok: true; x?: number; y?: number } | { ok: false } {
  const keys = Object.keys(patch);
  if (keys.length === 0 || keys.some((key) => key !== 'x' && key !== 'y')) {
    return { ok: false };
  }
  const result: { ok: true; x?: number; y?: number } = { ok: true };
  if ('x' in patch) {
    if (typeof patch.x !== 'number' || !Number.isFinite(patch.x)) return { ok: false };
    result.x = patch.x;
  }
  if ('y' in patch) {
    if (typeof patch.y !== 'number' || !Number.isFinite(patch.y)) return { ok: false };
    result.y = patch.y;
  }
  return result;
}

function annotateCareCloudNode(node: UserNode): UserNode {
  if (!node.url?.includes('?care=')) return node;
  try {
    const parsed = node.metadata ? (typeof node.metadata === 'string' ? JSON.parse(node.metadata) : node.metadata) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return node;
    const currentTags = Array.isArray((parsed as { tags?: unknown }).tags)
      ? ((parsed as { tags: unknown[] }).tags.filter((t): t is string => typeof t === 'string'))
      : [];
    const nextTags = Array.from(new Set([...currentTags, 'crm-tong-hop', 'cham-soc-khach']));
    return {
      ...node,
      metadata: JSON.stringify({ ...parsed, tags: nextTags }),
    };
  } catch {
    return node;
  }
}

function buildOverlayDataset(params: {
  identityId: string | null;
  workspaceId: string;
  loadedAt: number;
  rows: CustomerCareCrmRow[];
  pages: CustomerCareCrmPageSource[];
  salers: CustomerCareCrmSalerMember[];
  positions: ReadonlyMap<string, { x?: number; y?: number }>;
}): CrmOverlayDataset {
  const { identityId, workspaceId, loadedAt, rows, pages, salers, positions } = params;
  const nowIso = new Date(loadedAt).toISOString();
  const pageNameMap = new Map<string, string>();
  for (const page of pages) {
    if (page.pageName?.trim()) pageNameMap.set(page.pageId, page.pageName.trim());
  }
  const resolvePageName = (pageId: string) => pageNameMap.get(pageId) ?? `Page ${pageId.slice(-6)}`;

  const distinctPageIds = Array.from(new Set(rows.map((r) => r.pageId)));
  const salerMap = new Map(salers.map((s) => [s.id, s]));
  const pageCounts = new Map<string, number>();
  const salerCounts = new Map<string, number>();
  const usedPersonas = new Set<string>();
  for (const row of rows) {
    pageCounts.set(row.pageId, (pageCounts.get(row.pageId) ?? 0) + 1);
    if (row.profile.salerId && salerMap.has(row.profile.salerId)) {
      salerCounts.set(row.profile.salerId, (salerCounts.get(row.profile.salerId) ?? 0) + 1);
    }
    if (row.identity?.consent?.state === 'granted' && row.identity.persona?.value) {
      usedPersonas.add(row.identity.persona.value);
    }
  }
  const canvasRows = selectBalancedCanvasRows(rows, MAX_CANVAS_LEAD_NODES);
  const canvasLeadIds = new Set(canvasRows.map((r) => r.leadId));

  const nodes: UserNode[] = [];
  const links: UserLink[] = [];
  const searchEntries: CrmOverlayDataset['searchEntries'] = [];

  if (rows.length === 0) {
    return { identityId, workspaceId, loadedAt, nodes, links, searchEntries };
  }

  const withPos = (node: UserNode): UserNode => {
    const pos = positions.get(node.id);
    return pos ? { ...node, ...(pos.x !== undefined ? { x: pos.x } : {}), ...(pos.y !== undefined ? { y: pos.y } : {}) } : node;
  };

  const hubLines = [
    `Tổng hợp ${rows.length} khách để lại số từ ${distinctPageIds.length} Page.`,
    ...(rows.length > canvasRows.length
      ? [`Đang hiển thị ${canvasRows.length}/${rows.length} khách gần nhất (cân bằng theo Page) trên đồ thị; bấm Tìm kiếm để tra 100% khách.`]
      : []),
    'Dữ liệu SĐT và hội thoại chỉ nằm trong RAM trên máy bạn (0% đẩy lên Cloud user_nodes).',
    'Bấm vào từng node khách để xem SĐT đầy đủ, bước chăm sóc, Saler phụ trách và tin nhắn gần nhất.',
  ];

  const hubNode = withPos({
    id: CRM_VIRTUAL_HUB_ID,
    title: `Kho Data Khách Hàng (${rows.length} SĐT · ${distinctPageIds.length} Page)`,
    nodeType: 'topic',
    content: hubLines.join('\n'),
    color: '#18c7b5',
    metadata: JSON.stringify({ tags: ['data-khach-hang', 'sdt-khach'], virtualCrm: true }),
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  nodes.push(hubNode);
  searchEntries.push({
    node: hubNode,
    searchText: normalizeSearch(hubNode.title),
    phoneDigits: '',
    phoneLast4: '',
    snippet: `${rows.length} SĐT · ${distinctPageIds.length} Page`,
  });

  for (const pageId of distinctPageIds) {
    const pageName = resolvePageName(pageId);
    const pageNodeId = `${CRM_VIRTUAL_PAGE_PREFIX}${pageId}`;
    const pageTag = slugTag('page', pageName);
    const countForPage = pageCounts.get(pageId) ?? 0;
    const pageNode = withPos({
      id: pageNodeId,
      title: pageName,
      nodeType: 'topic',
      content: `Page nguồn: ${pageName}\nSố khách để lại SĐT: ${countForPage}`,
      color: '#38d6ff',
      parentId: CRM_VIRTUAL_HUB_ID,
      metadata: JSON.stringify({ tags: ['data-khach-hang', 'sdt-khach', pageTag], virtualCrm: true }),
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    nodes.push(pageNode);
    links.push({
      id: `${CRM_VIRTUAL_LINK_PREFIX}hub-page-${pageId}`,
      sourceId: CRM_VIRTUAL_HUB_ID,
      targetId: pageNodeId,
      label: 'Page',
      color: '#38d6ff',
    });
    searchEntries.push({
      node: pageNode,
      searchText: normalizeSearch(`${pageName} ${pageId}`),
      phoneDigits: '',
      phoneLast4: '',
      snippet: `${countForPage} SĐT từ Page ${pageName}`,
    });
  }

  for (const [salerId, countForSaler] of salerCounts.entries()) {
    const saler = salerMap.get(salerId)!;
    const salerNodeId = `${CRM_VIRTUAL_SALER_PREFIX}${saler.id}`;
    const salerTag = slugTag('saler', saler.name);
    const salerNode = withPos({
      id: salerNodeId,
      title: `Saler: ${saler.name}`,
      nodeType: 'topic',
      content: `Nhân sự Saler: ${saler.name}\nĐang phụ trách: ${countForSaler} khách`,
      color: '#f0b75f',
      parentId: CRM_VIRTUAL_HUB_ID,
      metadata: JSON.stringify({ tags: ['data-khach-hang', 'sdt-khach', salerTag], virtualCrm: true }),
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    nodes.push(salerNode);
    links.push({
      id: `${CRM_VIRTUAL_LINK_PREFIX}hub-saler-${saler.id}`,
      sourceId: CRM_VIRTUAL_HUB_ID,
      targetId: salerNodeId,
      label: 'Saler',
      color: '#f0b75f',
    });
    searchEntries.push({
      node: salerNode,
      searchText: normalizeSearch(`Saler ${saler.name}`),
      phoneDigits: '',
      phoneLast4: '',
      snippet: `Phụ trách ${countForSaler} khách`,
    });
  }

  for (const persona of usedPersonas) {
    const personaNodeId = `${CRM_VIRTUAL_PERSONA_PREFIX}${persona}`;
    const personaNode = withPos({
      id: personaNodeId,
      title: `Chân dung ${persona}`,
      nodeType: 'topic',
      content: `Nhóm chân dung khách hàng ${persona} (chỉ liên kết khách đã đồng ý).`,
      color: '#a77cff',
      parentId: CRM_VIRTUAL_HUB_ID,
      metadata: JSON.stringify({
        tags: ['data-khach-hang', 'sdt-khach', `persona-${persona.toLowerCase()}`],
        virtualCrm: true,
      }),
      createdAt: nowIso,
      updatedAt: nowIso,
    });
    nodes.push(personaNode);
    links.push({
      id: `${CRM_VIRTUAL_LINK_PREFIX}hub-persona-${persona}`,
      sourceId: CRM_VIRTUAL_HUB_ID,
      targetId: personaNodeId,
      label: 'Persona',
      color: '#a77cff',
    });
    searchEntries.push({
      node: personaNode,
      searchText: normalizeSearch(`Chan dung ${persona} ${persona}`),
      phoneDigits: '',
      phoneLast4: '',
      snippet: `Nhóm chân dung ${persona}`,
    });
  }

  for (const row of rows) {
    const pageName = resolvePageName(row.pageId);
    const pageTag = slugTag('page', pageName);
    const step = resolveEffectiveCareStep(row);
    const stepLabel = CRM_CARE_STEP_META[step].label;
    const stepTag = slugTag('buoc', stepLabel);
    const stageLabel = STAGE_LABELS[row.profile.stage];
    const saler = row.profile.salerId ? salerMap.get(row.profile.salerId) ?? null : null;
    const salerTag = saler ? slugTag('saler', saler.name) : null;
    const latestUpdate = row.profile.updatedAt ?? row.lastMessageAt ?? row.phoneCapturedAt;
    const messagesText = row.recentMessages.length > 0
      ? row.recentMessages.map((m) => `• ${m.text} (${formatTimeVn(m.at)})`).join('\n')
      : '• Chưa có tin nhắn gần nhất.';

    const leadNodeId = `${CRM_VIRTUAL_LEAD_PREFIX}${row.leadId}`;
    const tags = [
      'data-khach-hang',
      'sdt-khach',
      pageTag,
      stepTag,
      ...(salerTag ? [salerTag] : []),
      ...(row.zaloMentioned ? ['co-zalo'] : []),
    ];

    const leadNode = withPos({
      id: leadNodeId,
      title: formatMaskedLeadTitle(row),
      nodeType: 'note',
      content: [
        `SĐT đầy đủ: ${row.phone}`,
        `Page nguồn: ${pageName}`,
        `Bước chăm sóc: ${stepLabel} · Trạng thái: ${stageLabel}`,
        `Saler phụ trách: ${saler ? saler.name : 'Chưa gán'}`,
        `Zalo: ${row.zaloMentioned ? 'Có nhắc Zalo' : 'Chưa ghi nhận'}`,
        `Cập nhật gần nhất: ${formatTimeVn(latestUpdate)}`,
        '',
        'Tin nhắn gần nhất:',
        messagesText,
      ].join('\n'),
      color: STAGE_COLORS[row.profile.stage],
      parentId: `${CRM_VIRTUAL_PAGE_PREFIX}${row.pageId}`,
      metadata: JSON.stringify({ tags, virtualCrm: true }),
      createdAt: row.phoneCapturedAt,
      updatedAt: latestUpdate,
    });

    if (canvasLeadIds.has(row.leadId)) {
      nodes.push(leadNode);
      links.push({
        id: `${CRM_VIRTUAL_LINK_PREFIX}page-lead-${row.leadId}`,
        sourceId: `${CRM_VIRTUAL_PAGE_PREFIX}${row.pageId}`,
        targetId: leadNodeId,
        label: 'Khách',
        color: '#38d6ff',
      });

      if (saler) {
        links.push({
          id: `${CRM_VIRTUAL_LINK_PREFIX}saler-lead-${row.leadId}`,
          sourceId: `${CRM_VIRTUAL_SALER_PREFIX}${saler.id}`,
          targetId: leadNodeId,
          label: 'Phụ trách',
          color: '#f0b75f',
        });
      }

      if (row.identity?.consent?.state === 'granted' && row.identity.persona?.value) {
        const persona = row.identity.persona.value;
        links.push({
          id: `${CRM_VIRTUAL_LINK_PREFIX}persona-lead-${row.leadId}`,
          sourceId: `${CRM_VIRTUAL_PERSONA_PREFIX}${persona}`,
          targetId: leadNodeId,
          label: 'Persona',
          color: '#a77cff',
        });
      }
    }

    const normalizedPhone = normalizePhoneDigits(row.phone);
    const searchText = normalizeSearch([
      row.customerName ?? 'Khách FB',
      pageName,
      saler?.name ?? '',
      stepLabel,
      stageLabel,
      row.zaloMentioned ? 'zalo' : '',
    ].join(' '));
    searchEntries.push({
      node: leadNode,
      searchText,
      phoneDigits: normalizedPhone,
      phoneLast4: normalizedPhone.slice(-4),
      snippet: `${pageName} · ${stepLabel}${saler ? ` · ${saler.name}` : ''}`,
    });
  }

  return { identityId, workspaceId, loadedAt, nodes, links, searchEntries };
}

export function createMyGraphWithCrmApi(
  baseApi: GraphApi,
  options: MyGraphCrmOverlayOptions = {},
): MyGraphWithCrmApi {
  const getElectronApi = options.getElectronApi
    ?? (() => (typeof window !== 'undefined' ? (window as unknown as { electronAPI?: OverlayElectronApi }).electronAPI : undefined));
  const now = options.now ?? Date.now;

  let cache: CrmOverlayDataset | null = null;
  let inFlight: Promise<CrmOverlayDataset | null> | null = null;
  const positions = new Map<string, { x?: number; y?: number }>();

  const clearCache = () => {
    cache = null;
  };

  const onBackfillUpdated = () => {
    clearCache();
  };

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener(CRM_BACKFILL_UPDATED_EVENT, onBackfillUpdated);
  }

  async function resolveIdentityId(api: OverlayElectronApi | null | undefined): Promise<string | null | undefined> {
    if (!api?.auth?.getUser) return undefined;
    try {
      const user = await api.auth.getUser();
      if (!user || typeof user !== 'object') return null;
      const id = (user as { id?: unknown }).id;
      return typeof id === 'string' && id ? id : null;
    } catch {
      return null;
    }
  }

  async function loadDataset(): Promise<CrmOverlayDataset | null> {
    const api = getElectronApi();
    const listCrm = api?.customerCare?.listCrm;
    if (!listCrm) {
      clearCache();
      positions.clear();
      return null;
    }

    const identityId = await resolveIdentityId(api);
    if (identityId === null) {
      clearCache();
      positions.clear();
      return null;
    }

    const preSnapshot = cache ? await api?.customerCare?.getSnapshot?.().catch(() => null) : null;
    if (cache && preSnapshot?.workspaceId && preSnapshot.workspaceId !== cache.workspaceId) {
      clearCache();
      positions.clear();
    }

    if (
      cache
      && (identityId === undefined || cache.identityId === identityId)
      && now() - cache.loadedAt < CACHE_TTL_MS
    ) {
      return cache;
    }

    if (inFlight) return inFlight;

    inFlight = (async () => {
      try {
        const snapshotPromise = api?.customerCare?.getSnapshot?.().catch(() => null);
        const rows: CustomerCareCrmRow[] = [];
        const seenLeadIds = new Set<string>();
        const seenCursors = new Set<string>();
        let cursor: string | null = null;
        let workspaceId: string | null = null;
        let pages: CustomerCareCrmPageSource[] = [];
        let salers: CustomerCareCrmSalerMember[] = [];

        for (let i = 0; i < CRM_MAX_PAGES; i += 1) {
          const res = await listCrm({ cursor });
          if (!res.ok) {
            if (res.error === 'forbidden' || res.error === 'auth' || res.error === 'access_changed') {
              clearCache();
              positions.clear();
              return null;
            }
            break;
          }
          if (!(CUSTOMER_CARE_CRM_ROLES as readonly string[]).includes(res.role)) {
            clearCache();
            positions.clear();
            return null;
          }
          if (workspaceId === null) {
            workspaceId = res.workspaceId;
            if (cache && cache.workspaceId !== workspaceId) {
              positions.clear();
            }
          } else if (res.workspaceId !== workspaceId) {
            clearCache();
            positions.clear();
            return null;
          }
          if (res.pages) pages = res.pages;
          if (res.salers) salers = res.salers;
          for (const row of res.rows) {
            if (seenLeadIds.has(row.leadId)) continue;
            seenLeadIds.add(row.leadId);
            rows.push(row);
          }
          cursor = res.nextCursor;
          if (cursor === null || seenCursors.has(cursor)) break;
          seenCursors.add(cursor);
        }

        const snapshot = await snapshotPromise;
        if (snapshot && workspaceId && snapshot.workspaceId === workspaceId) {
          const existing = new Map(pages.map((p) => [p.pageId, p]));
          if (snapshot.pageConnection?.state === 'connected') {
            if (!existing.has(snapshot.pageConnection.pageId)) {
              existing.set(snapshot.pageConnection.pageId, {
                pageId: snapshot.pageConnection.pageId,
                pageName: snapshot.pageConnection.pageName,
              });
            }
            for (const crmPage of snapshot.pageConnection.crmPages ?? []) {
              if (!existing.has(crmPage.pageId)) existing.set(crmPage.pageId, crmPage);
            }
          }
          for (const crmPage of snapshot.crmPages ?? []) {
            if (!existing.has(crmPage.pageId)) existing.set(crmPage.pageId, crmPage);
          }
          pages = [...existing.values()];
        }

        if (!workspaceId) {
          clearCache();
          return null;
        }

        const dataset = buildOverlayDataset({
          identityId: identityId ?? null,
          workspaceId,
          loadedAt: now(),
          rows,
          pages,
          salers,
          positions,
        });
        cache = dataset;
        return dataset;
      } catch {
        return null;
      } finally {
        inFlight = null;
      }
    })();

    return inFlight;
  }

  return {
    fetchMe: () => baseApi.fetchMe(),
    fetchContributions: () => baseApi.fetchContributions(),
    fetchCommunities: () => baseApi.fetchCommunities(),
    importUrl: (url) => baseApi.importUrl(url),
    extractDocument: (data) => baseApi.extractDocument(data),
    extractPdf: (file) => baseApi.extractPdf(file),
    synthesizeTopic: (input) => baseApi.synthesizeTopic(input),
    createNode(data) {
      const candidate = data as { parentId?: unknown; topicId?: unknown };
      const parentId = typeof candidate.parentId === 'string' ? candidate.parentId : '';
      const topicId = typeof candidate.topicId === 'string' ? candidate.topicId : '';
      if (isVirtualCrmId(parentId) || isVirtualCrmId(topicId)) {
        return Promise.resolve({ data: null, error: READONLY_ERROR, status: 403 });
      }
      return baseApi.createNode(data);
    },

    async fetchNodes() {
      const [cloudRes, dataset] = await Promise.all([baseApi.fetchNodes(), loadDataset()]);
      if (cloudRes.error || !cloudRes.data) return cloudRes;
      const cloudNodes = cloudRes.data.nodes.map(annotateCareCloudNode);
      if (!dataset || dataset.nodes.length === 0) {
        return { data: { nodes: cloudNodes }, error: null, status: cloudRes.status ?? 200 };
      }
      return {
        data: { nodes: [...cloudNodes, ...dataset.nodes] },
        error: null,
        status: cloudRes.status ?? 200,
      };
    },

    async fetchLinks() {
      const [cloudRes, dataset] = await Promise.all([baseApi.fetchLinks(), loadDataset()]);
      if (cloudRes.error || !cloudRes.data) return cloudRes;
      if (!dataset || dataset.links.length === 0) return cloudRes;
      return {
        data: { links: [...cloudRes.data.links, ...dataset.links] },
        error: null,
        status: cloudRes.status ?? 200,
      };
    },

    async searchNodes(q: string, limit = 10) {
      const [cloudRes, dataset] = await Promise.all([baseApi.searchNodes(q, limit), loadDataset()]);
      const trimmed = q.trim();
      if (!trimmed || !dataset || dataset.searchEntries.length === 0) return cloudRes;

      const queryText = normalizeSearch(trimmed);
      const queryTokens = queryText ? queryText.split(/\s+/).filter(Boolean) : [];
      const queryDigits = normalizePhoneDigits(trimmed);
      const virtualHits: SearchHit[] = [];

      for (const entry of dataset.searchEntries) {
        let score = 0;
        let matchedField = 'title';
        if (queryDigits.length >= 4 && entry.phoneDigits) {
          if (entry.phoneDigits === queryDigits) {
            score = 100;
            matchedField = 'phone';
          } else if (queryDigits.length === 4 && entry.phoneLast4 === queryDigits) {
            score = 95;
            matchedField = 'phone';
          } else if (entry.phoneDigits.includes(queryDigits)) {
            score = 85;
            matchedField = 'phone';
          }
        }
        if (score === 0 && queryTokens.length > 0 && queryTokens.every((token) => entry.searchText.includes(token))) {
          score = 75;
          matchedField = 'title';
        }
        if (score > 0) {
          virtualHits.push({
            id: entry.node.id,
            title: entry.node.title,
            nodeType: entry.node.nodeType,
            color: entry.node.color,
            matchedField,
            matchSnippet: entry.snippet,
            score,
            x: entry.node.x ?? null,
            y: entry.node.y ?? null,
          });
        }
      }

      if (virtualHits.length === 0) return cloudRes;
      const realHits = cloudRes.data?.results ?? [];
      const merged = [...virtualHits, ...realHits]
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
      return { data: { results: merged }, error: null, status: 200 };
    },

    async updateNode(id: string, data: Record<string, unknown>) {
      if (isVirtualCrmId(id)) {
        const checked = isPositionOnlyPatch(data);
        if (!checked.ok) {
          return { data: null, error: READONLY_ERROR, status: 403 };
        }
        const prev = positions.get(id) ?? {};
        positions.set(id, {
          ...(checked.x !== undefined ? { x: checked.x } : prev.x !== undefined ? { x: prev.x } : {}),
          ...(checked.y !== undefined ? { y: checked.y } : prev.y !== undefined ? { y: prev.y } : {}),
        });
        if (cache) {
          cache = {
            ...cache,
            nodes: cache.nodes.map((node) => (node.id === id
              ? {
                ...node,
                ...(checked.x !== undefined ? { x: checked.x } : {}),
                ...(checked.y !== undefined ? { y: checked.y } : {}),
              }
              : node)),
          };
        }
        return { data: { node: null }, error: null, status: 200 };
      }
      return baseApi.updateNode(id, data);
    },

    async removeNode(id: string) {
      if (isVirtualCrmId(id)) {
        return { data: null, error: READONLY_ERROR, status: 403 };
      }
      return baseApi.removeNode(id);
    },

    async createLink(data: Record<string, unknown>) {
      if (isVirtualCrmId(data.sourceId) || isVirtualCrmId(data.targetId)) {
        return { data: null, error: READONLY_ERROR, status: 403 };
      }
      return baseApi.createLink(data);
    },

    async updateLink(id: string, data: Record<string, unknown>) {
      if (isVirtualCrmId(id)) {
        return { data: null, error: READONLY_ERROR, status: 403 };
      }
      return baseApi.updateLink(id, data);
    },

    async removeLink(id: string) {
      if (isVirtualCrmId(id)) {
        return { data: null, error: READONLY_ERROR, status: 403 };
      }
      return baseApi.removeLink(id);
    },

    invalidateCrmOverlay: clearCache,
    dispose() {
      clearCache();
      positions.clear();
      if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
        window.removeEventListener(CRM_BACKFILL_UPDATED_EVENT, onBackfillUpdated);
      }
    },
  };
}
