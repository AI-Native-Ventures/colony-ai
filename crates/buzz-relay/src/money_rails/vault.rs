//! Server custody for provider API keys and notice signing secrets.
//!
//! The same envelope as `whatsapp::secrets`: AES-256-GCM under the relay KEK (the deployment
//! key that seals account custody), a fresh nonce per seal, and an AAD of community, connection
//! and field so a sealed value cannot be moved to another row. The plaintext lives in
//! [`Zeroizing`] memory and is never formatted into a log, a response or an event.

use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use sha2::{Digest, Sha256};
use thiserror::Error;
use uuid::Uuid;
use zeroize::Zeroizing;

const AAD_PREFIX: &str = "colony-money-v1";

/// Errors that never contain key or secret material.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum VaultError {
    /// The stored key id does not match the deployment key.
    #[error("money rails secret key unavailable")]
    KeyUnavailable,
    /// Sealing failed or the envelope is malformed or was tampered with.
    #[error("money rails secret envelope invalid")]
    Invalid,
}

/// Which secret is being sealed. Part of the AAD.
#[derive(Clone, Copy, Debug)]
pub enum SecretField {
    /// The provider API key.
    ApiKey,
    /// The secret used to check notice signatures.
    SigningSecret,
}

impl SecretField {
    fn label(self) -> &'static str {
        match self {
            Self::ApiKey => "api_key",
            Self::SigningSecret => "signing_secret",
        }
    }
}

/// A sealed value ready for the database.
pub struct Sealed {
    /// AES-GCM ciphertext with tag.
    pub ciphertext: Vec<u8>,
    /// Random nonce.
    pub nonce: [u8; 12],
}

/// Non secret identifier of the KEK, the same formula as account custody.
pub fn kek_id(kek: &[u8; 32]) -> String {
    let digest = Sha256::digest(kek);
    format!("kek-{}", hex::encode(&digest[..8]))
}

fn aad(community: Uuid, connection_id: Uuid, field: SecretField) -> Vec<u8> {
    format!("{AAD_PREFIX}:{community}:{connection_id}:{}", field.label()).into_bytes()
}

/// Seal one secret for one company and connection.
pub fn seal(
    kek: &[u8; 32],
    community: Uuid,
    connection_id: Uuid,
    field: SecretField,
    plaintext: &str,
) -> Result<Sealed, VaultError> {
    let cipher = Aes256Gcm::new_from_slice(kek).map_err(|_| VaultError::KeyUnavailable)?;
    let nonce = rand::random::<[u8; 12]>();
    let aad = aad(community, connection_id, field);
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: plaintext.as_bytes(),
                aad: &aad,
            },
        )
        .map_err(|_| VaultError::Invalid)?;
    Ok(Sealed { ciphertext, nonce })
}

/// Open one secret. Fails for another KEK, another row, another field or tampered bytes.
pub fn open(
    kek: &[u8; 32],
    stored_kek_id: &str,
    community: Uuid,
    connection_id: Uuid,
    field: SecretField,
    ciphertext: &[u8],
    nonce: &[u8],
) -> Result<Zeroizing<String>, VaultError> {
    if stored_kek_id != kek_id(kek) {
        return Err(VaultError::KeyUnavailable);
    }
    if nonce.len() != 12 || ciphertext.len() < 16 {
        return Err(VaultError::Invalid);
    }
    let cipher = Aes256Gcm::new_from_slice(kek).map_err(|_| VaultError::KeyUnavailable)?;
    let aad = aad(community, connection_id, field);
    let plaintext = Zeroizing::new(
        cipher
            .decrypt(
                Nonce::from_slice(nonce),
                Payload {
                    msg: ciphertext,
                    aad: &aad,
                },
            )
            .map_err(|_| VaultError::Invalid)?,
    );
    String::from_utf8(plaintext.to_vec())
        .map(Zeroizing::new)
        .map_err(|_| VaultError::Invalid)
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEK: [u8; 32] = [0x33; 32];

    #[test]
    fn a_sealed_key_round_trips_and_is_not_plaintext() {
        let community = Uuid::new_v4();
        let connection = Uuid::new_v4();
        let sealed = seal(
            &KEK,
            community,
            connection,
            SecretField::ApiKey,
            "sk_test_not_real_key",
        )
        .expect("seal");
        assert!(!sealed
            .ciphertext
            .windows(b"sk_test_not_real_key".len())
            .any(|window| window == b"sk_test_not_real_key"));
        let opened = open(
            &KEK,
            &kek_id(&KEK),
            community,
            connection,
            SecretField::ApiKey,
            &sealed.ciphertext,
            &sealed.nonce,
        )
        .expect("open");
        assert_eq!(opened.as_str(), "sk_test_not_real_key");
    }

    #[test]
    fn a_sealed_secret_cannot_be_moved_to_another_row_field_or_key() {
        let community = Uuid::new_v4();
        let connection = Uuid::new_v4();
        let sealed = seal(
            &KEK,
            community,
            connection,
            SecretField::SigningSecret,
            "shh",
        )
        .expect("seal");
        let try_open = |kek: &[u8; 32], community, connection, field| {
            open(
                kek,
                &kek_id(kek),
                community,
                connection,
                field,
                &sealed.ciphertext,
                &sealed.nonce,
            )
        };
        assert!(try_open(&KEK, community, connection, SecretField::SigningSecret).is_ok());
        assert!(try_open(&KEK, Uuid::new_v4(), connection, SecretField::SigningSecret).is_err());
        assert!(try_open(&KEK, community, Uuid::new_v4(), SecretField::SigningSecret).is_err());
        assert!(try_open(&KEK, community, connection, SecretField::ApiKey).is_err());
        assert!(try_open(
            &[0x44; 32],
            community,
            connection,
            SecretField::SigningSecret
        )
        .is_err());
    }

    #[test]
    fn every_seal_uses_a_fresh_nonce() {
        let community = Uuid::new_v4();
        let connection = Uuid::new_v4();
        let a = seal(&KEK, community, connection, SecretField::ApiKey, "same").expect("seal");
        let b = seal(&KEK, community, connection, SecretField::ApiKey, "same").expect("seal");
        assert_ne!(a.nonce, b.nonce);
        assert_ne!(a.ciphertext, b.ciphertext);
    }
}
