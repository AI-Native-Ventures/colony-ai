//! Explicit B2a identity activation over the already-merged B1 store seam.
//!
//! This module is only linked by an opt-in identity feature and is never
//! reached by the default health-only launch.  The descriptor is checked
//! against a synthetic fixture manifest here; B2b will replace that trusted
//! carrier with Electron main's packaged manifest without changing the B1
//! resolver or its custody semantics.

use std::path::Path;

use colony_identity_kernel::{project_identity, IdentitySnapshot, RecoveryState};
use colony_identity_store::{
    HeadlessIdentityStore, IdentityLaunchDescriptor, IdentityMode, ResetProvenance,
    TrustedProfileManifest,
};

use crate::v2::IdentityLaunch;

pub const FIXTURE_PROFILE_ID: &str = "colony-b2a-test-profile";
pub const FIXTURE_FLAVOR: &str = "test";
const FIXTURE_SERVICE_PREFIX: &str = "xyz.ainative.ventures.colony.b2a";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum IdentityInitError {
    DescriptorRejected,
    InitializationFailed,
}

pub struct IdentityRuntime {
    snapshot: IdentitySnapshot,
}

impl IdentityRuntime {
    pub fn initialize(launch: &IdentityLaunch) -> Result<Self, IdentityInitError> {
        validate_launch(launch)?;
        let platform = host_platform();
        let service =
            format!("{FIXTURE_SERVICE_PREFIX}.{FIXTURE_PROFILE_ID}.{FIXTURE_FLAVOR}.{platform}");
        let manifest =
            TrustedProfileManifest::new(FIXTURE_PROFILE_ID, FIXTURE_FLAVOR, platform, service);
        let descriptor = IdentityLaunchDescriptor::from_trusted_manifest(
            &manifest,
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
    {
        return Err(IdentityInitError::DescriptorRejected);
    }
    let root = Path::new(&launch.user_data_root);
    if !root.is_absolute() || launch.user_data_root.len() > 4096 {
        return Err(IdentityInitError::DescriptorRejected);
    }
    Ok(())
}

fn host_platform() -> &'static str {
    match std::env::consts::OS {
        "macos" => "macos",
        "windows" => "windows",
        "linux" => "linux",
        _ => "unsupported",
    }
}
