# Izzi AI Desktop Beta.26 Local Video Preview Evidence

Release date: 2026-08-10 ICT

Close-out verified: 2026-08-11 ICT

Repository: `kentzu213/izzi-ai`

- Feature and release commit: `a9fc6d328793e0c1361b9bc5cb47ba1ca5dafc28`
- Public tag: `v1.14.0-beta.26`
- Release: <https://github.com/kentzu213/izzi-ai/releases/tag/v1.14.0-beta.26>
- GitHub Actions: <https://github.com/kentzu213/izzi-ai/actions/runs/31343926119>

## Closed Release Slice

The customer Video Studio can now create a real local MP4 preview for an
approved media job. The renderer sends only `{ jobId }`. The Electron main
process resolves the authenticated tenant and verifies the workspace, role,
Pro entitlement, current evidence digest, approval, runtime attestation, and
persisted artifact before it renders or opens a file.

HyperFrames renders the approved vertical scene sequence. Voice Studio supplies
the already approved WAV clips, and FFmpeg muxes both streams into an H.264/AAC
MP4. The receipt and artifact store the dimensions, frame rate, duration,
audio format, byte count, and SHA-256. Commercial rendering, reference-voice
cloning, spend, publishing, and every external action remain fail-closed.

## Source And CI Verification

The release reference and public workflow were checked with:

```powershell
git rev-parse origin/main
git rev-list -n 1 v1.14.0-beta.26
gh run view 31343926119 --repo kentzu213/izzi-ai --json url,status,conclusion,headSha,event,jobs
gh release view v1.14.0-beta.26 --repo kentzu213/izzi-ai --json url,isDraft,isPrerelease,publishedAt,tagName,targetCommitish,assets
```

All three references resolve to
`a9fc6d328793e0c1361b9bc5cb47ba1ca5dafc28`. GitHub Actions reports
`success` for both `build-windows` and `build-mac`. The public release is a
non-draft prerelease and contains the Windows installer, blockmap, updater
manifest, and macOS artifacts.

The release gate used these repository commands:

```powershell
pnpm --filter @openclaw/desktop test
pnpm --filter @openclaw/desktop exec tsc -p tsconfig.main.json --noEmit
pnpm build:all
pnpm test:socrates
pnpm audit --prod
pnpm --filter @openclaw/desktop lint
```

The desktop regression passed 86 test files and 1,251 tests. Main TypeScript,
the five-workspace production build, the Windows package build, and all four
Socrates tests passed. The production audit reported no vulnerability, and a
tracked-file secret scan returned zero matches. ESLint remains an infrastructure
gap: ESLint 9 cannot run because the repository has no `eslint.config.*` file.

## Canonical Packaged Smoke

The canonical post-package report is:

`F:\3 AI-Automation\izziAi Marketing\artifacts\beta26-final-packaged-managed-smoke-20260810T071106\managed-video-preview-report.json`

That report records:

- Izzi AI `1.14.0-beta.26`, Electron `34.5.8`, and managed Node `20.19.1`.
- HyperFrames `0.7.57` and the attested unpacked CLI path.
- H.264/AAC output at 1080 x 1920, 30 fps, and 60 seconds.
- AAC audio at 48 kHz mono, sourced from eight validated Voice Studio WAVs.
- Matching persisted and on-disk MP4 hash/size evidence.
- A clean runtime scratch directory after completion.
- `commercialRenderAvailable=false` and `externalActionsPerformed=false`.

Kepler's independent Socrates review compared the packaged ASAR timestamp,
HyperFrames package/CLI attestations, all WAV hashes, the MP4 hash, and FFprobe
metadata against this report and returned `APPROVE` with no release blocker.

## Public Windows Artifact

The downloaded public files were measured with:

```powershell
$root = 'F:\3 AI-Automation\izziAi Marketing\artifacts\beta26-public-release-20260810T072251'
Get-Item "$root\Izzi-AI-1.14.0-beta.26-win-x64.exe"
Get-FileHash "$root\Izzi-AI-1.14.0-beta.26-win-x64.exe" -Algorithm SHA256
Get-FileHash "$root\Izzi-AI-1.14.0-beta.26-win-x64.exe.blockmap" -Algorithm SHA256
Get-Content -Raw "$root\latest.yml"
```

- Installer size: 191,861,225 bytes.
- Installer SHA-256:
  `292d0d12dd31f527597dcb27a57f66ee92f30ce38905f677be6b23383055ce6a`.
- Blockmap SHA-256:
  `10b20525a6f4638b8c4b1b2455a5c5291b141f0abfb19ea13ccef4873ab1f6d5`.
- Updater-manifest SHA-256:
  `e93e018a3436648ccba2bd2db0558cf7943e11725bc147bae428985c426c5be5`.

The installer size and SHA-512 in the downloaded `latest.yml` match the public
release asset. The local SHA-256 also matches GitHub's asset digest.

## Installed Dogfood

The public installer was applied over the retained user profile and launched
from `F:\IzziAI\Izzi\Izzi AI.exe`. `Get-Item`, `Get-FileHash`, and
`Get-AuthenticodeSignature` measured:

- Installed executable: 190,635,008 bytes, SHA-256
  `38c4a7031dfea2ec58f25a7e090f95680b59f57de70035427da3743065af1dca`,
  file version `1.14.0-beta.26`.
- Installed `F:\IzziAI\Izzi\resources\app.asar`: 6,013,005 bytes, SHA-256
  `5e80e3db56b91832701c446c11db04b32a61b2e4fdfce38e63eacc6566e53571`.
- Windows Authenticode: `NotSigned`.

The installed app created a new MP4. `Get-FileHash` and `ffprobe` measured
4,446,983 bytes, SHA-256
`c6e2f6ae49c7368a88c064ea89acaf76340584c95b5f2136661472e9f5e83aa1`,
H.264/AAC, 1080 x 1920, 30 fps, 60 seconds, and AAC 48 kHz mono.

The installed dogfood report and focus report are:

- `F:\3 AI-Automation\izziAi Marketing\artifacts\beta26-installed-dogfood-20260810T072700\installed-dogfood-report.json`
- `F:\3 AI-Automation\izziAi Marketing\artifacts\beta26-installed-dogfood-20260810T072700\receipt-focus-report.json`

The real workflow created the MP4, enabled `Mở video`, and successfully invoked
the system media player. Desktop 1280 x 800 and mobile 390 x 844 both had no
horizontal page overflow, no media-tool overlap, no action-button overlap,
no console error, and no page error. Screenshot review found no visible text
truncation. The generic button heuristic listed intentional wrapped or badged
navigation labels, so it is not used as a clean clipping assertion.

Keyboard navigation moved between the Video Studio and AI Team tabs. A separate
focus smoke confirmed `:focus-visible=true` and a visible 2 px cyan outline for
both the selected tab and `Mở video` button.

## Installed Updater

A Playwright CDP session attached to the installed renderer on port 9333,
opened `Settings -> Cập nhật`, waited for the real check to finish, and then
read both the rendered rows and preload bridge. The result was:

```json
{
  "state": "idle",
  "version": "1.14.0-beta.26",
  "availableVersion": "Không có",
  "checkedAt": "2026-08-10T00:37:27.970Z"
}
```

The test returned the app to `AI Marketing -> Video Studio` after verification.

## Known Residuals

- The Windows installer and executable are not digitally signed. Public and
  installed bytes are independently hashed in this record.
- ESLint remains blocked until the repository receives an ESLint 9 flat
  configuration; this is the next bounded verification-infrastructure task.
- The verified audio provider in this slice is Voice Studio. Direct F5-TTS
  generation is not claimed.
- Commercial rendering, reference-voice consent, publishing, spend, and all
  external actions remain unavailable.

## Rollback

The previous public installer remains available at
<https://github.com/kentzu213/izzi-ai/releases/tag/v1.14.0-beta.25>. Reinstalling
it restores beta25 product bytes while preserving the user profile and managed
media/runtime data outside the installation directory.
