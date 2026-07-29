# Personal Office Loop 16 — account and IntegrationGrant operation

Status: `READY_FOR_REVIEW`

Canonical base: `8fbb27fec5cc3a203fcfa659179a925b7187479e`

Producer branch: `feature/personal-office-loop-16-20260729`

Implementation commits:

- `22a8a089673d67183d6f93d9d310688da57482a3`
- `40a8a3c077ea2e799913545322ada3bd4f56bb73`
- `f992302aff3a07ecf00aeab0616550e0c9c57f1b`

## Outcome

Added a main-only operation service for exact integration connect and
revocation. It derives scope through an injected authenticated authority,
requires approval bound to the exact action/operation/scope, accepts only an
`integration_vault` `SecretRef`, verifies the accepted `GrantVault` before
persistence, and returns stable secret-free receipts.

Remote effects receive the deterministic operation id for idempotency.
Post-connect vault or persistence failure triggers best-effort remote and vault
compensation. Revocation is ordered remote → vault → metadata; partial local
failure marks the grant invalid and never reports success.

## Security review

`SECURITY GATE: account/OAuth/grant vault — PASS_FOR_W0_REVIEW`

- no renderer-supplied tenant, user, workspace or grant identity;
- no raw token/password/OAuth-code field in contracts or receipts;
- malformed evidence digests and credential-shaped approval ids are omitted;
- adapter exceptions map to stable codes without returning exception text;
- no effect before exact approval;
- no active grant before exact vault resolution;
- no DB/schema, auth, legacy integration IPC, package, renderer or runtime edit.

The `security-review` skill drove the secret, validation, authorization and
error-disclosure checks. The `backend-patterns` skill drove the injected
authority/service/repository/connector separation and compensating failure
paths. The `verification-loop` skill defined the final test/type/build/lint,
security and diff matrix. Orchestrator, builder and Socrates responsibilities
were performed in-process; Kiro and child agents had no writer authority.

## Verification

- focused Vitest: 1 file, 10/10 tests;
- full desktop Vitest: 128 files, 1398/1398 tests;
- main TypeScript: pass;
- renderer TypeScript: pass;
- production build: pass, 1176 modules, existing large-chunk advisory only;
- changed-surface ESLint: 0 warnings;
- repository `lint:ci`: 0 errors, 350 warnings, below ceiling 358;
- `git diff --check`: pass;
- ownership audit: six implementation paths, all owned;
- prohibited paths: zero;
- secret scan: only deliberate negative-test/doc wording;
- quarantine: read-only at `959e2d28ece81ceaa1a0f51dde5cc8a0b8d330c5`,
  459 entries, fingerprint
  `90f36adf09cbdbae401a7b1abbf8406ffcde5bbbe4106e576ff63374d89d2f05`.

The Loop 16 worktree used NTFS junctions to the clean canonical toolchain
without install. Root/app `node_modules` directory timestamps remained
unchanged and canonical git status stayed clean.

## Residual boundary

Production OAuth/account, approval, repository and vault adapters are not
registered. No external OAuth flow, secret retrieval, real revocation, push,
deploy, install or browser automation occurred. A separate hot-file change
request is required before `main/index.ts` or preload/IPC composition may use
this service.
