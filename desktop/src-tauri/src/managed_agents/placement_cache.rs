//! What the relay last said about where each agent works, kept where the
//! spawn boundary can read it (spec 5.2, anti-goal 1: one live copy at a time).
//!
//! The desktop front end reads the relay-signed placement heads (kind 30682)
//! and pushes them here through `set_placement_cache`. Every local spawn then
//! asks [`placement_refusal`] first, so an agent that works in the cloud is
//! never started on this Mac: not by a send, not by launch restore, not by a
//! community reconcile, not by a team re-apply.
//!
//! The cache is written to disk so the first launch restore after a restart
//! still knows an agent moved to the cloud before the front end has read the
//! relay. Agent pubkeys are unique across communities, so one cache serves
//! every community and a community switch does not need to clear it.
//!
//! An entry is replaced only by one of the same or a higher generation: a slow
//! read can never undo a flip.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use buzz_core_pkg::agent_placement::Home;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use super::types::ManagedAgentRecord;

/// What a start path says when the agent works in the cloud. The front end
/// refuses with the same words (`CLOUD_PLACED_ERROR` in `mentionReconciler.ts`).
pub(crate) const CLOUD_PLACED_ERROR: &str = "agent placed in the cloud";

const CACHE_FILE_NAME: &str = "placement-cache.json";

/// One agent's placement as the front end read it from the relay.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlacementCacheEntry {
    /// Agent pubkey, hex.
    pub agent: String,
    /// Where the agent works.
    pub home: Home,
    /// The head's compare-and-swap generation.
    pub generation: u64,
}

/// The in-memory cache. Keys are lowercase agent pubkeys.
#[derive(Debug, Default)]
pub(crate) struct PlacementCache {
    entries: HashMap<String, (Home, u64)>,
}

impl PlacementCache {
    /// Takes `incoming` entries, keeping the newer generation per agent.
    /// Returns whether anything changed.
    pub(crate) fn apply(&mut self, incoming: &[PlacementCacheEntry]) -> bool {
        let mut changed = false;
        for entry in incoming {
            let key = entry.agent.trim().to_ascii_lowercase();
            if key.is_empty() {
                continue;
            }
            match self.entries.get(&key) {
                Some((_, known)) if *known > entry.generation => continue,
                Some((home, known)) if *home == entry.home && *known == entry.generation => {
                    continue
                }
                _ => {}
            }
            self.entries.insert(key, (entry.home, entry.generation));
            changed = true;
        }
        changed
    }

    /// Whether the agent works in the cloud. Unknown agents work on the Mac.
    pub(crate) fn is_cloud_placed(&self, agent_pubkey: &str) -> bool {
        matches!(
            self.entries.get(&agent_pubkey.trim().to_ascii_lowercase()),
            Some((Home::Cloud, _))
        )
    }

    fn to_entries(&self) -> Vec<PlacementCacheEntry> {
        let mut entries: Vec<PlacementCacheEntry> = self
            .entries
            .iter()
            .map(|(agent, (home, generation))| PlacementCacheEntry {
                agent: agent.clone(),
                home: *home,
                generation: *generation,
            })
            .collect();
        entries.sort_by(|a, b| a.agent.cmp(&b.agent));
        entries
    }

    /// Reads the cache file. A missing or unreadable file is an empty cache:
    /// the front end fills it again from the relay.
    pub(crate) fn load(path: &Path) -> Self {
        let mut cache = Self::default();
        if let Ok(text) = fs::read_to_string(path) {
            if let Ok(entries) = serde_json::from_str::<Vec<PlacementCacheEntry>>(&text) {
                cache.apply(&entries);
            }
        }
        cache
    }

    /// Writes the cache file atomically (temp file, then rename).
    pub(crate) fn save(&self, path: &Path) -> Result<(), String> {
        let json = serde_json::to_string(&self.to_entries())
            .map_err(|error| format!("failed to encode the placement cache: {error}"))?;
        let temp = path.with_extension("json.tmp");
        fs::write(&temp, json)
            .map_err(|error| format!("failed to write the placement cache: {error}"))?;
        fs::rename(&temp, path)
            .map_err(|error| format!("failed to replace the placement cache: {error}"))
    }
}

struct GlobalCache {
    cache: PlacementCache,
    loaded: bool,
}

fn global() -> &'static Mutex<GlobalCache> {
    static CACHE: OnceLock<Mutex<GlobalCache>> = OnceLock::new();
    CACHE.get_or_init(|| {
        Mutex::new(GlobalCache {
            cache: PlacementCache::default(),
            loaded: false,
        })
    })
}

fn cache_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(super::storage::managed_agents_base_dir(app)?.join(CACHE_FILE_NAME))
}

/// Loads the cache file once, merging it under whatever was pushed already.
fn ensure_loaded(app: &AppHandle, guard: &mut GlobalCache) {
    if guard.loaded {
        return;
    }
    guard.loaded = true;
    if let Ok(path) = cache_path(app) {
        let from_disk = PlacementCache::load(&path);
        guard.cache.apply(&from_disk.to_entries());
    }
}

/// Records placements the front end read from the relay and persists them.
pub(crate) fn set_entries(app: &AppHandle, entries: &[PlacementCacheEntry]) -> Result<(), String> {
    let mut guard = global().lock().map_err(|error| error.to_string())?;
    ensure_loaded(app, &mut guard);
    if guard.cache.apply(entries) {
        let path = cache_path(app)?;
        guard.cache.save(&path)?;
    }
    Ok(())
}

/// Why this agent must not be started on this Mac, when it works in the cloud.
/// Checked at every local spawn, before any side effect.
pub(crate) fn placement_refusal(app: &AppHandle, record: &ManagedAgentRecord) -> Option<String> {
    let mut guard = global().lock().ok()?;
    ensure_loaded(app, &mut guard);
    cloud_refusal(&guard.cache, &record.pubkey)
}

/// The pure decision [`placement_refusal`] makes, so the regression tests run
/// the exact predicate production uses without an `AppHandle`.
pub(crate) fn cloud_refusal(cache: &PlacementCache, agent_pubkey: &str) -> Option<String> {
    cache
        .is_cloud_placed(agent_pubkey)
        .then(|| CLOUD_PLACED_ERROR.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCOUT: &str = "aa";

    fn entry(agent: &str, home: Home, generation: u64) -> PlacementCacheEntry {
        PlacementCacheEntry {
            agent: agent.to_string(),
            home,
            generation,
        }
    }

    #[test]
    fn start_refused_for_cloud_placed_agent() {
        let mut cache = PlacementCache::default();
        cache.apply(&[entry(SCOUT, Home::Cloud, 4)]);
        assert_eq!(
            cloud_refusal(&cache, SCOUT).as_deref(),
            Some("agent placed in the cloud")
        );
        // Case and whitespace do not change who the agent is.
        assert!(cloud_refusal(&cache, " AA ").is_some());
    }

    #[test]
    fn unknown_and_mac_placed_agents_start_as_before() {
        let mut cache = PlacementCache::default();
        assert_eq!(cloud_refusal(&cache, SCOUT), None);
        cache.apply(&[entry(SCOUT, Home::Mac, 2)]);
        assert_eq!(cloud_refusal(&cache, SCOUT), None);
    }

    #[test]
    fn a_stale_read_never_undoes_a_flip() {
        let mut cache = PlacementCache::default();
        cache.apply(&[entry(SCOUT, Home::Cloud, 4)]);
        assert!(!cache.apply(&[entry(SCOUT, Home::Mac, 3)]));
        assert!(cache.is_cloud_placed(SCOUT));
    }

    #[test]
    fn a_newer_generation_moves_the_agent_back() {
        let mut cache = PlacementCache::default();
        cache.apply(&[entry(SCOUT, Home::Cloud, 4)]);
        assert!(cache.apply(&[entry(SCOUT, Home::Mac, 5)]));
        assert!(!cache.is_cloud_placed(SCOUT));
    }

    #[test]
    fn an_identical_entry_is_not_a_change() {
        let mut cache = PlacementCache::default();
        assert!(cache.apply(&[entry(SCOUT, Home::Cloud, 1)]));
        assert!(!cache.apply(&[entry(SCOUT, Home::Cloud, 1)]));
    }

    #[test]
    fn the_cache_survives_a_restart() {
        let dir = std::env::temp_dir().join(format!(
            "colony-placement-cache-{}-{}",
            std::process::id(),
            "survives"
        ));
        fs::create_dir_all(&dir).expect("temp dir");
        let path = dir.join(CACHE_FILE_NAME);
        let mut cache = PlacementCache::default();
        cache.apply(&[entry(SCOUT, Home::Cloud, 7)]);
        cache.save(&path).expect("save");

        let reloaded = PlacementCache::load(&path);
        assert!(reloaded.is_cloud_placed(SCOUT));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_missing_or_broken_file_is_an_empty_cache() {
        let dir = std::env::temp_dir().join(format!(
            "colony-placement-cache-{}-{}",
            std::process::id(),
            "broken"
        ));
        fs::create_dir_all(&dir).expect("temp dir");
        let path = dir.join(CACHE_FILE_NAME);
        assert!(!PlacementCache::load(&path).is_cloud_placed(SCOUT));
        fs::write(&path, "not json").expect("write");
        assert!(!PlacementCache::load(&path).is_cloud_placed(SCOUT));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn entries_decode_from_the_front_end_shape() {
        let entries: Vec<PlacementCacheEntry> =
            serde_json::from_str(r#"[{"agent":"aa","home":"cloud","generation":3}]"#)
                .expect("front end json");
        assert_eq!(entries, vec![entry("aa", Home::Cloud, 3)]);
    }
}
