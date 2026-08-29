# MKT-05 staging readiness

Timestamp: 2026-08-29 19:43 ICT

Status: `awaiting_reviewer`

Reviewer: Nguyễn Nghĩa

## Scope and routing

- Technical tier: T3 because the work covered staging deployment, auth, secrets,
  database ACLs, rollback, and packaged desktop verification.
- `relaxed_mode` was authorized by the user because Claude Code usage was
  exhausted. Codex implemented, integrated, and independently verified the
  work. Claude Code and ChatGPT web were not used.
- Scope stayed staging-only. Production, real OAuth, providers, publish, send,
  upload, schedule, and spend were not touched.

## Staging result

- Backend source: `kentzu213/izzi-backend` PR #27, merge
  `08316aaf85a53b5c5d9128558b51d1385cbf9f55`.
- Public staging URL: `https://marketing-staging.izziapi.com`.
- Supabase project: `bogwhtnknhquxhktormu`.
- Candidate image:
  `sha256:ee4d197117d5e68370531c540667e54506b97100e0fbf56aec6803aceec72612`.
- Rollback image:
  `sha256:1110c02c309551befe4e8825894b997012e18a32e86e784eea0bbf49581f9285`.
- Rollback source SHA: `d991483b9678d8d2bbd292777977705621f42a7e`.
- Logical backup ID:
  `logical-empty-4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`.
- The [forward migration in izzi-backend](https://github.com/kentzu213/izzi-backend/blob/08316aaf85a53b5c5d9128558b51d1385cbf9f55/migrations/20260829_marketing_trigger_acl_hardening.sql)
  is 382 bytes with SHA-256
  `6271b214da8023a7b8e3e3a9d6f589c6989b65cb6ba7c1cf294efba1e6688ff9`.
- Historical migration remained 4,651 bytes with SHA-256
  `f859219f99f558b1570ab77f7daa04b0b8ee9f0aa792c4bea2e802cf8f3a6963`.

The migration revoked trigger-function execution from `PUBLIC`, `anon`,
`authenticated`, and `service_role`. Function identity, trigger binding, and
usage-event count were preserved. Security Advisor returned `0 ERROR`, `23 WARN`,
and no trigger ACL finding. The warnings are 22 reviewed authenticated SECURITY
DEFINER RPCs plus leaked-password protection, which requires Supabase Pro.

## Desktop root cause and correction

The final beta.64 smoke timed out at
`customerMarketing.saveOnboarding` after the profile request returned HTTP 200.
The initial room snapshot intentionally started the optional Video Studio probe
in the background with a 250 ms UI budget. Later mutation snapshots reused that
same in-flight Promise without a deadline. A stalled HyperFrames/F5 probe could
therefore leave IPC pending even though IzziAPI had already saved the profile.

The correction gives every snapshot media probe the existing 250 ms default
budget defined in
`apps/desktop/src/main/customer-marketing/customer-marketing-service.ts`. On
timeout it reports the media toolchain unavailable and remains fail-closed; the
shared probe may still finish and be used by a later refresh. Dedicated media
operations continue to perform their own full runtime checks. A regression test
reproduces a permanently pending background probe and proves onboarding settles
with synchronized workspace and capability state.

## Verification

- Regression test: `1/1` passed after failing before the correction.
- Customer Marketing service: `244/244` passed.
- Video Studio service: `51/51` passed.
- Full desktop suite: `1,735/1,735` across 127 files.
- TypeScript, lint, production build, native Electron rebuild, unpacked package,
  and packaged native-runtime hook: passed.
- Production dependency audit: no known vulnerabilities.
- Final candidate executable SHA-256:
  `2fbb8987b2377c222c5f99d03db522ef4534080a512d6d5ceac19841692e6c8f`.
- Packaged remote staging smoke: 70 requests, 19 checks, runtime errors `0`,
  external action `false`, request log contained no publish/spend/bulk/send
  endpoint, and synthetic residue was `0 profiles / 0 auth users / 0 containers`.

Receipt directory:
`F:\Ai Tools\Codex\Temp\izzi-backend-main-20260828\test-results`.

Receipt SHA-256 values:

- ACL hardening: `dd7f57713e58b2253bc875c9b00594ae9b5d7ee5b6eb816fc3fda8017f8b9b66`.
- Security Advisor: `7ae746bd57f96314892a783d92f1c34a3ab552a62c78c3de770361e436196dd6`.
- Image deployment: `09228c5fe4826d1fbe7c842de9ba61e0d383510467d258cfef85499af032a51e`.
- Online readiness: `7765233439952b27ca110ea19b455741f8c0bdd7611f74d0a09c9b6f6948d65c`.
- Rollback rehearsal: `244c293f02a671a600d23adcb4272bf10c5ef4546c939e7d115668f41c4a78ec`.
- Final desktop smoke: `faf3596c986a11b2941500b28a721b75e7700fb7286824daa80e4d3f3f574cd3`.

## Local Docker recovery

Docker Desktop initially failed on stale zero-byte runtime sockets. The stale
`Docker\run` and `docker-secrets-engine` directories were quarantined instead of
deleted, fresh runtime directories were created, and the existing 14.86 GB data
VHDX was retained. Docker 29.6.2 recovered both prior containers from that disk.
The Izzi staging container returned healthy on the exact candidate image and
public SHA above. No image, volume, or project database was reset by Codex.

## Reviewer gate

MKT-05 is not complete until Nguyễn Nghĩa signs off. MKT-06 and MKT-07 must not
start before that decision. Production remains unchanged and spend is `0 VND`.
