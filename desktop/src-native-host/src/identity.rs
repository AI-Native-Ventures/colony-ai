//! Explicit identity activation over the already-merged B1 store seam.
//!
//! This module is only linked by an opt-in identity feature and is never
//! reached by the default health-only launch. The test carrier remains a
//! synthetic fixture; production mode binds the same store to the embedded
//! flavor manifest without changing the B1 resolver or its custody semantics.

use std::path::{Component, Path};

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
        Self::initialize_from_manifest(launch, &manifest)
    }

    pub fn initialize_production(
        launch: &IdentityLaunch,
        profiles: &IdentityProfiles,
        expected_manifest_digest: &str,
    ) -> Result<Self, IdentityInitError> {
        if launch.identity_manifest_digest.as_deref() != Some(expected_manifest_digest) {
            return Err(IdentityInitError::ManifestMismatch);
        }
        if identity_manifest_digest(profiles).map_err(|_| IdentityInitError::ManifestMismatch)?
            != expected_manifest_digest
        {
            return Err(IdentityInitError::ManifestMismatch);
        }
        validate_production_launch(launch, profiles)?;
        let profile = profiles
            .for_flavor(&launch.flavor)
            .ok_or(IdentityInitError::DescriptorRejected)?;
        if profiles.collision_status(&launch.flavor, host_platform()) != Some("observed-unoccupied")
        {
            return Err(IdentityInitError::NamespaceUnverified);
        }
        let manifest = TrustedProfileManifest::new(
            profile.profile_id.clone(),
            launch.flavor.clone(),
            host_platform(),
            profile.keychain_service.clone(),
        );
        Self::initialize_from_manifest(launch, &manifest)
    }

    fn initialize_from_manifest(
        launch: &IdentityLaunch,
        manifest: &TrustedProfileManifest,
    ) -> Result<Self, IdentityInitError> {
        let descriptor = IdentityLaunchDescriptor::from_trusted_manifest(
            manifest,
            Path::new(&launch.user_data_root),
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

fn host_platform() -> &'static str {
    match std::env::consts::OS {
        "macos" => "macos",
        "windows" => "windows",
        "linux" => "linux",
        _ => "unsupported",
    }
}
