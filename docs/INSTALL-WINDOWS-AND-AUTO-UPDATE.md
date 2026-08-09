# Install Izzi AI on Windows and Keep It Updated

## Install

1. Download the latest `Izzi-AI-*-win-x64.exe` asset from the official
   `kentzu213/izzi-ai` GitHub Release.
2. Close Izzi AI if it is running, launch the installer, and choose an install
   directory.
3. Start Izzi AI and sign in. Reinstalling or upgrading does not remove the
   existing `%APPDATA%\@openclaw` profile.

The Windows installer is currently unsigned. Verify its SHA-256 against the
digest shown by GitHub before running it.

## Automatic Updates

Starting with `1.14.0-beta.23`, an installed package uses the public GitHub
release channel as follows:

1. Izzi AI checks after authenticated startup and whenever Settings or Status
   requests a fresh check.
2. When a newer compatible version is available, it downloads in the
   background and verifies the artifact against the release manifest digest.
3. The existing Restart action applies the update immediately. If it is not
   used, a downloaded update installs on the next normal app quit.

Development builds, mock updater sessions, and unpacked Electron build folders
without `app-update.yml` do not contact or install from the public channel.

## Recovery

If an update fails, keep the current installation, download the desired prior
installer from its GitHub Release, and run it over the same install directory.
The application profile is retained unless it is removed separately.
