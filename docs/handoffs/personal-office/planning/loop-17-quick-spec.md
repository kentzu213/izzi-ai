# Loop 17 quick spec — attested isolated runtime

Status: `PROVISIONAL_IMPLEMENTATION`

Canonical base: `0f32a0ca2d3155af0ff103a5fe0239e0f0e62091`

This phase adds a fail-closed wrapper for a future managed Playwright driver.
The wrapper requires a current SHA-256 attestation, exact package identity,
visible review mode, encrypted storage state, origin allowlist containment and
idempotent replay support before any browser session opens.

It also adds an operational launch gate that requires a strictly parsed,
completed Marketplace receipt, a connected exact IntegrationGrant receipt and
one runtime authority to agree on tenant, user, workspace, package, integration,
grant and run before a launch authorization digest can be minted.

Owned paths are new files under
`apps/desktop/src/main/runtime/attested-browser-driver*` plus Loop 17 docs.
No main composition, preload, package, DB/schema, real Playwright launch,
network request, install or external effect is authorized.
