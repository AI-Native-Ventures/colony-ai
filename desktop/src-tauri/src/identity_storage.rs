use crate::app_state::AppState;
pub(crate) use colony_identity_kernel::{IdentityStorage, RecoveryState, ResolvedIdentity};

impl AppState {
    pub(crate) fn identity_storage(&self) -> IdentityStorage {
        match self
            .identity_storage
            .load(std::sync::atomic::Ordering::Acquire)
        {
            1 => IdentityStorage::SystemKeyring,
            2 => IdentityStorage::LocalFile,
            3 => IdentityStorage::Environment,
            _ => IdentityStorage::Ephemeral,
        }
    }

    pub(crate) fn set_identity_storage(&self, storage: IdentityStorage) {
        self.identity_storage
            .store(storage as u8, std::sync::atomic::Ordering::Release);
    }
}
