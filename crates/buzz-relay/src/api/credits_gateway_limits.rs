//! Server-only gateway limits: free-AI accounts and the global daily spend cap.
//! Read once from relay configuration; clients can neither read nor change them.

use buzz_db::credits_gateway::{GatewayPolicy, DEFAULT_FREE_AI_MAX_IN_FLIGHT};

const MAX_FREE_ACCOUNTS: usize = 64;
const MAX_FREE_IN_FLIGHT: i64 = 256;

/// Build the policy from the process environment.
pub(super) fn policy_from_env() -> GatewayPolicy {
    policy_from_lookup(|key| std::env::var(key).ok())
}

/// `COLONY_FREE_AI_ACCOUNTS`: comma-separated account emails that use the
/// gateway without credits. `COLONY_FREE_AI_MAX_IN_FLIGHT`: their unresolved
/// request ceiling (1 to 256, default 32). `COLONY_CREDITS_GLOBAL_DAILY_CAP_NANOUSD`:
/// total gateway spend per UTC day; unset means no ceiling. A set but invalid
/// ceiling fails closed (refuses all new inference) so a typo can never
/// silently lift the only runaway guard.
pub(super) fn policy_from_lookup(lookup: impl Fn(&str) -> Option<String>) -> GatewayPolicy {
    GatewayPolicy {
        free_ai_accounts: parse_accounts(lookup("COLONY_FREE_AI_ACCOUNTS")),
        free_ai_max_in_flight: parse_in_flight(lookup("COLONY_FREE_AI_MAX_IN_FLIGHT")),
        global_daily_cap_nanousd: parse_cap(lookup("COLONY_CREDITS_GLOBAL_DAILY_CAP_NANOUSD")),
    }
}

fn parse_accounts(raw: Option<String>) -> Vec<String> {
    let mut accounts: Vec<String> = Vec::new();
    for item in raw.unwrap_or_default().split(',') {
        let email = item.trim().to_ascii_lowercase();
        if email.is_empty() || accounts.contains(&email) {
            continue;
        }
        if !email.contains('@') || email.len() > 254 {
            // Never log the value: it may be a mistyped address.
            tracing::error!("COLONY_FREE_AI_ACCOUNTS entry ignored: not an email address");
            continue;
        }
        if accounts.len() == MAX_FREE_ACCOUNTS {
            tracing::error!("COLONY_FREE_AI_ACCOUNTS lists more than 64 accounts; extras ignored");
            break;
        }
        accounts.push(email);
    }
    accounts
}

fn parse_in_flight(raw: Option<String>) -> i64 {
    let Some(raw) = raw.filter(|raw| !raw.trim().is_empty()) else {
        return DEFAULT_FREE_AI_MAX_IN_FLIGHT;
    };
    match raw.trim().parse::<i64>() {
        Ok(value) if (1..=MAX_FREE_IN_FLIGHT).contains(&value) => value,
        _ => {
            tracing::error!(
                "COLONY_FREE_AI_MAX_IN_FLIGHT must be 1 to 256; using the default of 32"
            );
            DEFAULT_FREE_AI_MAX_IN_FLIGHT
        }
    }
}

fn parse_cap(raw: Option<String>) -> Option<i64> {
    let raw = raw.filter(|raw| !raw.trim().is_empty())?;
    match raw.trim().parse::<i64>() {
        Ok(value) if value > 0 => Some(value),
        _ => {
            tracing::error!(
                "COLONY_CREDITS_GLOBAL_DAILY_CAP_NANOUSD must be a positive integer; refusing all new inference until corrected"
            );
            Some(0)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy(pairs: &[(&str, &str)]) -> GatewayPolicy {
        let pairs: Vec<(String, String)> = pairs
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect();
        policy_from_lookup(|key| {
            pairs
                .iter()
                .find(|(name, _)| name == key)
                .map(|(_, value)| value.clone())
        })
    }

    #[test]
    fn unset_environment_grants_nobody_and_sets_no_ceiling() {
        let policy = policy(&[]);
        assert!(policy.free_ai_accounts.is_empty());
        assert_eq!(policy.free_ai_max_in_flight, DEFAULT_FREE_AI_MAX_IN_FLIGHT);
        assert_eq!(policy.global_daily_cap_nanousd, None);
        assert!(!policy.is_free("basheerphiri@gmail.com"));
    }

    #[test]
    fn free_accounts_are_trimmed_lowercased_deduped_and_exact() {
        let policy = policy(&[(
            "COLONY_FREE_AI_ACCOUNTS",
            " BasheerPhiri@Gmail.com, ,not-an-email,basheerphiri@gmail.com,other@example.com ",
        )]);
        assert_eq!(
            policy.free_ai_accounts,
            vec!["basheerphiri@gmail.com", "other@example.com"]
        );
        assert!(policy.is_free("basheerphiri@gmail.com"));
        assert!(policy.is_free("BASHEERPHIRI@gmail.com"));
        assert!(!policy.is_free("basheerphiri@gmail.com.evil.test"));
        assert!(!policy.is_free("xbasheerphiri@gmail.com"));
    }

    #[test]
    fn free_account_list_is_bounded() {
        let many = (0..100)
            .map(|i| format!("judge{i}@example.com"))
            .collect::<Vec<_>>()
            .join(",");
        assert_eq!(
            policy(&[("COLONY_FREE_AI_ACCOUNTS", &many)])
                .free_ai_accounts
                .len(),
            MAX_FREE_ACCOUNTS
        );
    }

    #[test]
    fn free_in_flight_uses_valid_values_and_defaults_otherwise() {
        for (raw, expected) in [
            ("1", 1),
            (" 64 ", 64),
            ("256", 256),
            ("0", DEFAULT_FREE_AI_MAX_IN_FLIGHT),
            ("257", DEFAULT_FREE_AI_MAX_IN_FLIGHT),
            ("-3", DEFAULT_FREE_AI_MAX_IN_FLIGHT),
            ("many", DEFAULT_FREE_AI_MAX_IN_FLIGHT),
            ("", DEFAULT_FREE_AI_MAX_IN_FLIGHT),
        ] {
            assert_eq!(
                policy(&[("COLONY_FREE_AI_MAX_IN_FLIGHT", raw)]).free_ai_max_in_flight,
                expected,
                "{raw:?}"
            );
        }
    }

    #[test]
    fn daily_cap_is_off_when_unset_exact_when_valid_and_closed_when_invalid() {
        let cap = |raw: &str| {
            policy(&[("COLONY_CREDITS_GLOBAL_DAILY_CAP_NANOUSD", raw)]).global_daily_cap_nanousd
        };
        assert_eq!(cap(""), None);
        assert_eq!(cap("  "), None);
        assert_eq!(cap("5000000000"), Some(5_000_000_000));
        assert_eq!(cap(" 5000000000 "), Some(5_000_000_000));
        for invalid in ["0", "-1", "5e9", "$5", "99999999999999999999"] {
            assert_eq!(cap(invalid), Some(0), "{invalid:?} must fail closed");
        }
    }
}
