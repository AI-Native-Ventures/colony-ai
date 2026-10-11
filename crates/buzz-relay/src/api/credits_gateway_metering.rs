//! Server-owned exact token pricing; no client prices or floating-point money.

use serde::Deserialize;
use serde_json::Value;

/// Prices are decimal integer nanoUSD per million tokens, supplied as strings.
#[derive(Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct TokenPrices {
    pub input_nanousd_per_million: String,
    pub output_nanousd_per_million: String,
}

impl TokenPrices {
    pub(super) fn openrouter_ceiling() -> Self {
        Self {
            input_nanousd_per_million: "1000000000".into(),
            output_nanousd_per_million: "5000000000".into(),
        }
    }

    pub(super) fn validate(&self) -> Result<(), ()> {
        self.charge(1, 1).map(|_| ())
    }

    pub(super) fn charge(&self, input: u64, output: u64) -> Result<i64, ()> {
        fn price(raw: &str) -> Result<i128, ()> {
            if raw.is_empty() || raw.len() > 20 || !raw.bytes().all(|b| b.is_ascii_digit()) {
                return Err(());
            }
            raw.parse::<i128>().map_err(|_| ())
        }
        let input = i128::from(input)
            .checked_mul(price(&self.input_nanousd_per_million)?)
            .ok_or(())?;
        let output = i128::from(output)
            .checked_mul(price(&self.output_nanousd_per_million)?)
            .ok_or(())?;
        // Sum before margin and rounding: ceil(nanoUSD/million * tokens * 1.20).
        let numerator = input
            .checked_add(output)
            .ok_or(())?
            .checked_mul(12)
            .ok_or(())?;
        let charge = numerator.checked_add(9_999_999).ok_or(())? / 10_000_000;
        i64::try_from(charge).map_err(|_| ())
    }

    pub(super) fn usage_charge(&self, usage: &Value) -> Result<i64, ()> {
        // OpenAI-compatible providers; the adapter owns usage normalization.
        let input = usage
            .get("prompt_tokens")
            .and_then(Value::as_u64)
            .ok_or(())?;
        let output = usage
            .get("completion_tokens")
            .and_then(Value::as_u64)
            .ok_or(())?;
        self.charge(input, output)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_meter_sums_then_rounds_once_and_rejects_incomplete_usage() {
        let prices = TokenPrices {
            input_nanousd_per_million: "1".into(),
            output_nanousd_per_million: "1".into(),
        };
        assert_eq!(prices.charge(1, 1), Ok(1));
        assert_eq!(prices.charge(1_000_000, 1_000_000), Ok(3));
        assert!(prices
            .usage_charge(&serde_json::json!({"total_tokens":10}))
            .is_err());
        assert!(prices
            .usage_charge(&serde_json::json!({"prompt_tokens":-1,"completion_tokens":1}))
            .is_err());
        let huge = TokenPrices {
            input_nanousd_per_million: "99999999999999999999".into(),
            output_nanousd_per_million: "1".into(),
        };
        assert!(huge.charge(u64::MAX, 1).is_err());
    }
}
