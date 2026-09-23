//! Account custody, code hashing, and password derivation.

use std::sync::{Arc, OnceLock};

use aes_gcm::{
    aead::{Aead, Payload},
    Aes256Gcm, KeyInit, Nonce,
};
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use hmac::{Hmac, Mac};
use nostr::ToBech32;
use sha2::{Digest, Sha256};
use thiserror::Error;
use uuid::Uuid;
use zeroize::{Zeroize, Zeroizing};

type HmacSha256 = Hmac<Sha256>;

const WRAP_AAD_PREFIX: &[u8] = b"colony-account-dek-v1:";
const NSEC_AAD_PREFIX: &[u8] = b"colony-account-nsec-v1:";
const MAIL_AAD_PREFIX: &[u8] = b"colony-account-mail-v1:";
const CODE_HASH_PREFIX: &[u8] = b"colony-account-code-v1\0";
const PASSWORD_MAX_BYTES: usize = 1024;
const KDF_CONCURRENCY: usize = 4;

static KDF_SEMAPHORE: OnceLock<Arc<tokio::sync::Semaphore>> = OnceLock::new();

/// Errors that do not contain key, code, password, or envelope material.
#[derive(Debug, Error)]
pub enum CryptoError {
    /// A configured key did not match the account envelope identifier.
    #[error("account key unavailable")]
    KeyUnavailable,
    /// An envelope was malformed or failed authenticated decryption.
    #[error("account envelope invalid")]
    InvalidEnvelope,
    /// Encrypted content was not valid UTF-8.
    #[error("account envelope encoding invalid")]
    InvalidEncoding,
    /// Password derivation or verification failed internally.
    #[error("password derivation failed")]
    Password,
    /// The bounded password derivation pool could not accept work.
    #[error("password derivation busy")]
    PasswordBusy,
    /// The account signing key could not be encoded or parsed.
    #[error("account signing key invalid")]
    NostrKey,
}

/// AES-GCM account key envelope ready for database insertion.
pub struct AccountEnvelope {
    /// Wrapped random data-encryption key, prefixed by its 12-byte nonce.
    pub wrapped_dek: Vec<u8>,
    /// AES-GCM encrypted nsec.
    pub sealed_nsec: Vec<u8>,
    /// AES-GCM nonce for sealed_nsec.
    pub nonce: [u8; 12],
    /// Non-secret identifier derived from the deployment key.
    pub kek_id: String,
}

/// Generate a Nostr identity and keep the returned secret in zeroizing memory.
pub fn generate_nostr_identity() -> Result<(String, Zeroizing<String>), CryptoError> {
    let keys = nostr::Keys::generate();
    let nsec = keys
        .secret_key()
        .to_bech32()
        .map_err(|_| CryptoError::NostrKey)?;
    Ok((keys.public_key().to_hex(), Zeroizing::new(nsec)))
}

/// Parse an nsec and return only its public key.
pub fn pubkey_from_nsec(nsec: &str) -> Result<String, CryptoError> {
    let keys = nostr::Keys::parse(nsec).map_err(|_| CryptoError::NostrKey)?;
    Ok(keys.public_key().to_hex())
}

/// Seal one account nsec with a random data key wrapped by the deployment key.
pub fn seal_nsec(kek: &[u8; 32], pubkey: &str, nsec: &str) -> Result<AccountEnvelope, CryptoError> {
    let kek_id = kek_id(kek);
    let dek = Zeroizing::new(rand::random::<[u8; 32]>());
    let wrap_nonce = rand::random::<[u8; 12]>();
    let nonce = rand::random::<[u8; 12]>();
    let kek_cipher = Aes256Gcm::new_from_slice(kek).map_err(|_| CryptoError::KeyUnavailable)?;
    let dek_cipher = Aes256Gcm::new_from_slice(&*dek).map_err(|_| CryptoError::InvalidEnvelope)?;
    let wrap_aad = wrap_aad(pubkey, &kek_id);
    let wrapped_dek_ciphertext = kek_cipher
        .encrypt(
            Nonce::from_slice(&wrap_nonce),
            Payload {
                msg: &dek[..],
                aad: &wrap_aad,
            },
        )
        .map_err(|_| CryptoError::InvalidEnvelope)?;
    let mut wrapped_dek = Vec::with_capacity(wrap_nonce.len() + wrapped_dek_ciphertext.len());
    wrapped_dek.extend_from_slice(&wrap_nonce);
    wrapped_dek.extend_from_slice(&wrapped_dek_ciphertext);
    let sealed_nsec = dek_cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: nsec.as_bytes(),
                aad: &nsec_aad(pubkey),
            },
        )
        .map_err(|_| CryptoError::InvalidEnvelope)?;
    Ok(AccountEnvelope {
        wrapped_dek,
        sealed_nsec,
        nonce,
        kek_id,
    })
}

/// Decrypt and validate an account nsec for an authenticated session response.
pub fn open_nsec(
    kek: &[u8; 32],
    pubkey: &str,
    stored_kek_id: &str,
    wrapped_dek: &[u8],
    sealed_nsec: &[u8],
    nonce: &[u8],
) -> Result<Zeroizing<String>, CryptoError> {
    if stored_kek_id != kek_id(kek) || wrapped_dek.len() < 12 + 16 || nonce.len() != 12 {
        return Err(CryptoError::KeyUnavailable);
    }
    let (wrap_nonce, wrapped_ciphertext) = wrapped_dek.split_at(12);
    let kek_cipher = Aes256Gcm::new_from_slice(kek).map_err(|_| CryptoError::KeyUnavailable)?;
    let mut dek = Zeroizing::new(
        kek_cipher
            .decrypt(
                Nonce::from_slice(wrap_nonce),
                Payload {
                    msg: wrapped_ciphertext,
                    aad: &wrap_aad(pubkey, stored_kek_id),
                },
            )
            .map_err(|_| CryptoError::InvalidEnvelope)?,
    );
    if dek.len() != 32 {
        dek.zeroize();
        return Err(CryptoError::InvalidEnvelope);
    }
    let dek_cipher = Aes256Gcm::new_from_slice(&dek).map_err(|_| CryptoError::InvalidEnvelope)?;
    let mut plaintext = Zeroizing::new(
        dek_cipher
            .decrypt(
                Nonce::from_slice(nonce),
                Payload {
                    msg: sealed_nsec,
                    aad: &nsec_aad(pubkey),
                },
            )
            .map_err(|_| CryptoError::InvalidEnvelope)?,
    );
    let cleartext = String::from_utf8(std::mem::take(&mut *plaintext)).map_err(|error| {
        let mut bytes = error.into_bytes();
        bytes.zeroize();
        CryptoError::InvalidEncoding
    })?;
    let mut cleartext = Zeroizing::new(cleartext);
    if pubkey_from_nsec(&cleartext)? != pubkey {
        cleartext.zeroize();
        return Err(CryptoError::InvalidEnvelope);
    }
    Ok(cleartext)
}

/// Hash a six-digit code with a deployment-keyed HMAC to resist database-only guessing.
pub fn hash_code(kek: &[u8; 32], code: &str) -> Result<[u8; 32], CryptoError> {
    let mut mac = <HmacSha256 as hmac::digest::KeyInit>::new_from_slice(kek)
        .map_err(|_| CryptoError::KeyUnavailable)?;
    mac.update(CODE_HASH_PREFIX);
    mac.update(code.as_bytes());
    Ok(mac.finalize().into_bytes().into())
}

/// Encrypt a code for the durable mail outbox.
pub fn seal_mail_code(
    kek: &[u8; 32],
    outbox_id: Uuid,
    code: &str,
) -> Result<(Vec<u8>, [u8; 12]), CryptoError> {
    let nonce = rand::random::<[u8; 12]>();
    let cipher = Aes256Gcm::new_from_slice(kek).map_err(|_| CryptoError::KeyUnavailable)?;
    let aad = mail_aad(outbox_id);
    let ciphertext = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: code.as_bytes(),
                aad: &aad,
            },
        )
        .map_err(|_| CryptoError::InvalidEnvelope)?;
    Ok((ciphertext, nonce))
}

/// Decrypt a code from one claimed mail outbox row.
pub fn open_mail_code(
    kek: &[u8; 32],
    outbox_id: Uuid,
    ciphertext: &[u8],
    nonce: &[u8],
) -> Result<Zeroizing<String>, CryptoError> {
    if nonce.len() != 12 {
        return Err(CryptoError::InvalidEnvelope);
    }
    let cipher = Aes256Gcm::new_from_slice(kek).map_err(|_| CryptoError::KeyUnavailable)?;
    let aad = mail_aad(outbox_id);
    let mut plaintext = Zeroizing::new(
        cipher
            .decrypt(
                Nonce::from_slice(nonce),
                Payload {
                    msg: ciphertext,
                    aad: &aad,
                },
            )
            .map_err(|_| CryptoError::InvalidEnvelope)?,
    );
    let cleartext = String::from_utf8(std::mem::take(&mut *plaintext)).map_err(|error| {
        let mut bytes = error.into_bytes();
        bytes.zeroize();
        CryptoError::InvalidEncoding
    })?;
    Ok(Zeroizing::new(cleartext))
}

/// Create one uniformly formatted six-digit verification code.
pub fn generate_code() -> Zeroizing<String> {
    Zeroizing::new(format!("{:06}", rand::random::<u32>() % 1_000_000))
}

/// Validate the contract's minimum password length and a bounded maximum.
pub fn validate_password(password: &str) -> Result<(), PasswordValidationError> {
    if password.chars().count() < 10 {
        return Err(PasswordValidationError::Weak);
    }
    if password.len() > PASSWORD_MAX_BYTES {
        return Err(PasswordValidationError::TooLong);
    }
    Ok(())
}

/// Password validation outcomes visible to the HTTP layer.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PasswordValidationError {
    /// Password has fewer than ten Unicode scalar values.
    Weak,
    /// Password exceeds the bounded 1024 byte request limit.
    TooLong,
}

/// Derive one Argon2id PHC string without blocking an async worker.
pub async fn hash_password(password: Zeroizing<String>) -> Result<String, CryptoError> {
    validate_password(&password).map_err(|_| CryptoError::Password)?;
    let permit = kdf_semaphore()
        .acquire_owned()
        .await
        .map_err(|_| CryptoError::PasswordBusy)?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let salt = SaltString::generate(&mut argon2::password_hash::rand_core::OsRng);
        Argon2::default()
            .hash_password(password.as_bytes(), &salt)
            .map(|hash| hash.to_string())
            .map_err(|_| CryptoError::Password)
    })
    .await
    .map_err(|_| CryptoError::Password)?
}

/// Verify an Argon2id hash without blocking an async worker.
pub async fn verify_password(
    password: Zeroizing<String>,
    password_hash: Option<String>,
) -> Result<bool, CryptoError> {
    let permit = kdf_semaphore()
        .acquire_owned()
        .await
        .map_err(|_| CryptoError::PasswordBusy)?;
    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        if let Some(phc) = password_hash {
            let parsed = PasswordHash::new(&phc).map_err(|_| CryptoError::Password)?;
            Ok(Argon2::default()
                .verify_password(password.as_bytes(), &parsed)
                .is_ok())
        } else {
            dummy_password_work(password.as_bytes())?;
            Ok(false)
        }
    })
    .await
    .map_err(|_| CryptoError::Password)?
}

fn dummy_password_work(password: &[u8]) -> Result<(), CryptoError> {
    let salt = [0x42_u8; 16];
    let mut output = Zeroizing::new([0_u8; 32]);
    Argon2::default()
        .hash_password_into(password, &salt, &mut *output)
        .map_err(|_| CryptoError::Password)
}

fn kdf_semaphore() -> Arc<tokio::sync::Semaphore> {
    Arc::clone(KDF_SEMAPHORE.get_or_init(|| Arc::new(tokio::sync::Semaphore::new(KDF_CONCURRENCY))))
}

/// Derive a stable, non-secret key identifier used to reject the wrong KEK.
pub fn kek_id(kek: &[u8; 32]) -> String {
    let digest = Sha256::digest(kek);
    format!("kek-{}", hex::encode(&digest[..8]))
}

fn wrap_aad(pubkey: &str, kek_id: &str) -> Vec<u8> {
    [WRAP_AAD_PREFIX, pubkey.as_bytes(), b":", kek_id.as_bytes()].concat()
}

fn nsec_aad(pubkey: &str) -> Vec<u8> {
    [NSEC_AAD_PREFIX, pubkey.as_bytes()].concat()
}

fn mail_aad(outbox_id: Uuid) -> Vec<u8> {
    [MAIL_AAD_PREFIX, outbox_id.to_string().as_bytes()].concat()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encrypted_nsec_round_trips_and_binds_public_key() {
        let (pubkey, nsec) = generate_nostr_identity().expect("generated Nostr identity");
        let kek = [0x31_u8; 32];
        let envelope = seal_nsec(&kek, &pubkey, &nsec).expect("sealed nsec");
        let opened = open_nsec(
            &kek,
            &pubkey,
            &envelope.kek_id,
            &envelope.wrapped_dek,
            &envelope.sealed_nsec,
            &envelope.nonce,
        )
        .expect("opened nsec");
        assert_eq!(opened.as_str(), nsec.as_str());
        assert!(open_nsec(
            &kek,
            &format!("{}0", &pubkey[..63]),
            &envelope.kek_id,
            &envelope.wrapped_dek,
            &envelope.sealed_nsec,
            &envelope.nonce,
        )
        .is_err());
    }

    #[test]
    fn six_digit_code_hash_is_keyed_and_mail_ciphertext_is_bound_to_outbox_id() {
        let kek = [0x54_u8; 32];
        let other_kek = [0x55_u8; 32];
        let code = "012345";
        assert_ne!(
            hash_code(&kek, code).expect("hash account test code"),
            hash_code(&other_kek, code).expect("hash account test code under other KEK")
        );
        assert_ne!(
            hash_code(&kek, code).expect("hash account test code"),
            hash_code(&kek, "012346").expect("hash different account test code")
        );
        let id = Uuid::new_v4();
        let (ciphertext, nonce) = seal_mail_code(&kek, id, code).expect("sealed mail code");
        let opened = open_mail_code(&kek, id, &ciphertext, &nonce).expect("opened mail code");
        assert_eq!(opened.as_str(), code);
        assert!(open_mail_code(&kek, Uuid::new_v4(), &ciphertext, &nonce).is_err());
    }

    #[test]
    fn password_length_matches_contract_and_is_bounded() {
        assert_eq!(
            validate_password("short"),
            Err(PasswordValidationError::Weak)
        );
        assert_eq!(validate_password("a🦊b🦊c🦊d🦊e🦊"), Ok(()));
        assert_eq!(
            validate_password(&"a".repeat(PASSWORD_MAX_BYTES + 1)),
            Err(PasswordValidationError::TooLong)
        );
    }
}
