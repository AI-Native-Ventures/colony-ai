//! Video transcoding and poster-frame extraction via ffmpeg.
//!
//! Split out of `media.rs` to keep that file under the desktop line-size
//! limit. These helpers are used by the upload pipeline to normalize any
//! video to H.264/AAC/MP4/fast-start (guaranteed to pass the relay's
//! `validate_video_file()`) and to produce a JPEG poster frame.

use crate::managed_agents::resolve_command;
use std::path::{Path, PathBuf};
use tokio_util::sync::CancellationToken;

/// Build an ffmpeg command without inheriting user-controlled process knobs.
///
/// The binary path is resolved before this point, so a shell and `PATH` are not
/// needed. Windows keeps only the OS variables required for process/DLL lookup.
fn ffmpeg_command(path: &std::path::Path) -> std::process::Command {
    let mut command = std::process::Command::new(path);
    #[cfg(target_os = "windows")]
    let required_windows_env: Vec<(&'static str, std::ffi::OsString)> =
        ["SystemRoot", "WINDIR", "TEMP", "TMP"]
            .into_iter()
            .filter_map(|name| std::env::var_os(name).map(|value| (name, value)))
            .collect();
    command.env_clear().env("LANG", "C");
    #[cfg(target_os = "windows")]
    for (name, value) in required_windows_env {
        command.env(name, value);
    }
    crate::util::configure_no_window(&mut command);
    command
}

/// True for a regular file the current user may execute.
fn is_runnable_file(path: &Path) -> bool {
    let Ok(metadata) = path.metadata() else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

/// The ffmpeg that ships inside the app: a sidecar next to the native host.
fn bundled_ffmpeg_in(dir: &Path) -> Option<PathBuf> {
    let candidate = dir.join(format!("ffmpeg{}", std::env::consts::EXE_SUFFIX));
    is_runnable_file(&candidate).then_some(candidate)
}

/// Tests point this at a specific build (the bundled one in CI). It does not
/// exist in the app, so a user's environment can never choose the binary.
#[cfg(test)]
fn ffmpeg_path_for_tests() -> Option<PathBuf> {
    std::env::var_os("COLONY_FFMPEG_PATH").map(PathBuf::from)
}

#[cfg(not(test))]
fn ffmpeg_path_for_tests() -> Option<PathBuf> {
    None
}

fn bundled_ffmpeg() -> Option<PathBuf> {
    if let Some(path) = ffmpeg_path_for_tests() {
        return Some(path);
    }
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().and_then(bundled_ffmpeg_in))
}

/// The bundled ffmpeg wins. Looking for one on the machine is only the
/// fallback for a build that ships without one (a source build, Linux).
fn choose_ffmpeg(
    bundled: Option<PathBuf>,
    fallback: impl FnOnce() -> Option<PathBuf>,
) -> Option<PathBuf> {
    bundled.or_else(fallback)
}

/// Locate ffmpeg: the copy bundled with the app first, then the machine's
/// (login shell PATH, /opt/homebrew/bin, /usr/local/bin, etc.).
/// Returns the resolved absolute path on success.
pub(super) fn find_ffmpeg() -> Result<std::path::PathBuf, String> {
    let ffmpeg_path =
        choose_ffmpeg(bundled_ffmpeg(), || resolve_command("ffmpeg")).ok_or_else(|| {
            "Colony could not find ffmpeg, which it needs to prepare voice notes, videos and \
             HEIC photos. Reinstall Colony to restore it. A build run from source needs ffmpeg \
             installed (macOS: brew install ffmpeg, Linux: sudo apt install ffmpeg, \
             Windows: winget install ffmpeg)."
                .to_string()
        })?;

    match ffmpeg_command(&ffmpeg_path)
        .arg("-version")
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
    {
        Ok(s) if s.success() => Ok(ffmpeg_path),
        Ok(_) => Err(
            "ffmpeg was found but returned an error. It may be broken or misconfigured."
                .to_string(),
        ),
        Err(e) => Err(format!("failed to check for ffmpeg: {e}")),
    }
}

/// H.264 encoders in the order Colony tries them, each with the settings that
/// give a normal-quality result. The bundled ffmpeg is an LGPL build with no
/// libx264, so it encodes through the operating system (VideoToolbox on macOS,
/// Media Foundation on Windows); an ffmpeg found on the machine usually has
/// libx264, which stays the first choice. Media Foundation gets a second try on
/// a fixed bitrate for encoders that do not offer quality rate control.
const H264_ATTEMPTS: &[(&str, &[&str])] = &[
    (
        "libx264",
        &["-c:v", "libx264", "-preset", "fast", "-crf", "23"],
    ),
    (
        "h264_videotoolbox",
        &["-c:v", "h264_videotoolbox", "-q:v", "55"],
    ),
    (
        "h264_mf",
        &[
            "-c:v",
            "h264_mf",
            "-rate_control",
            "quality",
            "-quality",
            "75",
        ],
    ),
    ("h264_mf", &["-c:v", "h264_mf", "-b:v", "4M"]),
];

/// The encoder settings to try, in order, for an `ffmpeg -encoders` listing.
fn h264_attempts(encoder_listing: &str) -> Vec<&'static [&'static str]> {
    let names: Vec<&str> = encoder_listing
        .lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let flags = parts.next()?;
            if !flags.starts_with('V') {
                return None;
            }
            parts.next()
        })
        .collect();
    H264_ATTEMPTS
        .iter()
        .filter(|(encoder, _)| names.contains(encoder))
        .map(|(_, args)| *args)
        .collect()
}

fn available_h264_attempts(ffmpeg: &Path) -> Result<Vec<&'static [&'static str]>, String> {
    let listing = ffmpeg_command(ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-encoders"])
        .stdin(std::process::Stdio::null())
        .output()
        .map_err(|error| format!("failed to list ffmpeg encoders: {error}"))?;
    let attempts = h264_attempts(&String::from_utf8_lossy(&listing.stdout));
    if attempts.is_empty() {
        return Err("This copy of ffmpeg cannot encode H.264 video.".to_string());
    }
    Ok(attempts)
}

/// Detect if a file is a video based on magic bytes.
pub(super) fn is_video_file(buf: &[u8]) -> bool {
    infer::get(buf).is_some_and(|t| t.mime_type().starts_with("video/"))
}

/// HEIC/HEIF compatible-brand codes that mark an ISO-BMFF file as a still
/// HEIF image. Mirrors mobile's `_heicBrands` set in
/// `mobile/lib/shared/relay/media_upload.dart` so detection stays consistent
/// across platforms — deliberately broader than the `infer` crate, which only
/// recognizes `heic`/`heix` majors (or `mif1`/`msf1` with a `heic` compatible
/// brand) and would miss `hevc`/`hevx`/`heim`/`heis`.
const HEIC_BRANDS: &[&[u8; 4]] = &[
    b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"mif1", b"msf1",
];

/// Detect a HEIC/HEIF still image by magic bytes.
///
/// HEIC/HEIF is an ISO base media file (ISO-BMFF): a `ftyp` box at offset 4
/// followed by a major brand and a list of compatible brands. We scan the
/// major brand plus the compatible-brand list for any of `HEIC_BRANDS`.
///
/// Mirrors mobile's `_looksLikeHeicOrHeif`: requires the `ftyp` marker at
/// offset 4 and scans 4-byte brand codes at offsets 8, 12, 16, ... up to the
/// first 32 bytes. The Tauri webview / Chromium cannot decode HEIC, so any
/// match here is transcoded to JPEG before upload.
pub(super) fn is_heic_file(buf: &[u8]) -> bool {
    // Need at least the 8-byte box header + 4-byte major brand.
    if buf.len() < 12 || &buf[4..8] != b"ftyp" {
        return false;
    }

    // Scan the major brand (offset 8) and each compatible brand, bounded to
    // the first 32 bytes (matches mobile's window).
    let upper = buf.len().min(32);
    let mut offset = 8;
    while offset + 4 <= upper {
        let brand: &[u8; 4] = buf[offset..offset + 4].try_into().expect("4-byte slice");
        if HEIC_BRANDS.contains(&brand) {
            return true;
        }
        offset += 4;
    }

    false
}

/// True if a filename ends in `.heic` or `.heif` (case-insensitive).
///
/// Mirrors mobile's `_hasHeicFileExtension`. Used on the file-picker path as a
/// secondary signal — some HEIC files from non-Apple tooling carry brands not
/// in `HEIC_BRANDS`, but the extension still tells us the webview can't render
/// them. The byte-based path (paste/drag) has no filename and relies solely on
/// `is_heic_file`.
pub(super) fn has_heic_extension(path: &std::path::Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("heic") || ext.eq_ignore_ascii_case("heif"))
}

/// Maximum wall-clock time for an ffmpeg transcode before we kill it.
/// 10 minutes is generous for any reasonable video; pathological inputs
/// (crafted to cause exponential decode time) get killed instead of
/// blocking a Tokio worker thread indefinitely.
const FFMPEG_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(600);

/// Run an ffmpeg command with a wall-clock timeout and optional cancellation.
///
/// Spawns the child process, polls `try_wait()` every 500ms, and kills it
/// if the deadline is exceeded. Returns the same `Output` as `Command::output()`.
///
/// **IMPORTANT**: callers MUST pass `-loglevel error` (or `quiet`) to ffmpeg.
/// This function reads stderr only after the child exits. If ffmpeg writes
/// enough progress/diagnostic output to fill the OS pipe buffer (~64 KiB),
/// the child blocks on write() and never exits — causing a false timeout.
/// `-loglevel error` suppresses progress spam, keeping stderr small.
fn run_ffmpeg_with_cancellation(
    cmd: &mut std::process::Command,
    timeout: std::time::Duration,
    cancellation: Option<&CancellationToken>,
) -> Result<std::process::Output, String> {
    if cancellation.is_some_and(CancellationToken::is_cancelled) {
        return Err("upload cancelled".to_string());
    }
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to spawn ffmpeg: {e}"))?;

    let deadline = std::time::Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                // Process exited — collect output.
                let stdout = child.stdout.take().map_or_else(Vec::new, |mut s| {
                    let mut buf = Vec::new();
                    let _ = std::io::Read::read_to_end(&mut s, &mut buf);
                    buf
                });
                let stderr = child.stderr.take().map_or_else(Vec::new, |mut s| {
                    let mut buf = Vec::new();
                    let _ = std::io::Read::read_to_end(&mut s, &mut buf);
                    buf
                });
                return Ok(std::process::Output {
                    status,
                    stdout,
                    stderr,
                });
            }
            Ok(None) => {
                // Still running — check deadline.
                if cancellation.is_some_and(CancellationToken::is_cancelled) {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err("upload cancelled".to_string());
                }
                if std::time::Instant::now() > deadline {
                    let _ = child.kill();
                    let _ = child.wait(); // reap zombie
                    return Err(format!("ffmpeg timed out after {}s", timeout.as_secs()));
                }
                std::thread::sleep(std::time::Duration::from_millis(500));
            }
            Err(e) => return Err(format!("failed to wait on ffmpeg: {e}")),
        }
    }
}

/// Transcode any video file to H.264/AAC/MP4/fast-start via ffmpeg.
///
/// Always re-encodes — handles HEVC, VP9, ProRes, non-faststart MP4, 10-bit,
/// wrong pixel format, MOV containers, etc. Output is guaranteed to pass the
/// relay's `validate_video_file()`.
///
/// Returns the path to a temp file. Caller must clean up.
fn transcode_to_mp4_with_cancellation(
    source: &std::path::Path,
    ffmpeg: &std::path::Path,
    cancellation: Option<&CancellationToken>,
) -> Result<std::path::PathBuf, String> {
    let mut last_error = String::new();
    for encoder_args in available_h264_attempts(ffmpeg)? {
        match transcode_to_mp4_with_encoder(source, ffmpeg, encoder_args, cancellation) {
            Ok(output) => return Ok(output),
            // Another encoder cannot fix a cancel, a timeout or a missing binary.
            Err(error)
                if error == "upload cancelled"
                    || error.starts_with("ffmpeg timed out")
                    || error.starts_with("failed to spawn ffmpeg") =>
            {
                return Err(error);
            }
            Err(error) => {
                eprintln!(
                    "buzz-desktop: H.264 encoder {} failed, trying the next one: {error}",
                    encoder_args.get(1).copied().unwrap_or("unknown")
                );
                last_error = error;
            }
        }
    }
    Err(last_error)
}

fn transcode_to_mp4_with_encoder(
    source: &std::path::Path,
    ffmpeg: &std::path::Path,
    encoder_args: &[&str],
    cancellation: Option<&CancellationToken>,
) -> Result<std::path::PathBuf, String> {
    // UUID-based temp path — unique across concurrent uploads.
    let output = std::env::temp_dir().join(format!("buzz-transcode-{}.mp4", uuid::Uuid::new_v4()));

    let result = run_ffmpeg_with_cancellation(
        ffmpeg_command(ffmpeg)
            .args([
                "-y",
                "-nostdin",
                "-loglevel",
                "error",
                "-protocol_whitelist",
                "file,pipe",
            ]) // suppress progress spam — prevents stderr pipe deadlock
            .arg("-i")
            .arg(source) // OsStr — handles non-UTF-8 paths on Unix
            .args([
                "-map",
                "0:v:0",
                "-map",
                "0:a:0?",
                "-map_metadata",
                "-1",
                "-map_chapters",
                "-1",
                "-sn",
                "-dn",
                "-fflags",
                "+bitexact",
                "-flags:v",
                "+bitexact",
                "-flags:a",
                "+bitexact",
            ])
            .args(encoder_args)
            .args([
                "-pix_fmt",
                "yuv420p",
                "-vf",
                "pad=ceil(iw/2)*2:ceil(ih/2)*2",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                "-movflags",
                "+faststart",
                "-metadata",
                "encoder=",
            ])
            .arg(&output)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped()),
        FFMPEG_TIMEOUT,
        cancellation,
    )
    .inspect_err(|_| {
        let _ = std::fs::remove_file(&output);
    })?;

    if !result.status.success() {
        let _ = std::fs::remove_file(&output);
        let stderr = String::from_utf8_lossy(&result.stderr);
        let detail = stderr
            .lines()
            .rev()
            .find(|l| !l.is_empty() && !l.starts_with("  "))
            .unwrap_or("unknown error");
        return Err(format!("Video conversion failed: {detail}"));
    }

    Ok(output)
}

/// Playing time in seconds of a plain PCM WAV file, from its header. `None`
/// for anything else; the envelope then falls back to `-shortest` alone.
fn wav_duration_secs(header: &[u8], file_len: u64) -> Option<f64> {
    if header.len() < 12 || &header[0..4] != b"RIFF" || &header[8..12] != b"WAVE" {
        return None;
    }
    let mut offset = 12usize;
    let mut byte_rate = None;
    while offset.checked_add(8)? <= header.len() {
        let id = &header[offset..offset + 4];
        let size = u32::from_le_bytes(header[offset + 4..offset + 8].try_into().ok()?) as u64;
        if id == b"fmt " && header.len() >= offset + 20 {
            byte_rate = Some(u32::from_le_bytes(
                header[offset + 16..offset + 20].try_into().ok()?,
            ));
        }
        if id == b"data" {
            let rate = byte_rate.filter(|rate| *rate > 0)?;
            let available = file_len.saturating_sub(offset as u64 + 8);
            let seconds = size.min(available) as f64 / f64::from(rate);
            return (seconds > 0.0 && seconds <= 600.0).then_some(seconds);
        }
        offset = offset
            .checked_add(8)?
            .checked_add(usize::try_from(size).ok()?)?
            .checked_add((size & 1) as usize)?;
    }
    None
}

fn source_wav_duration_secs(source: &Path) -> Option<f64> {
    use std::io::Read;
    let mut file = std::fs::File::open(source).ok()?;
    let file_len = file.metadata().ok()?.len();
    let mut header = vec![0u8; 4096];
    let read = file.read(&mut header).ok()?;
    header.truncate(read);
    wav_duration_secs(&header, file_len)
}

/// One black 16x16 H.264 frame lasting a tenth of a second, in an MP4. The
/// voice-note envelope repeats it instead of encoding video, so a voice note
/// needs no H.264 encoder (the bundled LGPL ffmpeg has none of its own). Made
/// once with libx264, SEI and metadata stripped; see `assets/README.md`.
const VOICE_NOTE_VIDEO_FRAME: &[u8] = include_bytes!("../../assets/voice-note-video-frame.mp4");

/// Package a voice-note audio file in the relay's existing canonical video
/// envelope. The tiny H.264 track satisfies the deployed video validator while
/// the AAC track remains the only user-facing content in the voice-note player.
///
/// Returns the path to a temp MP4. Caller must clean up.
pub(super) fn transcode_voice_note_to_mp4_with_cancellation(
    source: &std::path::Path,
    cancellation: Option<&CancellationToken>,
) -> Result<std::path::PathBuf, String> {
    let ffmpeg = find_ffmpeg()?;
    let output = std::env::temp_dir().join(format!("buzz-voice-note-{}.mp4", uuid::Uuid::new_v4()));
    let frame = std::env::temp_dir().join(format!("buzz-voice-frame-{}.mp4", uuid::Uuid::new_v4()));
    std::fs::write(&frame, VOICE_NOTE_VIDEO_FRAME)
        .map_err(|error| format!("failed to prepare voice note: {error}"))?;
    // The looped frame must stop where the audio stops. `-shortest` alone
    // lets stream copy run several seconds long, and the relay reads the
    // video track's length for the player.
    let length_limit = source_wav_duration_secs(source).map(|secs| format!("{secs:.3}"));

    let mut command = ffmpeg_command(&ffmpeg);
    let result = run_ffmpeg_with_cancellation(
        command
            .args([
                "-y",
                "-nostdin",
                "-loglevel",
                "error",
                "-protocol_whitelist",
                "file,pipe",
                "-stream_loop",
                "-1",
                "-i",
            ])
            .arg(&frame)
            .args(["-protocol_whitelist", "file,pipe", "-i"])
            .arg(source)
            .args([
                "-map",
                "0:v:0",
                "-map",
                "1:a:0",
                "-shortest",
                "-map_metadata",
                "-1",
                "-map_chapters",
                "-1",
                "-sn",
                "-dn",
                "-fflags",
                "+bitexact",
                "-flags:v",
                "+bitexact",
                "-flags:a",
                "+bitexact",
                "-c:v",
                "copy",
                "-c:a",
                "aac",
                "-b:a",
                "96k",
                "-movflags",
                "+faststart",
                "-metadata",
                "encoder=",
            ])
            .args(length_limit.iter().flat_map(|limit| ["-t", limit.as_str()]))
            .arg(&output)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped()),
        FFMPEG_TIMEOUT,
        cancellation,
    );
    let _ = std::fs::remove_file(&frame);
    let result = result.inspect_err(|_| {
        let _ = std::fs::remove_file(&output);
    })?;

    if !result.status.success() {
        let _ = std::fs::remove_file(&output);
        let stderr = String::from_utf8_lossy(&result.stderr);
        let detail = stderr
            .lines()
            .rev()
            .find(|line| !line.is_empty() && !line.starts_with("  "))
            .unwrap_or("unknown error");
        return Err(format!("Voice note conversion failed: {detail}"));
    }

    Ok(output)
}

/// Transcode a HEIC/HEIF still image to JPEG via ffmpeg.
///
/// The Tauri webview / Chromium cannot decode HEIC, so iPhone photos uploaded
/// as-is render blank in the composer and are unviewable for everyone. This
/// normalizes them to JPEG (the same fix mobile applies before upload).
///
/// Uses `-frames:v 1` so multi-image HEIF containers (Live Photos, bursts)
/// yield a single still, and `-q:v 2` for high JPEG quality. Returns the path
/// to a temp file. Caller must clean up.
fn transcode_heic_to_jpeg(
    source: &std::path::Path,
    ffmpeg: &std::path::Path,
    cancellation: Option<&CancellationToken>,
) -> Result<std::path::PathBuf, String> {
    // UUID-based temp path — unique across concurrent uploads.
    let output = std::env::temp_dir().join(format!("buzz-heic-{}.jpg", uuid::Uuid::new_v4()));

    // Single-frame image decode — 60s is generous even for large HEICs.
    let heic_timeout = std::time::Duration::from_secs(60);

    let result = run_ffmpeg_with_cancellation(
        ffmpeg_command(ffmpeg)
            .args([
                "-y",
                "-nostdin",
                "-loglevel",
                "error",
                "-protocol_whitelist",
                "file,pipe",
            ]) // suppress progress spam — prevents stderr pipe deadlock
            .arg("-i")
            .arg(source) // OsStr — handles non-UTF-8 paths on Unix
            .args([
                "-map",
                "0:v:0",
                "-map_metadata",
                "-1",
                "-frames:v",
                "1",
                "-q:v",
                "2",
            ])
            .arg(&output)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped()),
        heic_timeout,
        cancellation,
    )
    .inspect_err(|_| {
        let _ = std::fs::remove_file(&output);
    })?;

    if !result.status.success() {
        let _ = std::fs::remove_file(&output);
        let stderr = String::from_utf8_lossy(&result.stderr);
        let detail = stderr
            .lines()
            .rev()
            .find(|l| !l.is_empty() && !l.starts_with("  "))
            .unwrap_or("unknown error");
        return Err(format!("HEIC conversion failed: {detail}"));
    }

    Ok(output)
}

/// Transcode a HEIC/HEIF still image (from a path) to JPEG bytes.
///
/// Resolves ffmpeg, transcodes, reads the JPEG bytes, and cleans up the temp
/// file. Mirrors `transcode_and_extract_poster` but for images (no poster).
pub(super) fn transcode_heic_path_to_jpeg_bytes(
    source: &std::path::Path,
) -> Result<Vec<u8>, String> {
    transcode_heic_path_to_jpeg_bytes_with_cancellation(source, None)
}

pub(super) fn transcode_heic_path_to_jpeg_bytes_with_cancellation(
    source: &std::path::Path,
    cancellation: Option<&CancellationToken>,
) -> Result<Vec<u8>, String> {
    let ffmpeg_path = find_ffmpeg()?;
    let jpeg_path = transcode_heic_to_jpeg(source, &ffmpeg_path, cancellation)?;
    let bytes =
        std::fs::read(&jpeg_path).map_err(|e| format!("failed to read transcoded HEIC: {e}"));
    let _ = std::fs::remove_file(&jpeg_path);
    bytes
}

/// Extract a single JPEG poster frame from a transcoded MP4 via ffmpeg.
///
/// Seeks to 1 second (avoids black leader frames), falls back to first frame
/// for videos shorter than 1 second. Output is scaled to 640px wide with even
/// dimensions. Returns the path to a temp JPEG. Caller must clean up.
///
/// Best-effort: returns `Err` on failure — callers should log and continue
/// without a poster rather than failing the entire video upload.
fn extract_poster_frame_with_cancellation(
    mp4_path: &std::path::Path,
    ffmpeg: &std::path::Path,
    cancellation: Option<&CancellationToken>,
) -> Result<std::path::PathBuf, String> {
    let output = std::env::temp_dir().join(format!("buzz-poster-{}.jpg", uuid::Uuid::new_v4()));

    // Poster extraction is a single-frame decode — 30s is generous.
    let poster_timeout = std::time::Duration::from_secs(30);

    // Try seeking to 1s first (avoids black first frames from fade-ins).
    let result = run_ffmpeg_with_cancellation(
        ffmpeg_command(ffmpeg)
            .args([
                "-y",
                "-nostdin",
                "-loglevel",
                "error",
                "-protocol_whitelist",
                "file,pipe",
            ])
            .arg("-ss")
            .arg("1")
            .arg("-i")
            .arg(mp4_path)
            .args(["-vframes", "1", "-vf", "scale=640:-2", "-q:v", "2"])
            .arg(&output)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped()),
        poster_timeout,
        cancellation,
    )?;

    // If seek to 1s failed (video shorter than 1s), retry from first frame.
    if !result.status.success()
        || !output.exists()
        || std::fs::metadata(&output).map_or(true, |m| m.len() == 0)
    {
        if !result.status.success() {
            let stderr = String::from_utf8_lossy(&result.stderr);
            eprintln!("buzz-desktop: poster seek-to-1s failed, trying first frame: {stderr}");
        }
        let _ = std::fs::remove_file(&output);
        let fallback = run_ffmpeg_with_cancellation(
            ffmpeg_command(ffmpeg)
                .args([
                    "-y",
                    "-nostdin",
                    "-loglevel",
                    "error",
                    "-protocol_whitelist",
                    "file,pipe",
                ])
                .arg("-i")
                .arg(mp4_path)
                .args(["-vframes", "1", "-vf", "scale=640:-2", "-q:v", "2"])
                .arg(&output)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::piped()),
            poster_timeout,
            cancellation,
        )?;

        if !fallback.status.success() || !output.exists() {
            let stderr = String::from_utf8_lossy(&fallback.stderr);
            eprintln!("buzz-desktop: poster frame extraction failed: {stderr}");
            let _ = std::fs::remove_file(&output);
            return Err("ffmpeg could not extract a poster frame".to_string());
        }
    }

    Ok(output)
}

/// Transcode video and extract poster frame. Returns (video_bytes, Option<poster_bytes>).
///
/// Poster extraction is best-effort — if it fails, returns `None` for the poster
/// and the video bytes are still valid. All temp files are cleaned up.
pub(super) fn transcode_and_extract_poster(
    source: &std::path::Path,
) -> Result<(Vec<u8>, Option<Vec<u8>>), String> {
    transcode_and_extract_poster_with_cancellation(source, None)
}

pub(super) fn transcode_and_extract_poster_with_cancellation(
    source: &std::path::Path,
    cancellation: Option<&CancellationToken>,
) -> Result<(Vec<u8>, Option<Vec<u8>>), String> {
    let ffmpeg_path = find_ffmpeg()?;
    let transcoded = transcode_to_mp4_with_cancellation(source, &ffmpeg_path, cancellation)?;

    // Extract poster from the transcoded file (not the original — guarantees decodability).
    let poster_bytes =
        match extract_poster_frame_with_cancellation(&transcoded, &ffmpeg_path, cancellation) {
            Ok(poster_path) => {
                let bytes = std::fs::read(&poster_path).ok();
                let _ = std::fs::remove_file(&poster_path);
                bytes
            }
            Err(e) => {
                eprintln!("buzz-desktop: poster extraction failed (non-fatal): {e}");
                None
            }
        };

    if cancellation.is_some_and(CancellationToken::is_cancelled) {
        let _ = std::fs::remove_file(&transcoded);
        return Err("upload cancelled".to_string());
    }

    let video_bytes =
        std::fs::read(&transcoded).map_err(|e| format!("failed to read transcoded file: {e}"));
    let _ = std::fs::remove_file(&transcoded);

    Ok((video_bytes?, poster_bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn relay_media_config() -> buzz_media_pkg::MediaConfig {
        buzz_media_pkg::MediaConfig {
            s3_endpoint: String::new(),
            s3_access_key: String::new(),
            s3_secret_key: String::new(),
            s3_bucket: String::new(),
            s3_region: "us-east-1".to_string(),
            s3_addressing_style: buzz_media_pkg::S3AddressingStyle::Path,
            max_image_bytes: 50 * 1024 * 1024,
            max_gif_bytes: 10 * 1024 * 1024,
            max_video_bytes: 524_288_000,
            max_file_bytes: 104_857_600,
            public_base_url: String::new(),
            upload_records_enabled: false,
            upload_ip_header: None,
            upload_port_header: None,
        }
    }

    fn media_fixture(name: &str) -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/media")
            .join(name)
    }

    #[test]
    fn test_is_video_file_mp4() {
        // Minimal ftyp box (MP4 magic bytes)
        let ftyp: &[u8] = &[
            0x00, 0x00, 0x00, 0x14, b'f', b't', b'y', b'p', b'i', b's', b'o', b'm', 0x00, 0x00,
            0x00, 0x00, b'i', b's', b'o', b'm',
        ];
        assert!(is_video_file(ftyp));
    }

    #[test]
    fn test_is_video_file_jpeg_is_not_video() {
        let jpeg = [0xFF, 0xD8, 0xFF, 0xE0];
        assert!(!is_video_file(&jpeg));
    }

    #[test]
    fn test_is_video_file_empty() {
        assert!(!is_video_file(&[]));
    }

    #[test]
    fn test_find_ffmpeg_runs() {
        // This test verifies the function doesn't panic.
        // It may pass or fail depending on whether ffmpeg is installed.
        let _ = find_ffmpeg();
    }

    /// Build a minimal ISO-BMFF `ftyp` box header with the given major brand
    /// and optional compatible brands, suitable for `is_heic_file` testing.
    fn ftyp_box(major: &[u8; 4], compatible: &[&[u8; 4]]) -> Vec<u8> {
        let mut buf = vec![0x00, 0x00, 0x00, 0x00]; // box size (unused by detector)
        buf.extend_from_slice(b"ftyp");
        buf.extend_from_slice(major);
        buf.extend_from_slice(&[0x00, 0x00, 0x00, 0x00]); // minor version
        for brand in compatible {
            buf.extend_from_slice(*brand);
        }
        buf
    }

    #[test]
    fn test_is_heic_file_major_brands() {
        // Every brand in HEIC_BRANDS should be detected as the major brand.
        for brand in HEIC_BRANDS {
            let buf = ftyp_box(brand, &[]);
            assert!(is_heic_file(&buf), "major brand {brand:?} not detected");
        }
    }

    #[test]
    fn test_is_heic_file_variants_infer_misses() {
        // These brands are detected by mobile but NOT by the `infer` crate's
        // HEIC heuristic — the whole reason we mirror mobile's full set.
        for brand in [b"hevc", b"hevx", b"heim", b"heis"] {
            let buf = ftyp_box(brand, &[]);
            assert!(is_heic_file(&buf), "variant brand {brand:?} not detected");
        }
    }

    #[test]
    fn test_is_heic_file_compatible_brand() {
        // Major brand is generic (mif1), HEIC signaled via compatible brand.
        let buf = ftyp_box(b"mif1", &[b"heic"]);
        assert!(is_heic_file(&buf));
    }

    #[test]
    fn test_is_heic_file_jpeg_is_not_heic() {
        let jpeg = [
            0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, b'J', b'F', b'I', b'F', 0x00, 0x01,
        ];
        assert!(!is_heic_file(&jpeg));
    }

    #[test]
    fn test_is_heic_file_mp4_is_not_heic() {
        // An MP4 ftyp box (isom) must not be misdetected as HEIC.
        let mp4 = ftyp_box(b"isom", &[b"isom", b"iso2"]);
        assert!(!is_heic_file(&mp4));
    }

    #[test]
    fn test_is_heic_file_empty() {
        assert!(!is_heic_file(&[]));
    }

    #[test]
    fn test_is_heic_file_too_short() {
        // Has `ftyp` marker but fewer than 12 bytes — below mobile's threshold.
        let buf = [0x00, 0x00, 0x00, 0x00, b'f', b't', b'y', b'p'];
        assert!(!is_heic_file(&buf));
    }

    #[test]
    fn test_is_heic_file_no_ftyp_marker() {
        // 12+ bytes containing a HEIC brand but no `ftyp` at offset 4.
        let mut buf = vec![0u8; 16];
        buf[8..12].copy_from_slice(b"heic");
        assert!(!is_heic_file(&buf));
    }

    #[test]
    fn test_is_heic_file_brand_past_window() {
        // A HEIC brand sitting beyond the 32-byte scan window must not match,
        // matching mobile's bounded scan. Use non-HEIC major + filler brands
        // so the only HEIC brand present is the one pushed past offset 32.
        let mut buf = ftyp_box(b"isom", &[b"iso2", b"iso4", b"avc1", b"mp41", b"mp42"]);
        buf.extend_from_slice(b"heic"); // lands at offset 36, past the window
        assert!(!is_heic_file(&buf));
    }

    #[test]
    fn test_has_heic_extension() {
        use std::path::Path;
        assert!(has_heic_extension(Path::new("IMG_1234.HEIC")));
        assert!(has_heic_extension(Path::new("photo.heic")));
        assert!(has_heic_extension(Path::new("photo.heif")));
        assert!(has_heic_extension(Path::new("photo.HEIF")));
        assert!(!has_heic_extension(Path::new("photo.jpg")));
        assert!(!has_heic_extension(Path::new("photo.png")));
        assert!(!has_heic_extension(Path::new("noextension")));
    }

    #[test]
    fn test_transcode_to_mp4_drops_source_metadata() {
        let Ok(ffmpeg) = find_ffmpeg() else {
            eprintln!("skipping metadata round-trip: ffmpeg not found");
            return;
        };
        // A short clip whose container carries a GPS location (a `loci` box) and
        // a private stream title (see tests/fixtures/media/README.md).
        let source = media_fixture("sample-with-location.mp4");
        let original = std::fs::read(&source).expect("read fixture");
        for secret in [b"loci".as_slice(), b"private camera stream"] {
            assert!(
                original
                    .windows(secret.len())
                    .any(|window| window == secret),
                "the fixture lost its metadata"
            );
        }

        let output =
            transcode_to_mp4_with_cancellation(&source, &ffmpeg, None).expect("transcode fixture");
        let bytes = std::fs::read(&output).expect("read transcoded video");
        let _ = std::fs::remove_file(&output);
        for secret in [b"loci".as_slice(), b"private camera stream"] {
            assert!(
                !bytes.windows(secret.len()).any(|window| window == secret),
                "source metadata survived transcode"
            );
        }
    }

    #[test]
    fn test_voice_note_envelope_passes_relay_video_validation() {
        if find_ffmpeg().is_err() {
            eprintln!("skipping voice-note round-trip: ffmpeg not found");
            return;
        }

        let source =
            std::env::temp_dir().join(format!("buzz-voice-test-{}.wav", uuid::Uuid::new_v4()));
        let sample_rate = 24_000u32;
        let sample_bytes = sample_rate as usize * 2;
        let mut wav = Vec::with_capacity(44 + sample_bytes);
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&(36 + sample_bytes as u32).to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&sample_rate.to_le_bytes());
        wav.extend_from_slice(&(sample_rate * 2).to_le_bytes());
        wav.extend_from_slice(&2u16.to_le_bytes());
        wav.extend_from_slice(&16u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&(sample_bytes as u32).to_le_bytes());
        wav.resize(44 + sample_bytes, 0);
        std::fs::write(&source, wav).expect("write voice-note fixture");

        let output = match transcode_voice_note_to_mp4_with_cancellation(&source, None) {
            Ok(output) => output,
            Err(error) => {
                eprintln!("skipping voice-note round-trip: {error}");
                let _ = std::fs::remove_file(&source);
                return;
            }
        };
        let relay_config = relay_media_config();
        let metadata = buzz_media_pkg::validation::validate_video_file(&output, &relay_config)
            .expect("relay rejected the canonical voice-note envelope");
        let _ = std::fs::remove_file(&source);
        let _ = std::fs::remove_file(&output);

        assert!(metadata.has_audio);
        assert_eq!((metadata.width, metadata.height), (16, 16));
        // The one-second note must not come out several seconds long.
        assert!(
            (0.9..=1.15).contains(&metadata.duration_secs),
            "video track runs {} s for a 1 s voice note",
            metadata.duration_secs
        );
    }

    #[test]
    fn bundled_ffmpeg_is_found_next_to_the_native_host() {
        let dir = std::env::temp_dir().join(format!("buzz-bundle-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("create bundle dir");
        assert_eq!(bundled_ffmpeg_in(&dir), None, "nothing bundled yet");

        let binary = dir.join(format!("ffmpeg{}", std::env::consts::EXE_SUFFIX));
        std::fs::write(&binary, b"not a real binary").expect("write fake ffmpeg");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o644))
                .expect("chmod 644");
            assert_eq!(bundled_ffmpeg_in(&dir), None, "a file that cannot run");
            std::fs::set_permissions(&binary, std::fs::Permissions::from_mode(0o755))
                .expect("chmod 755");
        }
        assert_eq!(bundled_ffmpeg_in(&dir), Some(binary));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn bundled_ffmpeg_wins_over_the_machines_ffmpeg() {
        let bundled = std::path::PathBuf::from("/app/Resources/ffmpeg");
        let chosen = choose_ffmpeg(Some(bundled.clone()), || {
            panic!("the machine's ffmpeg must not be looked up when one is bundled")
        });
        assert_eq!(chosen, Some(bundled));

        let machine = std::path::PathBuf::from("/opt/homebrew/bin/ffmpeg");
        assert_eq!(
            choose_ffmpeg(None, || Some(machine.clone())),
            Some(machine),
            "the machine's ffmpeg is the fallback"
        );
    }

    #[test]
    fn h264_attempts_follow_what_the_ffmpeg_build_can_encode() {
        let lgpl_mac = " V....D h264_videotoolbox    VideoToolbox H.264 Encoder (codec h264)\n\
                         VFS..D mjpeg                MJPEG (Motion JPEG)\n\
                         A....D aac                  AAC (Advanced Audio Coding)\n";
        let attempts = h264_attempts(lgpl_mac);
        assert_eq!(attempts.len(), 1);
        assert_eq!(attempts[0][1], "h264_videotoolbox");

        let lgpl_windows = " V....D h264_mf             H264 via MediaFoundation (codec h264)\n";
        let attempts = h264_attempts(lgpl_windows);
        assert_eq!(attempts.len(), 2, "quality mode, then a fixed bitrate");
        assert!(attempts.iter().all(|args| args[1] == "h264_mf"));

        let gpl = " V....D libx264              libx264 H.264 / AVC (codec h264)\n\
                    V....D h264_videotoolbox    VideoToolbox H.264 Encoder (codec h264)\n";
        let attempts = h264_attempts(gpl);
        assert_eq!(attempts[0][1], "libx264", "libx264 stays the first choice");
        assert_eq!(attempts[1][1], "h264_videotoolbox");

        let audio_only = " A....D aac                  AAC (Advanced Audio Coding)\n";
        assert!(h264_attempts(audio_only).is_empty());
        // The legend line must not be read as an encoder called "=".
        assert!(h264_attempts(" V..... = Video\n").is_empty());
    }

    #[test]
    fn wav_duration_is_read_from_the_header() {
        let sample_rate = 16_000u32;
        let data = vec![0u8; sample_rate as usize * 2 * 3];
        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&(36 + data.len() as u32).to_le_bytes());
        wav.extend_from_slice(b"WAVEfmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&1u16.to_le_bytes());
        wav.extend_from_slice(&sample_rate.to_le_bytes());
        wav.extend_from_slice(&(sample_rate * 2).to_le_bytes());
        wav.extend_from_slice(&2u16.to_le_bytes());
        wav.extend_from_slice(&16u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&(data.len() as u32).to_le_bytes());
        wav.extend_from_slice(&data);

        let secs = wav_duration_secs(&wav[..44], wav.len() as u64).expect("a 3 s WAV");
        assert!((secs - 3.0).abs() < 0.001, "{secs}");
        // A header that promises more than the file holds is capped by the file.
        let truncated = wav_duration_secs(&wav[..44], 44 + 32_000).expect("a truncated WAV");
        assert!((truncated - 1.0).abs() < 0.001, "{truncated}");
        assert_eq!(wav_duration_secs(b"ID3 not a wav file", 100), None);
        assert_eq!(wav_duration_secs(&wav[..20], wav.len() as u64), None);
    }

    /// Every video the upload path accepts must come out as something the
    /// relay's video validator takes, whichever H.264 encoder the ffmpeg in use
    /// offers. Runs against the ffmpeg bundled in CI (`COLONY_FFMPEG_PATH`) or
    /// whichever one the machine has; skipped when none can encode H.264.
    #[test]
    fn test_fixture_videos_transcode_to_what_the_relay_accepts() {
        let Ok(ffmpeg) = find_ffmpeg() else {
            eprintln!("skipping video transcode: ffmpeg not found");
            return;
        };
        if available_h264_attempts(&ffmpeg).is_err() {
            eprintln!("skipping video transcode: this ffmpeg has no H.264 encoder");
            return;
        }
        for name in ["sample-h264.mp4", "sample-hevc.mov"] {
            let (video, _poster) = transcode_and_extract_poster(&media_fixture(name))
                .unwrap_or_else(|error| panic!("{name} did not transcode: {error}"));
            let output =
                std::env::temp_dir().join(format!("buzz-fixture-{}.mp4", uuid::Uuid::new_v4()));
            std::fs::write(&output, &video).expect("write transcoded video");
            let metadata =
                buzz_media_pkg::validation::validate_video_file(&output, &relay_media_config())
                    .unwrap_or_else(|error| panic!("relay rejected the {name} transcode: {error}"));
            let _ = std::fs::remove_file(&output);
            assert!(metadata.has_audio, "{name} lost its audio");
            assert!(metadata.duration_secs > 0.5, "{name} came out empty");
        }
    }

    #[test]
    fn test_fixture_heic_transcodes_to_jpeg() {
        let Ok(_) = find_ffmpeg() else {
            eprintln!("skipping HEIC fixture: ffmpeg not found");
            return;
        };
        let heic = media_fixture("sample.heic");
        let bytes = std::fs::read(&heic).expect("read HEIC fixture");
        assert!(is_heic_file(&bytes), "fixture is not detected as HEIC");
        let jpeg = transcode_heic_path_to_jpeg_bytes(&heic).expect("HEIC to JPEG");
        assert_eq!(&jpeg[0..2], &[0xFF, 0xD8], "output is not a JPEG");
    }
}
