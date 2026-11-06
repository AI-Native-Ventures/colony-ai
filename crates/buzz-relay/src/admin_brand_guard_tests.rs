//! Brand guard for the relay-served operator console.
//!
//! The browser receives these production source files through the bundled
//! admin application. Keep the corpus tied to the actual directory rather
//! than duplicating strings in a test-only fixture.

#[path = "../../../test-support/brand_guard.rs"]
mod brand_guard;

use std::path::{Path, PathBuf};

use brand_guard::{Allow, Surface};

const ALLOW: &[Allow] = &[];

fn admin_web_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../admin-web")
}

fn add_source_files(root: &Path, directory: &Path, surfaces: &mut Vec<Surface>) {
    let mut entries = std::fs::read_dir(directory)
        .unwrap_or_else(|error| panic!("could not read {}: {error}", directory.display()))
        .collect::<Result<Vec<_>, _>>()
        .unwrap_or_else(|error| panic!("could not list {}: {error}", directory.display()));
    entries.sort_by_key(|entry| entry.path());
    for entry in entries {
        let path = entry.path();
        if path.is_dir() {
            add_source_files(root, &path, surfaces);
            continue;
        }
        let extension = path.extension().and_then(|extension| extension.to_str());
        if !matches!(
            extension,
            Some("ts") | Some("tsx") | Some("css") | Some("js") | Some("svg")
        ) {
            continue;
        }
        let text = std::fs::read_to_string(&path)
            .unwrap_or_else(|error| panic!("could not read {}: {error}", path.display()));
        let name = path
            .strip_prefix(root)
            .unwrap_or_else(|error| {
                panic!("{} is outside {}: {error}", path.display(), root.display())
            })
            .display()
            .to_string();
        surfaces.push(Surface::new(name, text));
    }
}

fn surfaces() -> Vec<Surface> {
    let root = admin_web_root();
    let mut surfaces = vec![Surface::new(
        "index.html",
        std::fs::read_to_string(root.join("index.html")).expect("admin index.html"),
    )];
    add_source_files(&root, &root.join("src"), &mut surfaces);
    add_source_files(&root, &root.join("public"), &mut surfaces);
    surfaces
}

fn assert_colony_favicon(svg: &str) {
    assert!(
        !svg.to_ascii_lowercase().contains("bee"),
        "admin favicon must not contain the legacy bee mark"
    );
    assert!(
        svg.contains(r#"data-colony-favicon="three-colour-bars""#),
        "admin favicon must be the Colony three-colour bars mark"
    );
    for colour in ["#7a5af8", "#49b6e8", "#f2aa5c"] {
        assert!(
            svg.contains(colour),
            "admin favicon is missing a Colony mark colour: {colour}"
        );
    }
}

#[test]
fn admin_web_production_surfaces_never_say_buzz() {
    brand_guard::assert_clean(&surfaces(), ALLOW);
}

#[test]
fn admin_web_brand_guard_has_no_stale_exceptions() {
    brand_guard::assert_no_stale_entries(&surfaces(), ALLOW);
    brand_guard::assert_entries_justified(ALLOW);
}

#[test]
fn admin_web_brand_guard_flags_injected_legacy_title_in_real_corpus() {
    let corpus = surfaces();
    brand_guard::assert_guard_is_falsifiable(&corpus, ALLOW);
    let stale_title = [Surface::new("admin title regression", "Buzz admin")];
    assert!(
        std::panic::catch_unwind(|| brand_guard::assert_clean(&stale_title, ALLOW)).is_err(),
        "the guard must fail if the legacy admin title returns"
    );
}

#[test]
fn admin_web_favicon_is_colony_mark_and_rejects_the_legacy_bee() {
    let favicon = include_str!("../../../admin-web/public/favicon.svg");
    assert_colony_favicon(favicon);
    assert!(
        std::panic::catch_unwind(|| assert_colony_favicon("<svg><mask id=\"bee-mask\"/></svg>"))
            .is_err(),
        "the favicon test must fail if a bee mark returns"
    );
}
