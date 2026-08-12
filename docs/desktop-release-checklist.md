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

- `GH_TOKEN`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`
- `CSC_LINK`
- `CSC_KEY_PASSWORD`

## Internal RC flow

1. Run `pnpm build:all`.
2. Run `pnpm --filter @openclaw/desktop test`.
3. Set mock envs when validating locally:
   - `STARIZZI_MOCK_AGENT_MODE=true`
   - `STARIZZI_MOCK_INTEGRATIONS=true`
   - `STARIZZI_MOCK_UPDATER=true`
4. Validate login, onboarding, chat stream, task creation, memory persistence, updater banner, and restart behavior.
5. Create tag `vX.Y.Z-rc.N` and confirm draft artifacts upload from GitHub Actions.

## Stable release gate

- Windows NSIS installs, launches, upgrades, and uninstalls cleanly.
- macOS DMG opens, app copies to Applications, and Gatekeeper accepts the notarized build.
- Chat remains the default landing page after login.
- Tasks, Memory, Status, Overview, Marketplace, Extensions, and Settings all render.
- Integration status refreshes after returning from browser flows.
- Windows Authenticode status is `Valid`. Stable tags fail closed when the installer is unsigned.
- An installed package automatically progresses from `available` to
  `downloaded` without a Download click, presents the restart CTA, and installs
  the downloaded update on a normal zero-exit quit.

## Notes

- Decision CMR-214: defer certificate purchase/configuration. Unsigned Windows output is allowed only
  for hyphenated prerelease tags and internal evaluation; its GitHub release remains a draft and
  broad distribution is denied. Stable tags
  require Authenticode `Valid`. Local scripts never publish; only the tagged GitHub workflow may do so.
- macOS production release is blocked until Apple credentials and signing material are available in GitHub Actions.
