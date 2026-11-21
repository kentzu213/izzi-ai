// Research tier selector (docs/izzi-v2/PLAN.md §1.2 and §2.4, research report §4.1).
// Pure: picks R0/R1/R2 from the candidate's kind and impact, then maps the tier to the research tools this
// machine exposes to the socrates agent, with a budget and the tools that are never allowed.
//   R0  pure preference, or a procedure that only changes phrasing: no research.
//   R1  content or marketing claim, or a pitfall: one cheap cited lookup, at most 2 sources.
//   R2  process that changes the way of working, or anything touching law or security: one deep run.
// The keyword guesses only raise a tier; explicit flags on the candidate win over them.

export const BUDGETS = Object.freeze({
  R0: Object.freeze({ maxSources: 0, maxDeepRuns: 0, maxToolCalls: 0 }),
  R1: Object.freeze({ maxSources: 2, maxDeepRuns: 0, maxToolCalls: 3 }),
  R2: Object.freeze({ maxSources: 5, maxDeepRuns: 1, maxToolCalls: 8 }),
});

const TIER_RANK = { R0: 0, R1: 1, R2: 2 };

const DESCRIPTION = {
  R0: 'Pure preference or low-impact procedure: no research. Judge on the recorded evidence only.',
  R1: 'Content or marketing claim, or a pitfall: one cheap cited lookup, at most 2 sources.',
  R2: 'Process that changes the way of working, or touches law or security: one deep multi-source run, then judge.',
};

const R1_TOOLS = [
  { tool: 'WebSearch', use: 'one quick cited lookup (built-in, cheapest)' },
  { tool: 'mcp__perplexity__perplexity_search', use: 'ranked sources with dates' },
  { tool: 'mcp__perplexity__perplexity_ask', use: 'short answer with citations' },
  { tool: 'WebFetch', use: 'read one known source page' },
  { tool: 'mcp__firecrawl__firecrawl_scrape', use: 'one page whose content is the evidence (JS-heavy site)' },
];

const R2_TOOLS = [
  { tool: 'mcp__perplexity__perplexity_research', use: 'one deep multi-source report (slow, costly): this is the deep run' },
  { tool: 'mcp__firecrawl__firecrawl_search', use: 'or: search, then scrape the top 1-3 hits: this is the deep run' },
  { tool: 'mcp__firecrawl__firecrawl_scrape', use: 'read the chosen pages' },
  { tool: 'mcp__firecrawl__firecrawl_developer_search', use: 'engineering process: docs, GitHub issues and PRs' },
  { tool: 'mcp__firecrawl__firecrawl_research_search_papers', use: 'papers on agent memory, feedback and sycophancy' },
  { tool: 'mcp__perplexity__perplexity_reason', use: 'weigh trade-offs found in the sources' },
  { tool: 'WebSearch', use: 'a quick extra check' },
];

const LAW_TOOL = {
  tool: 'mcp__firecrawl__firecrawl_gov_search',
  use: 'US law only; for Vietnamese law search official sources (vbpl.vn) with firecrawl_search, then scrape',
};

const LOCAL_TOOLS = [
  { tool: 'Read', use: 'recorded docs, evidence files and transcripts' },
  { tool: 'Grep', use: 'find the evidence ids and existing standards' },
  { tool: 'Glob', use: 'locate files' },
  { tool: 'Bash (read-only)', use: 'git log/show/diff only; never a write' },
];

const RESEARCH_TOOL_NAMES = [
  'WebSearch',
  'WebFetch',
  'mcp__perplexity__perplexity_search',
  'mcp__perplexity__perplexity_ask',
  'mcp__perplexity__perplexity_reason',
  'mcp__perplexity__perplexity_research',
  'mcp__firecrawl__firecrawl_search',
  'mcp__firecrawl__firecrawl_scrape',
  'mcp__firecrawl__firecrawl_developer_search',
  'mcp__firecrawl__firecrawl_gov_search',
  'mcp__firecrawl__firecrawl_research_search_papers',
];

export const NEVER_TOOLS = Object.freeze([
  { tool: 'ChatGPT web', why: 'opt-in only when the owner asks for it in that task; never for a critic review' },
  { tool: 'mcp__firecrawl__firecrawl_agent', why: 'autonomous paid job; outside every research budget' },
  { tool: 'mcp__firecrawl__people_company_search', why: 'paid person/company data; not evidence for a standard' },
  { tool: 'mcp__firecrawl__people_company_enrich', why: 'paid contact data; not evidence for a standard' },
  { tool: 'mcp__firecrawl__alexandria_library_read', why: 'paid provider data; not evidence for a standard' },
  { tool: 'mcp__firecrawl__firecrawl_save_skill', why: 'writes to the account; the critic is read-only' },
  { tool: 'mcp__composio__*', why: 'acts in third-party apps; the critic is read-only' },
  { tool: 'mcp__posthog__exec (write verbs)', why: 'changes production analytics; the critic is read-only' },
  { tool: 'mcp__playwright__*', why: 'drives a browser; not needed to judge a standard' },
  { tool: 'jev / jcc', why: 'sends text off the machine; only with the owner\'s OK for that data' },
]);

const B = '(?<![\\p{L}\\p{N}_])';
const E = '(?![\\p{L}\\p{N}_])';
const words = (list) => new RegExp(`${B}(?:${list.join('|')})${E}`, 'u');

const LAW_RE = words([
  'luật', 'pháp luật', 'pháp lý', 'nghị định', 'thông tư', 'điều \\d+', 'gdpr', 'ccpa', 'laws?', 'legal',
  'compliance', 'tuân thủ pháp luật', 'bản quyền', 'copyright', 'giấy phép', 'licen[cs]e', 'thuế', 'tax',
]);
const SECURITY_RE = words([
  'bảo mật', 'security', 'xác thực', 'auth', 'authentication', 'authorization', 'phân quyền', 'secrets?', 'bí mật',
  'access token', 'api token', 'refresh token', 'token truy cập', 'credentials?', 'mật khẩu', 'passwords?', 'api key',
  'khoá api', 'khóa api', 'pii', 'dữ liệu cá nhân', 'personal data', 'mã hoá', 'mã hóa', 'encryption',
  'quyền truy cập', 'permissions?', 'lỗ hổng', 'vulnerabilit(?:y|ies)', 'injection', 'xss', 'csrf',
]);
const WORKFLOW_RE = words([
  'deploy', 'triển khai', 'phát hành', 'release', 'merge', 'push', 'commit', 'pull request', 'pr', 'review',
  'tests?', 'kiểm thử', 'ci', 'build', 'cổng', 'gate', 'giao việc', 'delegate', 'subagents?', 'socrates', 'model',
  'gọi model', 'ngân sách', 'budget', 'chi phí', 'cost', 'cầu chì', 'fuses?', 'research', 'tra cứu', 'tools?',
  'công cụ', 'hooks?', 'cài', 'install', 'quy trình', 'workflow', 'checkpoint', 'kho chuẩn', 'worktree', 'nhánh',
  'branch',
]);
const CLAIM_RE = words([
  'tuyên bố', 'claims?', 'số liệu', 'thống kê', 'cam kết', 'guarantee', 'tốt nhất', 'số 1', 'hàng đầu', 'best',
  'đối thủ', 'competitors?', 'chứng nhận', 'certified', 'giảm \\d+%', 'testimonials?',
]);
const MARKETING_RE = words([
  'quảng cáo', 'marketing', 'ads', 'seo', 'bài viết', 'bài đăng', 'nội dung', 'content', 'copy', 'copywriting',
  'slogan', 'landing page', 'caption', 'fanpage',
]);

const PROCESS_KINDS = new Set(['procedure', 'quality_gate', 'pitfall']);

const flagOr = (flag, guess) => (typeof flag === 'boolean' ? flag : guess);

function applicableReasons(candidate) {
  const statement = candidate.statement.normalize('NFC').toLowerCase();
  const flags = candidate.flags ?? {};
  const isProcessKind = PROCESS_KINDS.has(candidate.kind);
  const reasons = [];
  if (flagOr(flags.touchesLaw, LAW_RE.test(statement))) reasons.push('R2:law');
  if (flagOr(flags.touchesSecurity, SECURITY_RE.test(statement))) reasons.push('R2:security');
  if (isProcessKind && flagOr(flags.changesWorkflow, WORKFLOW_RE.test(statement))) reasons.push('R2:process');
  const marketing = isProcessKind && MARKETING_RE.test(statement);
  if (flagOr(flags.contentClaim, CLAIM_RE.test(statement) || marketing)) reasons.push('R1:content-claim');
  if (candidate.kind === 'pitfall') reasons.push('R1:pitfall');
  if (reasons.length === 0) reasons.push(isProcessKind ? 'R0:low-impact-procedure' : 'R0:preference');
  return reasons;
}

const tierOfReason = (reason) => reason.slice(0, 2);

function toolsFor(tier, external, reasons) {
  if (tier === 'R0') return [];
  if (external === 'local-only') return LOCAL_TOOLS.map((t) => ({ ...t }));
  const base = tier === 'R1' ? R1_TOOLS : R2_TOOLS;
  const extra = tier === 'R2' && reasons.includes('R2:law') ? [LAW_TOOL] : [];
  return [...base, ...extra].map((t) => ({ ...t }));
}

function neverFor(tier, external) {
  const never = NEVER_TOOLS.map((t) => ({ ...t }));
  if (tier === 'R0') {
    return [...never, ...RESEARCH_TOOL_NAMES.map((tool) => ({ tool, why: 'R0: no research for this candidate' }))];
  }
  if (external === 'local-only') {
    return [...never, ...RESEARCH_TOOL_NAMES.map((tool) => ({ tool, why: 'owner-private content: no external research' }))];
  }
  return never;
}

export function selectResearchTier(candidate) {
  const reasons = applicableReasons(candidate);
  const tier = reasons.map(tierOfReason).reduce((a, b) => (TIER_RANK[b] > TIER_RANK[a] ? b : a), 'R0');
  const ordered = [...reasons].sort((a, b) => TIER_RANK[tierOfReason(b)] - TIER_RANK[tierOfReason(a)]);
  const ownerPrivate = candidate.flags?.ownerPrivate === true;
  const external = tier === 'R0' ? 'none' : ownerPrivate ? 'local-only' : 'allowed';
  return {
    tier,
    ruleId: ordered[0],
    reasons: ordered,
    external,
    description: DESCRIPTION[tier],
    tools: toolsFor(tier, external, ordered),
    budget: { ...BUDGETS[tier] },
    never: neverFor(tier, external),
    socrates: tier === 'R0' ? 'once' : 'once, after the research',
  };
}
