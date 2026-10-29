//! Server custody for the WhatsApp access token and app secret.
//!
//! Each secret is sealed with AES-256-GCM under the relay KEK (the same deployment key that
//! seals account custody), with a fresh nonce, and bound to its company, connection and
//! field through the AAD so a sealed value cannot be moved to another row. The plaintext
//! lives in [`Zeroizing`] memory and is never formatted.

use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use sha2::{Digest, Sha256};
use thiserror::Error;
use uuid::Uuid;
use zeroize::Zeroizing;

const AAD_PREFIX: &str = "colony-whatsapp-v1";

/// Errors that never contain key or secret material.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum SecretError {
    /// The stored key id does not match the deployment key.
    #[error("whatsapp secret key unavailable")]
    KeyUnavailable,
    /// Sealing failed or the envelope is malformed or was tampered with.
    #[error("whatsapp secret envelope invalid")]
    Invalid,
}

/// Which secret is being sealed. Part of the AAD.
#[derive(Clone, Copy, Debug)]
pub enum SecretField {
    /// Permanent system-user access token.
    AccessToken,
    /// Meta app secret used for the webhook signature.
    AppSecret,
}

impl SecretField {
    fn label(self) -> &'static str {
        match self {
            Self::AccessToken => "token",
            Self::AppSecret => "app_secret",
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

/// Non-secret identifier of the KEK, same formula as account custody.
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
) -> Result<Sealed, SecretError> {
    let cipher = Aes256Gcm::new_from_slice(kek).map_err(|_| SecretError::KeyUnavailable)?;
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
        .map_err(|_| SecretError::Invalid)?;
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
) -> Result<Zeroizing<String>, SecretError> {
    if stored_kek_id != kek_id(kek) {
        return Err(SecretError::KeyUnavailable);
    }
    if nonce.len() != 12 || ciphertext.len() < 16 {
        return Err(SecretError::Invalid);
    }
    let cipher = Aes256Gcm::new_from_slice(kek).map_err(|_| SecretError::KeyUnavailable)?;
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
            .map_err(|_| SecretError::Invalid)?,
    );
    String::from_utf8(plaintext.to_vec())
        .map(Zeroizing::new)
        .map_err(|_| SecretError::Invalid)
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEK: [u8; 32] = [0x11; 32];

    #[test]
    fn sealed_secret_round_trips_and_is_not_plaintext() {
        let community = Uuid::new_v4();
        let connection = Uuid::new_v4();
        let sealed = seal(
            &KEK,
            community,
            connection,
            SecretField::AccessToken,
            "EAAB-test-token",
        )
        .expect("seal");
        assert!(!sealed
            .ciphertext
            .windows(b"EAAB-test-token".len())
            .any(|w| w == b"EAAB-test-token"));
        let opened = open(
            &KEK,
            &kek_id(&KEK),
            community,
            connection,
            SecretField::AccessToken,
            &sealed.ciphertext,
            &sealed.nonce,
        )
        .expect("open");
        assert_eq!(opened.as_str(), "EAAB-test-token");
    }

    #[test]
    fn a_sealed_secret_cannot_be_moved_or_reread_with_the_wrong_key() {
        let community = Uuid::new_v4();
        let connection = Uuid::new_v4();
        let sealed =
            seal(&KEK, community, connection, SecretField::AppSecret, "shh").expect("seal");
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
        assert!(try_open(&KEK, community, connection, SecretField::AppSecret).is_ok());
        assert!(try_open(&KEK, Uuid::new_v4(), connection, SecretField::AppSecret).is_err());
        assert!(try_open(&KEK, community, Uuid::new_v4(), SecretField::AppSecret).is_err());
        assert!(try_open(&KEK, community, connection, SecretField::AccessToken).is_err());
        assert!(try_open(&[0x22; 32], community, connection, SecretField::AppSecret).is_err());
        let mut tampered = sealed.ciphertext.clone();
        tampered[0] ^= 1;
        assert!(open(
            &KEK,
            &kek_id(&KEK),
            community,
            connection,
            SecretField::AppSecret,
            &tampered,
            &sealed.nonce
        )
        .is_err());
    }

    #[test]
    fn every_seal_uses_a_fresh_nonce() {
        let community = Uuid::new_v4();
        let connection = Uuid::new_v4();
        let a = seal(&KEK, community, connection, SecretField::AppSecret, "same").expect("seal");
        let b = seal(&KEK, community, connection, SecretField::AppSecret, "same").expect("seal");
        assert_ne!(a.nonce, b.nonce);
        assert_ne!(a.ciphertext, b.ciphertext);
    }
}
