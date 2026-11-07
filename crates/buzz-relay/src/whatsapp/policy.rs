//! Pure WhatsApp outreach rules: phone normalisation, the 24 hour window, stop words,
//! pacing inside the Africa/Johannesburg send window, template rendering and the webhook
//! signature check. No I/O, so every rule here has a plain unit test.

use buzz_core::whatsapp_stage::OptOutKind;
use chrono::{DateTime, Duration, Utc};
use hmac::{Hmac, KeyInit, Mac};
use serde_json::Value;
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

/// The name to show for a contact. A WhatsApp profile name with no letter or digit (a lone
/// ".", an emoji, punctuation) tells a person nothing, so it counts as no name and the number
/// is shown instead.
pub fn contact_label(display_name: &str, wa_id: &str) -> String {
    let name = display_name.trim();
    if name.chars().any(char::is_alphanumeric) {
        name.to_string()
    } else {
        e164(wa_id)
    }
}

/// How a conservative phrase rule may match a reply.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OptOutMatchMode {
    /// The complete reply must be the phrase. This protects an ambiguous bare word such as
    /// `stop` from matching a lead who says "don't stop now, call me".
    WholeReply,
    /// The phrase may appear as complete words inside a longer reply.
    Phrase,
}

/// One deterministic opt-out phrase. These are data, not an AI classification prompt.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OptOutRule {
    /// Stable audit id stored with an inbound opt-out.
    pub id: &'static str,
    /// ISO language code used for review and operator visibility.
    pub language: &'static str,
    /// The reviewed phrase, before Unicode-aware normalisation.
    pub phrase: &'static str,
    /// Existing semantic reason that older desktop stage parsing already understands.
    pub kind: OptOutKind,
    /// Whether the phrase must be the complete reply.
    pub mode: OptOutMatchMode,
}

/// A deterministic match, including the exact rule saved with the consent record.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct OptOutMatch {
    /// Existing semantic reason used by the stage projection.
    pub kind: OptOutKind,
    /// Stable data-table rule id.
    pub rule_id: &'static str,
    /// Language code of the matched phrase.
    pub language: &'static str,
}

const WHOLE: OptOutMatchMode = OptOutMatchMode::WholeReply;
const PHRASE: OptOutMatchMode = OptOutMatchMode::Phrase;

/// Conservative, reviewable opt-out phrase data. Afrikaans, Zulu and Xhosa entries are held to
/// clearly unambiguous phrases and require native-speaker review before a wider language rollout.
pub const OPT_OUT_RULES: &[OptOutRule] = &[
    OptOutRule {
        id: "en_stop",
        language: "en",
        phrase: "stop",
        kind: OptOutKind::Stop,
        mode: WHOLE,
    },
    OptOutRule {
        id: "en_stop_all",
        language: "en",
        phrase: "stop all",
        kind: OptOutKind::Stop,
        mode: PHRASE,
    },
    OptOutRule {
        id: "en_stop_messages",
        language: "en",
        phrase: "stop messages",
        kind: OptOutKind::Stop,
        mode: PHRASE,
    },
    OptOutRule {
        id: "en_stop_sending",
        language: "en",
        phrase: "stop sending",
        kind: OptOutKind::Stop,
        mode: PHRASE,
    },
    OptOutRule {
        id: "en_stop_contacting",
        language: "en",
        phrase: "stop contacting",
        kind: OptOutKind::Stop,
        mode: PHRASE,
    },
    OptOutRule {
        id: "en_stop_promotions",
        language: "en",
        phrase: "stop promotions",
        kind: OptOutKind::Stop,
        mode: PHRASE,
    },
    OptOutRule {
        id: "en_unsubscribe",
        language: "en",
        phrase: "unsubscribe",
        kind: OptOutKind::Stop,
        mode: PHRASE,
    },
    OptOutRule {
        id: "en_opt_out",
        language: "en",
        phrase: "opt out",
        kind: OptOutKind::Stop,
        mode: PHRASE,
    },
    OptOutRule {
        id: "en_optout",
        language: "en",
        phrase: "optout",
        kind: OptOutKind::Stop,
        mode: PHRASE,
    },
    OptOutRule {
        id: "en_remove_me",
        language: "en",
        phrase: "remove me",
        kind: OptOutKind::Stop,
        mode: PHRASE,
    },
    OptOutRule {
        id: "en_do_not_contact_me",
        language: "en",
        phrase: "do not contact me",
        kind: OptOutKind::Stop,
        mode: PHRASE,
    },
    OptOutRule {
        id: "en_dont_contact_me",
        language: "en",
        phrase: "don't contact me",
        kind: OptOutKind::Stop,
        mode: PHRASE,
    },
    OptOutRule {
        id: "en_no_thanks",
        language: "en",
        phrase: "no thanks",
        kind: OptOutKind::NoThanks,
        mode: PHRASE,
    },
    OptOutRule {
        id: "en_no_thank_you",
        language: "en",
        phrase: "no thank you",
        kind: OptOutKind::NoThanks,
        mode: PHRASE,
    },
    OptOutRule {
        id: "en_not_interested",
        language: "en",
        phrase: "not interested",
        kind: OptOutKind::NoThanks,
        mode: PHRASE,
    },
    OptOutRule {
        id: "af_stop_boodskappe",
        language: "af",
        phrase: "stop boodskappe",
        kind: OptOutKind::Stop,
        mode: PHRASE,
    },
    OptOutRule {
        id: "af_moenie_my_kontak_nie",
        language: "af",
        phrase: "moenie my kontak nie",
        kind: OptOutKind::Stop,
        mode: PHRASE,
    },
    OptOutRule {
        id: "af_moenie_vir_my_boodskappe_stuur_nie",
        language: "af",
        phrase: "moenie vir my boodskappe stuur nie",
        kind: OptOutKind::Stop,
        mode: PHRASE,
    },
    OptOutRule {
        id: "af_geen_dankie",
        language: "af",
        phrase: "geen dankie",
        kind: OptOutKind::NoThanks,
        mode: PHRASE,
    },
    OptOutRule {
        id: "af_nie_geinteresseerd_nie",
        language: "af",
        phrase: "nie geïnteresseerd nie",
        kind: OptOutKind::NoThanks,
        mode: PHRASE,
    },
    OptOutRule {
        id: "zu_yeka_imilayezo",
        language: "zu",
        phrase: "yeka imilayezo",
        kind: OptOutKind::Stop,
        mode: PHRASE,
    },
    OptOutRule {
        id: "zu_ungangithumeli_imilayezo",
        language: "zu",
        phrase: "ungangithumeli imilayezo",
        kind: OptOutKind::Stop,
        mode: PHRASE,
    },
    OptOutRule {
        id: "zu_ungangithinti",
        language: "zu",
        phrase: "ungangithinti",
        kind: OptOutKind::Stop,
        mode: PHRASE,
    },
    OptOutRule {
        id: "zu_cha_ngiyabonga",
        language: "zu",
        phrase: "cha ngiyabonga",
        kind: OptOutKind::NoThanks,
        mode: PHRASE,
    },
    OptOutRule {
        id: "zu_anginantshisekelo",
        language: "zu",
        phrase: "anginantshisekelo",
        kind: OptOutKind::NoThanks,
        mode: PHRASE,
    },
    OptOutRule {
        id: "xh_yeka_imiyalezo",
        language: "xh",
        phrase: "yeka imiyalezo",
        kind: OptOutKind::Stop,
        mode: PHRASE,
    },
    OptOutRule {
        id: "xh_ungandithumeli_imiyalezo",
        language: "xh",
        phrase: "ungandithumeli imiyalezo",
        kind: OptOutKind::Stop,
        mode: PHRASE,
    },
    OptOutRule {
        id: "xh_ungandiqhagamsheli",
        language: "xh",
        phrase: "ungandiqhagamsheli",
        kind: OptOutKind::Stop,
        mode: PHRASE,
    },
    OptOutRule {
        id: "xh_hayi_enkosi",
        language: "xh",
        phrase: "hayi enkosi",
        kind: OptOutKind::NoThanks,
        mode: PHRASE,
    },
    OptOutRule {
        id: "xh_andinamdla",
        language: "xh",
        phrase: "andinamdla",
        kind: OptOutKind::NoThanks,
        mode: PHRASE,
    },
];

fn normalise_opt_out_text(text: &str) -> String {
    let mut normalised = String::with_capacity(text.len());
    let mut previous_space = true;
    for lowered in text.chars().flat_map(char::to_lowercase) {
        if lowered.is_alphanumeric() {
            normalised.push(lowered);
            previous_space = false;
        } else if !previous_space {
            normalised.push(' ');
            previous_space = true;
        }
    }
    normalised.trim().to_string()
}

fn matches_opt_out_rule(normalised: &str, rule: &OptOutRule) -> bool {
    let phrase = normalise_opt_out_text(rule.phrase);
    match rule.mode {
        OptOutMatchMode::WholeReply => normalised == phrase,
        OptOutMatchMode::Phrase => {
            let haystack = format!(" {normalised} ");
            let needle = format!(" {phrase} ");
            haystack.contains(&needle)
        }
    }
}

/// Find the first deterministic opt-out rule for text or a quick-reply button. Rules are
/// ordered from precise stop requests through softer no-thanks answers, so the saved reason is
/// stable across relay restarts.
pub fn match_opt_out(text: &str) -> Option<OptOutMatch> {
    let normalised = normalise_opt_out_text(text);
    if normalised.is_empty() {
        return None;
    }
    OPT_OUT_RULES.iter().find_map(|rule| {
        matches_opt_out_rule(&normalised, rule).then_some(OptOutMatch {
            kind: rule.kind,
            rule_id: rule.id,
            language: rule.language,
        })
    })
}

/// `true` when `text` has a deterministic opt-out phrase.
pub fn is_stop_message(text: &str) -> bool {
    match_opt_out(text).is_some()
}

/// `true` when a button reply (for example a template's opt-out button) means opt out.
pub fn is_opt_out_button(title: &str) -> bool {
    match_opt_out(title).is_some()
}

/// Why an inbound message opts the contact out, or `None` when it does not. This compatibility
/// wrapper preserves the existing stage seam; callers that need the exact rule use
/// [`match_opt_out`].
pub fn classify_opt_out(text: &str, _is_button: bool) -> Option<OptOutKind> {
    match_opt_out(text).map(|matched| matched.kind)
}

/// `true` when an opt-out reply also contains a conservative complaint or legal-escalation
/// signal. This only raises owner attention; it never weakens the opt-out fence.
pub fn has_complaint_or_legal_signal(text: &str) -> bool {
    let normalised = normalise_opt_out_text(text);
    [
        "complaint",
        "lawyer",
        "attorney",
        "legal action",
        "sue",
        "court",
        "popia",
        "klagte",
        "prokureur",
        "regstappe",
        "ummeli",
    ]
    .iter()
    .any(|phrase| {
        let haystack = format!(" {normalised} ");
        let needle = format!(" {} ", normalise_opt_out_text(phrase));
        haystack.contains(&needle)
    })
}

fn normalise_reply(text: &str) -> String {
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// `true` when an inbound button tap is the positive answer ("Yes, call me"): the tap matches
/// the FIRST quick-reply button of the template that was answered. `buttons` is the stored
/// `[{type, text}]` of that template; `None` means the template is unknown, and only then do
/// the literal texts "Yes, call me" and "Yes, tell me more" count. A first button that is an
/// opt-out button is never positive.
pub fn is_wants_call_tap(buttons: Option<&Value>, reply: &str) -> bool {
    let reply = normalise_reply(reply);
    if reply.is_empty() {
        return false;
    }
    let Some(buttons) = buttons else {
        return matches!(reply.as_str(), "yes, call me" | "yes, tell me more");
    };
    let first = buttons
        .as_array()
        .into_iter()
        .flatten()
        .find(|button| {
            button
                .get("type")
                .and_then(Value::as_str)
                .is_some_and(|kind| kind.eq_ignore_ascii_case("QUICK_REPLY"))
        })
        .and_then(|button| button.get("text").and_then(Value::as_str));
    match first {
        Some(text) => !is_opt_out_button(text) && normalise_reply(text) == reply,
        None => matches!(reply.as_str(), "yes, call me" | "yes, tell me more"),
    }
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
    if sent_today >= i64::from(cap) {
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

/// An account-wide Meta failure that can be recovered only by putting the same failed rows back
/// into the normal queue.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AccountRetryFailure {
    /// `131042`: the WhatsApp Business Account payment method needs attention.
    Payment,
    /// `131031`: the WhatsApp Business Account is restricted or disabled.
    Restricted,
    /// `130429`: the sender reached Meta's account throughput limit.
    Throughput,
    /// `131048`: Meta applied a messaging or quality restriction to the sender.
    SpamLimit,
    /// `133010`: the connected sender phone number is not registered.
    PhoneNotRegistered,
    /// `133005`: the connected sender needs the correct two-step verification PIN.
    TwoStepVerification,
}

impl AccountRetryFailure {
    /// The documented Cloud API code that identifies this account-level refusal.
    pub const fn code(self) -> i64 {
        match self {
            Self::Payment => 131_042,
            Self::Restricted => 131_031,
            Self::Throughput => 130_429,
            Self::SpamLimit => 131_048,
            Self::PhoneNotRegistered => 133_010,
            Self::TwoStepVerification => 133_005,
        }
    }

    /// Plain recovery copy for a failed-message chip. It deliberately names the owner action
    /// rather than presenting Meta's raw error title as a diagnosis.
    pub const fn summary(self) -> &'static str {
        match self {
            Self::Payment => {
                "Meta blocked this send: payment problem on your WhatsApp account. Fix it in Meta Business Suite, WhatsApp Manager, Payment settings, then send again."
            }
            Self::Restricted => {
                "Meta blocked this send: your WhatsApp Business account is restricted or disabled. Resolve Meta's account review, then send again."
            }
            Self::Throughput => {
                "Meta stopped this send: your WhatsApp account reached its throughput limit. Wait for Meta's limit to recover, then send again."
            }
            Self::SpamLimit => {
                "Meta blocked this send: your WhatsApp sender has a messaging restriction. Resolve it in WhatsApp Manager, then send again."
            }
            Self::PhoneNotRegistered => {
                "Meta blocked this send: the connected WhatsApp phone number is not registered. Reconnect the sender number, then send again."
            }
            Self::TwoStepVerification => {
                "Meta blocked this send: the WhatsApp phone number needs its correct two-step verification PIN. Repair it in WhatsApp Manager, then send again."
            }
        }
    }

    /// A short, action-oriented title for the health notice.
    pub const fn health_title(self) -> &'static str {
        match self {
            Self::Payment => {
                "Meta says there is a payment problem on your WhatsApp Business account."
            }
            Self::Restricted => "Meta says your WhatsApp Business account is locked or restricted.",
            Self::Throughput => {
                "Meta says your WhatsApp account reached its sending throughput limit."
            }
            Self::SpamLimit => "Meta says your WhatsApp sender reached a messaging limit.",
            Self::PhoneNotRegistered => {
                "Meta says the connected WhatsApp phone number is not registered."
            }
            Self::TwoStepVerification => {
                "Meta says the connected WhatsApp phone number needs its two-step verification PIN."
            }
        }
    }

    /// Concrete, vendor-owned recovery steps. These are kept with the code table so the sender,
    /// banner and message chip cannot drift into different diagnoses.
    pub const fn fix_steps(self) -> &'static [&'static str] {
        match self {
            Self::Payment => &[
                "Open Meta Business Suite.",
                "Open WhatsApp Manager, then Payment settings.",
                "Add or repair the payment method on this WhatsApp Business Account.",
            ],
            Self::Restricted => &[
                "Open Meta Business Suite and WhatsApp Manager.",
                "Review the account restriction and complete Meta's required review or verification.",
                "When Meta restores the account, return here and press Resume and retry.",
            ],
            Self::Throughput => &[
                "Open WhatsApp Manager and review the phone number's messaging limits.",
                "Wait for Meta's throughput limit to recover before retrying.",
                "Press Resume and retry when the limit has recovered.",
            ],
            Self::SpamLimit => &[
                "Open WhatsApp Manager and review the phone number's quality and messaging limits.",
                "Resolve the restriction or wait for Meta to lift it.",
                "Press Resume and retry only after Meta allows business sends again.",
            ],
            Self::PhoneNotRegistered => &[
                "Open WhatsApp Manager and check the connected phone number.",
                "Register or reconnect that number to this WhatsApp Business Account.",
                "Press Resume and retry after Meta shows the number as connected.",
            ],
            Self::TwoStepVerification => &[
                "Open WhatsApp Manager and select the connected phone number.",
                "Enter or reset its two-step verification PIN.",
                "Press Resume and retry after the number is available again.",
            ],
        }
    }

    /// The nearest Meta-owned page for this recovery path. It is a convenience link only: Meta
    /// can still ask the owner to navigate to a different subpage for their account.
    pub const fn fix_url(self) -> &'static str {
        match self {
            Self::Payment => {
                "https://business.facebook.com/latest/whatsapp_manager/payment_settings"
            }
            Self::Restricted | Self::Throughput | Self::SpamLimit => {
                "https://business.facebook.com/latest/whatsapp_manager/phone_numbers"
            }
            Self::PhoneNotRegistered | Self::TwoStepVerification => {
                "https://business.facebook.com/latest/whatsapp_manager/phone_numbers"
            }
        }
    }

    /// The top-of-Outreach recovery notice. The count covers eligible failed account rows and
    /// untouched ready work behind the account-health fence, never unrelated historical failures.
    pub fn health_banner(self, waiting: i64) -> String {
        format!(
            "WhatsApp stopped sending. {} Nothing was lost: {waiting} messages are waiting. Fix it in Meta, then press Resume and retry.",
            self.health_title()
        )
    }
}

/// The one authoritative decision table for every Cloud API code Outreach acts on. It drives
/// the sender, recovery controls and person-facing explanation so a code cannot accidentally
/// pause one scope while being retried from another.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MetaFailure {
    /// The WhatsApp business account or sender number blocks the whole queue.
    Account(AccountRetryFailure),
    /// `131049`: Meta refused a marketing template for this recipient's engagement limits.
    ContactEngagementLimit,
    /// A recipient-specific refusal that must keep this contact paused.
    ContactBlocked,
    /// This number cannot receive WhatsApp messages.
    ContactUnavailable,
    /// A free-form reply is outside the customer service window.
    ReplyWindowClosed,
    /// A pair-specific rate limit, not an account-level one.
    PairRateLimit,
    /// A definite temporary refusal for this message only.
    Temporary,
    /// The connection's token needs attention.
    TokenExpired,
    /// The chosen template needs attention.
    TemplateUnavailable,
    /// No documented product handling exists for this code.
    Other,
}

/// The exact Cloud API codes which Outreach currently acts on. Keep every classification in
/// this function: callers must not duplicate a code list with a subtly different queue scope.
pub const fn meta_failure_for_code(code: i64) -> MetaFailure {
    match code {
        131_042 => MetaFailure::Account(AccountRetryFailure::Payment),
        131_031 => MetaFailure::Account(AccountRetryFailure::Restricted),
        130_429 => MetaFailure::Account(AccountRetryFailure::Throughput),
        131_048 => MetaFailure::Account(AccountRetryFailure::SpamLimit),
        133_010 => MetaFailure::Account(AccountRetryFailure::PhoneNotRegistered),
        133_005 => MetaFailure::Account(AccountRetryFailure::TwoStepVerification),
        131_049 => MetaFailure::ContactEngagementLimit,
        131_026 => MetaFailure::ContactUnavailable,
        131_047 => MetaFailure::ReplyWindowClosed,
        131_056 => MetaFailure::PairRateLimit,
        133_004 => MetaFailure::Temporary,
        190 | 102 | 10 | 200 => MetaFailure::TokenExpired,
        132_015 | 132_016 | 132_001 | 132_007 => MetaFailure::TemplateUnavailable,
        368 | 130_472 => MetaFailure::ContactBlocked,
        _ => MetaFailure::Other,
    }
}

/// Read an account-level recovery cause from a stored code.
pub fn account_failure_for_code(code: Option<&str>) -> Option<AccountRetryFailure> {
    let code = code?.trim().parse::<i64>().ok()?;
    match meta_failure_for_code(code) {
        MetaFailure::Account(failure) => Some(failure),
        _ => None,
    }
}

/// `true` only for Meta's documented recipient engagement refusal.
pub fn is_contact_engagement_limit(code: Option<&str>) -> bool {
    matches!(
        code.and_then(|value| value.trim().parse::<i64>().ok())
            .map(meta_failure_for_code),
        Some(MetaFailure::ContactEngagementLimit)
    )
}

/// The only failed sends that a person can retry from Outreach. Account failures retry the
/// affected queue together; documented temporary failures retry one row. All other failures are
/// deliberately excluded.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FailureRetryScope {
    /// The account prevented business-initiated sends.
    Account(AccountRetryFailure),
    /// A definite, documented temporary refusal for one row.
    Temporary,
    /// Never retry this row from the recovery UI.
    Never,
}

impl FailureRetryScope {
    /// Wire value consumed by the desktop. `None` prevents an older or unknown error from
    /// gaining a retry button.
    pub const fn wire(self) -> Option<&'static str> {
        match self {
            Self::Account(_) => Some("account"),
            Self::Temporary => Some("temporary"),
            Self::Never => None,
        }
    }
}

/// Classify a stored Meta code for recovery. Recipient-only errors such as `131026` never enter
/// the account queue.
pub fn retry_scope_for_error_code(code: Option<&str>) -> FailureRetryScope {
    let Some(code) = code.and_then(|value| value.trim().parse::<i64>().ok()) else {
        return FailureRetryScope::Never;
    };
    match meta_failure_for_code(code) {
        MetaFailure::Account(failure) => FailureRetryScope::Account(failure),
        MetaFailure::PairRateLimit | MetaFailure::Temporary => FailureRetryScope::Temporary,
        _ => FailureRetryScope::Never,
    }
}

/// The stored error-code values which the owner-wide recovery action may requeue. The database
/// accepts this list as data, never user input, so the action cannot accidentally retry a
/// recipient refusal.
pub fn account_retry_error_codes() -> Vec<String> {
    [
        AccountRetryFailure::Payment,
        AccountRetryFailure::Restricted,
        AccountRetryFailure::Throughput,
        AccountRetryFailure::SpamLimit,
        AccountRetryFailure::PhoneNotRegistered,
        AccountRetryFailure::TwoStepVerification,
    ]
    .into_iter()
    .map(|failure| failure.code().to_string())
    .collect()
}

/// Plain owner-facing explanation for a failed message. `None` leaves an unknown code's stored
/// Graph title visible rather than inventing a recovery instruction.
pub fn failure_summary_for_code(code: Option<&str>) -> Option<&'static str> {
    let parsed = code.and_then(|value| value.trim().parse::<i64>().ok())?;
    match meta_failure_for_code(parsed) {
        MetaFailure::Account(failure) => Some(failure.summary()),
        MetaFailure::ContactEngagementLimit => Some(
            "Meta did not deliver this one. Meta limits marketing messages to people who have not been engaging with businesses. You were not charged. Try again in a few days or reach them another way.",
        ),
        MetaFailure::PairRateLimit => {
            Some("Meta delayed this send: this phone number was contacted too recently. Try sending again later.")
        }
        MetaFailure::Temporary => {
            Some("Meta did not finish this send: its service is temporarily unavailable. Try sending again later.")
        }
        MetaFailure::ContactUnavailable => {
            Some("Meta did not deliver this one: this number is not available on WhatsApp.")
        }
        MetaFailure::ReplyWindowClosed => Some(
            "Meta blocked this send: the 24-hour reply window has closed. Use an approved template.",
        ),
        MetaFailure::TemplateUnavailable => Some(
            "Meta blocked this send: the WhatsApp template is paused, disabled or unavailable.",
        ),
        MetaFailure::TokenExpired => {
            Some("Meta blocked this send: the WhatsApp access token needs to be reconnected.")
        }
        MetaFailure::ContactBlocked => {
            Some("Meta did not deliver this one: this contact is blocked or limited by Meta.")
        }
        MetaFailure::Other => None,
    }
}

/// True only for a definite failure that the recovery UI may safely offer to retry.
pub fn failure_can_retry(code: Option<&str>) -> bool {
    !matches!(retry_scope_for_error_code(code), FailureRetryScope::Never)
}

/// What the sender does after persisting a Meta refusal. This is derived from the one code
/// table above; the account branch is persisted atomically with the failed send before the
/// sender decides whether to continue its pass.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FailureKind {
    /// The connection is unhealthy and the remaining queue must stay untouched.
    Account(AccountRetryFailure),
    /// Access token expired or revoked.
    TokenExpired,
    /// Meta blocked or limited this one contact.
    ContactBlocked,
    /// The template is paused, disabled or rejected.
    TemplateUnavailable,
    /// Anything else.
    Other,
}

/// Sender action derived from the authoritative code table.
pub const fn classify_failure_code(code: i64) -> FailureKind {
    match meta_failure_for_code(code) {
        MetaFailure::Account(failure) => FailureKind::Account(failure),
        MetaFailure::TokenExpired => FailureKind::TokenExpired,
        MetaFailure::ContactEngagementLimit
        | MetaFailure::ContactBlocked
        | MetaFailure::ContactUnavailable => FailureKind::ContactBlocked,
        MetaFailure::TemplateUnavailable => FailureKind::TemplateUnavailable,
        MetaFailure::ReplyWindowClosed
        | MetaFailure::PairRateLimit
        | MetaFailure::Temporary
        | MetaFailure::Other => FailureKind::Other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn payment_failures_are_not_generic_retries() {
        assert!(
            matches!(
                retry_scope_for_error_code(Some("131042")),
                FailureRetryScope::Account(AccountRetryFailure::Payment)
            ),
            "a Meta payment failure needs a deliberate recovery scope"
        );
    }

    #[test]
    fn retry_scope_only_includes_documented_account_and_temporary_refusals() {
        assert_eq!(
            retry_scope_for_error_code(Some("131042")),
            FailureRetryScope::Account(AccountRetryFailure::Payment)
        );
        assert_eq!(
            retry_scope_for_error_code(Some("131056")),
            FailureRetryScope::Temporary
        );
        assert_eq!(
            retry_scope_for_error_code(Some("131026")),
            FailureRetryScope::Never,
            "not-on-WhatsApp is a recipient failure, never a queue retry"
        );
        assert_eq!(
            retry_scope_for_error_code(Some("131047")),
            FailureRetryScope::Never,
            "a closed reply window needs a different message type"
        );
        assert_eq!(
            retry_scope_for_error_code(Some("131049")),
            FailureRetryScope::Never,
            "Meta engagement limits apply to one contact, never the account queue"
        );
        assert!(!failure_can_retry(Some("131026")));
        assert!(!failure_can_retry(Some("131049")));
        assert!(failure_can_retry(Some("131042")));
        assert!(account_retry_error_codes().contains(&"131042".to_string()));
        assert!(!account_retry_error_codes().contains(&"131026".to_string()));
    }

    fn at(h: u32, m: u32, s: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 10, 29, h, m, s)
            .single()
            .expect("test time")
    }

    #[test]
    fn no_thanks_and_stop_are_different_opt_outs() {
        // GUARD: both block sending, the stored reason tells them apart.
        use OptOutKind::{NoThanks, Stop};
        assert_eq!(classify_opt_out("No thanks", true), Some(NoThanks));
        assert_eq!(classify_opt_out("no thanks", false), Some(NoThanks));
        assert_eq!(classify_opt_out("Not interested.", false), Some(NoThanks));
        assert_eq!(classify_opt_out("Stop messages", true), Some(Stop));
        assert_eq!(classify_opt_out("STOP", false), Some(Stop));
        assert_eq!(classify_opt_out("unsubscribe", false), Some(Stop));
        assert_eq!(classify_opt_out("Stop promotions", true), Some(Stop));
        assert_eq!(classify_opt_out("Yes, call me", true), None);
        assert_eq!(classify_opt_out("stop by at 5", false), None);
        assert_eq!(
            classify_opt_out("No thanks, maybe later", false),
            Some(NoThanks)
        );
    }

    #[test]
    fn every_opt_out_rule_matches_and_records_its_exact_id() {
        // GUARD: the data table is the production classifier. Deleting or changing any rule
        // makes this test name the missing rule instead of passing through a test-only helper.
        for rule in OPT_OUT_RULES {
            let reply = match rule.mode {
                OptOutMatchMode::WholeReply => rule.phrase.to_string(),
                OptOutMatchMode::Phrase => format!("Hello, {}, please.", rule.phrase),
            };
            let matched = match_opt_out(&reply).unwrap_or_else(|| {
                panic!("rule {} did not match {reply:?}", rule.id);
            });
            assert_eq!(matched.rule_id, rule.id, "{reply:?}");
            assert_eq!(matched.language, rule.language, "{reply:?}");
            assert_eq!(matched.kind, rule.kind, "{reply:?}");
        }
    }

    #[test]
    fn opt_out_false_positives_do_not_match() {
        for reply in [
            "don't stop now, call me",
            "please don't stop now",
            "stop by at 5",
            "thanks, that is interesting",
            "please call me tomorrow",
        ] {
            assert_eq!(match_opt_out(reply), None, "{reply:?}");
        }
    }

    #[test]
    fn complaint_or_legal_signal_escalates_without_weakening_the_opt_out() {
        let reply = "Stop messages. My lawyer will contact you.";
        assert!(match_opt_out(reply).is_some());
        assert!(has_complaint_or_legal_signal(reply));
        assert!(!has_complaint_or_legal_signal(
            "No thanks, please remove me."
        ));
    }

    #[test]
    fn the_first_quick_reply_button_is_the_positive_answer() {
        let template = serde_json::json!([
            {"type": "URL", "text": "Open site"},
            {"type": "QUICK_REPLY", "text": "Yes, tell me more"},
            {"type": "QUICK_REPLY", "text": "No thanks"},
        ]);
        assert!(is_wants_call_tap(Some(&template), "Yes, tell me more"));
        assert!(is_wants_call_tap(Some(&template), "  yes,  TELL me more "));
        assert!(!is_wants_call_tap(Some(&template), "No thanks"));
        // Read from the template, not from fixed text: a different first button counts.
        let other = serde_json::json!([{"type": "QUICK_REPLY", "text": "Send me a quote"}]);
        assert!(is_wants_call_tap(Some(&other), "Send me a quote"));
        assert!(!is_wants_call_tap(Some(&other), "Yes, call me"));
        // Unknown template: literal fallback only.
        assert!(is_wants_call_tap(None, "Yes, call me"));
        assert!(is_wants_call_tap(None, "Yes, tell me more"));
        assert!(!is_wants_call_tap(None, "Send me a quote"));
        // A first button that opts out is never positive.
        let negative_first = serde_json::json!([{"type": "QUICK_REPLY", "text": "Stop messages"}]);
        assert!(!is_wants_call_tap(Some(&negative_first), "Stop messages"));
        assert!(!is_wants_call_tap(Some(&other), ""));
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
    fn a_profile_name_without_a_letter_or_digit_shows_the_number() {
        // GUARD: a WhatsApp profile name of "." must not become the contact's name.
        for blank in ["", "   ", ".", " . ", "...", "\u{1F44D}", "-_-"] {
            assert_eq!(
                contact_label(blank, "27821234567"),
                "+27821234567",
                "{blank:?}"
            );
        }
        assert_eq!(contact_label("Thabo", "27821234567"), "Thabo");
        assert_eq!(contact_label("  Thabo M. ", "27821234567"), "Thabo M.");
        assert_eq!(contact_label("007", "27821234567"), "007");
        assert_eq!(contact_label("Zoë", "27821234567"), "Zoë");
    }

    #[test]
    fn stop_words_match_safe_phrases_inside_a_longer_reply() {
        for yes in [
            "stop",
            "STOP",
            " Stop. ",
            "Unsubscribe!",
            "no thanks",
            "No  thanks.",
            "not interested",
            "Opt out",
            "Please unsubscribe me from all messages",
            "Please stop sending me messages",
            "Hello, moenie my kontak nie, dankie",
            "Ungangithumeli imilayezo again",
            "Hayi enkosi, yeka imiyalezo",
        ] {
            assert!(is_stop_message(yes), "{yes:?}");
        }
        for no in [
            "stop by tomorrow",
            "please don't stop now",
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
        assert_ne!(
            classify_failure_code(131_048),
            FailureKind::ContactBlocked,
            "a sender messaging limit is account-level, never a contact pause"
        );
        assert_eq!(
            failure_summary_for_code(Some("131049")),
            Some(
                "Meta did not deliver this one. Meta limits marketing messages to people who have not been engaging with businesses. You were not charged. Try again in a few days or reach them another way."
            )
        );
        assert_eq!(
            classify_failure_code(132_015),
            FailureKind::TemplateUnavailable
        );
        assert_eq!(
            classify_failure_code(131_031),
            FailureKind::Account(AccountRetryFailure::Restricted)
        );
        assert_eq!(classify_failure_code(131_026), FailureKind::ContactBlocked);
    }
}
