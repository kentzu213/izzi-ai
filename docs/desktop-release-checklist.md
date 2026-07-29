# Izzi AI Desktop Release Checklist

## Small-slice operating loop

1. Select one reproduced defect or one bounded deliverable.
2. Finish the slice with the strongest practical tests, build, security, and
   diff checks.
3. Push the completed commit to `main`, publish a new version tag, and wait for
   the release workflow to finish.
4. Launch the exact packaged version on the local machine after publication.
5. Exercise the real workflow and capture runtime evidence.
6. Open the next patch only for a reproduced failure or a measured regression.
7. Do not accumulate speculative fixes across multiple unpublished slices.

## Required secrets

- `WINDOWS_CSC_LINK`
- `WINDOWS_CSC_KEY_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`
- `CSC_LINK`
- `CSC_KEY_PASSWORD`

The workflow uses its job-scoped `GITHUB_TOKEN` for draft/prerelease uploads.

## Internal RC flow

1. Run `pnpm build:all`.
2. Run `pnpm --filter @openclaw/desktop test`.
3. Set mock envs when validating locally:
   - `STARIZZI_MOCK_AGENT_MODE=true`
   - `STARIZZI_MOCK_INTEGRATIONS=true`
   - `STARIZZI_MOCK_UPDATER=true`
4. Validate login, onboarding, chat stream, task creation, memory persistence, updater banner, and restart behavior.
5. Set `apps/desktop/package.json` to the intended version and create the exact
   matching tag, such as `vX.Y.Z-rc.N` or `vX.Y.Z-beta.N`.
6. Manually dispatch `Release Desktop`, select `draft` or `prerelease`, and
   confirm artifact upload. The workflow never runs from a tag push alone.
7. Keep the `desktop-release` GitHub environment protected with required
   reviewers and self-review disabled.
8. Confirm the workflow verified that `refs/tags/<release_tag>` exists, resolves
   exactly to the checked-out `HEAD`, and matches the desktop package version.
9. Confirm the workflow uploaded only a draft/prerelease.

## Stable release gate

- Windows NSIS installs, launches, upgrades, and uninstalls cleanly.
- macOS DMG opens, app copies to Applications, and Gatekeeper accepts the notarized build.
- Chat remains the default landing page after login.
- Tasks, Memory, Status, Overview, Marketplace, Extensions, and Settings all render.
- Integration status refreshes after returning from browser flows.
- Auto-update can progress from `available` to `downloaded` and present restart CTA.
- Promoting a validated draft/prerelease to a stable GitHub release requires a
  separate explicit admin approval; this workflow cannot create a stable release.

## Notes

- The Windows release job fails closed unless `WINDOWS_CSC_LINK` and
  `WINDOWS_CSC_KEY_PASSWORD` are configured, then maps them to electron-builder's
  `CSC_LINK` and `CSC_KEY_PASSWORD` inputs.
- The macOS release job fails closed when any signing/notarization secret is missing.
- `electron-builder` uses hardened runtime plus built-in notarization; a real macOS CI artifact must still pass `codesign`, `stapler validate`, and `spctl --assess` before a stable release is approved.
- Local Windows scripts always use `--publish never`; they cannot publish a
  GitHub release. Creating a tag or publishing requires a separate explicit approval.
- Pushing a `v*` tag does not trigger publishing. Release jobs require a manual
  dispatch, an explicit confirmation input, and the `desktop-release` environment.
