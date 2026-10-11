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
    subject: &'a str,
    text: &'a str,
}

/// Subject and body for one code email. A sign-in subject carries the code so
/// it can be read from a phone notification without opening the email.
fn message_for(purpose: &str, code: &str) -> (Zeroizing<String>, Zeroizing<String>) {
    match purpose {
        "sign_in" => (
            Zeroizing::new(format!("Your Colony code: {code}")),
            Zeroizing::new(format!(
                "Here's your code to sign in to Colony: {code}. It works for 15 minutes. \
                 If you didn't ask for it, you can ignore this email."
            )),
        ),
        "reset_password" => (
            Zeroizing::new("Your password reset code".to_owned()),
            Zeroizing::new(format!(
                "Your verification code is {code}. It expires in 15 minutes. \
                 If you did not request this code, you can ignore this email."
            )),
        ),
        _ => (
            Zeroizing::new("Your verification code".to_owned()),
            Zeroizing::new(format!(
                "Your verification code is {code}. It expires in 15 minutes. \
                 If you did not request this code, you can ignore this email."
            )),
        ),
    }
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
    let (subject, text) = message_for(purpose, code.as_str());
    let body = ResendEmail {
        from,
        to: [recipient],
        subject: subject.as_str(),
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

#[cfg(test)]
mod tests {
    use super::message_for;

    #[test]
    fn sign_in_mail_names_colony_and_carries_the_code() {
        let (subject, body) = message_for("sign_in", "482913");
        assert_eq!(subject.as_str(), "Your Colony code: 482913");
        assert!(body.contains("sign in to Colony: 482913"));
        assert!(body.contains("15 minutes"));
    }

    #[test]
    fn verification_and_reset_mail_keep_their_wording() {
        let (subject, body) = message_for("reset_password", "123456");
        assert_eq!(subject.as_str(), "Your password reset code");
        assert!(body.contains("123456"));
        let (subject, body) = message_for("verify_email", "654321");
        assert_eq!(subject.as_str(), "Your verification code");
        assert!(body.contains("654321"));
    }
}
