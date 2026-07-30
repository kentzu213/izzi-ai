# Loop 17 quick spec — operational attested browser runtime

Status: `PROVISIONAL_IMPLEMENTATION`

Canonical base: `0f32a0ca2d3155af0ff103a5fe0239e0f0e62091`

This phase builds the bounded runtime path underneath the accepted Personal
Office Work, Marketplace, IntegrationGrant and runtime contracts without
claiming that production browser automation is registered.

The attestation wrapper requires a current SHA-256 attestation, exact package
identity, visible review mode, encrypted storage state, origin allowlist
containment and idempotent replay support before any browser session opens.

It also adds an operational launch gate that requires a strictly parsed,
completed Marketplace receipt, a connected exact IntegrationGrant receipt and
one runtime authority to agree on tenant, user, workspace, package, integration,
grant and run before a launch authorization digest can be minted.

The operational service resolves those receipts from one main-authoritative
port before preparation, then resolves and compares them again before an
approved external effect. Receipt, scope, runtime-policy or authorization drift
fails closed.

Encrypted evidence and browser storage stores use injected OS-backed encryption
and atomic writes. Their keys bind exact tenant, user, workspace, package,
integration, grant, run and runtime identity; runtime evidence additionally
binds the canonical SHA-256 digest of the complete runtime spec.

The managed Playwright boundary is dependency-injected and imports no
undeclared browser package. It requires:

- an exact absolute executable path and current matching SHA-256 verification;
- headed sandboxed launch and one isolated fixed-viewport `BrowserContext`;
- `serviceWorkers: 'block'` and downloads disabled;
- phase-aware HTTP request/redirect allowlisting and deny-all WebSockets for
  v1 under `WEBSOCKET_AUTHORITY_NOT_REQUIRED_FOR_V1`;
- bounded operation, text and screenshot budgets;
- encrypted storage-state import/export;
- explicit endpoint idempotency authority before submit;
- sanitized audit traces and screenshot digest-only evidence;
- idempotent browser/context cleanup on every terminal outcome.

Owned implementation paths are new Loop 17 files under
`apps/desktop/src/main/runtime/*operational*`,
`apps/desktop/src/main/runtime/attested-browser-driver*`,
`apps/desktop/src/main/runtime/safe-storage-encryption*` and
`apps/desktop/src/main/runtime/managed-playwright-driver*`, plus Loop 17
governance/product docs.

No main composition, preload, package/lockfile, DB/schema, auth, real Playwright
import/launch, network request, install, secret retrieval or external effect is
authorized.

The v1 consumer inventory found no Marketplace, IntegrationGrant, Work,
workspace-blueprint or product workflow that requires `ws:`/`wss:`. The generic
`.ocx` `net.websocket` permission is a separate extension capability and does
not authorize managed browser sockets. A future socket consumer must submit a
new contract change request; HTTP allowlisting never implies socket authority.
See `decision-loop-17-websocket-authority.md`.

Loop 17 remains `PROVISIONAL` until the requested production provenance,
operation hooks, registration/composition leases and a real adapter-backed E2E
are separately approved and verified.
