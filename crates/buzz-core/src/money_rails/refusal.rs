//! The refusal list: Scout can only ask for money, never send it out.
//!
//! Spec section 6.3 and coordinator call 3. The relay refuses any recipe or browser step that
//! refunds, pays out, transfers, withdraws or moves a balance, whatever the owner approved.
//! The check runs when a recipe is proposed, when it is approved, at every run, and at every
//! browser step. It fails closed: a word anywhere in the title, path, query, headers or body
//! is enough.

use super::recipe::Recipe;
use super::MoneyError;

/// Words that mark a request as sending money out, with the refusal code each one gives.
/// One constant so the UI can show the list.
pub const FORBIDDEN_WORDS: &[(&str, &str)] = &[
    ("refund", "refund_path"),
    ("payout", "payout_path"),
    ("transfer", "transfer_path"),
    ("withdraw", "withdraw_path"),
    ("disburse", "disburse_path"),
    ("reversal", "reversal_path"),
    ("chargeback", "chargeback_path"),
    ("remit", "remit_path"),
];

/// A word that moves balance. Allowed only in a read only `GET`.
pub const BALANCE_WORD: (&str, &str) = ("balance", "balance_path");

/// A refused request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Refusal {
    /// Stable machine code, for example `refund_path`.
    pub code: &'static str,
    /// The forbidden word that was found (empty for a method refusal).
    pub word: &'static str,
}

impl Refusal {
    /// The refusal as a money rails error with a plain message.
    pub fn into_error(self) -> MoneyError {
        let message = if self.word.is_empty() {
            "Colony only asks providers for money. This request is not a create link or lookup."
                .to_owned()
        } else {
            format!(
                "Colony only asks providers for money. A request that mentions \"{}\" can move money out, so it is never allowed.",
                self.word
            )
        };
        MoneyError::forbidden(self.code, message)
    }
}

/// Lower cases `text` and drops everything that is not a letter or digit, so `Pay-Out`,
/// `pay_out` and `PAY OUT` all become `payout`.
fn squeeze(text: &str) -> String {
    text.chars()
        .filter(char::is_ascii_alphanumeric)
        .map(|c| c.to_ascii_lowercase())
        .collect()
}

/// Finds a forbidden word in `text`. `read_only` is true for a `GET`, which may mention a
/// balance because it moves nothing.
pub fn find_forbidden(text: &str, read_only: bool) -> Option<Refusal> {
    let squeezed = squeeze(text);
    for &(word, code) in FORBIDDEN_WORDS {
        if squeezed.contains(word) {
            return Some(Refusal { code, word });
        }
    }
    if !read_only && squeezed.contains(BALANCE_WORD.0) {
        return Some(Refusal {
            code: BALANCE_WORD.1,
            word: BALANCE_WORD.0,
        });
    }
    None
}

/// Checks a whole recipe: the method first, then every text it carries.
pub fn check_recipe(recipe: &Recipe) -> Result<(), Refusal> {
    let method = recipe.method.to_ascii_uppercase();
    let method_ok = matches!(
        (recipe.purpose, method.as_str()),
        (super::recipe::RecipePurpose::CreateLink, "POST")
            | (super::recipe::RecipePurpose::LookupPayment, "GET")
    );
    if !method_ok {
        return Err(Refusal {
            code: "method_not_allowed",
            word: "",
        });
    }
    let read_only = method == "GET";
    let mut texts: Vec<&str> = vec![
        recipe.title.as_str(),
        recipe.recipe_id.as_str(),
        recipe.path.as_str(),
        recipe.body.as_str(),
    ];
    for pair in recipe.query.iter().chain(recipe.headers.iter()) {
        texts.push(&pair.name);
        texts.push(&pair.value);
    }
    if let Some(url) = &recipe.extract.url {
        texts.push(url);
    }
    for text in texts {
        if let Some(refusal) = find_forbidden(text, read_only) {
            return Err(refusal);
        }
    }
    Ok(())
}

/// Checks one browser step: the label or button text, and the URL it would act on. A browser
/// step is never read only, so a balance word is refused too.
pub fn check_step(label: &str, url: &str) -> Result<(), Refusal> {
    for text in [label, url] {
        if let Some(refusal) = find_forbidden(text, false) {
            return Err(refusal);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::money_rails::recipe::{BodyEncoding, Extract, NameValue, RecipePurpose};

    fn recipe(method: &str, purpose: RecipePurpose, path: &str, body: &str) -> Recipe {
        Recipe {
            recipe_id: "r".to_owned(),
            title: "Create payment link".to_owned(),
            purpose,
            method: method.to_owned(),
            host: "api.example.com".to_owned(),
            path: path.to_owned(),
            query: Vec::new(),
            headers: vec![NameValue {
                name: "Content-Type".to_owned(),
                value: "application/json".to_owned(),
            }],
            body_encoding: BodyEncoding::Json,
            body: body.to_owned(),
            extract: Extract::default(),
        }
    }

    #[test]
    fn every_forbidden_word_is_refused_in_any_spelling() {
        for text in [
            "/v1/refunds",
            "/v1/Payouts",
            "/v1/pay_outs",
            "/v1/pay-out",
            "/v1/transfers/create",
            "/withdrawals",
            "/v2/disbursements",
            "/transfer_reversals",
            "/chargebacks",
            "/remittance",
            "REFUND",
        ] {
            assert!(
                find_forbidden(text, true).is_some(),
                "{text} must be refused"
            );
        }
        assert!(find_forbidden("/v1/payment_links", false).is_none());
        assert!(find_forbidden("Create link", false).is_none());
    }

    #[test]
    fn balance_is_refused_unless_the_request_only_reads() {
        assert!(find_forbidden("/v1/balance", true).is_none());
        assert_eq!(
            find_forbidden("/v1/balance", false).map(|r| r.code),
            Some("balance_path")
        );
    }

    #[test]
    fn a_create_link_recipe_must_be_a_post_and_a_lookup_a_get() {
        let good = recipe("POST", RecipePurpose::CreateLink, "/v1/payment_links", "{}");
        assert!(check_recipe(&good).is_ok());
        for bad_method in ["PUT", "PATCH", "DELETE", "GET"] {
            let bad = recipe(
                bad_method,
                RecipePurpose::CreateLink,
                "/v1/payment_links",
                "{}",
            );
            assert_eq!(
                check_recipe(&bad).map_err(|r| r.code),
                Err("method_not_allowed"),
                "{bad_method}"
            );
        }
        let lookup = recipe(
            "GET",
            RecipePurpose::LookupPayment,
            "/v1/payments/{{provider_reference}}",
            "",
        );
        assert!(check_recipe(&lookup).is_ok());
        let post_lookup = recipe("POST", RecipePurpose::LookupPayment, "/v1/payments", "");
        assert!(check_recipe(&post_lookup).is_err());
    }

    #[test]
    fn a_refund_hidden_in_the_body_or_a_header_is_refused() {
        let in_body = recipe(
            "POST",
            RecipePurpose::CreateLink,
            "/v1/payment_links",
            "{\"note\":\"then refund the customer\"}",
        );
        assert_eq!(
            check_recipe(&in_body).map_err(|r| r.code),
            Err("refund_path")
        );
        let mut in_header = recipe("POST", RecipePurpose::CreateLink, "/v1/payment_links", "{}");
        in_header.headers.push(NameValue {
            name: "X-Action".to_owned(),
            value: "payout".to_owned(),
        });
        assert_eq!(
            check_recipe(&in_header).map_err(|r| r.code),
            Err("payout_path")
        );
        let in_title = Recipe {
            title: "Refund a payment".to_owned(),
            ..recipe("POST", RecipePurpose::CreateLink, "/v1/payment_links", "{}")
        };
        assert_eq!(
            check_recipe(&in_title).map_err(|r| r.code),
            Err("refund_path")
        );
    }

    #[test]
    fn browser_steps_use_the_same_list() {
        assert!(check_step(
            "Create link",
            "https://dashboard.example.com/payment-links/create"
        )
        .is_ok());
        assert!(check_step("Refund payment", "https://dashboard.example.com/payments/1").is_err());
        assert!(check_step("Create link", "https://dashboard.example.com/payouts").is_err());
        assert!(check_step("Send money", "https://dashboard.example.com/balance").is_err());
    }
}
