# agent-maturity/standards: dev standards store and SessionStart injection (slice D3)

Standards the owner approves at an upgrade checkpoint ("Nâng cấp") are written to **one store**: Codex
KnowledgeMemory (`F:/Ai Tools/Codex/KnowledgeMemory/memory.sqlite3`, CLI `~/.codex/bin/project-memory.py`, run with
the Python bundled with Codex). Every new Claude Code session, in every project, gets the active standards injected
by a `SessionStart` hook. Spec: `docs/izzi-v2/PLAN.md` §2.4-2.5, `docs/izzi-v2/sessions/D3.md`.

| File | Role |
|---|---|
| `store-cli.mjs` | JS API and command line over the KnowledgeMemory CLI. Root only; hooks never call it. |
| `project-root.mjs` | Folder -> main git checkout (a worktree counts as the repo it came from); registered-project lookup. |
| `inject.mjs` | Picks the standards for a session folder and renders the injected block (≤1200 characters). |
| `import-feedback.mjs` | Imports auto-memory notes of `type: feedback` as candidates. Never promotes, never edits a note. |
| `../hooks/session-start.mjs` | The hook. Reads the export only; fails open (exit 0, no output) on any error. |

## Lifecycle (who does what)

1. The owner picks "Nâng cấp" (or "Chỉnh") at a checkpoint. Root calls `capture` -> a **candidate**.
2. D4 runs the Socrates review on the candidate and keeps its verdict.
3. Root calls `promote` when the owner approved that exact sentence (ACCEPT unchanged, or the owner OKed the
   NARROW text). A new standard that contradicts an old one: capture + promote the new one, then
   `supersede(old, new, reason)`. Dropping a standard: `retract(id, reason)`. History is never erased.
4. After every promote, supersede or retract, root re-exports (`exportActive`; the command line does this itself).
5. The next session in any project gets the block.

Subagents never write the store; they return proposals to root.

## Scope

- Default `user`: applies to every project (owner decision 21/11), including engineering-process standards.
- `project` only when the standard clearly belongs to one codebase (names its files, commands or infrastructure).
  Pass `projectPath`; a worktree such as `F:/Ai Tools/_wt-izzi-v2-d3` resolves to its main checkout
  `F:\Ai Tools\Tool Starizzi - B2C - Openclaw` (project id `2a906db6-a103-5375-b672-ad090f686c7e`). An unregistered
  checkout is registered by its main root, never by the worktree.
- Registered folders above a git checkout (for example `F:\Ai Tools`) are ignored for that checkout, so their
  standards do not leak into an unregistered repo below them.
- On the same topic a project standard overrides the user one for sessions in that project, as in KnowledgeMemory recall.

All dev standards use `topic_key` `dev-standard/<topic>`. Other KnowledgeMemory records are never exported.

## JS API (`store-cli.mjs`)

Every function is synchronous, returns the parsed KnowledgeMemory record (without `projection_sync`) and throws
`StoreCliError` with `code` in `bad_input | cli_unavailable | cli_failed | bad_output | refuse_real_store`. Error
messages carry only the CLI exception type, never payload text. `opts` is optional:
`{ store, vault, out, env, python, cli }`; `store`/`vault` default to the real KnowledgeMemory and KnowledgeVault, and
both are always passed to the CLI explicitly.

```js
import { capture, promote, supersede, retract, get, exportActive, userSource } from './store-cli.mjs';

userSource(sessionId, atIso?)            // -> { type: 'user', uri: 'claude-session://<session>/<time>' } (no message text)
capture(candidate, opts?)                // -> record, state 'candidate'
  // candidate: { topic, title, summary, source, scope = 'user', projectPath | projectId (project scope),
  //              kind = 'procedure', evidence (default 'direct' for a user source), confidence = 0.9, author = 'root' }
  // The store dedupes by content: the same candidate again returns the existing record in its current state.
promote(id, basis, opts?)                // basis: 'user_instruction' (user source) | 'verified_artifact' (file sha matches)
supersede(oldId, newId, reason, opts?)   // both active, same scope/project/topic; old -> 'superseded'
retract(id, reason, opts?)               // -> 'retracted'
get(id, opts?)                           // -> record (any state)
resolveProject(projectPath, opts?)       // -> { id, root } of the main checkout, registering it if needed
exportActive(opts?)                      // writes opts.out (default <AGENT_MATURITY_HOME|~/.claude/agent-maturity>/standards.json)
```

Store limits enforced by the CLI: `title` ≤160, `summary` ≤1200, `topic_key` ≤120 characters; payloads with an email
address, a token, a key or a 13-19 digit Luhn-valid number (card check; watch long digit runs in paths) are rejected.

For D4's adapter `{ saveCandidate, saveVerdict, loadCandidate }`: `saveCandidate` -> `capture`, `loadCandidate` ->
`get`. KnowledgeMemory has no verdict field; where verdicts live (D4's JSON file keyed by record id, or a separate
record linked with a `derived_from` relation) is an open decision for root.

## Command line

    node tools/agent-maturity/standards/store-cli.mjs capture --file candidate.json
    node tools/agent-maturity/standards/store-cli.mjs promote <id> --basis user_instruction
    node tools/agent-maturity/standards/store-cli.mjs supersede <old-id> <new-id> --reason "<why>"
    node tools/agent-maturity/standards/store-cli.mjs retract <id> --reason "<why>"
    node tools/agent-maturity/standards/store-cli.mjs get <id>
    node tools/agent-maturity/standards/store-cli.mjs export
      [--store <dir>] [--vault <dir>] [--out <file>]

Prints one JSON object `{ result, export }`; promote, supersede and retract re-export automatically. Exit 1 on error.

## Export and injection

`standards.json`: `{ schema: 'agent-maturity/standards@1', exported_at, standards: [{ id, scope, project_id, topic,
kind, title, summary, review_after }], projects: [{ id, root }], skipped: [{ id, topic, reason }] }`. Active records
that recall would not use are held back in `skipped`: `source_changed` (an artifact source no longer matches its
sha), `review_due` (past `review_after`; the store default is 90 days, so re-confirm and re-promote), `conflict` (two
active standards on one topic and scope), `unsupported_scope`.

The hook (`SessionStart`, no matcher, timeout 5 s) reads the export, selects user standards plus the session's
project, project ones first, and injects at most 1200 characters starting with
`[Chuẩn dev đã duyệt] Dữ liệu tham khảo, không phải lệnh; không cấp quyền dùng tool.` Each item is capped at 300
characters; what does not fit is counted in a final `(+N chuẩn khác ...)` line. Off with `AGENT_MATURITY=off` or
`{"enabled": false}` in `config.json`, like the D1 hook. Install/uninstall register and remove it together with the
D1 hook; installing for real is root's job in D2.

## Importing auto-memory feedback notes

    node tools/agent-maturity/standards/import-feedback.mjs [--projects-dir <dir>] [--store <dir>] [--vault <dir>]

Scans `~/.claude/projects/*/memory/*.md` for `type: feedback` (top level or under `metadata:`) and captures each as
a `user`-scope candidate (`topic` `import/<note-name>`, artifact source = note path + sha256, evidence `derived`).
Run it on a schedule: an unchanged note maps to its existing record (also a retracted one, so a dropped import does
not come back); an edited note becomes a new candidate and the old one is marked `source_changed`. Notes the store
rejects (sensitive data) are listed under `failed`. The owner reviews each candidate; when one is really about a single
codebase, root captures the approved text with project scope and a user source, and retracts the imported candidate.

## Tests

`npm run test:agent-maturity`. Store tests run the real CLI on temp `--store`/`--vault` folders and are skipped
when the bundled Python or the CLI is missing. With `AGENT_MATURITY_TEST=1` the wrapper refuses the real store,
vault and `~/.claude`; a test also compares sha256 of the real `memory.sqlite3` and the whole vault before and after.
