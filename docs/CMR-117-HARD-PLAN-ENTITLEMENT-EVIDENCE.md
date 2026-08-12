# CMR-117 Hard Plan Entitlement Evidence

Date: 2026-08-12 ICT
Reviewer: Nguyen Nghia

## Public Backend Source

- Repository: `https://github.com/kentzu213/izzi-backend`
- Master commit: [CMR-117 hard plan entitlement](https://github.com/kentzu213/izzi-backend/commit/4b71c144492588a119e4b3c1b6d0eb79b2e7b1a8)
- Remote database or production service changed: no

## Contract

The backend now derives the current workspace plan and active member role before authorizing each
of the 14 Marketing capabilities. Quota v3 requires a capability identity and binds idempotency to
the capability, metric, units, and metadata. Authenticated quota v2 access is revoked. Resource and
seven-day workflow mutations authorize inside the same PostgreSQL transaction that performs the
write, so an immediate downgrade blocks new higher-plan execution without locking existing reads
or archives.

The desktop sends the capability identity through the main-process workspace client. AI Marketing
Director execution proceeds only after an authoritative `reserved` response. Missing gateways,
network failures, malformed responses, plan denial, and local/offline reservation states all fail
closed before the model is invoked.

## Verification

| Gate | Result |
|---|---|
| Focused desktop client/service tests | PASS, 229/229 |
| Full desktop suite | PASS, 1,276/1,276 across 88 files |
| Workspace lint | PASS |
| ESLint, GitHub Actions, and vendored-integrity contracts | PASS, 13/13 |
| Main TypeScript and production renderer build | PASS, 1,140 modules |
| Renderer bundle budget | PASS, entry 355.26 kB and all lazy chunks within budget |
| Production dependency audit | PASS, 0 known vulnerabilities |
| Scoped secret scan and diff check | PASS, no finding |
| Security review | PASS, no confirmed fail-open or sensitive-data finding |
| GitHub release workflow | PASS, Windows, macOS, and inventory/publish jobs |
| Public release inventory | PASS, 12 assets |
| Public Windows installer | PASS, 185,856,383 bytes; SHA-256 `a6e88e9882be0956a7b73f872640e00041ed4ad3264b21d7d07c8cc7b3f84a0d` |
| Installed executable | PASS, `F:\IzziAI\Izzi\Izzi AI.exe` reports `1.14.0-beta.34` |
| Packaged migration-8 staging smoke | PASS, 286 requests and 0 runtime errors |

The public release is [Izzi AI v1.14.0-beta.34](https://github.com/kentzu213/izzi-ai/releases/tag/v1.14.0-beta.34)
from desktop commit `633c28c`. The release contains 12 Windows/macOS assets. The downloaded Windows
installer matched the GitHub SHA-256 digest before installation. Authenticode remains `NotSigned`,
which is the existing code-signing gate rather than a beta34 regression.

The installed executable ran against disposable local PostgreSQL/PostgREST with all eight reviewed
migrations. It sent `X-Marketing-Capability-Id: ai-marketing-director`; the isolated database was
temporarily placed at its credit limit, the backend returned `429 quota_exceeded`, and the desktop
stopped before a model call. The public reusable harness is on `izzi-backend/master` at `b1d0df9`.

The same smoke created, resumed, and approved one backend-owned seven-day workflow; persisted two
approved campaigns and eight approved content items; produced nine usage events with nine billing
links and no discrepancy; and completed 286 local requests with zero runtime error. Publish remained
`policy_denied`, `executed=false`, and `externalActionPerformed=false`. No publish, spend, send, or
bulk endpoint was called.

## Safety Boundary

This slice does not deploy migration 8 remotely and does not enable publish, spend, send, bulk,
credential mutation, or live production model execution. Dedicated remote staging, code signing,
minimum-client enforcement, connectors, and production canary approval remain open.
