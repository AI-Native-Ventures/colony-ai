//! Local Open Design project review and brand-profile storage.
//!
//! All paths are anchored under Colony's app data. Preview bytes are bounded,
//! thumbnails are copied into data URLs, and review actions update only the
//! local project manifest.

use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

const PREVIEW_MAX_BYTES: u64 = 2 * 1024 * 1024;
const BRAND_MAX_BYTES: usize = 3 * 1024 * 1024;
const THUMBNAIL_MAX_BYTES: u64 = 8 * 1024 * 1024;
const MAX_THUMBNAILS: usize = 2;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColonyDesignBrandProfile {
    community_id: String,
    relay_url: String,
    profile: BrandFields,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrandFields {
    pub name: String,
    pub website: String,
    pub description: String,
    pub logo_data_url: Option<String>,
    pub logo_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColonyDesignThumbnail {
    name: String,
    data_url: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColonyDesignReview {
    project_id: String,
    title: String,
    status: String,
    review: String,
    preview_html: String,
    thumbnails: Vec<ColonyDesignThumbnail>,
    feedback: Option<String>,
}

#[tauri::command]
pub fn save_colony_design_brand_profile(
    community_id: String,
    relay_url: String,
    profile: BrandFields,
) -> Result<(), String> {
    let community_id = safe_uuid(&community_id)?;
    if relay_url.len() > 2048 || !valid_relay_url(&relay_url) {
        return Err("The business relay URL is invalid.".into());
    }
    if profile.name.len() > 512
        || profile.website.len() > 2048
        || profile.description.len() > 16_000
        || profile
            .logo_data_url
            .as_ref()
            .is_some_and(|value| value.len() > BRAND_MAX_BYTES)
        || profile
            .logo_url
            .as_ref()
            .is_some_and(|value| value.len() > 2048)
    {
        return Err("The business brand profile is too large.".into());
    }
    let root = design_root()?;
    let directory = root.join("brand-profiles");
    ensure_private_dir(&root)?;
    ensure_private_dir(&directory)?;
    let canonical_root = fs::canonicalize(&root).map_err(|error| error.to_string())?;
    let canonical_directory = fs::canonicalize(&directory).map_err(|error| error.to_string())?;
    if !canonical_directory.starts_with(&canonical_root) {
        return Err("The business brand profile path is outside Colony data.".into());
    }
    let relay_url = relay_url.trim().trim_end_matches('/').to_lowercase();
    let payload = json!({ "relayUrl": relay_url, "profile": profile });
    let raw = serde_json::to_vec(&payload).map_err(|error| error.to_string())?;
    if raw.len() > BRAND_MAX_BYTES {
        return Err("The business brand profile is too large.".into());
    }
    write_private_atomic(
        &canonical_directory.join(format!("{community_id}.json")),
        &raw,
    )
}

#[tauri::command]
pub fn get_colony_design_review(project_id: String) -> Result<ColonyDesignReview, String> {
    let (root, project_dir, manifest_path) = project_paths(&project_id)?;
    let raw = read_bounded(&manifest_path, 1024 * 1024)?;
    let manifest: Value =
        serde_json::from_slice(&raw).map_err(|_| "Design metadata is invalid.")?;
    if manifest.get("id").and_then(Value::as_str) != Some(project_id.as_str()) {
        return Err("Design metadata does not match this project.".into());
    }
    let title = bounded_string(&manifest, "title", 512).unwrap_or_else(|| "Design review".into());
    let status = bounded_string(&manifest, "status", 64).unwrap_or_else(|| "unknown".into());
    let review = bounded_string(&manifest, "review", 64).unwrap_or_else(|| "pending".into());
    let feedback = bounded_string(&manifest, "feedback", 4096);
    let preview_html = manifest
        .get("previewHtmlPath")
        .and_then(Value::as_str)
        .map(|path| safe_project_file(&root, &project_dir, Path::new(path), PREVIEW_MAX_BYTES))
        .transpose()?
        .map(|bytes| sanitize_preview(&String::from_utf8_lossy(&bytes)))
        .unwrap_or_default();
    let thumbnails = read_thumbnails(&root, &project_dir, &manifest)?;
    Ok(ColonyDesignReview {
        project_id,
        title,
        status,
        review,
        preview_html,
        thumbnails,
        feedback,
    })
}

#[tauri::command]
pub fn review_colony_design(
    project_id: String,
    action: String,
    feedback: Option<String>,
) -> Result<ColonyDesignReview, String> {
    let (root, project_dir, manifest_path) = project_paths(&project_id)?;
    let raw = read_bounded(&manifest_path, 1024 * 1024)?;
    let mut manifest: Value =
        serde_json::from_slice(&raw).map_err(|_| "Design metadata is invalid.")?;
    if manifest.get("id").and_then(Value::as_str) != Some(project_id.as_str()) {
        return Err("Design metadata does not match this project.".into());
    }
    if manifest.get("status").and_then(Value::as_str) != Some("ready_for_review") {
        return Err("This design is not ready for owner review.".into());
    }
    match action.as_str() {
        "approve" => {
            manifest["review"] = json!("approved");
            manifest["feedback"] = Value::Null;
        }
        "changes" => {
            let note = feedback.unwrap_or_default().trim().to_owned();
            if note.is_empty() || note.len() > 4096 {
                return Err("Ask for changes needs a note under 4 KB.".into());
            }
            manifest["review"] = json!("changes_requested");
            manifest["feedback"] = json!(note);
        }
        _ => return Err("Review action must be approve or changes.".into()),
    }
    manifest["reviewedAt"] = json!(unix_time_seconds());
    write_private_atomic(
        &manifest_path,
        &serde_json::to_vec_pretty(&manifest).map_err(|error| error.to_string())?,
    )?;
    get_colony_design_review(project_id)
}

fn project_paths(project_id: &str) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let id = safe_uuid(project_id)?;
    let root = design_root()?;
    let projects = root.join("projects");
    let canonical_data = fs::canonicalize(&root).map_err(|_| "Design data was not found.")?;
    let canonical_root =
        fs::canonicalize(&projects).map_err(|_| "Design project was not found.")?;
    if !canonical_root.starts_with(&canonical_data) {
        return Err("Design projects path is outside Colony data.".into());
    }
    let project =
        fs::canonicalize(canonical_root.join(&id)).map_err(|_| "Design project was not found.")?;
    if project.parent() != Some(canonical_root.as_path()) {
        return Err("Design project path is outside Colony data.".into());
    }
    let manifest = safe_path(&project, &project.join("colony-design.json"))?;
    Ok((canonical_root, project, manifest))
}

fn safe_uuid(value: &str) -> Result<String, String> {
    let id = Uuid::parse_str(value).map_err(|_| "Design project id is invalid.")?;
    if id.to_string() != value.to_lowercase() {
        return Err("Design project id is invalid.".into());
    }
    Ok(id.to_string())
}

fn design_root() -> Result<PathBuf, String> {
    let data = dirs::data_dir().ok_or("Colony data directory is unavailable.")?;
    Ok(data.join("Colony").join("design"))
}

fn ensure_private_dir(directory: &Path) -> Result<(), String> {
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(directory, fs::Permissions::from_mode(0o700))
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn safe_path(root: &Path, file: &Path) -> Result<PathBuf, String> {
    let canonical = fs::canonicalize(file).map_err(|_| "Design file was not found.")?;
    if !canonical.starts_with(root) || !canonical.is_file() {
        return Err("Design file path is outside the project.".into());
    }
    Ok(canonical)
}

fn safe_project_file(
    root: &Path,
    project: &Path,
    file: &Path,
    max_bytes: u64,
) -> Result<Vec<u8>, String> {
    let canonical = safe_path(project, file)?;
    if !canonical.starts_with(root) {
        return Err("Design file path is outside Colony data.".into());
    }
    read_bounded(&canonical, max_bytes)
}

fn read_bounded(path: &Path, max_bytes: u64) -> Result<Vec<u8>, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() > max_bytes {
        return Err("Design file exceeds its size limit.".into());
    }
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(max_bytes + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > max_bytes {
        return Err("Design file exceeds its size limit.".into());
    }
    Ok(bytes)
}

fn bounded_string(value: &Value, key: &str, max: usize) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|text| text.len() <= max)
        .map(str::to_owned)
}

fn read_thumbnails(
    root: &Path,
    project: &Path,
    manifest: &Value,
) -> Result<Vec<ColonyDesignThumbnail>, String> {
    let Some(output_paths) = manifest.get("outputPaths").and_then(Value::as_array) else {
        return Ok(Vec::new());
    };
    let paths = ["desktop-1440.png", "mobile-390.png"]
        .into_iter()
        .filter_map(|name| {
            output_paths.iter().filter_map(Value::as_str).find(|path| {
                Path::new(path)
                    .file_name()
                    .and_then(|file| file.to_str())
                    .is_some_and(|file| file.eq_ignore_ascii_case(name))
            })
        })
        .collect::<Vec<_>>();
    let mut thumbnails = Vec::new();
    for path in paths {
        let extension = Path::new(path)
            .extension()
            .and_then(|extension| extension.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let mime = match extension.as_str() {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "webp" => "image/webp",
            _ => continue,
        };
        let file = safe_project_file(root, project, Path::new(path), THUMBNAIL_MAX_BYTES)?;
        let name = Path::new(path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("design-preview")
            .chars()
            .take(120)
            .collect::<String>();
        thumbnails.push(ColonyDesignThumbnail {
            name,
            data_url: format!(
                "data:{mime};base64,{}",
                base64::engine::general_purpose::STANDARD.encode(file)
            ),
        });
        if thumbnails.len() >= MAX_THUMBNAILS {
            break;
        }
    }
    Ok(thumbnails)
}

fn sanitize_preview(html: &str) -> String {
    let mut safe = html
        .replace("<script", "&lt;script")
        .replace("</script", "&lt;/script")
        .replace("<iframe", "&lt;iframe")
        .replace("</iframe", "&lt;/iframe")
        .replace("<object", "&lt;object")
        .replace("</object", "&lt;/object")
        .replace("<embed", "&lt;embed")
        .replace("<form", "&lt;form")
        .replace("</form", "&lt;/form");
    if !safe
        .to_ascii_lowercase()
        .contains("<meta http-equiv=\"content-security-policy\"")
    {
        safe = format!(
            "<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline' https: http:; font-src data: https: http:\"><base target=\"_blank\">{safe}"
        );
    }
    safe
}

fn write_private_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temp = path.with_extension(format!("{}.tmp", Uuid::new_v4()));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let result = (|| {
        let mut file = options.open(&temp).map_err(|error| error.to_string())?;
        file.write_all(bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        fs::rename(&temp, path).map_err(|error| error.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temp);
    }
    result
}

fn valid_relay_url(value: &str) -> bool {
    let Ok(url) = url::Url::parse(value) else {
        return false;
    };
    matches!(url.scheme(), "https" | "http" | "wss" | "ws")
        && url.host_str().is_some_and(|host| !host.is_empty())
        && url.username().is_empty()
        && url.password().is_none()
        && matches!(url.path(), "" | "/")
        && url.query().is_none()
        && url.fragment().is_none()
}

fn unix_time_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
