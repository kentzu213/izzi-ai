# Personal Office programme completion audit — post R6

Status: `LOCAL_FOUNDATION_ACCEPTED_PRODUCT_INCOMPLETE`

Audit time: 2026-07-29T20:45:00Z

Canonical ref: `feature/personal-office-baseline-20260728`
Audited head: `b2a67941ae476778cb26fd5e78f6af42fc9762bd`

## Verdict

Loops 00–12 and release reconciliations R–R6 are accepted as reviewed local
artifacts. That does **not** prove the product described by the original
Personal Office brief is complete.

The canonical tree contains the contracts, shell, Work engine, Live/MyGraph
model, context compiler, model gateway, capability registry, plan-only
Marketplace/provisioning/grant contracts, runtime security foundation and a
Marketing reference workspace. Several operational seams are deliberately
empty or demo-only.

## Requirement matrix

| Requirement | Current evidence | Verdict | Missing evidence |
| --- | --- | --- | --- |
| A deeply personalized single-operator office | Loop 02 ships the five-route shell and four workspace surfaces. Loop 04 ships revisioned Live profile and MyGraph projection. Loop 08 ships workspace blueprint planning. | **PARTIAL** | `resolveDataSource()` still returns demo or empty data; no real workspace bootstrap/create flow exists. |
| User delegates work while agents execute and tabs only expose progress | Loop 03 Work engine, preload API and authorized IPC are registered. Runs, events, approvals, lineage and artifacts are durable and tested. | **PARTIAL** | The shell does not consume `window.electronAPI.work`; it cannot load real runs or delegate a real run from Today. |
| MyGraph + Live.md + skills guide every new job | Loop 04 validates/revisions Live.md. Loop 05 deterministically compiles it with the accepted precedence and has an optional protected host seam. Loop 07 models skills/tools. | **PARTIAL** | No production caller supplies authenticated workspace/owner scope and the exact safety prompt to the context kernel before an agent/model turn. |
| Installing a Market app automatically creates/synchronizes a Custom Workspace and account environment | Loop 07 validates capabilities. Loop 08 creates plan-only workspace provisioning. Loop 09 creates plan-only install intent. Loop 10 creates secret-free grant/revocation planning. Loop 12 can open an already installed, host-validated Marketing package. | **NOT ACHIEVED** | Marketplace still displays non-installable demo records. Download/signature/install, account/OAuth sync, grant persistence, workspace provisioning and activation are not operational. |
| Localhost or isolated browser runtime lets agents operate apps safely | Loop 11 provides scoped runtime contracts, native/Docker/browser foundations, encrypted state and atomic effect claims. | **PARTIAL FOUNDATION** | Production constructs `RuntimeManager([], denyAllRuntimeAuthorization)`. No production Playwright driver, native resolver or approved runtime adapter is registered. |
| Build quality and local security baseline | R6 canonical verification: focused 164/164, full desktop 1364/1364, TypeScript PASS, production build PASS, lint 350/358, exact-path provenance and secret/prohibited-path scans PASS. | **ACHIEVED LOCALLY** | Platform installer/signing and protected release-environment evidence remain external gates. |

## Direct code evidence

- `apps/desktop/src/renderer/shell/workAdapter.ts`:
  `resolveDataSource(isDemo)` returns `createFakeDataSource()` or
  `createEmptyDataSource()` and never reads the registered Work preload API.
- `apps/desktop/src/main/preload.ts` and `main/work/work-ipc.ts`:
  the real workspace-scoped Work API already exists and supports list/get/create,
  approvals, resume and event subscription.
- `apps/desktop/src/renderer/pages/Marketplace.tsx`:
  `loadDefaultMarketplaceCatalog()` explicitly reports that no leased
  host-validated catalog bridge exists and returns non-installable demo records.
- `apps/desktop/src/main/index.ts`:
  runtime production initialization is
  `new RuntimeManager([], denyAllRuntimeAuthorization)`.
- `docs/product/personal-office-context-kernel.md`:
  the compiler is optional and has no production source of authenticated
  workspace/owner plus trusted safety prompt.

## Continuation roadmap

### Loop 13 — Real Personal Office work bridge and first workspace

Connect the shell to the existing authorized Work preload API, add a truthful
single-operator workspace bootstrap/read model, remove the fake fallback
workspace from production delegation, and prove Today can create and observe a
real durable run.

### Loop 14 — Live context to authenticated agent turn

Load the exact workspace-owner Live profile in main, compile context with the
accepted precedence, bind it to the raw request and trusted safety prompt, save
snapshot metadata, and fail closed before provider access on scope mismatch.

### Loop 15 — Host-validated Marketplace and provisioning orchestrator

Replace demo catalog loading with an audited main-process catalog bridge. Apply
an unchanged install plan through package-byte/signature verification, Work
approval, exact grants and workspace provisioning. Report partial failure
truthfully; never equate a plan receipt with installation.

### Loop 16 — Account and IntegrationGrant operation

Bind izziapi identity to tenant/user/workspace scope, execute OAuth/connect and
revocation behind approval, persist only `SecretRef`, and make the grant vault
the runtime authority.

### Loop 17 — Production isolated runtime adapters and install-to-open E2E

Register only attested runtime adapters. Add an isolated Playwright driver that
enforces URL authorization on every request/redirect, encrypted storage state
and atomic external-effect claims. Verify Market → install → provision → open
workspace → delegate → approve → collect artifact.

## Release boundary

No item above authorizes push, tag, publish, deployment, installer execution,
secret retrieval, GitHub environment mutation or stable promotion. Those remain
separate platform gates after the local product path is operational.
