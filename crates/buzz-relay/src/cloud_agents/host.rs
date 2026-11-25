//! The host layer: how the relay creates, starts, stops and destroys the one
//! machine each cloud agent runs on.
//!
//! v1 has one implementation, Fly Machines ([`super::fly::FlyHost`]). The seam
//! exists so Cloudflare or another host can be added later without touching
//! placement, the doorbell or the journal, and so tests can drive them with a
//! fake host that records calls and fails on command.
//!
//! The one rule of the seam: the only environment a machine's own config ever
//! holds is the boot URL and a single-use boot token ([`BootEnvelope`]).
//! Everything secret is fetched by the harness at boot.

use std::fmt;

use zeroize::Zeroizing;

/// What the host needs to create an agent's machine and volume.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MachineSpec {
    /// Agent pubkey, 64 lowercase hex characters. Names and tags the machine.
    pub agent_pubkey: String,
    /// Machine image, pinned by digest.
    pub image: String,
    /// Machine memory in MB.
    pub memory_mb: u32,
    /// Volume size in GB.
    pub volume_gb: u32,
    /// Region code for the machine and its volume.
    pub region: String,
}

/// A machine and its volume, as the host names them.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MachineRef {
    /// The host's machine id.
    pub machine_id: String,
    /// The host's volume id.
    pub volume_id: String,
}

/// The only environment handed to a machine's config.
#[derive(Clone)]
pub struct BootEnvelope {
    /// Where the harness trades its token for its environment.
    pub boot_url: String,
    /// Single-use token, valid for a few minutes.
    pub boot_token: Zeroizing<String>,
}

impl fmt::Debug for BootEnvelope {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("BootEnvelope")
            .field("boot_url", &self.boot_url)
            .field("boot_token", &"[REDACTED]")
            .finish()
    }
}

/// What the host says a machine is doing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MachineState {
    /// Running.
    Started,
    /// Stopped; the volume is kept.
    Stopped,
    /// Suspended (snapshot); treated like stopped.
    Suspended,
    /// Gone.
    Destroyed,
    /// Starting, stopping, replacing or any state the relay does not model.
    Unknown,
}

/// Why a host call failed. The split decides whether the journal retries.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum HostError {
    /// Worth retrying with backoff: network error, timeout, rate limit, 5xx.
    #[error("transient host error: {0}")]
    Transient(String),
    /// Retrying the same call will not help: bad request, auth, quota.
    #[error("permanent host error: {0}")]
    Permanent(String),
}

/// One agent machine at a time, on some host.
#[async_trait::async_trait]
pub trait CloudHost: Send + Sync {
    /// Creates the machine (stopped) and its volume.
    async fn ensure(&self, spec: &MachineSpec) -> Result<MachineRef, HostError>;
    /// Gives the machine its boot env and starts it.
    async fn start(&self, machine: &MachineRef, boot: &BootEnvelope) -> Result<(), HostError>;
    /// Stops the machine, keeping its volume.
    async fn stop(&self, machine: &MachineRef) -> Result<(), HostError>;
    /// Destroys the machine and its volume. Already gone is success.
    async fn destroy(&self, machine: &MachineRef) -> Result<(), HostError>;
    /// The machine's current state.
    async fn state(&self, machine: &MachineRef) -> Result<MachineState, HostError>;
    /// Every machine the host holds for the relay's app.
    async fn list(&self) -> Result<Vec<MachineRef>, HostError>;
}
