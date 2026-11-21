import assert from 'node:assert/strict';
import { test } from 'node:test';

import { validateCandidate } from '../critic/candidate.mjs';
import { BUDGETS, NEVER_TOOLS, selectResearchTier } from '../critic/research-tier.mjs';

const BASE = {
  id: 'tier-case',
  statement: 'Câu trả lời ngắn hơn.',
  kind: 'preference',
  scope: { agent: 'writer', taskType: 'bài viết', projects: 'all' },
  check: 'Câu trung bình ≤20 từ.',
  evidence: [{ id: 'ev-1', type: 'correction', at: '2026-11-20', source: 'session' }],
};

function tierOf(overrides) {
  const r = validateCandidate({ ...BASE, ...overrides });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  return selectResearchTier(Object.freeze(r.value));
}

const toolNames = (t) => t.tools.map((x) => x.tool);
const neverNames = (t) => t.never.map((x) => x.tool);

test('a pure preference is R0 with no research tools and a zero budget', () => {
  const t = tierOf({});
  assert.equal(t.tier, 'R0');
  assert.equal(t.ruleId, 'R0:preference');
  assert.equal(t.external, 'none');
  assert.deepEqual(t.tools, []);
  assert.deepEqual(t.budget, { maxSources: 0, maxDeepRuns: 0, maxToolCalls: 0 });
  assert.ok(neverNames(t).includes('mcp__perplexity__perplexity_search'), 'R0 forbids research tools');
});

test('a procedure that only changes how a question is phrased stays R0', () => {
  const t = tierOf({
    kind: 'procedure',
    statement: 'Khi xin anh quyết định, nói bằng lời thường: việc gì, anh chọn ở đâu, hệ quả A/B, em đề xuất gì.',
  });
  assert.equal(t.tier, 'R0');
  assert.equal(t.ruleId, 'R0:low-impact-procedure');
});

test('a content or marketing claim is R1 with cheap cited lookups and at most 2 sources', () => {
  const t = tierOf({ kind: 'quality_gate', statement: 'Bài quảng cáo chỉ nêu số liệu có nguồn.' });
  assert.equal(t.tier, 'R1');
  assert.equal(t.ruleId, 'R1:content-claim');
  assert.equal(t.external, 'allowed');
  assert.deepEqual(toolNames(t).slice(0, 3), [
    'WebSearch',
    'mcp__perplexity__perplexity_search',
    'mcp__perplexity__perplexity_ask',
  ]);
  assert.ok(!toolNames(t).includes('mcp__perplexity__perplexity_research'), 'R1 has no deep run');
  assert.deepEqual(t.budget, { maxSources: 2, maxDeepRuns: 0, maxToolCalls: 3 });
});

test('the contentClaim flag alone makes a preference R1', () => {
  assert.equal(tierOf({ flags: { contentClaim: true } }).tier, 'R1');
});

test('a pitfall without workflow impact is R1', () => {
  const t = tierOf({ kind: 'pitfall', statement: 'Ảnh sản phẩm luôn ghi nguồn ảnh gốc.' });
  assert.equal(t.tier, 'R1');
  assert.equal(t.ruleId, 'R1:pitfall');
});

test('a procedure that changes the way of working is R2 with one deep run', () => {
  assert.equal(tierOf({ kind: 'procedure', statement: 'Giao việc cho subagent bằng brief ngắn.' }).tier, 'R2');
  const t = tierOf({ kind: 'procedure', statement: 'Vẽ sơ đồ trước rồi mới giao việc cho subagent.' });
  assert.equal(t.tier, 'R2');
  assert.equal(t.ruleId, 'R2:process');
  assert.deepEqual(toolNames(t).slice(0, 2), ['mcp__firecrawl__firecrawl_search', 'mcp__firecrawl__firecrawl_scrape']);
  assert.match(t.tools[0].use, /default deep run/);
  assert.match(t.tools[1].use, /at most 3/);
  assert.deepEqual(t.budget, { maxSources: 5, maxDeepRuns: 1, maxToolCalls: 8 });
  assert.equal(t.socrates, 'once, after the research');
});

test('perplexity_research is only an optional R2 alternative that may need paid credit', () => {
  const t = tierOf({ kind: 'procedure', statement: 'Vẽ sơ đồ trước rồi mới giao việc cho subagent.' });
  const names = toolNames(t);
  const at = names.indexOf('mcp__perplexity__perplexity_research');
  assert.ok(at > names.indexOf('mcp__firecrawl__firecrawl_scrape'), 'listed after the default deep run');
  assert.match(t.tools[at].use, /optional/);
  assert.match(t.tools[at].use, /may need paid credit/);
});

test('tiers with web research carry the 401/402/403 fallback rule; R0 and owner-private do not', () => {
  for (const t of [tierOf({ flags: { contentClaim: true } }), tierOf({ flags: { touchesLaw: true } })]) {
    assert.match(t.fallback, /401, 402 or 403/);
    assert.match(t.fallback, /switch to the next allowed tool/);
    assert.match(t.fallback, /never retry the same paid tool/);
  }
  assert.equal(tierOf({}).fallback, null);
  assert.equal(tierOf({ kind: 'procedure', statement: 'Giao việc cho subagent.', flags: { ownerPrivate: true } }).fallback, null);
});

test('a flag can raise the tier but a false flag never lowers it below the keyword guess', () => {
  assert.equal(tierOf({ kind: 'procedure', statement: 'Hỏi một câu thôi.', flags: { changesWorkflow: true } }).tier, 'R2');
  const cases = [
    [{ kind: 'procedure', statement: 'Giao việc cho subagent bằng brief ngắn.', flags: { changesWorkflow: false } }, 'R2'],
    [{ statement: 'Không dán API key vào prompt.', flags: { touchesSecurity: false } }, 'R2'],
    [{ statement: 'Ghi rõ là AI trả lời theo Luật 134/2025.', flags: { touchesLaw: false } }, 'R2'],
    [{ kind: 'quality_gate', statement: 'Bài quảng cáo chỉ nêu số liệu có nguồn.', flags: { contentClaim: false } }, 'R1'],
  ];
  for (const [overrides, tier] of cases) assert.equal(tierOf(overrides).tier, tier, overrides.statement);
});

test('jobs_search is never allowed; research_read_paper is never allowed outside R2 web research', () => {
  const r0 = tierOf({});
  const r1 = tierOf({ flags: { contentClaim: true } });
  const r2 = tierOf({ kind: 'procedure', statement: 'Vẽ sơ đồ trước rồi mới giao việc cho subagent.' });
  const priv = tierOf({ kind: 'procedure', statement: 'Giao việc cho subagent.', flags: { ownerPrivate: true } });
  for (const t of [r0, r1, r2, priv]) assert.ok(neverNames(t).includes('mcp__firecrawl__jobs_search'), t.tier);
  for (const t of [r0, r1, priv]) {
    assert.ok(neverNames(t).includes('mcp__firecrawl__firecrawl_research_read_paper'), `${t.tier} ${t.external}`);
  }
  assert.ok(!neverNames(r2).includes('mcp__firecrawl__firecrawl_research_read_paper'));
});

test('law or security always means R2, whatever the kind', () => {
  const law = tierOf({ statement: 'Ghi rõ là AI trả lời theo Luật 134/2025.' });
  assert.equal(law.tier, 'R2');
  assert.equal(law.ruleId, 'R2:law');
  assert.ok(toolNames(law).includes('mcp__firecrawl__firecrawl_gov_search'));
  assert.match(law.tools.find((x) => x.tool === 'mcp__firecrawl__firecrawl_gov_search').use, /US law only/);
  const sec = tierOf({ statement: 'Không dán API key vào prompt.' });
  assert.equal(sec.tier, 'R2');
  assert.equal(sec.ruleId, 'R2:security');
  assert.equal(tierOf({ flags: { touchesSecurity: true } }).tier, 'R2');
  assert.equal(tierOf({ flags: { touchesLaw: true } }).ruleId, 'R2:law');
});

test('the highest applicable tier wins when several rules apply', () => {
  const t = tierOf({ kind: 'procedure', statement: 'Bài quảng cáo qua review của socrates trước khi giao.' });
  assert.equal(t.tier, 'R2');
  assert.deepEqual(t.reasons, ['R2:process', 'R1:content-claim']);
});

test('owner-private content never goes to external research, at any tier', () => {
  for (const kind of ['preference', 'pitfall', 'procedure']) {
    const t = tierOf({ kind, statement: 'Đọc ghi chú nội bộ của shop trước khi giao việc.', flags: { ownerPrivate: true } });
    assert.equal(t.external, t.tier === 'R0' ? 'none' : 'local-only', kind);
    for (const name of toolNames(t)) assert.ok(!/^(WebSearch|WebFetch|mcp__)/.test(name), `${kind}: ${name}`);
    assert.ok(neverNames(t).includes('mcp__perplexity__perplexity_research'), kind);
  }
  const r2 = tierOf({ kind: 'procedure', statement: 'Giao việc cho subagent theo ghi chú nội bộ.', flags: { ownerPrivate: true } });
  assert.equal(r2.tier, 'R2');
  assert.deepEqual(toolNames(r2), ['Read', 'Grep', 'Glob', 'Bash (read-only)']);
});

test('ChatGPT web and paid autonomous or person-data tools are never allowed', () => {
  for (const t of [tierOf({}), tierOf({ flags: { contentClaim: true } }), tierOf({ flags: { touchesLaw: true } })]) {
    const never = neverNames(t);
    for (const name of [
      'ChatGPT web',
      'mcp__firecrawl__firecrawl_agent',
      'mcp__firecrawl__people_company_search',
      'mcp__firecrawl__people_company_enrich',
      'mcp__composio__*',
    ]) {
      assert.ok(never.includes(name), `${t.tier}: ${name}`);
    }
  }
  assert.ok(NEVER_TOOLS.every((x) => typeof x.why === 'string' && x.why.length > 0));
});

test('budgets match PLAN §1.2: R1 ≤2 sources, R2 ≤1 deep run', () => {
  assert.equal(BUDGETS.R1.maxSources, 2);
  assert.equal(BUDGETS.R2.maxDeepRuns, 1);
  assert.equal(BUDGETS.R0.maxToolCalls, 0);
});

test('the selector is pure and returns fresh objects', () => {
  const a = tierOf({ flags: { contentClaim: true } });
  const b = tierOf({ flags: { contentClaim: true } });
  assert.deepEqual(a, b);
  a.tools.push({ tool: 'x' });
  assert.notDeepEqual(a.tools, b.tools);
});
