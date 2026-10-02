//! Resend API client for account verification and password reset codes.

use std::time::Duration;

use serde::Serialize;
use thiserror::Error;
use zeroize::Zeroizing;

/// Mail delivery failures that can be retried without exposing provider details.
#[derive(Debug, Error)]
pub enum MailDeliveryError {
    /// Mail settings were not configured for this relay.
    #[error("account mail delivery is not configured")]
    Unconfigured,
    /// The request failed or the provider rejected it.
    #[error("account mail provider unavailable")]
    Provider,
}

#[derive(Serialize)]
struct ResendEmail<'a> {
    from: &'a str,
    to: [&'a str; 1],
    subject: &'static str,
    text: &'a str,
}

/// Send one code through Resend without logging its API token or payload.
pub async fn send_resend(
    client: &reqwest::Client,
    config: &crate::config::AccountConfig,
    recipient: &str,
    purpose: &str,
    code: &Zeroizing<String>,
) -> Result<(), MailDeliveryError> {
    let api_key = config
        .resend_api_key()
        .ok_or(MailDeliveryError::Unconfigured)?;
    let from = config.mail_from().ok_or(MailDeliveryError::Unconfigured)?;
    let subject = match purpose {
        "reset_password" => "Your password reset code",
        _ => "Your verification code",
    };
    let text = Zeroizing::new(format!(
        "Your verification code is {}. It expires in 15 minutes. \
         If you did not request this code, you can ignore this email.",
        code.as_str(),
    ));
    let body = ResendEmail {
        from,
        to: [recipient],
        subject,
        text: text.as_str(),
    };
    let response = client
        .post("https://api.resend.com/emails")
        .timeout(Duration::from_secs(8))
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|_| MailDeliveryError::Provider)?;
    if !response.status().is_success() {
        return Err(MailDeliveryError::Provider);
    }
    Ok(())
}
