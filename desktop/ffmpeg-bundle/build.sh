#!/usr/bin/env bash
# Build the ffmpeg that ships inside the Colony app.
#
#   build.sh <platform-key> <out-dir> [work-dir]
#
# platform-key is darwin-arm64 or win32-x64 (win32-x64 runs inside an MSYS2
# MINGW64 shell). The source tarball is the pinned release in manifest.json,
# checked against its sha256 before anything is unpacked. When ffmpeg.org is
# unreachable the same tarball is fetched from the mirrors listed there; the
# sha256 check is what makes a mirror safe to use.
#
# The build is LGPL only: the GPL and nonfree switches stay off, and no external
# libraries are linked (--disable-autodetect), so there is no x264 or x265. H.264 comes
# from the operating system (VideoToolbox on macOS, Media Foundation on
# Windows) and AAC from FFmpeg's own encoder. Only the file and pipe protocols
# exist, so a hostile media file cannot make ffmpeg open a network socket.
set -euo pipefail

platform_key="${1:?platform key (darwin-arm64 or win32-x64)}"
out_dir="${2:?output directory}"
work_dir="${3:-$(mktemp -d)}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
manifest="$here/manifest.json"

json() { node -e 'const m=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(process.argv[2].split(".").reduce((v,k)=>v[k],m))' "$manifest" "$1"; }
version="$(json version)"
sha256="$(json source.sha256)"
# The official URL first, then each mirror, one per line.
urls="$(node -e 'const s=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).source;console.log([s.url,...(s.mirrors||[])].join("\n"))' "$manifest")"

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

mkdir -p "$out_dir" "$work_dir"
tarball="$work_dir/ffmpeg-$version.tar.xz"
if [ -f "$tarball" ] && [ "$(sha256_of "$tarball")" != "$sha256" ]; then
  rm -f "$tarball"
fi
if [ ! -f "$tarball" ]; then
  while IFS= read -r url; do
    [ -n "$url" ] || continue
    if curl --fail --silent --show-error --location --retry 3 --connect-timeout 20 --max-time 600 --output "$tarball.part" "$url"; then
      if [ "$(sha256_of "$tarball.part")" = "$sha256" ]; then
        mv "$tarball.part" "$tarball"
        break
      fi
      echo "ffmpeg source from $url failed its checksum, trying the next source" >&2
    else
      echo "ffmpeg source download from $url failed, trying the next source" >&2
    fi
    rm -f "$tarball.part"
  done <<< "$urls"
fi
if [ ! -f "$tarball" ]; then
  echo "ffmpeg source: no source gave a tarball matching sha256 $sha256" >&2
  exit 1
fi
rm -rf "$work_dir/src"
mkdir -p "$work_dir/src"
tar -xJf "$tarball" -C "$work_dir/src" --strip-components=1
cd "$work_dir/src"

common=(
  --disable-gpl --disable-nonfree --disable-version3
  --disable-autodetect
  --disable-doc --disable-debug
  --disable-ffplay --disable-ffprobe
  --disable-avdevice --disable-network
  --disable-shared --enable-static
  --enable-zlib
  --disable-protocols --enable-protocol=file --enable-protocol=pipe
  --disable-encoders
  --enable-encoder=aac --enable-encoder=mjpeg
  --disable-muxers
  --enable-muxer=mp4 --enable-muxer=image2 --enable-muxer=mjpeg --enable-muxer=null
)

case "$platform_key" in
  darwin-arm64)
    [ "$(uname -s)" = Darwin ] && [ "$(uname -m)" = arm64 ] || { echo "darwin-arm64 builds on an Apple silicon Mac" >&2; exit 1; }
    platform_flags=(
      --enable-videotoolbox --enable-encoder=h264_videotoolbox
      --extra-cflags=-mmacosx-version-min=12.0
      --extra-ldflags=-mmacosx-version-min=12.0
    )
    exe=ffmpeg
    ;;
  win32-x64)
    platform_flags=(
      --arch=x86_64 --target-os=mingw32
      # FFmpeg 8.1's Media Foundation encoder refers to D3D11 types even when
      # it only takes system-memory frames, so it does not build without this.
      --enable-d3d11va --enable-mediafoundation --enable-encoder=h264_mf
      --extra-ldflags=-static --extra-ldflags=-static-libgcc
    )
    exe=ffmpeg.exe
    ;;
  *) echo "unsupported platform key: $platform_key" >&2; exit 1 ;;
esac

./configure "${common[@]}" "${platform_flags[@]}" > "$work_dir/configure.log" 2>&1 || { tail -40 "$work_dir/configure.log" >&2; exit 1; }
jobs="${FFMPEG_BUILD_JOBS:-$( (nproc 2>/dev/null || sysctl -n hw.ncpu 2>/dev/null) || echo 2)}"
make -j"$jobs" ffmpeg"$( [ "$exe" = ffmpeg.exe ] && echo .exe)" > "$work_dir/make.log" 2>&1 || { tail -40 "$work_dir/make.log" >&2; exit 1; }

cp "$exe" "$out_dir/$exe"
strip "$out_dir/$exe" 2>/dev/null || true
cp COPYING.LGPLv2.1 "$out_dir/COPYING.LGPLv2.1"
"$out_dir/$exe" -hide_banner -version | sed -n '1,2p'
echo "built $out_dir/$exe"
