# Izzi AI Desktop Beta.17 Encrypted Live.md Trace Evidence

Beta.17 closes CMR-224 Slice 3: the operator's current Live.md revision is
recorded at startup, and every revision accepted by the app is appended during
the same process. Private text is encrypted before SQLite receives it.

## Release boundary

- Feature commit: `99fb363`.
- Release commit: `c720934`.
- Public tag: `v1.14.0-beta.17`.
- Feature CI run `31285904851`: Windows and macOS passed.
- Release CI run `31285972067`: Windows and macOS passed.
- Release Desktop run `31285973196`: Windows and macOS passed.
- The prerelease has 12 binary/update assets.

The downloaded Windows artifacts matched GitHub's reported digests:

| artifact | bytes | sha256 |
| --- | ---: | --- |
| `Izzi-AI-1.14.0-beta.17-win-x64.exe` | 184570713 | `370e082c718b5014c73fd6bf2985f675158b337e181c49a34ee0dd545f3329d9` |
| `Izzi-AI-1.14.0-beta.17-win-x64.exe.blockmap` | 182613 | `409eedf74e0b6458486d9e2f1c67e887e585da5fa376e646a6faaf81e460e510` |
| `latest.yml` | 374 | `6c0fbe22a3c1b24f10f5199361239d60d385488c35fa76c73ed50b0095bf49b1` |

The public installer was installed over beta.16 at `F:\IzziAI`. The installer
exited 0, the installed executable reports `1.14.0-beta.17`, and the installed
payload measured:

- `Izzi AI.exe` SHA-256:
  `f2f87ced85ae244dc4dc2d98723de08c00963f092123ae4becca65edb9c5edf9`.
- `app.asar`: 114127436 bytes, SHA-256
  `169c2d8f0134b05005fa267177c578db806d995512ac368e7771d34083c609b3`.

The installer did not change Live.md. A pre-upgrade database backup was kept
inside Electron userData rather than copied into the repository or marketing
workspace.

## Behavior and security boundary

`LiveProfileStore.toTraceUnit` converts the exact profile returned by a
successful write. This avoids rereading a newer file and attaching the wrong
revision to an accepted save. `registerLiveProfileIpc` calls the recorder only
after the atomic file write succeeds. A secondary trace failure never changes a
durable operator save into an ambiguous failed request.

`TraceStore` validates the complete trace unit, checks its classification and
uses Electron `safeStorage` for every private class. If OS encryption is not
available, it refuses the trace write instead of falling back to plaintext.

The SQLite boundary independently enforces the policy:

- `public_metadata` requires non-empty `text_plain` and no cipher.
- `interaction_trace`, `live_profile` and `secret_reference` require a
  non-empty cipher and `text_plain IS NULL`.
- Unknown classifications, both text columns and neither text column fail the
  CHECK constraint.
- `ON CONFLICT(id) DO NOTHING` handles only an id replay; it no longer hides an
  unrelated CHECK failure.

## Packaged proof

The proof used only the installed public build and its local CDP endpoint. The
synthetic marker was removed through the app itself.

| event | Live.md revision | workspace trace count | result |
| --- | ---: | ---: | --- |
| first beta.17 startup | 6 | 1 | current revision appended encrypted |
| one UI save | 7 | 2 | exactly one new row |
| first cleanup save | 8 | 3 | exactly one new row |
| final exact cleanup save | 9 | 4 | exactly one new row |
| full process restart | 9 | 4 | duplicate startup replay was idempotent |

For every inspected current row:

- classification was `live_profile`;
- source kind was `live_profile` and boundary was `workspace:local`;
- `text_plain` was NULL;
- ciphertext existed and was non-empty;
- a byte scan of `openclaw.db`, WAL and SHM found no complete Live.md body.

After cleanup the synthetic marker count was zero. The operator body returned to
272 characters and the whole file returned to 431 bytes. MyGraph read smoke
passed after restart with no runtime exception, console error, network failure,
external request or horizontal overflow.

The first cleanup harness run returned false even though the app saved revision
8 correctly. The panel was already open, so no launcher existed, and the harness
also left one extra trailing newline. The external harness was fixed to accept
an already-open panel, redact body previews and restore an explicit expected
length. The final cleanup and restart then passed. No product patch was required
for that harness defect.

Video Studio was also exercised after restart at 1280x800 and 390x844. It kept
HyperFrames 0.7.57, managed Node and FFmpeg ready, with no runtime/network/layout
regression. F5-TTS and Voice Studio remained installed but not running; the
commercial render and external-action gates remained closed.

## Source verification

- Focused memory/IPC/storage tests: 57/57.
- Full desktop suite: 80 files, 1070 tests, all passed.
- Main and renderer TypeScript checks: passed.
- Full monorepo build: passed; desktop transformed 1139 modules.
- Feature CI, release CI and Release Desktop: passed on Windows and macOS.

## Limits and rollback

- The Windows installer is not code-signed.
- macOS artifacts were built and published but not installed or exercised.
- Historical trace rows have no operator UI in this slice; this is local
  persistence and citation groundwork only.
- External-editor changes are captured on the next app launch, because the app
  does not watch arbitrary filesystem writes.
- `pnpm audit` reported 89 existing advisories: one critical issue in the
  development-only electron-builder tar path and 41 high issues including the
  Electron 34 runtime. Beta.17 changed no dependency and is not production-ready.
- F5 ViVoice remains non-commercial under the recorded model license. No voice,
  render, upload, publish, spend or external API action was performed.

Rollback is the still-published beta.16 installer plus the pre-upgrade local
database backup. Live.md remains the source-of-truth file and is not replaced by
the trace table.
