# CHANGE_REQUEST - Loop 07 agent-bundle root export

Status: `REQUESTED`
Requester: Loop 07 / `LEASE-L07-CAPABILITY-ADAPTERS-20260729`
Decision authority: W0

## Target

- File: `packages/agent-bundle/src/index.ts`
- Symbols:
  - `adaptAgentBundleManifestToCapabilityEnvelope`
  - `AgentBundleCapabilityAdapterError`
  - adapter version constants and public adapter types

## Reason

Loop 07 owns and implemented `packages/agent-bundle/src/adapters/**`, but the
package root barrel is outside the active lease. The package's existing export
map exposes only its root `dist/index.js`, so consumers cannot use the adapter
through `@openclaw/agent-bundle` until the root barrel re-exports it.

No package manifest or lockfile change is required.

## Intended patch

Append root-barrel exports equivalent to:

```ts
export {
  AGENT_BUNDLE_CAPABILITY_ADAPTER_VERSION,
  AGENT_BUNDLE_CAPABILITY_ENVELOPE_SCHEMA_VERSION,
  AgentBundleCapabilityAdapterError,
  adaptAgentBundleManifestToCapabilityEnvelope,
} from './adapters';
export type {
  AgentBundleCapabilityAdapterContext,
  AgentBundleCapabilityAdapterErrorCode,
  AgentBundleCapabilityEnvelope,
} from './adapters';
```

## Proof

After a lease is granted and the patch is applied:

1. `pnpm --filter @openclaw/agent-bundle build`
2. Add/run a package-root smoke test that imports
   `adaptAgentBundleManifestToCapabilityEnvelope` from
   `@openclaw/agent-bundle`.
3. Re-run the Loop 07 `.oab` adapter tests.
4. `git diff --check`

## Current handling

No unleased patch was applied. Internal source tests import the adapter from
`packages/agent-bundle/src/adapters`, and the registry behavior is complete
independently of this public export seam.
