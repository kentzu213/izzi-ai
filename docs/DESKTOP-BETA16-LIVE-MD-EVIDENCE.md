# Izzi AI Desktop Beta.16 Live.md Panel Evidence

Slice 2 of CMR-224 gives the operator a way to reach the memory file they own.
Slice 1 created `Live.md` in userData on first run, but nothing in the renderer
could read it, so the file the operator is supposed to write in was invisible
inside the app.

The obvious wiring would have been a graph node. That was wrong: every `graph:*`
channel goes through `GraphClient`, which talks to the shared backend, and the
`live_profile` class in `apps/desktop/src/shared/memory-trace/classification.ts`
carries `egress: 'forbidden'` — not even metadata may leave. So this slice adds
local-only IPC plus a panel on the MyGraph page instead.

## Release slice

Commit `8c9ea57` carries the code; `71004d7` bumps the version. Tag
`v1.14.0-beta.16` triggered the `Release Desktop` workflow (run 31021658831),
where `build-windows` and `build-mac` both reported success. The release is a
prerelease with 12 assets, published at 2026-08-05T15:45:29Z.

Windows publish artifacts, checked against the digests GitHub reports for the
release (`gh release view v1.14.0-beta.16 --json assets`):

| artifact | size | sha256 |
| --- | --- | --- |
| `Izzi-AI-1.14.0-beta.16-win-x64.exe` | 184567928 | `68ef47243548fad7d65f9bfed87644742529c2df16d366e527d7d531c09bc185` |
| `Izzi-AI-1.14.0-beta.16-win-x64.exe.blockmap` | 182162 | `cec14764a6d67b105190d8f318deede431ddeae28d060415e055d1fdc0d0d7b4` |
| `latest.yml` | 374 | `b36defb201e9963985c594cf1e7722219d594fa1fc3cee67bb22a7e5955d217a` |

All three matched. The installer's SHA-512, computed locally, equals the `sha512`
field inside `latest.yml`, and `latest.yml` names version 1.14.0-beta.16.

## Installed build under test

Installed over beta.15 with `/S /D=F:\IzziAI`. Reading the installed files back:

- `Izzi AI.exe` FileVersion = 1.14.0-beta.16
- installed exe sha256 = `3aaf78bc1ed7b70359e62cd303f3207d9e1592f112cf3443310c5cf9a922c0b1`
- `app.asar` sha256 = `baf69730ca23790f690f8fc6f40b23bd19af48cdeb1994532f57d3d050907a78`, 114106141 bytes

The renderer under test loaded from inside the archive, which is the part that
packaging could plausibly break: the sender-trust check resolves the renderer
path relative to the main bundle, so a wrong resolution would have rejected every
`liveProfile:*` call in a packaged build and not in a dev build.

## Why a CDP smoke and not a component test

This repository has no jsdom and no testing-library, and adding either would be a
new dependency decision rather than part of this slice. Renderer logic is
therefore tested as a plain module — `apps/desktop/src/renderer/lib/live-profile-view.ts`
with `apps/desktop/src/renderer/lib/live-profile-view.test.ts` — and the rendered
panel is exercised against the running app over the Chrome DevTools Protocol, the
same approach the earlier slices used. The script is `cmr224-live-md-smoke.mjs`
in the marketing workspace (outside this repository, alongside the other
verification scripts); its JSON and PNG output land under
artifacts/starizzi-marketing-room/cmr-224 there.

## Packaged proof

Navigation: click `MyGraph` in the sidebar, click the `Live.md` launcher, wait for
the panel to settle. Then edit the body, save, and read the file back from disk
outside the renderer so the claim does not rest on the UI.

First edit on the packaged build moved the file from revision 2 to revision 3.
The panel reported `Đã lưu, bản 3.`; the file on disk then measured 505 bytes with
`revision: 3` in its frontmatter and contained the probe marker.

Durability was then checked properly, after killing every `Izzi AI` process
rather than only closing the launching shell. On a clean start the panel showed
`bản 4`, the body measured 346 characters, the marker was still present, and both
the file's revision and its mtime were unchanged by the read.

Reads never write. A single save writes once. Both were tested rather than
assumed: a read-only run left revision at 4 with mtime 2026-08-05T22:53:57 intact,
and one save click moved revision 4 to 5, appended exactly 1 marker line, and grew
the file to 532 bytes.

Throughout every run the renderer issued 0 network requests, so no request could
have carried the body; the script also fails if any request payload contains the
text. There were 0 runtime exceptions, 0 console errors and no horizontal
overflow at the default window size.

## The operator's file was restored

Verification wrote probe lines into the operator's real `Live.md`. They were
removed through the app itself, which is the only writer. Afterwards the file
measured 431 bytes with `revision: 6`, 0 occurrences of the probe prefix, and a
body of 272 characters — the same content and the same 431 bytes recorded before
this verification began. Only the revision counter advanced, which is its job.

## Automated checks

Run from `apps/desktop`:

- `vitest run` — 79 files, 1051 tests, all passing
- `tsc -p tsconfig.main.json --noEmit` — exit 0
- `tsc -p tsconfig.json --noEmit` — exit 0
- `pnpm build` — exit 0

The IPC test in `apps/desktop/src/main/memory-trace/live-profile-ipc.test.ts`
pins the exact import set of `apps/desktop/src/main/memory-trace/live-profile-ipc.ts`,
so adding any import to that module fails the suite and forces a deliberate
decision about egress.

## Rollback path

Beta.15 remains published, so reinstalling the previous installer returns the
workstation to the prior build. `Live.md` is forward-compatible in the direction
that matters: an older build that cannot parse a file refuses to write it rather
than overwriting it, and the parser rejects any `schemaVersion` it does not know.

## Limits of this evidence

One write is unexplained. Between the first packaged edit and the durability
check, the file moved from revision 3 to revision 4 while two launches raced
against a still-running instance whose panel held an unsaved draft. The write
stored the identical body — the file measured 505 bytes on both sides of it — so
nothing was lost, and the two bounding tests above show that a read does not
write and a single save does not double-write. The exact trigger was not
reproduced, and closing a launching shell is not a restart; every later check
killed the processes first.

Not covered here: the panel is a sibling of the graph canvas, not a node inside
the constellation. Putting it in the graph itself means changing the published
`@kentzu213/graph-view` package in the izzi-web repository, which is a separate
decision. Mac artifacts were built and published but not installed or exercised.
