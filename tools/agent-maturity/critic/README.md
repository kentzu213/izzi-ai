# agent-maturity critic (slice D4)

After the owner picks **Nâng cấp**, a candidate standard goes through: research tier → one `socrates` critique →
verdict stored with the candidate. Spec: `docs/izzi-v2/PLAN.md` §1.2, §2.4, §4.9 items 4 and 6.

| File | Role |
|---|---|
| `candidate.mjs` | Candidate schema (`validateCandidate`, `hasContrastPair`). Pure. |
| `research-tier.mjs` | `selectResearchTier(candidate)`: R0/R1/R2, tools, budget, never-list. Pure. |
| `verdict.mjs` | `validateVerdict`, `detectHardReject` (code floor), `promotionDecision`, `extractVerdictJson`. Pure. |
| `loop-guard.mjs` | `planCritique(record, candidate)`: allows critique 1, one re-check, blocks the 3rd. Pure. |
| `json-adapter.mjs` | Local JSON store for tests and dry runs. |
| `brief.mjs` | CLI: guard pre-check + the standard socrates brief. |
| `record-verdict.mjs` | CLI: validate + store a verdict, enforce guard and floor, print the next action. |
| `dry-runs/` | Three candidates from recorded owner decisions (20–21/11) for the real socrates runs. |

## Store adapter (D3 plugs the KnowledgeMemory store in here)

    saveCandidate(candidate)            // store the current revision; keep earlier revisions as history
    loadCandidate(id) -> record | null  // { candidate, previous: [...], verdicts: [...] }
    saveVerdict(candidateId, verdict)   // append; the candidate must already be stored
    logEvent(event)                     // optional: guard/audit events (critique_blocked, verdict_recorded)

`candidate.revision` is set by the loop guard (1 = the sentence the owner approved; 2 = the one rewrite). Each
stored verdict carries `critiqueNumber`, `inputFingerprint`, `tier`, `tierRule`, `recordedAt`. The guard reads
only `verdicts[].hardReject`, `verdicts[].inputFingerprint` and `candidate.revision`, so any store that keeps
those fields works.

## Candidate (`agent-maturity/candidate@1`)

`id` (slug), `statement` (≤200), `kind` (preference | procedure | quality_gate | pitfall), `scope` { agent,
taskType, projects: all | this }, `check` (≤300), `evidence` [{ id, type (correction | reject | edit |
approve_after_reject | approve | decision | outcome), at, source, note? }] oldest first, optional `flags`
{ touchesLaw, touchesSecurity, contentClaim, changesWorkflow, ownerPrivate }, `existingStandards` [{ id,
statement }] from `recall`, `research` { refs }. Keys, tokens, phone numbers and emails are refused.

## Verdict (`agent-maturity/verdict@1`)

`candidateId`, `candidateRevision`, `verdict` (ACCEPT | NARROW | NEED-MORE-EVIDENCE | REJECT; `NEED-MORE` is
read as NEED-MORE-EVIDENCE), `reasons` (1–5), `evidence` [{ ref, kind, finding: supports | contradicts |
insufficient }], `checks` { evidenceSupports, scopeTooWide, contradictsExisting, tierCorrect }, `hardReject`
(null or { class, detail }), `narrowed.statement` (NARROW only), `research` { tier, refs, deepRuns },
`reviewAfter` (NEED-MORE-EVIDENCE only), `reviewer.agent = socrates`.

Rules: ACCEPT needs all four checks to pass; ACCEPT and NARROW must cite a candidate evidence id that supports
them, meet the research tier, stay inside its budget, and (R2 with web research allowed) report the one deep
run. A named hard-REJECT class forces REJECT.

## Hard-REJECT floor

`detectHardReject` matches plain wording (Vietnamese with diacritics, or English) that loosens verification,
security or honest reporting, or expands authority. A match forces REJECT; a match in `narrowed.statement` is
refused too. It counts a rule as negated only when the negation sits right before the phrase ("không bỏ qua
test", "never deploy without asking"); write prohibitions that way. Socrates stays the primary judge: the
floor only catches what is obvious. `promotionDecision` returns `refuse` for any hard-REJECT, even when the
owner forces it.

## Research tiers

| Tier | When | Tools (cheapest first) | Budget |
|---|---|---|---|
| R0 | pure preference; procedure that only changes phrasing | none | 0 sources |
| R1 | content or marketing claim; pitfall | WebSearch, perplexity_search, perplexity_ask, WebFetch, firecrawl_scrape | ≤2 sources, no deep run |
| R2 | process that changes the way of working; law; security | perplexity_research **or** firecrawl_search + ≤3 scrapes (the deep run), firecrawl_developer_search, firecrawl_research_search_papers, perplexity_reason; law adds firecrawl_gov_search (US only) | ≤5 sources, 1 deep run |

Not allowed: any external research for owner-private content (`flags.ownerPrivate`; local repo and recorded
docs only); ChatGPT web, ever; firecrawl_agent, people/company providers, Composio, PostHog writes, Playwright,
sending candidate text to Jev. Queries stay generic. Highest applicable tier wins; flags override the keyword
guess.

## Loop guard

Per candidate: 1 critique + 1 rewrite, and the rewrite gets one re-check. Critique 2 needs new input since
critique 1 (a rewrite, research or evidence), otherwise `same_input`. Critique 3 is always blocked
(`max_critiques`). A hard-REJECT is final (`hard_reject_final`). Blocked attempts are logged and exit 3.

## CLI

    node tools/agent-maturity/critic/brief.mjs <candidate.json> --store <dir>
    node tools/agent-maturity/critic/record-verdict.mjs <candidate.json> <verdict.json|reply.md> --store <dir>

Exit codes: 0 ok · 1 invalid input (nothing stored; does not count) · 2 usage · 3 blocked by the loop guard.
`--store` is required. Until D3 lands, use a temp folder such as `F:/Ai Tools/Codex/Temp/agent-maturity-critic/`.
