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

Public beta34 artifact details and packaged staging results are added after the release workflow,
public download, installation, and smoke test complete.

## Safety Boundary

This slice does not deploy migration 8 remotely and does not enable publish, spend, send, bulk,
credential mutation, or live production model execution. The installed beta33 remains active until
the public beta34 installer is downloaded, verified, and smoke-tested.
