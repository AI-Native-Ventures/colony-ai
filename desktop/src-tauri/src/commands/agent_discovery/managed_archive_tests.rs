use super::*;

/// Build a zip archive on disk with the supplied entries (zip::ZipArchive
/// requires Seek, so the bytes go through a temp file).
fn zip_with(entries: &[(&str, &[u8])]) -> tempfile::NamedTempFile {
    let mut buf: Vec<u8> = Vec::new();
    {
        let mut writer = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
        let opts = zip::write::SimpleFileOptions::default();
        for (name, body) in entries {
            writer.start_file(*name, opts).unwrap();
            writer.write_all(body).unwrap();
        }
        writer.finish().unwrap();
    }
    let mut tmp = tempfile::NamedTempFile::new().unwrap();
    tmp.write_all(&buf).unwrap();
    tmp
}

/// Serve one HTTP response with `body` on localhost and return its URL.
fn serve_once(body: Vec<u8>) -> String {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = listener.local_addr().unwrap();
    std::thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let mut request = [0_u8; 2048];
            let _ = stream.read(&mut request);
            let header = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(header.as_bytes());
            let _ = stream.write_all(&body);
        }
    });
    format!("http://{addr}/archive.zip")
}

#[test]
fn extract_archive_unpacks_zip_root_binary() {
    let archive = zip_with(&[("opencode", b"#!/bin/sh\necho ok\n")]);
    let out = tempfile::tempdir().unwrap();
    extract_archive(
        archive.path(),
        out.path(),
        "opencode-darwin-arm64.zip",
        "OpenCode",
    )
    .unwrap();
    assert!(out.path().join("opencode").is_file());
}

#[test]
fn extract_archive_refuses_traversal_entry() {
    let archive = zip_with(&[("../escape", b"x")]);
    let parent = tempfile::tempdir().unwrap();
    let out = parent.path().join("out");
    std::fs::create_dir_all(&out).unwrap();
    let err = extract_archive(archive.path(), &out, "x.zip", "OpenCode").unwrap_err();
    assert_eq!(err, "OpenCode zip contains path traversal: ../escape");
    assert!(!parent.path().join("escape").exists());
}

#[test]
fn extract_archive_rejects_unknown_extension() {
    let out = tempfile::tempdir().unwrap();
    let err = extract_archive(out.path(), out.path(), "x.rar", "OpenCode").unwrap_err();
    assert_eq!(err, "unsupported managed OpenCode archive: x.rar");
}

#[test]
fn download_verified_accepts_matching_digest() {
    let body = b"pinned bytes".to_vec();
    let digest = hex::encode(Sha256::digest(&body));
    let url = serve_once(body.clone());
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("archive.zip.download");
    download_verified(&url, &dest, &digest, 1024, "OpenCode").unwrap();
    assert_eq!(std::fs::read(&dest).unwrap(), body);
}

#[test]
fn download_verified_rejects_digest_mismatch_and_removes_file() {
    let url = serve_once(b"not the pinned bytes".to_vec());
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("archive.zip.download");
    let err = download_verified(&url, &dest, &"0".repeat(64), 1024, "OpenCode").unwrap_err();
    assert!(err.starts_with("download OpenCode hash mismatch"), "{err}");
    assert!(!dest.exists());
}

#[test]
fn download_verified_rejects_oversize_body() {
    let url = serve_once(vec![7_u8; 4096]);
    let dir = tempfile::tempdir().unwrap();
    let dest = dir.path().join("archive.zip.download");
    let err = download_verified(&url, &dest, &"0".repeat(64), 1024, "OpenCode").unwrap_err();
    assert!(
        err.starts_with("download OpenCode too large")
            || err.starts_with("download OpenCode exceeded max size"),
        "{err}"
    );
    assert!(!dest.exists());
}
