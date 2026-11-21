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

Limits live in `VERDICT_LIMITS` (`verdict.mjs`) and `brief.mjs` prints them from there, so the brief and the
validator cannot drift: reasons 1–5 × ≤400 characters, evidence 1–12 items, `evidence[].ref` ≤300 (absolute
Windows transcript paths are ~120+), `evidence[].note` ≤300, `narrowed.statement` ≤200, `research.refs` ≤10 ×
≤300 (and inside the tier budget), `hardReject.detail` ≤300, `reviewer.model` ≤80. A refused reply names the
item and the limit, for example `evidence_invalid(evidence[4].ref length 322 > 300)`.

## Hard-REJECT floor

`detectHardReject` matches plain wording (Vietnamese with diacritics, or English) that loosens verification,
security or honest reporting, or expands authority. A match forces REJECT; a match in `narrowed.statement` is
refused too. Negation is judged inside the sentence that holds the phrase: a negator governing it from the
left ("không bỏ qua test", "it is not allowed to skip tests", "never, even when rushed, skip tests") or a
prohibition later in the same sentence ("skipping tests is never allowed", "bỏ qua test là không được phép",
"việc bỏ qua review đều bị cấm"). A negation about something else does not clear it ("skip tests when the
owner is not around", "không bao giờ chờ CI, cứ bỏ qua test"). A clause word (when, if, that, and, khi, nếu,
và...) or a bare comma between the phrase and the prohibition breaks the link, so "bỏ qua test trước khi merge
là không được phép" is still refused: the floor errs toward REJECT; write such rules as "không bỏ qua test
trước khi merge". Socrates stays the primary judge: the floor only catches what is obvious. `promotionDecision` returns `refuse` for any hard-REJECT, even when the
owner forces it.

## Research tiers

| Tier | When | Tools (in the order to try them) | Budget |
|---|---|---|---|
| R0 | pure preference; procedure that only changes phrasing | none | 0 sources |
| R1 | content or marketing claim; pitfall | WebSearch, perplexity_search, perplexity_ask, WebFetch, firecrawl_scrape | ≤2 sources, no deep run |
| R2 | process that changes the way of working; law; security | firecrawl_search + ≤3 firecrawl_scrape (the default deep run); perplexity_research only as an optional alternative (may need paid credit); firecrawl_developer_search, firecrawl_research_search_papers, perplexity_reason; law adds firecrawl_gov_search (US only) | ≤5 sources, 1 deep run |

Fallback (every tier with web research): if a tool returns 401, 402 or 403, switch to the next allowed tool;
never retry the same paid tool.

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

## Integration gap (D2/D3)

`install.mjs` does not copy `critic/` into the installed runtime yet, so the commands above run only from the
Starizzi checkout. Copying it (and pointing `--store` at the KnowledgeMemory adapter) is an integration item for
D2/D3; D4 does not edit `install.mjs`/`uninstall.mjs`.

## Dry runs (2026-11-21, real socrates, store `F:/Ai Tools/Codex/Temp/am-critic-store`)

| Candidate | Tier | Verdict | Research |
|---|---|---|---|
| dr1-plain-language-decisions | R0 | NARROW | none (R0) |
| dr2-checkpoint-after-workflow | R2 | NARROW | 1 deep run, 4 sources; perplexity_research returned 403 (needs paid credit), firecrawl used instead |
| dr3-fuses-not-fixed-cap | R2 | NARROW | 1 deep run, 2 sources |

- All three verdicts are stored with their candidate (`decision.action = show_diff`); none hit a hard-REJECT.
- Loop guard: repeating dr2 with the same input was blocked with exit 3 (`same_input`) and logged.
- Defect found and fixed: dr3 was first refused with `evidence_invalid(evidence)`: 11 evidence items (limit was
  10) and a 122-character transcript path (ref limit was 120), limits the brief never stated. The brief now
  prints every limit from `VERDICT_LIMITS`, the limits are 12 items and 300 characters, errors name the item and
  limit, and dr3 was re-recorded from the unedited reply as NARROW.
- The 403 led to the R2 order above: firecrawl first, perplexity_research optional, plus the fallback rule.
