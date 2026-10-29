//! A provider's error message, made safe for the relay log.
//!
//! The status of a refusal does not say why a model refused: a 403 can be a
//! moderation hit, a model offered only to some clients, or a policy. OpenRouter
//! puts the reason in `error.message`. This reads that one field out of the
//! already bounded error body, removes anything that looks like a key or a
//! token, and cuts the rest short. Nothing else from the body, and no header,
//! ever reaches the log.

use serde_json::Value;

/// Longest message that is logged, in characters.
const MAX_CHARS: usize = 160;
const REMOVED: &str = "[removed]";

/// Starts of well-known key and token formats. Whatever follows the start, up to
/// the next space or quote, is the secret. Applied to runs of at least
/// `MIN_PREFIXED` characters so a short word that happens to begin this way is
/// kept.
const SECRET_PREFIXES: [&str; 13] = [
    "sk-",
    "sk_",
    "pk_",
    "rk_",
    "or-v1-",
    "key-",
    "ghp_",
    "gho_",
    "ghs_",
    "github_pat_",
    "xox",
    "akia",
    "eyj",
];
const MIN_PREFIXED: usize = 10;

/// `label=value` pairs (a query string, a header dump) whose value is removed.
const SECRET_LABELS: [&str; 9] = [
    "key",
    "api_key",
    "apikey",
    "api-key",
    "token",
    "access_token",
    "secret",
    "password",
    "authorization",
];

/// The provider's reason for refusing, from the start of its error body, ready
/// to log: one line, no key or token, at most `MAX_CHARS` characters. Empty when
/// the body is not JSON or has no message.
pub(super) fn upstream_message(body: &[u8]) -> String {
    let Ok(value) = serde_json::from_slice::<Value>(body) else {
        return String::new();
    };
    let message = match &value["error"] {
        Value::String(text) => text.as_str(),
        error => error["message"].as_str().unwrap_or_default(),
    };
    clean(message)
}

fn clean(message: &str) -> String {
    let one_line = message
        .chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    // Remove before cutting, so a key cannot be left half shown at the cut.
    cut(&remove_secrets(&one_line))
}

/// A character that can be part of a key, a token or a model id.
fn is_token_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '+' | '/' | ':' | '=' | '~')
}

fn remove_secrets(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut after_bearer = false;
    let mut start = 0;
    let mut in_run = None;
    let mut pieces = Vec::new();
    for (index, c) in text.char_indices() {
        let token = is_token_char(c);
        match in_run {
            Some(current) if current == token => {}
            Some(current) => {
                pieces.push((current, &text[start..index]));
                start = index;
                in_run = Some(token);
            }
            None => in_run = Some(token),
        }
    }
    if let Some(current) = in_run {
        pieces.push((current, &text[start..]));
    }
    for (is_run, piece) in pieces {
        if !is_run {
            out.push_str(piece);
            continue;
        }
        if after_bearer || looks_like_a_secret(piece) {
            out.push_str(REMOVED);
        } else {
            out.push_str(piece);
        }
        after_bearer = piece
            .trim_matches(|c: char| !c.is_ascii_alphanumeric())
            .eq_ignore_ascii_case("bearer");
    }
    out
}

fn looks_like_a_secret(run: &str) -> bool {
    let lower = run
        .trim_matches(|c: char| !c.is_ascii_alphanumeric())
        .to_ascii_lowercase();
    if lower.len() >= MIN_PREFIXED
        && SECRET_PREFIXES
            .iter()
            .any(|prefix| lower.starts_with(prefix))
    {
        return true;
    }
    if let Some((label, value)) = lower.split_once('=') {
        if !value.is_empty() && SECRET_LABELS.contains(&label) {
            return true;
        }
    }
    // Random-looking material: a long piece with a digit in it, or a very long
    // one. Model ids and ordinary words are made of short pieces.
    run.split(|c: char| !c.is_ascii_alphanumeric())
        .any(|piece| {
            piece.len() >= 32 || (piece.len() >= 16 && piece.bytes().any(|b| b.is_ascii_digit()))
        })
}

fn cut(text: &str) -> String {
    if text.chars().count() <= MAX_CHARS {
        return text.to_owned();
    }
    let kept: String = text.chars().take(MAX_CHARS - 3).collect();
    format!("{kept}...")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn message(text: &str) -> String {
        upstream_message(json!({"error":{"message":text}}).to_string().as_bytes())
    }

    /// Built here so the source holds no key-shaped literal.
    fn fake_key() -> String {
        format!("sk-or-v1-{}", "0a1b2c3d".repeat(8))
    }

    #[test]
    fn the_reason_is_read_from_the_error_message_and_nothing_else() {
        assert_eq!(
            upstream_message(
                br#"{"error":{"message":"only available on agentic harnesses","code":403,"metadata":{"raw":"RAW-TEXT","provider_name":"Acme"}}}"#
            ),
            "only available on agentic harnesses"
        );
        assert_eq!(upstream_message(br#"{"error":"slow down"}"#), "slow down");
        let none: [&[u8]; 7] = [
            b"",
            b"not json at all",
            b"<html>502 Bad Gateway</html>",
            br#"{"error":{"code":403}}"#,
            br#"{"error":{"message":403}}"#,
            br#"{"message":"top level is not OpenRouter's shape"}"#,
            // A body cut at the read limit is not JSON.
            br#"{"error":{"message":"cut off mid"#,
        ];
        for none in none {
            assert_eq!(
                upstream_message(none),
                "",
                "{}",
                String::from_utf8_lossy(none)
            );
        }
    }

    #[test]
    fn a_plain_reason_keeps_its_model_ids_and_ordinary_ids() {
        for text in [
            "thinkingmachines/inkling:free is only available on agentic harnesses",
            "nvidia/nemotron-3-ultra-550b-a55b:free is temporarily rate-limited upstream. Please retry shortly",
            "google/gemma-4-31b-it:free is not a valid model ID",
            "Request 550e8400-e29b-41d4-a716-446655440000 was refused",
            "No endpoints found for poolside/laguna-xs-2.1:free.",
            "Rate limit exceeded: free-models-per-day",
        ] {
            assert_eq!(message(text), text);
        }
    }

    #[test]
    fn keys_and_tokens_are_removed_wherever_they_sit() {
        let key = fake_key();
        let hex = "9f8e7d6c5b4a39281706f5e4d3c2b1a0".repeat(2);
        let jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r";
        for (text, secret) in [
            (format!("Invalid key {key} for this route"), key.clone()),
            (format!("Authorization failed for ({key})"), key.clone()),
            (format!("bad header \"Bearer {hex}\""), hex.clone()),
            ("Bearer abcdef rejected".to_owned(), "abcdef".to_owned()),
            (format!("token {jwt} expired"), jwt.to_owned()),
            (
                format!("see https://x.example/v1?api_key={hex}&a=1"),
                hex.clone(),
            ),
            ("password=hunter2 was sent".to_owned(), "hunter2".to_owned()),
            (
                format!("sent {}", "ghp_".to_owned() + &"A1b2C3d4".repeat(5)),
                "A1b2C3d4".to_owned(),
            ),
            (format!("id {}", "x9".repeat(20)), "x9x9x9x9".to_owned()),
        ] {
            let got = message(&text);
            assert!(!got.contains(&secret), "{secret} survived in {got}");
            assert!(got.contains(REMOVED), "{text} -> {got}");
        }
        // The words around a removed key stay, so the reason still reads.
        assert_eq!(
            message(&format!("Invalid key {key} for this route")),
            "Invalid key [removed] for this route"
        );
    }

    #[test]
    fn the_message_is_cut_to_160_characters() {
        let long = "refused because of a reason ".repeat(20);
        let got = message(&long);
        assert_eq!(got.chars().count(), MAX_CHARS, "{got}");
        assert!(got.ends_with("..."));
        assert!(got.starts_with("refused because of a reason refused"));
        // At the limit nothing is cut; one over is.
        let exact = format!("{}a", "ab ".repeat(53));
        assert_eq!(exact.chars().count(), MAX_CHARS);
        assert_eq!(message(&exact), exact);
        let over = format!("{}ab", "ab ".repeat(53));
        assert_eq!(over.chars().count(), MAX_CHARS + 1);
        assert_eq!(message(&over).chars().count(), MAX_CHARS);
        // Cut on a character, never inside one.
        let wide = "é".repeat(MAX_CHARS * 2);
        assert_eq!(message(&wide).chars().count(), MAX_CHARS);
    }

    #[test]
    fn a_key_at_the_cut_is_removed_whole_not_left_half_shown() {
        let key = fake_key();
        // The key starts 150 characters in, so the cut falls inside it.
        let text = format!("{} {key} and more", "word ".repeat(30));
        let got = message(&text);
        assert!(got.chars().count() <= MAX_CHARS, "{got}");
        assert!(!got.contains("sk-or"), "{got}");
        assert!(!got.contains(&key[..14]), "{got}");
    }

    #[test]
    fn the_message_is_one_line_without_control_characters() {
        let got = message("first\nsecond\r\n\tthird\u{0}fourth\u{1b}[31m");
        assert_eq!(got, "first second third fourth [31m");
        assert!(!got.chars().any(char::is_control));
    }
}
