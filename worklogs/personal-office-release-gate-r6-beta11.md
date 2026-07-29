# Personal Office Release Gate R6 — beta.11 safe media refresh

Date: 2026-07-29

## Outcome

R6 is ready for W0 exact-path integration at implementation commit
`5e95aede3bce316d4d709bafa00ddfead2cdd66a`.

The external beta.11 draft was not replayed. Its manifest-declared
`legacy_ids` behavior failed security review because untrusted project data
could remove unrelated jobs, artifacts, and approval evidence.

## Implemented behavior

- The main-process runtime derives a private `sourceIdentity` from the
  authenticated workspace ID and canonical `realpath`.
- Canonical path case is preserved. On case-insensitive volumes `realpath`
  supplies one canonical path; on case-sensitive directories distinct paths
  remain distinct.
- Re-import from the same source replaces only that source's prior media chain,
  even when the manifest project ID changes.
- A forged project ID or legacy lineage claim from another source cannot delete
  prior history.
- Preview success and failure results are discarded if their job was replaced
  while the asynchronous preview was running.
- Customer Marketing displays the service-provided import/update message.
- Desktop version is `1.14.0-beta.11`; no dependency or lockfile change.

## Verification

- focused Customer Marketing: 164/164 PASS;
- full desktop: 122 files, 1364/1364 PASS;
- main TypeScript: PASS;
- production build: PASS, existing large-chunk advisory only;
- lint: 0 errors / 297 warnings, ceiling 358;
- ownership: exactly seven leased paths;
- diff/check, prohibited path, conflict marker and secret scans: PASS;
- GitNexus: 10 changed symbols / 139 affected processes / critical, covered by
  focused/full verification;
- Socrates: PASS after correcting canonical-path case handling and adding
  rename/collision regressions.

## Isolation

The mutable source worktree advanced externally during R6 and ended at
`ac0e17cd52e6252e3b0dbd2d3839f748f13843ba`. It was read-only evidence and its
final bytes were not used.

Quarantine remained read-only at `959e2d28`. Temporary dependency junctions
were removed. Vite recreated a four-entry ignored `.vite` cache under the
producer worktree; it contains no tracked or release artifact.

## Skill application

- `/context-gatherer` and `/understand-codebase`: bounded the source delta and
  canonical ownership before writing.
- `/backend-patterns`: kept replacement authority and persistence inside the
  main-process service boundary.
- `/frontend-patterns`: limited renderer work to displaying the existing
  `CustomerMutationResult.reply`.
- `/security-review`: blocked manifest-controlled deletion and required
  workspace-bound service-owned continuity.
- `/verification-loop`: required focused/full tests, TypeScript, build, lint,
  diff, ownership, prohibited-path and secret checks.
- `Design`, `/gpt-taste`, `/design-taste-frontend`, and
  `/stitch-design-taste`: no visual redesign was needed; the existing feedback
  pattern was preserved.
- `/search-first`, `/quick-spec`, and `/deployment-patterns`: used for scope
  gating; no web dependency research, deployment or production mutation was
  authorized.

## Prohibited actions

No push, tag, publish, deployment, installer execution, package installation,
secret retrieval, GitHub environment mutation, DB/schema change, browser
automation enablement, quarantine write, or external source-worktree write
occurred.
