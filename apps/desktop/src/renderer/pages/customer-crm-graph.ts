/**
 * MyGraph → CRM → "Sơ đồ": the CRM rows the panel already holds, turned into nodes and links, plus the identity
 * lines the customer card shows. Pure functions only: nothing here stores, sends or logs a row, and no label ever
 * carries a phone number.
 */
import {
  CUSTOMER_CARE_CRM_AGE_BANDS,
  CUSTOMER_CARE_CRM_BUDGET_BANDS,
  CUSTOMER_CARE_CRM_ID_KINDS,
  CUSTOMER_CARE_CRM_ID_SOURCES,
  CUSTOMER_CARE_CRM_ID_STATUSES,
  CUSTOMER_CARE_CRM_PERSONAS,
  CUSTOMER_CARE_CRM_RECIPIENTS,
  CUSTOMER_CARE_CRM_TIMELINES,
  CUSTOMER_CARE_CRM_ADDRESS_FORMS,
  CUSTOMER_CARE_CRM_OCCASIONS,
  type CustomerCareCrmAgeBand,
  type CustomerCareCrmAssignee,
  type CustomerCareCrmBudgetBand,
  type CustomerCareCrmConsentState,
  type CustomerCareCrmIdField,
  type CustomerCareCrmIdentity,
  type CustomerCareCrmRecipient,
  type CustomerCareCrmRow,
  type CustomerCareCrmStage,
  type CustomerCareCrmTimeline,
} from '../../shared/customer-care-types';
import {
  CRM_ADDRESS_FORM_OPTIONS,
  CRM_OCCASION_OPTIONS,
  crmAssigneeLabel,
  crmStageLabel,
  type CrmProductOption,
} from './customer-crm-flow';

export type CrmGraphNodeKind = 'customer' | 'stage' | 'product' | 'occasion' | 'owner' | 'ad' | 'persona' | 'interest';

export interface CrmGraphNode {
  /** Built from the data (`customer:<leadId>`, `stage:<stage>`, ...), never from a position in the list. */
  id: string;
  kind: CrmGraphNodeKind;
  label: string;
  color: string;
  /** Customer nodes only. */
  leadId?: string;
  /** How many links touch the node. */
  degree: number;
}

export interface CrmGraphLink {
  id: string;
  source: string;
  target: string;
}

export interface CrmGraph {
  nodes: CrmGraphNode[];
  links: CrmGraphLink[];
}

/** Customers take their stage's color; the stage hub has the same one. Colors come from the Memory graph palette. */
export const CRM_STAGE_COLORS: Readonly<Record<CustomerCareCrmStage, string>> = {
  has_phone: '#00e5ff',
  consulting: '#448aff',
  deposit: '#ffd600',
  delivered: '#00e676',
  lost: '#aeb8c5',
  do_not_contact: '#ff1744',
};

export const CRM_GRAPH_KIND_COLORS: Readonly<Record<Exclude<CrmGraphNodeKind, 'customer' | 'stage'>, string>> = {
  product: '#ff9100',
  occasion: '#e040fb',
  owner: '#7c4dff',
  ad: '#ff4081',
  persona: '#76ff03',
  interest: '#ff3d00',
};

export const CRM_GRAPH_KIND_LABELS: Readonly<Record<CrmGraphNodeKind, string>> = {
  customer: 'Khách',
  stage: 'Giai đoạn',
  product: 'Sản phẩm',
  occasion: 'Dịp mua',
  owner: 'Phụ trách',
  ad: 'Quảng cáo',
  persona: 'Chân dung',
  interest: 'Liên kết khách gửi',
};

const LABEL_MAX = 48;
const SUMMARY_MAX = 120;
const QUOTE_MAX = 80;
const MAX_SHARED_LINKS = 3;
// Labels drop control characters, line separators and every format character (bidi controls, zero-width
// marks) except the zero-width joiner that multi-part emoji need.
const UNSAFE_TEXT = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g;
const FORMAT_EXCEPT_JOINER = /(?!\u200D)\p{Cf}/gu;
// A phone-like run: nine or more digits of any script, with up to three separators (space . - / _ ,) between
// any two. Text is NFKC-normalised first, so full-width digits are plain digits. Privacy wins over a long price
// or a list of numbers, which is masked too.
const PHONE_RUN = /\+?\p{Nd}(?:[\s._/,-]{0,3}\p{Nd}){8,}/gu;
const PHONE_MASK = '•••';

function cleanText(text: string): string {
  return text.normalize('NFKC').replace(FORMAT_EXCEPT_JOINER, '').replace(UNSAFE_TEXT, ' ').replace(/\s+/g, ' ').trim();
}

function truncateChars(text: string, max: number): string {
  return Array.from(text).slice(0, max).join('');
}

function hasPhoneRun(text: string): boolean {
  return text.search(PHONE_RUN) !== -1;
}

/** Display text from any source: cleaned, phone-like runs masked, then cut (so a cut never leaves half a phone). */
function safeLabel(text: string, max = LABEL_MAX): string {
  return truncateChars(cleanText(text).replace(PHONE_RUN, PHONE_MASK), max);
}

/** The customer's name, or "Khách ·" and the last three digits; a name holding a phone number is not used. */
export function crmCustomerLabel(row: Pick<CustomerCareCrmRow, 'customerName' | 'phone'>): string {
  const name = row.customerName === null ? '' : cleanText(row.customerName);
  if (name !== '' && !hasPhoneRun(name)) return truncateChars(name, LABEL_MAX);
  return `Khách ·${row.phone.slice(-3)}`;
}

function oneOf<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (values as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Identity fields (Care CRM S3): only medium or high confidence is ever shown
// ---------------------------------------------------------------------------

/** A field whose envelope is in the contract and whose confidence is medium or high; low is never shown. */
function shownField(field: unknown): field is CustomerCareCrmIdField<unknown> {
  if (typeof field !== 'object' || field === null) return false;
  const { confidence, kind, source, status } = field as Record<string, unknown>;
  return (confidence === 'medium' || confidence === 'high')
    && oneOf(CUSTOMER_CARE_CRM_ID_KINDS, kind)
    && oneOf(CUSTOMER_CARE_CRM_ID_SOURCES, source)
    && oneOf(CUSTOMER_CARE_CRM_ID_STATUSES, status);
}

function shownEnum<T extends string>(field: unknown, values: readonly T[]): T | null {
  return shownField(field) && oneOf(values, field.value) ? field.value : null;
}

/**
 * The profile layer (form of address, age, family, interests, persona) is shown only after the customer tapped
 * "Đồng ý". The server already withholds it; this is the second guard. The order layer needs no consent.
 */
function profileLayerAllowed(identity: CustomerCareCrmIdentity | null | undefined): boolean {
  return identity?.consent?.state === 'granted';
}

function interestsOf(identity: CustomerCareCrmIdentity | null | undefined): Record<string, unknown> {
  const interests = identity?.interests;
  return typeof interests === 'object' && interests !== null ? interests as Record<string, unknown> : {};
}

/** The source ad's title, cleaned, or null. */
function adTitleOf(identity: CustomerCareCrmIdentity | null | undefined): { field: CustomerCareCrmIdField<unknown>; title: string } | null {
  const field = interestsOf(identity).adTitle;
  if (!shownField(field) || typeof field.value !== 'string') return null;
  const title = safeLabel(field.value);
  return title === '' ? null : { field, title };
}

interface SharedLinkView {
  field: CustomerCareCrmIdField<unknown>;
  domain: string;
  title: string;
  /** The position in the server list, which a staff action names (a hidden link before it keeps its slot). */
  index: number;
}

/**
 * Social networks (backend 84c2523): any link there may lead to a person, so it is shown as its domain only, never
 * with a title, whatever the title says. Every subdomain counts. A YouTube video keeps its title (only a channel
 * link, which the server already sends without one, is a person's page).
 */
const SOCIAL_DOMAINS = ['facebook.com', 'fb.com', 'fb.me', 'fb.watch', 'm.me', 'instagram.com', 'threads.net', 'zalo.me', 'tiktok.com'];

export function crmIsSocialDomain(domain: string): boolean {
  return SOCIAL_DOMAINS.some((social) => domain === social || domain.endsWith(`.${social}`));
}

/** Links the customer shared, as a domain and a title only (never an address), at most three. */
function sharedLinksOf(identity: CustomerCareCrmIdentity | null | undefined): SharedLinkView[] {
  const links = interestsOf(identity).sharedLinks;
  if (!Array.isArray(links)) return [];
  const shown: SharedLinkView[] = [];
  for (const [index, field] of (links as unknown[]).entries()) {
    if (!shownField(field) || typeof field.value !== 'object' || field.value === null) continue;
    const { domain, title } = field.value as Record<string, unknown>;
    const cleanDomain = typeof domain === 'string' ? safeLabel(domain).toLowerCase() : '';
    const cleanTitle = typeof title === 'string' && !crmIsSocialDomain(cleanDomain) ? safeLabel(title) : '';
    if (cleanDomain === '' && cleanTitle === '') continue;
    shown.push({ field, domain: cleanDomain, title: cleanTitle, index });
    if (shown.length === MAX_SHARED_LINKS) break;
  }
  return shown;
}

// ---------------------------------------------------------------------------
// Graph
// ---------------------------------------------------------------------------

/**
 * Customers linked to their stage, approved products, occasion and owner and, once rows carry identity and the
 * customer agreed, their persona (P1–P4), source ad and the domains of links they shared. Low-confidence identity
 * is left out. Age, family, form of address and budget stay on the card and never become nodes.
 */
export function crmRowsToGraph(
  rows: readonly CustomerCareCrmRow[],
  products: readonly CrmProductOption[],
  assignees: readonly CustomerCareCrmAssignee[] = [],
): CrmGraph {
  const nodes = new Map<string, CrmGraphNode>();
  const links = new Map<string, CrmGraphLink>();
  const productLabels = new Map(products.map((product) => [product.id, product.label]));

  const hub = (id: string, kind: CrmGraphNode['kind'], label: string, color: string) => {
    if (!nodes.has(id)) nodes.set(id, { id, kind, label, color, degree: 0 });
    return id;
  };
  const link = (source: string, target: string) => {
    const id = `${source}->${target}`;
    if (links.has(id)) return;
    links.set(id, { id, source, target });
    nodes.get(source)!.degree += 1;
    nodes.get(target)!.degree += 1;
  };

  for (const row of rows) {
    const { stage, productFactIds, occasion, ownerUserId } = row.profile;
    const customer = `customer:${row.leadId}`;
    nodes.set(customer, {
      id: customer, kind: 'customer', label: crmCustomerLabel(row), color: CRM_STAGE_COLORS[stage], leadId: row.leadId, degree: 0,
    });
    link(customer, hub(`stage:${stage}`, 'stage', crmStageLabel(stage), CRM_STAGE_COLORS[stage]));
    for (const productId of productFactIds) {
      const label = productLabels.get(productId);
      if (label !== undefined) link(customer, hub(`product:${productId}`, 'product', safeLabel(label), CRM_GRAPH_KIND_COLORS.product));
    }
    if (occasion !== null) {
      const label = CRM_OCCASION_OPTIONS.find((option) => option.value === occasion)?.label ?? occasion;
      link(customer, hub(`occasion:${occasion}`, 'occasion', label, CRM_GRAPH_KIND_COLORS.occasion));
    }
    if (ownerUserId !== null) {
      const label = safeLabel(crmAssigneeLabel(assignees, ownerUserId));
      link(customer, hub(`owner:${ownerUserId}`, 'owner', label, CRM_GRAPH_KIND_COLORS.owner));
    }
    // Persona, source ad and shared links are profile-layer data: drawn only for a customer who agreed.
    if (!profileLayerAllowed(row.identity)) continue;
    const persona = shownEnum(row.identity?.persona, CUSTOMER_CARE_CRM_PERSONAS);
    if (persona !== null) link(customer, hub(`persona:${persona}`, 'persona', `Chân dung ${persona}`, CRM_GRAPH_KIND_COLORS.persona));
    const ad = adTitleOf(row.identity);
    if (ad !== null) link(customer, hub(`ad:${ad.title.normalize('NFC').toLowerCase()}`, 'ad', ad.title, CRM_GRAPH_KIND_COLORS.ad));
    for (const shared of sharedLinksOf(row.identity)) {
      const label = shared.domain || shared.title;
      link(customer, hub(`interest:${label.normalize('NFC').toLowerCase()}`, 'interest', label, CRM_GRAPH_KIND_COLORS.interest));
    }
  }
  return { nodes: [...nodes.values()], links: [...links.values()] };
}

export interface CrmGraphEntry {
  key: string;
  graph: CrmGraph;
}

/**
 * What the graph is drawn from: each lead, its saved version (`updatedAt`), its identity version and consent, its
 * name, and the product and owner labels. Messages and times are left out, so a refresh that only brought those
 * gives the same key.
 */
function crmGraphKey(
  rows: readonly CustomerCareCrmRow[],
  products: readonly CrmProductOption[],
  assignees: readonly CustomerCareCrmAssignee[],
): string {
  return JSON.stringify([
    rows.map((row) => [
      row.leadId, row.profile.updatedAt, row.customerName,
      row.profile.stage, row.profile.occasion, row.profile.ownerUserId, row.profile.productFactIds,
      row.identity?.version ?? null, row.identity?.consent?.state ?? null,
      row.identity?.persona?.value ?? null, row.identity?.interests?.adTitle?.value ?? null,
      (row.identity?.interests?.sharedLinks ?? []).map((item) => item?.value?.domain ?? null),
    ]),
    products.map((product) => [product.id, product.label]),
    assignees.map((assignee) => [assignee.userId, assignee.label]),
  ]);
}

/**
 * The previous graph when nothing it is drawn from changed, so a 60 s refresh does not restart the layout;
 * otherwise a new one.
 */
export function crmGraphReuse(
  previous: CrmGraphEntry | null,
  rows: readonly CustomerCareCrmRow[],
  products: readonly CrmProductOption[],
  assignees: readonly CustomerCareCrmAssignee[],
): CrmGraphEntry {
  const key = crmGraphKey(rows, products, assignees);
  return previous !== null && previous.key === key ? previous : { key, graph: crmRowsToGraph(rows, products, assignees) };
}

function searchKey(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/gi, 'd').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Customers whose name contains the query, accents ignored. Labels never hold a phone, so a phone never matches. */
export function crmGraphSearch(graph: CrmGraph, query: string, limit = 6): CrmGraphNode[] {
  const needle = searchKey(query);
  if (needle === '') return [];
  return graph.nodes.filter((node) => node.kind === 'customer' && searchKey(node.label).includes(needle)).slice(0, limit);
}

// ---------------------------------------------------------------------------
// View state
// ---------------------------------------------------------------------------

export type CrmDisplay = 'table' | 'graph' | 'saler' | 'ads' | 'lifecycle';
export type CrmGraphRow = CustomerCareCrmRow;

/** The graph shows every customer; only the stage filter applies ("Cần gọi hôm nay" is a table view). */
export function crmGraphRows<T extends CustomerCareCrmRow>(rows: readonly T[], stage: CustomerCareCrmStage | 'any'): T[] {
  return stage === 'any' ? [...rows] : rows.filter((row) => row.profile.stage === stage);
}

/** The customer the card shows; null once the row is gone (deleted, refreshed away or filtered out). */
export function crmSelectedRow<T extends CustomerCareCrmRow>(rows: readonly T[], leadId: string | null): T | null {
  return leadId === null ? null : rows.find((row) => row.leadId === leadId) ?? null;
}

/**
 * "Mở hồ sơ": back to the table with that customer's editor open and brought into view. The open row is pinned
 * (`crmVisibleRows`), so it shows even when "Cần gọi hôm nay" or the stage filter would leave it out.
 */
export function crmOpenProfile(leadId: string): { display: 'table'; expandedId: string; revealId: string } {
  return { display: 'table', expandedId: leadId, revealId: leadId };
}

/** The selected node and where it was chosen, so closing the card can give focus back there. */
export interface CrmGraphSelection {
  nodeId: string | null;
  from: 'canvas' | 'search' | null;
}

export const CRM_NO_SELECTION: CrmGraphSelection = { nodeId: null, from: null };

/** A node click selects it; clicking the selected hub again clears it (a customer stays, its card open). */
export function crmSelectionOnClick(current: CrmGraphSelection, node: Pick<CrmGraphNode, 'id' | 'kind'>): CrmGraphSelection {
  if (current.nodeId === node.id) return node.kind === 'customer' ? current : CRM_NO_SELECTION;
  return { nodeId: node.id, from: 'canvas' };
}

export function crmSelectionOnSearch(nodeId: string): CrmGraphSelection {
  return { nodeId, from: 'search' };
}

/** Closing the card (Escape or ✕): focus goes back to the search box or the canvas the customer was chosen from. */
export function crmSelectionOnClose(current: CrmGraphSelection): { next: CrmGraphSelection; focus: 'search' | 'stage' | null } {
  const focus = current.from === 'search' ? 'search' : current.from === 'canvas' ? 'stage' : null;
  return { next: CRM_NO_SELECTION, focus };
}

// ---------------------------------------------------------------------------
// Identity on the card
// ---------------------------------------------------------------------------

export interface CrmIdentityLine {
  key: string;
  label: string;
  value: string;
  /** A short evidence quote: the customer's own words first (always, and only, for `family`, hidden without one). */
  quote: string | null;
  /** Who the quote is from when it is not the customer ("Shop", "izzi", ...); null for the customer's words. */
  quoteBy: string | null;
  /** "AI" for a suggestion nobody reviewed yet; "Đã duyệt" once staff confirmed or corrected it. */
  badge: 'AI' | 'Đã duyệt';
  confidence: 'cao' | 'vừa';
}

export interface CrmIdentityView {
  /** The consent chip: "Chưa hỏi", "Đã hỏi", "Đồng ý" or "Từ chối"; null when the server sent no consent. */
  consent: { label: string; tone: 'neutral' | 'granted' | 'refused' } | null;
  lines: CrmIdentityLine[];
  /** Shown on its own secondary line, labelled as an estimate. */
  age: CrmIdentityLine | null;
}

const CONSENT_LABELS: Readonly<Record<CustomerCareCrmConsentState, string>> = {
  unknown: 'Chưa hỏi',
  asked: 'Đã hỏi',
  granted: 'Đồng ý',
  declined: 'Từ chối',
  // A customer who took consent back is treated like one who refused.
  withdrawn: 'Từ chối',
};

export const TIMELINE_LABELS: Readonly<Record<CustomerCareCrmTimeline, string>> = {
  this_week: 'Trong tuần này',
  this_month: 'Trong tháng này',
  before_tet: 'Trước Tết',
  later: 'Chưa gấp',
};

export const RECIPIENT_LABELS: Readonly<Record<CustomerCareCrmRecipient, string>> = {
  self: 'Mua cho mình',
  spouse: 'Mua cho vợ hoặc chồng',
  parents: 'Mua cho bố mẹ',
  children: 'Mua cho con',
  household: 'Mua cho cả nhà',
  gift: 'Mua làm quà',
};

export const BUDGET_LABELS: Readonly<Record<CustomerCareCrmBudgetBand, string>> = {
  under_5m: 'Dưới 5 triệu',
  '5m_15m': '5–15 triệu',
  '15m_30m': '15–30 triệu',
  '30m_plus': 'Trên 30 triệu',
};

const QUOTE_SOURCES: Readonly<Record<Exclude<CustomerCareCrmIdField<unknown>['evidence'][number]['source'], 'customer'>, string>> = {
  page: 'Shop',
  izzi: 'izzi',
  ad: 'Quảng cáo',
  link: 'Liên kết',
  note: 'Ghi chú',
};

/** The first quote of another source than the customer, cleaned, with who it is from. */
function otherQuoteOf(field: CustomerCareCrmIdField<unknown>): { quote: string; by: string } | null {
  if (!Array.isArray(field.evidence)) return null;
  for (const evidence of field.evidence as unknown[]) {
    if (typeof evidence !== 'object' || evidence === null) continue;
    const { source, quote } = evidence as Record<string, unknown>;
    if (typeof quote !== 'string' || !oneOf(Object.keys(QUOTE_SOURCES) as Array<keyof typeof QUOTE_SOURCES>, source)) continue;
    const text = safeLabel(quote, QUOTE_MAX);
    if (text !== '') return { quote: text, by: QUOTE_SOURCES[source] };
  }
  return null;
}

/** Family shows only the customer's words; any other field the customer's words first, else another quote. */
function line(key: string, label: string, field: CustomerCareCrmIdField<unknown>, value: string): CrmIdentityLine {
  const own = customerQuoteOf(field);
  const other = own === null && key !== 'family' ? otherQuoteOf(field) : null;
  return {
    key,
    label,
    value,
    quote: own ?? other?.quote ?? null,
    quoteBy: other?.by ?? null,
    badge: field.status === 'suggested' ? 'AI' : 'Đã duyệt',
    confidence: field.confidence === 'high' ? 'cao' : 'vừa',
  };
}

/** The first quote whose source is the customer, cleaned. A page, izzi or note quote is not the customer's words. */
function customerQuoteOf(field: CustomerCareCrmIdField<unknown>): string | null {
  if (!Array.isArray(field.evidence)) return null;
  for (const evidence of field.evidence as unknown[]) {
    if (typeof evidence !== 'object' || evidence === null) continue;
    const { source, quote } = evidence as Record<string, unknown>;
    if (source !== 'customer' || typeof quote !== 'string') continue;
    const text = safeLabel(quote, QUOTE_MAX);
    if (text !== '') return text;
  }
  return null;
}

/** "25–44" for one band or two adjacent ones; anything else is not shown. */
function ageText(field: unknown): string | null {
  if (!shownField(field) || !Array.isArray(field.value)) return null;
  const bands = field.value as unknown[];
  if (bands.length < 1 || bands.length > 2 || !bands.every((band) => oneOf(CUSTOMER_CARE_CRM_AGE_BANDS, band))) return null;
  const index = (bands as CustomerCareCrmAgeBand[]).map((band) => CUSTOMER_CARE_CRM_AGE_BANDS.indexOf(band));
  if (index.length === 2 && index[1] !== index[0] + 1) return null;
  const first = bands[0] as CustomerCareCrmAgeBand;
  const last = bands[bands.length - 1] as CustomerCareCrmAgeBand;
  const low = first.replace('+', '').split('-')[0];
  return last === '55+' ? `${low}+` : `${low}–${last.split('-')[1]}`;
}

function consentChip(identity: CustomerCareCrmIdentity): CrmIdentityView['consent'] {
  const state = identity.consent?.state;
  if (!oneOf(Object.keys(CONSENT_LABELS) as CustomerCareCrmConsentState[], state)) return null;
  const tone = state === 'granted' ? 'granted' : state === 'declined' || state === 'withdrawn' ? 'refused' : 'neutral';
  return { label: CONSENT_LABELS[state], tone };
}

/** Persona, form of address and family: profile layer. Family needs the customer's own words. */
function personLines(identity: CustomerCareCrmIdentity): CrmIdentityLine[] {
  const lines: CrmIdentityLine[] = [];
  const persona = shownEnum(identity.persona, CUSTOMER_CARE_CRM_PERSONAS);
  if (persona !== null && identity.persona) {
    const summary = typeof identity.persona.summary === 'string' ? safeLabel(identity.persona.summary, SUMMARY_MAX) : '';
    lines.push(line('persona', 'Chân dung', identity.persona, summary ? `${persona} · ${summary}` : persona));
  }
  const addressForm = shownEnum(identity.addressForm, CUSTOMER_CARE_CRM_ADDRESS_FORMS);
  if (addressForm !== null && identity.addressForm) {
    const label = CRM_ADDRESS_FORM_OPTIONS.find((option) => option.value === addressForm)?.label ?? addressForm;
    lines.push(line('addressForm', 'Xưng hô', identity.addressForm, label));
  }
  const family = identity.family;
  if (shownField(family) && typeof family.value === 'object' && family.value !== null) {
    const recipient = (family.value as Record<string, unknown>).recipient;
    const quote = customerQuoteOf(family);
    if (oneOf(CUSTOMER_CARE_CRM_RECIPIENTS, recipient) && quote !== null) {
      lines.push(line('family', 'Gia đình', family, RECIPIENT_LABELS[recipient]));
    }
  }
  return lines;
}

/** Timeline and products: order layer, shown without consent. The occasion has its own row on the card. */
function orderLines(identity: CustomerCareCrmIdentity, products: readonly CrmProductOption[]): CrmIdentityLine[] {
  const lines: CrmIdentityLine[] = [];
  const timeline = shownEnum(identity.timeline, CUSTOMER_CARE_CRM_TIMELINES);
  if (timeline !== null && identity.timeline) lines.push(line('timeline', 'Thời điểm', identity.timeline, TIMELINE_LABELS[timeline]));
  const productField = identity.productFactIds;
  if (shownField(productField) && Array.isArray(productField.value)) {
    const ids = (productField.value as unknown[]).filter((id): id is string => typeof id === 'string');
    const known = products.filter((product) => ids.includes(product.id)).map((product) => safeLabel(product.label));
    const others = new Set(ids).size - known.length;
    const parts = others > 0 ? [...known, `${others} sản phẩm khác`] : known;
    if (parts.length > 0) lines.push(line('productFactIds', 'Sản phẩm quan tâm', productField, parts.join(', ')));
  }
  return lines;
}

/** Source ad, shared links and budget: profile layer. */
function interestLines(identity: CustomerCareCrmIdentity): CrmIdentityLine[] {
  const lines: CrmIdentityLine[] = [];
  const ad = adTitleOf(identity);
  if (ad !== null) lines.push(line('adTitle', 'Quảng cáo', ad.field, ad.title));
  for (const shared of sharedLinksOf(identity)) {
    const value = shared.title && shared.domain ? `${shared.title} · ${shared.domain}` : shared.domain || shared.title;
    lines.push(line(`sharedLink:${shared.index}`, 'Liên kết khách gửi', shared.field, value));
  }
  const budgetField = interestsOf(identity).budgetBand;
  const budget = shownEnum(budgetField, CUSTOMER_CARE_CRM_BUDGET_BANDS);
  if (budget !== null && shownField(budgetField)) lines.push(line('budgetBand', 'Ngân sách', budgetField, BUDGET_LABELS[budget]));
  return lines;
}

/**
 * What the card shows of a row's identity, in a fixed order; null when the row has none. Without the customer's
 * "Đồng ý" only the consent chip and the order layer (timeline, products) are shown.
 */
export function crmIdentityView(
  identity: CustomerCareCrmIdentity | null | undefined,
  products: readonly CrmProductOption[],
): CrmIdentityView | null {
  if (typeof identity !== 'object' || identity === null) return null;
  const allowed = profileLayerAllowed(identity);
  const age = allowed ? ageText(identity.ageBand) : null;
  return {
    consent: consentChip(identity),
    lines: [
      ...(allowed ? personLines(identity) : []),
      ...orderLines(identity, products),
      ...(allowed ? interestLines(identity) : []),
    ],
    age: age !== null && identity.ageBand ? line('ageBand', 'Độ tuổi (ước tính)', identity.ageBand, age) : null,
  };
}

/** The AI occasion as a card line (with its badge and actions), only when staff left "Dịp mua" empty. */
export function crmIdentityOccasionLine(row: CustomerCareCrmRow): CrmIdentityLine | null {
  if (row.profile.occasion !== null) return null;
  const field = row.identity?.occasion;
  const value = shownEnum(field, CUSTOMER_CARE_CRM_OCCASIONS);
  if (value === null || !field) return null;
  return line('occasion', 'Dịp mua', field, CRM_OCCASION_OPTIONS.find((option) => option.value === value)?.label ?? value);
}

/**
 * The card's single "Dịp mua": the staff value wins; the AI value (order layer, medium or high confidence) fills
 * an empty one, marked "AI gợi ý" until staff confirm it.
 */
export function crmCardOccasion(row: CustomerCareCrmRow): { label: string; badge: 'AI gợi ý' | 'Đã duyệt' | null } | null {
  const occasionLabel = (value: string) => CRM_OCCASION_OPTIONS.find((option) => option.value === value)?.label ?? value;
  if (row.profile.occasion !== null) return { label: occasionLabel(row.profile.occasion), badge: null };
  const field = row.identity?.occasion;
  const suggested = shownEnum(field, CUSTOMER_CARE_CRM_OCCASIONS);
  if (suggested === null || !field) return null;
  return { label: occasionLabel(suggested), badge: field.status === 'suggested' ? 'AI gợi ý' : 'Đã duyệt' };
}
