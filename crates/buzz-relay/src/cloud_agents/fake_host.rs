//! A host for tests: records every call, keeps machines in memory and fails on
//! command. Compiled for tests and for the `test-fakes` feature only.

use std::collections::{BTreeMap, VecDeque};
use std::sync::Mutex;

use super::host::{BootEnvelope, CloudHost, HostError, MachineRef, MachineSpec, MachineState};

/// One call the fake host received.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FakeCall {
    /// `ensure` for this agent.
    Ensure(String),
    /// `start` of this machine, with this boot token.
    Start(String, String),
    /// `stop` of this machine.
    Stop(String),
    /// `destroy` of this machine.
    Destroy(String),
}

#[derive(Default)]
struct Inner {
    calls: Vec<FakeCall>,
    machines: BTreeMap<String, (MachineRef, MachineState)>,
    failures: VecDeque<HostError>,
    next_id: u64,
}

/// In-memory [`CloudHost`].
#[derive(Default)]
pub struct FakeHost {
    inner: Mutex<Inner>,
}

impl FakeHost {
    /// An empty host.
    pub fn new() -> Self {
        Self::default()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Makes the next calls fail, in order, before any call succeeds again.
    pub fn fail_next(&self, errors: impl IntoIterator<Item = HostError>) {
        self.lock().failures.extend(errors);
    }

    /// Every call so far, oldest first.
    pub fn calls(&self) -> Vec<FakeCall> {
        self.lock().calls.clone()
    }

    /// Adds a machine the relay never asked for (an orphan).
    pub fn add_machine(&self, state: MachineState) -> MachineRef {
        let mut inner = self.lock();
        inner.next_id += 1;
        let machine = MachineRef {
            machine_id: format!("m{}", inner.next_id),
            volume_id: format!("v{}", inner.next_id),
        };
        inner
            .machines
            .insert(machine.machine_id.clone(), (machine.clone(), state));
        machine
    }

    /// The state the fake holds for a machine, `Destroyed` when it is gone.
    pub fn machine_state(&self, machine_id: &str) -> MachineState {
        self.lock()
            .machines
            .get(machine_id)
            .map_or(MachineState::Destroyed, |(_, state)| *state)
    }

    fn take_failure(inner: &mut Inner) -> Result<(), HostError> {
        match inner.failures.pop_front() {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }
}

#[async_trait::async_trait]
impl CloudHost for FakeHost {
    async fn ensure(&self, spec: &MachineSpec) -> Result<MachineRef, HostError> {
        let mut inner = self.lock();
        inner
            .calls
            .push(FakeCall::Ensure(spec.agent_pubkey.clone()));
        Self::take_failure(&mut inner)?;
        inner.next_id += 1;
        let machine = MachineRef {
            machine_id: format!("m{}", inner.next_id),
            volume_id: format!("v{}", inner.next_id),
        };
        inner.machines.insert(
            machine.machine_id.clone(),
            (machine.clone(), MachineState::Stopped),
        );
        Ok(machine)
    }

    async fn start(&self, machine: &MachineRef, boot: &BootEnvelope) -> Result<(), HostError> {
        let mut inner = self.lock();
        inner.calls.push(FakeCall::Start(
            machine.machine_id.clone(),
            boot.boot_token.to_string(),
        ));
        Self::take_failure(&mut inner)?;
        match inner.machines.get_mut(&machine.machine_id) {
            Some(entry) => {
                entry.1 = MachineState::Started;
                Ok(())
            }
            None => Err(HostError::Permanent("no such machine".into())),
        }
    }

    async fn stop(&self, machine: &MachineRef) -> Result<(), HostError> {
        let mut inner = self.lock();
        inner.calls.push(FakeCall::Stop(machine.machine_id.clone()));
        Self::take_failure(&mut inner)?;
        if let Some(entry) = inner.machines.get_mut(&machine.machine_id) {
            entry.1 = MachineState::Stopped;
        }
        Ok(())
    }

    async fn destroy(&self, machine: &MachineRef) -> Result<(), HostError> {
        let mut inner = self.lock();
        inner
            .calls
            .push(FakeCall::Destroy(machine.machine_id.clone()));
        Self::take_failure(&mut inner)?;
        inner.machines.remove(&machine.machine_id);
        Ok(())
    }

    async fn state(&self, machine: &MachineRef) -> Result<MachineState, HostError> {
        let mut inner = self.lock();
        Self::take_failure(&mut inner)?;
        Ok(inner
            .machines
            .get(&machine.machine_id)
            .map_or(MachineState::Destroyed, |(_, state)| *state))
    }

    async fn list(&self) -> Result<Vec<MachineRef>, HostError> {
        let mut inner = self.lock();
        Self::take_failure(&mut inner)?;
        Ok(inner.machines.values().map(|(m, _)| m.clone()).collect())
    }
}
