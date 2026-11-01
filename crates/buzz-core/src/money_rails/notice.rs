//! Payment notices: how Colony learns a link was paid without ever trusting a claim.
//!
//! A notice is a body a provider (or anyone) posts to a connection's private address. It is
//! stored raw and never acts alone. It counts as verified only when its HMAC signature checks
//! out against the sealed signing secret and an owner-approved notice map says the event is a
//! payment success, or when an API lookup returns the same reference, amount and currency.
//! Everything else is "Payment reported, check" at most.

use base64::Engine as _;
use hmac::{Hmac, KeyInit, Mac};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::Sha256;

use super::recipe::{AmountPointer, AmountScale, EqualsPointer};
use super::{currency_exponent, decimal_to_minor, sha256_hex, valid_currency, MoneyError};

type HmacSha256 = Hmac<Sha256>;

/// Largest signature tolerance, in seconds.
pub const MAX_TOLERANCE_SECS: u32 = 600;
/// Default signature tolerance, in seconds.
pub const DEFAULT_TOLERANCE_SECS: u32 = 300;

/// How the signature value is written.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SignatureEncoding {
    /// Lower or upper case hex.
    Hex,
    /// Standard base64.
    Base64,
}

/// What the HMAC covers.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SignedPayload {
    /// The raw body.
    #[serde(rename = "body")]
    Body,
    /// `<timestamp>.<raw body>`, with the timestamp and signature read from a
    /// `key=value,key=value` header (Stripe style).
    #[serde(rename = "timestamp.body")]
    TimestampBody,
}

/// How a provider signs its notices.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct SignatureConfig {
    /// Header that carries the signature.
    pub header: String,
    /// Encoding of the signature value.
    pub encoding: SignatureEncoding,
    /// Text stripped from the front of the value, for example `sha256=`.
    #[serde(default)]
    pub prefix: Option<String>,
    /// What the HMAC covers.
    pub signed_payload: SignedPayload,
    /// Key of the timestamp in a `key=value` header (default `t`).
    #[serde(default)]
    pub timestamp_field: Option<String>,
    /// Key of the signature in a `key=value` header (default `v1`).
    #[serde(default)]
    pub signature_field: Option<String>,
    /// Largest age of a timestamped notice, in seconds (default 300, at most 600).
    #[serde(default)]
    pub tolerance_secs: Option<u32>,
}

/// Checks a signature configuration.
pub fn validate_signature_config(config: &SignatureConfig) -> Result<(), MoneyError> {
    let header_ok = !config.header.is_empty()
        && config.header.len() <= 64
        && config
            .header
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-');
    let prefix_ok = config
        .prefix
        .as_deref()
        .is_none_or(|prefix| prefix.len() <= 16 && !prefix.chars().any(char::is_control));
    let tolerance_ok = config
        .tolerance_secs
        .is_none_or(|secs| (1..=MAX_TOLERANCE_SECS).contains(&secs));
    let field_ok = |field: &Option<String>| {
        field.as_deref().is_none_or(|name| {
            !name.is_empty() && name.len() <= 16 && name.bytes().all(|b| b.is_ascii_alphanumeric())
        })
    };
    if header_ok
        && prefix_ok
        && tolerance_ok
        && field_ok(&config.timestamp_field)
        && field_ok(&config.signature_field)
    {
        Ok(())
    } else {
        Err(MoneyError::invalid(
            "money_invalid_input",
            "the signature settings are not valid",
        ))
    }
}

/// What the signature check found.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SignatureState {
    /// The HMAC matched.
    Verified,
    /// The HMAC did not match, or the timestamp was too old.
    Invalid,
    /// The connection has a signing secret but the notice carried no signature.
    Unsigned,
    /// The connection holds no signing secret, so nothing could be checked.
    NoSecret,
}

impl SignatureState {
    /// The stored and displayed name.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Verified => "verified",
            Self::Invalid => "invalid",
            Self::Unsigned => "unsigned",
            Self::NoSecret => "no_secret",
        }
    }
}

fn decode_signature(text: &str, encoding: SignatureEncoding) -> Option<Vec<u8>> {
    match encoding {
        SignatureEncoding::Hex => hex::decode(text).ok(),
        SignatureEncoding::Base64 => base64::engine::general_purpose::STANDARD.decode(text).ok(),
    }
}

fn hmac_matches(secret: &[u8], payload: &[&[u8]], expected: &[u8]) -> bool {
    let Ok(mut mac) = HmacSha256::new_from_slice(secret) else {
        return false;
    };
    for part in payload {
        mac.update(part);
    }
    mac.verify_slice(expected).is_ok()
}

/// Checks a notice signature in constant time. `header_value` is the value of the configured
/// header, if the notice carried it. `now` is relay time in Unix seconds.
pub fn verify_signature(
    config: &SignatureConfig,
    secret: &[u8],
    header_value: Option<&str>,
    body: &[u8],
    now: i64,
) -> SignatureState {
    let Some(value) = header_value
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return SignatureState::Unsigned;
    };
    let verified = match config.signed_payload {
        SignedPayload::Body => {
            let text = match config.prefix.as_deref() {
                Some(prefix) => value.strip_prefix(prefix).unwrap_or(value),
                None => value,
            };
            decode_signature(text, config.encoding)
                .is_some_and(|expected| hmac_matches(secret, &[body], &expected))
        }
        SignedPayload::TimestampBody => {
            let timestamp_field = config.timestamp_field.as_deref().unwrap_or("t");
            let signature_field = config.signature_field.as_deref().unwrap_or("v1");
            let mut timestamp: Option<&str> = None;
            let mut signatures: Vec<&str> = Vec::new();
            for pair in value.split(',') {
                if let Some((key, val)) = pair.trim().split_once('=') {
                    if key == timestamp_field {
                        timestamp = Some(val);
                    } else if key == signature_field {
                        signatures.push(val);
                    }
                }
            }
            let tolerance = i64::from(
                config
                    .tolerance_secs
                    .unwrap_or(DEFAULT_TOLERANCE_SECS)
                    .min(MAX_TOLERANCE_SECS),
            );
            match timestamp.and_then(|text| text.parse::<i64>().ok().map(|parsed| (text, parsed))) {
                Some((text, parsed)) if (now - parsed).abs() <= tolerance => {
                    let dot: &[u8] = b".";
                    signatures.iter().any(|signature| {
                        decode_signature(signature, config.encoding).is_some_and(|expected| {
                            hmac_matches(secret, &[text.as_bytes(), dot, body], &expected)
                        })
                    })
                }
                _ => false,
            }
        }
    };
    if verified {
        SignatureState::Verified
    } else {
        SignatureState::Invalid
    }
}

/// Computes a signature the way a provider would. Used by tests and fixtures only.
pub fn sign_for_test(
    config: &SignatureConfig,
    secret: &[u8],
    body: &[u8],
    timestamp: i64,
) -> String {
    let timestamp_text = timestamp.to_string();
    let payload: Vec<&[u8]> = match config.signed_payload {
        SignedPayload::Body => vec![body],
        SignedPayload::TimestampBody => vec![timestamp_text.as_bytes(), &b"."[..], body],
    };
    let mut mac = HmacSha256::new_from_slice(secret).expect("hmac accepts any key length");
    for part in payload {
        mac.update(part);
    }
    let bytes = mac.finalize().into_bytes();
    let encoded = match config.encoding {
        SignatureEncoding::Hex => hex::encode(&bytes[..]),
        SignatureEncoding::Base64 => base64::engine::general_purpose::STANDARD.encode(&bytes[..]),
    };
    match config.signed_payload {
        SignedPayload::Body => format!("{}{encoded}", config.prefix.as_deref().unwrap_or("")),
        SignedPayload::TimestampBody => format!(
            "{}={timestamp},{}={encoded}",
            config.timestamp_field.as_deref().unwrap_or("t"),
            config.signature_field.as_deref().unwrap_or("v1")
        ),
    }
}

/// Where to read the facts in a notice body. Non secret; owner approved.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct NoticeMap {
    /// Pointer to the provider's event id (for dedupe).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event_id: Option<String>,
    /// Pointer to the reference of the link or payment.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<String>,
    /// Pointer to the amount.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub amount: Option<AmountPointer>,
    /// Pointer to the currency.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    /// Pointer to the time the payment happened (Unix seconds).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub occurred_at: Option<String>,
    /// Every pointer here must equal its value for the notice to count as a payment success.
    #[serde(default)]
    pub success_when: Vec<EqualsPointer>,
}

/// Checks a notice map.
pub fn validate_notice_map(map: &NoticeMap) -> Result<(), MoneyError> {
    let pointer_ok =
        |p: &str| p.starts_with('/') && p.len() <= 200 && !p.chars().any(char::is_control);
    let mut pointers: Vec<&str> = Vec::new();
    pointers.extend(map.event_id.as_deref());
    pointers.extend(map.reference.as_deref());
    pointers.extend(map.amount.as_ref().map(|a| a.pointer.as_str()));
    pointers.extend(map.currency.as_deref());
    pointers.extend(map.occurred_at.as_deref());
    pointers.extend(map.success_when.iter().map(|p| p.pointer.as_str()));
    if map.success_when.len() > 4
        || map
            .success_when
            .iter()
            .any(|p| p.equals.is_empty() || p.equals.len() > 200)
        || !pointers.iter().all(|p| pointer_ok(p))
    {
        return Err(MoneyError::invalid(
            "notice_map",
            "the notice map has a pointer or a success rule that is not valid",
        ));
    }
    Ok(())
}

/// SHA-256 of the exact map. An approval pins this hash.
pub fn notice_map_hash(map: &NoticeMap) -> String {
    sha256_hex(&serde_json::to_vec(map).unwrap_or_default())
}

/// Whether the notice says the payment succeeded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NoticeKind {
    /// Every success rule of the approved map matched.
    Success,
    /// The map has success rules and at least one did not match (for example an expiry).
    NotSuccess,
    /// No approved map, no success rules, or a body that is not JSON.
    Unknown,
}

/// What was read from a notice body.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NoticeRead {
    /// Provider event id.
    pub event_id: Option<String>,
    /// Reference of the link or payment.
    pub reference: Option<String>,
    /// Amount in minor units.
    pub amount_minor: Option<i64>,
    /// Upper case currency.
    pub currency: Option<String>,
    /// When the payment happened.
    pub occurred_at: Option<i64>,
    /// Success rules result.
    pub kind: NoticeKind,
}

fn text_at(value: &Value, pointer: &str) -> Option<String> {
    match value.pointer(pointer)? {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(flag) => Some(flag.to_string()),
        _ => None,
    }
}

/// Reads a notice body through the approved map. A body that is not JSON, or no map, gives an
/// empty read of kind [`NoticeKind::Unknown`]; the notice is still stored and can be matched
/// by a plain search.
pub fn read_notice(body: &[u8], map: Option<&NoticeMap>, currency_hint: &str) -> NoticeRead {
    let mut read = NoticeRead {
        event_id: None,
        reference: None,
        amount_minor: None,
        currency: None,
        occurred_at: None,
        kind: NoticeKind::Unknown,
    };
    let (Some(map), Ok(value)) = (map, serde_json::from_slice::<Value>(body)) else {
        return read;
    };
    read.event_id = map
        .event_id
        .as_deref()
        .and_then(|p| text_at(&value, p))
        .filter(|id| !id.is_empty() && id.len() <= 200);
    read.reference = map
        .reference
        .as_deref()
        .and_then(|p| text_at(&value, p))
        .filter(|id| !id.is_empty() && id.len() <= 200);
    read.currency = map
        .currency
        .as_deref()
        .and_then(|p| text_at(&value, p))
        .map(|text| text.to_ascii_uppercase())
        .filter(|code| valid_currency(code));
    read.amount_minor = map.amount.as_ref().and_then(|amount| {
        let text = text_at(&value, &amount.pointer)?;
        match amount.scale {
            AmountScale::Minor => text.parse::<i64>().ok(),
            AmountScale::Decimal => {
                let code = read.currency.as_deref().unwrap_or(currency_hint);
                decimal_to_minor(&text, currency_exponent(code))
            }
        }
    });
    read.occurred_at = map
        .occurred_at
        .as_deref()
        .and_then(|p| text_at(&value, p))
        .and_then(|text| text.parse::<i64>().ok());
    if !map.success_when.is_empty() {
        let all = map
            .success_when
            .iter()
            .all(|rule| text_at(&value, &rule.pointer).as_deref() == Some(rule.equals.as_str()));
        read.kind = if all {
            NoticeKind::Success
        } else {
            NoticeKind::NotSuccess
        };
    }
    read
}

/// The key a notice is deduped by: the provider event id when the map reads one, else the hash
/// of the raw body.
pub fn dedupe_key(read: &NoticeRead, body: &[u8]) -> String {
    match &read.event_id {
        Some(id) => format!("event:{id}"),
        None => format!("sha256:{}", sha256_hex(body)),
    }
}

/// What a card is known by, for matching a notice to it.
#[derive(Debug, Clone, Copy)]
pub struct MatchKeys<'a> {
    /// Short card reference such as `PL-7F3K9Q`.
    pub card_ref: &'a str,
    /// The provider's reference for the link, once created.
    pub provider_reference: Option<&'a str>,
}

/// Whether a notice belongs to a card: the read reference equals the provider reference or the
/// card reference, or the raw body contains either one. A match never makes anything paid.
pub fn matches_card(body: &[u8], read: &NoticeRead, keys: &MatchKeys<'_>) -> bool {
    if let Some(reference) = read.reference.as_deref() {
        if reference == keys.card_ref || keys.provider_reference == Some(reference) {
            return true;
        }
    }
    let text = String::from_utf8_lossy(body);
    if text.contains(keys.card_ref) {
        return true;
    }
    keys.provider_reference
        .is_some_and(|reference| reference.len() >= 6 && text.contains(reference))
}

/// What an API lookup returned.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LookupResult {
    /// Reference.
    pub reference: Option<String>,
    /// Amount in minor units.
    pub amount_minor: Option<i64>,
    /// Currency.
    pub currency: Option<String>,
    /// Whether the paid pointer matched.
    pub paid: Option<bool>,
}

/// How a payment was verified.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VerifiedBy {
    /// Signed notice checked with the sealed signing secret.
    Hmac,
    /// An API lookup returned the same reference, amount and currency.
    Lookup,
}

/// What differs between a notice and the card.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mismatch {
    /// The amount differs.
    Amount,
    /// The currency differs.
    Currency,
}

/// The only decision that can lead to "paid".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Judgement {
    /// Store the notice and change nothing on the card.
    Ignore,
    /// The card goes to "Payment reported, check".
    Reported {
        /// Set when the notice's facts differ from the card.
        mismatch: Option<Mismatch>,
    },
    /// Verified. The card may move on to recording evidence.
    Verified {
        /// How.
        by: VerifiedBy,
    },
}

/// Decides what a notice may do to its card.
///
/// * A notice that is not a payment success changes nothing.
/// * When the connection holds a signing secret, a notice with a missing or wrong signature
///   changes nothing: a forged post cannot even raise a report.
/// * Facts that differ from the card make a report, never a payment, even when signed.
/// * HMAC counts only when the approved notice map says the event is a success.
/// * A lookup counts only when it returns the same reference, amount and currency and is paid.
/// * Anything else is a report for the owner to check.
pub fn judge_notice(
    signature: SignatureState,
    read: &NoticeRead,
    lookup: Option<&LookupResult>,
    card_amount_minor: i64,
    card_currency: &str,
    provider_reference: Option<&str>,
) -> Judgement {
    if read.kind == NoticeKind::NotSuccess {
        return Judgement::Ignore;
    }
    if matches!(
        signature,
        SignatureState::Invalid | SignatureState::Unsigned
    ) {
        return Judgement::Ignore;
    }
    let mismatch = if read
        .amount_minor
        .is_some_and(|amount| amount != card_amount_minor)
    {
        Some(Mismatch::Amount)
    } else if read
        .currency
        .as_deref()
        .is_some_and(|currency| currency != card_currency)
    {
        Some(Mismatch::Currency)
    } else {
        None
    };
    if mismatch.is_some() {
        return Judgement::Reported { mismatch };
    }
    if signature == SignatureState::Verified && read.kind == NoticeKind::Success {
        return Judgement::Verified {
            by: VerifiedBy::Hmac,
        };
    }
    if let Some(result) = lookup {
        let same_reference = provider_reference
            .is_none_or(|reference| result.reference.as_deref() == Some(reference));
        let same_amount = result.amount_minor == Some(card_amount_minor);
        let same_currency = result.currency.as_deref() == Some(card_currency);
        if result.paid == Some(true) && same_reference && same_amount && same_currency {
            return Judgement::Verified {
                by: VerifiedBy::Lookup,
            };
        }
        let lookup_mismatch = if result.amount_minor.is_some() && !same_amount {
            Some(Mismatch::Amount)
        } else if result.currency.is_some() && !same_currency {
            Some(Mismatch::Currency)
        } else {
            None
        };
        return Judgement::Reported {
            mismatch: lookup_mismatch,
        };
    }
    Judgement::Verified {
        by: VerifiedBy::Hmac,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn raw_config() -> SignatureConfig {
        SignatureConfig {
            header: "x-signature".to_owned(),
            encoding: SignatureEncoding::Hex,
            prefix: Some("sha256=".to_owned()),
            signed_payload: SignedPayload::Body,
            timestamp_field: None,
            signature_field: None,
            tolerance_secs: None,
        }
    }

    fn stripe_config() -> SignatureConfig {
        SignatureConfig {
            header: "stripe-signature".to_owned(),
            encoding: SignatureEncoding::Hex,
            prefix: None,
            signed_payload: SignedPayload::TimestampBody,
            timestamp_field: None,
            signature_field: None,
            tolerance_secs: Some(300),
        }
    }

    fn map() -> NoticeMap {
        NoticeMap {
            event_id: Some("/id".to_owned()),
            reference: Some("/data/object/payment_link".to_owned()),
            amount: Some(AmountPointer {
                pointer: "/data/object/amount_total".to_owned(),
                scale: AmountScale::Minor,
            }),
            currency: Some("/data/object/currency".to_owned()),
            occurred_at: Some("/created".to_owned()),
            success_when: vec![EqualsPointer {
                pointer: "/type".to_owned(),
                equals: "checkout.session.completed".to_owned(),
            }],
        }
    }

    fn body(kind: &str, amount: i64, currency: &str) -> Vec<u8> {
        serde_json::to_vec(&json!({
            "id": "evt_1",
            "type": kind,
            "created": 1_793_000_500,
            "data": {"object": {
                "payment_link": "plink_123",
                "amount_total": amount,
                "currency": currency
            }}
        }))
        .expect("body")
    }

    #[test]
    fn raw_body_signatures_verify_and_forgeries_do_not() {
        let config = raw_config();
        let secret = b"whsec_test_not_real";
        let payload = body("checkout.session.completed", 375_000, "zar");
        let good = sign_for_test(&config, secret, &payload, 0);
        assert_eq!(
            verify_signature(&config, secret, Some(&good), &payload, 0),
            SignatureState::Verified
        );
        assert_eq!(
            verify_signature(&config, b"another-secret", Some(&good), &payload, 0),
            SignatureState::Invalid
        );
        let tampered = body("checkout.session.completed", 1, "zar");
        assert_eq!(
            verify_signature(&config, secret, Some(&good), &tampered, 0),
            SignatureState::Invalid
        );
        assert_eq!(
            verify_signature(&config, secret, None, &payload, 0),
            SignatureState::Unsigned
        );
        assert_eq!(
            verify_signature(&config, secret, Some("sha256=zz"), &payload, 0),
            SignatureState::Invalid
        );
    }

    #[test]
    fn timestamped_signatures_reject_replays_outside_the_tolerance() {
        let config = stripe_config();
        let secret = b"whsec_test_not_real";
        let payload = body("checkout.session.completed", 375_000, "zar");
        let now = 1_793_000_600;
        let header = sign_for_test(&config, secret, &payload, now - 10);
        assert_eq!(
            verify_signature(&config, secret, Some(&header), &payload, now),
            SignatureState::Verified
        );
        // The same genuine header replayed an hour later is refused.
        assert_eq!(
            verify_signature(&config, secret, Some(&header), &payload, now + 3_600),
            SignatureState::Invalid
        );
        // A swapped timestamp breaks the signature.
        let forged = header.replacen(&(now - 10).to_string(), &now.to_string(), 1);
        assert_eq!(
            verify_signature(&config, secret, Some(&forged), &payload, now),
            SignatureState::Invalid
        );
    }

    #[test]
    fn notices_are_read_through_the_approved_map() {
        let read = read_notice(
            &body("checkout.session.completed", 375_000, "zar"),
            Some(&map()),
            "ZAR",
        );
        assert_eq!(read.event_id.as_deref(), Some("evt_1"));
        assert_eq!(read.reference.as_deref(), Some("plink_123"));
        assert_eq!(read.amount_minor, Some(375_000));
        assert_eq!(read.currency.as_deref(), Some("ZAR"));
        assert_eq!(read.occurred_at, Some(1_793_000_500));
        assert_eq!(read.kind, NoticeKind::Success);
        let expired = read_notice(
            &body("checkout.session.expired", 375_000, "zar"),
            Some(&map()),
            "ZAR",
        );
        assert_eq!(expired.kind, NoticeKind::NotSuccess);
        let unknown = read_notice(b"not json at all", Some(&map()), "ZAR");
        assert_eq!(unknown.kind, NoticeKind::Unknown);
        let no_map = read_notice(&body("checkout.session.completed", 1, "zar"), None, "ZAR");
        assert_eq!(no_map.kind, NoticeKind::Unknown);
        assert_eq!(dedupe_key(&read, b"x"), "event:evt_1");
        assert!(dedupe_key(&unknown, b"x").starts_with("sha256:"));
    }

    #[test]
    fn matching_uses_references_and_never_decides_payment() {
        let payload = body("checkout.session.completed", 375_000, "zar");
        let read = read_notice(&payload, Some(&map()), "ZAR");
        let keys = MatchKeys {
            card_ref: "PL-7F3K9Q",
            provider_reference: Some("plink_123"),
        };
        assert!(matches_card(&payload, &read, &keys));
        let other = MatchKeys {
            card_ref: "PL-ZZZZZZ",
            provider_reference: Some("plink_999"),
        };
        assert!(!matches_card(&payload, &read, &other));
        let by_ref_in_text = b"{\"metadata\":{\"colony_ref\":\"PL-7F3K9Q\"}}".to_vec();
        let empty = read_notice(&by_ref_in_text, None, "ZAR");
        assert!(matches_card(&by_ref_in_text, &empty, &keys));
    }

    fn judged(
        signature: SignatureState,
        kind: &str,
        amount: i64,
        currency: &str,
        lookup: Option<&LookupResult>,
    ) -> Judgement {
        let read = read_notice(&body(kind, amount, currency), Some(&map()), "ZAR");
        judge_notice(signature, &read, lookup, 375_000, "ZAR", Some("plink_123"))
    }

    #[test]
    fn only_a_verified_success_with_matching_facts_is_verified() {
        assert_eq!(
            judged(
                SignatureState::Verified,
                "checkout.session.completed",
                375_000,
                "zar",
                None
            ),
            Judgement::Verified {
                by: VerifiedBy::Hmac
            }
        );
    }

    #[test]
    fn an_unverified_notice_is_never_verified() {
        // No signing secret held: a report at most.
        assert_eq!(
            judged(
                SignatureState::NoSecret,
                "checkout.session.completed",
                375_000,
                "zar",
                None
            ),
            Judgement::Reported { mismatch: None }
        );
        // A secret is held and the notice is unsigned or wrongly signed: it changes nothing.
        for signature in [SignatureState::Unsigned, SignatureState::Invalid] {
            assert_eq!(
                judged(
                    signature,
                    "checkout.session.completed",
                    375_000,
                    "zar",
                    None
                ),
                Judgement::Ignore
            );
        }
    }

    #[test]
    fn a_signed_notice_with_other_facts_is_a_report_not_a_payment() {
        assert_eq!(
            judged(
                SignatureState::Verified,
                "checkout.session.completed",
                100,
                "zar",
                None
            ),
            Judgement::Reported {
                mismatch: Some(Mismatch::Amount)
            }
        );
        assert_eq!(
            judged(
                SignatureState::Verified,
                "checkout.session.completed",
                375_000,
                "usd",
                None
            ),
            Judgement::Reported {
                mismatch: Some(Mismatch::Currency)
            }
        );
    }

    #[test]
    fn a_signed_event_that_is_not_a_success_changes_nothing() {
        assert_eq!(
            judged(
                SignatureState::Verified,
                "checkout.session.expired",
                375_000,
                "zar",
                None
            ),
            Judgement::Ignore
        );
    }

    #[test]
    fn hmac_alone_is_not_enough_without_an_approved_success_rule() {
        let read = read_notice(
            &body("checkout.session.completed", 375_000, "zar"),
            None,
            "ZAR",
        );
        assert_eq!(
            judge_notice(
                SignatureState::Verified,
                &read,
                None,
                375_000,
                "ZAR",
                Some("plink_123")
            ),
            Judgement::Reported { mismatch: None }
        );
    }

    #[test]
    fn a_lookup_verifies_only_when_everything_matches() {
        let paid = LookupResult {
            reference: Some("plink_123".to_owned()),
            amount_minor: Some(375_000),
            currency: Some("ZAR".to_owned()),
            paid: Some(true),
        };
        assert_eq!(
            judged(
                SignatureState::NoSecret,
                "checkout.session.completed",
                375_000,
                "zar",
                Some(&paid)
            ),
            Judgement::Verified {
                by: VerifiedBy::Lookup
            }
        );
        let wrong_amount = LookupResult {
            amount_minor: Some(1),
            ..paid.clone()
        };
        assert_eq!(
            judged(
                SignatureState::NoSecret,
                "checkout.session.completed",
                375_000,
                "zar",
                Some(&wrong_amount)
            ),
            Judgement::Reported {
                mismatch: Some(Mismatch::Amount)
            }
        );
        let unpaid = LookupResult {
            paid: Some(false),
            ..paid.clone()
        };
        assert_eq!(
            judged(
                SignatureState::NoSecret,
                "checkout.session.completed",
                375_000,
                "zar",
                Some(&unpaid)
            ),
            Judgement::Reported { mismatch: None }
        );
        let other_reference = LookupResult {
            reference: Some("plink_other".to_owned()),
            ..paid
        };
        assert_eq!(
            judged(
                SignatureState::NoSecret,
                "checkout.session.completed",
                375_000,
                "zar",
                Some(&other_reference)
            ),
            Judgement::Reported { mismatch: None }
        );
    }

    #[test]
    fn signature_and_map_settings_are_validated() {
        assert!(validate_signature_config(&raw_config()).is_ok());
        let mut bad = raw_config();
        bad.header = "bad header".to_owned();
        assert!(validate_signature_config(&bad).is_err());
        let mut long = stripe_config();
        long.tolerance_secs = Some(10_000);
        assert!(validate_signature_config(&long).is_err());
        assert!(validate_notice_map(&map()).is_ok());
        let mut bad_map = map();
        bad_map.reference = Some("no-slash".to_owned());
        assert!(validate_notice_map(&bad_map).is_err());
        assert_eq!(notice_map_hash(&map()), notice_map_hash(&map()));
    }
}
