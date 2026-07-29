# Customer Marketing Small Release Rule

Updated: 2026-07-29

Every Customer Marketing change must finish one bounded release slice before a
new task starts.

1. Reproduce one user-visible problem or select one measurable deliverable.
2. Implement the smallest complete change using the existing product boundary.
3. Run focused tests, affected full tests, typecheck, build, and UI smoke checks.
4. Review the diff, push `main`, and publish a new GitHub version.
5. Launch the packaged version on the local machine, not the source preview.
6. Experience the real workflow on desktop and mobile-sized viewports.
7. Patch only failures that are reproduced or regressions that are measured.
8. Record release evidence, remaining gates, rollback, and the next single slice.

The cycle is incomplete if code exists only in a worktree, if no public version
was created, or if the packaged application was not exercised after publishing.

External marketing publish, spend, bulk send, credential mutation, destructive
actions, staging, and production deploy still require their own explicit gates.
