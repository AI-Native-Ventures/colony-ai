use reqwest::Method;
use serde::de::DeserializeOwned;

use crate::app_state::AppState;

use super::{
    build_authenticated_relay_request, build_nip98_auth_header, classify_request_error,
    parse_json_response, parse_json_response_bounded, relay_api_base_url_with_override,
    relay_error_message, relay_error_message_bounded,
};

/// Execute an authenticated GET against the active relay and decode its JSON body.
pub async fn get_relay_json<T: DeserializeOwned>(
    state: &AppState,
    path_with_query: &str,
) -> Result<T, String> {
    get_relay_json_inner(state, path_with_query, None).await
}

/// Execute an authenticated GET while bounding the decoded JSON response body.
pub(crate) async fn get_relay_json_bounded<T: DeserializeOwned>(
    state: &AppState,
    path_with_query: &str,
    max_body_bytes: usize,
) -> Result<T, String> {
    if max_body_bytes == 0 {
        return Err("relay response size limit must be positive".to_string());
    }
    get_relay_json_inner(state, path_with_query, Some(max_body_bytes)).await
}

async fn get_relay_json_inner<T: DeserializeOwned>(
    state: &AppState,
    path_with_query: &str,
    max_body_bytes: Option<usize>,
) -> Result<T, String> {
    if !path_with_query.starts_with('/') {
        return Err("relay GET path must begin with '/'".to_string());
    }
    crate::relay_admission::wait_for_rate_limit().await;
    let url = format!(
        "{}{}",
        relay_api_base_url_with_override(state),
        path_with_query
    );
    let auth = build_nip98_auth_header(&Method::GET, &url, &[], state)?;
    let response = build_authenticated_relay_request(
        &state.http_client,
        Method::GET,
        &url,
        &auth,
        None,
        None,
        None,
    )
    .send()
    .await
    .map_err(|error| classify_request_error(&error))?;
    if !response.status().is_success() {
        return Err(match max_body_bytes {
            Some(limit) => relay_error_message_bounded(response, limit).await,
            None => relay_error_message(response).await,
        });
    }
    match max_body_bytes {
        Some(limit) => parse_json_response_bounded(response, limit).await,
        None => parse_json_response(response).await,
    }
}
