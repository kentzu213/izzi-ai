# Izzi AI Desktop Beta.11 Media Re-import Evidence

Date: 2026-07-29
Repository: `kentzu213/izzi-ai`
Product commit: `ac0e17cd52e6252e3b0dbd2d3839f748f13843ba`
Public tag: `v1.14.0-beta.11`
Release: https://github.com/kentzu213/izzi-ai/releases/tag/v1.14.0-beta.11

## Release slice

This closes the bounded media re-import slice from the public packaged build.
The source worktree was not used as the product under test.

- The public Windows installer digest matched the GitHub release digest:
  `85571c870bdb516f6662d5764197b00fc2e2d681af09b643357677a2bfe147d1`.
- The installed executable at `F:\IzziAI` had digest
  `3563807f053e3edf685a9746361367213bcce011942540f7d964701051e6c3f4`.
- The installed `app.asar` had digest
  `a4807900f059c7c7ea52273ef98c3698425edf7b01311b307a866e2a7a585ab9`.
- Release assets were public, non-draft, prerelease, and complete (12 assets).
- Desktop CI and the release workflow passed on Windows and macOS.

The UI evidence is kept outside Git under the local
`.artifacts/cmr219-live-ui-beta11-20260729` directory. Private application
screenshots and local profile values are intentionally not committed.

## Real installed workflow

Playwright Electron launched `F:\IzziAI\Izzi AI.exe` and exercised the
Customer Marketing Room through the rendered UI. A temporary local QA tenant
was used so no real credential or external workspace was changed. The tenant
record and synthetic session were removed after the run; the original local
record digest was identical before and after cleanup.

### Import and replacement

The starting job was the legacy guide:
`izziapi-starizzi-howto`.

The operator clicked `Import HyperFrames` and selected the guide:
`izziapi-izzi-ai-howto`.

Observed result:

- UI notice: `Đã cập nhật project`.
- The old Starizzi job was no longer visible.
- Exactly one Izzi AI job remained, with status
  `awaiting_preview_approval`.
- Exactly one new `media_preview` approval remained, with status `pending`.
- The project manifest was retained as the only initial artifact.
- `externalActionsAllowed` remained `false`.
- Commercial render remained unavailable.

The same import was repeated immediately. The second result again contained
exactly one canonical job and one approval, with a new job ID and no duplicate
chain. The old brand identifier was absent from the visible Video Studio
surface. Unrelated workspace state remained present.

### Approval and preview

The operator clicked `Duyệt local preview`, then
`Chạy HyperFrames check`.

- HyperFrames: `0.7.57`
- Managed Node: `v20.19.1`
- FFmpeg: detected and ready
- Preview result: `preview_ready`
- Receipt: passed
- Receipt snapshot count: 3
- Receipt summary: 0 warnings; no voice generation, commercial render, or
  publish
- Preview gates: `previewApproved=true`; render, final QC, and publish stayed
  `false`
- No renderer console errors or page errors were observed.
- No matching Chrome/Chromium process remained after the run.

The HyperFrames check report was `ok=true`, with zero lint/runtime errors or
warnings. Its layout findings were informational only, and contrast checks
passed for all sampled elements.

All eight source PNG hashes in the guide provenance manifest still matched
after import and preview.

## Responsive and safety checks

The same installed window was checked at `1440x900` and `390x844`.

- Desktop and mobile document/body widths matched the viewport.
- No horizontal page overflow was observed.
- The mobile bottom action `Chạy lại kiểm tra` remained visible above the
  fixed mobile navigation.
- The current tab was visible when Video Studio was opened from the top of the
  mobile page.
- Keyboard focus was visible on the title-bar control during tab traversal.
- Commercial render and all external actions remained locked.
- No publish, scheduling, spend, bulk send, credential mutation, or provider
  mutation occurred.

The local UI displayed some timestamps after local midnight while the UTC
receipt stayed on 2026-07-29. Release evidence is intentionally dated by the
UTC evidence date above.

## Remaining gates

- F5-TTS is installed in the wider workstation setup but is not connected to
  this installed app. The public UI reports `CẦN THIẾT LẬP`; all five
  `STARIZZI_F5_TTS_*` environment settings were absent in the packaged
  process.
- Voice Studio `0.1.0` is installed but not running.
- F5 ViVoice remains blocked for commercial use under `CC-BY-NC-SA-4.0`.
- Commercial render is therefore correctly blocked.
- One old `izzi-ai-hf-*` scratch directory from an earlier run remains in the
  system temp folder; no directory was created by the current preview.
- Old durable runtime directories are not garbage-collected yet; this remains
  non-blocking cleanup debt.

## Decision

No media re-import patch was opened after the installed-public experience:
the Beta.11 behavior passed its target workflow. The next bounded slice is
F5-TTS discovery and configuration wiring. It must be reproduced, tested,
published as a new public patch, installed, and exercised before any further
media or marketing changes are started.
