//! Storing media that a third party (a WhatsApp customer, through Meta) sent to a business.
//!
//! The normal upload pipeline expects a client that already stripped metadata and refuses
//! audio. Customer media arrives as it is, so this module cleans what it safely can (JPEG and
//! WebP metadata segments), runs the same validators as an upload, and falls back to storing
//! the exact bytes as an opaque download when a validator refuses them. Nothing is lost and
//! nothing active is ever served inline: opaque blobs are served as attachments.

use bytes::Bytes;
use nostr::{EventBuilder, Keys, Kind, Tag, Timestamp};
use sha2::{Digest, Sha256};

use buzz_core::tenant::TenantContext;

use crate::config::MediaConfig;
use crate::error::MediaError;
use crate::storage::{BlobMeta, MediaStorage};
use crate::upload::{process_file_upload, process_upload, process_video_upload};

/// What `store_inbound` kept.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredInbound {
    /// SHA-256 of the stored bytes (hex).
    pub sha256: String,
    /// File extension of the stored key.
    pub ext: String,
    /// MIME type recorded in the sidecar.
    pub mime: String,
    /// Stored size in bytes.
    pub size: u64,
    /// The media pipeline refused the bytes, so they were kept as an opaque download.
    pub opaque: bool,
}

/// Broad class of a blob, from its bytes and never from a header.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InboundClass {
    /// JPEG, PNG, GIF or WebP.
    Image,
    /// Anything `infer` reads as video.
    Video,
    /// Anything `infer` reads as audio.
    Audio,
    /// Everything else.
    Document,
}

/// The MIME type the bytes declare by their magic number. An Ogg container is read as audio
/// directly, because WhatsApp voice notes are Ogg Opus and `infer` has changed how it names it.
pub fn sniff_mime(bytes: &[u8]) -> Option<String> {
    if bytes.starts_with(b"OggS") {
        return Some("audio/ogg".to_string());
    }
    infer::get(bytes).map(|kind| kind.mime_type().to_string())
}

/// Classify bytes by their magic number.
pub fn classify(bytes: &[u8]) -> InboundClass {
    match sniff_mime(bytes).as_deref() {
        Some("image/jpeg" | "image/png" | "image/gif" | "image/webp") => InboundClass::Image,
        Some(mime) if mime.starts_with("video/") => InboundClass::Video,
        Some(mime) if mime.starts_with("audio/") => InboundClass::Audio,
        _ => InboundClass::Document,
    }
}

/// Remove metadata segments from a JPEG: every APPn and comment segment. Entropy-coded data
/// is copied as it is. `None` when the bytes are not a well-formed JPEG header chain.
pub fn strip_jpeg_metadata(bytes: &[u8]) -> Option<Vec<u8>> {
    if !bytes.starts_with(&[0xff, 0xd8]) {
        return None;
    }
    let mut out = Vec::with_capacity(bytes.len());
    out.extend_from_slice(&[0xff, 0xd8]);
    let mut i = 2usize;
    while i < bytes.len() {
        if bytes[i] != 0xff {
            return None;
        }
        while i < bytes.len() && bytes[i] == 0xff {
            i += 1;
        }
        let marker = *bytes.get(i)?;
        i += 1;
        if marker == 0xd9 {
            out.extend_from_slice(&[0xff, 0xd9]);
            return Some(out);
        }
        if (0xd0..=0xd7).contains(&marker) || marker == 0x01 || marker == 0xd8 {
            return None;
        }
        let len = usize::from(u16::from_be_bytes([*bytes.get(i)?, *bytes.get(i + 1)?]));
        if len < 2 {
            return None;
        }
        let end = i.checked_add(len).filter(|&end| end <= bytes.len())?;
        let metadata = (0xe0..=0xef).contains(&marker) || marker == 0xfe;
        if !metadata {
            out.extend_from_slice(&[0xff, marker]);
            out.extend_from_slice(&bytes[i..end]);
        }
        i = end;
        if marker == 0xda {
            // Start of scan: the entropy-coded data and any later scans follow unchanged. Cut
            // anything after the last end-of-image marker so trailing bytes are not stored.
            let rest = &bytes[i..];
            let eoi = rest.windows(2).rposition(|pair| pair == [0xff, 0xd9])?;
            out.extend_from_slice(&rest[..eoi + 2]);
            return Some(out);
        }
    }
    None
}

/// Remove ICC, EXIF and XMP chunks from a WebP and fix the container header. Image and
/// animation chunks are copied as they are. `None` when the bytes are not a well-formed WebP.
pub fn strip_webp_metadata(bytes: &[u8]) -> Option<Vec<u8>> {
    if bytes.len() < 12 || &bytes[..4] != b"RIFF" || &bytes[8..12] != b"WEBP" {
        return None;
    }
    let declared = usize::try_from(u32::from_le_bytes(bytes[4..8].try_into().ok()?)).ok()?;
    // Some encoders write a RIFF size shorter than the file; never read past either.
    let limit = declared.checked_add(8)?.min(bytes.len());
    let mut body: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 12usize;
    while i < limit {
        let header = bytes.get(i..i + 8)?;
        let kind: [u8; 4] = header[..4].try_into().ok()?;
        let len = usize::try_from(u32::from_le_bytes(header[4..8].try_into().ok()?)).ok()?;
        let padded = len.checked_add(len & 1)?;
        let end = (i + 8).checked_add(padded).filter(|&end| end <= limit)?;
        let drop = matches!(&kind, b"ICCP" | b"EXIF" | b"XMP ");
        if !drop {
            let mut chunk = bytes[i..end].to_vec();
            if &kind == b"VP8X" && chunk.len() > 8 {
                // Clear the ICC (0x20), EXIF (0x08) and XMP (0x04) presence flags.
                chunk[8] &= !(0x20 | 0x08 | 0x04);
            }
            body.extend_from_slice(&chunk);
        }
        i = end;
    }
    let total = u32::try_from(body.len().checked_add(4)?).ok()?;
    let mut out = Vec::with_capacity(body.len() + 12);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&total.to_le_bytes());
    out.extend_from_slice(b"WEBP");
    out.extend_from_slice(&body);
    Some(out)
}

fn audio_ext(mime: &str) -> &'static str {
    match mime {
        "audio/ogg" | "audio/x-ogg" => "ogg",
        "audio/opus" => "opus",
        "audio/mpeg" | "audio/mp3" => "mp3",
        "audio/mp4" | "audio/m4a" | "audio/x-m4a" => "m4a",
        "audio/aac" => "aac",
        "audio/amr" => "amr",
        "audio/flac" | "audio/x-flac" => "flac",
        "audio/wav" | "audio/x-wav" => "wav",
        _ => "bin",
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

/// A short-lived Blossom upload authorization signed by the relay itself, so the stored bytes
/// go through the same verified pipeline as any other upload.
fn relay_upload_auth(
    keys: &Keys,
    ctx: &TenantContext,
    sha256: &str,
) -> Result<nostr::Event, MediaError> {
    let now = Timestamp::now().as_secs();
    let tags = [
        vec!["t".to_string(), "upload".to_string()],
        vec!["x".to_string(), sha256.to_string()],
        vec!["expiration".to_string(), (now + 300).to_string()],
        vec!["server".to_string(), ctx.host().to_string()],
    ]
    .into_iter()
    .map(Tag::parse)
    .collect::<Result<Vec<_>, _>>()
    .map_err(|_| MediaError::Internal)?;
    EventBuilder::new(Kind::from(24242u16), "Store inbound WhatsApp media")
        .tags(tags)
        .sign_with_keys(keys)
        .map_err(|_| MediaError::Internal)
}

/// Keep the exact bytes as a download that is never rendered inline.
async fn store_opaque(
    storage: &MediaStorage,
    ctx: &TenantContext,
    bytes: &Bytes,
    mime: &str,
    ext: &str,
) -> Result<StoredInbound, MediaError> {
    let sha256 = sha256_hex(bytes);
    let key = format!("{sha256}.{ext}");
    let meta_key = MediaStorage::ctx_sidecar_key(ctx, &sha256);
    if !(storage.head(&meta_key).await? && storage.head(&key).await?) {
        storage.put(&key, bytes, mime).await?;
        let meta = BlobMeta {
            size: bytes.len() as u64,
            ext: ext.to_string(),
            mime_type: mime.to_string(),
            uploaded_at: chrono::Utc::now().timestamp(),
            ..BlobMeta::default()
        };
        storage.put_sidecar(ctx, &sha256, &meta).await?;
    }
    Ok(StoredInbound {
        sha256,
        ext: ext.to_string(),
        mime: mime.to_string(),
        size: bytes.len() as u64,
        opaque: true,
    })
}

async fn store_validated(
    storage: &MediaStorage,
    config: &MediaConfig,
    ctx: &TenantContext,
    keys: &Keys,
    class: InboundClass,
    bytes: Bytes,
) -> Result<StoredInbound, MediaError> {
    let sha256 = sha256_hex(&bytes);
    let auth = relay_upload_auth(keys, ctx, &sha256)?;
    let size = bytes.len() as u64;
    let descriptor = match class {
        InboundClass::Image => process_upload(storage, config, ctx, &auth, bytes, None).await?,
        InboundClass::Video => {
            let stream = futures_util::stream::iter(vec![Ok::<Bytes, axum::Error>(bytes)]);
            process_video_upload(storage, config, ctx, &auth, stream, Some(size), None).await?
        }
        InboundClass::Document | InboundClass::Audio => {
            process_file_upload(storage, config, ctx, &auth, bytes, None).await?
        }
    };
    let ext = descriptor
        .url
        .rsplit('.')
        .next()
        .unwrap_or("bin")
        .to_string();
    Ok(StoredInbound {
        sha256: descriptor.sha256,
        ext,
        mime: descriptor.mime_type,
        size: descriptor.size,
        opaque: false,
    })
}

/// Store customer media for one business.
///
/// Images lose their metadata segments first and then go through the upload validator; video
/// and documents go through theirs; audio is kept as it is (the upload pipeline has no audio
/// sanitizer). When a validator refuses the bytes they are kept as an opaque download, so a
/// sticker or voice note is never lost to a strict rule. A storage error is returned so the
/// caller can retry.
pub async fn store_inbound(
    storage: &MediaStorage,
    config: &MediaConfig,
    ctx: &TenantContext,
    keys: &Keys,
    bytes: Bytes,
) -> Result<StoredInbound, MediaError> {
    let class = classify(&bytes);
    match class {
        InboundClass::Audio => {
            let mime = sniff_mime(&bytes).unwrap_or_else(|| "application/octet-stream".to_string());
            let ext = audio_ext(&mime);
            let mime = if ext == "bin" {
                "application/octet-stream".to_string()
            } else {
                mime
            };
            store_opaque(storage, ctx, &bytes, &mime, ext).await
        }
        InboundClass::Image => {
            let mime = sniff_mime(&bytes);
            let cleaned = match mime.as_deref() {
                Some("image/jpeg") => strip_jpeg_metadata(&bytes),
                Some("image/webp") => strip_webp_metadata(&bytes),
                _ => Some(bytes.to_vec()),
            };
            if let Some(cleaned) = cleaned {
                match store_validated(storage, config, ctx, keys, class, Bytes::from(cleaned)).await
                {
                    Ok(stored) => return Ok(stored),
                    Err(error) if is_content_refusal(&error) => {
                        tracing::info!("inbound image kept as a download: {error}");
                    }
                    Err(error) => return Err(error),
                }
            }
            store_opaque(storage, ctx, &bytes, "application/octet-stream", "bin").await
        }
        InboundClass::Video | InboundClass::Document => {
            match store_validated(storage, config, ctx, keys, class, bytes.clone()).await {
                Ok(stored) => Ok(stored),
                Err(error) if is_content_refusal(&error) => {
                    tracing::info!("inbound file kept as a download: {error}");
                    store_opaque(storage, ctx, &bytes, "application/octet-stream", "bin").await
                }
                Err(error) => Err(error),
            }
        }
    }
}

/// The bytes themselves were refused (as opposed to storage or auth failing), so storing them
/// again will not help and an opaque download is the right fallback.
fn is_content_refusal(error: &MediaError) -> bool {
    matches!(
        error,
        MediaError::UnknownContentType
            | MediaError::DisallowedContentType(_)
            | MediaError::ImageTooLarge
            | MediaError::InvalidImage
            | MediaError::MetadataForbidden
            | MediaError::WrongCodec
            | MediaError::DurationTooLong
            | MediaError::ResolutionTooHigh
            | MediaError::FileTooLarge { .. }
    ) || matches!(error, MediaError::InvalidVideo | MediaError::MoovNotAtFront)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::validation::validate_content;

    fn webp_with(chunks: &[(&[u8; 4], &[u8])], vp8x_flags: u8) -> Vec<u8> {
        let mut body = Vec::new();
        // VP8X: flags, 3 reserved, canvas width-1 (3 bytes), height-1 (3 bytes).
        let vp8x = vec![vp8x_flags, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        body.extend_from_slice(b"VP8X");
        body.extend_from_slice(&10u32.to_le_bytes());
        body.extend_from_slice(&vp8x);
        for (kind, payload) in chunks {
            body.extend_from_slice(*kind);
            body.extend_from_slice(&(payload.len() as u32).to_le_bytes());
            body.extend_from_slice(payload);
            if payload.len() % 2 == 1 {
                body.push(0);
            }
        }
        let mut out = b"RIFF".to_vec();
        out.extend_from_slice(&((body.len() + 4) as u32).to_le_bytes());
        out.extend_from_slice(b"WEBP");
        out.extend_from_slice(&body);
        out
    }

    fn chunk_kinds(bytes: &[u8]) -> Vec<String> {
        let mut kinds = Vec::new();
        let mut i = 12;
        while i + 8 <= bytes.len() {
            kinds.push(String::from_utf8_lossy(&bytes[i..i + 4]).into_owned());
            let len = u32::from_le_bytes(bytes[i + 4..i + 8].try_into().unwrap()) as usize;
            i += 8 + len + (len & 1);
        }
        kinds
    }

    #[test]
    fn a_sticker_with_exif_loses_the_exif_chunk_and_keeps_its_image() {
        let sticker = webp_with(
            &[
                (b"ANIM", &[0u8; 6]),
                (b"EXIF", b"sticker-pack-id"),
                (b"XMP ", b"<x/>"),
                (b"ICCP", b"icc"),
                (b"VP8L", &[0x2f, 0, 0, 0, 0]),
            ],
            0x20 | 0x08 | 0x04 | 0x02,
        );
        let cleaned = strip_webp_metadata(&sticker).expect("well formed");
        assert_eq!(chunk_kinds(&cleaned), ["VP8X", "ANIM", "VP8L"]);
        // The animation flag stays, the three metadata flags go.
        assert_eq!(cleaned[20] & (0x20 | 0x08 | 0x04), 0);
        assert_eq!(cleaned[20] & 0x02, 0x02);
        // The RIFF size matches the new length.
        let declared = u32::from_le_bytes(cleaned[4..8].try_into().unwrap()) as usize;
        assert_eq!(declared + 8, cleaned.len());
    }

    #[test]
    fn a_broken_webp_is_not_cleaned() {
        assert!(strip_webp_metadata(b"RIFF").is_none());
        // A chunk that claims more bytes than the container holds is refused.
        let mut lying = webp_with(&[(b"VP8L", &[1, 2, 3, 4])], 0);
        let at = lying.len() - 8;
        lying[at..at + 4].copy_from_slice(&1000u32.to_le_bytes());
        assert!(strip_webp_metadata(&lying).is_none());
    }

    #[test]
    fn jpeg_metadata_segments_are_dropped_and_the_scan_kept() {
        let mut jpeg = vec![0xff, 0xd8];
        // APP1 (EXIF) and a comment, then SOF0, SOS with two entropy bytes, EOI, junk.
        jpeg.extend_from_slice(&[0xff, 0xe1, 0x00, 0x08, b'E', b'x', b'i', b'f', 0, 0]);
        jpeg.extend_from_slice(&[0xff, 0xfe, 0x00, 0x04, b'h', b'i']);
        jpeg.extend_from_slice(&[0xff, 0xc0, 0x00, 0x05, 8, 0, 0]);
        jpeg.extend_from_slice(&[0xff, 0xda, 0x00, 0x04, 1, 0]);
        jpeg.extend_from_slice(&[0x12, 0x34, 0xff, 0xd9, 0xaa, 0xbb]);
        let cleaned = strip_jpeg_metadata(&jpeg).expect("well formed");
        assert!(!cleaned.windows(4).any(|w| w == b"Exif"));
        assert!(cleaned.starts_with(&[0xff, 0xd8, 0xff, 0xc0]));
        assert!(cleaned.ends_with(&[0x12, 0x34, 0xff, 0xd9]));
        assert!(strip_jpeg_metadata(b"not a jpeg").is_none());
    }

    #[test]
    fn classes_come_from_the_bytes() {
        assert_eq!(
            classify(&[0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]),
            InboundClass::Image
        );
        assert_eq!(classify(b"OggS\0\x02\0\0\0\0\0\0\0\0"), InboundClass::Audio);
        assert_eq!(classify(b"%PDF-1.7 hello"), InboundClass::Document);
        assert_eq!(classify(b"plain text"), InboundClass::Document);
    }

    #[test]
    fn cleaned_webp_passes_the_upload_validator_structure() {
        // GUARD: a sticker with an EXIF chunk used to be refused by the upload pipeline.
        let sticker = webp_with(
            &[(b"EXIF", b"meta"), (b"VP8L", &[0x2f, 0, 0, 0, 0, 0])],
            0x08,
        );
        let config = crate::config::MediaConfig {
            s3_endpoint: String::new(),
            s3_access_key: String::new(),
            s3_secret_key: String::new(),
            s3_bucket: String::new(),
            s3_region: "us-east-1".to_string(),
            s3_addressing_style: crate::config::S3AddressingStyle::Path,
            max_image_bytes: 50 * 1024 * 1024,
            max_gif_bytes: 10 * 1024 * 1024,
            max_video_bytes: 524_288_000,
            max_file_bytes: 104_857_600,
            public_base_url: "https://media.example.com".to_string(),
            upload_records_enabled: false,
            upload_ip_header: None,
            upload_port_header: None,
        };
        let raw = validate_content(&sticker, &config);
        assert!(raw.is_err(), "the raw sticker has to be refused");
        let cleaned = strip_webp_metadata(&sticker).expect("well formed");
        // The validator also needs decodable dimensions, which this synthetic stub lacks, so
        // only the metadata verdict is compared: it must not be MetadataForbidden any more.
        let verdict = validate_content(&cleaned, &config);
        assert!(!matches!(verdict, Err(MediaError::MetadataForbidden)));
    }
}
