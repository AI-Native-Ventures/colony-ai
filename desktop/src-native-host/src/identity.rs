//! Explicit identity activation over the already-merged B1 store seam.
//!
//! This module is only linked by an opt-in identity feature and is never
//! reached by the default health-only launch. The test carrier remains a
//! synthetic fixture; production mode binds the same store to the embedded
//! flavor manifest without changing the B1 resolver or its custody semantics.

use std::{
    env,
    path::{Component, Path, PathBuf},
};

use colony_identity_kernel::{project_identity, IdentitySnapshot, RecoveryState};
use colony_identity_store::{
    HeadlessIdentityStore, IdentityLaunchDescriptor, IdentityMode, ResetProvenance,
    TrustedProfileManifest,
};

use crate::protocol::{identity_manifest_digest, IdentityProfiles};
use crate::v2::IdentityLaunch;

pub const FIXTURE_PROFILE_ID: &str = "colony-b2a-test-profile";
pub const FIXTURE_FLAVOR: &str = "test";
const FIXTURE_SERVICE_PREFIX: &str = "xyz.ainative.ventures.colony.b2a";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityInitError {
    DescriptorRejected,
    ManifestMismatch,
    Unavailable,
    NamespaceUnverified,
    InitializationFailed,
}

pub struct IdentityRuntime {
    snapshot: IdentitySnapshot,
}

impl IdentityRuntime {
    /// Keep the B2a fixture carrier available for its isolated contract lane.
    pub fn initialize(launch: &IdentityLaunch) -> Result<Self, IdentityInitError> {
        Self::initialize_test(launch)
    }

    pub fn initialize_test(launch: &IdentityLaunch) -> Result<Self, IdentityInitError> {
        validate_launch(launch)?;
        let platform = host_platform();
        let service =
            format!("{FIXTURE_SERVICE_PREFIX}.{FIXTURE_PROFILE_ID}.{FIXTURE_FLAVOR}.{platform}");
        let manifest =
            TrustedProfileManifest::new(FIXTURE_PROFILE_ID, FIXTURE_FLAVOR, platform, service);
        Self::initialize_from_manifest(&manifest, Path::new(&launch.user_data_root))
    }

    /// Keep temporary roots confined to the explicitly fenced file-only
    /// derivative carrier. This path is never a production custody mode.
    pub fn initialize_derivative(
        launch: &IdentityLaunch,
        profiles: &IdentityProfiles,
        expected_manifest_digest: &str,
    ) -> Result<Self, IdentityInitError> {
        validate_manifest_binding(launch, profiles, expected_manifest_digest)?;
        let profile = profiles
            .for_flavor(&launch.flavor)
            .ok_or(IdentityInitError::DescriptorRejected)?;
        let manifest = TrustedProfileManifest::new(
            profile.profile_id.clone(),
            launch.flavor.clone(),
            host_platform(),
            profile.keychain_service.clone(),
        );
        Self::initialize_from_manifest(&manifest, Path::new(&launch.user_data_root))
    }

    pub fn initialize_production(
        launch: &IdentityLaunch,
        profiles: &IdentityProfiles,
        expected_manifest_digest: &str,
        build_id: &str,
    ) -> Result<Self, IdentityInitError> {
        validate_manifest_binding(launch, profiles, expected_manifest_digest)?;
        if host_platform() != "macos" {
            return Err(IdentityInitError::Unavailable);
        }
        let profile = profiles
            .for_flavor(&launch.flavor)
            .ok_or(IdentityInitError::DescriptorRejected)?;
        let trusted_root = trusted_production_root(&profile.user_data_relative_path)?;
        if Path::new(&launch.user_data_root) != trusted_root {
            return Err(IdentityInitError::DescriptorRejected);
        }
        let ownership = crate::identity_ownership::preflight(
            &platform_app_data_anchor()?,
            &profile.user_data_relative_path,
            &profile.profile_id,
            &launch.flavor,
            host_platform(),
            &profile.keychain_service,
            expected_manifest_digest,
            build_id,
        )
        .map_err(map_ownership_error)?;
        let manifest = TrustedProfileManifest::new(
            profile.profile_id.clone(),
            launch.flavor.clone(),
            host_platform(),
            profile.keychain_service.clone(),
        );
        let runtime = Self::initialize_from_manifest(&manifest, &trusted_root)?;
        ownership
            .commit_initialized(&runtime.snapshot.storage)
            .map_err(|_| IdentityInitError::InitializationFailed)?;
        Ok(runtime)
    }

    fn initialize_from_manifest(
        manifest: &TrustedProfileManifest,
        user_data_root: &Path,
    ) -> Result<Self, IdentityInitError> {
        let descriptor = IdentityLaunchDescriptor::from_trusted_manifest(
            manifest,
            user_data_root,
            IdentityMode::ExplicitIdentity,
            false,
            ResetProvenance::NotAttemptedFresh,
        )
        .map_err(|_| IdentityInitError::DescriptorRejected)?;
        let store = HeadlessIdentityStore::from_descriptor(descriptor)
            .map_err(|_| IdentityInitError::DescriptorRejected)?;
        let resolved = store
            .initialize()
            .map_err(|_| IdentityInitError::InitializationFailed)?;
        let (lost, locked) = match resolved.recovery {
            RecoveryState::None => (false, false),
            RecoveryState::Lost => (true, false),
            RecoveryState::KeyringLocked => (false, true),
        };
        let snapshot = project_identity(&resolved.keys, resolved.storage, lost, locked, false)
            .map_err(|_| IdentityInitError::InitializationFailed)?;
        Ok(Self { snapshot })
    }

    pub fn is_shared_identity(&self) -> bool {
        false
    }

    pub fn snapshot(&self) -> &IdentitySnapshot {
        &self.snapshot
    }
}

fn validate_manifest_binding(
    launch: &IdentityLaunch,
    profiles: &IdentityProfiles,
    expected_manifest_digest: &str,
) -> Result<(), IdentityInitError> {
    if launch.identity_manifest_digest.as_deref() != Some(expected_manifest_digest) {
        return Err(IdentityInitError::ManifestMismatch);
    }
    if identity_manifest_digest(profiles).map_err(|_| IdentityInitError::ManifestMismatch)?
        != expected_manifest_digest
    {
        return Err(IdentityInitError::ManifestMismatch);
    }
    validate_production_launch(launch, profiles)
}

fn validate_launch(launch: &IdentityLaunch) -> Result<(), IdentityInitError> {
    if launch.profile_id != FIXTURE_PROFILE_ID
        || launch.flavor != FIXTURE_FLAVOR
        || launch.platform != host_platform()
        || launch.identity_mode != "explicit"
        || launch.shared_identity
        || launch.reset_provenance != "not_attempted_fresh"
        || launch.identity_manifest_digest.is_some()
    {
        return Err(IdentityInitError::DescriptorRejected);
    }
    let root = Path::new(&launch.user_data_root);
    if !root.is_absolute() || launch.user_data_root.len() > 4096 {
        return Err(IdentityInitError::DescriptorRejected);
    }
    Ok(())
}

fn validate_production_launch(
    launch: &IdentityLaunch,
    profiles: &IdentityProfiles,
) -> Result<(), IdentityInitError> {
    if launch.identity_mode != "explicit"
        || launch.shared_identity
        || launch.reset_provenance != "not_attempted_fresh"
        || launch.platform != host_platform()
    {
        return Err(IdentityInitError::DescriptorRejected);
    }
    let profile = profiles
        .for_flavor(&launch.flavor)
        .ok_or(IdentityInitError::DescriptorRejected)?;
    if profile.profile_id != launch.profile_id
        || !root_matches_relative_path(&launch.user_data_root, &profile.user_data_relative_path)
    {
        return Err(IdentityInitError::DescriptorRejected);
    }
    Ok(())
}

fn root_matches_relative_path(root: &str, relative: &str) -> bool {
    let path = Path::new(root);
    path.is_absolute()
        && root.len() <= 4096
        && !path
            .components()
            .any(|component| component == Component::ParentDir)
        && path.ends_with(Path::new(relative))
}

fn trusted_production_root(relative: &str) -> Result<PathBuf, IdentityInitError> {
    let anchor = platform_app_data_anchor()?;
    Ok(anchor.join(relative))
}

fn map_ownership_error(error: crate::identity_ownership::OwnershipError) -> IdentityInitError {
    if error.is_unavailable() {
        IdentityInitError::Unavailable
    } else {
        IdentityInitError::NamespaceUnverified
    }
}

fn platform_app_data_anchor() -> Result<PathBuf, IdentityInitError> {
    let candidate = match host_platform() {
        "macos" => env::var_os("HOME")
            .map(PathBuf::from)
            .map(|home| home.join("Library").join("Application Support")),
        "windows" => env::var_os("APPDATA").map(PathBuf::from),
        "linux" => env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .filter(|path| path.is_absolute())
            .or_else(|| {
                env::var_os("HOME")
                    .map(PathBuf::from)
                    .map(|home| home.join(".config"))
            }),
        _ => None,
    }
    .filter(|path| path.is_absolute())
    .ok_or(IdentityInitError::NamespaceUnverified)?;
    std::fs::canonicalize(candidate).map_err(|_| IdentityInitError::NamespaceUnverified)
}

fn host_platform() -> &'static str {
    match std::env::consts::OS {
        "macos" => "macos",
        "windows" => "windows",
        "linux" => "linux",
        _ => "unsupported",
    }
}
