//! Relay-owned Outscraper prospect search proxy.
//!
//! Outscraper needs a provider key, and desktop applications cannot keep
//! build-time credentials secret. `POST /discovery/search` keeps the key on the
//! operator's relay, runs one page of a Google Maps search and returns only
//! normalized place fields. The relay stores no places: clients save the places
//! they keep as ordinary prospect actions (kind 47034). It keeps one counter per
//! company and month (`discovery_usage`) so a company cannot spend the
//! operator's provider credits without bound.
//!
//! The endpoint is a port of the SalesTeams Outscraper client: the same
//! `maps/search-v3` call, with an asynchronous request polled to completion.

use std::sync::Arc;
use std::time::Duration;

use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    response::Json,
};
use buzz_auth::LimitType;
use chrono::{DateTime, Datelike, NaiveDate, SecondsFormat, TimeZone, Utc};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::config::DiscoveryConfig;
use crate::state::AppState;

use super::{api_error, api_error_with_code, gifs};

/// Route of the prospect search proxy.
pub(crate) const SEARCH_PATH: &str = "/discovery/search";

const API_KEY_HEADER: &str = "X-API-KEY";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);
const POLL_REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const OVERALL_DEADLINE: Duration = Duration::from_secs(120);
const MAX_UPSTREAM_RESPONSE_BYTES: usize = 8 * 1024 * 1024;
const ERROR_DETAIL_BYTES: usize = 4 * 1024;
const MAX_POLL_ATTEMPTS: usize = 30;
const COST_PER_RECORD_USD: f64 = 0.003;

const DEFAULT_LIMIT: u32 = 20;
const MAX_LIMIT: u32 = 50;
const MAX_SKIP: u32 = 1_000;
const DEFAULT_LANGUAGE: &str = "en";

const MONTHLY_LIMIT_ERROR: &str = "monthly_limit";
const USAGE_UNAVAILABLE_MESSAGE: &str =
    "Prospect search could not check this month's usage. Try again.";

const NOT_CONFIGURED_MESSAGE: &str = "Prospect search is not set up on this server yet. \
The server owner needs to add the Outscraper key.";
const AUTH_MESSAGE: &str = "The prospect search provider rejected the server key. \
The server owner should check the Outscraper key.";
const CREDITS_MESSAGE: &str = "The prospect search provider has no credits left. \
The server owner needs to top up Outscraper.";
const BUSY_MESSAGE: &str = "The prospect search provider is busy. Try again in a minute.";
const UNAVAILABLE_MESSAGE: &str = "The prospect search provider did not answer. Try again.";

/// Country names the relay can turn into an Outscraper `region` code.
const REGION_CODES: &[(&str, &str)] = &[
    ("south africa", "za"),
    ("united states", "us"),
    ("united states of america", "us"),
    ("usa", "us"),
    ("united kingdom", "gb"),
    ("uk", "gb"),
    ("nigeria", "ng"),
    ("kenya", "ke"),
    ("namibia", "na"),
    ("botswana", "bw"),
    ("zimbabwe", "zw"),
    ("zambia", "zm"),
    ("mozambique", "mz"),
    ("australia", "au"),
    ("canada", "ca"),
    ("india", "in"),
    ("ireland", "ie"),
    ("new zealand", "nz"),
    ("germany", "de"),
    ("france", "fr"),
    ("netherlands", "nl"),
];

/// Build the dedicated Outscraper client. Redirects are disabled: the API key
/// rides in a request header, so following a provider 3xx could replay it to an
/// attacker-chosen host. A 3xx comes back as a non-success status that maps to
/// a generic `502`, and the `Location` target is never read or forwarded.
pub fn build_discovery_http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("static discovery HTTP client configuration")
}

/// Client-owned search request forwarded to Outscraper by the relay.
#[derive(Debug, Deserialize)]
struct SearchRequest {
    /// What to look for, for example `home decor shops`.
    query: String,
    /// City, region or area appended to the query. May be empty.
    #[serde(default)]
    location: String,
    /// Country name or two-letter code used for the provider `region`.
    #[serde(default)]
    country: Option<String>,
    /// Places wanted from this page, 1 through 50. Defaults to 20.
    #[serde(default)]
    limit: Option<u32>,
    /// Places to skip, for the next page. Defaults to 0.
    #[serde(default)]
    skip: Option<u32>,
    /// Result language, 2 through 5 characters. Defaults to `en`.
    #[serde(default)]
    language: Option<String>,
}

/// A request that passed validation, with the provider query already built.
#[derive(Debug, PartialEq, Eq)]
struct ValidatedSearch {
    query: String,
    region: Option<String>,
    limit: u32,
    skip: u32,
    language: String,
}

/// A place found by the provider, reduced to the fields prospects need.
#[derive(Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct Place {
    place_id: Option<String>,
    name: String,
    category: Option<String>,
    subtypes: Option<String>,
    address: Option<String>,
    city: Option<String>,
    state: Option<String>,
    country: Option<String>,
    phone: Option<String>,
    website: Option<String>,
    email: Option<String>,
    rating: Option<f64>,
    reviews: Option<u64>,
    latitude: Option<f64>,
    longitude: Option<f64>,
    maps_url: Option<String>,
    description: Option<String>,
    business_status: Option<String>,
}

/// Why the provider could not answer, as the relay reports it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ProviderFailure {
    Auth,
    Credits,
    Busy,
    Unavailable,
}

impl ProviderFailure {
    /// HTTP status, plain message and machine code for this failure.
    fn parts(self) -> (StatusCode, &'static str, &'static str) {
        match self {
            Self::Auth => (
                StatusCode::BAD_GATEWAY,
                AUTH_MESSAGE,
                "discovery_provider_auth",
            ),
            Self::Credits => (
                StatusCode::BAD_GATEWAY,
                CREDITS_MESSAGE,
                "discovery_provider_credits",
            ),
            Self::Busy => (
                StatusCode::TOO_MANY_REQUESTS,
                BUSY_MESSAGE,
                "discovery_provider_busy",
            ),
            Self::Unavailable => (
                StatusCode::BAD_GATEWAY,
                UNAVAILABLE_MESSAGE,
                "discovery_provider_unavailable",
            ),
        }
    }

    fn response(self) -> (StatusCode, Json<Value>) {
        let (status, message, code) = self.parts();
        api_error_with_code(status, message, code)
    }
}

fn bounded_text(
    name: &str,
    value: &str,
    max_chars: usize,
    required: bool,
) -> Result<String, String> {
    let trimmed = value.trim();
    if (required && trimmed.is_empty()) || trimmed.chars().count() > max_chars {
        return Err(format!(
            "{name} must be {} through {max_chars} characters",
            if required { 1 } else { 0 }
        ));
    }
    Ok(trimmed.to_string())
}

/// Turn a country name or two-letter code into a lowercase Outscraper region.
fn region_code(country: &str) -> Option<String> {
    let normalized = country.trim();
    if normalized.len() == 2 && normalized.bytes().all(|byte| byte.is_ascii_alphabetic()) {
        return Some(normalized.to_ascii_lowercase());
    }
    let key = normalized.to_ascii_lowercase();
    REGION_CODES
        .iter()
        .find(|(name, _)| *name == key)
        .map(|(_, code)| (*code).to_string())
}

/// Join the search text and the location the way Google Maps expects.
fn build_query(query: &str, location: &str) -> String {
    if location.is_empty() {
        query.to_string()
    } else {
        format!("{query}, {location}")
    }
}

fn validate_request(request: SearchRequest) -> Result<ValidatedSearch, String> {
    let query = bounded_text("query", &request.query, 200, true)?;
    let location = bounded_text("location", &request.location, 200, false)?;
    let country = bounded_text(
        "country",
        request.country.as_deref().unwrap_or(""),
        80,
        false,
    )?;
    let limit = request.limit.unwrap_or(DEFAULT_LIMIT);
    if !(1..=MAX_LIMIT).contains(&limit) {
        return Err(format!("limit must be 1 through {MAX_LIMIT}"));
    }
    let skip = request.skip.unwrap_or(0);
    if skip > MAX_SKIP {
        return Err(format!("skip must be 0 through {MAX_SKIP}"));
    }
    let language = match request.language.as_deref().map(str::trim) {
        None | Some("") => DEFAULT_LANGUAGE.to_string(),
        Some(language)
            if (2..=5).contains(&language.len())
                && language
                    .bytes()
                    .all(|byte| byte.is_ascii_alphabetic() || byte == b'-') =>
        {
            language.to_string()
        }
        Some(_) => return Err("language must be 2 through 5 letters".to_string()),
    };
    Ok(ValidatedSearch {
        query: build_query(&query, &location),
        region: region_code(&country),
        limit,
        skip,
        language,
    })
}

/// Build `{base}/{segments...}`; the base may carry a path prefix.
fn endpoint_url(base: &str, segments: &[&str]) -> Result<url::Url, ProviderFailure> {
    let mut url = url::Url::parse(base).map_err(|_| ProviderFailure::Unavailable)?;
    {
        let mut path = url
            .path_segments_mut()
            .map_err(|_| ProviderFailure::Unavailable)?;
        path.pop_if_empty();
        for segment in segments {
            path.push(segment);
        }
    }
    Ok(url)
}

fn search_url(base: &str, request: &ValidatedSearch) -> Result<url::Url, ProviderFailure> {
    let mut url = endpoint_url(base, &["maps", "search-v3"])?;
    {
        let limit = request.limit.to_string();
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("query", &request.query);
        pairs.append_pair("limit", &limit);
        pairs.append_pair("organizationsPerQueryLimit", &limit);
        pairs.append_pair("skip", &request.skip.to_string());
        pairs.append_pair("language", &request.language);
        if let Some(region) = request.region.as_deref() {
            pairs.append_pair("region", region);
        }
        pairs.append_pair("async", "false");
    }
    Ok(url)
}

/// Request ids come from the provider and become a URL path segment.
fn valid_request_id(id: &str) -> bool {
    (1..=128).contains(&id.len())
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn classify_failure(status: Option<u16>, detail: &str) -> ProviderFailure {
    match status {
        Some(402) => return ProviderFailure::Credits,
        Some(401 | 403) => return ProviderFailure::Auth,
        Some(429) => return ProviderFailure::Busy,
        _ => {}
    }
    let detail = detail.to_ascii_lowercase();
    let mentions = |needles: &[&str]| needles.iter().any(|needle| detail.contains(needle));
    if mentions(&["credit", "balance", "insufficient", "payment required"]) {
        ProviderFailure::Credits
    } else if mentions(&["api key", "api-key", "unauthorized", "forbidden"]) {
        ProviderFailure::Auth
    } else if mentions(&["rate limit", "too many requests"]) {
        ProviderFailure::Busy
    } else {
        ProviderFailure::Unavailable
    }
}

/// The failure an Outscraper body reports about itself, when it reports one.
fn failure_from_body(body: &Value) -> Option<ProviderFailure> {
    let error_text = match body.get("error") {
        Some(Value::Bool(true)) => Some(""),
        Some(Value::String(text)) if !text.trim().is_empty() => Some(text.as_str()),
        _ => None,
    };
    let status_failed = body.get("status").and_then(Value::as_str) == Some("Error");
    if error_text.is_none() && !status_failed {
        return None;
    }
    let message = body
        .get("errorMessage")
        .and_then(Value::as_str)
        .or(error_text)
        .unwrap_or("");
    Some(classify_failure(None, message))
}

/// Rows of the first query in an Outscraper result body.
fn result_rows(body: &Value) -> Vec<&Value> {
    let Some(data) = body.get("data").and_then(Value::as_array) else {
        return Vec::new();
    };
    match data.first() {
        Some(Value::Array(rows)) => rows.iter().collect(),
        Some(Value::Object(_)) => data.iter().collect(),
        _ => Vec::new(),
    }
}

fn clip(value: &str, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

/// Keep a URL only when it is http(s) with a host (https only when asked).
fn public_url(value: &str, https_only: bool) -> Option<String> {
    if value.len() > 2_048 {
        return None;
    }
    let parsed = url::Url::parse(value).ok()?;
    let scheme_allowed = if https_only {
        parsed.scheme() == "https"
    } else {
        matches!(parsed.scheme(), "http" | "https")
    };
    if scheme_allowed && parsed.host_str().is_some() {
        Some(value.to_string())
    } else {
        None
    }
}

fn number_field(object: &serde_json::Map<String, Value>, key: &str) -> Option<f64> {
    let value = match object.get(key)? {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.trim().parse::<f64>().ok(),
        _ => None,
    };
    value.filter(|number| number.is_finite())
}

fn normalize_place(row: &Value) -> Option<Place> {
    let object = row.as_object()?;
    let text = |keys: &[&str], max_chars: usize| -> Option<String> {
        keys.iter().find_map(|key| {
            object
                .get(*key)
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| clip(value, max_chars))
        })
    };
    let name = text(&["name"], 240)?;
    let subtypes = match object.get("subtypes") {
        Some(Value::Array(items)) => {
            let joined = items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .collect::<Vec<_>>()
                .join(", ");
            (!joined.is_empty()).then(|| clip(&joined, 400))
        }
        _ => text(&["subtypes"], 400),
    };
    let website = text(&["website", "site"], 2_048).and_then(|value| public_url(&value, false));
    let maps_url = text(&["location_link"], 2_048).and_then(|value| public_url(&value, true));
    let email = text(&["email_1", "email"], 254).filter(|value| value.contains('@'));
    Some(Place {
        place_id: text(&["place_id", "google_id"], 256),
        name,
        category: text(&["category", "type"], 200),
        subtypes,
        address: text(&["full_address", "address"], 400),
        city: text(&["city"], 120),
        state: text(&["state"], 120),
        country: text(&["country"], 120),
        phone: text(&["phone"], 50),
        website,
        email,
        rating: number_field(object, "rating").filter(|value| (0.0..=5.0).contains(value)),
        reviews: number_field(object, "reviews")
            .filter(|value| *value >= 0.0)
            .map(|value| value.round() as u64),
        latitude: number_field(object, "latitude").filter(|value| (-90.0..=90.0).contains(value)),
        longitude: number_field(object, "longitude")
            .filter(|value| (-180.0..=180.0).contains(value)),
        maps_url,
        description: text(&["description"], 2_000),
        business_status: text(&["business_status"], 80),
    })
}

/// The 200 response body for one page of results.
///
/// `nextSkip` and the cost use the rows the provider returned (capped at the
/// requested limit), not the rows that survived normalization, because the
/// provider bills and pages by returned records.
fn build_response(rows: &[&Value], limit: u32, skip: u32) -> Value {
    let considered: Vec<&Value> = rows.iter().take(limit as usize).copied().collect();
    let places: Vec<Place> = considered
        .iter()
        .filter_map(|row| normalize_place(row))
        .collect();
    let consumed = considered.len();
    let next_skip = if consumed == limit as usize {
        Some(u64::from(skip) + consumed as u64)
    } else {
        None
    };
    let cost = (consumed as f64 * COST_PER_RECORD_USD * 10_000.0).round() / 10_000.0;
    serde_json::json!({
        "provider": "outscraper",
        "places": places,
        "estimatedCostUsd": cost,
        "nextSkip": next_skip,
    })
}

async fn read_limited(response: reqwest::Response, cap: usize) -> Result<Vec<u8>, ProviderFailure> {
    if response
        .content_length()
        .is_some_and(|length| length > cap as u64)
    {
        return Err(ProviderFailure::Unavailable);
    }
    let mut body = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| ProviderFailure::Unavailable)?;
        if body.len().saturating_add(chunk.len()) > cap {
            return Err(ProviderFailure::Unavailable);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

async fn get_json(
    request: reqwest::RequestBuilder,
    timeout: Duration,
) -> Result<Value, ProviderFailure> {
    let response = request.timeout(timeout).send().await.map_err(|error| {
        tracing::warn!(
            timeout = error.is_timeout(),
            "Outscraper upstream request failed"
        );
        ProviderFailure::Unavailable
    })?;
    let status = response.status();
    if !status.is_success() {
        // The detail only feeds classification; it is never logged or returned.
        let detail = read_limited(response, ERROR_DETAIL_BYTES)
            .await
            .unwrap_or_default();
        let failure = classify_failure(Some(status.as_u16()), &String::from_utf8_lossy(&detail));
        tracing::warn!(
            status = status.as_u16(),
            failure = ?failure,
            "Outscraper request was rejected"
        );
        return Err(failure);
    }
    let body = read_limited(response, MAX_UPSTREAM_RESPONSE_BYTES).await?;
    serde_json::from_slice(&body).map_err(|_| {
        tracing::warn!("Outscraper returned an invalid response");
        ProviderFailure::Unavailable
    })
}

/// Run the search and return the completed provider body.
async fn fetch_results(
    client: &reqwest::Client,
    config: &DiscoveryConfig,
    request: &ValidatedSearch,
) -> Result<Value, ProviderFailure> {
    let url = search_url(config.api_base(), request)?;
    let first = get_json(
        client.get(url).header(API_KEY_HEADER, config.api_key()),
        REQUEST_TIMEOUT,
    )
    .await?;
    if let Some(failure) = failure_from_body(&first) {
        tracing::warn!(failure = ?failure, "Outscraper reported a failed search");
        return Err(failure);
    }
    if first.get("status").and_then(Value::as_str) != Some("Pending") {
        return Ok(first);
    }
    let id = first
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| valid_request_id(id))
        .ok_or(ProviderFailure::Unavailable)?;
    for _ in 0..MAX_POLL_ATTEMPTS {
        tokio::time::sleep(config.poll_interval()).await;
        let url = endpoint_url(config.poll_base(), &["requests", id])?;
        let polled = get_json(
            client.get(url).header(API_KEY_HEADER, config.api_key()),
            POLL_REQUEST_TIMEOUT,
        )
        .await?;
        if let Some(failure) = failure_from_body(&polled) {
            tracing::warn!(failure = ?failure, "Outscraper reported a failed search");
            return Err(failure);
        }
        if polled.get("status").and_then(Value::as_str) == Some("Success") {
            return Ok(polled);
        }
    }
    tracing::warn!("Outscraper search did not finish within the polling limit");
    Err(ProviderFailure::Unavailable)
}

/// Refuses a search by anyone but the owner or an admin once the owner revoked
/// Discovery, so a revoke takes effect on agents at once.
pub(crate) async fn enforce_discovery_access(
    state: &AppState,
    tenant: &buzz_core::TenantContext,
    pubkey: &nostr::PublicKey,
) -> Result<(), (StatusCode, Json<Value>)> {
    let unavailable = || {
        api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "prospect search access lookup unavailable",
        )
    };
    let member = state
        .db
        .get_relay_member(tenant.community(), &pubkey.to_hex())
        .await
        .map_err(|_| unavailable())?;
    if member
        .as_ref()
        .is_some_and(|member| member.role == "owner" || member.role == "admin")
    {
        return Ok(());
    }
    match crate::handlers::company_access::access_revoked(
        state,
        tenant.community(),
        buzz_core::company_access::AccessCategory::Discovery,
    )
    .await
    {
        Ok(false) => Ok(()),
        Ok(true) => Err(api_error(
            StatusCode::FORBIDDEN,
            "restricted: Discovery access was revoked by the owner",
        )),
        Err(_) => Err(unavailable()),
    }
}

async fn enforce_search_admission(
    state: &AppState,
    tenant: &buzz_core::TenantContext,
    pubkey: &nostr::PublicKey,
) -> Result<(), (StatusCode, Json<Value>)> {
    let limit = state.auth.config().rate_limits.discovery_searches_per_min;
    match crate::admission::check_principal(
        state.admission_rate_limiter.as_ref(),
        tenant,
        pubkey,
        LimitType::DiscoverySearches,
        60,
        limit,
    )
    .await
    {
        Ok(()) => Ok(()),
        Err(crate::admission::AdmissionError::Exceeded { reset_in_secs }) => {
            metrics::counter!("buzz_discovery_search_rejections_total", "reason" => "quota")
                .increment(1);
            Err(api_error(
                StatusCode::TOO_MANY_REQUESTS,
                &format!("rate-limited: prospect search quota exceeded; retry in {reset_in_secs}s"),
            ))
        }
        Err(crate::admission::AdmissionError::Unavailable) => Err(api_error(
            StatusCode::SERVICE_UNAVAILABLE,
            "rate-limited: prospect search admission unavailable",
        )),
    }
}

fn not_configured() -> (StatusCode, Json<Value>) {
    api_error_with_code(
        StatusCode::SERVICE_UNAVAILABLE,
        NOT_CONFIGURED_MESSAGE,
        "discovery_not_configured",
    )
}

/// First day of the UTC month that contains `now`.
fn month_start(now: DateTime<Utc>) -> NaiveDate {
    NaiveDate::from_ymd_opt(now.year(), now.month(), 1).expect("the first of a month exists")
}

/// Start of the UTC month after `month`, when a company's counter resets.
fn next_month_start(month: NaiveDate) -> DateTime<Utc> {
    let (year, number) = if month.month() == 12 {
        (month.year() + 1, 1)
    } else {
        (month.year(), month.month() + 1)
    };
    Utc.with_ymd_and_hms(year, number, 1, 0, 0, 0)
        .single()
        .expect("the first of a month exists")
}

/// The 429 body a company gets once its monthly cap is used up.
fn monthly_limit_response(month: NaiveDate) -> (StatusCode, Json<Value>) {
    (
        StatusCode::TOO_MANY_REQUESTS,
        Json(serde_json::json!({
            "error": MONTHLY_LIMIT_ERROR,
            "resets_at": next_month_start(month).to_rfc3339_opts(SecondsFormat::Secs, true),
        })),
    )
}

fn usage_unavailable(error: &buzz_db::DbError) -> (StatusCode, Json<Value>) {
    tracing::error!(%error, "Discovery usage counter is unavailable");
    api_error_with_code(
        StatusCode::SERVICE_UNAVAILABLE,
        USAGE_UNAVAILABLE_MESSAGE,
        "discovery_usage_unavailable",
    )
}

/// Run an admitted search for one company: refuse it once the company's month
/// is used up, fetch the page (never asking for more places than the month has
/// left), and add the places the provider returned to the company's total.
///
/// The cap is checked before the provider is called and counted after, so a
/// failed provider call is never charged. Searches that run at the same moment
/// can overshoot the cap by their own page sizes; the per-member rate limit
/// bounds how many can overlap.
async fn run_search(
    db: &buzz_db::Db,
    client: &reqwest::Client,
    config: &DiscoveryConfig,
    community: buzz_core::CommunityId,
    mut request: ValidatedSearch,
    now: DateTime<Utc>,
) -> Result<Value, (StatusCode, Json<Value>)> {
    let month = month_start(now);
    let used = db
        .discovery_results_this_month(*community.as_uuid(), month)
        .await
        .map_err(|error| usage_unavailable(&error))?;
    let remaining = config.company_monthly_results().saturating_sub(used);
    if remaining <= 0 {
        metrics::counter!("buzz_discovery_search_rejections_total", "reason" => "monthly_cap")
            .increment(1);
        return Err(monthly_limit_response(month));
    }
    request.limit = request
        .limit
        .min(u32::try_from(remaining).unwrap_or(u32::MAX));

    let results = tokio::time::timeout(OVERALL_DEADLINE, fetch_results(client, config, &request))
        .await
        .map_err(|_| {
            tracing::warn!("Outscraper search passed its overall deadline");
            ProviderFailure::Unavailable.response()
        })?
        .map_err(ProviderFailure::response)?;

    // Never forward the provider response wholesale: only normalized place
    // fields cross the relay boundary.
    let rows = result_rows(&results);
    let charged = rows.len().min(request.limit as usize);
    let response = build_response(&rows, request.limit, request.skip);
    if charged > 0 {
        // The provider already charged for these places, so a failure to count
        // them is reported instead of hidden: the caller retries rather than
        // the company getting uncounted results.
        db.add_discovery_results(
            *community.as_uuid(),
            month,
            i32::try_from(charged).unwrap_or(i32::MAX),
        )
        .await
        .map_err(|error| usage_unavailable(&error))?;
    }
    Ok(response)
}

/// Run one page of an Outscraper Google Maps search for an authenticated member.
pub async fn search(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    let Some(config) = state.config.discovery.as_ref() else {
        return Err(not_configured());
    };
    let (tenant, pubkey) = gifs::authenticate(&state, &headers, SEARCH_PATH, &body).await?;
    let request: SearchRequest = serde_json::from_slice(&body)
        .map_err(|_| api_error(StatusCode::BAD_REQUEST, "invalid prospect search JSON"))?;
    let request = validate_request(request)
        .map_err(|message| api_error(StatusCode::BAD_REQUEST, &message))?;
    enforce_discovery_access(&state, &tenant, &pubkey).await?;
    enforce_search_admission(&state, &tenant, &pubkey).await?;

    run_search(
        &state.db,
        &state.discovery_http_client,
        config,
        tenant.community(),
        request,
        Utc::now(),
    )
    .await
    .map(Json)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        body::Body,
        extract::Query,
        http::{header, Request},
        routing::get,
        Router,
    };
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tower::ServiceExt;

    const TEST_KEY: &str = "test-key-not-a-secret";

    fn request(query: &str) -> SearchRequest {
        SearchRequest {
            query: query.to_string(),
            location: String::new(),
            country: None,
            limit: None,
            skip: None,
            language: None,
        }
    }

    async fn unconfigured_test_state() -> Arc<AppState> {
        let mut config = crate::config::Config::from_env().expect("test config");
        config.discovery = None;
        config.redis_url = "redis://127.0.0.1:1".to_string();

        let pool = sqlx::postgres::PgPoolOptions::new()
            .connect_lazy("postgres://buzz:buzz_dev@127.0.0.1:1/buzz") // sadscan:disable np.postgres.1
            .expect("lazy test database pool");
        let db = buzz_db::Db::from_pool(pool.clone());
        let redis_pool = deadpool_redis::Config::from_url(&config.redis_url)
            .create_pool(Some(deadpool_redis::Runtime::Tokio1))
            .expect("lazy test Redis pool");
        let pubsub = Arc::new(
            buzz_pubsub::PubSubManager::new(&config.redis_url, redis_pool.clone())
                .await
                .expect("test pubsub"),
        );
        let auth = buzz_auth::AuthService::new(config.auth.clone());
        let search = buzz_search::SearchService::new(pool.clone());
        let workflow_engine = Arc::new(buzz_workflow::WorkflowEngine::new(
            db.clone(),
            buzz_workflow::WorkflowConfig::default(),
        ));
        let media_storage =
            buzz_media::MediaStorage::new(&config.media).expect("test media storage config");
        let (state, _audit_shutdown) = AppState::new(
            config,
            db,
            redis_pool,
            None::<buzz_audit::AuditService>,
            pubsub,
            auth,
            search,
            workflow_engine,
            nostr::Keys::generate(),
            media_storage,
        );
        Arc::new(state)
    }

    #[tokio::test]
    async fn search_route_says_so_plainly_when_the_key_is_missing() {
        let state = unconfigured_test_state().await;
        let response = Router::new()
            .route(SEARCH_PATH, axum::routing::post(search))
            .with_state(state)
            .oneshot(
                Request::post(SEARCH_PATH)
                    .body(Body::from("{}"))
                    .expect("search request"),
            )
            .await
            .expect("search response");

        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        let bytes = axum::body::to_bytes(response.into_body(), 4096)
            .await
            .expect("response body");
        let body: Value = serde_json::from_slice(&bytes).expect("json body");
        assert_eq!(
            body,
            serde_json::json!({
                "error": "Prospect search is not set up on this server yet. The server owner needs to add the Outscraper key.",
                "code": "discovery_not_configured",
            })
        );
    }

    #[test]
    fn validation_applies_defaults_and_builds_the_query() {
        let mut input = request("  home decor shops ");
        input.location = " Cape Town ".to_string();
        input.country = Some("South Africa".to_string());

        let validated = validate_request(input).expect("valid request");
        assert_eq!(
            validated,
            ValidatedSearch {
                query: "home decor shops, Cape Town".to_string(),
                region: Some("za".to_string()),
                limit: 20,
                skip: 0,
                language: "en".to_string(),
            }
        );
    }

    #[test]
    fn validation_omits_the_separator_without_a_location() {
        let validated = validate_request(request("accountants")).expect("valid request");
        assert_eq!(validated.query, "accountants");
        assert_eq!(validated.region, None);
    }

    #[test]
    fn validation_bounds_every_field() {
        assert!(validate_request(request("   ")).is_err());
        assert!(validate_request(request(&"x".repeat(201))).is_err());

        let mut long_location = request("a");
        long_location.location = "x".repeat(201);
        assert!(validate_request(long_location).is_err());

        let mut long_country = request("a");
        long_country.country = Some("x".repeat(81));
        assert!(validate_request(long_country).is_err());

        for limit in [0, 51] {
            let mut input = request("a");
            input.limit = Some(limit);
            assert!(validate_request(input).is_err(), "limit {limit}");
        }
        for limit in [1, 50] {
            let mut input = request("a");
            input.limit = Some(limit);
            assert!(validate_request(input).is_ok(), "limit {limit}");
        }

        let mut far_skip = request("a");
        far_skip.skip = Some(1_001);
        assert!(validate_request(far_skip).is_err());
        let mut last_skip = request("a");
        last_skip.skip = Some(1_000);
        assert!(validate_request(last_skip).is_ok());

        // Outscraper pages in steps of 20; any other skip returns repeats that
        // are paid for twice, so it must be refused.
        for skip in [1, 7, 14, 21, 39] {
            let mut input = request("a");
            input.skip = Some(skip);
            assert!(validate_request(input).is_err(), "skip {skip}");
        }

        for language in ["e", "toolong", "e1", "en US"] {
            let mut input = request("a");
            input.language = Some(language.to_string());
            assert!(validate_request(input).is_err(), "language {language}");
        }
        let mut regional = request("a");
        regional.language = Some("pt-BR".to_string());
        assert_eq!(validate_request(regional).expect("pt-BR").language, "pt-BR");
    }

    #[test]
    fn region_codes_cover_names_codes_and_unknowns() {
        assert_eq!(region_code("South Africa"), Some("za".to_string()));
        assert_eq!(region_code("  united kingdom "), Some("gb".to_string()));
        assert_eq!(region_code("Kenya"), Some("ke".to_string()));
        assert_eq!(region_code("ZA"), Some("za".to_string()));
        assert_eq!(region_code("ng"), Some("ng".to_string()));
        assert_eq!(region_code("Atlantis"), None);
        assert_eq!(region_code(""), None);
        assert_eq!(region_code("1a"), None);
    }

    #[test]
    fn search_url_carries_the_provider_parameters() {
        let validated = ValidatedSearch {
            query: "cafes, Durban".to_string(),
            region: Some("za".to_string()),
            limit: 20,
            skip: 40,
            language: "en".to_string(),
        };
        let url = search_url("https://api.example.test/", &validated).expect("search url");

        assert_eq!(url.path(), "/maps/search-v3");
        let params: HashMap<String, String> = url.query_pairs().into_owned().collect();
        assert_eq!(params["query"], "cafes, Durban");
        assert_eq!(params["limit"], "20");
        assert_eq!(params["organizationsPerQueryLimit"], "20");
        assert_eq!(params["skip"], "40");
        assert_eq!(params["language"], "en");
        assert_eq!(params["region"], "za");
        assert_eq!(params["async"], "false");
        assert!(!url.as_str().contains(TEST_KEY));
    }

    #[test]
    fn search_url_omits_an_unknown_region_and_keeps_a_base_path() {
        let validated = ValidatedSearch {
            query: "cafes".to_string(),
            region: None,
            limit: 5,
            skip: 0,
            language: "en".to_string(),
        };
        let url = search_url("http://127.0.0.1:9000/proxy", &validated).expect("search url");

        assert_eq!(url.path(), "/proxy/maps/search-v3");
        assert!(!url.query_pairs().any(|(key, _)| key == "region"));
    }

    #[test]
    fn request_ids_are_limited_to_safe_path_segments() {
        assert!(valid_request_id("abc-123_DEF"));
        assert!(valid_request_id(&"a".repeat(128)));
        assert!(!valid_request_id(""));
        assert!(!valid_request_id(&"a".repeat(129)));
        assert!(!valid_request_id("../admin"));
        assert!(!valid_request_id("a/b"));
        assert!(!valid_request_id("a?b=c"));
        assert!(!valid_request_id("id with space"));
    }

    #[test]
    fn poll_urls_are_built_from_the_id_only() {
        let url =
            endpoint_url("https://poll.example.test", &["requests", "req-1"]).expect("poll url");
        assert_eq!(url.as_str(), "https://poll.example.test/requests/req-1");
    }

    #[test]
    fn failures_are_classified_by_status_then_by_text() {
        assert_eq!(classify_failure(Some(402), ""), ProviderFailure::Credits);
        assert_eq!(classify_failure(Some(401), ""), ProviderFailure::Auth);
        assert_eq!(classify_failure(Some(403), ""), ProviderFailure::Auth);
        assert_eq!(classify_failure(Some(429), ""), ProviderFailure::Busy);
        assert_eq!(
            classify_failure(Some(500), ""),
            ProviderFailure::Unavailable
        );
        assert_eq!(
            classify_failure(Some(400), "Not enough credits on the account"),
            ProviderFailure::Credits
        );
        assert_eq!(
            classify_failure(None, "Insufficient balance"),
            ProviderFailure::Credits
        );
        assert_eq!(
            classify_failure(None, "Invalid API key"),
            ProviderFailure::Auth
        );
        assert_eq!(
            classify_failure(None, "Too many requests"),
            ProviderFailure::Busy
        );
        assert_eq!(
            classify_failure(None, "something broke"),
            ProviderFailure::Unavailable
        );
    }

    #[test]
    fn failure_messages_and_codes_are_the_contract() {
        assert_eq!(
            ProviderFailure::Auth.parts(),
            (
                StatusCode::BAD_GATEWAY,
                "The prospect search provider rejected the server key. The server owner should check the Outscraper key.",
                "discovery_provider_auth"
            )
        );
        assert_eq!(
            ProviderFailure::Credits.parts(),
            (
                StatusCode::BAD_GATEWAY,
                "The prospect search provider has no credits left. The server owner needs to top up Outscraper.",
                "discovery_provider_credits"
            )
        );
        assert_eq!(
            ProviderFailure::Busy.parts(),
            (
                StatusCode::TOO_MANY_REQUESTS,
                "The prospect search provider is busy. Try again in a minute.",
                "discovery_provider_busy"
            )
        );
        assert_eq!(
            ProviderFailure::Unavailable.parts(),
            (
                StatusCode::BAD_GATEWAY,
                "The prospect search provider did not answer. Try again.",
                "discovery_provider_unavailable"
            )
        );
        let (status, body) = ProviderFailure::Busy.response();
        assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(body.0["code"], "discovery_provider_busy");
    }

    #[test]
    fn body_level_failures_are_recognised() {
        assert_eq!(
            failure_from_body(&serde_json::json!({ "status": "Success" })),
            None
        );
        assert_eq!(
            failure_from_body(
                &serde_json::json!({ "status": "Error", "errorMessage": "No credits" })
            ),
            Some(ProviderFailure::Credits)
        );
        assert_eq!(
            failure_from_body(&serde_json::json!({ "error": true })),
            Some(ProviderFailure::Unavailable)
        );
        assert_eq!(
            failure_from_body(&serde_json::json!({ "error": "Unauthorized" })),
            Some(ProviderFailure::Auth)
        );
        assert_eq!(
            failure_from_body(&serde_json::json!({ "error": false, "status": "Success" })),
            None
        );
    }

    #[test]
    fn places_are_normalized_from_the_provider_shape() {
        let row = serde_json::json!({
            "name": "  Form & Field  ",
            "place_id": "ChIJ-test",
            "category": "Home goods store",
            "subtypes": "Furniture store, Gift shop",
            "full_address": "12 Main Road, Woodstock, Cape Town, 7925",
            "city": "Cape Town",
            "state": "Western Cape",
            "country": "South Africa",
            "phone": "+27 21 000 0000",
            "website": "https://form-field.example/",
            "email_1": "hello@form-field.example",
            "rating": 4.8,
            "reviews": 103,
            "latitude": -33.92,
            "longitude": 18.45,
            "location_link": "https://www.google.com/maps/place/?q=place_id:ChIJ-test",
            "description": "Design-led home and living store",
            "business_status": "OPERATIONAL",
            "working_hours": { "Monday": ["9AM-5PM"] },
            "photo": "https://example.test/p.jpg"
        });

        let place = normalize_place(&row).expect("place");
        assert_eq!(
            place,
            Place {
                place_id: Some("ChIJ-test".to_string()),
                name: "Form & Field".to_string(),
                category: Some("Home goods store".to_string()),
                subtypes: Some("Furniture store, Gift shop".to_string()),
                address: Some("12 Main Road, Woodstock, Cape Town, 7925".to_string()),
                city: Some("Cape Town".to_string()),
                state: Some("Western Cape".to_string()),
                country: Some("South Africa".to_string()),
                phone: Some("+27 21 000 0000".to_string()),
                website: Some("https://form-field.example/".to_string()),
                email: Some("hello@form-field.example".to_string()),
                rating: Some(4.8),
                reviews: Some(103),
                latitude: Some(-33.92),
                longitude: Some(18.45),
                maps_url: Some(
                    "https://www.google.com/maps/place/?q=place_id:ChIJ-test".to_string()
                ),
                description: Some("Design-led home and living store".to_string()),
                business_status: Some("OPERATIONAL".to_string()),
            }
        );
        let json = serde_json::to_value(&place).expect("serialize place");
        assert!(json.get("workingHours").is_none());
        assert!(json.get("photo").is_none());
        assert_eq!(json["placeId"], "ChIJ-test");
        assert_eq!(
            json["mapsUrl"],
            "https://www.google.com/maps/place/?q=place_id:ChIJ-test"
        );
    }

    #[test]
    fn missing_and_invalid_fields_become_null_never_errors() {
        let row = serde_json::json!({
            "name": "Bare Minimum",
            "google_id": "0xabc:0xdef",
            "type": "Cafe",
            "site": "ftp://files.example.test/x",
            "location_link": "http://maps.example.test/insecure",
            "email": "not-an-email",
            "rating": "not a number",
            "reviews": -4,
            "latitude": 123.0,
            "longitude": "18.5",
            "subtypes": ["Coffee shop", " ", "Bakery"],
            "phone": ""
        });

        let place = normalize_place(&row).expect("place");
        assert_eq!(place.place_id.as_deref(), Some("0xabc:0xdef"));
        assert_eq!(place.category.as_deref(), Some("Cafe"));
        assert_eq!(place.subtypes.as_deref(), Some("Coffee shop, Bakery"));
        assert_eq!(place.website, None);
        assert_eq!(place.maps_url, None);
        assert_eq!(place.email, None);
        assert_eq!(place.rating, None);
        assert_eq!(place.reviews, None);
        assert_eq!(place.latitude, None);
        assert_eq!(place.longitude, Some(18.5));
        assert_eq!(place.phone, None);
    }

    #[test]
    fn http_websites_are_kept_but_never_upgraded() {
        let row = serde_json::json!({ "name": "Plain Site", "website": "http://plain.example/" });
        let place = normalize_place(&row).expect("place");
        assert_eq!(place.website.as_deref(), Some("http://plain.example/"));
    }

    #[test]
    fn places_without_a_name_are_dropped() {
        assert!(normalize_place(&serde_json::json!({ "name": "   " })).is_none());
        assert!(normalize_place(&serde_json::json!({ "phone": "1" })).is_none());
        assert!(normalize_place(&serde_json::json!("not an object")).is_none());
    }

    #[test]
    fn response_pages_costs_and_caps_by_returned_rows() {
        let rows: Vec<Value> = (0..5)
            .map(|index| serde_json::json!({ "name": format!("Place {index}") }))
            .chain(std::iter::once(serde_json::json!({ "name": " " })))
            .collect();
        let refs: Vec<&Value> = rows.iter().collect();

        // Six rows returned, limit 5: capped at five, a full page, so a next skip.
        let full = build_response(&refs, 5, 10);
        assert_eq!(full["provider"], "outscraper");
        assert_eq!(full["places"].as_array().expect("places").len(), 5);
        assert_eq!(full["nextSkip"], 15);
        assert_eq!(full["estimatedCostUsd"], 0.015);

        // Six rows with a blank name inside a limit of ten: not a full page.
        let partial = build_response(&refs, 10, 0);
        assert_eq!(partial["places"].as_array().expect("places").len(), 5);
        assert!(partial["nextSkip"].is_null());
        assert_eq!(partial["estimatedCostUsd"], 0.018);

        let empty = build_response(&[], 20, 0);
        assert_eq!(empty["places"], serde_json::json!([]));
        assert!(empty["nextSkip"].is_null());
        assert_eq!(empty["estimatedCostUsd"], 0.0);
    }

    #[test]
    fn result_rows_read_the_first_query_of_a_nested_or_flat_body() {
        let nested =
            serde_json::json!({ "data": [[{ "name": "A" }, { "name": "B" }], [{ "name": "C" }]] });
        assert_eq!(result_rows(&nested).len(), 2);
        let flat = serde_json::json!({ "data": [{ "name": "A" }, { "name": "B" }] });
        assert_eq!(result_rows(&flat).len(), 2);
        assert!(result_rows(&serde_json::json!({ "data": [] })).is_empty());
        assert!(result_rows(&serde_json::json!({})).is_empty());
    }

    // ---- end to end against a local stub of the Outscraper API ----

    fn validated(limit: u32) -> ValidatedSearch {
        ValidatedSearch {
            query: "cafes, Durban".to_string(),
            region: Some("za".to_string()),
            limit,
            skip: 0,
            language: "en".to_string(),
        }
    }

    fn key_matches(headers: &HeaderMap) -> bool {
        headers
            .get("x-api-key")
            .and_then(|value| value.to_str().ok())
            == Some(TEST_KEY)
    }

    async fn spawn_stub(router: Router) -> (String, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind stub");
        let address = listener.local_addr().expect("stub address");
        let server = tokio::spawn(async move {
            axum::serve(listener, router).await.expect("serve stub");
        });
        (format!("http://{address}"), server)
    }

    fn stub_config(base: &str) -> DiscoveryConfig {
        DiscoveryConfig::new(TEST_KEY.to_string(), base.to_string(), base.to_string())
            .with_poll_interval(Duration::from_millis(5))
    }

    fn two_places() -> Value {
        serde_json::json!({
            "id": "req-1",
            "status": "Success",
            "data": [[{ "name": "One" }, { "name": "Two" }]]
        })
    }

    #[tokio::test]
    async fn stub_sync_success_sends_the_key_and_parameters() {
        let router = Router::new().route(
            "/maps/search-v3",
            get(
                |headers: HeaderMap, Query(params): Query<HashMap<String, String>>| async move {
                    if !key_matches(&headers) {
                        return (StatusCode::UNAUTHORIZED, Json(serde_json::json!({})));
                    }
                    assert_eq!(params["query"], "cafes, Durban");
                    assert_eq!(params["async"], "false");
                    (StatusCode::OK, Json(two_places()))
                },
            ),
        );
        let (base, server) = spawn_stub(router).await;

        let results = fetch_results(
            &build_discovery_http_client(),
            &stub_config(&base),
            &validated(20),
        )
        .await
        .expect("sync search succeeds");

        server.abort();
        let _ = server.await;
        assert_eq!(result_rows(&results).len(), 2);
    }

    #[tokio::test]
    async fn stub_pending_request_is_polled_until_it_succeeds() {
        let polls = Arc::new(AtomicUsize::new(0));
        let poll_counter = polls.clone();
        let router = Router::new()
            .route(
                "/maps/search-v3",
                get(|| async {
                    Json(serde_json::json!({ "id": "req-1", "status": "Pending" }))
                }),
            )
            .route(
                "/requests/{id}",
                get(move |headers: HeaderMap, axum::extract::Path(id): axum::extract::Path<String>| {
                    let poll_counter = poll_counter.clone();
                    async move {
                        assert_eq!(id, "req-1");
                        assert!(key_matches(&headers));
                        if poll_counter.fetch_add(1, Ordering::SeqCst) == 0 {
                            Json(serde_json::json!({ "id": "req-1", "status": "Pending" }))
                        } else {
                            Json(two_places())
                        }
                    }
                }),
            );
        let (base, server) = spawn_stub(router).await;

        let results = fetch_results(
            &build_discovery_http_client(),
            &stub_config(&base),
            &validated(20),
        )
        .await
        .expect("polled search succeeds");

        server.abort();
        let _ = server.await;
        assert_eq!(polls.load(Ordering::SeqCst), 2);
        assert_eq!(result_rows(&results).len(), 2);
    }

    #[tokio::test]
    async fn stub_pending_request_with_an_unsafe_id_is_not_followed() {
        let router = Router::new().route(
            "/maps/search-v3",
            get(|| async { Json(serde_json::json!({ "id": "../admin", "status": "Pending" })) }),
        );
        let (base, server) = spawn_stub(router).await;

        let failure = fetch_results(
            &build_discovery_http_client(),
            &stub_config(&base),
            &validated(20),
        )
        .await
        .expect_err("unsafe id is refused");

        server.abort();
        let _ = server.await;
        assert_eq!(failure, ProviderFailure::Unavailable);
    }

    #[tokio::test]
    async fn stub_rejected_key_is_reported_as_an_auth_failure() {
        let router = Router::new().route(
            "/maps/search-v3",
            get(|| async {
                (
                    StatusCode::UNAUTHORIZED,
                    Json(serde_json::json!({ "error": "Unauthorized" })),
                )
            }),
        );
        let (base, server) = spawn_stub(router).await;

        let failure = fetch_results(
            &build_discovery_http_client(),
            &stub_config(&base),
            &validated(20),
        )
        .await
        .expect_err("401 fails");

        server.abort();
        let _ = server.await;
        assert_eq!(failure, ProviderFailure::Auth);
    }

    #[tokio::test]
    async fn stub_out_of_credits_is_reported_as_a_credits_failure() {
        let by_status = Router::new().route(
            "/maps/search-v3",
            get(|| async { (StatusCode::PAYMENT_REQUIRED, "payment required") }),
        );
        let (base, server) = spawn_stub(by_status).await;
        let failure = fetch_results(
            &build_discovery_http_client(),
            &stub_config(&base),
            &validated(20),
        )
        .await
        .expect_err("402 fails");
        server.abort();
        let _ = server.await;
        assert_eq!(failure, ProviderFailure::Credits);

        let by_body = Router::new().route(
            "/maps/search-v3",
            get(|| async {
                Json(serde_json::json!({
                    "id": "req-2",
                    "status": "Error",
                    "errorMessage": "Not enough credits to run this request"
                }))
            }),
        );
        let (base, server) = spawn_stub(by_body).await;
        let failure = fetch_results(
            &build_discovery_http_client(),
            &stub_config(&base),
            &validated(20),
        )
        .await
        .expect_err("error body fails");
        server.abort();
        let _ = server.await;
        assert_eq!(failure, ProviderFailure::Credits);
    }

    #[tokio::test]
    async fn stub_redirects_are_not_followed() {
        use std::sync::atomic::AtomicBool;

        let reached = Arc::new(AtomicBool::new(false));
        let reached_target = reached.clone();
        let target = Router::new().route(
            "/leaked",
            get(move || {
                reached_target.store(true, Ordering::SeqCst);
                async { "reached" }
            }),
        );
        let (target_base, target_server) = spawn_stub(target).await;
        let location = format!("{target_base}/leaked");
        let router = Router::new().route(
            "/maps/search-v3",
            get(move || {
                let location = location.clone();
                async move { (StatusCode::FOUND, [(header::LOCATION, location)], "moved") }
            }),
        );
        let (base, server) = spawn_stub(router).await;

        let failure = fetch_results(
            &build_discovery_http_client(),
            &stub_config(&base),
            &validated(20),
        )
        .await
        .expect_err("redirect fails");

        server.abort();
        target_server.abort();
        let _ = server.await;
        let _ = target_server.await;
        assert_eq!(failure, ProviderFailure::Unavailable);
        assert!(!reached.load(Ordering::SeqCst));
    }
}

#[cfg(test)]
mod cap_tests {
    use super::*;

    fn at(year: i32, month: u32, day: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(year, month, day, 23, 59, 59)
            .single()
            .expect("timestamp")
    }

    #[test]
    fn month_starts_on_the_first_in_utc() {
        assert_eq!(
            month_start(at(2026, 10, 29)),
            NaiveDate::from_ymd_opt(2026, 10, 1).unwrap()
        );
        assert_eq!(
            month_start(at(2026, 11, 1)),
            NaiveDate::from_ymd_opt(2026, 11, 1).unwrap()
        );
    }

    #[test]
    fn reset_is_the_first_of_next_month_and_rolls_the_year() {
        let reset = |year, month| {
            monthly_limit_response(NaiveDate::from_ymd_opt(year, month, 1).unwrap())
                .1
                 .0["resets_at"]
                .clone()
        };
        assert_eq!(reset(2026, 10), "2026-11-01T00:00:00Z");
        assert_eq!(reset(2026, 12), "2027-01-01T00:00:00Z");
    }

    #[test]
    fn monthly_limit_body_is_the_contract() {
        let (status, body) = monthly_limit_response(NaiveDate::from_ymd_opt(2026, 10, 1).unwrap());
        assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(
            body.0,
            serde_json::json!({ "error": "monthly_limit", "resets_at": "2026-11-01T00:00:00Z" })
        );
    }
}

#[cfg(test)]
mod postgres_tests;
