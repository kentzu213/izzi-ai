# MKT-03 beta.67 generation integration closure

Date: 2026-09-04 (Asia/Ho_Chi_Minh)

## Route

- Technical tier: T3 because the change touches billing identity, auth authority, packaging, and release operations.
- `relaxed_mode` was used under the user's exact authorization phrase `cho phép nới rule`; Claude Code was unavailable due to usage limits.
- Codex performed implementation integration, independent verification, release, installation, and reporting. ChatGPT web was not used.

## Delivered

- Backend generation consumes billing identity returned by the server-owned quota reservation receipt.
- The public quota endpoint still filters billing identity from customer responses.
- Local packaged staging uses one loopback-only fake Codex LB and validates one generation call, seven distinct drafts, one quota unit, one usage log, and one charge.
- The desktop native Marketing client follows the selected runtime profile authority and admits loopback HTTP only for the explicit local staging profile.
- Desktop version advanced to `1.14.0-beta.67`.

## Evidence

- Backend: build and test typecheck pass; 150 test files passed, 1,736 tests passed, 94 skipped; PostgREST Marketing checks passed.
- Desktop: lint and production build pass; 127 test files and 1,770 tests passed.
- Packaged Customer Marketing safety core passed with zero network attempts, zero secret leaks, and zero external actions.
- Final local packaged receipt: `F:\Ai Tools\Codex\Temp\izzi-backend-cmr-generation-integrate-20260904\test-results\beta.67-local-final.json`.
- Backend PR: `kentzu213/izzi-backend#29`; merge commit `85507592d2311746449ad82a5d930d3f89831b60`.
- Desktop PR: `kentzu213/izzi-ai#26`; merge commit `7db596054627d4390e4477cc2102989b639edc29`.
- Release: `v1.14.0-beta.67`, public prerelease, 12 assets; release workflow `33861210073` passed.
- Windows installer SHA-256: `1cea41ddcede4af0ddb41d3471dff35cfa00fdd8faf8961b210ef24b44e9984c`.
- Installed registry version and file version are `1.14.0-beta.67`; the installed app launched from `F:\IzziAI\Izzi\Izzi AI.exe` and remained responsive.

## Safety and next gate

- No live model/provider call, publish, spend, bulk send, or credential mutation occurred.
- The backend merge has not been deployed to production. Its GitHub workflow is verification-only.
- Production readiness currently lacks deploy auth and the PostgreSQL backup/restore CLI tools. MKT-05 remains `pending_external` until a disposable staging host, allowlist, secret owner, rollback command, migration digest, and reviewer sign-off are available.
