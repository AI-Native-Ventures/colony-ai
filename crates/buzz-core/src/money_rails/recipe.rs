//! Request recipes: the only way Colony calls a payment provider's API for Scout.
//!
//! A recipe is a named, owner-approved request shape (method, host, path template, body
//! template). Scout proposes one from the provider's public docs; the owner approves the exact
//! body once. The relay renders it with values taken from the approved card, never from Scout,
//! runs it with the sealed key, and returns only what is extracted from the response.

use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::refusal::check_recipe;
use super::{
    clean_text, currency_exponent, decimal_to_minor, minor_to_decimal, sha256_hex, valid_currency,
    valid_host, MoneyError,
};

/// Everything except RFC 3986 unreserved characters is percent encoded.
const UNRESERVED: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'.')
    .remove(b'_')
    .remove(b'~');

/// Placeholders a recipe may use. `provider_reference` is for lookups only.
pub const PLACEHOLDERS: &[&str] = &[
    "amount_minor",
    "amount_decimal",
    "currency",
    "currency_lower",
    "purpose",
    "card_ref",
    "invoice_number",
    "recipient_name",
    "expires_at_unix",
    "provider_reference",
];

/// Header names a recipe may not set: the relay owns authentication and framing.
const FORBIDDEN_HEADERS: &[&str] = &[
    "authorization",
    "proxy-authorization",
    "cookie",
    "set-cookie",
    "host",
    "content-length",
    "transfer-encoding",
    "connection",
    "upgrade",
    "te",
    "trailer",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-real-ip",
];

/// Field names whose values are replaced when a response is scrubbed.
const SECRET_FIELD_HINTS: &[&str] = &[
    "apikey",
    "secret",
    "token",
    "authorization",
    "password",
    "passwd",
];

/// What a recipe is for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecipePurpose {
    /// Creates a payment link. Runs only inside an approved card.
    CreateLink,
    /// Reads a payment back to confirm it. Read only.
    LookupPayment,
}

/// How the body template is encoded.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum BodyEncoding {
    /// No body.
    #[default]
    None,
    /// A JSON document; substituted values are escaped as JSON string content.
    Json,
    /// `application/x-www-form-urlencoded`; substituted values are percent encoded.
    Form,
}

/// One name and value.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct NameValue {
    /// Name.
    pub name: String,
    /// Value template.
    pub value: String,
}

/// Whether an extracted amount is in minor units or a decimal in major units.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum AmountScale {
    /// Integer minor units (cents).
    #[default]
    Minor,
    /// A decimal such as `3750.00`.
    Decimal,
}

/// A JSON pointer to an amount and how to read it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct AmountPointer {
    /// RFC 6901 pointer into the JSON response.
    pub pointer: String,
    /// Scale of the value found there.
    #[serde(default)]
    pub scale: AmountScale,
}

/// A JSON pointer that must equal a value.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct EqualsPointer {
    /// RFC 6901 pointer into the JSON response.
    pub pointer: String,
    /// The text the value must equal.
    pub equals: String,
}

/// Where in the response to read the link and the facts to check.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Extract {
    /// Pointer to the payment link URL (create).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Pointer to the provider's reference for the link or payment.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<String>,
    /// Pointer to the amount.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub amount: Option<AmountPointer>,
    /// Pointer to the currency code.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    /// For a lookup: the pointer and value that mean "paid".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paid: Option<EqualsPointer>,
}

/// A request recipe.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Recipe {
    /// Slug, unique per connection.
    pub recipe_id: String,
    /// Plain title shown to the owner.
    pub title: String,
    /// What the recipe is for.
    pub purpose: RecipePurpose,
    /// HTTP method.
    pub method: String,
    /// API host, one of the connection's hosts.
    pub host: String,
    /// Path template.
    pub path: String,
    /// Query parameters.
    #[serde(default)]
    pub query: Vec<NameValue>,
    /// Static headers. Authentication is added by the relay.
    #[serde(default)]
    pub headers: Vec<NameValue>,
    /// Body encoding.
    #[serde(default)]
    pub body_encoding: BodyEncoding,
    /// Body template.
    #[serde(default)]
    pub body: String,
    /// What to read from the response.
    #[serde(default)]
    pub extract: Extract,
}

/// SHA-256 of the exact recipe body. An approval pins this hash.
pub fn recipe_hash(recipe: &Recipe) -> String {
    sha256_hex(&serde_json::to_vec(recipe).unwrap_or_default())
}

/// The placeholders used in a template, or an error for an unclosed or malformed one.
fn placeholders_in(template: &str) -> Result<Vec<String>, MoneyError> {
    let mut found = Vec::new();
    let mut rest = template;
    while let Some(start) = rest.find("{{") {
        let after = &rest[start + 2..];
        let Some(end) = after.find("}}") else {
            return Err(MoneyError::invalid(
                "recipe_placeholder",
                "a {{ placeholder is not closed",
            ));
        };
        let name = &after[..end];
        if name.is_empty()
            || name.len() > 32
            || !name.bytes().all(|b| b.is_ascii_lowercase() || b == b'_')
        {
            return Err(MoneyError::invalid(
                "recipe_placeholder",
                "a placeholder name is not valid",
            ));
        }
        found.push(name.to_owned());
        rest = &after[end + 2..];
    }
    Ok(found)
}

fn valid_slug(value: &str) -> bool {
    let bytes = value.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 48
        && bytes[0].is_ascii_alphanumeric()
        && bytes
            .iter()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || *b == b'-')
}

fn valid_pointer(pointer: &str) -> bool {
    pointer.starts_with('/') && pointer.len() <= 200 && !pointer.chars().any(char::is_control)
}

/// Validates a recipe against the connection's API hosts and the refusal list. The same
/// function runs at propose time, at approve time and before every run.
pub fn validate_recipe(recipe: &Recipe, api_hosts: &[String]) -> Result<(), MoneyError> {
    if !valid_slug(&recipe.recipe_id) {
        return Err(MoneyError::invalid(
            "recipe_id",
            "recipe id must be lower case letters, digits and dashes, up to 48 characters",
        ));
    }
    if !clean_text(&recipe.title, 120) {
        return Err(MoneyError::invalid(
            "recipe_title",
            "recipe title must be 1 to 120 characters",
        ));
    }
    // The refusal list comes first so a forbidden recipe never gets a softer error.
    let _ = check_recipe(recipe);
    if !valid_host(&recipe.host) || !api_hosts.iter().any(|host| host == &recipe.host) {
        return Err(MoneyError::forbidden(
            "host_not_allowed",
            "recipe host is not one of the provider API hosts chosen when the key was connected",
        ));
    }
    let path = &recipe.path;
    if !path.starts_with('/')
        || path.len() > 512
        || path.contains("..")
        || path.contains("//")
        || path.contains('@')
        || path.contains('\\')
        || path.contains('?')
        || path.contains('#')
        || path.chars().any(|c| c.is_control() || c.is_whitespace())
    {
        return Err(MoneyError::invalid(
            "recipe_path",
            "recipe path must start with / and carry no query, fragment or odd characters",
        ));
    }
    if recipe.query.len() > 16 || recipe.headers.len() > 16 {
        return Err(MoneyError::invalid(
            "recipe_size",
            "recipe has too many query parameters or headers",
        ));
    }
    for pair in &recipe.query {
        if !clean_text(&pair.name, 64) || pair.value.chars().count() > 512 {
            return Err(MoneyError::invalid(
                "recipe_query",
                "query parameter name or value is not valid",
            ));
        }
    }
    for pair in &recipe.headers {
        let lower = pair.name.to_ascii_lowercase();
        let token = !pair.name.is_empty()
            && pair.name.len() <= 64
            && pair
                .name
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-');
        if !token
            || FORBIDDEN_HEADERS.contains(&lower.as_str())
            || pair.value.chars().count() > 512
            || pair.value.chars().any(char::is_control)
        {
            return Err(MoneyError::invalid(
                "recipe_header",
                "a recipe header is not allowed: the relay sets authentication and framing",
            ));
        }
    }
    if recipe.body.len() > 8 * 1024 {
        return Err(MoneyError::invalid(
            "recipe_size",
            "recipe body is larger than 8 KiB",
        ));
    }
    if (recipe.body_encoding == BodyEncoding::None) != recipe.body.is_empty() {
        return Err(MoneyError::invalid(
            "recipe_body",
            "set bodyEncoding to json or form when there is a body, and none when there is not",
        ));
    }
    if recipe.method.eq_ignore_ascii_case("GET") && !recipe.body.is_empty() {
        return Err(MoneyError::invalid(
            "recipe_body",
            "a lookup recipe has no body",
        ));
    }
    let allowed_here = |name: &str| {
        PLACEHOLDERS.contains(&name)
            && (name != "provider_reference" || recipe.purpose == RecipePurpose::LookupPayment)
    };
    let mut templates: Vec<&str> = vec![recipe.path.as_str(), recipe.body.as_str()];
    templates.extend(recipe.query.iter().map(|pair| pair.value.as_str()));
    templates.extend(recipe.headers.iter().map(|pair| pair.value.as_str()));
    for template in templates {
        for name in placeholders_in(template)? {
            if !allowed_here(&name) {
                return Err(MoneyError::invalid(
                    "recipe_placeholder",
                    format!("placeholder {{{{{name}}}}} is not allowed in this recipe"),
                ));
            }
        }
    }
    validate_extract(recipe)
}

fn validate_extract(recipe: &Recipe) -> Result<(), MoneyError> {
    let ex = &recipe.extract;
    let pointers = [
        ex.url.as_deref(),
        ex.reference.as_deref(),
        ex.amount.as_ref().map(|a| a.pointer.as_str()),
        ex.currency.as_deref(),
        ex.paid.as_ref().map(|p| p.pointer.as_str()),
    ];
    if pointers.iter().flatten().any(|p| !valid_pointer(p)) {
        return Err(MoneyError::invalid(
            "recipe_extract",
            "extract pointers must be JSON pointers starting with /",
        ));
    }
    match recipe.purpose {
        RecipePurpose::CreateLink => {
            if ex.url.is_none()
                || ex.reference.is_none()
                || ex.amount.is_none()
                || ex.currency.is_none()
            {
                return Err(MoneyError::invalid(
                    "recipe_extract",
                    "a create link recipe must say where to read url, reference, amount and currency, so Colony can check the link before it is sent",
                ));
            }
        }
        RecipePurpose::LookupPayment => {
            if ex.reference.is_none()
                || ex.amount.is_none()
                || ex.currency.is_none()
                || ex.paid.is_none()
            {
                return Err(MoneyError::invalid(
                    "recipe_extract",
                    "a lookup recipe must say where to read reference, amount, currency and the paid flag",
                ));
            }
        }
    }
    Ok(())
}

/// Values the relay substitutes. They come from the approved card, never from Scout.
#[derive(Debug, Clone)]
pub struct RenderValues {
    /// Amount in minor units.
    pub amount_minor: i64,
    /// Upper case currency code.
    pub currency: String,
    /// What the payment is for.
    pub purpose: String,
    /// Short card reference.
    pub card_ref: String,
    /// Invoice number.
    pub invoice_number: String,
    /// Recipient's name.
    pub recipient_name: String,
    /// Link expiry as Unix seconds.
    pub expires_at_unix: i64,
    /// Provider reference, for lookups.
    pub provider_reference: Option<String>,
}

/// A request ready to send.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RenderedRequest {
    /// Upper case method.
    pub method: String,
    /// Host (already checked against the connection).
    pub host: String,
    /// Path and query string.
    pub path_and_query: String,
    /// Headers, without authentication.
    pub headers: Vec<(String, String)>,
    /// Body, when there is one.
    pub body: Option<String>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Context {
    Path,
    Query,
    Header,
    BodyJson,
    BodyForm,
}

fn value_of(name: &str, values: &RenderValues) -> Result<String, MoneyError> {
    let exponent = currency_exponent(&values.currency);
    Ok(match name {
        "amount_minor" => values.amount_minor.to_string(),
        "amount_decimal" => minor_to_decimal(values.amount_minor, exponent),
        "currency" => values.currency.clone(),
        "currency_lower" => values.currency.to_ascii_lowercase(),
        "purpose" => values.purpose.clone(),
        "card_ref" => values.card_ref.clone(),
        "invoice_number" => values.invoice_number.clone(),
        "recipient_name" => values.recipient_name.clone(),
        "expires_at_unix" => values.expires_at_unix.to_string(),
        "provider_reference" => values.provider_reference.clone().ok_or_else(|| {
            MoneyError::invalid(
                "recipe_placeholder",
                "this recipe needs a provider reference",
            )
        })?,
        _ => {
            return Err(MoneyError::invalid(
                "recipe_placeholder",
                "unknown placeholder",
            ))
        }
    })
}

fn encode(value: &str, context: Context) -> Result<String, MoneyError> {
    Ok(match context {
        Context::Path | Context::Query | Context::BodyForm => {
            utf8_percent_encode(value, UNRESERVED).to_string()
        }
        Context::Header => {
            if value.chars().any(char::is_control) {
                return Err(MoneyError::invalid(
                    "recipe_header",
                    "a value for a header has a control character",
                ));
            }
            value.to_owned()
        }
        Context::BodyJson => {
            let quoted = serde_json::to_string(value)
                .map_err(|_| MoneyError::invalid("recipe_body", "value cannot be encoded"))?;
            quoted[1..quoted.len() - 1].to_owned()
        }
    })
}

fn substitute(
    template: &str,
    values: &RenderValues,
    context: Context,
) -> Result<String, MoneyError> {
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let end = after.find("}}").ok_or_else(|| {
            MoneyError::invalid("recipe_placeholder", "a {{ placeholder is not closed")
        })?;
        out.push_str(&encode(&value_of(&after[..end], values)?, context)?);
        rest = &after[end + 2..];
    }
    out.push_str(rest);
    Ok(out)
}

/// Renders a validated recipe with the card's values.
pub fn render(recipe: &Recipe, values: &RenderValues) -> Result<RenderedRequest, MoneyError> {
    let mut path_and_query = substitute(&recipe.path, values, Context::Path)?;
    if !recipe.query.is_empty() {
        let mut parts = Vec::with_capacity(recipe.query.len());
        for pair in &recipe.query {
            parts.push(format!(
                "{}={}",
                utf8_percent_encode(&pair.name, UNRESERVED),
                substitute(&pair.value, values, Context::Query)?
            ));
        }
        path_and_query.push('?');
        path_and_query.push_str(&parts.join("&"));
    }
    let mut headers = Vec::with_capacity(recipe.headers.len() + 1);
    for pair in &recipe.headers {
        headers.push((
            pair.name.clone(),
            substitute(&pair.value, values, Context::Header)?,
        ));
    }
    let body = match recipe.body_encoding {
        BodyEncoding::None => None,
        BodyEncoding::Json => Some(substitute(&recipe.body, values, Context::BodyJson)?),
        BodyEncoding::Form => Some(substitute(&recipe.body, values, Context::BodyForm)?),
    };
    if body.is_some()
        && !headers
            .iter()
            .any(|(name, _)| name.eq_ignore_ascii_case("content-type"))
    {
        let content_type = if recipe.body_encoding == BodyEncoding::Json {
            "application/json"
        } else {
            "application/x-www-form-urlencoded"
        };
        headers.push(("Content-Type".to_owned(), content_type.to_owned()));
    }
    Ok(RenderedRequest {
        method: recipe.method.to_ascii_uppercase(),
        host: recipe.host.clone(),
        path_and_query,
        headers,
        body,
    })
}

/// What was read from a provider response.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Extracted {
    /// Payment link URL (https).
    pub url: Option<String>,
    /// Provider reference.
    pub reference: Option<String>,
    /// Amount in minor units.
    pub amount_minor: Option<i64>,
    /// Upper case currency code.
    pub currency: Option<String>,
    /// For a lookup: whether the paid pointer matched.
    pub paid: Option<bool>,
}

fn text_of(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(flag) => Some(flag.to_string()),
        _ => None,
    }
}

fn extract_error(message: &str) -> MoneyError {
    MoneyError::invalid("provider_response", message.to_owned())
}

/// Reads the facts out of a provider JSON response. `currency_hint` is the card currency, used
/// only to scale a decimal amount when the response has no currency.
pub fn extract_values(
    body: &Value,
    extract: &Extract,
    currency_hint: &str,
) -> Result<Extracted, MoneyError> {
    let mut out = Extracted::default();
    if let Some(pointer) = &extract.url {
        let text = body
            .pointer(pointer)
            .and_then(text_of)
            .ok_or_else(|| extract_error("the provider response has no link"))?;
        let parsed = url::Url::parse(&text).map_err(|_| extract_error("the link is not a URL"))?;
        if parsed.scheme() != "https"
            || parsed.host_str().is_none()
            || !parsed.username().is_empty()
            || parsed.password().is_some()
            || text.len() > 2_048
        {
            return Err(extract_error("the link is not a plain https URL"));
        }
        out.url = Some(text);
    }
    if let Some(pointer) = &extract.reference {
        let text = body
            .pointer(pointer)
            .and_then(text_of)
            .ok_or_else(|| extract_error("the provider response has no reference"))?;
        if text.is_empty() || text.len() > 200 {
            return Err(extract_error("the provider reference is not usable"));
        }
        out.reference = Some(text);
    }
    if let Some(pointer) = &extract.currency {
        let text = body
            .pointer(pointer)
            .and_then(text_of)
            .ok_or_else(|| extract_error("the provider response has no currency"))?
            .to_ascii_uppercase();
        if !valid_currency(&text) {
            return Err(extract_error(
                "the provider currency is not a currency code",
            ));
        }
        out.currency = Some(text);
    }
    if let Some(amount) = &extract.amount {
        let text = body
            .pointer(&amount.pointer)
            .and_then(text_of)
            .ok_or_else(|| extract_error("the provider response has no amount"))?;
        let minor = match amount.scale {
            AmountScale::Minor => text.parse::<i64>().ok(),
            AmountScale::Decimal => {
                let code = out.currency.as_deref().unwrap_or(currency_hint);
                decimal_to_minor(&text, currency_exponent(code))
            }
        }
        .ok_or_else(|| extract_error("the provider amount is not usable"))?;
        out.amount_minor = Some(minor);
    }
    if let Some(paid) = &extract.paid {
        let found = body.pointer(&paid.pointer).and_then(text_of);
        out.paid = Some(found.as_deref() == Some(paid.equals.as_str()));
    }
    Ok(out)
}

/// Replaces every occurrence of each secret in `text` with `[removed]` (exact match).
pub fn scrub_str(text: &str, secrets: &[&str]) -> String {
    let mut out = text.to_owned();
    for secret in secrets.iter().filter(|secret| !secret.is_empty()) {
        out = out.replace(secret, "[removed]");
    }
    out
}

fn secret_looking(key: &str) -> bool {
    let squeezed: String = key
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .map(|c| c.to_ascii_lowercase())
        .collect();
    SECRET_FIELD_HINTS
        .iter()
        .any(|hint| squeezed.contains(hint))
}

/// Scrubs a JSON value in place: secret-looking fields are replaced and exact secret values
/// are removed from every string. Returns the names of the removed fields.
pub fn scrub_value(value: &mut Value, secrets: &[&str]) -> Vec<String> {
    let mut removed = Vec::new();
    scrub_into(value, secrets, &mut removed);
    removed.sort();
    removed.dedup();
    removed
}

fn scrub_into(value: &mut Value, secrets: &[&str], removed: &mut Vec<String>) {
    match value {
        Value::String(text) => {
            *text = scrub_str(text, secrets);
        }
        Value::Array(items) => {
            for item in items {
                scrub_into(item, secrets, removed);
            }
        }
        Value::Object(map) => {
            for (key, entry) in map.iter_mut() {
                if secret_looking(key) {
                    removed.push(key.clone());
                    *entry = Value::String("[removed]".to_owned());
                } else {
                    scrub_into(entry, secrets, removed);
                }
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn stripe_recipe() -> Recipe {
        Recipe {
            recipe_id: "create-payment-link".to_owned(),
            title: "Create payment link".to_owned(),
            purpose: RecipePurpose::CreateLink,
            method: "POST".to_owned(),
            host: "api.stripe.com".to_owned(),
            path: "/v1/payment_links".to_owned(),
            query: Vec::new(),
            headers: Vec::new(),
            body_encoding: BodyEncoding::Form,
            body: "line_items[0][price_data][currency]={{currency_lower}}&line_items[0][price_data][unit_amount]={{amount_minor}}&line_items[0][price_data][product_data][name]={{purpose}}&line_items[0][quantity]=1&metadata[colony_ref]={{card_ref}}".to_owned(),
            extract: Extract {
                url: Some("/url".to_owned()),
                reference: Some("/id".to_owned()),
                amount: Some(AmountPointer {
                    pointer: "/amount".to_owned(),
                    scale: AmountScale::Minor,
                }),
                currency: Some("/currency".to_owned()),
                paid: None,
            },
        }
    }

    fn values() -> RenderValues {
        RenderValues {
            amount_minor: 375_000,
            currency: "ZAR".to_owned(),
            purpose: "Deposit & \"refit\" 50%".to_owned(),
            card_ref: "PL-7F3K9Q".to_owned(),
            invoice_number: "INV-0012".to_owned(),
            recipient_name: "Thandi".to_owned(),
            expires_at_unix: 1_794_200_000,
            provider_reference: None,
        }
    }

    fn hosts() -> Vec<String> {
        vec!["api.stripe.com".to_owned()]
    }

    #[test]
    fn a_normal_create_recipe_validates() {
        validate_recipe(&stripe_recipe(), &hosts()).expect("valid recipe");
    }

    #[test]
    fn the_host_lock_refuses_a_foreign_host() {
        let mut recipe = stripe_recipe();
        recipe.host = "evil.example.com".to_owned();
        let error = validate_recipe(&recipe, &hosts()).expect_err("foreign host");
        assert_eq!(error.code, "host_not_allowed");
    }

    #[test]
    fn a_refund_recipe_is_refused_before_anything_else() {
        let mut recipe = stripe_recipe();
        recipe.path = "/v1/refunds".to_owned();
        let error = validate_recipe(&recipe, &hosts()).expect_err("refund");
        assert_eq!(error.code, "refund_path");
        assert_eq!(error.kind, crate::money_rails::ErrorKind::Forbidden);
    }

    #[test]
    fn unknown_placeholders_headers_and_paths_are_refused() {
        let mut recipe = stripe_recipe();
        recipe.body = "x={{api_key}}".to_owned();
        assert_eq!(
            validate_recipe(&recipe, &hosts())
                .expect_err("placeholder")
                .code,
            "recipe_placeholder"
        );
        let mut recipe = stripe_recipe();
        recipe.headers.push(NameValue {
            name: "Authorization".to_owned(),
            value: "Bearer x".to_owned(),
        });
        assert_eq!(
            validate_recipe(&recipe, &hosts()).expect_err("header").code,
            "recipe_header"
        );
        for path in ["/v1/../x", "//x", "v1/x", "/v1/x?y=1", "/a@b"] {
            let mut recipe = stripe_recipe();
            recipe.path = path.to_owned();
            assert!(validate_recipe(&recipe, &hosts()).is_err(), "{path}");
        }
        let mut recipe = stripe_recipe();
        recipe.body = "ref={{provider_reference}}".to_owned();
        assert_eq!(
            validate_recipe(&recipe, &hosts())
                .expect_err("lookup only")
                .code,
            "recipe_placeholder"
        );
    }

    #[test]
    fn a_create_recipe_must_say_how_to_check_the_link() {
        let mut recipe = stripe_recipe();
        recipe.extract.amount = None;
        assert_eq!(
            validate_recipe(&recipe, &hosts())
                .expect_err("extract")
                .code,
            "recipe_extract"
        );
    }

    #[test]
    fn rendering_escapes_values_for_their_context() {
        let rendered = render(&stripe_recipe(), &values()).expect("render");
        assert_eq!(rendered.method, "POST");
        assert_eq!(rendered.path_and_query, "/v1/payment_links");
        let body = rendered.body.expect("body");
        assert!(body.contains("unit_amount]=375000"), "{body}");
        assert!(body.contains("currency]=zar"), "{body}");
        assert!(
            body.contains("Deposit%20%26%20%22refit%22%2050%25"),
            "{body}"
        );
        assert!(body.contains("metadata[colony_ref]=PL-7F3K9Q"), "{body}");
        assert!(rendered
            .headers
            .iter()
            .any(|(name, value)| name == "Content-Type"
                && value == "application/x-www-form-urlencoded"));

        let mut json_recipe = stripe_recipe();
        json_recipe.body_encoding = BodyEncoding::Json;
        json_recipe.body = "{\"amount\":{{amount_minor}},\"note\":\"{{purpose}}\"}".to_owned();
        let body = render(&json_recipe, &values())
            .expect("render json")
            .body
            .expect("body");
        let parsed: Value = serde_json::from_str(&body).expect("json body stays valid");
        assert_eq!(parsed["amount"], 375_000);
        assert_eq!(parsed["note"], "Deposit & \"refit\" 50%");
    }

    #[test]
    fn a_purpose_line_cannot_break_out_of_the_json_body() {
        let mut json_recipe = stripe_recipe();
        json_recipe.body_encoding = BodyEncoding::Json;
        json_recipe.body = "{\"note\":\"{{purpose}}\"}".to_owned();
        let mut hostile = values();
        hostile.purpose = "x\",\"amount\":1,\"y\":\"".to_owned();
        let body = render(&json_recipe, &hostile)
            .expect("render")
            .body
            .expect("body");
        let parsed: Value = serde_json::from_str(&body).expect("still one object");
        assert_eq!(parsed.as_object().expect("object").len(), 1);
        assert_eq!(parsed["note"], hostile.purpose);
    }

    #[test]
    fn extraction_reads_and_checks_the_response() {
        let response = json!({
            "id": "plink_1",
            "url": "https://buy.stripe.com/test_x",
            "amount": 375000,
            "currency": "zar"
        });
        let extracted =
            extract_values(&response, &stripe_recipe().extract, "ZAR").expect("extract");
        assert_eq!(
            extracted.url.as_deref(),
            Some("https://buy.stripe.com/test_x")
        );
        assert_eq!(extracted.reference.as_deref(), Some("plink_1"));
        assert_eq!(extracted.amount_minor, Some(375_000));
        assert_eq!(extracted.currency.as_deref(), Some("ZAR"));

        let http_link = json!({"id":"p","url":"http://x.example/a","amount":1,"currency":"zar"});
        assert!(extract_values(&http_link, &stripe_recipe().extract, "ZAR").is_err());
        let credentials =
            json!({"id":"p","url":"https://u:p@x.example/a","amount":1,"currency":"zar"});
        assert!(extract_values(&credentials, &stripe_recipe().extract, "ZAR").is_err());

        let mut decimal = stripe_recipe().extract;
        decimal.amount = Some(AmountPointer {
            pointer: "/amount".to_owned(),
            scale: AmountScale::Decimal,
        });
        let response =
            json!({"id":"p","url":"https://x.example/a","amount":"3750.00","currency":"ZAR"});
        assert_eq!(
            extract_values(&response, &decimal, "ZAR")
                .expect("decimal")
                .amount_minor,
            Some(375_000)
        );
    }

    #[test]
    fn scrubbing_removes_exact_secrets_and_secret_looking_fields() {
        let key = "sk_live_abc123";
        assert_eq!(
            scrub_str("bad key sk_live_abc123 here", &[key]),
            "bad key [removed] here"
        );
        let mut value = json!({
            "error": "invalid key sk_live_abc123",
            "client_secret": "cs_1",
            "nested": {"api_key": "x", "ok": "fine"}
        });
        let removed = scrub_value(&mut value, &[key]);
        assert_eq!(
            removed,
            vec!["api_key".to_owned(), "client_secret".to_owned()]
        );
        let text = value.to_string();
        assert!(!text.contains(key));
        assert!(!text.contains("cs_1"));
        assert!(text.contains("fine"));
    }

    #[test]
    fn the_recipe_hash_pins_the_exact_body() {
        let recipe = stripe_recipe();
        assert_eq!(recipe_hash(&recipe), recipe_hash(&recipe.clone()));
        let mut changed = recipe.clone();
        changed.path = "/v1/payment_links2".to_owned();
        assert_ne!(recipe_hash(&recipe), recipe_hash(&changed));
    }
}
