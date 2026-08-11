# CMR-115 Workflow Recovery Evidence

Date: 2026-08-11 ICT
Reviewer: Nguyễn Nghĩa
Scope: technical Marketing Room reliability only. Video, HyperFrames, F5 TTS, external publishing, spend, bulk send, and credential mutation remain out of scope.

## Change

Desktop workflow creation now writes a tenant-local retry marker before calling the remote seven-day workflow API. The marker contains only the remote workspace UUID, a SHA-256 fingerprint of the objective and ordered channels, the planned start date, an idempotency key, and a creation timestamp.

When the network fails after IzziAPI has accepted the workflow, a retry within 24 hours reuses the same idempotency key and payload. The backend can therefore return the existing run and the desktop continues from its current revision. The marker is removed only in the same durable tenant-record write that creates the local approval workflow. Quota and role denials clear the marker; uncertain network or malformed responses keep it for recovery.

## Verification

| Check | Command | Result |
|---|---|---|
| Regression test first failed on changed idempotency key | `pnpm --filter @openclaw/desktop test -- src/main/customer-marketing/customer-marketing-service.test.ts -t "recovers the same remote workflow"` | Expected red test before implementation |
| Focused recovery test | Same command after implementation | 1 passed |
| Customer Marketing service suite | `pnpm --filter @openclaw/desktop test -- src/main/customer-marketing/customer-marketing-service.test.ts` | 158 passed |
| Desktop regression | `pnpm --filter @openclaw/desktop test` | 1,273 passed across 88 files |
| Desktop lint | `pnpm --filter @openclaw/desktop lint` | Passed |
| Production build | `pnpm --filter @openclaw/desktop build` | Passed; renderer entry 355.26 kB |
| Production dependency audit | `pnpm audit --prod --audit-level high` | No known vulnerabilities |
| Diff and secret checks | `git diff --check`; targeted secret scan over changed source | Passed; no secret pattern found |
| Installed beta33 packaged local staging | `CMR_DESKTOP_EXECUTABLE="F:\\IzziAI\\Izzi\\Izzi AI.exe" CMR_DESKTOP_EXPECTED_VERSION="1.14.0-beta.33" node scripts/test-marketing-desktop-staging.mjs` | PASS; 273 requests, runtime errors 0, workflow created/resumed/approved, 2 campaigns and 8 content items, reconciliation consistent |

## Safety Boundary

The slice changes retry durability only. It does not enable a remote production flag, apply a remote migration, call a live model, publish social/SEO/email content, spend money, send bulk messages, or mutate integration credentials. Beta33 is the installed public workstation build; its smoke kept `externalActionPerformed=false` and the publish gate returned `policy_denied`.

## Remaining Gates

Remote staging deployment, live model/agent execution, token vault integration, approved social/SEO/email/CRM/analytics routes, publish/spend end-to-end tests, and reviewer-approved production enablement remain open.
