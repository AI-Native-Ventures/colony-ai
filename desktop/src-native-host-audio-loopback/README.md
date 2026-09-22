# Synthetic Opus loopback (`src-native-host-audio-loopback`)

Agreed audio-owned runtime slice, preparation state. Encodes fixture PCM
with the exact upstream encoder settings, wraps frames as fixture relay
bytes, parses them with the lane contract, and drains them through NetEq.
No devices, no relay, no network, no user audio.

Depends on `colony-native-host-audio` + `opus 0.3` + `neteq 0.8`
(same pins as `desktop/src-tauri`). Native compilation (`opus-sys` C
build) is hosted-only on `macos-14`; the local shared Mac runs
fmt/diff/scan only and never compiles or runs this crate.
