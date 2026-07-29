# Loop 12 quick spec

## Intent

Provide a real Marketing Workspace reference implementation on top of accepted
Customer Marketing and Personal Office capabilities, optimized for one operator and
reversible to the legacy room.

## Scope

- In: versioned Marketing Workspace blueprint/read model, pure migration and rollback
  adapters, four-surface UI, three-group Setup, Customer Marketing route compatibility,
  host-evidence Marketplace bridge, sandbox journey and responsive/a11y verification.
- Out: real social publish, ad spend, bulk send, destructive delete, new dependencies,
  database-schema changes, credential transport, team-management redesign, production
  deployment and hidden release-hardening features.

## Requirements

1. WHEN existing Customer Marketing data is migrated, THEN profile, runs, approvals,
   resources and artifacts are preserved and credentials are represented only by refs.
2. WHEN the reference workspace renders, THEN the primary navigation contains exactly
   Brief, Work, Deliverables and Approvals.
3. WHEN setup opens, THEN only Context, Connections and Automation are top-level groups,
   with required-now, capability-specific and deferred status made explicit.
4. WHEN an external action is requested, THEN it cannot execute without a persisted
   matching approval and exact scoped grant; a sandbox receipt must never claim a real
   external effect.
5. WHEN a host-validated Marketing package installation completes, THEN the bridge
   provisions or reuses the exact scoped workspace and returns a safe open-workspace
   intent. A plan or demo record alone is denied.
6. WHEN the rollback flag is selected or migration proof fails, THEN the legacy Customer
   Marketing route remains usable with original data.
7. WHEN the app restarts, THEN the migrated reference state can be reconstructed without
   loss or secret material.

## Tasks

- [ ] Record route/component/state/progressive-disclosure maps.
- [ ] Add versioned blueprint and strict parsers.
- [ ] Add lossless migration, restart serialization and rollback projection tests.
- [ ] Add host-evidence Marketplace provisioning/open bridge.
- [ ] Compose four primary surfaces and three-group Setup from existing capabilities.
- [ ] Preserve legacy route behind a separate rollback flag.
- [ ] Add sandbox journey, responsive and accessibility tests.
- [ ] Run independent design, security and Socrates review.

## Verification

- Targeted migration, blueprint, bridge, journey and renderer tests with no cache.
- Main and renderer TypeScript.
- Full desktop tests, production build and lint ceiling.
- Secret and prohibited-path scan.
- GitNexus compare and exact ownership audit.
- Browser screenshots/checks at 1440x900, 1024x768 and 390x844, plus 200% zoom and
  reduced motion.
