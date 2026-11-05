//! Money rails, payment links: the pure rules.
//!
//! Contract: `docs/money-rails-pay-contract.md`. Nothing in this module does I/O. The relay
//! resolves who the caller is, reads the invoice and the connection, and hands the facts to
//! these functions, which own every rule:
//!
//! * [`refusal`]: the word list that keeps Scout from ever moving money out.
//! * [`recipe`]: request recipes, host lock, rendering, extraction and scrubbing.
//! * [`connection`]: a provider connection and its owner-approved recipes.
//! * [`link`]: the payment link card and its state machine (draft, approve, void on edit).
//! * [`notice`]: payment notices, signature checks and the judgement that decides whether
//!   a notice may ever count as verified.

pub mod connection;
pub mod link;
pub mod notice;
pub mod recipe;
pub mod refusal;

use std::fmt;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

/// Schema version of every money rails record.
pub const MONEY_RAILS_SCHEMA_VERSION: u8 = 1;
/// d-tag prefix of a payment link card.
pub const LINK_D_PREFIX: &str = "paylink:";
/// d-tag prefix of a money rails connection.
pub const CONNECTION_D_PREFIX: &str = "payconn:";
/// Largest notice body the inbox accepts, in bytes.
pub const NOTICE_MAX_BYTES: usize = 64 * 1024;
/// Days a raw notice body is kept before it is reduced to its evidence fields.
pub const NOTICE_KEEP_DAYS: i64 = 90;
/// How long an approved card pre-clears the browser Create step, in seconds.
pub const BROWSER_GRANT_SECS: i64 = 15 * 60;
/// Default link expiry in days.
pub const DEFAULT_EXPIRES_DAYS: u32 = 14;
/// Longest link expiry in days.
pub const MAX_EXPIRES_DAYS: u32 = 90;
/// Longest short text (title, label, purpose line), in characters.
pub const MAX_SHORT_TEXT_CHARS: usize = 200;
/// Longest message text, in characters.
pub const MAX_MESSAGE_CHARS: usize = 1_000;
/// Largest amount a card may carry, in minor units.
pub const MAX_AMOUNT_MINOR: i64 = 1_000_000_000_000;

/// Who is acting, as far as money rails cares.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActorRole {
    /// A person who is the community owner or an admin.
    OwnerAdmin,
    /// An agent owned by an owner or admin (Scout). Never approves.
    OwnedAgent,
    /// Anyone else.
    Other,
}

impl ActorRole {
    /// True for a person who may approve.
    pub fn is_owner_admin(self) -> bool {
        self == Self::OwnerAdmin
    }

    /// True for an owner, admin or owned agent.
    pub fn may_prepare(self) -> bool {
        matches!(self, Self::OwnerAdmin | Self::OwnedAgent)
    }
}

/// How a rejected command should be reported.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorKind {
    /// The command is malformed or breaks a rule.
    Invalid,
    /// The caller may not do this.
    Forbidden,
    /// The state or the head the command named has moved on.
    Conflict,
}

/// A refused money rails command. `code` is stable and shown by the UI; `message` is plain
/// words for the owner and never carries a secret.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MoneyError {
    /// Kind of refusal.
    pub kind: ErrorKind,
    /// Stable machine code.
    pub code: &'static str,
    /// Plain words.
    pub message: String,
}

impl MoneyError {
    /// A malformed command.
    pub fn invalid(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            kind: ErrorKind::Invalid,
            code,
            message: message.into(),
        }
    }

    /// A command the caller may not run.
    pub fn forbidden(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            kind: ErrorKind::Forbidden,
            code,
            message: message.into(),
        }
    }

    /// A command that does not fit the current state.
    pub fn conflict(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            kind: ErrorKind::Conflict,
            code,
            message: message.into(),
        }
    }
}

impl fmt::Display for MoneyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} ({})", self.message, self.code)
    }
}

impl std::error::Error for MoneyError {}

/// Which route a connection takes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Route {
    /// The relay runs approved recipes with a sealed key.
    Api,
    /// Scout works the provider's site in the built-in browser.
    Browser,
}

/// Where a payment link message goes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecipientChannel {
    /// WhatsApp, through the existing sender.
    Whatsapp,
    /// Email.
    Email,
}

/// d-tag of a payment link card.
pub fn link_d_tag(link_id: Uuid) -> String {
    format!("{LINK_D_PREFIX}{link_id}")
}

/// Parses the card id out of a card d-tag.
pub fn parse_link_d_tag(d_tag: &str) -> Result<Uuid, MoneyError> {
    d_tag
        .strip_prefix(LINK_D_PREFIX)
        .and_then(|rest| Uuid::parse_str(rest).ok())
        .ok_or_else(|| {
            MoneyError::invalid("bad_d_tag", "payment link d tag must be paylink:<uuid>")
        })
}

/// d-tag of a money rails connection.
pub fn connection_d_tag(connection_id: Uuid) -> String {
    format!("{CONNECTION_D_PREFIX}{connection_id}")
}

/// Parses the connection id out of a connection d-tag.
pub fn parse_connection_d_tag(d_tag: &str) -> Result<Uuid, MoneyError> {
    d_tag
        .strip_prefix(CONNECTION_D_PREFIX)
        .and_then(|rest| Uuid::parse_str(rest).ok())
        .ok_or_else(|| MoneyError::invalid("bad_d_tag", "connection d tag must be payconn:<uuid>"))
}

/// SHA-256 of `bytes` as lowercase hex.
pub fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    hex::encode(&digest[..])
}

/// Short card reference such as `PL-7F3K9Q`, derived from the card id. It goes into the
/// provider's metadata so a notice can be matched back to its card.
pub fn card_ref(link_id: Uuid) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let digest = Sha256::digest(link_id.as_bytes());
    let mut out = String::from("PL-");
    for byte in &digest[..6] {
        out.push(char::from(ALPHABET[usize::from(*byte) % ALPHABET.len()]));
    }
    out
}

/// True for a three letter upper case ISO 4217 style currency code.
pub fn valid_currency(code: &str) -> bool {
    code.len() == 3 && code.bytes().all(|b| b.is_ascii_uppercase())
}

/// Decimal places of a currency's minor unit (ISO 4217 exponent, default 2).
pub fn currency_exponent(code: &str) -> u32 {
    match code {
        "BIF" | "CLP" | "DJF" | "GNF" | "ISK" | "JPY" | "KMF" | "KRW" | "PYG" | "RWF" | "UGX"
        | "UYI" | "VND" | "VUV" | "XAF" | "XOF" | "XPF" => 0,
        "BHD" | "IQD" | "JOD" | "KWD" | "LYD" | "OMR" | "TND" => 3,
        _ => 2,
    }
}

/// Renders minor units as a plain decimal string for the currency (`375000`, `ZAR` is
/// `3750.00`).
pub fn minor_to_decimal(minor: i64, exponent: u32) -> String {
    if exponent == 0 {
        return minor.to_string();
    }
    let sign = if minor < 0 { "-" } else { "" };
    let abs = minor.unsigned_abs();
    let scale = 10u64.pow(exponent);
    let whole = abs / scale;
    let frac = abs % scale;
    format!("{sign}{whole}.{frac:0width$}", width = exponent as usize)
}

/// Parses a plain decimal string into minor units without floating point. Extra fractional
/// digits are accepted only when they are all zero.
pub fn decimal_to_minor(text: &str, exponent: u32) -> Option<i64> {
    let text = text.trim();
    if text.is_empty() || text.starts_with('-') || text.starts_with('+') {
        return None;
    }
    let (whole, frac) = match text.split_once('.') {
        Some((whole, frac)) => (whole, frac),
        None => (text, ""),
    };
    if whole.is_empty() || !whole.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    if !frac.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let exponent = exponent as usize;
    let (kept, extra) = if frac.len() > exponent {
        frac.split_at(exponent)
    } else {
        (frac, "")
    };
    if extra.bytes().any(|b| b != b'0') {
        return None;
    }
    let mut digits = String::with_capacity(whole.len() + exponent);
    digits.push_str(whole);
    digits.push_str(kept);
    for _ in kept.len()..exponent {
        digits.push('0');
    }
    digits.parse::<i64>().ok()
}

/// True for a lower case public host name such as `api.stripe.com`: dotted labels, a
/// non-numeric last label (so no IP literal), no port, no scheme, no local suffix.
pub fn valid_host(host: &str) -> bool {
    if host.is_empty() || host.len() > 253 || !host.contains('.') {
        return false;
    }
    if host.ends_with(".local") || host.ends_with(".localhost") || host.ends_with(".internal") {
        return false;
    }
    let labels: Vec<&str> = host.split('.').collect();
    for label in &labels {
        let bytes = label.as_bytes();
        if bytes.is_empty() || bytes.len() > 63 {
            return false;
        }
        if bytes[0] == b'-' || bytes[bytes.len() - 1] == b'-' {
            return false;
        }
        if !bytes
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
        {
            return false;
        }
    }
    labels
        .last()
        .is_some_and(|last| last.bytes().any(|b| b.is_ascii_lowercase()))
}

/// Normalises a WhatsApp number to digits only (6 to 15 digits, no plus, no leading zeros
/// of an international prefix), or `None`.
pub fn normalize_whatsapp(address: &str) -> Option<String> {
    let mut digits: String = address.chars().filter(char::is_ascii_digit).collect();
    if address.trim_start().starts_with("00") && digits.starts_with("00") {
        digits = digits[2..].to_owned();
    }
    let allowed = address
        .chars()
        .all(|c| c.is_ascii_digit() || matches!(c, '+' | ' ' | '-' | '(' | ')'));
    if allowed && (6..=15).contains(&digits.len()) {
        Some(digits)
    } else {
        None
    }
}

/// A basic email shape check: one `@`, a dotted domain, no spaces.
pub fn valid_email(address: &str) -> bool {
    let address = address.trim();
    if address.len() < 5 || address.len() > 254 || address.chars().any(char::is_whitespace) {
        return false;
    }
    match address.split_once('@') {
        Some((local, domain)) => {
            !local.is_empty()
                && !domain.contains('@')
                && domain.contains('.')
                && !domain.starts_with('.')
                && !domain.ends_with('.')
        }
        None => false,
    }
}

/// The masked form of a recipient that is safe in a community-wide head: `+27 82 *** 4521`
/// for a number, `t***@example.com` for an email.
pub fn mask_recipient(channel: RecipientChannel, address: &str) -> String {
    match channel {
        RecipientChannel::Whatsapp => {
            let digits: String = address.chars().filter(char::is_ascii_digit).collect();
            if digits.len() >= 8 {
                format!(
                    "+{} {} *** {}",
                    &digits[..2],
                    &digits[2..4],
                    &digits[digits.len() - 4..]
                )
            } else {
                "*** ****".to_owned()
            }
        }
        RecipientChannel::Email => match address.split_once('@') {
            Some((local, domain)) => {
                let first: String = local.chars().take(1).collect();
                format!("{first}***@{domain}")
            }
            None => "***".to_owned(),
        },
    }
}

/// True when `text` has no control characters and is within `max` characters.
pub fn clean_text(text: &str, max: usize) -> bool {
    !text.is_empty() && text.chars().count() <= max && !text.chars().any(char::is_control)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn d_tags_round_trip_and_reject_other_prefixes() {
        let id = Uuid::new_v4();
        assert_eq!(parse_link_d_tag(&link_d_tag(id)).expect("link tag"), id);
        assert_eq!(
            parse_connection_d_tag(&connection_d_tag(id)).expect("connection tag"),
            id
        );
        assert!(parse_link_d_tag(&connection_d_tag(id)).is_err());
        assert!(parse_connection_d_tag("payconn:not-a-uuid").is_err());
    }

    #[test]
    fn card_ref_is_stable_and_shaped() {
        let id = Uuid::new_v4();
        let reference = card_ref(id);
        assert_eq!(reference, card_ref(id));
        assert!(reference.starts_with("PL-"));
        assert_eq!(reference.len(), 9);
        assert_ne!(reference, card_ref(Uuid::new_v4()));
    }

    #[test]
    fn decimals_convert_without_floats() {
        assert_eq!(decimal_to_minor("3750.00", 2), Some(375_000));
        assert_eq!(decimal_to_minor("3750", 2), Some(375_000));
        assert_eq!(decimal_to_minor("3750.5", 2), Some(375_050));
        assert_eq!(decimal_to_minor("3750.500", 2), Some(375_050));
        assert_eq!(decimal_to_minor("3750.505", 2), None);
        assert_eq!(decimal_to_minor("-1", 2), None);
        assert_eq!(decimal_to_minor("1e3", 2), None);
        assert_eq!(decimal_to_minor("1500", 0), Some(1_500));
        assert_eq!(decimal_to_minor("1.250", 3), Some(1_250));
        assert_eq!(minor_to_decimal(375_000, 2), "3750.00");
        assert_eq!(minor_to_decimal(5, 2), "0.05");
        assert_eq!(minor_to_decimal(1_500, 0), "1500");
        assert_eq!(currency_exponent("JPY"), 0);
        assert_eq!(currency_exponent("KWD"), 3);
        assert_eq!(currency_exponent("ZAR"), 2);
    }

    #[test]
    fn hosts_must_be_public_names() {
        assert!(valid_host("api.stripe.com"));
        assert!(valid_host("dashboard.stripe.com"));
        assert!(!valid_host("localhost"));
        assert!(!valid_host("127.0.0.1"));
        assert!(!valid_host("10.0.0.1"));
        assert!(!valid_host("API.stripe.com"));
        assert!(!valid_host("api.stripe.com:443"));
        assert!(!valid_host("https://api.stripe.com"));
        assert!(!valid_host("stripe.local"));
        assert!(!valid_host("-bad.example.com"));
        assert!(!valid_host("a..b.com"));
    }

    #[test]
    fn recipients_normalise_and_mask() {
        assert_eq!(
            normalize_whatsapp("+27 82 123 4521").as_deref(),
            Some("27821234521")
        );
        assert_eq!(
            normalize_whatsapp("0027821234521").as_deref(),
            Some("27821234521")
        );
        assert!(normalize_whatsapp("call me").is_none());
        assert!(normalize_whatsapp("123").is_none());
        assert!(valid_email("thandi@planetree.co.za"));
        assert!(!valid_email("thandi@"));
        assert!(!valid_email("a b@c.de"));
        assert_eq!(
            mask_recipient(RecipientChannel::Whatsapp, "27821234521"),
            "+27 82 *** 4521"
        );
        assert_eq!(
            mask_recipient(RecipientChannel::Email, "thandi@planetree.co.za"),
            "t***@planetree.co.za"
        );
        assert!(!mask_recipient(RecipientChannel::Whatsapp, "27821234521").contains("1234"));
    }
}
