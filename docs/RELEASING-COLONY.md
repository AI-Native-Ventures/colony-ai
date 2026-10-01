# Releasing Colony Desktop

This runbook covers the fork-owned Electron installers and updater feed for macOS arm64, Windows x64, and Linux x64. The inherited `release.yml`, `desktop-release-candidate.yml`, `signed-macos-canary.yml`, and `promote-oss-desktop-release.yml` workflows are internal Block pipelines and are not part of this process.

## What the release contains

The app version is recorded in both `desktop/package.json` and `desktop/src-tauri/tauri.conf.json`. The release workflow requires those values to match the `desktop-vX.Y.Z` tag. The Electron bundle identifier remains `xyz.block.buzz.app.electron`, and deep links continue to use the existing `buzz://` scheme.

The release includes a macOS DMG and update ZIP, a Windows NSIS installer, and a Linux AppImage. It also includes electron-updater metadata, `update-metadata.json`, and `checksums.txt`. `update-metadata.json` reports signing and auto-update capability per platform. The release notes identify unsigned artifacts. Unsigned macOS builds offer a manual download because macOS auto-update requires a signed app. Windows and Linux update downloads are validated against the SHA-512 values in their updater metadata; signed builds also verify the platform signature.

## Cut a release

1. Choose a normalized stable semantic version for the release. Update the `version` in `desktop/package.json` and `desktop/src-tauri/tauri.conf.json` in the same change. Merge the change to `codex/phase2-integration` through the coordinator's integration process.
2. Confirm the commit contains the reviewed release workflow and package changes. Do not use the inherited Block release workflows.
3. Create and push the tag on the exact integration commit:

   ```sh
   git tag desktop-vX.Y.Z
   git push origin desktop-vX.Y.Z
   ```

4. The `Release Colony Desktop` workflow builds one installer set for each platform. It creates or refreshes the GitHub Release for the existing tag, uploads installers and update metadata, and marks that release as latest.
5. For a manual retry, open the workflow's **Run workflow** control, select the existing `desktop-vX.Y.Z` tag as the branch or tag, and enter `X.Y.Z` in the version input. The workflow checks the ref and version and will not create a tag.
6. Review the release notes and verify every asset checksum before sharing the release:

   ```sh
   shasum -a 256 -c checksums.txt
   ```

7. Install each platform artifact on a clean test machine. Confirm the app opens, can connect to a canary or local relay, and that `buzz://` links still open Colony. Confirm an update downloads in the background and only restarts after the user chooses the existing restart action. On an unsigned macOS build, confirm the app offers the release download instead of in-app installation.

## Signing secrets

Add these repository secrets only when the owner has supplied the credentials. The workflow checks each group as a whole. Partial groups fail the release job. Without a complete group, the corresponding artifacts are clearly labelled `UNSIGNED`.

Apple signing and notarization:

- `APPLE_DEVELOPER_ID_CERT_P12_B64`
- `APPLE_DEVELOPER_ID_CERT_PASSWORD`
- `APPLE_NOTARY_API_KEY_P8_B64`
- `APPLE_NOTARY_KEY_ID`
- `APPLE_NOTARY_ISSUER_ID`

Windows signing:

- `WINDOWS_SIGNING_CERT_PFX_B64`
- `WINDOWS_SIGNING_CERT_PASSWORD`

The workflow creates a temporary keychain on the macOS runner and removes its temporary certificate and key files at the end of the job. It does not use a developer's local keychain. Windows certificate material is staged in the runner's temporary directory and removed after packaging.

## Roll back a release

1. Find the last known good stable release tag and move the GitHub `latest` pointer back to it:

   ```sh
   gh release edit desktop-v<last-good-version> --repo AI-Native-Ventures/colony-ai --latest
   ```

2. Pull the bad release from public downloads while retaining its tag and assets for investigation:

   ```sh
   gh release edit desktop-v<bad-version> --repo AI-Native-Ventures/colony-ai --draft
   ```

3. Reinstall the last known good release on affected machines. Existing clients will see the version in the `latest` release feed on their next check. If clients already installed the bad version, publish a new higher patch version after the fix so those clients can update forward.

## First-release checklist

- [ ] The integration commit has green required GitHub checks.
- [ ] Both app version fields match the release tag.
- [ ] The workflow ran from the exact `desktop-vX.Y.Z` tag.
- [ ] Release notes show the correct macOS, Windows, and Linux signing status.
- [ ] All expected installers, updater metadata files, `update-metadata.json`, and `checksums.txt` are attached.
- [ ] Every checksum passes on downloaded release assets.
- [ ] Clean install and update flows pass on macOS arm64, Windows x64, and Linux x64.
- [ ] A signed macOS install is notarized and its in-app update succeeds. If Apple secrets are not available, macOS shows the manual download path.
- [ ] Windows update signature validation matches the published signer when Windows signing is configured.
- [ ] `buzz://` link registration and handling still work on all supported desktop platforms.

The release workflow has not been run as part of implementing this runbook. Do not cut a release until the owner is ready to publish.
