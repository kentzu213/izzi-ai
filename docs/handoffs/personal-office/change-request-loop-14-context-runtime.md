# CHANGE_REQUEST — Loop 14 authenticated Live/context agent turn

Status: `APPROVED`
Requester: W0 Control Tower / Codex
Lease: `LEASE-L14-CONTEXT-RUNTIME-20260729`
Decision authority: W0

## Target

- `apps/desktop/src/main/context/agent-turn-context.ts`
  - add a main-only orchestration boundary that resolves one exact
    workspace/owner Live profile, compiles the accepted context package and
    captures Work snapshot metadata;
  - keep the workspace root under app `userData` and derive its directory from
    a non-PII scope hash.
- `apps/desktop/src/main/context/agent-turn-context.test.ts`
  - prove exact scope, Live.md initialization/read, raw-request binding,
    classification failure and metadata-only snapshot capture.
- `apps/desktop/src/main/index.ts`
  - require a trusted top-level renderer and authenticated owner before the
    host-agent provider path;
  - bind the canonical `personal` workspace in main;
  - compile with the exact trusted host safety prompt and exact outgoing text;
  - pass the verified kernel input into the existing optional host-agent seam.

## Reason

Loop 04 implemented revisioned Live.md and Loop 05 implemented the deterministic
compiler, prompt kernel and Work snapshot adapter, but no production caller
supplies authenticated workspace/owner scope. The current custom host-agent IPC
therefore reaches provider access without Live context, and it also trims the
message before the exact-request binding can be established.

## Intended patch

1. Derive owner authority only from `AuthManager.getCurrentUser()` and convert
   the raw user id to the existing stable reviewer hash. Renderer input never
   supplies owner or workspace identity.
2. Use only the canonical local workspace `personal`; verify its persisted
   workspace kind in main.
3. Place Live.md under
   `userData/personal-office/live/<scope-sha256>/Live.md`. The directory name
   contains no raw user id and cannot traverse.
4. Initialize a minimal `personal_graph` Live.md when absent, otherwise parse it
   with the exact scope.
5. Compile exactly one protected safety source, one exact raw current-request
   source, the fixed workspace policy and effective Live directives.
6. Persist only context snapshot metadata through the accepted Work repository.
   Never persist the safety prompt, raw request or rendered context segment.
7. For agent mode, reject untrusted sender, unauthenticated owner, wrong/missing
   workspace, multimodal context, invalid Live.md, forbidden classification or
   snapshot mismatch before provider access.
8. Keep plain non-agent chat behavior and all provider routing/tool approval
   behavior unchanged.

## Security decision

- `main/index.ts` is a hot file and is leased only for the bounded
  `customProvider:chat` context wiring and imports.
- AuthManager, WorkService, compiler, kernel, Live contract/service,
  host-agent, DB/schema, preload, renderer, packages and runtime adapters remain
  read-only.
- The unkeyed context hash is integrity evidence, not identity authority;
  authority comes from the trusted main-process auth/session and fixed
  workspace selection.
- No raw user id, credential, token, absolute artifact path or context body is
  returned to renderer or stored in Work snapshot metadata.
- No push, deploy, install, browser automation enablement or secret retrieval
  is authorized.

## Proof

1. New runtime tests cover empty-profile initialization, effective Live
   directives, foreign-scope rejection, `local_files` egress rejection,
   unknown workspace rejection and snapshot metadata.
2. Existing host context tests prove exact safety/request binding and
   pre-provider rejection.
3. Main and renderer TypeScript, targeted tests, full desktop tests, production
   build and lint ceiling pass.
4. GitNexus `detect-changes`, exact ownership/prohibited-path audit,
   `git diff --check`, added-line secret scan and quarantine fingerprint pass.
