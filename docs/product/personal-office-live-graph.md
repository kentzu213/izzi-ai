# Personal Office Live Profile, Vault and MyGraph

Status: implementation artifact for Loop 04
Schema authority: `PERSONAL_OFFICE_SCHEMA_VERSION`
Storage boundary: local workspace, exact workspace and owner scope

## Product contract

`Live.md` is the editable working profile of one Personal Office workspace. It
contains preferences and rules that help later agents work in the user's style.
It is mutable and revisioned; it is not a run snapshot and it is never injected
directly into a model call by this loop.

The context compiler in Loop 05 must apply this precedence:

1. safety/system;
2. current user request;
3. workspace policy;
4. global `Live.md`;
5. learned preference;
6. model default.

The order is exported as `LIVE_CONTEXT_PRECEDENCE` so the later compiler can
test against the same contract rather than copying prose.

## Durable-change rules

- Direct changes require an exact profile-owner actor and an expected revision.
- An agent can only create a pending proposal. It cannot write a durable
  preference or rule.
- Accepting or rejecting a proposal requires the exact profile owner.
- Email, browser, chat and file learning are individually off by default.
- A proposal carrying learned-source provenance is accepted only when that
  source is currently opted in. Revoking consent prevents future proposals but
  preserves historical provenance.
- Temporary directives carry `expiresAt`. Once expired, the previous
  lower-precedence value becomes effective again.
- The local file service exposes typed mutations rather than a generic document
  callback. A per-file exclusive lock plus revision check prevents two writers
  from silently overwriting each other.

## Secret and privacy boundary

Credential-shaped text is rejected in profile values, proposal reasons,
provenance references and the complete Markdown document. Connections are
represented only by opaque `SecretRef` values. No raw API key, OAuth token,
password or bearer token belongs in `Live.md`, graph metadata or a vault note.

`personal_graph` content may be projected into MyGraph. A profile classified
`local_files` fails closed with `local-files-egress-forbidden`; this loop does
not upload or mirror it.

## MyGraph projection

The projection module is pure: it plans creates and updates but performs no
network, database or graph write. The caller must already be authorized for the
same workspace and owner.

Every projected node carries:

- profile and document reference;
- directive and proposal identity;
- direct/user/default source;
- optional learned source and opaque source reference;
- classification;
- directive revision and source timestamp;
- optional expiry;
- projection timestamp;
- exact workspace and owner scope.

The planner will not adopt a similarly named node from another scope and will
not overwrite a projection with a newer directive revision.

## Vault and wikilinks

Vault paths are POSIX-style relative Markdown paths. Traversal, absolute paths,
network paths, control characters, Windows device names and unsafe filename
characters are rejected. Vault metadata binds each note to an exact workspace
and owner, classification, revision, timestamp and normalized wikilinks.

Wikilinks are titles, never filesystem paths or URLs. Resolution considers only
vault nodes in the requested workspace and owner scope. Missing targets produce
a scoped stub plan; no write occurs until an authorized adapter applies it.
Daily-note planning reuses an existing same-scope note or creates a deterministic
`daily/YYYY-MM-DD.md` payload.

## Integration boundary

Loop 04 intentionally does not edit `database.ts`, `main/index.ts`, `preload.ts`,
`App.tsx`, `Sidebar.tsx`, `MyGraphRoute.tsx` or the accepted work engine. The
file service and graph plans remain unwired until W0 grants a later seam lease.
This keeps Loop 04 independently testable and prevents an unreviewed IPC or DB
migration from entering through a context feature.

Loop 05 may read the exported precedence and effective directives through the
shared contract. It must not bypass proposal/consent rules or parse the local
file through a second model. Renderer controls can be mounted later inside the
Loop 04-owned component paths without changing the persistence contract.

## Residual risks and next checks

- The authorized local workspace root is trusted by the current file service.
  A future arbitrary-root picker must add canonical-path and symlink checks at
  the authorization boundary.
- Expired facts can remain as historical MyGraph nodes; consumers must honor
  expiry metadata when deciding current truth.
- Native storage, IPC wiring and model injection are deliberately deferred and
  require their own lease, threat review and integration tests.
- Full desktop build verification is performed by W0 after exact-path
  integration. Producer verification is limited to no-cache tests, isolated
  TypeScript checks, lint, ownership and security scans so no dependency
  junction can write into another worktree.
