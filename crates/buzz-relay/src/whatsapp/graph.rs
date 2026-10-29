//! The only code that talks to Meta's Graph API. Everything else in the relay goes through
//! the [`GraphApi`] trait, so tests run against a fake and CI never reaches Meta.
//!
//! The access token is passed in per call, sent as a bearer header, and never stored here,
//! logged, or copied into an error.

use std::time::Duration;

use async_trait::async_trait;
use serde_json::{json, Value};

/// Graph API version used for every call. Change it here only.
pub const GRAPH_API_VERSION: &str = "v23.0";
const DEFAULT_GRAPH_BASE: &str = "https://graph.facebook.com";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);
const MAX_RESPONSE_BYTES: usize = 2 * 1024 * 1024;
const MAX_TEMPLATE_PAGES: usize = 10;
const ERROR_MESSAGE_CHARS: usize = 300;

/// What Meta reports about the sending number.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PhoneInfo {
    /// Number as shown to people.
    pub display_phone_number: Option<String>,
    /// Verified business name.
    pub verified_name: Option<String>,
    /// `GREEN`, `YELLOW`, `RED` or `UNKNOWN`.
    pub quality_rating: Option<String>,
    /// For example `CONNECTED`.
    pub status: Option<String>,
}

/// A template as Meta lists it.
#[derive(Clone, Debug, PartialEq)]
pub struct RemoteTemplate {
    /// Template name.
    pub name: String,
    /// Language code.
    pub language: String,
    /// Meta category.
    pub category: String,
    /// Meta status.
    pub status: String,
    /// Body text with `{{n}}` slots.
    pub body: String,
    /// Buttons: `[{type, text}]`.
    pub buttons: Value,
}

/// One message to send.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SendRequest {
    /// Free text, only valid inside the 24 hour window.
    Text {
        /// Recipient `wa_id`.
        to: String,
        /// Message text.
        body: String,
    },
    /// Approved template with body parameters.
    Template {
        /// Recipient `wa_id`.
        to: String,
        /// Template name.
        name: String,
        /// Language code.
        language: String,
        /// Body parameters in slot order.
        params: Vec<String>,
    },
}

/// Why a Graph call did not succeed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum GraphError {
    /// Meta answered with an error. For a send this means nothing was sent.
    Rejected {
        /// HTTP status.
        http_status: u16,
        /// Meta error code, when present.
        code: Option<i64>,
        /// Meta's message, clipped.
        message: String,
    },
    /// No usable answer (network error, timeout, 5xx, unreadable body). For a send the
    /// outcome is unknown and the message must never be sent again automatically.
    Unavailable(String),
}

impl std::fmt::Display for GraphError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Rejected {
                http_status,
                code,
                message,
            } => write!(f, "graph rejected ({http_status}, code {code:?}): {message}"),
            Self::Unavailable(reason) => write!(f, "graph unavailable: {reason}"),
        }
    }
}

impl std::error::Error for GraphError {}

/// Meta calls the relay makes.
#[async_trait]
pub trait GraphApi: Send + Sync {
    /// `GET /{phone-number-id}`: also proves the token works.
    async fn get_phone_info(&self, token: &str, phone_number_id: &str)
        -> Result<PhoneInfo, GraphError>;
    /// Point the number's webhook at `callback_uri` with a verify token.
    async fn set_webhook_override(
        &self,
        token: &str,
        phone_number_id: &str,
        callback_uri: &str,
        verify_token: &str,
    ) -> Result<(), GraphError>;
    /// Remove the number's webhook override.
    async fn clear_webhook_override(
        &self,
        token: &str,
        phone_number_id: &str,
    ) -> Result<(), GraphError>;
    /// `POST /{waba-id}/subscribed_apps`.
    async fn subscribe_app(&self, token: &str, waba_id: &str) -> Result<(), GraphError>;
    /// Approved templates of the account.
    async fn list_templates(
        &self,
        token: &str,
        waba_id: &str,
    ) -> Result<Vec<RemoteTemplate>, GraphError>;
    /// Send one message; returns the WhatsApp message id.
    async fn send(
        &self,
        token: &str,
        phone_number_id: &str,
        request: &SendRequest,
    ) -> Result<String, GraphError>;
}

/// Request body for a send.
pub fn send_payload(request: &SendRequest) -> Value {
    match request {
        SendRequest::Text { to, body } => json!({
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": to,
            "type": "text",
            "text": { "preview_url": false, "body": body },
        }),
        SendRequest::Template {
            to,
            name,
            language,
            params,
        } => {
            let mut template = json!({
                "name": name,
                "language": { "code": language },
            });
            if !params.is_empty() {
                let parameters: Vec<Value> = params
                    .iter()
                    .map(|text| json!({ "type": "text", "text": text }))
                    .collect();
                template["components"] = json!([{ "type": "body", "parameters": parameters }]);
            }
            json!({
                "messaging_product": "whatsapp",
                "recipient_type": "individual",
                "to": to,
                "type": "template",
                "template": template,
            })
        }
    }
}

/// Read a Graph error body. `None` when the body is not a Graph error.
pub fn parse_error(http_status: u16, body: &Value) -> Option<GraphError> {
    let error = body.get("error")?;
    let message: String = error
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("")
        .chars()
        .take(ERROR_MESSAGE_CHARS)
        .collect();
    Some(GraphError::Rejected {
        http_status,
        code: error.get("code").and_then(Value::as_i64),
        message,
    })
}

/// WhatsApp message id from a send response.
pub fn parse_send_response(body: &Value) -> Option<String> {
    body.get("messages")?
        .as_array()?
        .first()?
        .get("id")?
        .as_str()
        .filter(|id| !id.is_empty() && id.len() <= 256)
        .map(str::to_owned)
}

/// Phone fields from `GET /{phone-number-id}`.
pub fn parse_phone_info(body: &Value) -> PhoneInfo {
    let text = |key: &str| {
        body.get(key)
            .and_then(Value::as_str)
            .map(|value| value.chars().take(200).collect::<String>())
    };
    PhoneInfo {
        display_phone_number: text("display_phone_number"),
        verified_name: text("verified_name"),
        quality_rating: text("quality_rating"),
        status: text("status"),
    }
}

/// Approved templates from one `message_templates` page.
pub fn parse_templates(body: &Value) -> Vec<RemoteTemplate> {
    let Some(items) = body.get("data").and_then(Value::as_array) else {
        return Vec::new();
    };
    items
        .iter()
        .filter_map(|item| {
            let name = item.get("name")?.as_str()?.to_owned();
            let language = item.get("language")?.as_str()?.to_owned();
            let status = item.get("status").and_then(Value::as_str).unwrap_or("");
            if !status.eq_ignore_ascii_case("APPROVED") {
                return None;
            }
            let category = item
                .get("category")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_owned();
            let components = item.get("components").and_then(Value::as_array);
            let mut template_body = String::new();
            let mut buttons = Vec::new();
            for component in components.into_iter().flatten() {
                match component.get("type").and_then(Value::as_str) {
                    Some(kind) if kind.eq_ignore_ascii_case("BODY") => {
                        template_body = component
                            .get("text")
                            .and_then(Value::as_str)
                            .unwrap_or("")
                            .to_owned();
                    }
                    Some(kind) if kind.eq_ignore_ascii_case("BUTTONS") => {
                        for button in component
                            .get("buttons")
                            .and_then(Value::as_array)
                            .into_iter()
                            .flatten()
                        {
                            buttons.push(json!({
                                "type": button.get("type").and_then(Value::as_str).unwrap_or(""),
                                "text": button.get("text").and_then(Value::as_str).unwrap_or(""),
                            }));
                        }
                    }
                    _ => {}
                }
            }
            Some(RemoteTemplate {
                name,
                language,
                category,
                status: status.to_owned(),
                body: template_body,
                buttons: Value::Array(buttons),
            })
        })
        .collect()
}

/// Production client over reqwest. Redirects are off so the bearer token can never be
/// replayed to another host.
pub struct ReqwestGraph {
    client: reqwest::Client,
    base: String,
}

impl ReqwestGraph {
    /// Client for `https://graph.facebook.com`.
    pub fn new() -> Self {
        Self::with_base(DEFAULT_GRAPH_BASE)
    }

    /// Client for another base URL (tests that stand up their own server).
    pub fn with_base(base: &str) -> Self {
        let client = reqwest::Client::builder()
            .timeout(REQUEST_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap_or_default();
        Self {
            client,
            base: base.trim_end_matches('/').to_owned(),
        }
    }

    fn url(&self, path: &str) -> String {
        format!("{}/{}/{}", self.base, GRAPH_API_VERSION, path.trim_start_matches('/'))
    }

    /// URL with query pairs. reqwest's own `query` helper is not enabled in this build.
    fn url_with_query(&self, path: &str, pairs: &[(&str, &str)]) -> Result<url::Url, GraphError> {
        let mut url = url::Url::parse(&self.url(path))
            .map_err(|_| GraphError::Unavailable("invalid graph url".to_owned()))?;
        url.query_pairs_mut().extend_pairs(pairs.iter().copied());
        Ok(url)
    }

    async fn call(
        &self,
        token: &str,
        request: reqwest::RequestBuilder,
    ) -> Result<Value, GraphError> {
        let response = request
            .bearer_auth(token)
            .send()
            .await
            .map_err(|error| GraphError::Unavailable(describe_transport_error(&error)))?;
        let status = response.status();
        let bytes = read_bounded(response).await?;
        let body: Value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        if status.is_success() {
            return Ok(body);
        }
        if status.is_client_error() {
            if let Some(error) = parse_error(status.as_u16(), &body) {
                return Err(error);
            }
        }
        Err(GraphError::Unavailable(format!("http {}", status.as_u16())))
    }
}

impl Default for ReqwestGraph {
    fn default() -> Self {
        Self::new()
    }
}

/// Transport errors can carry the request URL; keep only the kind.
fn describe_transport_error(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        "timeout".to_owned()
    } else if error.is_connect() {
        "connect error".to_owned()
    } else {
        "transport error".to_owned()
    }
}

async fn read_bounded(response: reqwest::Response) -> Result<Vec<u8>, GraphError> {
    use futures_util::StreamExt;
    let mut stream = response.bytes_stream();
    let mut out = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|error| GraphError::Unavailable(describe_transport_error(&error)))?;
        if out.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err(GraphError::Unavailable("response too large".to_owned()));
        }
        out.extend_from_slice(&chunk);
    }
    Ok(out)
}

#[async_trait]
impl GraphApi for ReqwestGraph {
    async fn get_phone_info(
        &self,
        token: &str,
        phone_number_id: &str,
    ) -> Result<PhoneInfo, GraphError> {
        let url = self.url_with_query(
            phone_number_id,
            &[(
                "fields",
                "display_phone_number,verified_name,quality_rating,status",
            )],
        )?;
        let request = self.client.get(url);
        Ok(parse_phone_info(&self.call(token, request).await?))
    }

    async fn set_webhook_override(
        &self,
        token: &str,
        phone_number_id: &str,
        callback_uri: &str,
        verify_token: &str,
    ) -> Result<(), GraphError> {
        let request = self.client.post(self.url(phone_number_id)).json(&json!({
            "webhook_configuration": {
                "override_callback_uri": callback_uri,
                "verify_token": verify_token,
            }
        }));
        self.call(token, request).await.map(|_| ())
    }

    async fn clear_webhook_override(
        &self,
        token: &str,
        phone_number_id: &str,
    ) -> Result<(), GraphError> {
        let request = self.client.post(self.url(phone_number_id)).json(&json!({
            "webhook_configuration": { "override_callback_uri": "" }
        }));
        self.call(token, request).await.map(|_| ())
    }

    async fn subscribe_app(&self, token: &str, waba_id: &str) -> Result<(), GraphError> {
        let request = self
            .client
            .post(self.url(&format!("{waba_id}/subscribed_apps")));
        self.call(token, request).await.map(|_| ())
    }

    async fn list_templates(
        &self,
        token: &str,
        waba_id: &str,
    ) -> Result<Vec<RemoteTemplate>, GraphError> {
        let mut templates = Vec::new();
        let mut after: Option<String> = None;
        for _ in 0..MAX_TEMPLATE_PAGES {
            let mut pairs = vec![
                ("fields", "name,language,category,status,components"),
                ("status", "APPROVED"),
                ("limit", "100"),
            ];
            if let Some(cursor) = after.as_deref() {
                pairs.push(("after", cursor));
            }
            let url = self.url_with_query(&format!("{waba_id}/message_templates"), &pairs)?;
            let body = self.call(token, self.client.get(url)).await?;
            templates.extend(parse_templates(&body));
            // Only the cursor is followed, never a URL Meta hands back, so the bearer
            // token cannot be sent to another host.
            after = body
                .pointer("/paging/cursors/after")
                .and_then(Value::as_str)
                .filter(|_| body.pointer("/paging/next").is_some())
                .map(str::to_owned);
            if after.is_none() {
                break;
            }
        }
        Ok(templates)
    }

    async fn send(
        &self,
        token: &str,
        phone_number_id: &str,
        request: &SendRequest,
    ) -> Result<String, GraphError> {
        let call = self
            .client
            .post(self.url(&format!("{phone_number_id}/messages")))
            .json(&send_payload(request));
        let body = self.call(token, call).await?;
        parse_send_response(&body)
            .ok_or_else(|| GraphError::Unavailable("send response had no message id".to_owned()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_payload_has_the_cloud_api_shape() {
        let payload = send_payload(&SendRequest::Text {
            to: "27821234567".into(),
            body: "Hello".into(),
        });
        assert_eq!(payload["messaging_product"], "whatsapp");
        assert_eq!(payload["to"], "27821234567");
        assert_eq!(payload["type"], "text");
        assert_eq!(payload["text"]["body"], "Hello");
        assert_eq!(payload["text"]["preview_url"], false);
    }

    #[test]
    fn template_payload_carries_body_parameters_in_order() {
        let payload = send_payload(&SendRequest::Template {
            to: "27821234567".into(),
            name: "intro_offer".into(),
            language: "en".into(),
            params: vec!["Thabo".into(), "Sam".into()],
        });
        assert_eq!(payload["type"], "template");
        assert_eq!(payload["template"]["name"], "intro_offer");
        assert_eq!(payload["template"]["language"]["code"], "en");
        let parameters = &payload["template"]["components"][0]["parameters"];
        assert_eq!(parameters[0]["text"], "Thabo");
        assert_eq!(parameters[1]["text"], "Sam");

        let bare = send_payload(&SendRequest::Template {
            to: "27821234567".into(),
            name: "hello".into(),
            language: "en".into(),
            params: vec![],
        });
        assert!(bare["template"].get("components").is_none());
    }

    #[test]
    fn graph_errors_are_read_and_clipped() {
        let body = json!({"error": {"message": "x".repeat(1000), "code": 190, "type": "OAuthException"}});
        match parse_error(401, &body) {
            Some(GraphError::Rejected {
                http_status,
                code,
                message,
            }) => {
                assert_eq!(http_status, 401);
                assert_eq!(code, Some(190));
                assert_eq!(message.chars().count(), ERROR_MESSAGE_CHARS);
            }
            other => panic!("expected a rejection, got {other:?}"),
        }
        assert_eq!(parse_error(500, &json!({"ok": true})), None);
    }

    #[test]
    fn send_response_gives_the_message_id() {
        assert_eq!(
            parse_send_response(&json!({"messages": [{"id": "wamid.ABC"}]})).as_deref(),
            Some("wamid.ABC")
        );
        assert_eq!(parse_send_response(&json!({"messages": []})), None);
        assert_eq!(parse_send_response(&json!({})), None);
    }

    #[test]
    fn only_approved_templates_are_listed_with_body_and_buttons() {
        let page = json!({"data": [
            {"name": "intro", "language": "en", "category": "MARKETING", "status": "APPROVED",
             "components": [
                {"type": "BODY", "text": "Hi {{1}}"},
                {"type": "BUTTONS", "buttons": [{"type": "QUICK_REPLY", "text": "Stop"}]}
             ]},
            {"name": "paused_one", "language": "en", "category": "MARKETING", "status": "PAUSED",
             "components": [{"type": "BODY", "text": "no"}]},
        ]});
        let templates = parse_templates(&page);
        assert_eq!(templates.len(), 1);
        assert_eq!(templates[0].name, "intro");
        assert_eq!(templates[0].body, "Hi {{1}}");
        assert_eq!(templates[0].buttons[0]["text"], "Stop");
    }

    #[test]
    fn phone_info_is_read_from_the_fields() {
        let info = parse_phone_info(&json!({
            "display_phone_number": "+27 82 123 4567",
            "verified_name": "Horizon Labs",
            "quality_rating": "GREEN",
            "status": "CONNECTED"
        }));
        assert_eq!(info.quality_rating.as_deref(), Some("GREEN"));
        assert_eq!(info.verified_name.as_deref(), Some("Horizon Labs"));
    }

    #[test]
    fn urls_carry_the_one_version_constant() {
        let graph = ReqwestGraph::with_base("https://graph.example.test/");
        assert_eq!(
            graph.url("123/messages"),
            format!("https://graph.example.test/{GRAPH_API_VERSION}/123/messages")
        );
    }

    #[test]
    fn graph_errors_never_show_a_token() {
        let shown = GraphError::Unavailable("timeout".into()).to_string();
        assert!(!shown.contains("Bearer"));
    }
}
