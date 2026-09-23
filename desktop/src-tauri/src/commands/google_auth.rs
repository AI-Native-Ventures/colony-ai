use std::{
    net::{IpAddr, Ipv4Addr, SocketAddr},
    time::Duration,
};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use tauri_plugin_opener::OpenerExt;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};
use url::{form_urlencoded, Url};
use zeroize::{Zeroize, Zeroizing};

const GOOGLE_AUTHORIZATION_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const CALLBACK_TIMEOUT: Duration = Duration::from_secs(180);
const TOKEN_TIMEOUT: Duration = Duration::from_secs(20);
const TOKEN_RESPONSE_LIMIT: usize = 64 * 1024;
const CALLBACK_REQUEST_LIMIT: usize = 8 * 1024;
const CALLBACK_ATTEMPT_LIMIT: usize = 8;
const CALLBACK_REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const CALLBACK_PATH: &str = "/oauth2/callback";
const CALLBACK_SUCCESS_HTML: &str = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Sign-in complete</title></head><body><p>You can return to the desktop app.</p></body></html>";
const CALLBACK_FAILURE_HTML: &str = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Sign-in incomplete</title></head><body><p>Sign-in did not complete. Return to the desktop app and try again.</p></body></html>";

#[derive(Clone, Copy)]
struct GoogleOAuthEndpoints<'a> {
    authorization: &'a str,
    token: &'a str,
    callback_timeout: Duration,
    token_timeout: Duration,
}

impl GoogleOAuthEndpoints<'static> {
    const PRODUCTION: Self = Self {
        authorization: GOOGLE_AUTHORIZATION_ENDPOINT,
        token: GOOGLE_TOKEN_ENDPOINT,
        callback_timeout: CALLBACK_TIMEOUT,
        token_timeout: TOKEN_TIMEOUT,
    };
}

#[derive(Debug, PartialEq, Eq)]
enum GoogleOAuthError {
    InvalidConfiguration,
    ListenerUnavailable,
    BrowserUnavailable,
    TimedOut,
    Cancelled,
    InvalidCallback,
    TokenExchangeFailed,
    InvalidTokenResponse,
}

impl GoogleOAuthError {
    fn safe_message(&self) -> &'static str {
        match self {
            Self::InvalidConfiguration => "Google sign-in is not configured.",
            Self::ListenerUnavailable => "Could not start Google sign-in.",
            Self::BrowserUnavailable => "Could not open the system browser.",
            Self::TimedOut => "Google sign-in timed out.",
            Self::Cancelled => "Google sign-in was cancelled.",
            Self::InvalidCallback => "Google sign-in returned an invalid response.",
            Self::TokenExchangeFailed => "Google sign-in could not be completed.",
            Self::InvalidTokenResponse => "Google sign-in returned an invalid response.",
        }
    }
}

struct CallbackQuery {
    state: Option<String>,
    code: Option<String>,
    error: Option<String>,
}

fn parse_callback_query(url: &Url) -> Result<CallbackQuery, GoogleOAuthError> {
    let mut query = CallbackQuery {
        state: None,
        code: None,
        error: None,
    };
    for (key, value) in url.query_pairs() {
        let slot = match key.as_ref() {
            "state" => &mut query.state,
            "code" => &mut query.code,
            "error" => &mut query.error,
            _ => continue,
        };
        if slot.replace(value.into_owned()).is_some() {
            return Err(GoogleOAuthError::InvalidCallback);
        }
    }
    Ok(query)
}

async fn read_callback_url(
    stream: &mut TcpStream,
    expected_host: &str,
) -> Result<Url, GoogleOAuthError> {
    let mut bytes = Vec::with_capacity(1024);
    let mut chunk = [0_u8; 1024];
    loop {
        let count = stream
            .read(&mut chunk)
            .await
            .map_err(|_| GoogleOAuthError::InvalidCallback)?;
        if count == 0 {
            return Err(GoogleOAuthError::InvalidCallback);
        }
        if bytes.len().saturating_add(count) > CALLBACK_REQUEST_LIMIT {
            return Err(GoogleOAuthError::InvalidCallback);
        }
        bytes.extend_from_slice(&chunk[..count]);
        if bytes.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }

    let request = std::str::from_utf8(&bytes).map_err(|_| GoogleOAuthError::InvalidCallback)?;
    let mut lines = request.split("\r\n");
    let mut parts = lines
        .next()
        .ok_or(GoogleOAuthError::InvalidCallback)?
        .split_whitespace();
    if parts.next() != Some("GET") {
        return Err(GoogleOAuthError::InvalidCallback);
    }
    let target = parts.next().ok_or(GoogleOAuthError::InvalidCallback)?;
    if !matches!(parts.next(), Some("HTTP/1.0" | "HTTP/1.1")) || parts.next().is_some() {
        return Err(GoogleOAuthError::InvalidCallback);
    }
    let host = lines
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.eq_ignore_ascii_case("host").then_some(value.trim())
        })
        .ok_or(GoogleOAuthError::InvalidCallback)?;
    if !host.eq_ignore_ascii_case(expected_host) || !target.starts_with('/') {
        return Err(GoogleOAuthError::InvalidCallback);
    }
    Url::parse(&format!("http://{expected_host}{target}"))
        .map_err(|_| GoogleOAuthError::InvalidCallback)
}

async fn write_callback_response(stream: &mut TcpStream, status: &'static str, html: &'static str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{html}",
        html.len()
    );
    let _ = tokio::time::timeout(Duration::from_secs(2), async {
        stream.write_all(response.as_bytes()).await?;
        stream.shutdown().await
    })
    .await;
}

async fn receive_authorization_code(
    listener: TcpListener,
    expected_host: &str,
    expected_state: &str,
) -> Result<String, GoogleOAuthError> {
    for _ in 0..CALLBACK_ATTEMPT_LIMIT {
        let (mut stream, peer) = listener
            .accept()
            .await
            .map_err(|_| GoogleOAuthError::ListenerUnavailable)?;
        if !peer.ip().is_loopback() {
            write_callback_response(&mut stream, "403 Forbidden", CALLBACK_FAILURE_HTML).await;
            continue;
        }
        let url = match tokio::time::timeout(
            CALLBACK_REQUEST_TIMEOUT,
            read_callback_url(&mut stream, expected_host),
        )
        .await
        {
            Ok(Ok(url)) => url,
            _ => {
                write_callback_response(&mut stream, "400 Bad Request", CALLBACK_FAILURE_HTML)
                    .await;
                continue;
            }
        };
        if url.path() != CALLBACK_PATH {
            write_callback_response(&mut stream, "404 Not Found", CALLBACK_FAILURE_HTML).await;
            continue;
        }
        let query = match parse_callback_query(&url) {
            Ok(query) => query,
            Err(_) => {
                write_callback_response(&mut stream, "400 Bad Request", CALLBACK_FAILURE_HTML)
                    .await;
                continue;
            }
        };
        let Some(received_state) = query.state.as_deref() else {
            write_callback_response(&mut stream, "400 Bad Request", CALLBACK_FAILURE_HTML).await;
            continue;
        };
        if !constant_time_equal(expected_state, received_state) {
            write_callback_response(&mut stream, "400 Bad Request", CALLBACK_FAILURE_HTML).await;
            continue;
        }

        if query.error.is_some() {
            write_callback_response(&mut stream, "200 OK", CALLBACK_FAILURE_HTML).await;
            return Err(GoogleOAuthError::Cancelled);
        }
        if let Some(code) = query
            .code
            .filter(|code| !code.is_empty() && code.len() <= 4096)
        {
            write_callback_response(&mut stream, "200 OK", CALLBACK_SUCCESS_HTML).await;
            return Ok(code);
        }
        write_callback_response(&mut stream, "400 Bad Request", CALLBACK_FAILURE_HTML).await;
        return Err(GoogleOAuthError::InvalidCallback);
    }
    Err(GoogleOAuthError::InvalidCallback)
}

fn constant_time_equal(expected: &str, actual: &str) -> bool {
    if expected.len() != actual.len() {
        return false;
    }
    expected
        .bytes()
        .zip(actual.bytes())
        .fold(0_u8, |difference, (left, right)| {
            difference | (left ^ right)
        })
        == 0
}

fn random_url_safe_token(byte_count: usize) -> Result<String, GoogleOAuthError> {
    let mut bytes = vec![0; byte_count];
    getrandom::getrandom(&mut bytes).map_err(|_| GoogleOAuthError::InvalidConfiguration)?;
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

fn authorization_url(
    endpoint: &str,
    client_id: &str,
    redirect_uri: &str,
    state: &str,
    challenge: &str,
) -> Result<String, GoogleOAuthError> {
    let mut url = Url::parse(endpoint).map_err(|_| GoogleOAuthError::InvalidConfiguration)?;
    url.query_pairs_mut()
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", "openid email")
        .append_pair("state", state)
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256");
    Ok(url.to_string())
}

async fn exchange_code_for_id_token(
    endpoint: &str,
    client_id: &str,
    redirect_uri: &str,
    code: &str,
    verifier: &str,
    timeout: Duration,
) -> Result<String, GoogleOAuthError> {
    #[derive(Deserialize)]
    struct GoogleTokenResponse {
        id_token: Option<String>,
    }

    let mut form = form_urlencoded::Serializer::new(String::new())
        .append_pair("client_id", client_id)
        .append_pair("code", code)
        .append_pair("code_verifier", verifier)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("grant_type", "authorization_code")
        .finish();
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| GoogleOAuthError::TokenExchangeFailed)?;
    let response = client
        .post(endpoint)
        .header(
            reqwest::header::CONTENT_TYPE,
            "application/x-www-form-urlencoded",
        )
        .body(form.clone())
        .send()
        .await;
    form.zeroize();
    let mut response = response.map_err(|_| GoogleOAuthError::TokenExchangeFailed)?;
    if !response.status().is_success() {
        return Err(GoogleOAuthError::TokenExchangeFailed);
    }

    let mut response_bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| GoogleOAuthError::TokenExchangeFailed)?
    {
        if response_bytes.len().saturating_add(chunk.len()) > TOKEN_RESPONSE_LIMIT {
            response_bytes.zeroize();
            return Err(GoogleOAuthError::InvalidTokenResponse);
        }
        response_bytes.extend_from_slice(&chunk);
    }
    let parsed = serde_json::from_slice::<GoogleTokenResponse>(&response_bytes);
    response_bytes.zeroize();
    parsed
        .map_err(|_| GoogleOAuthError::InvalidTokenResponse)?
        .id_token
        .filter(|token| !token.is_empty())
        .ok_or(GoogleOAuthError::InvalidTokenResponse)
}

async fn run_google_oauth(
    client_id: &str,
    endpoints: GoogleOAuthEndpoints<'_>,
    open_browser: impl FnOnce(&str) -> Result<(), GoogleOAuthError>,
) -> Result<String, GoogleOAuthError> {
    let client_id = client_id.trim();
    if client_id.is_empty() || client_id.len() > 512 {
        return Err(GoogleOAuthError::InvalidConfiguration);
    }

    let listener = TcpListener::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0))
        .await
        .map_err(|_| GoogleOAuthError::ListenerUnavailable)?;
    let port = listener
        .local_addr()
        .map_err(|_| GoogleOAuthError::ListenerUnavailable)?
        .port();
    let expected_host = format!("127.0.0.1:{port}");
    let redirect_uri = format!("http://127.0.0.1:{port}{CALLBACK_PATH}");

    let state = Zeroizing::new(random_url_safe_token(32)?);
    let verifier = Zeroizing::new(random_url_safe_token(32)?);
    let challenge = pkce_challenge(&verifier);
    let auth_url = authorization_url(
        endpoints.authorization,
        client_id,
        &redirect_uri,
        &state,
        &challenge,
    )?;

    if open_browser(&auth_url).is_err() {
        return Err(GoogleOAuthError::BrowserUnavailable);
    }

    let mut code = match tokio::time::timeout(
        endpoints.callback_timeout,
        receive_authorization_code(listener, &expected_host, state.as_str()),
    )
    .await
    {
        Ok(Ok(code)) => Zeroizing::new(code),
        Ok(Err(error)) => return Err(error),
        Err(_) => return Err(GoogleOAuthError::TimedOut),
    };

    let token = exchange_code_for_id_token(
        endpoints.token,
        client_id,
        &redirect_uri,
        &code,
        &verifier,
        endpoints.token_timeout,
    )
    .await;
    code.zeroize();
    token
}

/// Complete Google desktop sign-in through the system browser and a native loopback listener.
#[tauri::command]
pub async fn google_desktop_sign_in(
    app: tauri::AppHandle,
    client_id: String,
) -> Result<String, String> {
    run_google_oauth(&client_id, GoogleOAuthEndpoints::PRODUCTION, |url| {
        app.opener()
            .open_url(url, None::<&str>)
            .map_err(|_| GoogleOAuthError::BrowserUnavailable)
    })
    .await
    .map_err(|error| error.safe_message().to_owned())
}

#[cfg(test)]
mod tests {
    use std::{
        collections::HashMap,
        sync::{Arc, Mutex},
        time::Duration,
    };

    use axum::{body::Bytes, extract::State, http::StatusCode, routing::post, Json, Router};
    use tokio::net::TcpListener;
    use url::{form_urlencoded, Url};

    use super::{
        pkce_challenge, run_google_oauth, GoogleOAuthEndpoints, GoogleOAuthError, CALLBACK_PATH,
    };

    async fn fake_token_endpoint(
        State(captured_form): State<Arc<Mutex<Option<String>>>>,
        body: Bytes,
    ) -> (StatusCode, Json<serde_json::Value>) {
        let form = String::from_utf8_lossy(&body).into_owned();
        if let Ok(mut captured) = captured_form.lock() {
            *captured = Some(form);
        }
        (
            StatusCode::OK,
            Json(serde_json::json!({ "id_token": "test.id.token" })),
        )
    }

    async fn start_fake_token_server(
        captured_form: Arc<Mutex<Option<String>>>,
    ) -> (String, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("fake token listener should bind");
        let address = listener
            .local_addr()
            .expect("fake token listener should have an address");
        let router = Router::new()
            .route("/token", post(fake_token_endpoint))
            .with_state(captured_form);
        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, router).await;
        });
        (format!("http://{address}/token"), task)
    }

    fn query_map(url: &Url) -> HashMap<String, String> {
        url.query_pairs()
            .map(|(key, value)| (key.into_owned(), value.into_owned()))
            .collect()
    }

    #[tokio::test]
    async fn loopback_flow_checks_state_exchanges_pkce_and_returns_only_id_token() {
        let captured_form = Arc::new(Mutex::new(None));
        let (token_endpoint, token_server) =
            start_fake_token_server(Arc::clone(&captured_form)).await;
        let auth_details = Arc::new(Mutex::new(None::<HashMap<String, String>>));
        let callback_statuses = Arc::new(Mutex::new(Vec::<u16>::new()));
        let auth_details_for_browser = Arc::clone(&auth_details);
        let callback_statuses_for_browser = Arc::clone(&callback_statuses);
        let callback_timeout = Duration::from_secs(3);

        let token = run_google_oauth(
            "desktop-client-id",
            GoogleOAuthEndpoints {
                authorization: "https://accounts.example.test/authorize",
                token: &token_endpoint,
                callback_timeout,
                token_timeout: Duration::from_secs(2),
            },
            move |auth_url| {
                let auth_url =
                    Url::parse(auth_url).map_err(|_| GoogleOAuthError::InvalidConfiguration)?;
                let details = query_map(&auth_url);
                if let Ok(mut captured) = auth_details_for_browser.lock() {
                    *captured = Some(details.clone());
                }
                let redirect_uri = details
                    .get("redirect_uri")
                    .cloned()
                    .ok_or(GoogleOAuthError::InvalidConfiguration)?;
                let state = details
                    .get("state")
                    .cloned()
                    .ok_or(GoogleOAuthError::InvalidConfiguration)?;
                let task_statuses = Arc::clone(&callback_statuses_for_browser);
                tokio::spawn(async move {
                    let mut invalid = Url::parse(&redirect_uri).expect("redirect URI parses");
                    invalid
                        .query_pairs_mut()
                        .append_pair("state", "wrong-state")
                        .append_pair("code", "attacker-code");
                    if let Ok(response) = reqwest::get(invalid).await {
                        if let Ok(mut statuses) = task_statuses.lock() {
                            statuses.push(response.status().as_u16());
                        }
                    }

                    let mut valid = Url::parse(&redirect_uri).expect("redirect URI parses");
                    valid
                        .query_pairs_mut()
                        .append_pair("state", &state)
                        .append_pair("code", "authorization-code");
                    if let Ok(response) = reqwest::get(valid).await {
                        if let Ok(mut statuses) = task_statuses.lock() {
                            statuses.push(response.status().as_u16());
                        }
                    }
                });
                Ok(())
            },
        )
        .await
        .expect("fake Google flow should succeed");

        assert_eq!(token, "test.id.token");
        let details = auth_details
            .lock()
            .expect("auth details lock")
            .clone()
            .expect("browser URL captured");
        assert_eq!(
            details.get("client_id").map(String::as_str),
            Some("desktop-client-id")
        );
        assert_eq!(
            details.get("response_type").map(String::as_str),
            Some("code")
        );
        assert_eq!(
            details.get("code_challenge_method").map(String::as_str),
            Some("S256")
        );
        assert_eq!(
            details.get("scope").map(String::as_str),
            Some("openid email")
        );
        assert!(!details.contains_key("code_verifier"));
        let redirect = Url::parse(details.get("redirect_uri").expect("redirect URI set"))
            .expect("redirect URI valid");
        assert_eq!(redirect.scheme(), "http");
        assert_eq!(redirect.host_str(), Some("127.0.0.1"));
        assert_eq!(redirect.path(), CALLBACK_PATH);

        let challenge = details.get("code_challenge").expect("PKCE challenge set");
        let state = details.get("state").expect("state set");
        assert_eq!(challenge.len(), 43);
        assert_eq!(state.len(), 43);
        let form = captured_form
            .lock()
            .expect("token form lock")
            .clone()
            .expect("token endpoint received form");
        let form_fields: HashMap<String, String> = form_urlencoded::parse(form.as_bytes())
            .map(|(key, value)| (key.into_owned(), value.into_owned()))
            .collect();
        let verifier = form_fields
            .get("code_verifier")
            .expect("verifier sent to token endpoint");
        assert_eq!(pkce_challenge(verifier), *challenge);
        assert_eq!(
            form_fields.get("code").map(String::as_str),
            Some("authorization-code")
        );
        assert_eq!(form_fields.get("redirect_uri"), details.get("redirect_uri"));
        let statuses = callback_statuses
            .lock()
            .expect("callback statuses lock")
            .clone();
        assert_eq!(statuses, vec![400, 200]);

        token_server.abort();
    }

    #[tokio::test]
    async fn callback_wait_has_a_bounded_timeout() {
        let result = run_google_oauth(
            "desktop-client-id",
            GoogleOAuthEndpoints {
                authorization: "https://accounts.example.test/authorize",
                token: "https://tokens.example.test/token",
                callback_timeout: Duration::from_millis(20),
                token_timeout: Duration::from_millis(20),
            },
            |_| Ok(()),
        )
        .await;
        assert_eq!(result, Err(GoogleOAuthError::TimedOut));
    }

    #[test]
    fn pkce_challenge_is_s256_base64url_without_padding() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        assert_eq!(
            pkce_challenge(verifier),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }
}
