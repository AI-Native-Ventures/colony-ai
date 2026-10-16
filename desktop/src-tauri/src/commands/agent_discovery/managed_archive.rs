//! Pinned download and safe extraction for Colony-managed runtimes (private
//! Node.js, OpenCode). Every archive is checked against a pinned SHA256 and a
//! size cap before anything is unpacked.
use sha2::{Digest, Sha256};
use std::path::Path;
use std::time::Duration;
use std::{io::Read, io::Write};

pub(super) fn download_verified(
    url: &str,
    dest: &Path,
    expected_sha256: &str,
    max_bytes: u64,
    label: &str,
) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(5 * 60))
        .build()
        .map_err(|e| format!("build {label} download client: {e}"))?;
    let response = client
        .get(url)
        .send()
        .map_err(|e| format!("download {label} request failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "download {label} HTTP {}: {}",
            response.status().as_u16(),
            response.status().canonical_reason().unwrap_or("unknown")
        ));
    }
    if let Some(total) = response.content_length() {
        if total > max_bytes {
            return Err(format!(
                "download {label} too large: {total} bytes (max {max_bytes})"
            ));
        }
    }

    let mut response = response;
    let mut file =
        std::fs::File::create(dest).map_err(|e| format!("create {label} archive: {e}"))?;
    let mut hasher = Sha256::new();
    let mut downloaded = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let read = response
            .read(&mut buffer)
            .map_err(|e| format!("download {label} stream error: {e}"))?;
        if read == 0 {
            break;
        }
        downloaded += read as u64;
        if downloaded > max_bytes {
            let _ = std::fs::remove_file(dest);
            return Err(format!(
                "download {label} exceeded max size: {downloaded} bytes (max {max_bytes})"
            ));
        }
        file.write_all(&buffer[..read])
            .map_err(|e| format!("write {label} archive: {e}"))?;
        hasher.update(&buffer[..read]);
    }
    file.flush()
        .map_err(|e| format!("flush {label} archive: {e}"))?;

    let actual = hex::encode(hasher.finalize());
    if actual != expected_sha256 {
        let _ = std::fs::remove_file(dest);
        return Err(format!(
            "download {label} hash mismatch: expected {expected_sha256}, got {actual}"
        ));
    }
    Ok(())
}

pub(super) fn extract_archive(
    archive_path: &Path,
    dest_dir: &Path,
    filename: &str,
    label: &str,
) -> Result<(), String> {
    if filename.ends_with(".tar.gz") {
        let file =
            std::fs::File::open(archive_path).map_err(|e| format!("open {label} archive: {e}"))?;
        let decoder = flate2::read::GzDecoder::new(file);
        let mut archive = tar::Archive::new(decoder);
        validate_tar_entries(&mut archive, label)?;

        let file = std::fs::File::open(archive_path)
            .map_err(|e| format!("open {label} archive for extraction: {e}"))?;
        let decoder = flate2::read::GzDecoder::new(file);
        let mut archive = tar::Archive::new(decoder);
        archive
            .unpack(dest_dir)
            .map_err(|e| format!("extract {label} archive: {e}"))
    } else if filename.ends_with(".zip") {
        let file =
            std::fs::File::open(archive_path).map_err(|e| format!("open {label} archive: {e}"))?;
        let mut archive =
            zip::ZipArchive::new(file).map_err(|e| format!("read {label} zip archive: {e}"))?;
        validate_zip_entries(&archive, label)?;
        extract_zip(&mut archive, dest_dir, label)
    } else {
        Err(format!("unsupported managed {label} archive: {filename}"))
    }
}

/// Validate ZIP entry names using platform-neutral string logic.
///
/// `std::path::Path` is intentionally avoided: its `is_absolute()` and
/// `Component` parsing use BUILD-HOST grammar, so `/etc/passwd` is not
/// `is_absolute()` on Windows (no drive prefix), causing the check to lie on
/// the platform this guard exists to protect.  Instead we apply pure string
/// rules that produce identical results on every host:
///
/// - Unix-rooted: starts with `/`
/// - Windows-rooted: starts with `\`, has a drive prefix (`X:`), or is UNC
///   (`\\` / `//`)
/// - Traversal: any component that is `..` when split on EITHER `/` or `\`
pub(super) fn validate_zip_entries(
    archive: &zip::ZipArchive<std::fs::File>,
    label: &str,
) -> Result<(), String> {
    for i in 0..archive.len() {
        let name = archive
            .name_for_index(i)
            .ok_or_else(|| format!("{label} zip entry {i}: missing name"))?;

        // Absolute-path checks (platform-neutral).
        if name.starts_with('/') || name.starts_with('\\') {
            return Err(format!("{label} zip contains absolute path: {name}"));
        }
        // Drive prefix: one ASCII letter followed by ':'
        if name.len() >= 2 && name.as_bytes()[1] == b':' && name.as_bytes()[0].is_ascii_alphabetic()
        {
            return Err(format!("{label} zip contains absolute path: {name}"));
        }
        // UNC prefix: // or \\ (covered by starts_with checks above for \\,
        // and // is caught by starts_with('/') then a second '/' — belt + suspenders).
        // (Already caught by the starts_with checks above; explicit for clarity.)

        // Traversal: split on both separators and check each component.
        let has_traversal = name.split(['/', '\\']).any(|component| component == "..");
        if has_traversal {
            return Err(format!("{label} zip contains path traversal: {name}"));
        }
    }
    Ok(())
}

fn extract_zip(
    archive: &mut zip::ZipArchive<std::fs::File>,
    dest_dir: &Path,
    label: &str,
) -> Result<(), String> {
    for i in 0..archive.len() {
        let mut entry = archive
            .by_index(i)
            .map_err(|e| format!("{label} zip entry {i}: {e}"))?;
        let outpath = match entry.enclosed_name() {
            Some(p) => dest_dir.join(p),
            None => {
                return Err(format!(
                    "{label} zip contains unsafe path: {}",
                    entry.name()
                ))
            }
        };
        if entry.is_dir() {
            std::fs::create_dir_all(&outpath)
                .map_err(|e| format!("create dir in {label} zip: {e}"))?;
        } else {
            if let Some(parent) = outpath.parent() {
                std::fs::create_dir_all(parent)
                    .map_err(|e| format!("create parent dir in {label} zip: {e}"))?;
            }
            let mut out = std::fs::File::create(&outpath)
                .map_err(|e| format!("create file in {label} zip: {e}"))?;
            std::io::copy(&mut entry, &mut out)
                .map_err(|e| format!("extract file in {label} zip: {e}"))?;
        }
    }
    Ok(())
}

fn validate_tar_entries<R: std::io::Read>(
    archive: &mut tar::Archive<R>,
    label: &str,
) -> Result<(), String> {
    let entries = archive
        .entries()
        .map_err(|e| format!("read {label} archive entries: {e}"))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("{label} archive entry: {e}"))?;
        let path = entry
            .path()
            .map_err(|e| format!("{label} archive entry path: {e}"))?;
        let path_str = path.to_string_lossy();
        if path.is_absolute() {
            return Err(format!(
                "{label} archive contains absolute path: {path_str}"
            ));
        }
        if path
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
        {
            return Err(format!(
                "{label} archive contains path traversal: {path_str}"
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "managed_archive_tests.rs"]
mod tests;
