# Documentary Workspace Migration Plan

Move the two YouTube documentary channels currently run through Codex CLI into the izzi desktop app:

- **I Don't Like Trump** — `F:\1 Video Creater\Historical Freedom Chronicles\Trump-Was-Right-Documentary`
- **RuinedAmerica (Lịch sử khoa học Mỹ)** — to be registered in a later phase

## Decisions (2026-09-27)

| Question | Decision |
|---|---|
| Internal tool or customer feature? | Internal first. Channels are hard-coded in `DOCUMENTARY_PROJECTS`. |
| Where does the pipeline code live? | Stays at `F:\`. izzi calls into the project folder; nothing is copied into this repo. |
| Which channel first? | I Don't Like Trump. |

## Phase 1 — Read-only channel workspace (this change)

Module: `apps/desktop/src/main/documentary/documentary-workspace.ts`

- **Activation:** documentary mode turns on when the agent working dir (`permStore.getWorkingDir()`) is the project root or inside it. Matching is case-insensitive on Windows and accepts `/` or `\`. Symlinks are resolved before the check.
- **Tools (all `safe`, read-only, confined to the project root):**
  - `doc_list` — list a folder.
  - `doc_read` — read a text file, 5 MB cap.
  - `doc_search` — literal search with file:line hits; capped by file count, entry count, file size and match count.
- **Secret guard:** the `doc_*` tools refuse secret files: `.env*`, `*.env`, private keys, credential/token files and anything under `.git`.
- **Read-only is enforced in code** (`guardDocumentaryHostTool`), not just stated in the prompt. While documentary mode is active, the host `write_file` and `run_command` are always refused, in every permission mode including `agent-full`. Host `read_file` and `list_dir` are confined to the project root: the path is resolved the way the host tool resolves it, then refused if it leaves the root either lexically (absolute path, `..` traversal, drive-relative `C:x`) or after realpath (junctions, symlinks). Secret paths are refused on both the lexical and the realpath form.
- **Channel profile prompt:** appended to the host agent system prompt through the new `extraSystemPrompt` option on `runHostAgentTurn`. It contains:
  - the channel name and root;
  - a Phase 1 read-only note;
  - heading outlines of the authority docs (`CANONICAL_VIDEO_PRODUCTION_STANDARD.md`, `CHANNEL_BIBLE.md`). `AGENTS.md` in that project is stale and deliberately not used.
- **Wiring:** `apps/desktop/src/main/index.ts` merges the doc tools with the existing autopost tools. `executeExtra` returns `undefined` for anything it does not own, so host tools and autopost behave exactly as before when no channel is active.

### Known limitations

- The guards only apply while documentary mode is active, meaning the working dir is inside a registered channel root.
- The host-read guard checks the path, then the host tool reads it. A symlink swapped in between the two steps could escape the root (a TOCTOU race). This is theoretical in Phase 1 because nothing in documentary mode can write to the project.
- In `agent` mode, the approval prompt runs before the guard. A `write_file` or `run_command` call is shown for approval first and then refused anyway.
- Secret detection is name-based. A secret stored under an ordinary name (for example `notes.txt`) is not detected.
- The project roots are absolute paths on this workstation, so they will not activate anywhere else.

## Phase 2 — Run the pipeline from izzi (next)

- Expose the channel's existing Python pipeline steps (kept at `F:\`) as named, approval-gated tools instead of free-form `run_command`.
- Allow writes only to episode working folders; authority docs and `.env` stay read-only.
- Surface per-episode status (Definition of Done checklist from the production standard).

## Phase 3 — Register RuinedAmerica

- Add its root and authority docs to `DOCUMENTARY_PROJECTS`, and reuse the Phase 1 and Phase 2 tools.

## Phase 4 — Customer feature (only if Phase 1–3 prove out)

- Replace the hard-coded registry with user-configured channels and a UI, and review entitlement and billing.

## Verification (Phase 1)

- Unit tests:
  - `documentary-workspace.test.ts` (20, including host-read escapes: absolute, traversal, drive-relative, junction, Windows name variants);
  - `host-agent.extra-system-prompt.test.ts` (2).
- Smoke test against the real Trump project:
  - the profile prompt builds;
  - `doc_list` and `doc_search` work;
  - `doc_read .env` is refused;
  - activation works for the root and episode subfolders and not for the parent folder.
