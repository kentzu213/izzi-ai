# Changelog — Izzi AI Desktop
## 1.14.0-beta.27

Customer Marketing workspace sync and packaged Video Studio hardening.

- Reuse one main-process-owned idempotency key for concurrent or retried
  invitations to the same recipient, rotate it after terminal outcomes, and
  keep it out of renderer responses and persisted state.
- Upgrade Electron, the native SQLite runtime, the desktop builder, Vite, and
  React Router while keeping the production dependency audit at zero known
  vulnerabilities.
- Keep the complete HyperFrames runtime dependency graph beside its unpacked
  CLI so packaged Windows builds can resolve PostCSS and render without a
  separate HyperFrames installation.
- Verify the packaged Electron 39 / Node 22 runtime with HyperFrames 0.7.57,
  the pinned Chrome Headless Shell, FFmpeg, eight retained F5-TTS preview clips,
  and a 60-second portrait MP4 while preserving the non-commercial render gate.

## 1.14.0-beta.24

Voice Studio 0.2 local TTS hardening and automatic extension upgrade.

- Install or upgrade the bundled Voice Studio extension before repair, retain
  only declared grants, and coalesce concurrent starts.
- Pin VieNeu-TTS 3.2.3, model and codec revisions, four audited presets, strict
  PCM WAV output, and reject reference audio or voice-cloning inputs.
- Require the full runtime readiness contract, immutable loopback Compose
  configuration, local Docker context, and a digest-pinned multi-arch image.
- Make the required OCX fail closed during packaging and publish the backend
  with a hash-locked dependency set, SBOM, provenance, and GitHub attestation.
- Patch the remaining high-severity `brace-expansion` v2 dependency advisories.

## 1.14.0-beta.23

Windows background update delivery.

- Configure installed packages to download an available desktop update in the
  background after a successful update check.
- Install a downloaded update on the next normal app quit while retaining the
  existing Restart action for users who want to apply it immediately.
- Preserve the unpacked-directory, development, and mock updater safeguards so
  local builds never contact the public release channel unexpectedly.
- Raise the patched `js-yaml`, `fast-uri`, and `nanoid` dependency floors used
  by the updater, desktop settings validation, and bundled HyperFrames stack.

## 1.14.0-beta.15
Memory trace layer, first slice.
- Add the trace unit contract: an append-only observation that must carry a
  resolvable origin. A unit without provenance is refused, not stored with a gap.
- Add `Live.md` in the user data directory as the one memory file the operator
  edits by hand. It is created from a template on first run, and an existing or
  unreadable file is never overwritten.
- Add a narrow data classification for this layer: the live profile never leaves
  the machine, and an interaction trace may only ever leave as redacted metadata.
- No language model participates in reading or writing memory. Every operation
  here is deterministic.
## 1.14.0-beta.14
Customer Marketing guardrail hardening patch.
- Halt every gated action when no guardrail reader was wired, instead of running
  the gate unguarded. This was the only fail-open path in the guardrail.
- Treat a set-but-empty `IZZI_MARKETING_KILL_SWITCH` as intent to halt, so a
  variable set from a form or CI field cannot read as no halt.
- Contain a cap evaluation failure as a policy denial rather than letting it
  surface as a rejected call.
## 1.14.0-beta.13
Customer Marketing loop guardrails patch.
- Add an operator halt that stops every gated marketing action - publish, spend,
  bulk email, destructive - from a flag file in the user data directory or an
  environment flag. The halt is re-read on every gated request, so it applies
  immediately and outranks a valid approval.
- Read the halt before request validation and before any database, authority, or
  gateway access, and engage it when the flag cannot be read.
- Add product spend and volume caps well below the structural request maxima,
  checked only after the caller's authority is established so the response cannot
  be used to read the configured limits back out.
- Refuse spend while no spend ledger exists instead of treating a missing ledger
  as zero spend for the window ceiling.
- Document the halt, the caps, and their known limits in
  docs/OPERATIONS-MARKETING-KILL-SWITCH.md.

## 1.14.0-beta.12

Customer Marketing local F5-TTS discovery patch.

- Discover the already installed ViVoice runtime from bounded HyperFrames
  project roots under the user's local Documents or OneDrive Documents folder.
- Require the Python environment, F5 source package, checkpoint, vocabulary,
  and Vocos files before reporting the runtime as installed.
- Preserve the explicit environment-based configuration as an authoritative
  override while keeping invalid partial configuration fail-closed.
- Return only public provider, model, version, and license metadata to the
  Marketing Room; local paths remain in the main process.
- Keep ViVoice non-commercial and synthesis/render gates locked. Discovery
  performs no inference, process launch, download, upload, or publish action.

## 1.14.0-beta.11

Customer Marketing media re-import refresh patch.

- Refresh an existing canonical media project on re-import by replacing its
  prior jobs and linked approval/artifact evidence with one fresh pending
  preview chain while preserving unrelated workspace state.
- Allow an explicitly declared legacy project ID to migrate a renamed guide
  without leaving the old branded job visible, and label the result as an
  update in Video Studio.
- Restrict legacy replacement to the app-approved Izzi AI guide migration and
  merge completed imports into the latest tenant record so concurrent imports
  cannot delete one another.
- Discard an in-flight preview result when the project was re-imported before
  that preview finished, preventing stale jobs or evidence from returning.

## 1.14.0-beta.10

Customer Marketing long-path snapshot patch.

- Create each HyperFrames `HOME`, cache, temp, working directory, and snapshot
  staging area under an atomic short-lived system-temp profile, avoiding nested
  Chrome/fontconfig paths that can exceed the Windows legacy path boundary.
- Validate staged PNG and contact-sheet bytes before copying them with
  no-overwrite writes into the durable preview run, then validate the persisted
  files again before returning artifact evidence.
- Remove the short-lived staging directory after success or failure while
  preserving the existing scrubbed environment, process-tree cleanup, and
  commercial-render lock.

## 1.14.0-beta.9

Customer Marketing managed HyperFrames preview patch.

- Verify the bundled HyperFrames `0.7.57` package and CLI before exposing
  preview readiness.
- Use the packaged Electron runtime for local check/snapshot work when a
  compatible system Node runtime is unavailable. This managed path remains
  preview-only and cannot enable commercial render.
- Discover an existing HyperFrames Chrome Headless Shell without downloading
  or installing a browser from Izzi AI.
- Run HyperFrames with a scrubbed environment, isolated runtime profile,
  bounded output, timeout, process-tree cleanup, and output containment under
  `preview-runs`.
- Capture snapshots at scene midpoints from `video-workflow.json`, avoiding
  blank frames at timeline and scene boundaries.
- Keep generated preview paths below the Windows legacy `MAX_PATH` boundary by
  using compact timestamped run IDs, including under long or Unicode roots.
- Preserve the existing Voice Studio commercial-license contract for an
  explicitly configured and verified system Node runtime. F5 ViVoice remains
  blocked for commercial use under its noncommercial license.

## 1.14.0-beta.8

Customer Marketing reviewer-identity patch.

- Show the authenticated account name that will sign the next Product Marketing
  Context revision before the user saves it.
- Keep reviewer authority in the main process, expose only the display name and
  save permission, and disable context saving for roles that cannot update it.
- Bind the displayed signer and backend-confirmed role to an opaque,
  revision-bound authority contract; stale identity, role, workspace, or
  context revisions now fail closed without changing the draft.
- Reset unsaved context state when the authenticated account or workspace scope
  changes, preventing a draft from crossing tenant boundaries.
- Add a direct account-settings action so the signer name can be corrected before
  a new evidence digest and revision are created.

## 1.14.0-beta.7

Customer Marketing quota-label patch.

- Label the workspace monthly quota as `credit/tháng` so it cannot be read as
  a duration in months.

## 1.14.0-beta.6

Packaged updater and prerelease metadata patch.

- Treat electron-builder directory packages such as `win-unpacked` as local
  smoke builds when `app-update.yml` is absent, so they do not show a false
  updater error.
- Keep missing update configuration actionable for installed packages while
  replacing raw local filesystem paths with a stable user-facing error.
- Recognize Windows, Linux, and the original electron-builder macOS release
  directories. A macOS `.app` moved out of `release/mac-*` remains treated as
  an installed package because it cannot be distinguished safely from a
  damaged installation.
- Keep prerelease update-channel detection explicit. For the public GitHub
  provider, beta selection comes from prerelease tags and the updater accepts
  the release-local `latest.yml` metadata by design.
- Publish version tags containing a prerelease suffix as GitHub prereleases on
  both Windows and macOS jobs.

## 1.14.0-beta.5

Customer Marketing Product Context release.

- Add a bilingual, reviewer-owned Product Marketing Context with canonical
  SHA-256 evidence, HTTPS sources, approved proof claims, and prohibited claims.
- Bind the context revision and digest to every durable strategy workflow, job,
  artifact, approval, and AI Director prompt; stale approvals remain pending.
- Add the operational Brand Center editor with draft preservation, optimistic
  revision checks, explicit conflict recovery, cross-navigation draft continuity,
  and responsive layouts.
- Require AI Director product claims to cite an approved Product Context proof
  claim ID before approval evidence can be replaced.
- Keep reviewer identity, tenant scope, digests, and durable workflow authority
  in the main process. Publish, spend, bulk email, and integration mutation stay
  disabled.

## 1.14.0-beta.4

Windows identity and icon patch.

- Pin the visible title and Windows AppUserModelID to Izzi AI without changing
  Electron's internal app name or the existing user-data location.
- Generate a multi-resolution Windows ICO from the approved cyan `S` artwork
  and use it for the executable, installer, shortcuts, and main window.
- Rename the remaining in-app logo accessibility label from Starizzi to Izzi AI.

## 1.14.0-beta.3

Cross-platform Voice Studio runtime hotfix.

- Resolve extensionless bundled executables such as the macOS Node runtime as
  files instead of directories.
- Add regression coverage for extensionless runtime files and dotted directory
  names before publishing the desktop patch.

## 1.12.1

Starizzi SmartRouter/direct-routing hotfix.

- Retry a known 400 streaming limitation in non-stream mode, so GPT-5.6 Sol and Grok 4.5 keep working through production endpoints that temporarily reject streaming.
- Added hosted Izzi API direct preset and explicit GPT-5.6 Sol exposure in the model catalog/setup wizard, so users can switch between SmartRouter and direct model routes without local router reconfiguration.
- Stamp Izzi-bound requests with the Starizzi source header for cleaner production attribution and canary tracing.

## 1.12.0

SmartRouter/Grok compatibility and a safe Codex-LB desktop cutover.

- The managed Izzi route now sends the canonical `izzi-smart` model by default;
  legacy `izzi/auto`, `izzi-auto`, and `auto` sessions migrate transparently.
- Added explicit `grok-4.5-high` selection plus the direct 9Router upstream id
  `gcli/grok-4.5-high` where custom/local endpoints are configured.
- On first launch, an enabled legacy Codex-LB config is migrated only when it is
  plain HTTP on a loopback host at port `2455`. It is disabled so chat falls back
  to Izzi SmartRouter, while its saved config and encrypted key remain untouched.
  Hosted endpoints, other ports, and later explicit local reconnects are preserved.

## 1.11.0

Voice Studio — first fully on-device managed-service extension.

- New **Voice Studio (VieNeu-TTS)** extension: text-to-speech + zero-shot voice
  cloning for Vietnamese & English, running **fully on-device** (CPU/ONNX, offline
  after the model downloads). Opening it boots a local FastAPI backend through the
  managed-service pipeline (docker compose, health-gated on `/health/ready`,
  loopback-only, no secrets) — reusing `LocalServiceManager` +
  `ExtensionServicePanel`. Falls back to `VOICE_BACKEND_URL` when Docker is absent.
  Voice cloning requires consent (enforced by policy + model license).
- CI: `publish-voice-image.yml` builds/pushes the `izzi-voice-tts` image (multi-arch).
- `before-pack` now bundles **every** extension under `extensions/*` (not just one).
- Marketplace: the Vietnamese voice entry now maps to the installable Voice Studio.

## 1.10.1

Marketplace catalog — real izzi tools + best-in-class picks (quốc tế + Việt Nam).

- Listed the real izzi tools: **Chat Quality Agent (CSKH)**, **Toonflow Studio**,
  **OmniVoice TTS**, **HTML to Video**, plus installed desktop tools (**AI Video
  Studio**, **FaceFusion**, **Quick Magic**). Added **Video** + **Voice**
  categories; `social-auto-poster` bumped to 0.3.0 to match the shipped manifest.
- Curated the best-in-class options next to the existing ones: **Chatterbox Voice
  (v3)** + **VieNeu-TTS (Việt)** for voice; **LTX-2 Video** + **MCAI (Việt)** for
  video; **Postiz** for social scheduling. Replaced the weak FB Ads scripts with
  **Meta Ads Autopilot** (Revealbot/Madgicx-class AI bidding + rule automation).

## 1.10.0

Managed local backends for extensions + "Loop Prompt" self-install.

- **Managed local service for extensions.** An extension can now declare a
  `service` block in its `.ocx` manifest; opening the extension boots its backend
  on the user's machine via `docker compose` (health-gated on `/health/ready`,
  every port bound to loopback, secrets generated locally at 0600) and injects the
  resolved `backendUrl`. New `LocalServiceManager` (main process) drives the
  compose lifecycle, generalizing the single-container `DockerAgentService`.
- **Social Auto Poster local profile.** Ships `docker-compose.izzi.yml`
  (Postgres/Redis/MinIO + api/worker + one-shot migrate) using prebuilt images
  published by CI; falls back to the hosted Auto-Post backend when Docker is
  unavailable.
- **Loop Prompt (Tự cài đặt).** Agent Hub cards (Top Agents + Izzi Agents +
  Installed), the Marketplace tool cards, and the extension detail page get a
  "⟳ Tự cài" action that opens an agent chat pre-seeded with a self-install
  instruction (assess → act → verify → retry). The prompt is seeded into the
  composer — never auto-sent — so installing stays a deliberate user action.

## 1.5.2

Bug-fix release on top of 1.5.1.

- **Extension permissions are granted correctly on load.** A first-party
  extension loaded straight from disk on startup (never through the install flow)
  was given an EMPTY permission set, so every `ctx.storage` / `ctx.net` / `ctx.ui`
  call was denied — meaning Social Auto Poster could reach "running" but its
  commands couldn't read their config or call the aitoearn backend, and the
  dashboard panel was blocked. Now the loader falls back to the manifest's
  declared permissions (the same default the install flow uses) and persists them.
  (The dashboard panel still needs a ready window to render; that UI-timing piece
  is tracked separately — it does not affect the commands/tools.)
- **Stabilized a flaky test** (`managed-agent-provider`): its cold dynamic
  `import()` could exceed vitest's 5s default under parallel/CI load — given
  explicit headroom so it can't spuriously redden CI.

## 1.5.1

Bug-fix release on top of 1.5.0.

- **Extension host no longer crashes on startup.** The forked extension runner
  (`extension-runner.js`) could not be executed from inside `app.asar`, so
  extensions (e.g. Social Auto Poster) crash-looped and never reached "running" —
  meaning their commands were never exposed as agent tools. The runner is now
  `asarUnpack`'d and the fork path resolves to the unpacked copy. Also fixed an
  `OPENCLAW_EXT_ID/PATH` env var name mismatch between host and runner.
- **Desktop CI is green again.** `packages/agent-bundle`'s ESM tsconfig set
  `module: ES2020` while inheriting `resolveJsonModule` with no `moduleResolution`
  (TS defaulted to `classic` → TS5070), which broke `pnpm -r build` on every push.
  Added `moduleResolution: node`.

## 1.5.0

A large agent + second-brain update: multi-agent chat now streams its live
process, persists across restarts, and records finished work into the personal
knowledge graph and the Replay-tasks board — so every surface connects as one
system. Also ships the first sellable, agent-callable Marketplace utility.

### Agents & chat
- **Izzi-native persona agents** (Socrates, Orchestrator) run directly through the
  Izzi API — no Docker, instant "install"; the Izzi key stays in the main process.
- **Docker agents (Hermes) route through the Izzi smart router** via a local
  main-process proxy — the Izzi credential never enters the container.
- **Live process streaming**: Hermes replies stream over SSE (its `tool_progress`
  rides in as content); izzi personas emit structured tool-call steps. A collapsible
  "reasoning" panel shows model thinking when available.
- **Chat history persists across restart** (SQLite `user_data`): tabs, messages,
  steps and reasoning are restored on launch; interrupted turns normalize to done;
  closing a tab removes its stored copy. No secrets are ever persisted.
- **Reasoning-effort picker** for Hermes (low / medium / high / xhigh) and a longer
  (10 min) chat timeout for slow agentic turns.
- Fixes: agent status refresh on the Chat page; Hermes 1-click install health probe
  runs from main; "Chat Now" jumps to the Chat page.

### Marketplace & extensions
- **Social Auto Poster** — the first sellable utility: schedules/posts to a Facebook
  Page via the locally-installed aitoearn backend, and is callable by izzi agents
  through the agent → extension tool bridge. (Facebook *Group* posting is not
  supported — Meta blocks third-party group posting APIs.)
- Extension **config form + command runner + pricing/buy UI** for installed utilities.
- **Offline install** for first-party utilities; disk-loaded extensions correctly
  show as installed in the Marketplace.

### Second brain (cohesion)
- Every finished agent turn is recorded into **my-graph** (a session node linked to a
  per-agent hub — no orphans) and the **Replay tasks** board (a `done` task), so agent
  work shows up alongside the rest of the workspace. Both writes are fail-closed.

### Security
- A durable `izzi-` key is auto-minted for agent LLM calls; credentials stay in the
  main process and are never logged or written to the graph/persisted chat.

_Baseline: 1.4.3. Verified with the full test suite (282 tests from
`pnpm --filter @openclaw/desktop test`), main + renderer type-checks, and the
renderer build._
