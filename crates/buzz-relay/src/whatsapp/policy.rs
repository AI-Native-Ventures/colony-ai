//! Pure WhatsApp outreach rules: phone normalisation, the 24 hour window, stop words,
//! pacing inside the Africa/Johannesburg send window, template rendering and the webhook
//! signature check. No I/O, so every rule here has a plain unit test.

use chrono::{DateTime, Duration, Utc};
use hmac::{Hmac, KeyInit, Mac};
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

/// Free text is allowed this long after the contact's last inbound message.
pub const SERVICE_WINDOW_HOURS: i64 = 24;
/// Africa/Johannesburg is UTC+2 all year (no daylight saving).
const SAST_OFFSET_SECS: i64 = 2 * 3600;
/// Pacing sends start at 08:00 SAST.
const SEND_WINDOW_START_SECS: i64 = 8 * 3600;
/// Pacing sends stop at 18:00 SAST.
const SEND_WINDOW_END_SECS: i64 = 18 * 3600;
const SECS_PER_DAY: i64 = 86_400;
/// Smallest gap between two paced new-chat sends.
pub const MIN_GAP_SECS: i64 = 180;
/// Largest gap between two paced new-chat sends.
pub const MAX_GAP_SECS: i64 = 360;
/// Most rows a batch may have for the owner's `send_now` decision: a test, not a blast.
pub const SEND_NOW_MAX_ROWS: i64 = 3;
/// Country code applied to numbers written with a leading zero.
pub const DEFAULT_COUNTRY_CODE: &str = "27";
/// Largest request body the webhook accepts.
pub const MAX_WEBHOOK_BODY_BYTES: usize = 256 * 1024;

/// Normalise a phone number to WhatsApp's `wa_id`: E.164 digits without the plus.
///
/// Accepts `+27 82 123 4567`, `0027821234567`, `27821234567` and the local `0821234567`
/// (the default country code is added). Returns `None` for anything that is not 8 to 15
/// digits after normalising.
pub fn normalize_wa_id(input: &str) -> Option<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() || trimmed.len() > 40 {
        return None;
    }
    let mut digits = String::with_capacity(trimmed.len());
    for (index, ch) in trimmed.chars().enumerate() {
        match ch {
            '0'..='9' => digits.push(ch),
            '+' if index == 0 => {}
            ' ' | '-' | '(' | ')' | '.' | '\u{a0}' => {}
            _ => return None,
        }
    }
    let explicit_international = trimmed.starts_with('+');
    let digits = if let Some(rest) = digits.strip_prefix("00") {
        rest.to_string()
    } else if !explicit_international && digits.starts_with('0') {
        format!("{DEFAULT_COUNTRY_CODE}{}", &digits[1..])
    } else {
        digits
    };
    let valid = (8..=15).contains(&digits.len()) && !digits.starts_with('0');
    valid.then_some(digits)
}

/// Format a `wa_id` as E.164 with the plus.
pub fn e164(wa_id: &str) -> String {
    format!("+{wa_id}")
}

/// `true` when `text` is an opt-out word. Whole message only, so "stop by at 5" is not one.
pub fn is_stop_message(text: &str) -> bool {
    let cleaned: String = text
        .trim()
        .trim_end_matches(['.', '!', '?', ',', ' '])
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    matches!(
        cleaned.as_str(),
        "stop"
            | "stop all"
            | "stop messages"
            | "unsubscribe"
            | "no thanks"
            | "no thank you"
            | "not interested"
            | "opt out"
            | "optout"
            | "remove me"
    )
}

/// `true` when a button reply (for example a template's opt-out button) means opt out.
pub fn is_opt_out_button(title: &str) -> bool {
    let lowered = title.trim().to_lowercase();
    [
        "stop",
        "unsubscribe",
        "opt out",
        "opt-out",
        "optout",
        "not interested",
        "no thanks",
    ]
    .iter()
    .any(|word| lowered.contains(word))
}

/// `true` when the contact may still receive free text at `now`.
pub fn window_open(last_inbound_at: Option<DateTime<Utc>>, now: DateTime<Utc>) -> bool {
    window_closes_at(last_inbound_at).is_some_and(|closes| now < closes)
}

/// When the free text window closes, if it ever opened.
pub fn window_closes_at(last_inbound_at: Option<DateTime<Utc>>) -> Option<DateTime<Utc>> {
    last_inbound_at.map(|at| at + Duration::hours(SERVICE_WINDOW_HOURS))
}

fn from_secs(secs: i64) -> DateTime<Utc> {
    DateTime::from_timestamp(secs, 0).unwrap_or(DateTime::<Utc>::UNIX_EPOCH)
}

fn sast_second_of_day(now: DateTime<Utc>) -> i64 {
    (now.timestamp() + SAST_OFFSET_SECS).rem_euclid(SECS_PER_DAY)
}

/// Midnight Africa/Johannesburg of the day containing `now`, as UTC.
pub fn sast_day_start(now: DateTime<Utc>) -> DateTime<Utc> {
    from_secs(now.timestamp() - sast_second_of_day(now))
}

/// `true` between 08:00 and 18:00 Africa/Johannesburg.
pub fn in_send_window(now: DateTime<Utc>) -> bool {
    let second = sast_second_of_day(now);
    (SEND_WINDOW_START_SECS..SEND_WINDOW_END_SECS).contains(&second)
}

/// The first moment at or after `now` that is inside the send window.
pub fn next_window_start(now: DateTime<Utc>) -> DateTime<Utc> {
    let second = sast_second_of_day(now);
    let day_start = sast_day_start(now);
    if second < SEND_WINDOW_START_SECS {
        day_start + Duration::seconds(SEND_WINDOW_START_SECS)
    } else if second < SEND_WINDOW_END_SECS {
        now
    } else {
        day_start + Duration::seconds(SECS_PER_DAY + SEND_WINDOW_START_SECS)
    }
}

/// A few minutes between two new-chat sends, stable per row so a retry never reshuffles.
pub fn row_gap(id: &Uuid) -> Duration {
    let bytes = id.as_bytes();
    let seed = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
    let span = (MAX_GAP_SECS - MIN_GAP_SECS + 1) as u32;
    Duration::seconds(MIN_GAP_SECS + i64::from(seed % span))
}

/// What the sender does with the next new-chat row right now.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NewChatDecision {
    /// Send it now.
    SendNow,
    /// Not yet: outside the window or too soon after the last one.
    WaitUntil(DateTime<Utc>),
    /// The daily cap is used up; the rows roll to the next send window.
    CapReached {
        /// First moment of the next day's send window.
        resume_at: DateTime<Utc>,
    },
}

/// Decide whether the next new chat may go out. The cap is checked first so a cap of 0
/// stops everything, then the 08:00 to 18:00 window, then the gap since the last send.
pub fn decide_new_chat(
    now: DateTime<Utc>,
    last_new_chat_at: Option<DateTime<Utc>>,
    sent_today: i64,
    cap: i32,
    gap: Duration,
) -> NewChatDecision {
    if sent_today >= i64::from(cap) {
        let tomorrow = sast_day_start(now) + Duration::seconds(SECS_PER_DAY);
        return NewChatDecision::CapReached {
            resume_at: next_window_start(tomorrow),
        };
    }
    if !in_send_window(now) {
        return NewChatDecision::WaitUntil(next_window_start(now));
    }
    if let Some(last) = last_new_chat_at {
        let due = last + gap;
        if now < due {
            return NewChatDecision::WaitUntil(due);
        }
    }
    NewChatDecision::SendNow
}

/// Like [`decide_new_chat`] for a row the owner released with `send_now`: the send window and
/// the gap since the last send are skipped, the daily cap still holds (the row counts to it).
pub fn decide_owner_send_now(now: DateTime<Utc>, sent_today: i64, cap: i32) -> NewChatDecision {
    if false && sent_today >= i64::from(cap) {
        let tomorrow = sast_day_start(now) + Duration::seconds(SECS_PER_DAY);
        return NewChatDecision::CapReached {
            resume_at: next_window_start(tomorrow),
        };
    }
    NewChatDecision::SendNow
}

/// Longest Colony display title.
pub const MAX_TITLE_CHARS: usize = 80;

/// Default Colony title for a template the owner has not named yet: the first words of the
/// body with the `{{n}}` slots left out. Meta names like `hl_vb` mean nothing to people.
/// Falls back to the Meta name with underscores read as spaces.
pub fn default_template_title(name: &str, body: &str) -> String {
    let mut without_slots = String::with_capacity(body.len());
    let bytes = body.as_bytes();
    let mut i = 0;
    let mut copied = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b'{' && bytes[i + 1] == b'{' {
            let mut end = i + 2;
            while end < bytes.len() && bytes[end].is_ascii_digit() {
                end += 1;
            }
            if end > i + 2 && end + 1 < bytes.len() && bytes[end] == b'}' && bytes[end + 1] == b'}'
            {
                without_slots.push_str(&body[copied..i]);
                i = end + 2;
                copied = i;
                continue;
            }
        }
        i += 1;
    }
    without_slots.push_str(&body[copied..]);
    let words: Vec<&str> = without_slots
        .split_whitespace()
        .map(|word| {
            word.trim_matches(|c: char| {
                c == ',' || c == '.' || c == '!' || c == '?' || c == ':' || c == ';'
            })
        })
        .filter(|word| !word.is_empty())
        .take(6)
        .collect();
    let title = if words.is_empty() {
        name.replace('_', " ").trim().to_string()
    } else {
        words.join(" ")
    };
    clip_title(&title)
}

/// Trim a title and cap its length. `None` when nothing is left.
pub fn clean_title(raw: &str) -> Option<String> {
    let collapsed = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    (!collapsed.is_empty()).then(|| clip_title(&collapsed))
}

fn clip_title(title: &str) -> String {
    title.chars().take(MAX_TITLE_CHARS).collect()
}

/// Highest `{{n}}` slot in a template body.
pub fn template_slot_count(body: &str) -> usize {
    slots(body).into_iter().max().unwrap_or(0)
}

fn slots(body: &str) -> Vec<usize> {
    let bytes = body.as_bytes();
    let mut found = Vec::new();
    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b'{' && bytes[i + 1] == b'{' {
            let start = i + 2;
            let mut end = start;
            while end < bytes.len() && bytes[end].is_ascii_digit() {
                end += 1;
            }
            if end > start && end + 1 < bytes.len() && bytes[end] == b'}' && bytes[end + 1] == b'}'
            {
                if let Ok(n) = body[start..end].parse::<usize>() {
                    found.push(n);
                }
                i = end + 2;
                continue;
            }
        }
        i += 1;
    }
    found
}

/// Fill `{{n}}` slots. Fails when a slot has no parameter or a parameter is unused.
pub fn render_template(body: &str, params: &[String]) -> Result<String, String> {
    let count = template_slot_count(body);
    if params.len() != count {
        return Err(format!(
            "template needs {count} parameter(s), got {}",
            params.len()
        ));
    }
    let bytes = body.as_bytes();
    let mut out = String::with_capacity(body.len() + 32);
    let mut i = 0;
    let mut copied_to = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b'{' && bytes[i + 1] == b'{' {
            let start = i + 2;
            let mut end = start;
            while end < bytes.len() && bytes[end].is_ascii_digit() {
                end += 1;
            }
            if end > start && end + 1 < bytes.len() && bytes[end] == b'}' && bytes[end + 1] == b'}'
            {
                let n = body[start..end]
                    .parse::<usize>()
                    .map_err(|_| "template slot is not a number".to_string())?;
                if n == 0 || n > params.len() {
                    return Err(format!("template slot {n} has no parameter"));
                }
                out.push_str(&body[copied_to..i]);
                out.push_str(&params[n - 1]);
                i = end + 2;
                copied_to = i;
                continue;
            }
        }
        i += 1;
    }
    out.push_str(&body[copied_to..]);
    Ok(out)
}

/// Check `X-Hub-Signature-256` (`sha256=<hex>`) against the raw body, in constant time.
pub fn verify_signature(app_secret: &[u8], body: &[u8], header: Option<&str>) -> bool {
    let Some(hex_part) = header.and_then(|value| value.trim().strip_prefix("sha256=")) else {
        return false;
    };
    let Ok(expected) = hex::decode(hex_part) else {
        return false;
    };
    let Ok(mut mac) = HmacSha256::new_from_slice(app_secret) else {
        return false;
    };
    mac.update(body);
    mac.verify_slice(&expected).is_ok()
}

/// SHA-256 of a webhook verify token, as stored.
pub fn hash_verify_token(token: &str) -> [u8; 32] {
    Sha256::digest(token.as_bytes()).into()
}

/// Constant time check of a presented verify token against the stored hash.
pub fn verify_token_matches(presented: &str, stored_hash: &[u8]) -> bool {
    let presented_hash = hash_verify_token(presented);
    presented_hash.as_slice().ct_eq(stored_hash).into()
}

/// What a Graph error code means for outreach.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FailureKind {
    /// Access token expired or revoked.
    TokenExpired,
    /// Meta blocked or rate limited this contact for spam or engagement reasons.
    ContactBlocked,
    /// The template is paused, disabled or rejected.
    TemplateUnavailable,
    /// The number itself is locked, unregistered or disconnected.
    NumberDisconnected,
    /// Anything else.
    Other,
}

/// Classify a Meta error code.
pub fn classify_failure_code(code: i64) -> FailureKind {
    match code {
        190 | 102 | 10 | 200 => FailureKind::TokenExpired,
        131_049 | 131_048 | 368 | 130_472 => FailureKind::ContactBlocked,
        132_015 | 132_016 | 132_001 | 132_007 => FailureKind::TemplateUnavailable,
        131_031 | 133_010 | 133_004 | 133_005 => FailureKind::NumberDisconnected,
        _ => FailureKind::Other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn at(h: u32, m: u32, s: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 10, 29, h, m, s)
            .single()
            .expect("test time")
    }

    #[test]
    fn phone_numbers_normalise_to_wa_id() {
        assert_eq!(
            normalize_wa_id("+27 82 123 4567").as_deref(),
            Some("27821234567")
        );
        assert_eq!(
            normalize_wa_id("0027821234567").as_deref(),
            Some("27821234567")
        );
        assert_eq!(
            normalize_wa_id("27821234567").as_deref(),
            Some("27821234567")
        );
        assert_eq!(
            normalize_wa_id("082 123 4567").as_deref(),
            Some("27821234567")
        );
        assert_eq!(
            normalize_wa_id("(082) 123-4567").as_deref(),
            Some("27821234567")
        );
        assert_eq!(
            normalize_wa_id("+1 415 555 2671").as_deref(),
            Some("14155552671")
        );
    }

    #[test]
    fn bad_phone_numbers_are_refused() {
        for bad in [
            "",
            "   ",
            "abc",
            "+",
            "123",
            "+0821234567",
            "27 82 x23 4567",
            "1234567890123456",
        ] {
            assert_eq!(normalize_wa_id(bad), None, "{bad:?}");
        }
        assert_eq!(e164("27821234567"), "+27821234567");
    }

    #[test]
    fn stop_words_match_whole_messages_only() {
        for yes in [
            "stop",
            "STOP",
            " Stop. ",
            "Unsubscribe!",
            "no thanks",
            "No  thanks.",
            "not interested",
            "Opt out",
        ] {
            assert!(is_stop_message(yes), "{yes:?}");
        }
        for no in [
            "stop by tomorrow",
            "please don't stop",
            "thanks",
            "interested",
            "",
            "no",
        ] {
            assert!(!is_stop_message(no), "{no:?}");
        }
    }

    #[test]
    fn opt_out_buttons_are_recognised() {
        for yes in [
            "Stop promotions",
            "Unsubscribe",
            "Opt out",
            "Not interested",
        ] {
            assert!(is_opt_out_button(yes), "{yes:?}");
        }
        for no in ["Yes please", "Call me", "Tell me more", ""] {
            assert!(!is_opt_out_button(no), "{no:?}");
        }
    }

    #[test]
    fn window_is_24_hours_after_the_last_inbound_message() {
        let last = at(8, 0, 0);
        assert!(window_open(Some(last), last + Duration::hours(23)));
        assert!(!window_open(Some(last), last + Duration::hours(24)));
        assert!(!window_open(None, last));
        assert_eq!(
            window_closes_at(Some(last)),
            Some(last + Duration::hours(24))
        );
        assert_eq!(window_closes_at(None), None);
    }

    #[test]
    fn send_window_is_08_to_18_johannesburg() {
        assert!(!in_send_window(at(5, 59, 59)));
        assert!(in_send_window(at(6, 0, 0)));
        assert!(in_send_window(at(15, 59, 59)));
        assert!(!in_send_window(at(16, 0, 0)));
    }

    #[test]
    fn next_window_start_rolls_to_the_next_morning() {
        assert_eq!(next_window_start(at(3, 0, 0)), at(6, 0, 0));
        assert_eq!(next_window_start(at(10, 0, 0)), at(10, 0, 0));
        let tomorrow = Utc
            .with_ymd_and_hms(2026, 10, 30, 6, 0, 0)
            .single()
            .expect("time");
        assert_eq!(next_window_start(at(16, 0, 0)), tomorrow);
        assert_eq!(
            sast_day_start(at(10, 0, 0)),
            Utc.with_ymd_and_hms(2026, 10, 28, 22, 0, 0)
                .single()
                .expect("time")
        );
    }

    #[test]
    fn row_gap_is_a_few_minutes_and_stable() {
        for _ in 0..50 {
            let id = Uuid::new_v4();
            let gap = row_gap(&id);
            assert!(
                gap >= Duration::seconds(MIN_GAP_SECS) && gap <= Duration::seconds(MAX_GAP_SECS)
            );
            assert_eq!(gap, row_gap(&id));
        }
    }

    #[test]
    fn owner_send_now_skips_window_and_gap_but_not_the_cap() {
        // 03:00 UTC is 05:00 SAST, outside the window; the gap would not have passed either.
        assert_eq!(
            decide_owner_send_now(at(3, 0, 0), 0, 30),
            NewChatDecision::SendNow
        );
        assert!(matches!(
            decide_owner_send_now(at(3, 0, 0), 30, 30),
            NewChatDecision::CapReached { .. }
        ));
        assert!(matches!(
            decide_owner_send_now(at(3, 0, 0), 0, 0),
            NewChatDecision::CapReached { .. }
        ));
    }

    #[test]
    fn pacing_waits_for_the_window_and_the_gap() {
        let gap = Duration::seconds(240);
        assert_eq!(
            decide_new_chat(at(10, 0, 0), None, 0, 30, gap),
            NewChatDecision::SendNow
        );
        assert_eq!(
            decide_new_chat(at(10, 1, 0), Some(at(10, 0, 0)), 1, 30, gap),
            NewChatDecision::WaitUntil(at(10, 4, 0))
        );
        assert_eq!(
            decide_new_chat(at(10, 4, 0), Some(at(10, 0, 0)), 1, 30, gap),
            NewChatDecision::SendNow
        );
        assert_eq!(
            decide_new_chat(at(3, 0, 0), None, 0, 30, gap),
            NewChatDecision::WaitUntil(at(6, 0, 0))
        );
    }

    #[test]
    fn cap_stops_sending_and_rolls_to_tomorrow() {
        let gap = Duration::seconds(240);
        let tomorrow = Utc
            .with_ymd_and_hms(2026, 10, 30, 6, 0, 0)
            .single()
            .expect("time");
        assert_eq!(
            decide_new_chat(at(10, 0, 0), None, 30, 30, gap),
            NewChatDecision::CapReached {
                resume_at: tomorrow
            }
        );
        assert_eq!(
            decide_new_chat(at(10, 0, 0), None, 29, 30, gap),
            NewChatDecision::SendNow
        );
        // The owner raising the cap takes effect on the next decision.
        assert_eq!(
            decide_new_chat(at(10, 0, 0), None, 30, 50, gap),
            NewChatDecision::SendNow
        );
        // A cap of zero stops everything.
        assert!(matches!(
            decide_new_chat(at(10, 0, 0), None, 0, 0, gap),
            NewChatDecision::CapReached { .. }
        ));
    }

    #[test]
    fn default_titles_come_from_the_first_words_of_the_body() {
        assert_eq!(
            default_template_title(
                "hl_vb",
                "Hi {{1}}, it is Sam from Horizon Labs. Got a minute?"
            ),
            "Hi it is Sam from Horizon"
        );
        assert_eq!(default_template_title("hl_vb", "{{1}}"), "hl vb");
        assert_eq!(default_template_title("follow_up", ""), "follow up");
        let long = "word ".repeat(100);
        assert!(default_template_title("x", &long).chars().count() <= MAX_TITLE_CHARS);
        assert_eq!(
            clean_title("  Voice   note offer "),
            Some("Voice note offer".to_string())
        );
        assert_eq!(clean_title("   "), None);
        assert_eq!(
            clean_title(&"a".repeat(500)).map(|t| t.chars().count()),
            Some(MAX_TITLE_CHARS)
        );
    }

    #[test]
    fn templates_render_their_slots() {
        let body = "Hi {{1}}, it is {{2}} from Horizon. {{1}}, got a minute?";
        assert_eq!(template_slot_count(body), 2);
        let params = vec!["Thabo".to_string(), "Sam".to_string()];
        assert_eq!(
            render_template(body, &params).as_deref(),
            Ok("Hi Thabo, it is Sam from Horizon. Thabo, got a minute?")
        );
        assert!(render_template(body, &params[..1]).is_err());
        assert_eq!(
            render_template("No slots here", &[]).as_deref(),
            Ok("No slots here")
        );
        assert_eq!(template_slot_count("{{ 1 }} and {{x}} and {1}"), 0);
    }

    #[test]
    fn signature_must_match_the_raw_body() {
        let secret = b"test-app-secret-not-real";
        let body = br#"{"object":"whatsapp_business_account"}"#;
        let mut mac = HmacSha256::new_from_slice(secret).expect("key");
        mac.update(body);
        let good = format!("sha256={}", hex::encode(mac.finalize().into_bytes()));
        assert!(verify_signature(secret, body, Some(&good)));
        assert!(!verify_signature(secret, b"{}", Some(&good)));
        assert!(!verify_signature(b"other-secret", body, Some(&good)));
        assert!(!verify_signature(secret, body, None));
        assert!(!verify_signature(secret, body, Some("sha256=zz")));
        assert!(!verify_signature(
            secret,
            body,
            Some(&good.replace("sha256=", ""))
        ));
    }

    #[test]
    fn verify_token_compares_against_the_stored_hash() {
        let stored = hash_verify_token("verify-me");
        assert!(verify_token_matches("verify-me", &stored));
        assert!(!verify_token_matches("verify-you", &stored));
        assert!(!verify_token_matches("verify-me", &stored[..16]));
    }

    #[test]
    fn meta_codes_are_classified() {
        assert_eq!(classify_failure_code(190), FailureKind::TokenExpired);
        assert_eq!(classify_failure_code(131_049), FailureKind::ContactBlocked);
        assert_eq!(
            classify_failure_code(132_015),
            FailureKind::TemplateUnavailable
        );
        assert_eq!(
            classify_failure_code(131_031),
            FailureKind::NumberDisconnected
        );
        assert_eq!(classify_failure_code(131_026), FailureKind::Other);
    }
}
