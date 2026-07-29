# Change request — Loop 17 verified Playwright dependency

Status: `REQUESTED_AWAITING_INSTALL_AUTHORITY`

Gate: `PO-PRODUCT-OPERATIONAL-RUNTIME`

Requested package: `playwright@1.59.1`

## Exact paths

- `apps/desktop/package.json`
- `pnpm-lock.yaml`

No source, main composition or browser artifact path is included in this
request.

## Intended operation

1. Grant one single-owner package/lockfile lease.
2. Add exact `playwright: "1.59.1"` to desktop dependencies.
3. Materialize and update the lockfile offline from the verified pnpm store with
   lifecycle scripts disabled.
4. Verify the resulting lock resolution matches the recorded Playwright and
   Playwright Core integrity values exactly.
5. Run dependency audit, desktop TypeScript, full tests, lint and production
   build.
6. Revoke the lease before opening a separate production-driver composition
   request.

## Prohibitions

- No network or registry request.
- No browser download or launch.
- No postinstall/browser-install script.
- No import from another repository's `node_modules`.
- No main/preload/renderer/runtime source change.
- No push, publish, deploy, secret retrieval or quarantine write.

## Authorization still required

The current programme restriction prohibits dependency installation. This
change request records the exact reproducible operation but does not grant or
execute it.

