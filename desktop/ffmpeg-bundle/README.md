# Bundled ffmpeg

Colony prepares voice notes, videos and HEIC photos with ffmpeg before it
uploads them (`desktop/src-tauri/src/commands/media_transcode.rs`). The macOS
arm64 and Windows x64 apps carry their own ffmpeg, so none of that depends on
the user having Homebrew or winget. Other platforms look for an ffmpeg on the
machine, as before.

## What is in it

FFmpeg 8.1 (see `manifest.json`), built from the unmodified source
release by `build.sh`:

- **LGPL only.** No `--enable-gpl`, no `--enable-nonfree`, no external codec
  library, so no x264 or x265. `verify.mjs` and the packager both refuse a
  binary whose configuration says otherwise.
- **H.264 from the operating system:** VideoToolbox on macOS, Media Foundation
  on Windows. A voice note needs no H.264 encoder at all: its video track is one
  stored frame repeated (`src-tauri/assets/voice-note-video-frame.mp4`).
- **AAC and JPEG from ffmpeg's own encoders.**
- **Files and pipes only.** No network protocols.
- All of ffmpeg's built-in decoders, so HEVC, VP9, ProRes and the like still
  play in. AV1 is not decoded (that needs libdav1d).

## Where it goes

`electron-package.yml` builds it (cached on `manifest.json` and `build.sh`),
`scripts/electron-package.mjs` copies it into the app's resources folder next to
the native host, with `ffmpeg-NOTICE.txt` (licence, exact source and how to get
it) and `ffmpeg-COPYING.LGPLv2.1.txt`. The host looks there first and falls back
to the machine's ffmpeg (`find_ffmpeg`).

## Updating ffmpeg

1. Change `version` and `source` in `manifest.json`. Take the sha256 of the new
   `.tar.xz` and check its `.asc` against the release key fingerprint.
2. Run the `ffmpeg bundle` workflow (it also runs on pull requests that touch
   this folder). It builds for both platforms and runs the host's transcode
   tests against the new binary.

## Building locally (Apple silicon Mac)

```sh
desktop/ffmpeg-bundle/build.sh darwin-arm64 /tmp/colony-ffmpeg
node desktop/ffmpeg-bundle/verify.mjs darwin-arm64 /tmp/colony-ffmpeg
pnpm --dir desktop run electron:package --platform=darwin --arch=arm64 \
  --host=<native host> --ffmpeg-dir=/tmp/colony-ffmpeg
```
