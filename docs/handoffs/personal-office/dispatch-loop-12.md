# Loop 12 dispatch - Marketing Workspace reference

## Gate

- Canonical integration ref: `feature/personal-office-baseline-20260728`
- Accepted input head: `65b4279d58f8ab0de76b6b33885178d02ceaf162`
- Loops 02-11: `ACCEPTED`
- Writer: one Codex builder in `F:\Ai Tools\_wt-starizzi-personal-office-loop12`
- Quarantine remains read-only.

## Intent

Turn the existing Customer Marketing Room into the first reference Personal Office
workspace for a solo operator. Preserve real Customer Marketing data and capabilities,
but expose exactly four primary surfaces: Brief, Work, Deliverables and Approvals.
Occasional configuration belongs in Setup under Context, Connections and Automation.

## Hard invariants

1. Existing profiles, runs, approvals, resources and artifacts remain recoverable.
2. Credentials remain references only. No credential value may enter renderer state,
   migration output, Graph, Live.md, logs, receipts or exports.
3. Publish, spend, send and delete never fabricate success and always remain behind
   authoritative approval and scoped-grant checks.
4. Marketplace plan-only state cannot provision. The bridge may auto-provision and open
   a workspace only after host-validated installed-package evidence and exact scope.
5. The legacy Customer Marketing route remains available behind a separate rollback flag.
6. No package, lockfile, database schema, auth or production deployment change.
7. No AIDA, marketing hero, GSAP scroll choreography or new design system. This is a
   dense operator product surface that extends the accepted izzi shell.

## Required pre-implementation artifacts

Before changing UI structure, create `docs/product/marketing-workspace-reference.md`
containing:

- route map;
- component map;
- interaction-state checklist;
- progressive disclosure contract;
- setup matrix with required-before-first-run, capability-specific, deferred,
  health/error owner and mobile presentation;
- migration and rollback model;
- Marketplace provisioning/open bridge boundary.

## Required proof

- exactly four primary workspace tabs;
- Setup contains only Context, Connections and Automation as top-level groups;
- Director goal creates or resumes real unified work, never a parallel fake run;
- specialists appear in work timeline/deliverables, not primary navigation;
- deliverables preserve preview/version/export affordances when the source supports them;
- migration, restart and rollback tests preserve all supported legacy records;
- sandbox journey covers install evidence, grant, context, goal, plan, deliverables,
  approval, safe test action and retained receipt;
- 1440x900, 1024x768 and 390x844 checks, keyboard/focus, 200% zoom, reduced motion,
  no horizontal overflow and honest loading/empty/error/offline/degraded states.

## Security gate

`SECURITY GATE: social publishing / ads spend / customer data / credentials / media /
external messaging - fail closed; approval, exact tenant/user/workspace scope and scoped
grants are mandatory.`

## Roles and skills

Use Socrates -> orchestrator -> builder, then independent reviewer,
security_reviewer and design_reviewer.

- `/search-first`: reuse accepted Customer Marketing, Work, Approval, Blueprint,
  Marketplace and runtime patterns.
- `/context-gatherer`: read-only evidence map before edits.
- `/understand-codebase`: trace renderer -> preload/IPC -> service -> stored data.
- `/quick-spec`: this dispatch freezes scope and non-goals.
- `/backend-patterns`: additive adapters, strict validation and reversible migration.
- `/frontend-patterns`: composed accessible tabs/drawer and complete states.
- `/deployment-patterns`: restart, rollback and feature-flag proof only; no deployment.
- `/security-review`: required for customer data, credentials and external actions.
- `/verification-loop`: targeted, full and browser gates before handoff.
- `Design (#design)`: audit-first, existing tokens, restraint and live viewport checks.
- `/gpt-taste`: `N/A` for AIDA/hero/GSAP; only anti-generic copy/contrast discipline applies.
- `/design-taste-frontend`: product-dashboard exclusions apply; use redesign audit,
  responsive, state and accessibility checks only.
- `/stitch-design-taste`: `N/A` for Stitch generation; use semantic token and
  anti-pattern vocabulary only.

Stop at `READY_FOR_REVIEW`. Do not integrate, accept, push, merge main or deploy.
